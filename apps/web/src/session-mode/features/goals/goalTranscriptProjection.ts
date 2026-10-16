import type { ServerNotification } from "@session/bindings";
import type { TranscriptWorkRow } from "@session/components/codex/thread/turnWork";
import type { GoalAnnouncement } from "./goalTranscript";

export interface GoalTranscriptSlots {
  before: readonly GoalAnnouncement[];
  afterRow: ReadonlyMap<string, readonly GoalAnnouncement[]>;
  /** An incomplete history cannot prove this captured native anchor's position. */
  unplaced: readonly GoalAnnouncement[];
}
const EMPTY: readonly GoalAnnouncement[] = Object.freeze([]);
const EMPTY_SLOTS: GoalTranscriptSlots = {
  before: EMPTY,
  afterRow: new Map(),
  unplaced: EMPTY,
};

function eventTurnId(
  threadId: string,
  event: ServerNotification,
): string | null {
  if (!("threadId" in event.params) || event.params.threadId !== threadId)
    return null;
  if (event.method === "turn/started" || event.method === "turn/completed")
    return event.params.turn.id;
  return "turnId" in event.params &&
    typeof event.params.turnId === "string" &&
    event.params.turnId
    ? event.params.turnId
    : null;
}

function rowTurnId(threadId: string, row: TranscriptWorkRow): string | null {
  if (row.work) return row.work.threadId === threadId ? row.work.turnId : null;
  if (row.activity)
    return row.activity.threadId === threadId ? row.activity.turnId : null;
  if (row.activityEntry)
    return row.activityEntry.threadId === threadId
      ? row.activityEntry.turnId
      : null;
  if (row.item.kind === "cmdGroup") {
    for (let index = row.item.actionSources.length - 1; index >= 0; index--) {
      const source = row.item.actionSources[index];
      if (source.threadId === threadId && source.turnId) return source.turnId;
    }
    return null;
  }
  return eventTurnId(threadId, row.item.event);
}

/**
 * Index native identities once, without reading message/tool bodies. Native
 * rows, rollback contexts, lifecycle and workflow navigation stay untouched.
 * Slots follow the whole captured native turn, including later streamed items.
 */
export function projectGoalTranscriptSlots(
  threadId: string,
  rows: readonly TranscriptWorkRow[],
  announcements: readonly GoalAnnouncement[],
  events: readonly ServerNotification[],
): GoalTranscriptSlots {
  if (!announcements.length) return EMPTY_SLOTS;
  const eligible = announcements.filter((entry) => entry.threadId === threadId);
  if (!eligible.length) return EMPTY_SLOTS;
  if (!rows.length)
    return {
      before:
        announcements.length === eligible.length ? announcements : eligible,
      afterRow: new Map(),
      unplaced: EMPTY,
    };
  const order = new Map<string, number>();
  for (const event of events) {
    const id = eventTurnId(threadId, event);
    if (id && !order.has(id)) order.set(id, order.size);
  }
  const lastRows = new Map<string, number>();
  const prefixLastRow = Array<number>(order.size).fill(-1);
  rows.forEach((row, index) => {
    const id = rowTurnId(threadId, row);
    if (!id) return;
    lastRows.set(id, index);
    const rank = order.get(id);
    if (rank !== undefined)
      prefixLastRow[rank] = Math.max(prefixLastRow[rank], index);
  });
  for (let index = 1; index < prefixLastRow.length; index++)
    prefixLastRow[index] = Math.max(
      prefixLastRow[index],
      prefixLastRow[index - 1],
    );
  const before: GoalAnnouncement[] = [];
  const afterRow = new Map<string, GoalAnnouncement[]>();
  const unplaced: GoalAnnouncement[] = [];
  for (const entry of eligible) {
    let row = -1;
    if (entry.afterTurnId !== null) {
      const exact = lastRows.get(entry.afterTurnId);
      const rank = order.get(entry.afterTurnId);
      if (exact !== undefined) row = exact;
      else if (rank !== undefined) row = prefixLastRow[rank];
      else {
        unplaced.push(entry);
        continue;
      }
    }
    if (row < 0) before.push(entry);
    else {
      const key = rows[row].key;
      const entries = afterRow.get(key) ?? [];
      entries.push(entry);
      afterRow.set(key, entries);
    }
  }
  return { before, afterRow, unplaced };
}
