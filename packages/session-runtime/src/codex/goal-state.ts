import { HttpError, isObject, type JsonObject } from "../core/json.js";
import { boundedText } from "./protocol.js";

export interface ThreadGoal extends JsonObject {
  threadId: string;
  objective: string;
  status:
    | "active"
    | "paused"
    | "blocked"
    | "usageLimited"
    | "budgetLimited"
    | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

const fields = [
  "threadId",
  "objective",
  "status",
  "tokenBudget",
  "tokensUsed",
  "timeUsedSeconds",
  "createdAt",
  "updatedAt",
] as const;
const statuses = new Set([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

export function threadGoal(value: unknown, id: string): ThreadGoal | undefined {
  if (
    !isObject(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some(
      (key) => !fields.includes(key as (typeof fields)[number]),
    ) ||
    value.threadId !== id ||
    typeof value.objective !== "string" ||
    typeof value.status !== "string" ||
    !statuses.has(value.status) ||
    !(
      value.tokenBudget === null ||
      (Number.isSafeInteger(value.tokenBudget) &&
        (value.tokenBudget as number) >= 0)
    ) ||
    ![
      value.tokensUsed,
      value.timeUsedSeconds,
      value.createdAt,
      value.updatedAt,
    ].every(
      (number) =>
        typeof number === "number" && Number.isFinite(number) && number >= 0,
    )
  )
    return;
  return { ...value } as ThreadGoal;
}

export function sameGoal(
  left: ThreadGoal | null | undefined,
  right: ThreadGoal | null | undefined,
): boolean {
  return (
    left === right ||
    (!!left && !!right && fields.every((field) => left[field] === right[field]))
  );
}

export interface ClearCompletedGoal {
  threadId: string;
  expectedGoal: ThreadGoal;
  expectedAccessGeneration: number;
}
export type GoalClearReason =
  | "notOwned"
  | "generationChanged"
  | "goalChanged"
  | "busy"
  | "unsupported";
export type CompletedGoalResult = JsonObject & {
  cleared: boolean;
  reason?: GoalClearReason;
};

export function clearCompletedGoalParams(value: unknown): ClearCompletedGoal {
  if (
    !isObject(value) ||
    Object.keys(value).some(
      (key) =>
        !["threadId", "expectedGoal", "expectedAccessGeneration"].includes(key),
    )
  )
    throw new HttpError(400, "Invalid completed goal clear parameters");
  const id = boundedText(value.threadId, 512, "threadId", true);
  const goal = threadGoal(value.expectedGoal, id);
  if (!goal || goal.status !== "complete")
    throw new HttpError(400, "Invalid expectedGoal");
  if (
    !Number.isSafeInteger(value.expectedAccessGeneration) ||
    (value.expectedAccessGeneration as number) < 0
  )
    throw new HttpError(400, "Invalid expectedAccessGeneration");
  return {
    threadId: id,
    expectedGoal: goal,
    expectedAccessGeneration: value.expectedAccessGeneration as number,
  };
}
