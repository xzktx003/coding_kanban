import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
export interface FileDocument {
  root: string;
  base: string;
  draft: string;
  version: string;
  diskChanged: boolean;
}
interface State {
  documents: Record<string, FileDocument>;
  load: (path: string, root: string, content: string, version: string) => void;
  edit: (path: string, draft: string) => void;
  saved: (path: string, content: string, version: string) => void;
  discard: (path: string) => void;
  move: (from: string, to: string) => void;
  forget: (path: string) => void;
}
const matches = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
export const useFileDocumentStore = create<State>()(
  persist(
    (set) => ({
      documents: {},
      load: (path, root, content, version) =>
        set((s) => {
          const old = s.documents[path],
            dirty = old && old.draft !== old.base;
          return {
            documents: {
              ...s.documents,
              [path]: dirty
                ? { ...old, root, diskChanged: old.version !== version }
                : {
                    root,
                    base: content,
                    draft: content,
                    version,
                    diskChanged: false,
                  },
            },
          };
        }),
      edit: (path, draft) =>
        set((s) =>
          s.documents[path]
            ? {
                documents: {
                  ...s.documents,
                  [path]: { ...s.documents[path], draft },
                },
              }
            : s,
        ),
      saved: (path, content, version) =>
        set((s) =>
          s.documents[path]
            ? {
                documents: {
                  ...s.documents,
                  [path]: {
                    ...s.documents[path],
                    base: content,
                    version,
                    diskChanged: false,
                  },
                },
              }
            : s,
        ),
      discard: (path) =>
        set((s) =>
          s.documents[path]
            ? {
                documents: {
                  ...s.documents,
                  [path]: {
                    ...s.documents[path],
                    draft: s.documents[path].base,
                  },
                },
              }
            : s,
        ),
      move: (from, to) =>
        set((s) => ({
          documents: Object.fromEntries(
            Object.entries(s.documents).map(([path, doc]) => [
              matches(path, from) ? to + path.slice(from.length) : path,
              doc,
            ]),
          ),
        })),
      forget: (path) =>
        set((s) => ({
          documents: Object.fromEntries(
            Object.entries(s.documents).filter(([p]) => !matches(p, path)),
          ),
        })),
    }),
    {
      name: "kanban.session.file-drafts",
      version: 1,
      storage: createJSONStorage(() => ({
        getItem: (key) => localStorage.getItem(key),
        removeItem: (key) => localStorage.removeItem(key),
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            window.dispatchEvent(new Event("file-draft-storage-error"));
          }
        },
      })),
      partialize: (s) => ({
        documents: Object.fromEntries(
          Object.entries(s.documents).filter(([, d]) => d.draft !== d.base),
        ),
      }),
    },
  ),
);
