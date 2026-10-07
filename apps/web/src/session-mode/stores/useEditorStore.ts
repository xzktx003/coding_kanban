import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorStore {
  roots: Record<string, string>;
  moveFiles: (from: string, to: string) => void;
  openFiles: string[];
  activeFile: string | null;
  openFile: (path: string, root?: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  /** @deprecated use openFile / activeFile */
  selectedFilePath: string | null;
  /** @deprecated use openFile */
  setSelectedFilePath: (path: string | null) => void;
  hasConfirmedGitRevert: boolean;
  setHasConfirmedGitRevert: (value: boolean) => void;
  resetFiles: () => void;
}

export const useEditorStore = create<EditorStore>()(
  persist(
    (set) => ({
      roots: {},
      moveFiles: (from, to) =>
        set((state) => {
          const next = (path: string) =>
            path === from || path.startsWith(from + "/")
              ? to + path.slice(from.length)
              : path;
          return {
            openFiles: state.openFiles.map(next),
            activeFile: state.activeFile ? next(state.activeFile) : null,
            selectedFilePath: state.selectedFilePath
              ? next(state.selectedFilePath)
              : null,
            roots: Object.fromEntries(
              Object.entries(state.roots).map(([p, r]) => [next(p), r]),
            ),
          };
        }),
      openFiles: [],
      activeFile: null,
      openFile: (path, root) =>
        set((state) => ({
          openFiles: state.openFiles.includes(path)
            ? state.openFiles
            : [...state.openFiles, path],
          activeFile: path,
          roots: root ? { ...state.roots, [path]: root } : state.roots,
          selectedFilePath: path,
        })),
      closeFile: (path) =>
        set((state) => {
          const next = state.openFiles.filter((f) => f !== path);
          const activeFile =
            state.activeFile === path
              ? (next[state.openFiles.indexOf(path)] ??
                next[state.openFiles.indexOf(path) - 1] ??
                null)
              : state.activeFile;
          return { openFiles: next, activeFile, selectedFilePath: activeFile };
        }),
      setActiveFile: (path) =>
        set({ activeFile: path, selectedFilePath: path }),
      // Deprecated shims — keep for backward compat
      selectedFilePath: null,
      setSelectedFilePath: (path) =>
        set((state) => ({
          selectedFilePath: path,
          activeFile: path,
          openFiles:
            path && !state.openFiles.includes(path)
              ? [...state.openFiles, path]
              : state.openFiles,
        })),
      hasConfirmedGitRevert: false,
      setHasConfirmedGitRevert: (value) =>
        set({ hasConfirmedGitRevert: value }),
      resetFiles: () =>
        set({ openFiles: [], activeFile: null, selectedFilePath: null }),
    }),
    {
      name: "kanban.session.open-files",
      version: 1,
      partialize: (s) => ({
        openFiles: s.openFiles,
        activeFile: s.activeFile,
        selectedFilePath: s.selectedFilePath,
        roots: s.roots,
      }),
    },
  ),
);
