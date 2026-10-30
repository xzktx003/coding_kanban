// Explicit isolated official0.163 acceptance; no default HOME/account/IPC and no real model calls.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import {
  request as httpsRequest,
  createServer as createHttpsServer,
} from "node:https";
import {
  registerLocalItemDetailChannel,
  registerLocalChatHistoryChannel,
} from "../../../packages/session-runtime/src/codex/item-detail-channel.ts";
import { homedir, networkInterfaces, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Transform } from "node:stream";
import { createRuntime } from "../../../packages/session-runtime/src/server.ts";
import { registerSessionModeRoutes } from "../../../apps/server/src/routes/session-mode.ts";
import {
  registerOwnedNativeFixture,
  cleanupOwnedNativeFixture,
  ownedDaemonIdentity,
  type OwnedNativeIdentity,
} from "../../../packages/session-runtime/src/codex/daemon-native-fixture.ts";
import { object } from "../../../packages/session-runtime/src/core/json.ts";
const require = createRequire(resolve("packages/session-runtime/package.json")),
  Fastify = require("fastify"),
  pty = require("node-pty");
const scenario = process.argv[2] ?? "m55";
assert.ok(["m55", "m03", "m34"].includes(scenario));
const binary = process.env.SESSION_CODEX_DAEMON_NATIVE_BIN!,
  source = new URL(process.env.M55_FRONTEND_SOURCE!);
assert.ok(binary?.startsWith("/"));
assert.equal(
  createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  "399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215",
);
assert.ok(
  ["http:", "https:"].includes(source.protocol) &&
    !source.username &&
    !source.password &&
    source.pathname === "/" &&
    !source.search &&
    !source.hash,
);
const run = promisify(execFile),
  base = await mkdtemp(join(homedir(), ".kanban-m55-native-")),
  home = join(base, "home"),
  codexHome = join(base, "codex"),
  project = join(base, "project"),
  dataHome = join(base, "data");
await Promise.all(
  [home, codexHome, project, dataHome].map((path) =>
    mkdir(path, { mode: 0o700 }),
  ),
);
await registerOwnedNativeFixture(codexHome);
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: home,
  CODEX_HOME: codexHome,
  CODEX_PATH: binary,
  TERM: "xterm-256color",
  DO_NOT_TRACK: "1",
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  SESSION_CODEX_DAEMON_AUTO_START: "1",
};
let release!: () => void;
const held = new Promise<void>((r) => (release = r));
const calls: Array<any> = [],
  errors: string[] = [],
  requests: Array<any> = [],
  historyRequests: Array<any> = [],
  historyResponses: Array<any> = [],
  nativeMethods: string[] = [],
  notifications: Array<any> = [],
  proxyCanceled: Array<any> = [];
type HistoryGate = {
  threadId: string;
  cursor: string;
  entered: boolean;
  cancelled: boolean;
  release?: () => void;
};
let historyGate: HistoryGate | undefined,
  lastHistoryGate: HistoryGate | undefined;
