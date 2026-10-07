import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SessionKind = "codex" | "cc" | "acp";
export interface ReplyReceipt {
  completed: Array<{ id: string; at: number }>;
  read: string[];
}
export const sessionKey = (kind: SessionKind, id: string) => `${kind}:${id}`;
export function latestUnread(receipt?: ReplyReceipt): string | null {
  return (
    receipt?.completed
      .slice()
      .reverse()
      .find((reply) => !receipt.read.includes(reply.id))?.id ?? null
  );
}
function mergeReceipts(
  a: Record<string, ReplyReceipt>,
  b: Record<string, ReplyReceipt>,
) {
  const merged = { ...a };
  for (const [key, receipt] of Object.entries(b)) {
    if (!Array.isArray(receipt?.completed) || !Array.isArray(receipt?.read))
      continue;
    const existing = merged[key];
    const completed = [
      ...new Map(
        [...(existing?.completed ?? []), ...receipt.completed].map((r) => [
          r.id,
          r,
        ]),
      ).values(),
    ]
      .sort((a, b) => a.at - b.at)
      .slice(-32);
    merged[key] = {
      completed,
      read: [...new Set([...(existing?.read ?? []), ...receipt.read])].filter(
        (id) => completed.some((r) => r.id === id),
      ),
    };
  }
  return Object.fromEntries(
    Object.entries(merged)
      .sort(
        ([, a], [, b]) =>
          (b.completed.at(-1)?.at ?? 0) - (a.completed.at(-1)?.at ?? 0),
      )
      .slice(0, 512),
  );
}
interface AttentionState {
  receipts: Record<string, ReplyReceipt>;
  complete: (kind: SessionKind, id: string, replyId: string) => void;
  read: (kind: SessionKind, id: string, replyId: string) => void;
}
export const useSessionAttentionStore = create<AttentionState>()(
  persist(
    (set) => ({
      receipts: {},
      complete: (kind, id, replyId) =>
        set((state) => {
          if (!id || !replyId) return state;
          const key = sessionKey(kind, id);
          const previous = state.receipts[key];
          if (previous?.completed.some((r) => r.id === replyId)) return state;
          return {
            receipts: mergeReceipts(state.receipts, {
              [key]: { completed: [{ id: replyId, at: Date.now() }], read: [] },
            }),
          };
        }),
      read: (kind, id, replyId) =>
        set((state) => {
          const key = sessionKey(kind, id);
          const receipt = state.receipts[key];
          const index =
            receipt?.completed.findIndex((r) => r.id === replyId) ?? -1;
          if (!receipt || index < 0 || receipt.read.includes(replyId))
            return state;
          return {
            receipts: {
              ...state.receipts,
              [key]: {
                ...receipt,
                read: [
                  ...new Set([
                    ...receipt.read,
                    ...receipt.completed.slice(0, index + 1).map((r) => r.id),
                  ]),
                ],
              },
            },
          };
        }),
    }),
    {
      name: "kanban.session.attention",
      partialize: (state) => ({ receipts: state.receipts }),
      merge: (persisted, current) => ({
        ...current,
        receipts: mergeReceipts(
          current.receipts,
          (persisted as Partial<AttentionState>)?.receipts ?? {},
        ),
      }),
    },
  ),
);
