import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { registerSessionFollowupRoutes } from "./session-followups.js";

test("empty native queue resume is rejected before dispatch, while a later explicit resume can start work", async () => {
  const root = await mkdtemp(join(tmpdir(), "kanban-empty-queue-http-"));
  const app = Fastify();
  const rows: any[] = [];
  const writes: Array<{ method: string; threadId: unknown }> = [];
  try {
    registerSessionFollowupRoutes(app, {
      file: join(root, "queue.json"),
      nativeQueue: true,
      origin: () => null,
      autoStart: false,
      runtime: {
        context: async () => ({ scope: "scope-a", namespace: "namespace-a" }),
        statuses: async () => ({ thread: "idle" }),
        async call(method) {
          if (method === "thread/queue/list")
            return { data: rows, nextCursor: null };
          throw new Error(`Unexpected read ${method}`);
        },
        async guardedCall(method, params, scope) {
          assert.equal(scope, "scope-a");
          writes.push({ method, threadId: params.threadId });
          return {};
        },
      },
    });
    const read = () =>
      app.inject({ url: "/api/session/followups?threadId=thread" });
    let before = await read();
    assert.equal(before.statusCode, 200);
    const change = (revision: number, operationId: string) =>
      app.inject({
        method: "POST",
        url: "/api/session/followups/change",
        payload: {
          threadId: "thread",
          revision,
          operationId,
          expectedScope: "scope-a",
          action: { type: "resume" },
        },
      });
    const empty = await change(before.json().revision, "empty-attempt");
    assert.equal(empty.statusCode, 409);
    assert.match(empty.json().message, /没有待发送的原生消息/);
    assert.deepEqual(writes, []);

    rows.push({
      id: "item-1",
      clientUserMessageId: "message-1",
      input: [{ type: "text", text: "你好", text_elements: [] }],
    });
    before = await read();
    assert.equal(before.statusCode, 200);
    const accepted = await change(before.json().revision, "explicit-retry");
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().operation.status, "accepted");
    assert.deepEqual(writes, [
      { method: "thread/queue/start", threadId: "thread" },
    ]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
