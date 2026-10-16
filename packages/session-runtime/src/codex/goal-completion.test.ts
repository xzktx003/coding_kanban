import assert from "node:assert/strict";
import test from "node:test";
import { Ownership, type Rpc } from "./ownership.js";
import { object, type Json, type JsonObject } from "../core/json.js";

const completed = (): JsonObject => ({
  threadId: "t",
  objective: "Finish the captured goal",
  status: "complete",
  tokenBudget: 100,
  tokensUsed: 4,
  timeUsedSeconds: 1,
  createdAt: 100,
  updatedAt: 101,
});

async function fixture() {
  const calls: { method: string; params: Json }[] = [];
  const state = {
    loaded: true,
    active: false,
    child: false,
    input: true,
    source: true,
    goal: completed() as Json | null,
    clearError: "",
    clearResult: { cleared: true } as Json,
  };
  let now = 0;
  let hook: ((method: string) => void | Promise<void>) | undefined;
  let beforeWrite: (() => void) | undefined;
  let onPause: (() => void) | undefined;
  const raw: Rpc = async (method, params, options) => {
    if (method === "thread/goal/clear") {
      beforeWrite?.();
      options?.beforeSend?.();
    }
    calls.push({ method, params });
    let result: Json;
    if (method === "thread/start") result = { thread: { id: "t" } };
    else if (method === "turn/start") result = { turn: { id: "turn" } };
    else if (method === "thread/loaded/list")
      result = { data: state.loaded ? ["t"] : [], nextCursor: null };
    else if (method === "thread/read")
      result = {
        thread: {
          id: "t",
          ...(state.source ? { source: "cli" } : {}),
          status: { type: state.active ? "active" : "idle" },
          ...(state.child
            ? { parentThreadId: "parent", canAcceptDirectInput: state.input }
            : {}),
        },
      };
    else if (method === "thread/goal/get")
      result = { goal: state.goal && JSON.parse(JSON.stringify(state.goal)) };
    else if (method === "thread/goal/clear") {
      if (state.clearError) throw new Error(state.clearError);
      if (object(state.clearResult).cleared === true) state.goal = null;
      result = state.clearResult;
    } else if (method === "thread/goal/set") {
      state.goal = { ...completed(), ...object(params) };
      result = { goal: state.goal };
    } else throw new Error("Unexpected RPC " + method);
    await hook?.(method);
    return result;
  };
  const owner = new Ownership(raw, {
    now: () => now,
    pause: async (milliseconds) => {
      now += milliseconds;
      onPause?.();
    },
    completedGoalWaitMs: 300,
  });
  owner.queueUpdate(1n, false, []);
  await owner.call("thread/start", {});
  await owner.call("turn/start", { threadId: "t" });
  owner.observe("thread/goal/updated", { threadId: "t", goal: completed() });
  const generation = (await owner.access("t")).generation as number;
  calls.length = 0;
  const request = () => ({
    threadId: "t",
    expectedGoal: completed(),
    expectedAccessGeneration: generation,
  });
  return {
    owner,
    state,
    calls,
    request,
    hook: (value: typeof hook) => {
      hook = value;
    },
    beforeWrite: (value: typeof beforeWrite) => {
      beforeWrite = value;
    },
    onPause: (value: typeof onPause) => {
      onPause = value;
    },
  };
}

const clears = (calls: { method: string }[]) =>
  calls.filter((call) => call.method === "thread/goal/clear");

test("completed clear uses the existing writer, validates the full goal, and writes only native threadId", async () => {
  const f = await fixture();
  assert.deepEqual(await f.owner.clearCompletedGoal(f.request()), {
    cleared: true,
  });
  assert.deepEqual(clears(f.calls), [
    { method: "thread/goal/clear", params: { threadId: "t" } },
  ]);
  assert.ok(f.calls.some((call) => call.method === "thread/goal/get"));
  assert.ok(
    f.calls
      .filter((call) => call.method === "thread/read")
      .every((call) => object(call.params).includeTurns === false),
  );
  assert.ok(
    !f.calls.some((call) =>
      /thread\/(?:resume|turns\/list|items\/list)/.test(call.method),
    ),
  );
});

