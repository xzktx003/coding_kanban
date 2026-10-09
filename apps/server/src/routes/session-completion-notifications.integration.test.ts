import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerSessionModeRoutes } from "./session-mode.js";

const until = async (check: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("notification condition did not converge");
};

test("session Codex completion sends from the backend without a browser and resumes its durable cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-session-notify-"));
  const streams = new Set<ServerResponse>();
  const frames: Array<{ seq: number; event: string; payload: any }> = [];
  const reads: any[] = [],
    sent: any[] = [],
    cursors: Array<string | null> = [];
  let seq = 0;
  const turns: any[] = [];
  const emit = (turn: any) => {
    turns.push(turn);
    const frame = {
      seq: ++seq,
      event: "codex:notification",
      payload: {
        method: "turn/completed",
        params: { threadId: "native-thread", turn },
      },
    };
    frames.push(frame);
    for (const stream of streams)
      stream.write(`data: ${JSON.stringify(frame)}\n\n`);
  };
  // First launch must not replay historical completed turns.
  emit({
    id: "old",
    status: "completed",
    items: [
      { type: "agentMessage", text: "old output", phase: "final_answer" },
    ],
  });
  const runtime = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/health")
      return void response.end(JSON.stringify({ instance: "native-instance" }));
    if (url.pathname === "/api/events") {
      const since = url.searchParams.get("since");
      cursors.push(since);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": ready\n\n");
      if (since !== null)
        for (const frame of frames.filter((f) => f.seq > Number(since)))
          response.write(`data: ${JSON.stringify(frame)}\n\n`);
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/api/codex/thread/metadata") {
      reads.push(body);
      response.end(
        JSON.stringify({
          thread: {
            id: "native-thread",
            name: "会话任务",
            cwd: root,
            source: "appServer",
            parentThreadId: null,
            turns,
          },
        }),
      );
    } else if (url.pathname === "/api/codex/thread/turns/list") {
      reads.push(body);
      response.end(
        JSON.stringify({ data: [...turns].reverse(), nextCursor: null }),
      );
    } else if (url.pathname === "/api/codex/thread/list") {
      response.end(JSON.stringify({ data: [], nextCursor: null }));
    } else if (url.pathname === "/api/internal/codex/queue-holds")
      response.end("{}");
    else response.writeHead(404).end();
  });
  await new Promise<void>((r) => runtime.listen(0, "127.0.0.1", r));
  const address = runtime.address();
  assert.ok(address && typeof address !== "string");
  const build = () => {
    const app = Fastify();
    registerSessionModeRoutes(app, {
      origin: `http://127.0.0.1:${address.port}`,
      attachmentRoot: join(root, "uploads"),
      completionNotifications: {
        settings: { get: () => ({ configured: true, enabled: true }) },
        sender: {
          send: async (event) => {
            sent.push(event);
          },
        },
      },
    });
    return app;
  };
  let app = build();
  try {
    await app.ready();
    await until(() => streams.size === 1);
    assert.equal(sent.length, 0);
    emit({
      id: "one",
      status: "completed",
      items: [
        { type: "agentMessage", text: "第一轮完成", phase: "final_answer" },
      ],
    });
    await until(() => sent.length === 1);
    assert.equal(sent[0].summary, "第一轮完成");
    assert.equal(sent[0].completionId, "one");
    assert.equal(
      sent[0].codexThreadId,
      undefined,
      "terminal-only action buttons must not appear",
    );
    await app.close();
    await until(() => streams.size === 0);
    emit({
      id: "two",
      status: "completed",
      items: [
        { type: "agentMessage", text: "第二轮完成", phase: "final_answer" },
      ],
    });
    app = build();
    await app.ready();
    await until(() => sent.length === 2);
    assert.equal(sent[1].completionId, "two");
    assert.equal(cursors.at(-1), "2");
    emit({ id: "two", status: "completed", items: [] });
    emit({ id: "stopped", status: "interrupted", items: [] });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 2);
    assert.ok(reads.every((body) => body.threadId === "native-thread"));
  } finally {
    await app.close();
    for (const stream of streams) stream.end();
    runtime.closeAllConnections();
    await new Promise<void>((r) => runtime.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
