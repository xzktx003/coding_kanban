import assert from "node:assert/strict";
import test from "node:test";
import { Ownership, type Rpc } from "./ownership.js";
import { object, type Json } from "../core/json.js";

const emptyRollout =
  "failed to read thread: thread-store internal error: failed to read session metadata /private/rollout.jsonl: rollout at /private/rollout.jsonl is empty";

async function fixture(created = true) {
  let now = 0,
    remaining = 0,
    metadataError = emptyRollout;
  let onPause: (() => void | Promise<void>) | undefined;
  const calls: string[] = [];
  const raw: Rpc = async (method, params): Promise<Json> => {
    calls.push(method);
    if (method === "thread/start") return { thread: { id: "t" } };
    if (method === "thread/read") {
      if (remaining > 0) {
        remaining--;
        throw new Error(metadataError);
      }
      return { thread: { id: "t", source: "cli", status: { type: "active" } } };
    }
    if (method === "thread/loaded/list")
      return { data: ["t"], nextCursor: null };
    if (method === "turn/start") return { turn: { id: "first" } };
    if (method === "thread/goal/set") return { goal: object(params) };
    if (method === "thread/resume" || method === "turn/interrupt") return {};
    throw new Error("Unexpected " + method);
  };
  const owner = new Ownership(raw, {
    now: () => now,
    pause: async (delay) => {
      now += delay;
      await onPause?.();
    },
    goalMetadataWaitMs: 300,
  });
  if (created) await owner.call("thread/start", {});
  await owner.call("turn/start", { threadId: "t" });
  calls.length = 0;
  return {
    owner,
    calls,
    fail: (count: number, error = emptyRollout) => {
      remaining = count;
      metadataError = error;
    },
    onPause: (callback: typeof onPause) => {
      onPause = callback;
    },
  };
}

test("new Goal waits through exactly known empty rollout metadata after first turn ACK and sends set once", async () => {
  const f = await fixture();
  f.fail(2);
  await f.owner.call("thread/goal/set", {
    threadId: "t",
    objective: "new goal",
    status: "active",
  });
  assert.equal(f.calls.filter((method) => method === "thread/read").length, 4);
  assert.equal(
    f.calls.filter((method) => method === "thread/goal/set").length,
    1,
  );
  assert.ok(
    !f.calls.includes("turn/start") && !f.calls.includes("thread/resume"),
  );
});

test("empty rollout preflight is bounded and never sends the goal write on timeout", async () => {
  const f = await fixture();
  f.fail(100);
  await assert.rejects(
    f.owner.call("thread/goal/set", { threadId: "t", status: "active" }),
    /SESSION_ACQUIRE_FAILED.*尚未发送/,
  );
  assert.equal(
    f.calls.filter((method) => method === "thread/goal/set").length,
    0,
  );
  assert.ok(f.calls.length <= 5);
});

test("other metadata errors, established threads, and unacknowledged first turns do not get the rollout retry", async () => {
  for (const condition of [
    "otherError",
    "wrongPath",
    "established",
    "noFirstAck",
  ] as const) {
    const f = await fixture(condition !== "established");
    if (condition === "noFirstAck") await f.owner.call("thread/start", {});
    f.fail(
      100,
      condition === "otherError"
        ? "permission denied"
        : condition === "wrongPath"
          ? emptyRollout.replace(
              "rollout at /private/",
              "rollout at /different/",
            )
          : emptyRollout,
    );
    await assert.rejects(
      f.owner.call("thread/goal/set", { threadId: "t", status: "active" }),
      /SESSION_ACQUIRE_FAILED/,
    );
    assert.deepEqual(
      f.calls.filter((method) => method !== "thread/start"),
      ["thread/read"],
      condition,
    );
  }
});

test("runtime epoch or writer generation change while waiting prevents another read or any goal write", async () => {
  for (const change of ["epoch", "generation"] as const) {
    const f = await fixture();
    f.fail(100);
    let pauses = 0;
    f.onPause(async () => {
      pauses++;
      if (change === "epoch") f.owner.invalidate();
      else await f.owner.call("turn/interrupt", { threadId: "t" });
    });
    await assert.rejects(
      f.owner.call("thread/goal/set", { threadId: "t", status: "active" }),
      /SESSION_ACQUIRE_FAILED.*尚未发送/,
    );
    assert.equal(
      f.calls.filter((method) => method === "thread/read").length,
      1,
      change,
    );
    assert.equal(
      f.calls.filter((method) => method === "thread/goal/set").length,
      0,
      change,
    );
    assert.equal(pauses, 1, change);
  }
});

test("aborted first-Goal preflight stops before another metadata read or goal write", async () => {
  const f = await fixture();
  f.fail(100);
  const controller = new AbortController();
  f.onPause(() => controller.abort());
  await assert.rejects(
    f.owner.call(
      "thread/goal/set",
      { threadId: "t", status: "active" },
      { signal: controller.signal },
    ),
    /SESSION_ACQUIRE_FAILED.*尚未发送.*取消/,
  );
  assert.deepEqual(f.calls, ["thread/read"]);
});
