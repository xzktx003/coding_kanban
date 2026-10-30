import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PinnedItem {
  kind: 'codex' | 'cc';
  id: string;
  title: string;
  cwd: string;
  namespace?: string;
}

interface PinStore {
  pinned: PinnedItem[];
  isPinned: (id: string, kind?: PinnedItem['kind']) => boolean;
  togglePin: (item: PinnedItem) => void;
  unpin: (id: string, kind?: PinnedItem['kind']) => void;
}

export const usePinStore = create<PinStore>()(
  persist(
    (set, get) => ({
      pinned: [],
      isPinned: (id, kind) => get().pinned.some((p) => p.id === id && (!kind || p.kind === kind)),
      togglePin: (item) =>
        set((state) =>
          state.pinned.some((p) => p.id === item.id && p.kind === item.kind)
            ? { pinned: state.pinned.filter((p) => p.id !== item.id || p.kind !== item.kind) }
            : { pinned: [item, ...state.pinned] }
        ),
      unpin: (id, kind) => set((state) => ({ pinned: state.pinned.filter((p) => p.id !== id || (kind !== undefined && p.kind !== kind)) })),
    }),
    { name: 'kanban.session.pin-storage', version: 1 }
  )
);
