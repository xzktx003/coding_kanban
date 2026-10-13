import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type NativeCodexTarget = {
  threadId: string;
  cwd: string;
  column: number;
};

type NativeCodexTargetState = {
  target: NativeCodexTarget | null;
  select: (target: NativeCodexTarget) => void;
  clear: () => void;
};

export const useNativeCodexTargetStore = create<NativeCodexTargetState>()(
  persist(
    (set) => ({
      target: null,
      select: (target) => set({ target: { ...target } }),
      clear: () => set({ target: null }),
    }),
    {
      name: "kanban.codex-native-target",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({ target: state.target }) as NativeCodexTargetState,
      merge: (persisted, current) => {
        const target = (persisted as { target?: unknown } | null)?.target;
        const row =
          target && typeof target === "object"
            ? (target as Partial<NativeCodexTarget>)
            : null;
        const valid =
          row &&
          typeof row.threadId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
            row.threadId,
          ) &&
          typeof row.cwd === "string" &&
          row.cwd.startsWith("/") &&
          row.cwd.length <= 4096 &&
          !/[\\\x00-\x1f\x7f]/.test(row.cwd) &&
          Number.isInteger(row.column) &&
          row.column! >= 1 &&
          row.column! <= 3;
        return {
          ...current,
          target: valid
            ? { threadId: row!.threadId!, cwd: row!.cwd!, column: row!.column! }
            : null,
        };
      },
    },
  ),
);

export function matchesNativeCodexTarget(
  target: NativeCodexTarget | null | undefined,
  threadId: string | null | undefined,
  cwd: string | null | undefined,
): target is NativeCodexTarget {
  return Boolean(
    target &&
    threadId &&
    cwd &&
    target.threadId === threadId &&
    target.cwd === cwd &&
    Number.isInteger(target.column) &&
    target.column >= 1 &&
    target.column <= 3,
  );
}
