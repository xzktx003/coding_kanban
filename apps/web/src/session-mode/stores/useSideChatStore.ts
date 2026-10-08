import { create } from "zustand";
interface SideChat {
  id: string;
  parentId: string;
  title: string;
  images: string[];
}
export const useSideChatStore = create<{
  chat: SideChat | null;
  open: (chat: SideChat) => void;
  close: () => void;
}>((set) => ({
  chat: null,
  open: (chat) => set({ chat }),
  close: () => set({ chat: null }),
}));
