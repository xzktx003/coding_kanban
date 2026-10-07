import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";

export type DraftKind = "codex" | "cc" | "acp";
export const sessionDraftKey = (
  kind: DraftKind,
  id: string | null,
  cwd?: string | null,
  agentId?: string,
) =>
  JSON.stringify([
    kind,
    agentId ?? "",
    id ? "session" : "new",
    id ?? cwd ?? "",
  ]);
export interface TextDraft {
  text: string;
  revision: number;
}
const EMPTY: TextDraft = { text: "", revision: 0 };
interface DraftStore {
  drafts: Record<string, TextDraft>;
  migrated: string[];
  setText: (owner: string, text: string) => void;
  clearSubmitted: (owner: string, snapshot: TextDraft) => void;
  move: (from: string, to: string) => void;
  migrateLegacy: (kind: "codex" | "cc", owner: string) => void;
}
export const readDraft = (owner: string) =>
  useSessionDraftStore.getState().drafts[owner] ?? EMPTY;
let warned = false;
const storage = createJSONStorage(() => ({
  getItem: (name: string) => localStorage.getItem(name),
  removeItem: (name: string) => localStorage.removeItem(name),
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
      warned = false;
    } catch {
      if (!warned)
        toast.error("草稿未能保存到浏览器，请保留当前页面并检查存储空间");
      warned = true;
    }
  },
}));
export const useSessionDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      migrated: [],
      setText: (owner, text) =>
        set((s) => {
          const old = s.drafts[owner] ?? EMPTY;
          return text === old.text
            ? s
            : {
                drafts: {
                  ...s.drafts,
                  [owner]: { text, revision: old.revision + 1 },
                },
              };
        }),
      clearSubmitted: (owner, snapshot) => {
        const current = readDraft(owner);
        if (
          current.revision === snapshot.revision &&
          current.text === snapshot.text
        )
          get().setText(owner, "");
      },
      move: (from, to) => {
        if (from === to) return;
        set((s) => {
          const source = s.drafts[from];
          if (!source) return s;
          const target = s.drafts[to];
          const drafts = {
            ...s.drafts,
            [to]: target?.text
              ? {
                  text: [target.text, source.text].filter(Boolean).join("\n"),
                  revision: Math.max(target.revision, source.revision) + 1,
                }
              : source,
          };
          delete drafts[from];
          return { drafts };
        });
      },
      migrateLegacy: (kind, owner) => {
        if (get().migrated.includes(kind)) return;
        const name =
          kind === "cc"
            ? "kanban.session.cc-input-storage"
            : "kanban.session.input-storage";
        try {
          const text = JSON.parse(localStorage.getItem(name) ?? "null")?.state
            ?.inputValue;
          // Keep the original storage as a backup; migrate once instead of copying to all sessions.
          set((s) => {
            const old = s.drafts[owner] ?? EMPTY;
            return {
              migrated: [...s.migrated, kind],
              ...(typeof text === "string" && text
                ? {
                    drafts: {
                      ...s.drafts,
                      [owner]: {
                        text: old.text ? `${old.text}\n${text}` : text,
                        revision: old.revision + 1,
                      },
                    },
                  }
                : {}),
            };
          });
        } catch {
          toast.error("旧草稿读取失败，原始草稿已保留");
        }
      },
    }),
    {
      name: "kanban.session.text-drafts",
      version: 1,
      storage,
      partialize: (s) => ({ drafts: s.drafts, migrated: s.migrated }),
    },
  ),
);

export function useSessionTextDraft(
  owner: string,
  legacyKind?: "codex" | "cc",
) {
  const draft = useSessionDraftStore((s) => s.drafts[owner] ?? EMPTY);
  useEffect(() => {
    if (legacyKind)
      useSessionDraftStore.getState().migrateLegacy(legacyKind, owner);
  }, [legacyKind, owner]);
  return {
    inputValue: draft.text,
    setInputValue: (text: string) =>
      useSessionDraftStore.getState().setText(owner, text),
  };
}

export function appendDraft(owner: string, value: string) {
  const text = readDraft(owner).text;
  useSessionDraftStore
    .getState()
    .setText(owner, `${text}${!text || /\s$/.test(text) ? "" : " "}${value}`);
}
export function fileLinks(paths: string[], cwd: string | null = "") {
  const toPosix = (value: string) => value.replace(/\\/g, "/");
  const base = toPosix(cwd ?? "").replace(/\/+$/, "");
  return paths
    .map((path) => {
      const normalized = toPosix(path);
      const relative =
        base && normalized.startsWith(`${base}/`)
          ? normalized.slice(base.length + 1)
          : normalized;
      return `[${normalized.split("/").filter(Boolean).pop() ?? normalized}](${relative})`;
    })
    .join(" ");
}
