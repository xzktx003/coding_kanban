import { memoryHistoryWindows } from "./sessionMemoryHistory";
import { estimateTranscriptBytes } from "./codexTranscriptMemoryBudget";
import type { ServerNotification } from "../bindings";
import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { getReadingPosition } from "./sessionTranscriptCache";

export const OBSERVED_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
export const OBSERVED_TRANSCRIPT_TARGET_BYTES = 5 * 1024 * 1024;
export const OBSERVED_TRANSCRIPT_MIN_RECENT_TURNS = 4;

export interface TranscriptBudgetOptions {
  maxBytes?: number;
  targetBytes?: number;
  minRecentTurns?: number;
}

function eventTurnId(event: ServerNotification): string | undefined {
  if (event.method === "turn/started" || event.method === "turn/completed")
    return event.params.turn.id;
  return "turnId" in event.params
    ? (event.params.turnId ?? undefined)
    : undefined;
}

function completedTurnIds(events: ServerNotification[]) {
  const ids: string[] = [];
  for (const event of events) {
    if (
      event.method === "turn/completed" &&
      event.params.turn.status !== "inProgress"
    )
      ids.push(event.params.turn.id);
  }
  return ids;
}

function estimateEventBytes(event: ServerNotification) {
  return estimateTranscriptBytes(event);
}

function transcriptBytes(events: ServerNotification[]) {
  return events.reduce((sum, event) => sum + estimateEventBytes(event), 0);
}

function isReadingLatest(threadId: string) {
  const position = getReadingPosition(`codex:${threadId}`);
  return position?.atBottom ?? true;
}

export function pruneObservedCodexTranscriptBudget(
  threadId: string,
  options: TranscriptBudgetOptions = {},
) {
  if (!isReadingLatest(threadId) || memoryHistoryWindows.has(threadId))
    return 0;
  const {
    maxBytes = OBSERVED_TRANSCRIPT_MAX_BYTES,
    targetBytes = OBSERVED_TRANSCRIPT_TARGET_BYTES,
    minRecentTurns = OBSERVED_TRANSCRIPT_MIN_RECENT_TURNS,
  } = options;
  const events = useCodexStore.getState().events[threadId];
  if (!events?.length) return 0;
  let bytes = transcriptBytes(events);
  if (bytes <= maxBytes) return 0;

  const completed = completedTurnIds(events);
  const currentTurnId =
    useCodexStore.getState().turnTimingMap[threadId]?.turnId;
  const turnBytes = new Map<string, number>();
  for (const event of events) {
    const id = eventTurnId(event);
    if (!id) continue;
    turnBytes.set(id, (turnBytes.get(id) ?? 0) + estimateEventBytes(event));
  }
  const protectedTurns = new Set(
    completed.slice(Math.max(0, completed.length - minRecentTurns)),
  );
  if (currentTurnId) protectedTurns.add(currentTurnId);

  const removable = completed.filter((id) => !protectedTurns.has(id));
  const removeTurns = new Set<string>();
  let oldestRemovedTurnId: string | undefined;
  let released = 0;
  for (const id of removable) {
    removeTurns.add(id);
    oldestRemovedTurnId ??= id;
    released += turnBytes.get(id) ?? 0;
    if (bytes - released <= targetBytes) break;
  }
  if (!removeTurns.size || !oldestRemovedTurnId) return 0;

  const retained = events.filter(
    (event) => !removeTurns.has(eventTurnId(event) ?? ""),
  );
  if (retained.length === events.length) return 0;
  useCodexStore.setState((state) =>
    state.events[threadId] !== events
      ? state
      : {
          events: { ...state.events, [threadId]: retained },
          historyLoadedMap: { ...state.historyLoadedMap, [threadId]: true },
        },
  );
  useSessionSyncStore.setState((state) => ({
    trimmedHistoryAnchors: {
      ...state.trimmedHistoryAnchors,
      [threadId]: oldestRemovedTurnId,
    },
  }));
  return released;
}

export function clearTrimmedHistoryAnchor(threadId: string) {
  useSessionSyncStore.setState((state) => {
    if (!state.trimmedHistoryAnchors[threadId]) return state;
    const trimmedHistoryAnchors = { ...state.trimmedHistoryAnchors };
    delete trimmedHistoryAnchors[threadId];
    return { trimmedHistoryAnchors };
  });
}
