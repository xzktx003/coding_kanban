import type { SharedProjects } from "@agent-orchestrator/shared";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";

/** Sequential requests plus a persisted outbox avoid snapshot overwrites and lost-response replays. */
export function startSessionProjectsSync(
  fetcher: typeof fetch = fetch,
  pollMs = 2000,
) {
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let initialized = false;
  // Seed from the pre-sync cache once; server accepts it only if no collection exists.
  const seed = useWorkspaceStore.getState().projects;
  function schedule(delay = pollMs) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void sync(), delay);
  }
  async function sync() {
    if (stopped || busy) return;
    busy = true;
    controller = new AbortController();
    try {
      const state = useWorkspaceStore.getState();
      const operations = state.pendingProjectOperations.slice(0, 100);
      const post = !initialized || operations.length > 0;
      const response = await fetcher("/api/session/projects", {
        method: post ? "POST" : "GET",
        cache: "no-store",
        ...(post
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: state.projectSyncClientId,
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
      const snapshot = (await response.json()) as SharedProjects & {
        sequence?: number;
      };
      if (
        !Array.isArray(snapshot.projects) ||
        typeof snapshot.initialized !== "boolean" ||
        !Number.isSafeInteger(snapshot.revision) ||
        (post && !Number.isSafeInteger(snapshot.sequence))
      )
        throw new Error("Invalid response");
      if (stopped) return;
      initialized = true;
      useWorkspaceStore
        .getState()
        .acceptSharedProjects(snapshot, post ? snapshot.sequence : undefined);
    } catch {
      if (!stopped)
        useWorkspaceStore.setState({
          projectSyncError: "项目同步暂不可用，正在重试",
        });
    } finally {
      busy = false;
      schedule(
        useWorkspaceStore.getState().projectSyncError
          ? 5000
          : useWorkspaceStore.getState().pendingProjectOperations.length
            ? 50
            : pollMs,
      );
    }
  }
  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (
      state.pendingProjectOperations !== previous.pendingProjectOperations &&
      !busy
    )
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
