import { requestTimeout } from "../lib/requestTimeout";
import type { SharedSessionTabs } from "@agent-orchestrator/shared";
import {
  TAB_OPERATION_PREFIX,
  TAB_REVISION_PREFIX,
  latestTabRevision,
  saveTabOperation,
} from "./sessionTabJournal";
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
  let requested = false;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let initialized = false;
  // Seed from the pre-sync cache once; server accepts it only if no collection exists.
  const seed = useAgentCenterStore.getState().cards.map(sharedCardMetadata);
  function schedule(delay = pollMs) {
    if (busy) {
      requested = true;
      return;
    }
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => void sync(), delay);
  }
  async function sync() {
    if (stopped || busy) return;
    busy = true;
    requested = false;
    controller = new AbortController();
    const deadline = requestTimeout(controller.signal, 10000);
    try {
      useAgentCenterStore.getState().refreshTabOperations();
      const state = useAgentCenterStore.getState();
      // Old outboxes finish using their original retry identity. New actions
      // each own a one-operation idempotency stream, independent of page counters.
      const legacy = state.pendingTabOperations
        .filter((op) => !op.id)
        .slice(0, 100);
      const operation = legacy.length
        ? undefined
        : state.pendingTabOperations[0];
      const operations = operation
        ? [{ seq: 1, action: operation.action }]
        : legacy;
      const post = !initialized || operations.length > 0;
      const response = await fetcher("/api/session/tabs", {
        method: post ? "POST" : "GET",
        cache: "no-store",
        ...(post
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: operation?.id
                  ? `tabop_${operation.id}`
                  : state.syncClientId,
                operations,
                ...(!initialized ? { seed } : {}),
              }),
            }
          : {}),
        signal: deadline.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = (await response.json()) as SharedSessionTabs & {
        sequence?: number;
      };
      if (
        !Array.isArray(snapshot.cards) ||
        typeof snapshot.initialized !== "boolean" ||
        !Number.isSafeInteger(snapshot.revision) ||
        (post &&
          (!Number.isSafeInteger(snapshot.sequence) ||
            (operation?.id && snapshot.sequence !== 1)))
      )
        throw new Error("Invalid response");
      if (stopped) return;
      const currentSnapshot = snapshot.revision >= latestTabRevision();
      // Repair old closes that the shared page counter could silently discard.
      // Do not reissue acknowledged old adds/moves: those can resurrect tabs.
      for (const op of currentSnapshot ? legacy : []) {
        if (op.action.type !== "remove" || op.seq > snapshot.sequence!)
          continue;
        const action = op.action;
        if (!snapshot.cards.some((c) => `${c.kind}:${c.id}` === action.key))
          continue;
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([state.syncClientId, op.seq, action]),
          ),
        );
        if (stopped) return;
        const id = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        saveTabOperation(action, op.seq, id);
      }
      initialized = true;
      const fresh = useAgentCenterStore
        .getState()
        .acceptSharedTabs(
          snapshot,
          post && !operation?.id && currentSnapshot
            ? snapshot.sequence
            : undefined,
          operation?.id ? [operation.id] : [],
        );
      if (!fresh) requested = true;
    } catch {
      if (!stopped)
        useAgentCenterStore.setState({
          tabSyncError: "关注会话同步暂不可用，正在重试",
        });
    } finally {
      deadline.dispose();
      busy = false;
      schedule(
        requested
          ? 0
          : useAgentCenterStore.getState().tabSyncError
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
  const retry = () => schedule(0);
  const storage = (event: StorageEvent) => {
    if (
      event.key?.startsWith(TAB_OPERATION_PREFIX) ||
      event.key?.startsWith(TAB_REVISION_PREFIX)
    )
      schedule(0);
  };
  window.addEventListener("online", wake);
  window.addEventListener("session-connection-retry", retry);
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
    window.removeEventListener("storage", storage);
    document.removeEventListener("visibilitychange", wake);
  };
}
