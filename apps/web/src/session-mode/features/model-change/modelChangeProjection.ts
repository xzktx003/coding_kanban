import type { ServerNotification } from "@session/bindings";
import type { TranscriptWorkRow } from "@session/components/codex/thread/turnWork";
import type { ModelChangeAnnouncement } from "./modelChangeTranscript";

function rowTurnId(threadId: string, row: TranscriptWorkRow): string | null {
  if (row.work) return row.work.threadId === threadId ? row.work.turnId : null;
  if (row.activity) return row.activity.threadId === threadId ? row.activity.turnId : null;
  if (row.activityEntry) return row.activityEntry.threadId === threadId ? row.activityEntry.turnId : null;
  if (row.item.kind === "cmdGroup") {
    const source = [...row.item.actionSources].reverse().find((item) => item.threadId === threadId && item.turnId);
    return source?.turnId ?? null;
  }
  const event: ServerNotification = row.item.event;
  if (!("threadId" in event.params) || event.params.threadId !== threadId) return null;
  if (event.method === "turn/started" || event.method === "turn/completed") return event.params.turn.id;
  return "turnId" in event.params && typeof event.params.turnId === "string" ? event.params.turnId : null;
}

/** Place only after an exact visible turn. Incomplete history does not justify
 * guessing a position, and native transcript rows remain unchanged. */
export function projectModelChangeSlots(
  threadId: string,
  rows: readonly TranscriptWorkRow[],
  changes: readonly ModelChangeAnnouncement[],
) {
  const result = new Map<string, ModelChangeAnnouncement[]>();
  if (!changes.length) return result;
  const lastRows = new Map<string, string>();
  for (const row of rows) {
    const turnId = rowTurnId(threadId, row);
    if (turnId) lastRows.set(turnId, row.key);
  }
  for (const change of changes) {
    if (change.threadId !== threadId) continue;
    const key = lastRows.get(change.afterTurnId);
    if (!key) continue;
    const slot = result.get(key) ?? [];
    slot.push(change);
    result.set(key, slot);
  }
  return result;
}
