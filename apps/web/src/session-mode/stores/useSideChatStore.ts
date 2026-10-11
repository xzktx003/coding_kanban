import { create } from "zustand";
interface SideChat {
  id: string;
  parentId: string;
  title: string;
  images: string[];
}
export const useSideChatStore = create<{
  chat: SideChat | null;
  focusTrigger: number;
  open: (chat: SideChat) => void;
  close: () => void;
  requestFocus: () => void;
}>((set) => ({
  chat: null,
  focusTrigger: 0,
  open: (chat) => set({ chat }),
  close: () => set({ chat: null }),
  requestFocus: () => set((state) => ({ focusTrigger: state.focusTrigger + 1 })),
}));
