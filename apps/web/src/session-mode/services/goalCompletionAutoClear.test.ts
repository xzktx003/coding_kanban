import { beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";
import { createGoalCompletionAutoClear } from "./goalCompletionAutoClear";

const complete: ThreadGoal = {
  threadId: "owner",
  objective: "Ship",
  status: "complete",
  tokenBudget: null,
  tokensUsed: 12,
  timeUsedSeconds: 61,
  createdAt: 1,
  updatedAt: 100,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let current: ThreadGoal | undefined, scope: string, idle: boolean;
const access = vi.fn(),
  clear = vi.fn();
const coordinator = () =>
  createGoalCompletionAutoClear({
    current: () => current,
    scope: () => scope,
    canAttempt: () => idle,
    access,
    clear,
  });
beforeEach(() => {
  current = { ...complete };
  scope = "runtime-1/account-1";
  idle = true;
  access.mockReset().mockResolvedValue({ state: "owned", generation: 9 });
  clear.mockReset().mockResolvedValue({ cleared: true });
});

it("sends one owner-only completed clear with the exact snapshot and observed generation", async () => {
  const state = coordinator();
  await state.observe("owner");
  await state.observe("owner");
  expect(clear).toHaveBeenCalledExactlyOnceWith({
    threadId: "owner",
    expectedGoal: complete,
    expectedAccessGeneration: 9,
  });
  expect(access).toHaveBeenCalledTimes(1);
});

it.each(["readonly", "unknown", "external", "acquiring", "releasing"])(
  "never clears a %s history or acquires a writer",
  async (state) => {
    access.mockResolvedValue({ state, generation: 9 });
    await coordinator().observe("owner");
    expect(clear).not.toHaveBeenCalled();
  },
);

it("requires safe explicit generation and complete current identity", async () => {
  for (const generation of [undefined, NaN, -1, 1.5]) {
    access.mockResolvedValue({ state: "owned", generation });
    await coordinator().observe("owner");
  }
  current = { ...complete, threadId: "other" };
  await coordinator().observe("owner");
  current = { ...complete, status: "active" };
  await coordinator().observe("owner");
  expect(clear).not.toHaveBeenCalled();
});

it("waits for an existing lifecycle idle event before its first attempt, without polling", async () => {
  idle = false;
  const state = coordinator();
  await state.observe("owner");
  expect(access).not.toHaveBeenCalled();
  idle = true;
  await state.observe("owner");
  expect(clear).toHaveBeenCalledTimes(1);
});

it.each(["scope", "goal", "idle", "reset"])(
  "rechecks %s after the asynchronous access read",
  async (change) => {
    const pending = deferred<{ state: string; generation: number }>();
    access.mockReturnValue(pending.promise);
    const state = coordinator(),
      request = state.observe("owner");
    if (change === "scope") scope = "runtime-2/account-1";
    if (change === "goal") current = { ...complete, objective: "New goal" };
    if (change === "idle") idle = false;
    if (change === "reset") state.reset();
    pending.resolve({ state: "owned", generation: 9 });
    await request;
    expect(clear).not.toHaveBeenCalled();
  },
);

it.each(["false", "unknown"])(
  "never retries a %s mutation result for the same updatedAt",
  async (result) => {
    if (result === "false")
      clear.mockResolvedValue({ cleared: false, reason: "busy" });
    else clear.mockRejectedValue(new Error("receipt unknown"));
    const state = coordinator();
    await state.observe("owner");
    await state.observe("owner");
    expect(clear).toHaveBeenCalledTimes(1);
  },
);

it("coalesces duplicate in-flight observations and does not lose a new completion", async () => {
  const pending = deferred<{ state: string; generation: number }>();
  access.mockReturnValueOnce(pending.promise);
  const state = coordinator();
  const old = state.observe("owner"),
    duplicate = state.observe("owner");
  current = { ...complete, objective: "Next", updatedAt: 102 };
  const newer = state.observe("owner");
  pending.resolve({ state: "owned", generation: 9 });
  await Promise.all([old, duplicate, newer]);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(clear.mock.calls[0][0].expectedGoal).toEqual(current);
});

it("does not retain an old attempt across an explicit runtime reset", async () => {
  const state = coordinator();
  await state.observe("owner");
  state.reset();
  scope = "runtime-2/account-1";
  await state.observe("owner");
  expect(clear).toHaveBeenCalledTimes(2);
});

it("releases a synchronously failed metadata read so a later lifecycle event can confirm ownership", async () => {
  access.mockImplementationOnce(() => {
    throw new Error("metadata unavailable");
  });
  const state = coordinator();
  await state.observe("owner");
  expect(clear).not.toHaveBeenCalled();
  await state.observe("owner");
  expect(access).toHaveBeenCalledTimes(2);
  expect(clear).toHaveBeenCalledTimes(1);
});
