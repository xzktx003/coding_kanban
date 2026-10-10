import { withoutToolTranscriptEvents } from "./codexTranscriptVisibility";
import { useCodexStore } from "../components/codex/stores";
import { isIgnoredTranscriptEvent } from "../components/codex/stores/eventUtils";
import { useSubagentStore } from "../features/subagents/store";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { cancelCodexHistoryRead } from "./codexService";
import { isObservedCodexThread } from "./observedCodexThreads";
import { pruneObservedCodexTranscriptBudget } from "./sessionTranscriptBudget";
import {
  cachedTranscriptBaselines,
  cachedTranscriptTimings,
} from "./sessionCacheState";

const deleteKey = <T>(
  record: Record<string, T>,
  id: string,
): Record<string, T> => {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
};

function retentionReady() {
  const tabs = useAgentCenterStore.getState();
  return (
    tabs.sharedTabsInitialized ||
    tabs.pendingTabOperations.length > 0 ||
    tabs.cards.some((card) => card.kind === "codex") ||
    tabs.detachedCard?.kind === "codex" ||
    !!useCodexStore.getState().currentThreadId
  );
}

function knownTranscriptIds() {
  const state = useCodexStore.getState();
  return new Set([
    ...Object.keys(state.events),
    ...Object.keys(state.historyLoadedMap),
    ...Object.keys(state.historyLoadingMap),
    ...Object.keys(state.historyErrorMap),
    ...Object.keys(state.streamingAgentMessages ?? {}),
    ...state.threads
      .filter((thread) => thread.turns.length > 0)
      .map((thread) => thread.id),
    ...Object.keys(useSessionSyncStore.getState().cursors),
    ...cachedTranscriptBaselines.keys(),
    ...cachedTranscriptTimings.keys(),
  ]);
}

function pruneThreadTranscript(id: string) {
  cancelCodexHistoryRead(id);
  cachedTranscriptBaselines.delete(id);
  cachedTranscriptTimings.delete(id);

  useCodexStore.setState((state) => {
    const events = deleteKey(state.events, id);
    const streamingAgentMessages = deleteKey(
      state.streamingAgentMessages ?? {},
      id,
    );
    const historyLoadedMap = deleteKey(state.historyLoadedMap, id);
    const historyLoadingMap = deleteKey(state.historyLoadingMap, id);
    const historyErrorMap = deleteKey(state.historyErrorMap, id);
    const retryNoticeMap = deleteKey(state.retryNoticeMap, id);
    let threads = state.threads;
    const threadIndex = state.threads.findIndex(
      (thread) => thread.id === id && thread.turns.length > 0,
    );
    if (threadIndex >= 0) {
      threads = [...state.threads];
      threads[threadIndex] = { ...threads[threadIndex], turns: [] };
    }
    if (
      events === state.events &&
      streamingAgentMessages === state.streamingAgentMessages &&
      historyLoadedMap === state.historyLoadedMap &&
      historyLoadingMap === state.historyLoadingMap &&
      historyErrorMap === state.historyErrorMap &&
      retryNoticeMap === state.retryNoticeMap &&
      threads === state.threads
    )
      return state;
    return {
      events,
      streamingAgentMessages,
      historyLoadedMap,
      historyLoadingMap,
      historyErrorMap,
      retryNoticeMap,
      threads,
    };
  });

  useSessionSyncStore.setState((state) => {
    const checking = deleteKey(state.checking, id);
    const recovering = deleteKey(state.recovering, id);
    const cursors = deleteKey(state.cursors, id);
    const trimmedHistoryAnchors = deleteKey(state.trimmedHistoryAnchors, id);
    const earlierLoading = deleteKey(state.earlierLoading, id);
    const earlierErrors = deleteKey(state.earlierErrors, id);
    if (
      checking === state.checking &&
      recovering === state.recovering &&
      cursors === state.cursors &&
      trimmedHistoryAnchors === state.trimmedHistoryAnchors &&
      earlierLoading === state.earlierLoading &&
      earlierErrors === state.earlierErrors
    )
      return state;
    return {
      checking,
      recovering,
      cursors,
      trimmedHistoryAnchors,
      earlierLoading,
      earlierErrors,
    };
  });
}

function compactObservedHiddenTranscriptEvents() {
  useCodexStore.setState((state) => {
    let events = state.events;
    for (const [id, threadEvents] of Object.entries(state.events)) {
      if (!isObservedCodexThread(id)) continue;
      const visibleEvents = withoutToolTranscriptEvents(threadEvents).filter(
        (event) => !isIgnoredTranscriptEvent(event),
      );
      if (
        visibleEvents.length === threadEvents.length &&
        visibleEvents.every((event, index) => event === threadEvents[index])
      )
        continue;
      if (events === state.events) events = { ...state.events };
      events[id] = visibleEvents;
      cachedTranscriptBaselines.delete(id);
    }
    return events === state.events ? state : { events };
  });
}

export function pruneUnobservedCodexTranscripts() {
  if (!retentionReady()) return;
  for (const id of knownTranscriptIds()) {
    if (!isObservedCodexThread(id)) pruneThreadTranscript(id);
    else if (pruneObservedCodexTranscriptBudget(id) > 0)
      cancelCodexHistoryRead(id);
  }
}

export function startSessionTranscriptRetention() {
  let stopped = false;
  let queued = false;
  const schedule = () => {
    if (stopped || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!stopped) pruneUnobservedCodexTranscripts();
    });
  };
  compactObservedHiddenTranscriptEvents();
  const stops = [
    useAgentCenterStore.subscribe(schedule),
    useCodexStore.subscribe((state, previous) => {
      if (
        state.currentThreadId !== previous.currentThreadId ||
        state.threads !== previous.threads ||
        state.historyLoadedMap !== previous.historyLoadedMap ||
        state.historyLoadingMap !== previous.historyLoadingMap ||
        state.historyErrorMap !== previous.historyErrorMap
      )
        schedule();
    }),
    useSubagentStore.subscribe(schedule),
    useSessionSyncStore.subscribe(schedule),
  ];
  schedule();
  return () => {
    stopped = true;
    for (const stop of stops) stop();
  };
}
