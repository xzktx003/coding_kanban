import { useCodexStore } from "../components/codex/stores";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cachedTranscriptBaselines } from "./sessionCacheState";
import { hasTranscriptTrafficPressure } from "./sessionMemoryPressure";
import {
  compactCodexTranscript,
  estimateTranscriptBytes,
  CODEX_TRANSCRIPT_MAX_BYTES,
  CODEX_TRANSCRIPT_MAX_EVENTS,
} from "./codexTranscriptMemoryBudget";

import {
  clearMemoryHistoryWindow,
  clearMemoryHistoryWindows,
  MEMORY_HISTORY_RESTART_CURSOR,
  transcriptBudgetRecoveryCursor,
  memoryHistoryWindows as readingWindows,
} from "./sessionMemoryHistory";
const MB = 1024 * 1024;
const THREAD_HIGH_BYTES = CODEX_TRANSCRIPT_MAX_BYTES;
const GLOBAL_HIGH_BYTES = 32 * MB;
const GLOBAL_LOW_BYTES = 16 * MB;
// Paging a long history end to end is the feature, so the thread being read
// gets a much larger allowance than the background ones. Real heap pressure
// still overrides both, and other threads keep the original budget.
const READING_THREAD_EVENTS = 120000;
const READING_THREAD_BYTES = 256 * MB;
// Relative to this device's own limit. A fixed 256MB cap reported pressure at
// ~21% heap use on a 4GB limit, so every tick fought the reader for bytes the
// transcripts did not even hold.
const HEAP_ELEVATED = 0.55;
const HEAP_HIGH = 0.7;
function heapFraction() {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return memory && memory.jsHeapSizeLimit > 0
    ? memory.usedJSHeapSize / memory.jsHeapSizeLimit
    : 0;
}
function heapUnderPressure() {
  return heapFraction() > HEAP_HIGH;
}

/** Drop browser-owned display data. Native history, drafts and pending RPCs are untouched. */
export function releaseSessionMemory(options: { pressure?: boolean } = {}) {
  const state = useCodexStore.getState();
  const entries = Object.entries(state.events);
  const sizes = entries.map(([, events]) => estimateTranscriptBytes(events));
  const beforeBytes = sizes.reduce((sum, size) => sum + size, 0);
  const pressure =
    options.pressure ?? (heapUnderPressure() || hasTranscriptTrafficPressure());
  // The thread being read is excluded from the shared total: a deliberately
  // paged-back history would otherwise trip the global ceiling by itself and
  // cancel its own allowance.
  const backgroundBytes = entries.reduce(
    (sum, [id], index) =>
      id === state.currentThreadId ? sum : sum + sizes[index],
    0,
  );
  const globalPressure = backgroundBytes > GLOBAL_HIGH_BYTES || pressure;
  // A single threshold leaves background threads at the full allowance until it
  // trips and then at the tightest one, which oscillates around the boundary.
  const elevated = !pressure && heapFraction() > HEAP_ELEVATED;
  const backgroundBudget = pressure
    ? 4 * MB
    : elevated
      ? 6 * MB
      : THREAD_HIGH_BYTES;
  const backgroundEvents = pressure
    ? 1500
    : elevated
      ? Math.round(CODEX_TRANSCRIPT_MAX_EVENTS * 0.75)
      : CODEX_TRANSCRIPT_MAX_EVENTS;
  const perThread = Math.min(
    backgroundBudget,
    GLOBAL_LOW_BYTES / Math.max(1, entries.length),
  );
  let events = state.events;
  const trimmedIds: string[] = [];
  const recoveryCursors: Record<string, string> = {};
  const changedIds: string[] = [];
  entries.forEach(([id, transcript]) => {
    const timing = state.turnTimingMap[id];
    // Paging a long history to its start is the feature being protected, so the
    // thread on screen keeps what it paged back. The allowance follows the
    // pinned reading window rather than the selection alone: an unread
    // transcript that merely happens to be selected must stay inside the
    // display budget, which is what the admission path depends on.
    const reading =
      id === state.currentThreadId && !!readingWindows.get(id)?.size;
    const maxBytes = reading
      ? READING_THREAD_BYTES
      : globalPressure
        ? perThread
        : backgroundBudget;
    const compacted = compactCodexTranscript(transcript, {
      maxBytes,
      targetBytes: maxBytes * 0.5,
      maxEvents: reading ? READING_THREAD_EVENTS : backgroundEvents,
      targetEvents: reading ? READING_THREAD_EVENTS / 2 : backgroundEvents / 2,
      activeTurnId: timing?.status === "inProgress" ? timing.turnId : undefined,
      // The viewed thread keeps its just-recovered page even under pressure:
      // trimming it back makes "load earlier" a no-op the reader cannot escape.
      protectedTurnIds:
        id === state.currentThreadId ? readingWindows.get(id) : undefined,
    });
    if (
      compacted.events === transcript ||
      (compacted.events.length === transcript.length &&
        compacted.events.every((event, index) => event === transcript[index]))
    )
      return;
    if (events === state.events) events = { ...events };
    events[id] = compacted.events;
    changedIds.push(id);
    cachedTranscriptBaselines.delete(id);
    const cursor = transcriptBudgetRecoveryCursor(compacted);
    if (cursor) {
      trimmedIds.push(id);
      recoveryCursors[id] = cursor;
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
    if (!events[id]) clearMemoryHistoryWindow(id);
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
  let releaseInProgress = false;
  const overPublishedEventLimit = (
    state: ReturnType<typeof useCodexStore.getState>,
    previous: ReturnType<typeof useCodexStore.getState>,
  ) => {
    for (const [id, events] of Object.entries(state.events)) {
      if (events === previous.events[id]) continue;
      // Explicitly paged history keeps its larger reading allowance and the
      // existing deferred pass. Only unread bulk snapshots need this fast path.
      if (id === state.currentThreadId && readingWindows.get(id)?.size) continue;
      if (events.length > CODEX_TRANSCRIPT_MAX_EVENTS) return true;
    }
    return false;
  };
  const run = () => {
    if (stopped || releaseInProgress) return;
    releaseInProgress = true;
    try {
      releaseSessionMemory();
    } finally {
      releaseInProgress = false;
    }
  };
  const stop = useCodexStore.subscribe((state, previous) => {
    if (state.events === previous.events || stopped || releaseInProgress) return;
    // Avoid rendering an oversized recovery snapshot and then replacing it
    // again after the debounce. Normal streams retain the existing schedule.
    if (overPublishedEventLimit(state, previous)) {
      if (pending) clearTimeout(pending);
      pending = undefined;
      run();
      return;
    }
    if (pending) return;
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
    clearMemoryHistoryWindows();
  };
}
