import {
  applyCodexTabAction,
  type CodexFollowedThread,
  type CodexTabOperation,
  type SharedCodexTabs,
} from "@agent-orchestrator/shared";
import {
  acknowledgeCodexTabOperations,
  CODEX_TAB_OPERATION_PREFIX,
  CODEX_TAB_REVISION_PREFIX,
  latestCodexTabRevision,
  observeCodexTabSnapshot,
  readCodexTabOperations,
  saveCodexTabOperation,
} from "./codex-tab-journal";

export type CodexTabSyncState = {
  threads: CodexFollowedThread[];
  detached: CodexFollowedThread | null;
  pending: CodexTabOperation[];
  initialized: boolean;
  error: string | null;
};

const EMPTY: CodexTabSyncState = {
  threads: [],
  detached: null,
  pending: [],
  initialized: false,
  error: null,
};

function sameState(left: CodexTabSyncState, right: CodexTabSyncState) {
  const sameThread = (
    a: CodexFollowedThread | null,
    b: CodexFollowedThread | null,
  ) =>
    a === b ||
    Boolean(a && b && a.id === b.id && a.cwd === b.cwd && a.title === b.title);
  return (
    left.initialized === right.initialized &&
    left.error === right.error &&
    sameThread(left.detached, right.detached) &&
    left.threads.length === right.threads.length &&
    left.threads.every((thread, index) =>
      sameThread(thread, right.threads[index] ?? null),
    ) &&
    left.pending.length === right.pending.length &&
    left.pending.every(
      (operation, index) =>
        JSON.stringify(operation) === JSON.stringify(right.pending[index]),
    )
  );
}

function currentThreads(snapshot: SharedCodexTabs): CodexFollowedThread[] {
  const savedRevision = latestCodexTabRevision();
  if (savedRevision < 0 || snapshot.revision >= savedRevision)
    return snapshot.threads;
  const raw = localStorage.getItem(CODEX_TAB_REVISION_PREFIX + savedRevision);
  if (!raw) return snapshot.threads;
  const saved = JSON.parse(raw) as SharedCodexTabs;
  return Array.isArray(saved.threads) ? saved.threads : snapshot.threads;
}

export function reduceCodexTabs(
  state: CodexTabSyncState,
  snapshot: SharedCodexTabs,
  acknowledgedIds: string[] = [],
): CodexTabSyncState {
  if (snapshot.revision >= latestCodexTabRevision())
    observeCodexTabSnapshot(snapshot);
  acknowledgeCodexTabOperations(acknowledgedIds);
  const pending = readCodexTabOperations();
  const threads = pending.reduce(
    (current, operation) => applyCodexTabAction(current, operation.action),
    currentThreads(snapshot),
  );
  const active =
    state.detached ??
    state.threads.find(
      (thread) => !threads.some((shared) => shared.id === thread.id),
    ) ??
    null;
  const detached =
    active && !threads.some((thread) => thread.id === active.id)
      ? active
      : null;
  return {
    threads,
    detached,
    pending,
    initialized: snapshot.initialized,
    error: null,
  };
}

export function queueCodexTab(
  state: CodexTabSyncState,
  action: CodexTabOperation["action"],
): CodexTabSyncState {
  const operation = saveCodexTabOperation(action);
  return {
    ...state,
    threads: applyCodexTabAction(state.threads, action),
    detached:
      action.type === "add" && state.detached?.id === action.thread.id
        ? null
        : state.detached,
    pending: [...state.pending, operation],
    error: null,
  };
}

export function startCodexTabSync(options: {
  fetcher?: typeof fetch;
  pollMs?: number;
  seed: CodexFollowedThread[];
  onChange: (state: CodexTabSyncState) => void;
}) {
  const fetcher = options.fetcher ?? fetch;
  let state = EMPTY;
  let stopped = false;
  let busy = false;
  let requested = false;
  let initialized = false;
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  const publish = (next: CodexTabSyncState) => {
    if (sameState(state, next)) return;
    state = next;
    options.onChange(next);
  };
  // Pending writes retain their acknowledgement lifecycle independently of the visible UI.
  const canSync = () =>
    !stopped &&
    ((active && document.visibilityState !== "hidden") ||
      state.pending.length > 0);
  const schedule = (delay = options.pollMs ?? 5000) => {
    if (busy) {
      requested = true;
      return;
    }
    clearTimeout(timer);
    if (canSync()) timer = setTimeout(() => void sync(), delay);
  };
  async function sync() {
    if (!canSync() || busy) return;
    busy = true;
    requested = false;
    controller?.abort();
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 10_000);
    try {
      const operation = readCodexTabOperations()[0];
      const post = !initialized || Boolean(operation);
      const response = await fetcher("/api/native-codex/tabs", {
        method: post ? "POST" : "GET",
        cache: "no-store",
        signal: controller.signal,
        ...(post
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                clientId: operation
                  ? `codextab_${operation.id}`
                  : "codex-tab-seed",
                operations: operation
                  ? [{ seq: 1, action: operation.action }]
                  : [],
                ...(!initialized ? { seed: options.seed } : {}),
              }),
            }
          : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = (await response.json()) as SharedCodexTabs & {
        sequence?: number;
      };
      if (
        !Array.isArray(snapshot.threads) ||
        typeof snapshot.initialized !== "boolean" ||
        !Number.isSafeInteger(snapshot.revision)
      )
        throw new Error("Invalid Codex tab response");
      if (stopped) return;
      initialized = true;
      publish(
        reduceCodexTabs(
          state,
          snapshot,
          operation?.id && snapshot.sequence === 1 ? [operation.id] : [],
        ),
      );
    } catch {
      if (canSync())
        publish({
          ...state,
          pending: readCodexTabOperations(),
          error: "Codex 关注同步暂不可用，正在重试",
        });
    } finally {
      clearTimeout(timeout);
      busy = false;
      schedule(
        requested
          ? 0
          : state.error
            ? 5000
            : state.pending.length
              ? 50
              : (options.pollMs ?? 5000),
      );
    }
  }
  const wake = () => {
    clearTimeout(timer);
    if (canSync()) schedule(0);
  };
  const storage = (event: StorageEvent) => {
    if (
      event.key?.startsWith(CODEX_TAB_OPERATION_PREFIX) ||
      event.key?.startsWith(CODEX_TAB_REVISION_PREFIX)
    )
      schedule(0);
  };
  window.addEventListener("online", wake);
  window.addEventListener("storage", storage);
  document.addEventListener("visibilitychange", wake);
  schedule(0);
  return {
    setActive(value: boolean) {
      active = value;
      clearTimeout(timer);
      if (canSync()) schedule(0);
    },
    queue(action: CodexTabOperation["action"]) {
      publish(queueCodexTab(state, action));
      schedule(50);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("online", wake);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", wake);
    },
  };
}
