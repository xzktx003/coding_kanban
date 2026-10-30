import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadGoal } from "@session/bindings/v2";
import {
  notifyGoalCompletionAutoClear,
  resetGoalCompletionScope,
  confirmGoalCompletionAccountScope,
} from "./goalCompletionAutoClear";
import { SessionApiError } from "./apiAdapt/shared";

const api = vi.hoisted(() => ({
  threadGoalGet: vi.fn(),
  threadGoalSet: vi.fn(),
  threadGoalClear: vi.fn(),
  threadGoalClearCompleted: vi.fn(),
  threadAccess: vi.fn(),
}));
vi.mock("./apiAdapt", () => api);
vi.mock("./apiAdapt/codex", () => api);
vi.mock("./apiAdapt/git", () => api);
vi.mock("./apiAdapt/skills", () => api);
vi.mock("./apiAdapt/goalCompletion", () => ({
  threadGoalClearCompleted: api.threadGoalClearCompleted,
}));


import { codexService, resetCodexRuntimeState } from "./codexService";
import { useCodexStore } from "../components/codex/stores";

const goal = (
  threadId = "a",
  changes: Partial<ThreadGoal> = {},
): ThreadGoal => ({
  threadId,
  objective: "finish the task",
  status: "active",
  tokenBudget: null,
  tokensUsed: 7,
  timeUsedSeconds: 2,
  createdAt: 1,
  updatedAt: 2,
  ...changes,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const observe = (value: ThreadGoal) =>
  useCodexStore.getState().addEvent(value.threadId, {
    method: "thread/goal/updated",
    params: { threadId: value.threadId, turnId: null, goal: value },
  });
const clear = (threadId: string) =>
  useCodexStore.getState().addEvent(threadId, {
    method: "thread/goal/cleared",
    params: { threadId },
  });

beforeEach(() => {
  resetCodexRuntimeState();
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useCodexStore.setState({ goalMap: {}, events: {}, currentThreadId: "a" });
  useCodexStore.getState().setAccount({ type: "apiKey" });
  confirmGoalCompletionAccountScope();
  api.threadGoalGet.mockResolvedValue({ goal: null });
  api.threadGoalSet.mockResolvedValue({ goal: goal() });
  api.threadGoalClear.mockResolvedValue({ cleared: true });
  api.threadGoalClearCompleted.mockResolvedValue({ cleared: true });
  api.threadAccess.mockResolvedValue({ state: "readonly", generation: 9 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("recovers the exact goal with a read-only request and clears a confirmed absent goal", async () => {
  api.threadGoalGet.mockResolvedValueOnce({ goal: goal() });
  await codexService.threadGoalGet({ threadId: "a" });
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  expect(api.threadGoalGet.mock.calls[0][0]).toEqual({ threadId: "a" });
  expect(api.threadGoalSet).not.toHaveBeenCalled();
  expect(api.threadGoalClear).not.toHaveBeenCalled();
  await codexService.threadGoalGet({ threadId: "a" });
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
});

it("coalesces concurrent readers and never moves a result into the newly selected thread", async () => {
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const a = codexService.threadGoalGet({ threadId: "a" });
  const another = codexService.threadGoalGet({ threadId: "a" });
  useCodexStore.setState({ currentThreadId: "b" });
  read.resolve({ goal: goal() });
  await Promise.all([a, another]);
  expect(api.threadGoalGet).toHaveBeenCalledTimes(1);
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  expect(useCodexStore.getState().goalMap.b).toBeUndefined();
});

it("a late read cannot resurrect a goal cleared by a native event", async () => {
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const pending = codexService.threadGoalGet({ threadId: "a" });
  clear("a");
  read.resolve({ goal: goal() });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
});

it("a repeated same-valued native observation fences an older read without notifying subscribers", async () => {
  observe(goal());
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const pending = codexService.threadGoalGet({ threadId: "a" });
  const changed = vi.fn();
  const stop = useCodexStore.subscribe(changed);
  observe({ ...goal() });
  expect(changed).not.toHaveBeenCalled();
  read.resolve({ goal: goal("a", { status: "paused", updatedAt: 1 }) });
  await pending;
  expect(useCodexStore.getState().goalMap.a.status).toBe("active");
  expect(useCodexStore.getState().events.a).toBeUndefined();
  stop();
});

it("set and clear acknowledgements recover state even when their SSE notifications are lost", async () => {
  await codexService.threadGoalSet({
    threadId: "a",
    objective: "finish the task",
  });
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  await codexService.threadGoalClear({ threadId: "a" });
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
});

it("a late mutation acknowledgement cannot overwrite a newer native observation", async () => {
  const mutation = deferred<{ goal: ThreadGoal }>();
  api.threadGoalSet.mockReturnValue(mutation.promise);
  const pending = codexService.threadGoalSet({
    threadId: "a",
    status: "paused",
  });
  const latest = goal("a", { status: "complete", updatedAt: 3 });
  api.threadGoalGet.mockResolvedValue({ goal: latest });
  observe(latest);
  mutation.resolve({ goal: goal("a", { status: "paused" }) });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toEqual(latest);
});

it("same-value account notifications preserve display and fence a late mutation ACK until a canonical read", async () => {
  observe(goal());
  const mutation = deferred<{ goal: ThreadGoal }>();
  api.threadGoalSet.mockReturnValue(mutation.promise);
  const pending = codexService
    .threadGoalSet({ threadId: "a", status: "paused" })
    .catch((error: Error) => error);
  resetGoalCompletionScope();
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  mutation.resolve({ goal: goal("a", { status: "paused", updatedAt: 3 }) });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  await expect(
    codexService.threadGoalSet({ threadId: "a", objective: "Second" }),
  ).rejects.toThrow(/未确认|核对/);
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
  api.threadGoalGet.mockResolvedValue({ goal: goal() });
  await codexService.threadGoalGet({ threadId: "a" });
  await codexService.threadGoalSet({
    threadId: "a",
    objective: "Explicit after review",
  });
  expect(api.threadGoalSet).toHaveBeenCalledTimes(2);
});

it("a real account namespace switch clears old goal metadata and advances the small-read scope", () => {
  useCodexStore
    .getState()
    .setAccount(
      { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
      "workspace-A",
    );
  observe(goal("a", { status: "complete" }));
  const previous = (useCodexStore.getState() as any).goalScopeVersion ?? 0;
  useCodexStore
    .getState()
    .setAccount(
      { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
      "workspace-B",
    );
  expect(useCodexStore.getState().goalMap).toEqual({});
  expect(useCodexStore.getState().completedGoalMap).toEqual({});
  expect((useCodexStore.getState() as any).goalScopeVersion).toBe(previous + 1);
});

it("a late clear acknowledgement preserves a goal recreated by a newer native observation", async () => {
  observe(goal());
  const mutation = deferred<{ cleared: boolean }>();
  api.threadGoalClear.mockReturnValue(mutation.promise);
  const pending = codexService.threadGoalClear({ threadId: "a" });
  const recreated = goal("a", {
    objective: "a different goal",
    createdAt: 3,
    updatedAt: 3,
  });
  api.threadGoalGet.mockResolvedValue({ goal: recreated });
  observe(recreated);
  mutation.resolve({ cleared: true });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toEqual(recreated);
});

it("a late completed-goal clear ACK cannot erase a newer active goal or restore its old achievement badge", async () => {
  observe(goal("a", { status: "complete" }));
  const mutation = deferred<{ cleared: boolean }>();
  api.threadGoalClear.mockReturnValue(mutation.promise);
  const pending = codexService.threadGoalClear({ threadId: "a" });
  const recreated = goal("a", {
    objective: "Next result",
    createdAt: 3,
    updatedAt: 3,
  });
  api.threadGoalGet.mockResolvedValue({ goal: recreated });
  observe(recreated);
  mutation.resolve({ cleared: true });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toEqual(recreated);
  expect(useCodexStore.getState().completedGoalMap.a).toBeUndefined();
});

it("keeps the completion badge after a clear receipt but resets it with the runtime identity", async () => {
  const achieved = goal("a", { status: "complete" });
  observe(achieved);
  await codexService.threadGoalClear({ threadId: "a" });
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
  expect(useCodexStore.getState().completedGoalMap.a).toEqual(achieved);
  resetCodexRuntimeState();
  expect(useCodexStore.getState().completedGoalMap).toEqual({});
});

it("does not remove the goal on a confirmed false clear receipt", async () => {
  observe(goal());
  api.threadGoalClear.mockResolvedValue({ cleared: false });
  await codexService.threadGoalClear({ threadId: "a" });
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
});

it("automatically clears a completed owned idle goal once and retains its achievement metadata", async () => {
  const achieved = goal("a", { status: "complete" });
  api.threadAccess.mockResolvedValue({ state: "owned", generation: 9 });
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  observe(achieved);
  await notifyGoalCompletionAutoClear("a");
  await notifyGoalCompletionAutoClear("a");
  expect(api.threadGoalClearCompleted).toHaveBeenCalledTimes(1);
  expect(api.threadGoalClearCompleted.mock.calls[0][0]).toEqual({
    threadId: "a",
    expectedGoal: achieved,
    expectedAccessGeneration: 9,
  });
  expect(api.threadGoalClear).not.toHaveBeenCalled();
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
  expect(useCodexStore.getState().completedGoalMap.a).toEqual(achieved);
});

it("keeps a complete goal after an auto-clear false receipt and never retries it", async () => {
  const achieved = goal("a", { status: "complete" });
  api.threadAccess.mockResolvedValue({ state: "owned", generation: 9 });
  api.threadGoalClearCompleted.mockResolvedValue({
    cleared: false,
    reason: "busy",
  });
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  observe(achieved);
  await notifyGoalCompletionAutoClear("a");
  await notifyGoalCompletionAutoClear("a");
  expect(api.threadGoalClearCompleted).toHaveBeenCalledTimes(1);
  expect(useCodexStore.getState().goalMap.a).toEqual(achieved);
});

it("an account notification cancels pending ownership and keeps auto-clear revoked until explicit account confirmation", async () => {
  const achieved = goal("a", { status: "complete" });
  const access = deferred<{ state: string; generation: number }>();
  api.threadAccess.mockReturnValue(access.promise);
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  observe(achieved);
  const pending = notifyGoalCompletionAutoClear("a");
  await vi.waitFor(() => expect(api.threadAccess).toHaveBeenCalledTimes(1));
  resetGoalCompletionScope();
  expect(api.threadAccess.mock.calls[0][2].aborted).toBe(true);
  access.resolve({ state: "owned", generation: 9 });
  await pending;
  await notifyGoalCompletionAutoClear("a");
  expect(api.threadAccess).toHaveBeenCalledTimes(1);
  expect(api.threadGoalClearCompleted).not.toHaveBeenCalled();
  expect(useCodexStore.getState().goalMap.a).toEqual(achieved);
  const before = useCodexStore.getState().goalScopeVersion;
  confirmGoalCompletionAccountScope();
  expect(useCodexStore.getState().goalScopeVersion).toBe(before + 1);
  api.threadAccess.mockResolvedValue({ state: "owned", generation: 10 });
  await notifyGoalCompletionAutoClear("a");
  expect(api.threadGoalClearCompleted).toHaveBeenCalledTimes(1);
  expect(
    api.threadGoalClearCompleted.mock.calls[0][0].expectedAccessGeneration,
  ).toBe(10);
});

it("a same-value account reconfirmation never retries an already attempted completed revision", async () => {
  const achieved = goal("a", { status: "complete" });
  api.threadAccess.mockResolvedValue({ state: "owned", generation: 9 });
  api.threadGoalClearCompleted.mockResolvedValue({
    cleared: false,
    reason: "busy",
  });
  useCodexStore.setState({
    threadStatusMap: { a: { type: "idle" } },
    turnTimingMap: {},
  });
  observe(achieved);
  await notifyGoalCompletionAutoClear("a");
  resetGoalCompletionScope();
  confirmGoalCompletionAccountScope();
  await notifyGoalCompletionAutoClear("a");
  expect(api.threadGoalClearCompleted).toHaveBeenCalledTimes(1);
  expect(useCodexStore.getState().goalMap.a).toEqual(achieved);
});

it("fences an unknown mutation until one coalesced canonical read succeeds, then requires a new explicit submission", async () => {
  const recovery = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(recovery.promise);
  api.threadGoalSet.mockRejectedValueOnce(
    new SessionApiError("receipt lost", 503, undefined, "outcome-unknown"),
  );
  await expect(
    codexService.threadGoalSet({ threadId: "a", objective: "First" }),
  ).rejects.toThrow("receipt lost");
  await expect(
    codexService.threadGoalSet({ threadId: "a", objective: "Second" }),
  ).rejects.toThrow(/未确认|核对/);
  await expect(codexService.threadGoalClear({ threadId: "a" })).rejects.toThrow(
    /未确认|核对/,
  );
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
  expect(api.threadGoalClear).not.toHaveBeenCalled();
  expect(api.threadGoalGet).toHaveBeenCalledTimes(1);
  const read = codexService.threadGoalGet({ threadId: "a" });
  const canonical = goal("a", {
    objective: "Canonical current goal",
    updatedAt: 3,
  });
  recovery.resolve({ goal: canonical });
  await read;
  expect(useCodexStore.getState().goalMap.a).toEqual(canonical);
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
  await codexService.threadGoalSet({
    threadId: "a",
    objective: "User explicitly retries after review",
  });
  expect(api.threadGoalSet).toHaveBeenCalledTimes(2);
});

it("keeps the unknown fence after failed read or a same-valued SSE event until an explicit read confirms state", async () => {
  observe(goal());
  api.threadGoalGet.mockRejectedValue(new Error("read offline"));
  api.threadGoalClear.mockRejectedValueOnce(new Error("network disconnected"));
  await expect(codexService.threadGoalClear({ threadId: "a" })).rejects.toThrow(
    "network disconnected",
  );
  await expect(codexService.threadGoalGet({ threadId: "a" })).rejects.toThrow(
    "read offline",
  );
  observe({ ...goal() });
  await expect(
    codexService.threadGoalSet({ threadId: "a", status: "paused" }),
  ).rejects.toThrow(/未确认|核对/);
  expect(api.threadGoalSet).not.toHaveBeenCalled();
  api.threadGoalGet.mockResolvedValue({ goal: goal() });
  await codexService.threadGoalGet({ threadId: "a" });
  await codexService.threadGoalSet({ threadId: "a", status: "paused" });
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
});

it("a read invalidated by a later same-value native event cannot remove the unknown-outcome fence", async () => {
  observe(goal());
  const recovery = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(recovery.promise);
  api.threadGoalSet.mockRejectedValueOnce(new Error("receipt lost"));
  await expect(
    codexService.threadGoalSet({ threadId: "a", status: "paused" }),
  ).rejects.toThrow("receipt lost");
  const pending = codexService.threadGoalGet({ threadId: "a" });
  observe({ ...goal() });
  recovery.resolve({ goal: goal() });
  await pending;
  expect(() => codexService.assertThreadGoalReady("a")).toThrow(/未确认|核对/);
  api.threadGoalGet.mockResolvedValue({ goal: goal() });
  await codexService.threadGoalGet({ threadId: "a" });
  expect(() => codexService.assertThreadGoalReady("a")).not.toThrow();
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
});

it.each([400, 403, 409, 422])(
  "does not mark an explicit not-admitted HTTP %s as an unknown outcome",
  async (status) => {
    api.threadGoalSet.mockRejectedValueOnce(
      new SessionApiError("not admitted", status, undefined, "not-admitted"),
    );
    await expect(
      codexService.threadGoalSet({ threadId: "a", objective: "Rejected" }),
    ).rejects.toThrow("not admitted");
    await codexService.threadGoalSet({
      threadId: "a",
      objective: "User retries after the rejection",
    });
    expect(api.threadGoalSet).toHaveBeenCalledTimes(2);
    expect(api.threadGoalGet).not.toHaveBeenCalled();
  },
);

it("reconciles an acknowledged change after a conflicting in-flight native observation with one read", async () => {
  observe(goal());
  const mutation = deferred<{ goal: ThreadGoal }>();
  const paused = goal("a", { status: "paused", updatedAt: 3 });
  api.threadGoalSet.mockReturnValue(mutation.promise);
  api.threadGoalGet.mockResolvedValue({ goal: paused });
  const pending = codexService.threadGoalSet({
    threadId: "a",
    status: "paused",
  });
  observe({ ...goal() });
  mutation.resolve({ goal: paused });
  await pending;
  await vi.waitFor(() =>
    expect(useCodexStore.getState().goalMap.a).toEqual(paused),
  );
  expect(api.threadGoalGet).toHaveBeenCalledTimes(1);
  expect(api.threadGoalSet).toHaveBeenCalledTimes(1);
});

it("reads begun before a mutation cannot restore its preceding state", async () => {
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const pending = codexService
    .threadGoalGet({ threadId: "a" })
    .catch(() => undefined);
  await codexService.threadGoalClear({ threadId: "a" });
  read.resolve({ goal: goal() });
  await pending;
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
});

it("rejects a duplicate same-thread mutation and does not read stale state during its pending receipt", async () => {
  const mutation = deferred<{ goal: ThreadGoal }>();
  api.threadGoalSet.mockReturnValue(mutation.promise);
  const pending = codexService.threadGoalSet({
    threadId: "a",
    objective: "finish",
  });
  await expect(codexService.threadGoalClear({ threadId: "a" })).rejects.toThrow(
    /目标.*(处理中|确认)/,
  );
  await codexService.threadGoalGet({ threadId: "a" });
  expect(api.threadGoalGet).not.toHaveBeenCalled();
  expect(api.threadGoalClear).not.toHaveBeenCalled();
  mutation.resolve({ goal: goal() });
  await pending;
});

it("runtime reset removes old goals, aborts readers and never applies their late results", async () => {
  observe(goal());
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const pending = codexService
    .threadGoalGet({ threadId: "a" })
    .catch((error: Error) => error);
  resetCodexRuntimeState();
  expect(useCodexStore.getState().goalMap).toEqual({});
  expect(api.threadGoalGet.mock.calls[0][1].signal.aborted).toBe(true);
  read.resolve({ goal: goal() });
  expect(await pending).toEqual(
    expect.objectContaining({ message: expect.stringMatching(/连接.*切换/) }),
  );
  expect(useCodexStore.getState().goalMap).toEqual({});
});

it("bounds a lost clear receipt, aborts transport and never resends", async () => {
  vi.useFakeTimers();
  observe(goal());
  const mutation = deferred<{ cleared: boolean }>();
  const recovery = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(recovery.promise);
  api.threadGoalClear.mockReturnValue(mutation.promise);
  const pending = codexService
    .threadGoalClear({ threadId: "a" })
    .catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await pending).toEqual(
    expect.objectContaining({
      message: expect.stringMatching(/清除.*结果未确认/),
    }),
  );
  expect(api.threadGoalClear.mock.calls[0][1].signal.aborted).toBe(true);
  mutation.resolve({ cleared: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  expect(api.threadGoalClear).toHaveBeenCalledTimes(1);
  recovery.resolve({ goal: goal() });
});

it("rejects an observation for a different native thread", async () => {
  api.threadGoalGet.mockResolvedValue({ goal: goal("b") });
  await expect(codexService.threadGoalGet({ threadId: "a" })).rejects.toThrow(
    /目标.*身份/,
  );
  expect(useCodexStore.getState().goalMap).toEqual({});
});

it("rejects a malformed clear receipt and keeps the last confirmed goal", async () => {
  observe(goal());
  api.threadGoalClear.mockResolvedValue({});
  api.threadGoalGet.mockRejectedValue(new Error("canonical read unavailable"));
  await expect(codexService.threadGoalClear({ threadId: "a" })).rejects.toThrow(
    /清除结果未确认/,
  );
  expect(useCodexStore.getState().goalMap.a).toEqual(goal());
  expect(api.threadGoalClear).toHaveBeenCalledTimes(1);
});

it("bounds a stalled read and ignores its eventual response without polling", async () => {
  vi.useFakeTimers();
  const read = deferred<{ goal: ThreadGoal }>();
  api.threadGoalGet.mockReturnValue(read.promise);
  const pending = codexService
    .threadGoalGet({ threadId: "a" })
    .catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await pending).toEqual(
    expect.objectContaining({ name: "TimeoutError" }),
  );
  expect(api.threadGoalGet.mock.calls[0][1].signal.aborted).toBe(true);
  read.resolve({ goal: goal() });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(useCodexStore.getState().goalMap.a).toBeUndefined();
  expect(api.threadGoalGet).toHaveBeenCalledTimes(1);
});

it("reuses identical acknowledged/read snapshots and never polls while idle", async () => {
  vi.useFakeTimers();
  observe(goal());
  api.threadGoalGet.mockResolvedValue({ goal: { ...goal() } });
  const changed = vi.fn();
  const stop = useCodexStore.subscribe(changed);
  await codexService.threadGoalGet({ threadId: "a" });
  expect(changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(api.threadGoalGet).toHaveBeenCalledTimes(1);
  stop();
});
