import type {
  ThreadGoal,
  ThreadGoalClearParams,
  ThreadGoalClearResponse,
  ThreadGoalGetResponse,
  ThreadGoalSetParams,
  ThreadGoalSetResponse,
} from "@session/bindings/v2";
import { readWithDeadline } from "./sessionReadQueue";
import { isExplicitRequestRejection } from "./apiAdapt/shared";
import { MutationNotStartedError } from "./MutationNotStartedError";
import type {
  ThreadGoalClearCompletedParams,
  ThreadGoalClearCompletedResponse,
} from "./apiAdapt/goalCompletion";

type Checkpoint = { epoch: number; revision: number };
let epoch = 0;
const revisions = new Map<string, number>();

/** Native observations advance the fence even when their visible value is unchanged. */
export const threadGoalVersions = {
  capture(threadId: string): Checkpoint {
    return { epoch, revision: revisions.get(threadId) ?? 0 };
  },
  touch(threadId: string) {
    revisions.set(threadId, (revisions.get(threadId) ?? 0) + 1);
  },
  matches(threadId: string, captured: Checkpoint) {
    return (
      captured.epoch === epoch &&
      captured.revision === (revisions.get(threadId) ?? 0)
    );
  },
  sameRuntime(captured: Checkpoint) {
    return captured.epoch === epoch;
  },
  reset() {
    epoch++;
    revisions.clear();
  },
};

export function sameThreadGoal(
  a: ThreadGoal | undefined,
  b: ThreadGoal | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.threadId === b.threadId &&
      a.objective === b.objective &&
      a.status === b.status &&
      a.tokenBudget === b.tokenBudget &&
      a.tokensUsed === b.tokensUsed &&
      a.timeUsedSeconds === b.timeUsedSeconds &&
      a.createdAt === b.createdAt &&
      a.updatedAt === b.updatedAt)
  );
}

