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

test("a trusted native completion card reply starts the original session once and remains bound after restart", async () => {
  const { FeishuReplyBindingStore } =
    await import("../services/feishu-reply-binding-store.js");
  const { FeishuReplyCommandService } =
    await import("../services/feishu-reply-command-service.js");
  const root = await mkdtemp(join(tmpdir(), "kanban-native-reply-"));
  const streams = new Set<ServerResponse>();
  const starts: any[] = [];
  const notices: any[] = [];
  const turns: any[] = [];
  let status = "idle";
  let sequence = 0;
  const runtime = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/health")
      return void response.end(JSON.stringify({ instance: "reply-runtime" }));
    if (url.pathname === "/api/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": ready\n\n");
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const thread = {
      id: "native-thread",
      name: "原会话",
      cwd: root,
      status: { type: status },
      turns,
    };
    if (
      ["/api/codex/thread/metadata", "/api/codex/thread/read"].includes(
        url.pathname,
      )
    )
      response.end(JSON.stringify({ thread }));
    else if (url.pathname === "/api/codex/thread/turns/list")
      response.end(
        JSON.stringify({ data: [...turns].reverse(), nextCursor: null }),
      );
    else if (url.pathname === "/api/codex/thread/list")
      response.end(JSON.stringify({ data: [thread], nextCursor: null }));
    else if (url.pathname === "/api/internal/codex/queue-holds")
      response.end("{}");
    else if (url.pathname === "/api/codex/turn/start") {
      starts.push(body);
      status = "active";
      response.end(
        JSON.stringify({ turn: { id: `reply-turn-${starts.length}` } }),
      );
    } else response.writeHead(404).end();
  });
  await new Promise<void>((r) => runtime.listen(0, "127.0.0.1", r));
  const address = runtime.address();
  assert.ok(address && typeof address !== "string");
  const settings = {
    get: () => ({
      configured: true,
      enabled: true,
      destinationType: "user" as const,
      replyConfigured: true,
      replyEnabled: true,
    }),
  };
  const build = () => {
    const bindings = new FeishuReplyBindingStore({
      statePath: join(root, "bindings.json"),
    });
    const app = Fastify();
    const native = registerSessionModeRoutes(app, {
      origin: `http://127.0.0.1:${address.port}`,
      attachmentRoot: join(root, "uploads"),
      completionNotifications: {
        settings,
        bindings,
        sender: {
          send: async (event) => {
            notices.push(event);
            return {
              messages: [
                {
                  messageId: `om_notice${notices.length}`,
                  chatId: "oc_private",
                },
              ],
            };
          },
        },
      },
    });
    const service = new FeishuReplyCommandService({
      allowedUserId: "ou_owner",
      settings,
      bindings,
      sessionMode: native,
      registry: {
        get: () => {
          throw new Error("native replies must not access terminal registry");
        },
      },
      images: {
        download: async () => {
          throw new Error("not an image test");
        },
      },
      codex: {
        resolveSessionId: async () => undefined,
        sendText: async () => {
          assert.fail("terminal path");
        },
        sendImage: async () => {
          assert.fail("terminal path");
        },
      },
    });
    return { app, service, bindings };
  };
  let fixture = build();
  const event = {
    type: "im.message.receive_v1",
    message_id: "om_reply1",
    reply_to: "om_notice1",
    root_id: "om_notice1",
    chat_id: "oc_private",
    chat_type: "p2p",
    sender_id: "ou_owner",
    sender_type: "user",
    message_type: "text",
    content: "继续下一项任务",
  };
  try {
    await fixture.app.ready();
    await until(() => streams.size === 1);
    const turn = {
      id: "completed-turn",
      status: "completed",
      items: [
        { type: "agentMessage", phase: "final_answer", text: "上一轮完成" },
      ],
    };
    turns.push(turn);
    for (const stream of streams)
      stream.write(
        `data: ${JSON.stringify({ seq: ++sequence, event: "codex:notification", payload: { method: "turn/completed", params: { threadId: "native-thread", turn } } })}\n\n`,
      );
    await until(() => fixture.bindings.resolve("om_notice1") !== null);
    assert.equal(
      await fixture.service.handle({ ...event, sender_id: "ou_stranger" }),
      "ignored_untrusted",
    );
    assert.equal(await fixture.service.handle(event), "delivered");
    await until(() => starts.length === 1);
    assert.equal(starts[0].threadId, "native-thread");
    assert.equal(starts[0].clientUserMessageId, "feishu:om_reply1");
    assert.equal(starts[0].input[0].text, "继续下一项任务");
    assert.equal(await fixture.service.handle(event), "ignored_duplicate");
    // Active native turn keeps follow-on input durable without interruption.
    assert.equal(
      await fixture.service.handle({
        ...event,
        message_id: "om_reply2",
        reply_to: "om_reply1",
        content: "再处理下一项",
      }),
      "delivered",
    );
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(starts.length, 1);
    const queued = (
      await fixture.app.inject({
        url: "/api/session/followups?threadId=native-thread",
      })
    ).json();
    assert.equal(
      queued.items.find((item: any) => item.id === "feishu:om_reply2").status,
      "queued",
    );
    await fixture.app.close();
    fixture = build();
    await fixture.app.ready();
    assert.equal(await fixture.service.handle(event), "ignored_duplicate");
    assert.equal(
      fixture.bindings.resolve("om_reply2")?.sessionModeThreadId,
      "native-thread",
    );
    assert.equal(starts.length, 1);
  } finally {
    await fixture.app.close();
    for (const stream of streams) stream.end();
    runtime.closeAllConnections();
    await new Promise<void>((r) => runtime.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
