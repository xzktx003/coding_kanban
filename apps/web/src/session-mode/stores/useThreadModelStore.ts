import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReasoningEffort } from "@session/bindings";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";

export interface ThreadModelSettings {
  model: string;
  modelProvider: string;
  reasoningEffort: ReasoningEffort | null;
  providerModels: Record<string, string>;
}
export interface ModelChangeNotice {
  id: number;
  from: string;
  to: string;
  dismissed: boolean;
}
export interface ThreadModelEntry extends ThreadModelSettings {
  revision: number;
  pending: boolean;
  observed?: Omit<ThreadModelSettings, "providerModels">;
  notice?: ModelChangeNotice;
}
const UNKNOWN: ThreadModelSettings = {
  model: "",
  modelProvider: "openai",
  reasoningEffort: null,
  providerModels: {},
};
export const useThreadModelStore = create<{
  threads: Record<string, ThreadModelEntry>;
}>()(
  persist(() => ({ threads: {} }), {
    name: "kanban.session.codex-thread-models",
    version: 1,
  }),
);

/** Global choices are defaults for a new chat, never overrides for an existing one. */
export function getThreadModelSettings(
  threadId: string | null,
): ThreadModelSettings {
  if (threadId)
    return useThreadModelStore.getState().threads[threadId] ?? UNKNOWN;
  return useConfigStore.getState();
}

export function changeThreadModel(
  threadId: string,
  patch: Partial<ThreadModelSettings>,
) {
  useThreadModelStore.setState((s) => {
    const old = s.threads[threadId];
    const before = old ?? UNKNOWN;
    const next = { ...before, ...patch };
    const changedModel =
      next.model !== before.model ||
      next.modelProvider !== before.modelProvider;
    if (!changedModel && next.reasoningEffort === before.reasoningEffort)
      return s;
    const revision = (old?.revision ?? 0) + 1;
    const describe = (v: ThreadModelSettings) =>
      `${v.model || "默认模型"}${v.modelProvider === "openai" ? "" : ` (${v.modelProvider})`}`;
    return {
      threads: {
        ...s.threads,
        [threadId]: {
          ...old,
          ...next,
          providerModels: {
            ...before.providerModels,
            ...patch.providerModels,
            [next.modelProvider]: next.model,
          },
          revision,
          pending: true,
          ...(changedModel
            ? {
                notice: {
                  id: revision,
                  from: describe(before),
                  to: describe(next),
                  dismissed: false,
                },
              }
            : {}),
        },
      },
    };
  });
}

/** Native responses/events belong to the specified thread, including background resumes. */
export function hydrateThreadModel(
  threadId: string,
  value: {
    model?: string;
    modelProvider?: string;
    reasoningEffort?: ReasoningEffort | null;
  },
  options: { revision?: number; notify?: boolean } = {},
) {
  if (!value.model) return;
  useThreadModelStore.setState((s) => {
    const old = s.threads[threadId];
    // An HTTP history snapshot started before the user's selection cannot undo it.
    if (
      options.revision !== undefined &&
      options.revision !== (old?.revision ?? 0)
    )
      return s;
    const observed = {
      model: value.model!,
      modelProvider: value.modelProvider ?? old?.modelProvider ?? "openai",
      reasoningEffort:
        value.reasoningEffort === undefined
          ? (old?.reasoningEffort ?? null)
          : value.reasoningEffort,
    };
    const matches =
      old?.model === observed.model &&
      old.modelProvider === observed.modelProvider &&
      (old.reasoningEffort === null ||
        old.reasoningEffort === observed.reasoningEffort);
    const sameObserved =
      old?.observed?.model === observed.model &&
      old.observed.modelProvider === observed.modelProvider &&
      old.observed.reasoningEffort === observed.reasoningEffort;
    if (old?.pending && !matches)
      return sameObserved
        ? s
        : {
            threads: {
              ...s.threads,
              [threadId]: { ...old, observed, revision: old.revision + 1 },
            },
          };
    if (
      old &&
      !old.pending &&
      matches &&
      old.reasoningEffort === observed.reasoningEffort &&
      sameObserved
    )
      return s;
    const changed =
      old &&
      (old.model !== observed.model ||
        old.modelProvider !== observed.modelProvider);
    const revision = (old?.revision ?? 0) + 1;
    return {
      threads: {
        ...s.threads,
        [threadId]: {
          ...old,
          ...observed,
          observed,
          revision,
          pending: false,
          providerModels: {
            ...old?.providerModels,
            [observed.modelProvider]: observed.model,
          },
          ...(changed
            ? {
                notice: options.notify
                  ? {
                      id: revision,
                      from: old.model,
                      to: observed.model,
                      dismissed: false,
                    }
                  : undefined,
              }
            : {}),
        },
      },
    };
  });
}

export function dismissModelNotice(threadId: string, noticeId: number) {
  useThreadModelStore.setState((s) => {
    const old = s.threads[threadId];
    if (!old?.notice || old.notice.id !== noticeId) return s;
    return {
      threads: {
        ...s.threads,
        [threadId]: {
          ...old,
          notice: { ...old.notice, dismissed: true },
        },
      },
    };
  });
}