const waitFor = async (check: () => boolean, label: string, timeoutMs = 30_000) => {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= until) throw new Error(`M55 ${label} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + "\n");
const provider = createServer((req, res) => {
  void (async () => {
    assert.equal(req.url, "/v1/responses", "private provider accepts only its fixed Responses endpoint");
    assert.equal(req.socket.remoteAddress, "127.0.0.1", "provider must remain loopback-only");
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const b of req) {
      bytes += b.length;
      assert.ok(bytes <= 8 * 1024 * 1024);
      chunks.push(Buffer.from(b));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const inputText = JSON.stringify(body.input ?? []);
    let label: string, page = 0, turnIndex = 0;
    if (scenario === "m55") {
      const matches = [...new Set(inputText.match(/M55_PAGE_[012]_ONLY_ONCE/g) ?? [])];
      assert.equal(matches.length, 1, "Each private M55 request must have one exact page prompt");
      label = matches[0]!;
      page = Number(/M55_PAGE_(\d)/.exec(label)?.[1]);
    } else if (scenario === "m03") {
      const matches = [...new Set(inputText.match(/M03_FIRST_TURN_ONLY_ONCE/g) ?? [])];
      assert.equal(matches.length, 1, "The M03 private provider accepts one exact first-turn prompt");
      label = matches[0]!;
    } else {
      const matches = [...inputText.matchAll(/M34_TURN_(\d+)/g)];
      assert.ok(matches.length > 0, "M34 provider requests must stay inside the synthetic turn set");
      turnIndex = Number(matches.at(-1)![1]);
      assert.ok(Number.isSafeInteger(turnIndex) && turnIndex >= 0 && turnIndex < 11);
      label = `M34_TURN_${turnIndex}`;
    }
    const callNumber = calls.length + 1;
    calls.push({ label, page, turnIndex, model: body.model, bytes, url: req.url, remoteAddress: req.socket.remoteAddress });
    if (scenario !== "m34") await held;
    const item = scenario === "m34" && callNumber === 1
      ? {
          type: "function_call",
          id: "m34-fixed-safe-tool-call",
          call_id: "m34-fixed-safe-tool-call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "node -e \"process.stdout.write(Buffer.from('4d33345f544f4f4c5f424f44595f424547494e','hex').toString()+'x'.repeat(65536)+Buffer.from('4d33345f544f4f4c5f424f44595f454e44','hex').toString())\"",
            workdir: project,
            max_output_tokens: 20000,
          }),
        }
      : {
          type: "message",
          role: "assistant",
          id: scenario === "m55" ? `m55-answer-${page}` : `${scenario}-answer-${callNumber}`,
          content: [{
            type: "output_text",
            text: scenario === "m55"
              ? `M55_NATIVE_REPLY_${page}_COMPLETED`
              : scenario === "m03"
                ? "M03_NATIVE_REPLY_COMPLETED"
                : `M34_HISTORY_REPLY_${turnIndex}_COMPLETED`,
          }],
        };
    const responseId = scenario === "m55" ? `m55-response-${page}` : `${scenario}-response-${callNumber}`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { id: responseId } },
      { type: "response.output_item.done", item },
      {
        type: "response.completed",
        response: {
          id: responseId,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ])
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
  })().catch((e) => {
    errors.push(String(e));
    res.writeHead(500);
    res.end("Private provider failed");
  });
});
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined,
  gateway: any,
  frontend: ReturnType<typeof createServer> | undefined,
  identity: OwnedNativeIdentity | undefined,
  nativeRequested = false,
  cli: any,
  cliExited = false,
  cliTail = "",
  closing: Promise<any> | undefined,
  threadIds: string[] = [];
const frontendSockets = new Set<any>();
async function privateNativeIdentity(identity: { pid: number; startTicks: string }) {
  const stat = await readFile(`/proc/${identity.pid}/stat`, "utf8"),
    fields = stat.slice(stat.lastIndexOf(")") + 2).split(" "),
    argv = (await readFile(`/proc/${identity.pid}/cmdline`, "utf8"))
      .split("\0")
      .filter(Boolean),
    status = await readFile(`/proc/${identity.pid}/status`, "utf8"),
    uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]),
    releasePrefix = join(codexHome, "packages/app-server-daemon/releases") + "/";
  assert.equal(fields[19], identity.startTicks, "private native PID was reused");
  assert.notEqual(fields[0], "Z", "private native daemon is already a zombie");
  if (process.getuid) assert.equal(uid, process.getuid());
  assert.ok(argv[0]?.startsWith(releasePrefix));
  assert.match(argv[0]!.slice(releasePrefix.length), /^[A-Za-z0-9._-]+\/bin\/codex$/);
  assert.deepEqual(argv.slice(1), [
    "app-server", "--listen", "unix://", "--analytics-default-enabled", "--managed-daemon",
  ]);
  return { startTicks: fields[19]!, uid, argv };
}
async function stopOwnedNativeFallback(identity: { pid: number; startTicks: string }) {
  let initial: Awaited<ReturnType<typeof privateNativeIdentity>>;
  try {
    initial = await privateNativeIdentity(identity);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  process.kill(identity.pid, "SIGTERM");
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const current = await privateNativeIdentity(identity);
      if (current.startTicks !== initial.startTicks) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const current = await privateNativeIdentity(identity);
  assert.equal(current.uid, initial.uid);
  assert.deepEqual(current.argv, initial.argv);
  process.kill(identity.pid, "SIGKILL");
  const killDeadline = Date.now() + 2_000;
  while (Date.now() < killDeadline) {
    try {
      const after = await privateNativeIdentity(identity);
      assert.notEqual(after.startTicks, initial.startTicks);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await assert.rejects(readFile(`/proc/${identity.pid}/stat`), { code: "ENOENT" });
}
async function close() {
  return (closing ??= (async () => {
    release();
    historyGate?.release?.();
    const failures: any[] = [];
    let safeToRemove = !nativeRequested;
    let shutdown: "official" | "owned-fallback" | "not-started" = "not-started";
    if (cli && !cliExited) {
      cli.kill();
      const until = Date.now() + 3000;
      while (!cliExited && Date.now() < until)
        await new Promise((r) => setTimeout(r, 20));
      if (!cliExited) cli.kill("SIGKILL");
    }
    for (const socket of frontendSockets) socket.destroy();
    frontend?.closeAllConnections();
    if (frontend?.listening)
      await new Promise<void>((r) => frontend!.close(() => r()));
    await gateway?.close().catch((e: any) => failures.push(e));
    await runtime?.app.close().catch((e: any) => failures.push(e));
    if (nativeRequested) {
      if (!identity)
        try {
          identity = await ownedDaemonIdentity(codexHome);
        } catch (e) {
          failures.push(e);
        }
      if (identity) {
        let officialStopError: unknown;
        try {
          await run(binary, ["app-server", "daemon", "stop"], {
            env,
            timeout: 15000,
            maxBuffer: 65536,
          });
          shutdown = "official";
        } catch (error) {
          officialStopError = error;
        }
        try {
          if (officialStopError) {
            await stopOwnedNativeFallback(identity);
            shutdown = "owned-fallback";
          }
          await cleanupOwnedNativeFixture(identity);
          safeToRemove = true;
        } catch (error) {
          failures.push(error);
          if (officialStopError) failures.push(officialStopError);
        }
      }
    }
    provider.closeAllConnections();
    if (provider.listening)
      await new Promise<void>((r) => provider.close(() => r()));
    if (safeToRemove) await rm(base, { recursive: true, force: true });
    else failures.push(new Error(`Private native fixture retained for safe recovery: ${base}`));
    if (failures.length)
      throw new AggregateError(failures, "Owned M55 cleanup failed");
    return { ownedExited: !!identity && safeToRemove, cliExited: !cli || cliExited, shutdown };
  })());
}
process.once(
  "SIGTERM",
  () =>
    void close().then(
      () => process.exit(0),
      (e) => {
        console.error(e);
        process.exit(1);
      },
    ),
);
try {
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const providerPort = (provider.address() as any).port;
  await writeFile(
    join(codexHome, "config.toml"),
    `model="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[projects.${JSON.stringify(project)}]\ntrust_level="trusted"\n[model_providers.fixture]\nname="Private M55 local provider"\nbase_url="http://127.0.0.1:${providerPort}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,
    { mode: 0o600 },
  );
  runtime = await createRuntime({
    dataHome,
    instance: "m55-private-runtime",
    env,
  });
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  runtime.hub.subscribe({
    filter: (e) => {
      if (e.event === "codex:notification") {
        const n = object(e.payload),
          params = object(n.params),
          turn = object(params.turn);
        if (
          ["thread/started", "turn/started", "turn/completed"].includes(
            String(n.method),
          )
        )
          notifications.push({
            method: n.method,
            threadId: params.threadId ?? object(params.thread).id,
            turnId: turn.id,
            status: turn.status,
          });
      }
      return false;
    },
  });
  nativeRequested = true;
  await runtime.codex.raw("account/read", { refreshToken: false });
  identity = await ownedDaemonIdentity(codexHome);
  const precreatedThreads = scenario === "m55" ? 3 : scenario === "m34" ? 1 : 0;
  for (let i = 0; i < precreatedThreads; i++) {
    const result = object(
      await runtime.codex.raw("thread/start", {
        cwd: project,
        model: "fixture",
        approvalPolicy: "never",
        sandbox: "read-only",
      }),
    );
    const id = String(object(result.thread).id);
    assert.match(id, /^[a-f0-9-]{36}$/);
    threadIds.push(id);
  }
  if (scenario === "m34") {
    const threadId = threadIds[0]!;
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let index = 0; index < 11; index++) {
      const priorCompleted = notifications.filter(
        (event) => event.method === "turn/completed" && event.threadId === threadId,
      ).length;
      await runtime.codex.raw("turn/start", {
        threadId,
        input: [{ type: "text", text: `M34_TURN_${index}`, text_elements: [] }],
      });
      await waitFor(
        () => notifications.filter(
          (event) => event.method === "turn/completed" && event.threadId === threadId,
        ).length > priorCompleted,
        `M34 native fixture turn ${index}`,
      );
    }
  }
  const rawNative = runtime.codex.raw.bind(runtime.codex) as (...args: any[]) => Promise<any>;
  runtime.codex.raw = ((...args: any[]) => {
    nativeMethods.push(String(args[0]));
    return rawNative(...args);
  }) as typeof runtime.codex.raw;
  await mkdir(join(dataHome, "attachments"), { mode: 0o700 });
  gateway = Fastify({
    forceCloseConnections: true,
    bodyLimit: 16 * 1024 * 1024,
  });
  gateway.addHook("preHandler", async (req: any) => {
    if (req.method === "POST" && req.url.startsWith("/api/session/")) {
      const b = object(req.body);
      requests.push({
        path: req.url,
        threadId: b.threadId ?? b.thread_id,
        input: JSON.stringify(b).match(/M55_PAGE_[012]_ONLY_ONCE/g) ?? [],
      });
      if (req.url.startsWith("/api/session/api/codex/thread/turns/list?view=chat"))
        historyRequests.push({
          threadId: b.threadId,
          cursor: b.cursor ?? null,
          limit: b.limit,
          itemsView: b.itemsView,
        });
    }
  });
  gateway.addHook("onSend", async (req: any, reply: any, payload: any) => {
    if (
      req.method === "POST" &&
      req.url.startsWith("/api/session/api/codex/thread/turns/list?") &&
      new URL(req.url, "http://fixture.invalid").searchParams.get("view") === "chat"
    ) {
      const record = (body: any) => historyResponses.push({
        threadId: object(req.body).threadId,
        cursor: object(req.body).cursor ?? null,
        nextCursor: body?.nextCursor ?? null,
        status: reply.statusCode,
        body,
      });
      if (payload && typeof payload.pipe === "function") {
        const chunks: Buffer[] = [];
        const tap = new Transform({
          transform(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback(null, chunk);
          },
          flush(callback) {
            try {
              record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
              callback();
            } catch (error) {
              callback(error as Error);
            }
          },
        });
        payload.pipe(tap);
        return tap;
      }
      record(Buffer.isBuffer(payload)
        ? JSON.parse(payload.toString("utf8"))
        : typeof payload === "string"
          ? JSON.parse(payload)
          : payload);
    }
    return payload;
  });
  registerSessionModeRoutes(gateway, {
    origin: `http://127.0.0.1:${(runtime.app.server.address() as any).port}`,
    attachmentRoot: join(dataHome, "attachments"),
    loadDetailChannel: async () => ({
      registerLocalItemDetailChannel: (app: any, dir: string) =>
        registerLocalItemDetailChannel(app, dir, env),
      registerLocalChatHistoryChannel: (
        app: any,
        dir: string,
        fallback: any,
        current: any,
      ) => registerLocalChatHistoryChannel(app, dir, fallback, current, env),
    }),
  });
  await gateway.listen({ host: "127.0.0.1", port: 0 });
  const gatewayPort = (gateway.server.address() as any).port;
  const cards = threadIds.map((id, i) => ({
    kind: "codex",
    id,
    cwd: project,
    preview: scenario === "m34" ? "M34 native history" : `M55 actual page ${i}`,
  }));
  for (const [url, seed] of [
    ["/api/session/tabs", cards],
    ["/api/session/projects", [project]],
  ] as const) {
    const r = await gateway.inject({
      method: "POST",
      url,
      payload: { clientId: "m55-bootstrap", operations: [], seed },
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((v) => v?.family === "IPv4" && !v.internal)?.address;
  assert.ok(lan);
  const key = join(base, "tls-key.pem"),
    cert = join(base, "tls-cert.pem");
  await run(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=owned-m55-fixture",
      "-addext",
      `subjectAltName=IP:${lan}`,
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { timeout: 15000, maxBuffer: 65536 },
  );
  frontend = createHttpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    async (req, res) => {
      let canceled = false;
      const api = req.url?.startsWith("/api/"),
        target = api
          ? new URL(req.url!, `http://127.0.0.1:${gatewayPort}`)
          : new URL(req.url!, source);
      let bufferedBody: Buffer | undefined;
      if (
        scenario === "m34" &&
        req.method === "POST" &&
        target.pathname === "/api/session/api/codex/thread/turns/list" &&
        target.searchParams.get("view") === "chat" &&
        historyGate
      ) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        bufferedBody = Buffer.concat(chunks);
        const params = JSON.parse(bufferedBody.toString());
        const gate = historyGate;
        if (params.threadId === gate.threadId && params.cursor === gate.cursor) {
          gate.entered = true;
          const cancel = () => {
            if (res.writableEnded || gate.cancelled) return;
            gate.cancelled = true;
            gate.release?.();
          };
          req.once("aborted", cancel);
          res.once("close", cancel);
          await new Promise<void>((resolve) => { gate.release = resolve; });
          req.off("aborted", cancel);
          res.off("close", cancel);
          historyGate = undefined;
          if (gate.cancelled || res.destroyed) return;
        }
      }
      const request = target.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = request(
        target,
        {
          method: req.method,
          headers: { ...req.headers, host: target.host },
          ...(target.protocol === "https:"
            ? { rejectUnauthorized: false }
            : {}),
        },
        (response) => {
          const h = { ...response.headers };
          delete h.connection;
          res.writeHead(response.statusCode ?? 502, h);
          response.pipe(res);
        },
      );
      upstream.on("error", (e) => {
        if (canceled) proxyCanceled.push({ url: req.url, error: String(e) });
        else errors.push(`${req.url}: ${String(e)}`);
        if (!res.headersSent && !res.destroyed) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => {
        canceled = true;
        upstream.destroy();
      });
      res.on("close", () => {
        if (!res.writableEnded) canceled = true;
        upstream.destroy();
      });
      if (bufferedBody) upstream.end(bufferedBody);
      else req.pipe(upstream);
    },
  );
  frontend.on("connection", (socket) => {
    frontendSockets.add(socket);
    socket.once("close", () => frontendSockets.delete(socket));
  });
  frontend.on("upgrade", (req, socket, head) => {
    const target = new URL(req.url!, source),
      request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = request(target, {
      method: req.method,
      headers: { ...req.headers, host: target.host },
      ...(target.protocol === "https:" ? { rejectUnauthorized: false } : {}),
    });
    upstream.once("upgrade", (response, remote, remoteHead) => {
      socket.write(
        `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`,
      );
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value))
          for (const entry of value) socket.write(`${name}: ${entry}\r\n`);
        else if (value !== undefined) socket.write(`${name}: ${value}\r\n`);
      }
      socket.write("\r\n");
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
      socket.once("close", () => remote.destroy());
      remote.once("error", () => socket.destroy());
    });
    upstream.once("error", () => socket.destroy());
    socket.once("error", () => upstream.destroy());
    upstream.end();
  });
  await new Promise<void>((r) => frontend!.listen(0, "0.0.0.0", r));
  send({
    kind: "ready",
    origin: `https://${lan}:${(frontend.address() as any).port}`,
    scenario,
    threadIds,
    project,
    cards,
    officialVersion: "0.163.0",
    identity,
  });
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    void (async () => {
      const q = JSON.parse(line);
      let value: any;
      if (q.method === "metrics") {
        value = {
          at: new Date().toISOString(),
          hostLoad: loadavg(),
          calls,
          errors,
          proxyCanceled,
          requests,
          historyRequests,
          historyResponses,
          nativeMethods,
          notifications,
          cli: { exited: cliExited, tail: cliTail },
          identity,
          threads: await Promise.all(
            threadIds.map(async (threadId) => ({
              threadId,
              history: await runtime!.codex
                .raw("thread/turns/list", { threadId, limit: 5 })
                .catch((e) => ({ readError: String(e) })),
              queue: await runtime!.codex
                .raw("thread/queue/list", { threadId, limit: 10 })
                .catch((e) => ({ readError: String(e) })),
              metadata: await runtime!.codex
                .raw("thread/read", { threadId, includeTurns: false })
                .catch((e) => ({ readError: String(e) })),
            })),
          ),
        };
      } else if (q.method === "release") {
        release();
        value = true;
      } else if (q.method === "armHistoryGate") {
        assert.equal(scenario, "m34");
        assert.equal(typeof q.threadId, "string");
        assert.equal(typeof q.cursor, "string");
        assert.ok(q.cursor.length > 0);
        historyGate = {
          threadId: q.threadId,
          cursor: q.cursor,
          entered: false,
          cancelled: false,
        };
        lastHistoryGate = historyGate;
        value = { armed: true };
      } else if (q.method === "historyGate") {
        value = lastHistoryGate
          ? {
              threadId: lastHistoryGate.threadId,
              cursor: lastHistoryGate.cursor,
              entered: lastHistoryGate.entered,
              cancelled: lastHistoryGate.cancelled,
            }
          : null;
      } else if (q.method === "historyRequests") {
        value = historyRequests;
      } else if (q.method === "historyResponses") {
        value = historyResponses;
      } else if (q.method === "nativeMethods") {
        value = nativeMethods;
      } else if (q.method === "resetNativeMethods") {
        nativeMethods.length = 0;
        value = true;
      } else if (q.method === "historyProof") {
        assert.equal(scenario, "m34");
        const threadId = String(q.threadId);
        assert.ok(threadIds.includes(threadId));
        const result = object(
          await runtime!.codex.raw("thread/turns/list", {
            threadId,
            limit: 20,
            sortDirection: "asc",
            itemsView: "full",
          }),
        );
        const turns = Array.isArray(result.data) ? result.data as any[] : [];
        const tool = turns
          .flatMap((turn) => turn.items ?? [])
          .find((item) => item?.type === "commandExecution");
        const output = typeof tool?.aggregatedOutput === "string" ? tool.aggregatedOutput : "";
        value = {
          turnCount: turns.length,
          nextCursor: result.nextCursor ?? null,
          toolBodyBytes: Buffer.byteLength(output),
          toolStartMarker: output.includes("M34_TOOL_BODY_BEGIN"),
          toolEndMarker: output.includes("M34_TOOL_BODY_END"),
        };
      } else if (q.method === "threadState") {
        const threadId = String(q.threadId);
        assert.ok(/^[a-f0-9-]{36}$/.test(threadId));
        const [metadataValue, turnsValue] = await Promise.all([
          runtime!.codex.raw("thread/read", { threadId, includeTurns: false }),
          runtime!.codex.raw("thread/turns/list", {
            threadId,
            limit: 1,
            sortDirection: "desc",
            itemsView: "notLoaded",
          }),
        ]);
        const thread = object(object(metadataValue).thread);
        const latest = object(object(turnsValue).data && (object(turnsValue).data as any[])[0]);
        value = {
          threadId,
          name: typeof thread.name === "string" ? thread.name : null,
          cwd: thread.cwd ?? null,
          model: thread.model ?? null,
          latestTurn: { id: latest.id ?? null, status: latest.status ?? null },
        };
      } else if (q.method === "cli") {
        assert.ok(!cli);
        const id = threadIds[0]!;
        cli = pty.spawn(
          binary,
          [
            "--remote",
            `unix://${join(codexHome, "app-server-control", "app-server-control.sock")}`,
            "resume",
            id,
            "--no-alt-screen",
          ],
          {
            env: env as Record<string, string>,
            cwd: project,
            cols: 120,
            rows: 40,
          },
        );
        cli.onExit(() => (cliExited = true));
        cli.onData((data: string) => {
          cliTail = (cliTail + data).slice(-24000);
          if (data.includes("\x1b[6n")) cli.write("\x1b[1;1R");
          if (data.includes("\x1b[c")) cli.write("\x1b[?1;2c");
        });
        value = {
          threadId: id,
          remote: join(
            codexHome,
            "app-server-control",
            "app-server-control.sock",
          ),
          pid: cli.pid,
        };
      } else if (q.method === "close") {
        value = await close();
        send({ id: q.id, value });
        lines.close();
        process.stdin.destroy();
        return;
      } else throw new Error("Unknown M55 fixture operation");
      send({ id: q.id, value });
    })().catch((e) => {
      console.error(e);
      send({ id: JSON.parse(line).id, error: String(e) });
    });
  });
  lines.once("close", () => void close());
} catch (e) {
  console.error(e);
  await close();
  process.exitCode = 1;
}
