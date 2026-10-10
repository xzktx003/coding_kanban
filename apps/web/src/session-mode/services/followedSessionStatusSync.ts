import { requestTimeout } from "../lib/requestTimeout";
import type { ThreadStatus } from "../bindings/v2";
import {
  useCodexStore,
  useApprovalStore,
  useRequestUserInputStore,
  usePermissionsStore,
  useElicitationStore,
} from "../components/codex/stores";
import { authHeaders, buildUrl } from "../hooks/runtime";
import { openEventStream, reconcileEventStream } from "../lib/eventStream";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { openedCodexIds } from "./openedSessions";

function followedIds() {
  return new Set(openedCodexIds());
}

function membershipKey() {
  return JSON.stringify([...followedIds()].sort());
}

function isThreadStatus(value: unknown): value is ThreadStatus {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "active")
    return (
      "activeFlags" in value &&
      Array.isArray(value.activeFlags) &&
      value.activeFlags.every(
        (flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput",
      )
    );
  return ["idle", "notLoaded", "systemError"].includes(String(value.type));
}

/** Read a snapshot on reload/reconnect; never navigate, resume, or replace the sidebar list. */
export function startFollowedSessionStatusSync(fetcher: typeof fetch = fetch) {
  let stopped = false;
  let busy = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let members = membershipKey();
  let checkedAt = -Infinity;
  let repairedAt = -Infinity;
  let requestRepairTimer: ReturnType<typeof setTimeout>;
  const threadUpdatedAt = new Map<string, number>();
  const completionRepairTurns = new Map<string, string>();
  const missingRequests = () =>
    [...followedIds()].some((id) => {
      const status = useCodexStore.getState().threadStatusMap[id];
      if (status?.type !== "active") return false;
      const waitingInput =
        status.activeFlags.includes("waitingOnUserInput") &&
        !useRequestUserInputStore
          .getState()
          .pendingRequests.some((r) => r.threadId === id);
      const approvals = [
        ...useApprovalStore.getState().pendingApprovals,
        ...usePermissionsStore.getState().pendingRequests,
        ...useElicitationStore.getState().pendingRequests,
      ];
      return (
        waitingInput ||
        (status.activeFlags.includes("waitingOnApproval") &&
          !approvals.some((r) => r.threadId === id))
      );
    });

  function schedule(delay = 0) {
    if (stopped) return;
    if (busy) {
      requested = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), delay);
  }

  async function sync() {
    if (stopped || busy) return;
    const remaining = followedIds();
    if (!remaining.size) return;
    busy = true;
    requested = false;
    controller = new AbortController();
    const deadline = requestTimeout(controller.signal, 15_000);
    const signal = deadline.signal;
    // Snapshot references let streamed status/turn changes win over a late response.
    const baseline = useCodexStore.getState();
    let failed = false;
    try {
      for (const archived of [false, true]) {
        let cursor: string | null = null;
        const cursors = new Set<string>();
        do {
          if (stopped || !remaining.size) break;
          const response = await fetcher(buildUrl("/api/codex/thread/list"), {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              cursor,
              limit: 100,
              sortKey: "updated_at",
              modelProviders: null,
              cwd: null,
              archived,
              useStateDbOnly: true,
            }),
            signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const page = (await response.json()) as {
            data: Array<{ id: string; status: unknown; updatedAt?: unknown }>;
            nextCursor?: string | null;
          };
          if (
            !Array.isArray(page.data) ||
            (page.nextCursor != null && typeof page.nextCursor !== "string")
          )
            throw new Error("Invalid thread list");
          if (stopped || signal.aborted) return;
          const currentMembers = followedIds();
          for (const id of remaining)
            if (!currentMembers.has(id)) remaining.delete(id);
          const statuses: Record<string, ThreadStatus> = {};
          const updatedThreads = new Map<string, number>();
          for (const thread of page.data) {
            if (!remaining.has(thread.id) || !isThreadStatus(thread.status))
              continue;
            remaining.delete(thread.id);
            statuses[thread.id] = thread.status;
            if (
              typeof thread.updatedAt === "number" &&
              Number.isFinite(thread.updatedAt)
            )
              updatedThreads.set(thread.id, thread.updatedAt);
          }
          const reconcile = new Set<string>();
          useCodexStore.setState((state) => {
            const threadStatusMap = { ...state.threadStatusMap };
            let changed = false;
            for (const [id, status] of Object.entries(statuses)) {
              if (state.threadStatusMap[id] !== baseline.threadStatusMap[id])
                continue;
              if (state.turnTimingMap[id] !== baseline.turnTimingMap[id]) {
                // A turn event invalidates this snapshot but does not supply an
                // authoritative status. Recheck instead of leaving it unknown.
                requested = true;
                continue;
              }
              const timing = baseline.turnTimingMap[id];
              // A short turn can start and finish between metadata snapshots.
              // Recent history may observe it running while status stays idle.
              // Repair that authoritative completion boundary once per turn,
              // without publishing unchanged state or polling its full history.
              if (
                (status.type === "idle" || status.type === "systemError") &&
                timing?.status === "inProgress" &&
                completionRepairTurns.get(id) !== timing.turnId
              ) {
                completionRepairTurns.set(id, timing.turnId);
                reconcile.add(id);
              } else if (
                status.type === "active" ||
                timing?.status !== "inProgress"
              )
                completionRepairTurns.delete(id);

              const updatedAt = updatedThreads.get(id);
              if (updatedAt !== undefined) {
                const previous = threadUpdatedAt.get(id);
                threadUpdatedAt.set(id, updatedAt);
                if (
                  previous !== undefined &&
                  updatedAt > previous &&
                  status.type !== "active" &&
                  baseline.threadStatusMap[id]?.type !== "active" &&
                  timing?.status !== "inProgress"
                )
                  reconcile.add(id);
              }
              if (
                JSON.stringify(threadStatusMap[id]) === JSON.stringify(status)
              )
                continue;
              threadStatusMap[id] = status;
              changed = true;
            }
            return changed ? { threadStatusMap } : state;
          });
          for (const id of reconcile)
            window.dispatchEvent(
              new CustomEvent("session-history-reconcile", { detail: id }),
            );
          cursor = page.nextCursor ?? null;
          if (cursor && cursors.has(cursor))
            throw new Error("Repeated thread list cursor");
          if (cursor) cursors.add(cursor);
        } while (cursor && remaining.size);
        if (!remaining.size) break;
      }
    } catch {
      // Keep existing state during outages; retry without repeated error toasts.
      failed = true;
    } finally {
      deadline.dispose();
      checkedAt = Date.now();
      if (
        !stopped &&
        !failed &&
        missingRequests() &&
        Date.now() - repairedAt >= 15000
      ) {
        clearTimeout(requestRepairTimer);
        requestRepairTimer = setTimeout(() => {
          if (!stopped && missingRequests()) {
            repairedAt = Date.now();
            reconcileEventStream();
          }
        }, 500);
      }
      busy = false;
      if (requested || failed) schedule(requested ? 0 : 5000);
    }
  }

  const unsubscribe = useAgentCenterStore.subscribe(() => {
    const next = membershipKey();
    if (next === members) return;
    members = next;
    const current = followedIds();
    for (const id of threadUpdatedAt.keys())
      if (!current.has(id)) threadUpdatedAt.delete(id);
    for (const id of completionRepairTurns.keys())
      if (!current.has(id)) completionRepairTurns.delete(id);
    schedule();
  });
  const closeStream = openEventStream({
    agents: ["codex"],
    onOpen: () => schedule(),
    onResync: () => schedule(),
    onEvent: () => {},
  });
  const wake = () => {
    if (document.visibilityState !== "hidden" && Date.now() - checkedAt >= 5000)
      schedule();
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  const watchdog = setInterval(() => {
    const state = useCodexStore.getState();
    const active = [...followedIds()].some(
      (id) =>
        state.threadStatusMap[id]?.type === "active" ||
        state.turnTimingMap[id]?.status === "inProgress",
    );
    if (
      document.visibilityState !== "hidden" &&
      Date.now() - checkedAt >= (active ? 5000 : 30000)
    )
      schedule();
  }, 1000);
  schedule();
  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    clearTimeout(requestRepairTimer);
    clearInterval(watchdog);
    controller?.abort();
    unsubscribe();
    closeStream();
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
  };
}
