import {
  useCodexDeliveryStore,
  deliveredClientIds,
} from "../stores/useCodexDeliveryStore";
import { useSessionAttentionStore } from "../stores/useSessionAttentionStore";
import { setSessionRecovery } from "../stores/useSessionSyncStore";
import { useFollowupStore } from "./followupService";
import { reconcileEventStream } from "../lib/eventStream";
import { useCodexStore } from "../components/codex/stores";
import { openEventStream } from "../lib/eventStream";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { codexService } from "./codexService";
import { openedCodexIds } from "./openedSessions";
import { cachedTranscriptTimings } from "./sessionCacheState";

/** Hydrate followed Codex histories independently of which transcript is mounted.
 * Recovery uses read-only history, never execution ownership or message resubmission. */
export function startFollowedSessionHistorySync() {
  let stopped = false;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let immediateScheduled = false;
  const wanted = new Map<string, number>();
  const done = new Map<string, number>();
  const retryAt = new Map<string, number>();
  const loading = new Set<string>();
  const lastSignal = new Map<string, number>();
  const checked = new Map<string, number>();
  const pendingSince = new Map<string, number>();
  const repairing = new Set<string>();
  const attempts = new Map<string, number>();
  const retryRequested = new Set<string>();
  const controllers = new Map<string, AbortController>();
  let wokeAt = -Infinity;

  const ids = () => {
    return openedCodexIds();
  };
  function repair(id: string) {
    if (stopped || !ids().includes(id)) return;
    repairing.add(id);
    if (wanted.get(id) === done.get(id) || !wanted.has(id))
      wanted.set(id, (wanted.get(id) ?? 0) + 1);
    schedule();
  }
  function schedule(delay = 0) {
    if (stopped) return;
    if (delay === 0) {
      clearTimeout(timer);
      if (immediateScheduled) return;
      immediateScheduled = true;
      queueMicrotask(() => {
        immediateScheduled = false;
        if (!stopped) pump();
      });
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(pump, delay);
  }
  function enqueue(force = false) {
    if (stopped) return;
    const members = new Set(ids());
    for (const id of wanted.keys())
      if (!members.has(id)) {
        wanted.delete(id);
        controllers.get(id)?.abort();
        done.delete(id);
        retryAt.delete(id);
        checked.delete(id);
        lastSignal.delete(id);
        attempts.delete(id);
        retryRequested.delete(id);
        repairing.delete(id);
        setSessionRecovery(id);
      }
    for (const id of members) {
      if (force) {
        wanted.set(id, (wanted.get(id) ?? 0) + 1);
        retryAt.delete(id);
      } else if (!wanted.has(id)) wanted.set(id, 1);
    }
    schedule();
  }
  function pump() {
    if (stopped) return;
    const selected = useAgentCenterStore.getState().currentAgentCardId;
    const members = ids().sort(
      (a, b) => Number(b === selected) - Number(a === selected),
    );
    let nextRetry = Infinity;
    for (const id of members) {
      const revision = wanted.get(id);
      if (
        revision === undefined ||
        revision === done.get(id) ||
        loading.has(id)
      )
        continue;
      const delay = (retryAt.get(id) ?? 0) - Date.now();
      if (delay > 0) {
        nextRetry = Math.min(nextRetry, delay);
        continue;
      }
      if (loading.size >= 4) continue;
      loading.add(id);
      const controller = new AbortController();
      controllers.set(id, controller);
      const baseline = useCodexStore.getState();
      const beforeEvents = baseline.events[id];
      const beforeTiming =
        cachedTranscriptTimings.get(id) ?? baseline.turnTimingMap[id];
      const wasLoaded = baseline.historyLoadedMap[id];
      void codexService
        .loadThreadHistory(id, undefined, {
          background: true,
          recent: true,
          signal: controller.signal,
        })
        .then(
          () => {
            if (!stopped && wanted.has(id)) {
              done.set(id, revision);
              checked.set(id, Date.now());
              retryAt.delete(id);
              attempts.delete(id);
              retryRequested.delete(id);
              const current = useCodexStore.getState();
              // Only a newly completed, previously observed turn creates unread state.
              // A cold history load must not announce old replies.
              const timing = current.turnTimingMap[id];
              if (
                (wasLoaded || cachedTranscriptTimings.has(id)) &&
                timing?.status === "completed" &&
                beforeTiming &&
                ((beforeTiming.turnId === timing.turnId &&
                  beforeTiming.status === "inProgress") ||
                  (beforeTiming.turnId !== timing.turnId &&
                    timing.startedAtMs > beforeTiming.startedAtMs))
              )
                useSessionAttentionStore
                  .getState()
                  .complete("codex", id, timing.turnId);
              cachedTranscriptTimings.delete(id);
              if (repairing.delete(id)) {
                setSessionRecovery(id);
              }
            }
          },
          () => {
            if (!stopped && wanted.has(id)) {
              if (retryRequested.delete(id)) {
                retryAt.delete(id);
                attempts.delete(id);
                return;
              }
              const failures = (attempts.get(id) ?? 0) + 1;
              attempts.set(id, failures);
              retryAt.set(
                id,
                Date.now() + Math.min(30000, 5000 * 2 ** (failures - 1)),
              );
              setSessionRecovery(id, "retrying");
            }
          },
        )
        .finally(() => {
          loading.delete(id);
          controllers.delete(id);
          schedule();
        });
    }
    if (Number.isFinite(nextRetry)) schedule(nextRetry);
  }
  const unsubscribe = useAgentCenterStore.subscribe((state, previous) => {
    if (
      state.cards !== previous.cards ||
      state.detachedCard !== previous.detachedCard
    )
      enqueue();
  });
  const closeStream = openEventStream({
    agents: ["codex"],
    onEvent: (event) => {
      const p = event.payload as {
        params?: { threadId?: string; thread?: { id?: string } };
      };
      const id = p?.params?.threadId ?? p?.params?.thread?.id;
      if (id) lastSignal.set(id, Date.now());
    },
    onResync: () => {
      for (const id of ids()) repair(id);
    },
    onOpen: () => {
      // The initial connection and initial restore are one hydration pass.
      if (opened) enqueue(true);
      opened = true;
    },
  });
  const stopQueues = useFollowupStore.subscribe((next, previous) => {
    for (const id of ids()) {
      if (
        previous.threads[id]?.awaitingTurnId &&
        !next.threads[id]?.awaitingTurnId
      )
        repair(id);
    }
  });
  const manual = (event: Event) => {
    const id = (event as CustomEvent).detail;
    if (typeof id === "string") {
      retryAt.delete(id);
      attempts.delete(id);
      if (loading.has(id)) retryRequested.add(id);
      repair(id);
    }
  };
  window.addEventListener("session-history-reconcile", manual);
  const watchdog = setInterval(() => {
    if (stopped || document.visibilityState === "hidden") return;
    const state = useCodexStore.getState();
    const entries = Object.values(useCodexDeliveryStore.getState().entries);
    const outstanding = new Set<string>();
    for (const id of ids()) {
      const sent = entries.filter(
        (e) => e.threadId === id && e.status === "sent",
      );
      // Idle tabs can have very large histories; only scan them for an actual receipt.
      const acknowledged = sent.length
        ? deliveredClientIds(state.events[id] ?? [])
        : new Set<string>();
      const missing = sent.filter((e) => !acknowledged.has(e.id));
      for (const e of missing) {
        const key = JSON.stringify([id, e.id]);
        outstanding.add(key);
        if (!pendingSince.has(key)) pendingSince.set(key, Date.now());
      }
      const waiting = missing.some(
        (e) =>
          Date.now() - pendingSince.get(JSON.stringify([id, e.id]))! >= 3000,
      );
      const running =
        state.threadStatusMap[id]?.type === "active" ||
        state.turnTimingMap[id]?.status === "inProgress" ||
        !!useFollowupStore.getState().threads[id]?.awaitingTurnId;
      const quiet = Date.now() - (checked.get(id) ?? 0);
      if (
        !loading.has(id) &&
        wanted.get(id) === done.get(id) &&
        ((waiting && quiet >= 3000) ||
          (running && quiet >= 5000) ||
          (!running && quiet >= 30000))
      )
        repair(id);
    }
    for (const key of pendingSince.keys())
      if (!outstanding.has(key)) pendingSince.delete(key);
  }, 1000);
  const wake = () => {
    if (document.visibilityState === "hidden" || Date.now() - wokeAt < 1000)
      return;
    wokeAt = Date.now();
    for (const id of ids())
      if (Date.now() - (checked.get(id) ?? -Infinity) >= 5000) repair(id);
  };
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  enqueue(true);
  return () => {
    stopped = true;
    for (const controller of controllers.values()) controller.abort();
    clearTimeout(timer);
    unsubscribe();
    stopQueues();
    clearInterval(watchdog);
    window.removeEventListener("session-history-reconcile", manual);
    for (const id of repairing) setSessionRecovery(id);
    closeStream();
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
