import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cachedTranscriptBaselines } from "./sessionCacheState";
import { hasTranscriptTrafficPressure } from "./sessionMemoryPressure";
import {
  compactCodexTranscript,
  estimateTranscriptBytes,
} from "./codexTranscriptMemoryBudget";

import {
  MEMORY_HISTORY_RESTART_CURSOR,
  MEMORY_ITEM_CURSOR,
  memoryHistoryWindows as readingWindows,
} from "./sessionMemoryHistory";
const MB = 1024 * 1024;
const THREAD_HIGH_BYTES = 8 * MB;
const GLOBAL_HIGH_BYTES = 32 * MB;
const GLOBAL_LOW_BYTES = 16 * MB;
function heapUnderPressure() {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return (
    !!memory &&
    memory.usedJSHeapSize > Math.min(256 * MB, memory.jsHeapSizeLimit * 0.7)
  );
}

/** Drop browser-owned display data. Native history, drafts and pending RPCs are untouched. */
export function releaseSessionMemory(options: { pressure?: boolean } = {}) {
  const state = useCodexStore.getState();
  const entries = Object.entries(state.events);
  const sizes = entries.map(([, events]) => estimateTranscriptBytes(events));
  const beforeBytes = sizes.reduce((sum, size) => sum + size, 0);
  const pressure =
    options.pressure ?? (heapUnderPressure() || hasTranscriptTrafficPressure());
  const globalPressure = beforeBytes > GLOBAL_HIGH_BYTES || pressure;
  const perThread = Math.min(
    pressure ? 4 * MB : THREAD_HIGH_BYTES,
    GLOBAL_LOW_BYTES / Math.max(1, entries.length),
  );
  let events = state.events;
  const trimmedIds: string[] = [];
  const recoveryCursors: Record<string, string> = {};
  const changedIds: string[] = [];
  entries.forEach(([id, transcript]) => {
    if (useSessionSyncStore.getState().earlierLoading[id]) return;
    const timing = state.turnTimingMap[id];
    const compacted = compactCodexTranscript(transcript, {
      maxBytes: globalPressure ? perThread : THREAD_HIGH_BYTES,
      targetBytes: globalPressure ? perThread * 0.5 : THREAD_HIGH_BYTES * 0.5,
      maxEvents: pressure ? 1500 : 3000,
      targetEvents: pressure ? 750 : 1500,
      activeTurnId: timing?.status === "inProgress" ? timing.turnId : undefined,
      protectedTurnIds:
        pressure || (globalPressure && id !== state.currentThreadId)
          ? undefined
          : readingWindows.get(id),
    });
    if (compacted.events === transcript) return;
    if (events === state.events) events = { ...events };
    events[id] = compacted.events;
    changedIds.push(id);
    cachedTranscriptBaselines.delete(id);
    if (
      compacted.sameTurnTrimmedEventCount &&
      compacted.truncatedTurnIds.length
    ) {
      const turnId = compacted.truncatedTurnIds[0];
      const first = compacted.events.find(
        (event) =>
          (event.method === "item/started" ||
            event.method === "item/completed") &&
          event.params.turnId === turnId &&
          !["userMessage", "collabAgentToolCall", "subAgentActivity"].includes(
            event.params.item.type,
          ),
      );
      if (
        first &&
        (first.method === "item/started" || first.method === "item/completed")
      ) {
        trimmedIds.push(id);
        recoveryCursors[id] =
          MEMORY_ITEM_CURSOR +
          encodeURIComponent(
            JSON.stringify({ turnId, beforeItemId: first.params.item.id }),
          );
      }
    }
    if (compacted.evicted && !recoveryCursors[id]) {
      trimmedIds.push(id);
      recoveryCursors[id] =
        MEMORY_HISTORY_RESTART_CURSOR +
        encodeURIComponent(compacted.oldestTurnId ?? "");
    }
  });
  // Older display retention can leave a trim anchor without a native cursor.
  // Convert it to the same bounded recovery path instead of reloading all turns.
  const sync = useSessionSyncStore.getState() as ReturnType<
    typeof useSessionSyncStore.getState
  > & { trimmedHistoryAnchors?: Record<string, string> };
  const legacyAnchors = { ...sync.trimmedHistoryAnchors };
  for (const id of Object.keys(legacyAnchors)) {
    if (recoveryCursors[id]) {
      delete legacyAnchors[id];
      continue;
    }
    if (
      !events[id]?.length ||
      useSessionSyncStore.getState().earlierLoading[id]
    )
      continue;
    const first = events[id].find(
      (event) => "turnId" in event.params || "turn" in event.params,
    );
    const turnId =
      first &&
      ("turnId" in first.params
        ? first.params.turnId
        : "turn" in first.params
          ? first.params.turn.id
          : undefined);
    recoveryCursors[id] =
      MEMORY_HISTORY_RESTART_CURSOR + encodeURIComponent(turnId ?? "");
    if (!trimmedIds.includes(id)) trimmedIds.push(id);
    delete legacyAnchors[id];
  }
  if (trimmedIds.length)
    useSessionSyncStore.setState({
      cursors: { ...sync.cursors, ...recoveryCursors },
      ...(sync.trimmedHistoryAnchors
        ? { trimmedHistoryAnchors: legacyAnchors }
        : {}),
    });
  // Command maps are keyed by item, not thread, and otherwise grow forever.
  const commandIds = new Set<string>();
  for (const transcript of Object.values(events))
    for (const event of transcript)
      if (
        (event.method === "item/started" ||
          event.method === "item/completed") &&
        event.params.item.type === "commandExecution"
      )
        commandIds.add(event.params.item.id);
  const prune = <T>(map: Record<string, T>) => {
    const keys = Object.keys(map);
    return keys.every((key) => commandIds.has(key))
      ? map
      : Object.fromEntries(
          keys
            .filter((key) => commandIds.has(key))
            .map((key) => [key, map[key]]),
        );
  };
  const commandStatusMap = prune(state.commandStatusMap);
  const commandDurationMap = prune(state.commandDurationMap);
  // Metadata must not keep the same heavyweight item bodies alive after eviction.
  let threads = state.threads;
  if (changedIds.length) {
    const trimmed = new Set(changedIds);
    threads = state.threads.map((thread) =>
      trimmed.has(thread.id) && thread.turns.some((turn) => turn.items.length)
        ? {
            ...thread,
            turns: thread.turns.map((turn) => ({ ...turn, items: [] })),
          }
        : thread,
    );
  }
  if (
    events !== state.events ||
    commandStatusMap !== state.commandStatusMap ||
    commandDurationMap !== state.commandDurationMap ||
    threads !== state.threads
  )
    useCodexStore.setState({
      events,
      threads,
      commandStatusMap,
      commandDurationMap,
    });
  for (const id of readingWindows.keys())
    if (!events[id]) readingWindows.delete(id);
  return {
    beforeBytes,
    afterBytes: Object.values(events).reduce(
      (sum, transcript) => sum + estimateTranscriptBytes(transcript),
      0,
    ),
  };
}

export function startSessionMemoryGovernor() {
  let stopped = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (!stopped) releaseSessionMemory();
  };
  const stop = useCodexStore.subscribe((state, previous) => {
    if (state.events === previous.events || pending || stopped) return;
    pending = setTimeout(() => {
      pending = undefined;
      run();
    }, 250);
  });
  const interval = setInterval(run, 5000);
  const visibility = () => {
    if (document.visibilityState === "hidden") run();
  };
  document.addEventListener("visibilitychange", visibility);
  run();
  return () => {
    stopped = true;
    stop();
    if (pending) clearTimeout(pending);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", visibility);
    readingWindows.clear();
  };
}
