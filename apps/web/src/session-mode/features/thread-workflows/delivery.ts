import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import { MutationNotStartedError } from "@session/services/MutationNotStartedError";
import type { TurnSource } from "./model";
export type TurnMutationKind = "fork" | "restore" | "editRollback" | "editSend";
export interface TurnMutationRecord {
  kind: TurnMutationKind;
  source: TurnSource;
  status: "pending" | "uncertain" | "rejected" | "completed";
  updatedAt: number;
  result?: unknown;
  error?: string;
}
export interface InlineEditBuffer {
  text: string;
  revision: number;
  source: TurnSource;
}
interface WorkflowStore {
  mutations: Record<string, TurnMutationRecord>;
  inlineEdits: Record<string, InlineEditBuffer>;
  setInlineEdit: (source: TurnSource, text: string) => void;
  clearInlineEdit: (source: TurnSource) => void;
}
export const inlineEditKey = (source: TurnSource) =>
  JSON.stringify([source.threadId, source.turnId, source.itemId]);
export const useThreadWorkflowStore = create<WorkflowStore>()(
  persist(
    (set) => ({
      mutations: {},
      inlineEdits: {},
      setInlineEdit: (source, text) =>
        set((state) => {
          const key = inlineEditKey(source);
          const old = state.inlineEdits[key];
          return old?.text === text
            ? state
            : {
                inlineEdits: {
                  ...state.inlineEdits,
                  [key]: { text, source, revision: (old?.revision ?? 0) + 1 },
                },
              };
        }),
      clearInlineEdit: (source) =>
        set((state) => {
          const inlineEdits = { ...state.inlineEdits };
          delete inlineEdits[inlineEditKey(source)];
          return { inlineEdits };
        }),
    }),
    {
      name: "kanban.session.thread-workflows",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        mutations: s.mutations,
        inlineEdits: s.inlineEdits,
      }),
    },
  ),
);
export const mutationKey = (kind: TurnMutationKind, source: TurnSource) =>
  JSON.stringify([kind, source.threadId, source.turnId]);
const inFlight = new Map<string, Promise<unknown>>();
export class MutationUncertainError extends Error {
  constructor(
    public readonly source: TurnSource,
    public readonly kind: TurnMutationKind,
    cause?: unknown,
  ) {
    super(
      "操作结果尚未确认。请先刷新并检查会话历史或新会话，确认结果前不会再次发送。",
      { cause },
    );
    this.name = "MutationUncertainError";
  }
}
export function isExplicitMutationRejection(error: unknown): boolean {
  if (error instanceof MutationNotStartedError) return true;
  // Timeout/5xx may follow execution. Authentication and invalid-input responses are non-execution acknowledgements.
  if (error instanceof SessionApiError)
    return [400, 401, 403, 404, 405, 409, 422].includes(error.status);
  return false;
}
function record(key: string, value: TurnMutationRecord) {
  useThreadWorkflowStore.setState((state) => ({
    mutations: { ...state.mutations, [key]: value },
  }));
}
/** A captured action is sent at most once unless the server explicitly rejected it before execution. */
export function runTurnMutation<T>(
  kind: TurnMutationKind,
  chosen: TurnSource,
  send: () => Promise<T>,
  options?: { newIntent?: boolean },
): Promise<T> {
  const source = Object.freeze({ ...chosen });
  const key = mutationKey(kind, source);
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;
  const previous = useThreadWorkflowStore.getState().mutations[key];
  if (previous?.status === "completed" && !options?.newIntent)
    return Promise.resolve(previous.result as T);
  if (previous?.status === "pending" || previous?.status === "uncertain") {
    record(key, { ...previous, status: "uncertain", updatedAt: Date.now() });
    return Promise.reject(new MutationUncertainError(source, kind));
  }
  record(key, { kind, source, status: "pending", updatedAt: Date.now() });
  const task = (async () => {
    try {
      const result = await send();
      record(key, {
        kind,
        source,
        status: "completed",
        result,
        updatedAt: Date.now(),
      });
      return result;
    } catch (error) {
      const rejected = isExplicitMutationRejection(error);
      record(key, {
        kind,
        source,
        status: rejected ? "rejected" : "uncertain",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
      throw rejected ? error : new MutationUncertainError(source, kind, error);
    }
  })();
  inFlight.set(key, task);
  void task.finally(() => inFlight.delete(key)).catch(() => {});
  return task;
}
/** Call only after a read-only reconciliation proves this specific action's result. */
export function resolveTurnMutation(
  kind: TurnMutationKind,
  source: TurnSource,
  result: unknown,
) {
  record(mutationKey(kind, source), {
    kind,
    source,
    status: "completed",
    result,
    updatedAt: Date.now(),
  });
}
