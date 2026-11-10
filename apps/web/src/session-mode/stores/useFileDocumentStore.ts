import { create, type StoreApi } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
export interface FileDocument {
  root: string;
  base: string;
  draft: string;
  version: string;
  diskChanged: boolean;
  /** The browser has not confirmed the result of a write it submitted. */
  saveUnconfirmed?: boolean;
}
interface State {
  documents: Record<string, FileDocument>;
  load: (path: string, root: string, content: string, version: string) => void;
  edit: (path: string, draft: string) => void;
  markSaveUnconfirmed: (path: string) => void;
  saved: (path: string, content: string, version: string) => void;
  discard: (path: string) => void;
  replaceIfUnchanged: (
    path: string,
    expected: FileDocument,
    content: string,
    version: string,
  ) => boolean;
  move: (from: string, to: string) => void;
  forget: (path: string) => void;
}
const matches = (path: string, root: string) =>
  path === root || path.startsWith(root + "/");
const createFileDocumentActions = (
  set: StoreApi<State>["setState"],
): Omit<State, "documents"> => ({
  load: (path, root, content, version) =>
    set((s) => {
      const old = s.documents[path],
        dirty = old && (old.draft !== old.base || old.saveUnconfirmed);
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
  markSaveUnconfirmed: (path) =>
    set((s) =>
      s.documents[path] && !s.documents[path].saveUnconfirmed
        ? {
            documents: {
              ...s.documents,
              [path]: { ...s.documents[path], saveUnconfirmed: true },
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
                saveUnconfirmed: false,
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
                saveUnconfirmed: false,
              },
            },
          }
        : s,
    ),
  replaceIfUnchanged: (path, expected, content, version) => {
    let replaced = false;
    set((s) => {
      const current = s.documents[path];
      if (
        !current ||
        current.root !== expected.root ||
        current.base !== expected.base ||
        current.draft !== expected.draft ||
        current.version !== expected.version ||
        current.diskChanged !== expected.diskChanged ||
        current.saveUnconfirmed !== expected.saveUnconfirmed
      )
        return s;
      replaced = true;
      return {
        documents: {
          ...s.documents,
          [path]: {
            root: current.root,
            base: content,
            draft: content,
            version,
            diskChanged: false,
          },
        },
      };
    });
    return replaced;
  },
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
});

const partializeFileDocuments = (s: State) => ({
  documents: Object.fromEntries(
    Object.entries(s.documents).filter(
      ([, d]) => d.draft !== d.base || d.saveUnconfirmed,
    ),
  ),
});
const createFileDocumentStore = () =>
  create<State>()(
    persist((set) => ({ documents: {}, ...createFileDocumentActions(set) }), {
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
      partialize: partializeFileDocuments,
    }),
  );

// Preserve subscriptions and in-flight save owners across a development update.
const previousFileDocumentStore = import.meta.hot?.data?.fileDocumentStore as
  | ReturnType<typeof createFileDocumentStore>
  | undefined;
export const useFileDocumentStore =
  previousFileDocumentStore ?? createFileDocumentStore();
if (previousFileDocumentStore) {
  previousFileDocumentStore.persist.setOptions({
    partialize: partializeFileDocuments,
  });
  previousFileDocumentStore.setState(
    createFileDocumentActions(previousFileDocumentStore.setState),
  );
}
if (import.meta.hot?.data)
  import.meta.hot.data.fileDocumentStore = useFileDocumentStore;
