import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useEffect } from "react";
import { toast } from "sonner";
export type SessionKind = "codex" | "cc" | "acp";
export const SESSION_NAME_LIMIT = 128;
let storageWarned = false;
const nameStorage = createJSONStorage(() => ({
  getItem: (key: string) => localStorage.getItem(key),
  removeItem: (key: string) => localStorage.removeItem(key),
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      storageWarned = false;
    } catch {
      if (!storageWarned)
        toast.error("会话名称未能保存到浏览器，请检查存储空间");
      storageWarned = true;
    }
  },
}));
export const sessionNameKey = (kind: SessionKind, id: string) =>
  `${kind}:${id}`;
export function normalizeSessionNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, name]) =>
        /^(cc|acp):.{1,256}$/.test(key) &&
        typeof name === "string" &&
        name.trim().length > 0 &&
        name.length <= SESSION_NAME_LIMIT,
    ),
  );
}
export const useSessionNameStore = create<{
  names: Record<string, string>;
  sources: Record<string, "fallback" | "native" | "manual">;
  setName: (kind: SessionKind, id: string, name: string) => void;
  initializeName: (
    kind: SessionKind,
    id: string,
    name: string,
    source?: "fallback" | "native",
  ) => void;
}>()(
  persist(
    (set) => ({
      names: {},
      sources: {},
      setName: (kind, id, name) =>
        set((s) => ({
          names: { ...s.names, [sessionNameKey(kind, id)]: name },
          sources: { ...s.sources, [sessionNameKey(kind, id)]: "manual" },
        })),
      initializeName: (kind, id, name, source = "native") =>
        set((s) => {
          const key = sessionNameKey(kind, id);
          const title = name
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, SESSION_NAME_LIMIT);
          if (
            !title ||
            (s.names[key] &&
              !(s.sources[key] === "fallback" && source === "native"))
          )
            return s;
          return {
            names: { ...s.names, [key]: title },
            sources: { ...s.sources, [key]: source },
          };
        }),
    }),
    {
      name: "kanban.session.names",
      version: 1,
      storage: nameStorage,
      partialize: (s) => ({ names: s.names, sources: s.sources }),
    },
  ),
);
export function useSessionName(
  kind: SessionKind,
  id: string | null | undefined,
  fallback = "",
  canonical?: string,
) {
  const name = useSessionNameStore((s) =>
    id ? s.names[sessionNameKey(kind, id)] : undefined,
  );
  useEffect(() => {
    if (id && fallback && fallback !== id.slice(0, 12))
      useSessionNameStore
        .getState()
        .initializeName(
          kind,
          id,
          canonical || fallback,
          canonical ? "native" : "fallback",
        );
  }, [kind, id, fallback, canonical]);
  return name ?? fallback;
}
