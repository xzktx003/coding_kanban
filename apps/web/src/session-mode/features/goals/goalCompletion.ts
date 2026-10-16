import type { ServerNotification } from "@session/bindings";
import type { ThreadGoal, Turn } from "@session/bindings/v2";
import { readQuestions } from "@session/features/async-questions/model";

type CompletionTurn = Pick<Turn, "id" | "startedAt" | "status">;
export interface GoalCompletionTarget {
  turnId: string;
  itemId: string | null;
}

/** Official Fp: the first eligible turn must be completed; never skip a failure. */
export function completedGoalTurnId(
  turns: readonly CompletionTurn[],
  goal: ThreadGoal,
): string | null {
  if (goal.status !== "complete") return null;
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn.startedAt != null && turn.startedAt > goal.updatedAt) continue;
    return turn.status === "completed" ? turn.id : null;
  }
  return null;
}

/**
 * Derive only identities and lifecycle metadata from the existing bounded view.
 * No history request, copied message body, timer, or retained transcript cache.
 */
export function projectGoalCompletion(
  threadId: string,
  goal: ThreadGoal | undefined,
  events: readonly ServerNotification[],
  loadedTurns: readonly Turn[],
): GoalCompletionTarget | null {
  if (!goal || goal.threadId !== threadId || goal.status !== "complete")
    return null;
  const turns = new Map<string, CompletionTurn>();
  const replies = new Map<string, string>();
  const fallbackReplies = new Map<string, string>();
  const rememberItem = (turnId: string, item: Turn["items"][number]) => {
    if (
      item.type !== "agentMessage" ||
      !item.text.trim() ||
      readQuestions(item).length
    )
      return;
    fallbackReplies.set(turnId, item.id);
    if (item.phase !== "commentary") replies.set(turnId, item.id);
  };
  for (const turn of loadedTurns) {
    turns.set(turn.id, {
      id: turn.id,
      startedAt: turn.startedAt,
      status: turn.status,
    });
    for (const item of turn.items) rememberItem(turn.id, item);
  }
  for (const event of events) {
    if (!("threadId" in event.params) || event.params.threadId !== threadId)
      continue;
    if (event.method === "turn/started" || event.method === "turn/completed") {
      const turn = event.params.turn;
      turns.set(turn.id, {
        id: turn.id,
        startedAt: turn.startedAt ?? turns.get(turn.id)?.startedAt ?? null,
        status: turn.status,
      });
      if (event.method === "turn/completed")
        for (const item of turn.items) rememberItem(turn.id, item);
    } else if (event.method === "item/completed") {
      rememberItem(event.params.turnId, event.params.item);
    }
  }
  const turnId = completedGoalTurnId([...turns.values()], goal);
  if (!turnId) return null;
  const itemId = replies.get(turnId) ?? fallbackReplies.get(turnId);
  return { turnId, itemId: itemId ?? null };
}