test("unowned, stale generation, unloaded, revoked child input, and uncertain owners never acquire or clear", async () => {
  for (const condition of [
    "unowned",
    "generation",
    "unloaded",
    "child",
    "unknown",
    "source",
  ] as const) {
    const f = await fixture(),
      request = f.request();
    if (condition === "unowned")
      ((request.threadId = "other"),
        (request.expectedGoal = { ...completed(), threadId: "other" }));
    if (condition === "generation") request.expectedAccessGeneration++;
    if (condition === "unloaded") f.state.loaded = false;
    if (condition === "child")
      ((f.state.child = true), (f.state.input = false));
    if (condition === "unknown") f.owner.invalidate();
    if (condition === "source") f.state.source = false;
    assert.equal(
      (await f.owner.clearCompletedGoal(request)).cleared,
      false,
      condition,
    );
    assert.equal(clears(f.calls).length, 0, condition);
    assert.ok(
      !f.calls.some((call) => call.method === "thread/resume"),
      condition,
    );
  }
});

test("every full-goal field protects a replacement even when timestamps are unchanged", async () => {
  const changes: JsonObject[] = [
    { objective: "replacement" },
    { tokenBudget: 200 },
    { tokensUsed: 5 },
    { timeUsedSeconds: 2 },
    { createdAt: 99 },
    { updatedAt: 102 },
    { status: "active" },
  ];
  for (const change of changes) {
    const f = await fixture();
    f.state.goal = { ...completed(), ...change };
    assert.deepEqual(await f.owner.clearCompletedGoal(f.request()), {
      cleared: false,
      reason: "goalChanged",
    });
    assert.equal(clears(f.calls).length, 0);
  }
});

test("completion waits for native idle without starting a turn or reading history", async () => {
  const f = await fixture();
  f.state.active = true;
  f.onPause(() => {
    f.state.active = false;
    f.owner.observe("turn/completed", { threadId: "t", turn: { id: "turn" } });
  });
  assert.deepEqual(await f.owner.clearCompletedGoal(f.request()), {
    cleared: true,
  });
  assert.ok(
    f.calls.filter((call) => call.method === "thread/read").length >= 2,
  );
  assert.ok(
    !f.calls.some(
      (call) => call.method === "turn/start" || call.method === "thread/resume",
    ),
  );
});

test("cancelling a pending completed clear never writes after the native turn becomes idle", async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.state.active = true;
  f.onPause(() => {
    controller.abort();
    f.state.active = false;
  });
  await assert.rejects(
    f.owner.clearCompletedGoal(f.request(), { signal: controller.signal }),
    /NOT_SENT.*取消/,
  );
  assert.equal(clears(f.calls).length, 0);
});

test("explicit Goal clear also checks cancellation at the actual stdin boundary", async () => {
  const f = await fixture();
  const controller = new AbortController();
  f.beforeWrite(() => controller.abort());
  await assert.rejects(
    f.owner.call(
      "thread/goal/clear",
      { threadId: "t" },
      { signal: controller.signal },
    ),
    /NOT_SENT.*取消/,
  );
  assert.equal(clears(f.calls).length, 0);
});

test("an idle status before turn/completed still waits for the captured live turn to drain", async () => {
  const f = await fixture();
  f.owner.observe("turn/started", { threadId: "t", turn: { id: "live-turn" } });
  let pauses = 0;
  f.onPause(() => {
    pauses++;
    f.owner.observe("turn/completed", {
      threadId: "t",
      turn: { id: pauses === 1 ? "older-turn" : "live-turn" },
    });
  });
  assert.deepEqual(await f.owner.clearCompletedGoal(f.request()), {
    cleared: true,
  });
  assert.equal(pauses, 2);
});

