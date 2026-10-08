import { useCodexStore } from "../components/codex/stores";
import { openEventStream } from "../lib/eventStream";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { codexService } from "./codexService";

/** Hydrate followed Codex histories independently of which transcript is mounted.
 * The existing resume API joins the same thread; it never starts a turn. */
export function startFollowedSessionHistorySync() {
  let stopped = false;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wanted = new Map<string, number>();
  const done = new Map<string, number>();
  const retryAt = new Map<string, number>();
  const loading = new Set<string>();
  const ids = () =>
    useAgentCenterStore
      .getState()
      .cards.filter((c) => c.kind === "codex")
      .map((c) => c.id);
  function schedule(delay = 0) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(pump, delay);
  }
  function enqueue(force = false) {
    if (stopped) return;
    const members = new Set(ids());
    for (const id of wanted.keys())
      if (!members.has(id)) {
        wanted.delete(id);
        done.delete(id);
        retryAt.delete(id);
      }
    for (const id of members) {
      if (force) {
        wanted.set(id, (wanted.get(id) ?? 0) + 1);
        retryAt.delete(id);
      } else if (
        !wanted.has(id) &&
        !useCodexStore.getState().historyLoadedMap[id]
      )
        wanted.set(id, 1);
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
      if (loading.size >= 2) continue;
      loading.add(id);
      void codexService
        .threadResume(id, undefined, { background: true })
        .then(
          () => {
            if (!stopped && wanted.has(id)) {
              done.set(id, revision);
              retryAt.delete(id);
            }
          },
          () => {
            if (!stopped && wanted.has(id)) retryAt.set(id, Date.now() + 5000);
          },
        )
        .finally(() => {
          loading.delete(id);
          schedule();
        });
    }
    if (Number.isFinite(nextRetry)) schedule(nextRetry);
  }
  const unsubscribe = useAgentCenterStore.subscribe((state, previous) => {
    if (state.cards !== previous.cards) enqueue();
  });
  const closeStream = openEventStream({
    agents: ["codex"],
    onEvent: () => {},
    onOpen: () => {
      // The initial connection and initial restore are one hydration pass.
      if (opened) enqueue(true);
      opened = true;
    },
  });
  const wake = () => {
    if (document.visibilityState !== "hidden") enqueue(true);
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  enqueue(true);
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    closeStream();
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
