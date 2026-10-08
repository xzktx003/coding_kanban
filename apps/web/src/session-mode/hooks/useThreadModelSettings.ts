import { useCallback } from "react";
import type { ReasoningEffort } from "@session/bindings";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  useThreadModelStore,
} from "../stores/useThreadModelStore";

export function useThreadModelSettings(threadId: string | null) {
  const entry = useThreadModelStore((s) =>
    threadId ? s.threads[threadId] : undefined,
  );
  const defaults = useConfigStore();
  const settings = threadId
    ? (entry ?? getThreadModelSettings(threadId))
    : defaults;
  const setModel = useCallback(
    (model: string) => {
      if (threadId) changeThreadModel(threadId, { model });
      else useConfigStore.getState().setModel(model);
    },
    [threadId],
  );
  const setModelProvider = useCallback(
    (modelProvider: string) => {
      if (threadId) {
        const current = getThreadModelSettings(threadId);
        changeThreadModel(threadId, {
          modelProvider,
          model: current.providerModels[modelProvider] ?? "",
        });
      } else useConfigStore.getState().setModelProvider(modelProvider);
    },
    [threadId],
  );
  const setReasoningEffort = useCallback(
    (reasoningEffort: ReasoningEffort) => {
      if (threadId) changeThreadModel(threadId, { reasoningEffort });
      else useConfigStore.getState().setReasoningEffort(reasoningEffort);
    },
    [threadId],
  );
  return { ...settings, setModel, setModelProvider, setReasoningEffort };
}
