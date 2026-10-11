import { create } from "zustand";
import { persist } from "zustand/middleware";

// VSIX mci/Isi uses the persisted AppScope markdownCodeBlockWordWrap atom.
// Store only the reader preference, independently of messages and thread caches.
export const useMarkdownSettingsStore = create<{
  wordWrap: boolean;
  setWordWrap: (wordWrap: boolean) => void;
}>()(
  persist(
    (set) => ({
      wordWrap: false,
      setWordWrap: (wordWrap) => set({ wordWrap }),
    }),
    {
      name: "kanban.session.markdown-preferences",
      partialize: ({ wordWrap }) => ({ wordWrap }),
      merge: (persisted, current) => ({
        ...current,
        wordWrap:
          (persisted as { wordWrap?: unknown } | null)?.wordWrap === true,
      }),
    },
  ),
);
