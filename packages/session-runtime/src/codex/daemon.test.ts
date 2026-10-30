import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { connectDaemonStream } from "./daemon.js";
import { CodexService } from "./client.js";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { readItemDetail } from "./item-detail.js";

test("independent clients attach to one existing daemon and closing one leaves the other live", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-"));
  const path = join(root, "control.sock");
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const methods: string[] = [];
  server.on("upgrade", (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on("message", (data) => {
        const value = JSON.parse(String(data));
        methods.push(value.method);
        ws.send(
          JSON.stringify({ id: value.id, result: { method: value.method } }),
        );
      });
    }),
  );
  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  const env = {
    SESSION_CODEX_DAEMON_SOCKET: path,
    SESSION_CODEX_DAEMON_AUTO_START: "0",
  };
  const a = await connectDaemonStream(env),
    b = await connectDaemonStream(env);
  t.after(async () => {
    a.stream.destroy();
    b.stream.destroy();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    wss.close();
    await rm(root, { recursive: true, force: true });
  });
  const nextA = a.stream[Symbol.asyncIterator](),
    nextB = b.stream[Symbol.asyncIterator]();
  a.stream.write(JSON.stringify({ id: 1, method: "thread/read" }) + "\n");
  assert.equal(
    JSON.parse(String((await nextA.next()).value)).result.method,
    "thread/read",
  );
  a.stream.destroy();
  b.stream.write(JSON.stringify({ id: 2, method: "model/list" }) + "\n");
  assert.equal(
    JSON.parse(String((await nextB.next()).value)).result.method,
    "model/list",
  );
  assert.deepEqual(methods, ["thread/read", "model/list"]);
  assert.equal(a.scope, b.scope);
  assert.equal(server.listening, true);
});

test("explicit missing socket fails without creating a private backend, and unsafe paths are rejected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    connectDaemonStream({
      SESSION_CODEX_DAEMON_SOCKET: join(root, "missing.sock"),
    }),
    /DAEMON_UNAVAILABLE/,
  );
  await assert.rejects(
    connectDaemonStream({ SESSION_CODEX_DAEMON_SOCKET: "relative.sock" }),
    /Invalid SESSION_CODEX_DAEMON_SOCKET/,
  );
  await assert.rejects(
    connectDaemonStream({
      SESSION_CODEX_DAEMON_SOCKET: join(root, "missing.sock"),
      SESSION_CODEX_DAEMON_AUTO_START: "yes",
    }),
    /Invalid SESSION_CODEX_DAEMON_AUTO_START/,
  );
});