test("active timeout, queue hold, pending approval, and first-turn holds keep the completed goal", async () => {
  for (const condition of [
    "active",
    "queue",
    "pending",
    "firstTurn",
  ] as const) {
    const f = await fixture();
    if (condition === "active") f.state.active = true;
    if (condition === "queue") f.owner.queueUpdate(2n, false, ["t"]);
    if (condition === "pending") f.owner.pendingRequest("approval", "t");
    if (condition === "firstTurn") await f.owner.call("thread/start", {});
    assert.deepEqual(
      await f.owner.clearCompletedGoal(f.request()),
      { cleared: false, reason: "busy" },
      condition,
    );
    assert.equal(clears(f.calls).length, 0, condition);
  }
});

test("goal notification while goal/get is in flight fences even an identical snapshot", async () => {
  const f = await fixture();
  f.hook((method) => {
    if (method === "thread/goal/get")
      f.owner.observe("thread/goal/updated", {
        threadId: "t",
        goal: completed(),
      });
  });
  assert.deepEqual(await f.owner.clearCompletedGoal(f.request()), {
    cleared: false,
    reason: "goalChanged",
  });
  assert.equal(clears(f.calls).length, 0);
});

test("stdin guard rejects late native goal, ownership epoch, status, and approval changes", async () => {
  for (const change of ["goal", "epoch", "turn", "approval"] as const) {
    const f = await fixture();
    f.beforeWrite(() => {
      if (change === "goal")
        f.owner.observe("thread/goal/updated", {
          threadId: "t",
          goal: { ...completed(), objective: "new goal" },
        });
      if (change === "epoch") f.owner.invalidate();
      if (change === "turn")
        f.owner.observe("turn/started", {
          threadId: "t",
          turn: { id: "new-turn" },
        });
      if (change === "approval") f.owner.pendingRequest("late-approval", "t");
    });
    assert.equal(
      (await f.owner.clearCompletedGoal(f.request())).cleared,
      false,
      change,
    );
    assert.equal(clears(f.calls).length, 0, change);
  }
});

test("same-key local goal/set completes before stale auto-clear is considered", async () => {
  const f = await fixture();
  let entered!: () => void, unblock!: () => void;
  const sending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const receipt = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  f.hook(async (method) => {
    if (method === "thread/goal/set") {
      entered();
      await receipt;
    }
  });
  const change = f.owner.call("thread/goal/set", {
    threadId: "t",
    objective: "new goal",
    status: "complete",
  });
  await sending;
  const clear = f.owner.clearCompletedGoal(f.request());
  unblock();
  await change;
  assert.equal((await clear).cleared, false);
  assert.equal(clears(f.calls).length, 0);
  assert.equal(object(f.state.goal).objective, "new goal");
});

test("false, unknown delivery, malformed ACK, and epoch changes never retry or turn a false into a clear", async () => {
  const noGoal = await fixture();
  noGoal.state.clearResult = { cleared: false };
  assert.deepEqual(await noGoal.owner.clearCompletedGoal(noGoal.request()), {
    cleared: false,
  });
  assert.equal(clears(noGoal.calls).length, 1);
  for (const condition of ["lost", "malformed", "epoch"] as const) {
    const f = await fixture();
    if (condition === "lost") f.state.clearError = "DELIVERY_UNKNOWN: lost ACK";
    if (condition === "malformed") f.state.clearResult = {};
    if (condition === "epoch")
      f.hook((method) => {
        if (method === "thread/goal/clear") f.owner.invalidate();
      });
    await assert.rejects(
      f.owner.clearCompletedGoal(f.request()),
      /DELIVERY_UNKNOWN/,
    );
    assert.equal(clears(f.calls).length, 1, condition);
  }
});

test("malformed full goal and unexpected fields are rejected before native requests", async () => {
  for (const change of [
    { status: "active" },
    { tokensUsed: -1 },
    { updatedAt: NaN },
    { tokenBudget: 1.5 },
    { threadId: "other" },
    { extraField: true },
  ]) {
    const f = await fixture();
    await assert.rejects(
      f.owner.clearCompletedGoal({
        ...f.request(),
        expectedGoal: { ...completed(), ...change },
      }),
      /Invalid expectedGoal/,
    );
    assert.equal(f.calls.length, 0);
  }
});
