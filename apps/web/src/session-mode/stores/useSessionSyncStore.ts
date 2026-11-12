import { create } from "zustand";
/** Display-only recovery state. This store never submits or resumes a queue. */
export type SessionStatusCoverage = {
  /** Monotonic attempt identity; stale pages cannot complete a later attempt. */
  generation: number;
  /** Exact followed Codex membership captured when the attempt began. */
  membersKey: string;
  /** IDs covered by a valid status response or an exhaustive absence check. */
  covered: Record<string, true>;
  /** True only after both active and archived scans completed for this membership. */
  complete: boolean;
};

export function sessionStatusMembershipKey(ids: Iterable<string>) {
  return JSON.stringify([...new Set(ids)].sort());
}

export const useSessionSyncStore = create<{
  recovering: Record<string, "syncing" | "retrying">;
  checking: Record<string, boolean>;
  cursors: Record<string, string | null>;
  trimmedHistoryAnchors: Record<string, string>;
  earlierLoading: Record<string, boolean>;
  earlierErrors: Record<string, string>;
  connection: "connecting" | "connected" | "reconnecting" | "paused";
  connectionError: string | null;
  /** Ephemeral proof that followed Codex status coverage finished. */
  statusCoverage: SessionStatusCoverage | null;
}>(() => ({
  recovering: {},
  checking: {},
  cursors: {},
  trimmedHistoryAnchors: {},
  earlierLoading: {},
  earlierErrors: {},
  connection: "connecting",
  connectionError: null,
  statusCoverage: null,
}));

export function beginSessionStatusCoverage(
  membersKey: string,
): number {
  let generation = 1;
  useSessionSyncStore.setState((state) => {
    generation = (state.statusCoverage?.generation ?? 0) + 1;
    return {
      statusCoverage: {
        generation,
        membersKey,
        covered: {},
        complete: false,
      },
    };
  });
  return generation;
}

export function markSessionStatusCoverage(
  generation: number,
  membersKey: string,
  ids: Iterable<string>,
) {
  useSessionSyncStore.setState((state) => {
    const coverage = state.statusCoverage;
    if (
      !coverage ||
      coverage.generation !== generation ||
      coverage.membersKey !== membersKey
    )
      return state;
    const covered = { ...coverage.covered };
    let changed = false;
    for (const id of ids) {
      if (covered[id]) continue;
      covered[id] = true;
      changed = true;
    }
    return changed ? { statusCoverage: { ...coverage, covered } } : state;
  });
}

export function finishSessionStatusCoverage(
  generation: number,
  membersKey: string,
  ids: Iterable<string>,
) {
  useSessionSyncStore.setState((state) => {
    const coverage = state.statusCoverage;
    if (
      !coverage ||
      coverage.generation !== generation ||
      coverage.membersKey !== membersKey
    )
      return state;
    const covered = { ...coverage.covered };
    for (const id of ids) covered[id] = true;
    return {
      statusCoverage: {
        ...coverage,
        covered,
        complete: true,
      },
    };
  });
}
export function setSessionChecking(id: string, value: boolean) {
  useSessionSyncStore.setState((s) => {
    const checking = { ...s.checking };
    if (value) checking[id] = true;
    else delete checking[id];
    return { checking };
  });
}
export function setSessionRecovery(id: string, state?: "syncing" | "retrying") {
  useSessionSyncStore.setState((s) => {
    if (s.recovering[id] === state) return s;
    const recovering = { ...s.recovering };
    if (state) recovering[id] = state;
    else delete recovering[id];
    return { recovering };
  });
}
export function requestSessionHistorySync(threadId: string) {
  window.dispatchEvent(
    new CustomEvent("session-history-reconcile", { detail: threadId }),
  );
}
