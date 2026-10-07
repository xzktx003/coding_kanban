import type { SharedSessionTabs } from "@agent-orchestrator/shared";
import {
  sharedCardMetadata,
  useAgentCenterStore,
} from "../stores/useAgentCenterStore";

/** Sequential requests plus a persisted outbox avoid snapshot overwrites and lost-response replays. */
export function startSessionTabsSync(
  fetcher: typeof fetch = fetch,
  pollMs = 2000,
) {
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let initialized = false;
  // Seed from the pre-sync cache once; server accepts it only if no collection exists.
  const seed = useAgentCenterStore.getState().cards.map(sharedCardMetadata);
  function schedule(delay = pollMs) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void sync(), delay);
  }
  async function sync() {
    if (stopped || busy) return;
    busy = true;
    controller = new AbortController();
    try {
      const state = useAgentCenterStore.getState();
      const operations = state.pendingTabOperations.slice(0, 100);
      const post = !initialized || operations.length > 0;
      const response = await fetcher("/api/session/tabs", {
        method: post ? "POST" : "GET",
        cache: "no-store",
        ...(post
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: state.syncClientId,
                operations,
                ...(!initialized ? { seed } : {}),
              }),
            }
          : {}),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = (await response.json()) as SharedSessionTabs & {
        sequence?: number;
      };
      if (
        !Array.isArray(snapshot.cards) ||
        typeof snapshot.initialized !== "boolean" ||
        !Number.isSafeInteger(snapshot.revision) ||
        (post && !Number.isSafeInteger(snapshot.sequence))
      )
        throw new Error("Invalid response");
      if (stopped) return;
      initialized = true;
      useAgentCenterStore
        .getState()
        .acceptSharedTabs(snapshot, post ? snapshot.sequence : undefined);
    } catch {
      if (!stopped)
        useAgentCenterStore.setState({
          tabSyncError: "关注会话同步暂不可用，正在重试",
        });
    } finally {
      busy = false;
      schedule(
        useAgentCenterStore.getState().tabSyncError
          ? 5000
          : useAgentCenterStore.getState().pendingTabOperations.length
            ? 50
            : pollMs,
      );
    }
  }
  const unsubscribe = useAgentCenterStore.subscribe((state, previous) => {
    if (state.pendingTabOperations !== previous.pendingTabOperations && !busy)
      schedule(50);
  });
  const wake = () => {
    if (document.visibilityState !== "hidden") schedule(0);
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  // Let the mounted workspace finish restoring local selection before syncing membership.
  schedule(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    unsubscribe();
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
