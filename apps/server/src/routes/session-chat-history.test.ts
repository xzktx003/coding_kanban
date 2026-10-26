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
  assert.deepEqual(calls, []);
  const raw = await app.inject({
    method: "POST",
    url: "/api/session/api/codex/thread/turns/list?view=full",
    payload: body,
  });
  assert.equal(raw.statusCode, 500);
  assert.match(raw.body, /RPC transport unavailable/);
  assert.deepEqual(calls, [
    "http://127.0.0.1:12345/api/codex/thread/turns/list?view=full",
  ]);
});
