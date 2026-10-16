import type { ThreadGoal } from "@session/bindings/v2";
import type {
  ThreadGoalClearCompletedParams,
  ThreadGoalClearCompletedResponse,
} from "./apiAdapt/goalCompletion";
import { isThreadGoalForThread, sameThreadGoal } from "./threadGoalState";

interface Driver {
  current(threadId: string): ThreadGoal | undefined;
  scope(): string;
  /** True only for a confirmed idle thread with no pending local goal mutation. */
  canAttempt(threadId: string): boolean;
  /** A metadata-only ownership read, never thread/resume. */
  access(
    threadId: string,
    signal: AbortSignal,
  ): Promise<{ state: string; generation: number } | undefined>;
  clear(
    params: ThreadGoalClearCompletedParams,
  ): Promise<ThreadGoalClearCompletedResponse>;
}

/** Event-driven, one mutation per completed updatedAt; false/unknown never retries. */
export function createGoalCompletionAutoClear(
  driver: Driver,
  attempted = new Map<string, number>(),
) {
  let epoch = 0;
  const pending = new Map<
    string,
    {
      goal: ThreadGoal;
      scope: string;
      promise: Promise<void>;
      controller: AbortController;
    }
  >();
  const coordinator = {
    observe(threadId: string): Promise<void> {
      const goal = driver.current(threadId);
      if (
        !isThreadGoalForThread(goal, threadId) ||
        goal.status !== "complete" ||
        !driver.canAttempt(threadId)
      )
        return Promise.resolve();
      const scope = driver.scope();
      const key = JSON.stringify([scope, threadId]);
      if (goal.updatedAt <= (attempted.get(key) ?? -1))
        return Promise.resolve();
      const previous = pending.get(threadId);
      if (previous) {
        if (previous.scope === scope && sameThreadGoal(previous.goal, goal))
          return previous.promise;
        return previous.promise.then(() => coordinator.observe(threadId));
      }
      const snapshot = { ...goal },
        capturedEpoch = epoch;
      const request = {
        goal: snapshot,
        scope,
        controller: new AbortController(),
        promise: undefined as unknown as Promise<void>,
      };
      request.promise = Promise.resolve().then(async () => {
        try {
          const access = await driver.access(
            threadId,
            request.controller.signal,
          );
          if (
            capturedEpoch !== epoch ||
            driver.scope() !== scope ||
            !sameThreadGoal(driver.current(threadId), snapshot) ||
            !driver.canAttempt(threadId) ||
            access?.state !== "owned" ||
            !Number.isSafeInteger(access.generation) ||
            access.generation < 0
          )
            return;
          // Mark before transport: a lost receipt is never permission to resend.
          attempted.set(key, snapshot.updatedAt);
          await driver.clear({
            threadId,
            expectedGoal: snapshot,
            expectedAccessGeneration: access.generation,
          });
        } catch {
          // A failed metadata read proves no ownership; a failed write proves no
          // outcome. Preserve the card and await explicit user/read-only recovery.
        } finally {
          if (pending.get(threadId) === request) pending.delete(threadId);
        }
      });
      pending.set(threadId, request);
      return request.promise;
    },
    reset() {
      coordinator.cancel();
      attempted.clear();
    },
    cancel() {
      epoch++;
      for (const request of pending.values()) request.controller.abort();
      pending.clear();
    },
  };
  return coordinator;
}

type Coordinator = ReturnType<typeof createGoalCompletionAutoClear>;
let installed:
  | { observe: Coordinator["observe"]; reset(): void; confirm?(): void }
  | undefined;
export function installGoalCompletionAutoClear(
  next: NonNullable<typeof installed>,
) {
  installed = next;
  return () => {
    if (installed === next) installed = undefined;
  };
}
export function notifyGoalCompletionAutoClear(threadId: string): Promise<void> {
  return installed?.observe(threadId) ?? Promise.resolve();
}
export function resetGoalCompletionScope() {
  installed?.reset();
}
/** Only a valid current account read may re-establish the account authority. */
export function confirmGoalCompletionAccountScope() {
  installed?.confirm?.();
}
