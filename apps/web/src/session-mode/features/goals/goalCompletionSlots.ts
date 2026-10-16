import type { ServerNotification } from "@session/bindings";
import type { TranscriptWorkRow } from "@session/components/codex/thread/turnWork";
import type { GoalCompletionTarget } from "./goalCompletion";

function owner(row: TranscriptWorkRow) {
  if (row.work) return row.work;
  if (row.activity) return row.activity;
  if (row.activityEntry) return row.activityEntry;
  if (row.item.kind === "cmdGroup") return row.item.actionSources[0];
  const event = row.item.event;
  if (!("threadId" in event.params)) return null;
  const turnId =
    event.method === "turn/completed" || event.method === "turn/started"
      ? event.params.turn.id
      : "turnId" in event.params
        ? event.params.turnId
        : null;
  return { threadId: event.params.threadId, turnId };
}

/** A view slot after the selected native turn; it never creates native events. */
export function goalCompletionFallbackSlot(
  threadId: string,
  target: GoalCompletionTarget | null,
  rows: readonly TranscriptWorkRow[],
  events: readonly ServerNotification[],
): { afterRow: string | null } | null {
  if (!target || target.itemId !== null) return null;
  let last: string | null = null;
  for (const row of rows) {
    const identity = owner(row);
    if (identity?.threadId === threadId && identity.turnId === target.turnId)
      last = row.key;
  }
  if (last) return { afterRow: last };
  const order = new Map<string, number>();
  for (const event of events) {
    if (!("threadId" in event.params) || event.params.threadId !== threadId)
      continue;
    const turnId =
      event.method === "turn/started" || event.method === "turn/completed"
        ? event.params.turn.id
        : "turnId" in event.params
          ? event.params.turnId
          : null;
    if (turnId && !order.has(turnId)) order.set(turnId, order.size);
  }
  const position = order.get(target.turnId);
  if (position === undefined) return rows.length ? null : { afterRow: null };
  for (const row of rows) {
    const identity = owner(row);
    if (identity?.threadId !== threadId || !identity.turnId) continue;
    const index = order.get(identity.turnId);
    if (index !== undefined && index < position) last = row.key;
  }
  return { afterRow: last };
}
