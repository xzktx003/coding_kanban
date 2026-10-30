import {
  beginConnectionCheck,
  connectionCheckFailed,
  connectionCheckSucceeded,
  connectionFailureText,
  readSharedSnapshot,
  scheduleConnectionRetry,
  SessionSyncError,
  syncRetryDelay,
  useSessionConnectionDiagnostics,
} from "./sessionConnectionDiagnostics";
import type { SharedProjects } from "@agent-orchestrator/shared";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import {
  PROJECT_OPERATION_PREFIX,
  PROJECT_REVISION_PREFIX,
  latestProjectRevision,
} from "./sessionProjectJournal";

/** Sequential requests plus a persisted outbox avoid snapshot overwrites and lost-response replays. */
export function startSessionProjectsSync(
  fetcher: typeof fetch = fetch,
  pollMs = 2000,
) {
  let stopped = false;
  let busy = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let initialized = false;
  let failures = 0;
  let lastFailure: unknown;
  // Seed from the pre-sync cache once; server accepts it only if no collection exists.
  const seed = useWorkspaceStore.getState().projects;
  function schedule(delay = pollMs) {
    if (busy) {
      requested = true;
      return;
    }
    clearTimeout(timer);
    if (!stopped) {
      scheduleConnectionRetry("projects", delay);
      timer = setTimeout(() => void sync(), delay);
    }
  }
  async function sync() {
    if (stopped || busy) return;
    busy = true;
    requested = false;
    controller = new AbortController();
    let localPhase = true;
    const pendingCount =
      useWorkspaceStore.getState().pendingProjectOperations.length;
    beginConnectionCheck(
      "projects",
      pendingCount ? "write" : "read",
      pendingCount,
    );
    try {
      useWorkspaceStore.getState().refreshProjectOperations();
      const state = useWorkspaceStore.getState();
      // Preserve old retries; each new operation owns a separate idempotency
      // stream so two pages can never acknowledge each other's edits.
      const legacy = state.pendingProjectOperations
        .filter((op) => !op.id)
        .slice(0, 100);
      const operation = legacy.length
        ? undefined
        : state.pendingProjectOperations[0];
      const operations = operation
        ? [{ seq: 1, action: operation.action }]
        : legacy;
      const post = !initialized || operations.length > 0;
      localPhase = false;
      const snapshot = await readSharedSnapshot<
        SharedProjects & { sequence?: number }
      >(
        "/api/session/projects",
        {
          method: post ? "POST" : "GET",
          cache: "no-store",
          ...(post
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  clientId: operation?.id
                    ? `projectop_${operation.id}`
                    : state.projectSyncClientId,
                  operations,
                  ...(!initialized ? { seed } : {}),
                }),
              }
            : {}),
        },
        controller.signal,
        fetcher,
      );
      if (
        !Array.isArray(snapshot.projects) ||
        typeof snapshot.initialized !== "boolean" ||
        !Number.isSafeInteger(snapshot.revision) ||
        (post &&
          (!Number.isSafeInteger(snapshot.sequence) ||
            (operation?.id && snapshot.sequence !== 1)))
      )
        throw new SessionSyncError("response");
      if (stopped) return;
      localPhase = true;
      initialized = true;
      const currentSnapshot = snapshot.revision >= latestProjectRevision();
      const fresh = useWorkspaceStore
        .getState()
        .acceptSharedProjects(
          snapshot,
          post && !operation?.id && currentSnapshot
            ? snapshot.sequence
            : undefined,
          operation?.id ? [operation.id] : [],
        );
      if (!fresh) throw new SessionSyncError("stale");
      failures = 0;
      lastFailure = undefined;
      connectionCheckSucceeded("projects");
    } catch (error) {
      if (!stopped) {
        failures++;
        lastFailure = error;
        connectionCheckFailed("projects", error, localPhase);
        useWorkspaceStore.setState({
          projectSyncError: connectionFailureText(
            useSessionConnectionDiagnostics.getState().projects.failure,
          ),
        });
      }
    } finally {
      busy = false;
      schedule(
        requested
          ? 0
          : useWorkspaceStore.getState().projectSyncError
            ? syncRetryDelay(failures, lastFailure)
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
  const retry = () => schedule(0);
  const scopedRetry = (event: Event) => {
    if ((event as CustomEvent).detail?.channel === "projects") schedule(0);
  };
  const storage = (event: StorageEvent) => {
    if (
      event.key?.startsWith(PROJECT_OPERATION_PREFIX) ||
      event.key?.startsWith(PROJECT_REVISION_PREFIX)
    )
      schedule(0);
  };
  window.addEventListener("online", wake);
  window.addEventListener("session-connection-retry", retry);
  window.addEventListener("session-sync-retry", scopedRetry);
  window.addEventListener("storage", storage);
  document.addEventListener("visibilitychange", wake);
  // Let the mounted workspace finish restoring local selection before syncing membership.
  schedule(0);
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    unsubscribe();
    window.removeEventListener("online", wake);
    window.removeEventListener("session-connection-retry", retry);
    window.removeEventListener("session-sync-retry", scopedRetry);
    window.removeEventListener("storage", storage);
    document.removeEventListener("visibilitychange", wake);
  };
}
