import { create } from "zustand";
/** Display-only recovery state. This store never submits or resumes a queue. */
export const useSessionSyncStore = create<{
  recovering: Record<string, "syncing" | "retrying">;
  checking: Record<string, boolean>;
  cursors: Record<string, string | null>;
  trimmedHistoryAnchors: Record<string, string>;
  earlierLoading: Record<string, boolean>;
  earlierErrors: Record<string, string>;
  connection: "connecting" | "connected" | "reconnecting" | "paused";
  connectionError: string | null;
}>(() => ({
  recovering: {},
  checking: {},
  cursors: {},
  trimmedHistoryAnchors: {},
  earlierLoading: {},
  earlierErrors: {},
  connection: "connecting",
  connectionError: null,
}));
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
