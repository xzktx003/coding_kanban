import assert from "node:assert/strict";
import { test } from "node:test";
import { object, type Json } from "../core/json.js";
import { Ownership, type Rpc } from "./ownership.js";

function sharedFixture() {
  const writes: Array<{ method: string; params: Json }> = [];
  let loaded = false;
  const raw: Rpc = async (method, params, options): Promise<Json> => {
    if (method === "thread/read")
      return {
        thread: {
          id: "t",
          source: "cli",
          status: { type: "idle" },
          canAcceptDirectInput: true,
        },
      };
    if (method === "thread/loaded/list")
      return { data: loaded ? ["t"] : [], nextCursor: null };
    options?.beforeSend?.();
    writes.push({ method, params });
    if (method === "thread/resume") {
      loaded = true;
      return { thread: { id: "t" } };
    }
    if (method === "turn/start")
      return { turn: { id: "u", status: "inProgress" } };
    return {};
  };
  return { writes, owner: new Ownership(raw, { sharedDaemon: true }) };
}

test("shared metadata and lifecycle mutations never implicitly resume a cold native queue", async () => {
  for (const method of [
    "thread/settings/update",
    "thread/name/set",
    "thread/archive",
    "thread/delete",
    "turn/interrupt",
    "thread/goal/clear",
  ]) {
    const { owner, writes } = sharedFixture();
    await owner.call(method, {
      threadId: "t",
      turnId: "u",
      model: "captured-model",
    });
    assert.deepEqual(
      writes.map((write) => write.method),
      [method],
      method,
    );
  }
});

test("explicit cold execution acquires without history or shared feature overrides and guards both writes", async () => {
  const { owner, writes } = sharedFixture();
  let guards = 0;
  const response = object(
    await owner.call(
      "turn/start",
      { threadId: "t", input: [] },
      {
        beforeSend: () => {
          guards++;
        },
      },
    ),
  );
  assert.equal(object(response.turn).id, "u");
  assert.deepEqual(writes, [
    { method: "thread/resume", params: { threadId: "t", excludeTurns: true } },
    { method: "turn/start", params: { threadId: "t", input: [] } },
  ]);
  assert.equal(guards, 2);
});

test("a scope revoked after explicit acquire prevents the subsequent turn from being written", async () => {
  const { owner, writes } = sharedFixture();
  let guards = 0;
  await assert.rejects(
    owner.call(
      "turn/start",
      { threadId: "t", input: [] },
      {
        beforeSend: () => {
          if (++guards === 2) throw new Error("NOT_SENT: scope revoked");
        },
      },
    ),
    /NOT_SENT: scope revoked/,
  );
  assert.deepEqual(
    writes.map((write) => write.method),
    ["thread/resume"],
  );
});

test("a rejected cold-acquire dispatch keeps its definite NOT_SENT result and does not poison access", async () => {
  const { owner, writes } = sharedFixture();
  await assert.rejects(
    owner.call(
      "turn/start",
      { threadId: "t", input: [] },
      {
        beforeSend: () => {
          throw new Error("NOT_SENT: scope revoked before acquire");
        },
      },
    ),
    /^Error: NOT_SENT: scope revoked before acquire$/,
  );
  assert.deepEqual(writes, []);
  assert.equal((await owner.access("t")).state, "readonly");
});
