import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerChatHistoryChannel } from "@agent-orchestrator/session-runtime/item-detail";
import { registerSessionModeRoutes } from "./session-mode.js";

test("chat history bypasses an unavailable Agent transport while raw requests preserve their upstream semantics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gateway-chat-history-"));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const calls: string[] = [];
  const historyCalls = () =>
    calls.filter((url) => url.includes("/api/codex/thread/turns/list"));
  const source = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.method==='initialize')console.log(JSON.stringify({id:q.id,result:{}}));else if(q.method==='thread/turns/list')console.log(JSON.stringify({id:q.id,result:{data:[],nextCursor:'preserved'}}));else if(q.method!=='initialized')process.exit(99);}).on('close',()=>process.exit(0));`;
  registerSessionModeRoutes(app, {
    origin: "http://127.0.0.1:12345",
    attachmentRoot: join(root, "uploads"),
    loadDetailChannel: async () => ({
      registerLocalItemDetailChannel: () => {},
      registerLocalChatHistoryChannel: (scope, _data, fallback) =>
        registerChatHistoryChannel(
          scope,
          { launch: { command: process.execPath, args: ["-e", source] } },
          "/api/session/api/codex/thread/turns/list",
          fallback,
        ),
    }),
    fetch: async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ error: "NOT_SENT: RPC transport unavailable" }),
        {
          status: 500,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    },
  });
  const body = { threadId: "thread", limit: 10, itemsView: "full" };
  const chat = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=chat",
    payload: body,
  });
  assert.equal(chat.statusCode, 200, chat.body);
  assert.equal(chat.json().nextCursor, "preserved");
  assert.deepEqual(historyCalls(), []);
  const raw = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=full",
    payload: body,
  });
  assert.equal(raw.statusCode, 500);
  assert.match(raw.body, /RPC transport unavailable/);
  assert.deepEqual(historyCalls(), [
    "http://127.0.0.1:12345/api/codex/thread/turns/list?view=full",
  ]);
});

test(
  "gateway prioritizes visible history with bounded background fairness and rejects unknown priority",
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "gateway-chat-priority-"));
    const app = Fastify();
    t.after(async () => {
      await app.close();
      await rm(root, { recursive: true, force: true });
    });
    const started: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.method==='initialize')console.log(JSON.stringify({id:q.id,result:{}}));else if(q.method==='thread/turns/list'){if(q.params.priority||q.params.readPriority)process.exit(98);console.log(JSON.stringify({id:q.id,result:{data:[],nextCursor:q.params.threadId}}));}else if(q.method!=='initialized')process.exit(99);}).on('close',()=>process.exit(0));`;
    registerSessionModeRoutes(app, {
      origin: "http://127.0.0.1:1",
      attachmentRoot: join(root, "uploads"),
      loadDetailChannel: async () => ({
        registerLocalItemDetailChannel: () => {},
        registerLocalChatHistoryChannel: (scope, _data, fallback) =>
          registerChatHistoryChannel(
            scope,
            { launch: { command: process.execPath, args: ["-e", source] } },
            "/api/session/api/codex/thread/turns/list",
            fallback,
            async (id) => {
              started.push(id);
              if (id === "held") await held;
              return null;
            },
          ),
      }),
      fetch: async () => new Response("{}"),
    });
    let admitted = 0;
    app.addHook("preHandler", async () => {
      admitted++;
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${app.listeningOrigin}/api/session/api/codex/thread/turns/list?view=chat`;
    const send = async (id: string, priority: string) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-read-priority": priority,
        },
        body: JSON.stringify({ threadId: id }),
      });
      return {
        status: response.status,
        body: (await response.json()) as { nextCursor: string },
      };
    };
    const first = send("held", "background");
    while (!started.length)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const queued: Array<ReturnType<typeof send>> = [];
    for (const [id, priority] of [
      ["b0", "background"],
      ["b1", "background"],
      ...Array.from({ length: 5 }, (_, i) => [`i${i}`, "interactive"]),
    ]) {
      queued.push(send(id!, priority!));
    }
    while (admitted < 8) await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    const results = await Promise.all([first, ...queued]);
    assert.equal(admitted, 8);
    assert.ok(results.every((result) => result.status === 200));
    assert.deepEqual(started, [
      "held",
      "i0",
      "i1",
      "i2",
      "b0",
      "i3",
      "i4",
      "b1",
    ]);
    const before = started.length;
    assert.equal((await send("invalid", "urgent")).status, 400);
    assert.equal(started.length, before);
  },
);
