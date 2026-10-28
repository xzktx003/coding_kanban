import assert from "node:assert/strict";
import test from "node:test";
import { emptyFollowupThread } from "@agent-orchestrator/shared";
import { createSessionCodexCompletionCheck } from "./session-codex-completion-check.js";

function fixture() {
  let queue = emptyFollowupThread();
  const state: any = {
    thread: { id: "thread-one", status: { type: "idle" } },
    latest: {
      data: [{ id: "turn-one", status: "completed" }],
      nextCursor: null,
    },
    goal: { goal: null },
    fresh: undefined,
    queueAfter: undefined,
    failure: undefined,
  };
  const calls: Array<{ path: string; body: any }> = [];
  let queueReads = 0,
    metadataReads = 0;
  const check = createSessionCodexCompletionCheck({
    origin: () => "http://127.0.0.1:1234",
    queue: async () =>
      ++queueReads === 1 || !state.queueAfter ? queue : state.queueAfter,
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname.replace(
        "/api/codex/thread/",
        "",
      );
      calls.push({ path, body: JSON.parse(String(init?.body)) });
      if (state.failure === path)
        return new Response("unavailable", { status: 503 });
      const data =
        path === "metadata"
          ? {
              thread:
                ++metadataReads > 1 && state.fresh ? state.fresh : state.thread,
            }
          : path === "turns/list"
            ? state.latest
            : state.goal;
      return Response.json(data);
    },
  });
  return {
    state,
    queue,
    calls,
    check: () => check({ threadId: "thread-one", turnId: "turn-one" }),
  };
}

test("completion check only reads idle latest completed turn, goal and queue metadata", async () => {
  const f = fixture();
  assert.equal(await f.check(), "ready");
  assert.deepEqual(
    f.calls.map((c) => c.path),
    ["metadata", "turns/list", "goal/get", "metadata"],
  );
  assert.deepEqual(f.calls[1].body, {
    threadId: "thread-one",
    limit: 1,
    sortDirection: "desc",
    itemsView: "notLoaded",
  });
});

test("old retries are superseded even when the newer task or queue is active", async () => {
  const f = fixture();
  f.state.thread.status.type = "active";
  f.queue.awaitingTurnId = "turn-two";
  f.state.latest.data = [{ id: "turn-two", status: "inProgress" }];
  assert.equal(await f.check(), "superseded");
  assert.equal(
    f.calls.some((c) => c.path === "goal/get"),
    false,
  );
});

for (const type of ["active", "systemError", "notLoaded", undefined]) {
  test(`completion waits for authoritative idle, not ${type}`, async () => {
    const f = fixture();
    f.state.thread.status = type ? { type } : undefined;
    assert.equal(await f.check(), "wait");
  });
}
for (const itemStatus of ["queued", "sending", "uncertain", "failed"]) {
  test(`completion waits for ${itemStatus} followup, even when paused`, async () => {
    const f = fixture();
    f.queue.paused = "manual";
    f.queue.items.push({ status: itemStatus } as any);
    assert.equal(await f.check(), "wait");
  });
}
for (const field of [
  "awaitingTurnId",
  "stopTurnId",
  "replacementId",
  "review",
]) {
  test(`completion waits for queue ${field}`, async () => {
    const f = fixture();
    (f.queue as any)[field] =
      field === "review" ? { status: "inProgress" } : "turn-one";
    assert.equal(await f.check(), "wait");
  });
}
test("empty paused queue and explicitly completed Goal allow completion", async () => {
  const f = fixture();
  f.queue.paused = "manual";
  f.state.goal = { goal: { threadId: "thread-one", status: "complete" } };
  assert.equal(await f.check(), "ready");
});
for (const goalStatus of [
  "active",
  "paused",
  "blocked",
  "budgetLimited",
  "unknown",
]) {
  test(`unfinished Goal ${goalStatus} cannot announce task complete`, async () => {
    const f = fixture();
    f.state.goal.goal = { status: goalStatus };
    assert.equal(await f.check(), "wait");
  });
}
test("metadata and queue are rechecked after asynchronous reads", async () => {
  const f = fixture();
  f.state.fresh = { id: "thread-one", status: { type: "active" } };
  assert.equal(await f.check(), "wait");
  const g = fixture();
  g.state.queueAfter = { ...g.queue, revision: 1 };
  assert.equal(await g.check(), "wait");
});
test("malformed or mismatched responses never enable completion", async () => {
  for (const patch of [
    { thread: { id: "other", status: { type: "idle" } } },
    { latest: { data: [] } },
    { latest: {} },
    { latest: { data: [{ id: "", status: "completed" }] } },
    { latest: { data: [{ id: "turn-one", status: "inProgress" }] } },
    { goal: {} },
    { goal: { goal: { threadId: "other", status: "complete" } } },
    { goal: { goal: { status: "complete" } } },
    { goal: null },
  ]) {
    const f = fixture();
    Object.assign(f.state, patch);
    assert.equal(await f.check(), "wait");
  }
});
test("metadata-only history failure stays unknown instead of fetching full tool bodies", async () => {
  const f = fixture();
  f.state.failure = "turns/list";
  await assert.rejects(f.check(), /核对/);
  assert.equal(f.calls.filter((c) => c.path === "turns/list").length, 1);
});

import { createSessionThreadLookup } from "./session-codex-completion-check.js";

test("only current runtime loaded threads suppress the terminal notification source", async () => {
  let cursor: string | null = null;
  const lookup = createSessionThreadLookup({
    origin: () => "http://127.0.0.1:1234",
    fetch: async (url, init) => {
      assert.equal(
        new URL(String(url)).pathname,
        "/api/codex/thread/loaded/list",
      );
      const body = JSON.parse(String(init?.body));
      cursor = body.cursor;
      return Response.json(
        cursor === null
          ? { data: ["other"], nextCursor: "page-two" }
          : { data: ["session-thread"], nextCursor: null },
      );
    },
  });
  assert.equal(await lookup("session-thread"), true);
  assert.equal(await lookup("terminal-thread"), false);
  assert.equal(cursor, "page-two");
});
test("disabled session runtime leaves terminal notifications alone without network access", async () => {
  const lookup = createSessionThreadLookup({
    origin: () => undefined,
    fetch: async () => {
      throw new Error("unexpected request");
    },
  });
  assert.equal(await lookup("terminal"), false);
});
test("unknown session ownership does not silently fall back to terminal delivery", async () => {
  for (const data of [
    null,
    {},
    { data: [null] },
    { data: [], nextCursor: "loop" },
  ]) {
    let reads = 0;
    const lookup = createSessionThreadLookup({
      origin: () => "http://127.0.0.1:1234",
      fetch: async () => {
        reads++;
        return Response.json(data);
      },
    });
    await assert.rejects(lookup("thread"), /归属/);
    assert.ok(reads <= 2);
  }
});
