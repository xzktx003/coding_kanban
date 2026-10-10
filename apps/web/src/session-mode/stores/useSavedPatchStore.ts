import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SavedPatchRequest,
  SavedPatchResult,
} from "@agent-orchestrator/shared";
import {
  savedPatchApply,
  savedPatchStatus,
} from "@session/services/savedPatchService";
import { SessionApiError } from "@session/services/apiAdapt/shared";
type Input = Omit<SavedPatchRequest, "requestId">;
type Record = {
  requestId: string;
  status: "sending" | "success" | "conflict" | "uncertain";
  nextAction: "undo" | "reapply";
  error?: string;
};
const inFlight = new Map<string, Promise<void>>();
/** Cache discriminator only. Server independently compares the complete native
 * receipts and SHA-256 request identity; this hash grants no mutation authority. */
export function savedPatchKey(input: Omit<Input, "action">) {
  const source = JSON.stringify(input.expectedChanges);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++)
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return JSON.stringify([
    input.threadId,
    input.turnId,
    input.filePath ?? null,
    source.length,
    hash >>> 0,
  ]);
}
function acknowledged(
  result: SavedPatchResult,
  requestId: string,
  action: "undo" | "reapply",
): Record {
  if (
    result?.requestId !== requestId ||
    result.action !== action ||
    !["success", "conflict", "uncertain"].includes(result.status)
  )
    throw new Error("保存 patch 的执行回执身份未确认");
  return {
    requestId,
    status: result.status,
    nextAction:
      result.status === "success"
        ? action === "undo"
          ? "reapply"
          : "undo"
        : action,
    error: result.error,
  };
}
export const useSavedPatchStore = create<{
  records: { [key: string]: Record };
  apply: (input: Input) => Promise<void>;
  check: (input: Input) => Promise<void>;
}>()(
  persist(
    (set, get) => ({
      records: {},
      apply: (input) => {
        const key = savedPatchKey(input),
          current = get().records[key];
        if (inFlight.has(key)) return inFlight.get(key)!;
        if (current?.status === "uncertain" || current?.status === "sending")
          return Promise.resolve();
        const request = structuredClone({
          ...input,
          requestId: crypto.randomUUID(),
        });
        set((state) => ({
          records: {
            ...state.records,
            [key]: {
              requestId: request.requestId,
              status: "sending",
              nextAction: input.action,
            },
          },
        }));
        const task = Promise.resolve()
          .then(async () => {
            let record: Record;
            try {
              record = acknowledged(
                await savedPatchApply(request),
                request.requestId,
                request.action,
              );
            } catch (error) {
              record = {
                requestId: request.requestId,
                status:
                  error instanceof SessionApiError &&
                  error.status >= 400 &&
                  error.status < 500
                    ? "conflict"
                    : "uncertain",
                nextAction: request.action,
                error: error instanceof Error ? error.message : String(error),
              };
            }
            set((state) =>
              state.records[key]?.requestId === request.requestId
                ? { records: { ...state.records, [key]: record } }
                : state,
            );
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, task);
        return task;
      },
      check: async (input) => {
        const key = savedPatchKey(input),
          record = get().records[key];
        if (
          !record ||
          inFlight.has(key) ||
          !["uncertain", "sending"].includes(record.status)
        )
          return;
        try {
          const { result } = await savedPatchStatus(
            input.threadId,
            record.requestId,
          );
          if (!result) return;
          const action = record.nextAction;
          const next = acknowledged(result, record.requestId, action);
          set((state) =>
            state.records[key]?.requestId === record.requestId
              ? { records: { ...state.records, [key]: next } }
              : state,
          );
        } catch (error) {
          set((state) =>
            state.records[key]?.requestId === record.requestId
              ? {
                  records: {
                    ...state.records,
                    [key]: {
                      ...record,
                      status: "uncertain",
                      error:
                        error instanceof Error ? error.message : String(error),
                    },
                  },
                }
              : state,
          );
        }
      },
    }),
    {
      name: "kanban.session.saved-patch-receipts",
      version: 1,
      partialize: (state) => ({ records: state.records }),
      merge: (saved, current) => {
        const records =
          (saved as { records?: { [key: string]: Record } })?.records ?? {};
        return {
          ...current,
          records: Object.fromEntries(
            Object.entries(records).map(([key, record]) => [
              key,
              record.status === "sending"
                ? {
                    ...record,
                    status: "uncertain",
                    error: "上次执行结果待核对，请勿重复应用",
                  }
                : record,
            ]),
          ),
        };
      },
    },
  ),
);
