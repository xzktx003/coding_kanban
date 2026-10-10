import { create } from "zustand";
export interface ThreadLinkTarget {
  threadId: string;
  turnId?: string;
}
export const useThreadLinkStore = create<{
  requestId: number;
  target: { threadId: string; turnId: string } | null;
  loading: boolean;
  error: string | null;
  consumeTarget: (threadId: string, turnId: string) => void;
}>((set) => ({
  requestId: 0,
  target: null,
  loading: false,
  error: null,
  consumeTarget: (threadId, turnId) =>
    set((state) =>
      state.target?.threadId === threadId && state.target.turnId === turnId
        ? { target: null }
        : state,
    ),
}));