const statuses = new Set([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
export function isThreadGoalForThread(
  value: unknown,
  threadId: string,
): value is ThreadGoal {
  if (!value || typeof value !== "object") return false;
  const goal = value as ThreadGoal;
  return (
    goal.threadId === threadId &&
    typeof goal.objective === "string" &&
    statuses.has(goal.status) &&
    (goal.tokenBudget === null ||
      (Number.isSafeInteger(goal.tokenBudget) && goal.tokenBudget! >= 0)) &&
    [
      goal.tokensUsed,
      goal.timeUsedSeconds,
      goal.createdAt,
      goal.updatedAt,
    ].every(
      (number) =>
        typeof number === "number" && Number.isFinite(number) && number >= 0,
    )
  );
}

type SignalOptions = { signal: AbortSignal };
type GoalDriver = {
  read: (
    threadId: string,
    options: SignalOptions,
  ) => Promise<ThreadGoalGetResponse>;
  set: (
    params: ThreadGoalSetParams,
    options: SignalOptions,
  ) => Promise<ThreadGoalSetResponse>;
  clear: (
    params: ThreadGoalClearParams,
    options: SignalOptions,
  ) => Promise<ThreadGoalClearResponse>;
  clearCompleted?: (
    params: ThreadGoalClearCompletedParams,
    options: SignalOptions,
  ) => Promise<ThreadGoalClearCompletedResponse>;
  current: (threadId: string) => ThreadGoal | undefined;
  apply: (threadId: string, goal: ThreadGoal | null) => void;
};
const runtimeChanged = () =>
  new Error("连接目标已切换，目标状态结果未确认，请先核对原连接的目标状态。");
const assertGoal = (threadId: string, goal: ThreadGoal | null) => {
  if (goal !== null && !isThreadGoalForThread(goal, threadId))
    throw new Error("目标状态的线程身份或内容未确认，请重试只读恢复。");
};

/** Goal recovery is a small read-only request, independent of transcript retention and writer ownership. */
export function createThreadGoalState(
  driver: GoalDriver,
  outcomeUnknown = new Set<string>(),
) {
  const reads = new Map<
    string,
    { controller: AbortController; promise: Promise<ThreadGoalGetResponse> }
  >();
  const mutations = new Map<string, AbortController>();
  const current = (threadId: string): ThreadGoalGetResponse => ({
    goal: driver.current(threadId) ?? null,
  });
  const assertReady = (threadId: string) => {
    if (outcomeUnknown.has(threadId))
      throw new MutationNotStartedError(
        "上次目标变更结果未确认，请先只读核对目标状态；草稿已保留，不会重复提交。",
      );
  };

  const mutate = async <T>(
    threadId: string,
    action: "设置" | "清除",
    run: (options: SignalOptions) => Promise<T>,
    resultGoal: (result: T) => ThreadGoal | null | undefined,
  ) => {
    if (mutations.has(threadId))
      throw new Error("目标变更正在处理中，请等待结果确认。");
    assertReady(threadId);
    const controller = new AbortController();
    mutations.set(threadId, controller);
    const precedingRead = reads.get(threadId);
    reads.delete(threadId);
    precedingRead?.controller.abort(
      new DOMException("Goal changed", "AbortError"),
    );
    threadGoalVersions.touch(threadId);
    const captured = threadGoalVersions.capture(threadId);
    let reconcile = false;
    try {
      const response = await readWithDeadline(
        (signal) => run({ signal }),
        30_000,
        controller.signal,
      );
      if (!threadGoalVersions.sameRuntime(captured)) throw runtimeChanged();
      const goal = resultGoal(response);
      // A confirmed no-op must not erase the last observed goal or reconcile
      // against an invented null goal. Unknown receipts throw before this path.
      if (goal === undefined) return response;
      assertGoal(threadId, goal);
      if (threadGoalVersions.matches(threadId, captured))
        driver.apply(threadId, goal);
      else if (!sameThreadGoal(driver.current(threadId), goal ?? undefined))
        reconcile = true;
      return response;
    } catch (error) {
      if (
        threadGoalVersions.sameRuntime(captured) &&
        !(error instanceof MutationNotStartedError) &&
        !isExplicitRequestRejection(error)
      ) {
        outcomeUnknown.add(threadId);
        // One bounded read may establish current canonical state. It does not
        // acknowledge or resend the original mutation, even for equal values.
        reconcile = true;
      }
      if (error instanceof DOMException && error.name === "TimeoutError")
        throw new Error(
          `目标${action}结果未确认，请先核对目标状态；不会自动重发。`,
        );
      throw error;
    } finally {
      if (mutations.get(threadId) === controller) mutations.delete(threadId);
      // ACKs and events have no common monotonic cursor. Resolve a conflicting
      // observation with one new read, after the write has settled, never replay it.
      if (reconcile && threadGoalVersions.sameRuntime(captured))
        void state.read(threadId).catch(() => undefined);
    }
  };

  const state = {
    read(threadId: string): Promise<ThreadGoalGetResponse> {
      // A snapshot captured before the pending write is acknowledged could undo it.
      if (mutations.has(threadId)) return Promise.resolve(current(threadId));
      const preceding = reads.get(threadId);
      if (preceding) return preceding.promise;
      const captured = threadGoalVersions.capture(threadId);
      const controller = new AbortController();
      const request = {
        controller,
        promise: undefined as unknown as Promise<ThreadGoalGetResponse>,
      };
      request.promise = readWithDeadline(
        (signal) => driver.read(threadId, { signal }),
        5_000,
        controller.signal,
      )
        .then((response) => {
          if (!threadGoalVersions.sameRuntime(captured)) throw runtimeChanged();
          assertGoal(threadId, response.goal);
          if (threadGoalVersions.matches(threadId, captured)) {
            driver.apply(threadId, response.goal);
            outcomeUnknown.delete(threadId);
          }
          return current(threadId);
        })
        .finally(() => {
          if (reads.get(threadId) === request) reads.delete(threadId);
        });
      reads.set(threadId, request);
      return request.promise;
    },
    set(params: ThreadGoalSetParams) {
      return mutate(
        params.threadId,
        "设置",
        (options) => driver.set(params, options),
        (result) => result.goal,
      );
    },
    clear(params: ThreadGoalClearParams) {
      return mutate(
        params.threadId,
        "清除",
        (options) => driver.clear(params, options),
        (result) => {
          if (typeof result.cleared !== "boolean")
            throw new Error(
              "目标清除结果未确认，请先核对目标状态；不会自动重发。",
            );
          return result.cleared ? null : undefined;
        },
      );
    },
    clearCompleted(
      params: ThreadGoalClearCompletedParams,
    ): Promise<ThreadGoalClearCompletedResponse> {
      if (!driver.clearCompleted)
        return Promise.resolve({ cleared: false, reason: "unsupported" });
      if (mutations.has(params.threadId) || outcomeUnknown.has(params.threadId))
        return Promise.resolve({ cleared: false, reason: "busy" });
      if (
        !isThreadGoalForThread(params.expectedGoal, params.threadId) ||
        params.expectedGoal.status !== "complete" ||
        !sameThreadGoal(driver.current(params.threadId), params.expectedGoal)
      )
        return Promise.resolve({ cleared: false, reason: "goalChanged" });
      return mutate(
        params.threadId,
        "清除",
        (options) => driver.clearCompleted!(params, options),
        (result) => {
          if (typeof result.cleared !== "boolean")
            throw new Error(
              "目标清除结果未确认，请先核对目标状态；不会自动重发。",
            );
          return result.cleared ? null : undefined;
        },
      );
    },
    isMutating(threadId: string) {
      return mutations.has(threadId);
    },
    isOutcomeUnknown(threadId: string) {
      return outcomeUnknown.has(threadId);
    },
    assertReady,
    reset() {
      state.cancel();
      outcomeUnknown.clear();
    },
    cancel() {
      threadGoalVersions.reset();
      for (const { controller } of reads.values())
        controller.abort(runtimeChanged());
      for (const [threadId, controller] of mutations) {
        outcomeUnknown.add(threadId);
        controller.abort(runtimeChanged());
      }
      reads.clear();
      mutations.clear();
    },
  };
  return state;
}