test("an endpoint removed during upgrade closes the already accepted connection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-replaced-"));
  const path = join(root, "control.sock");
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  let closed = false;
  server.on("upgrade", async (request, socket, head) => {
    await rm(path);
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.once("close", () => {
        closed = true;
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    wss.close();
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(
    connectDaemonStream({
      SESSION_CODEX_DAEMON_SOCKET: path,
      SESSION_CODEX_DAEMON_AUTO_START: "0",
    }),
    /ENOENT/,
  );
  const until = Date.now() + 500;
  while (!closed && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    closed,
    true,
    "failed identity verification must not leak an accepted connection",
  );
});

test("a shared client leaves unknown requests to capable peers and preserves a replayed approval identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-requests-")),
    path = join(root, "control.sock");
  const server = createServer(),
    wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const replies: unknown[] = [];
  const approval = {
    id: "shared-approval",
    method: "item/commandExecution/requestApproval",
    params: { threadId: "t", turnId: "u", itemId: "i", command: "fixture" },
  };
  server.on("upgrade", (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) =>
      ws.on("message", (data) => {
        const value = JSON.parse(String(data));
        if (!value.method) {
          replies.push(value);
          return;
        }
        if (value.method === "initialize")
          ws.send(
            JSON.stringify({
              id: value.id,
              result: { userAgent: "codexia/0.165.0" },
            }),
          );
        else if (value.method === "model/list") {
          ws.send(JSON.stringify(approval));
          ws.send(
            JSON.stringify({
              id: "unknown",
              method: "future/request",
              params: { threadId: "t" },
            }),
          );
          ws.send(JSON.stringify({ id: value.id, result: { data: [] } }));
        }
      }),
    ),
  );
  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  const hub = new EventHub(),
    service = new CodexService({
      hub,
      instance: "shared",
      env: {
        CODEX_PATH: "/must-not-start-private-native",
        SESSION_CODEX_DAEMON_SOCKET: path,
        SESSION_CODEX_DAEMON_AUTO_START: "0",
      },
      resolveEnv: async () => {
        throw new Error(
          "Existing daemon must not depend on provider environment storage",
        );
      },
      sweepIntervalMs: 0,
    });
  t.after(async () => {
    await service.close();
    hub.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    wss.close();
    await rm(root, { recursive: true, force: true });
  });
  await service.raw("model/list", {});
  let snapshot = hub.subscribe({ since: 0, snapshots: true });
  const first = snapshot.backlog.find(
    (event) => event.event === "codex/approval-request",
  )!;
  snapshot.close();
  assert.ok(first);
  await service.raw("model/list", {});
  snapshot = hub.subscribe({ since: 0, snapshots: true });
  const approvals = snapshot.backlog.filter(
    (event) => event.event === "codex/approval-request",
  );
  snapshot.close();
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]!.payload.requestToken, first.payload.requestToken);
  assert.deepEqual(
    replies,
    [],
    "unknown native request must not be implicitly denied for other clients",
  );
  await service.respond("commandExecution", {
    request_id: "shared-approval",
    request: first.payload,
    decision: "accept",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(replies, [
    { id: "shared-approval", result: { decision: "accept" } },
  ]);
});

test("independent read projection streams an oversized WebSocket tool frame and closes only its reader connection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kanban-daemon-projection-")),
    path = join(root, "control.sock");
  const server = createServer(),
    wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const methods: string[] = [];
  server.on("upgrade", (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) =>
      ws.on("message", (data) => {
        const value = JSON.parse(String(data));
        methods.push(value.method);
        if (value.method === "initialize")
          ws.send(
            JSON.stringify({ id: value.id, result: { userAgent: "fixture" } }),
          );
        else if (value.method === "thread/read")
          ws.send(
            JSON.stringify({
              id: value.id,
              result: {
                thread: {
                  id: "t",
                  turns: [
                    {
                      id: "u",
                      items: [
                        {
                          type: "commandExecution",
                          id: "hidden",
                          output: "X".repeat(36 * 1024 * 1024),
                        },
                        {
                          type: "commandExecution",
                          id: "i",
                          command: "fixture",
                          aggregatedOutput: "selected",
                          status: "completed",
                          exitCode: 0,
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          );
      }),
    ),
  );
  await new Promise<void>((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  t.after(async () => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    wss.close();
    await rm(root, { recursive: true, force: true });
  });
  const reading = await readItemDetail(
    {
      env: {
        CODEX_PATH: "/must-not-start-private-native",
        SESSION_CODEX_DAEMON_SOCKET: path,
        SESSION_CODEX_DAEMON_AUTO_START: "0",
      },
    },
    {
      threadId: "t",
      turnId: "u",
      itemId: "i",
      expectedType: "commandExecution",
    },
    new AbortController().signal,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of reading.body) chunks.push(chunk as Buffer);
  await reading.finished;
  assert.match(Buffer.concat(chunks).toString(), /selected/);
  assert.ok(reading.metrics.inputBytes > 32 * 1024 * 1024);
  assert.ok(reading.metrics.maxInputChunk <= 4096);
  assert.ok(reading.metrics.maxParserQueue <= 16);
  assert.equal(reading.metrics.transport, "shared-daemon");
  assert.equal(reading.metrics.connectionClosed, true);
  assert.equal(reading.metrics.pid, undefined);
  assert.match(reading.metrics.nativeScope ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(methods, ["initialize", "initialized", "thread/read"]);
  assert.equal(server.listening, true);
});
