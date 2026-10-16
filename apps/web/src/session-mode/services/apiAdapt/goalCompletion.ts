import type { ThreadGoal } from "@session/bindings/v2";
import { postJsonWithOptions } from "./shared";

/** Application endpoint; these fields are not native Codex wire parameters. */
export interface ThreadGoalClearCompletedParams {
  threadId: string;
  expectedGoal: ThreadGoal;
  expectedAccessGeneration: number;
}

export interface ThreadGoalClearCompletedResponse {
  cleared: boolean;
  reason?:
    | "notOwned"
    | "generationChanged"
    | "goalChanged"
    | "busy"
    | "unsupported";
}

/** One attempt. A false or unknown result must preserve the completed goal. */
export function threadGoalClearCompleted(
  params: ThreadGoalClearCompletedParams,
  options: { signal?: AbortSignal; suppressToast?: boolean } = {},
): Promise<ThreadGoalClearCompletedResponse> {
  return postJsonWithOptions<ThreadGoalClearCompletedResponse>(
    "/api/codex/thread/goal/clear-completed",
    params,
    { ...options, suppressToast: options.suppressToast ?? true },
  );
}
