import { create } from "zustand";

type Preload = {
  phase: "queued" | "reading" | "ready" | "failed" | "reclaimed";
  revision: number;
};
/** Followed recent-page coverage only; contains no transcript, approval or task ownership. */
export const useSessionPreloadStore = create<{
  entries: Record<string, Preload>;
}>(() => ({ entries: {} }));
export function setSessionPreload(key: string, value?: Preload) {
  useSessionPreloadStore.setState((state) => {
    const before = state.entries[key];
    if (before?.phase === value?.phase && before?.revision === value?.revision)
      return state;
    const entries = { ...state.entries };
    if (value) entries[key] = value;
    else delete entries[key];
    return { entries };
  });
}
