import { threadPermissionsKnown } from "../services/threadPermissionProjection";
import { useCallback, useEffect } from "react";
import type { ReasoningEffort, Personality } from "@session/bindings";
import type { SandboxMode, ApprovalsReviewer } from "@session/bindings/v2";
import {
  useConfigStore,
  SANDBOX_APPROVAL_MAP,
  type ModelSelection,
} from "@session/components/codex/stores/useConfigStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  useThreadModelStore,
  ensureThreadModelSettings,
  retryThreadModelSettings,
} from "../stores/useThreadModelStore";

export function useThreadModelSettings(threadId: string | null) {
  useThreadModelStore((s) => (threadId ? s.threads[threadId] : undefined));
  const storage = useThreadModelStore((s) => threadId ? s.storage?.[threadId] : undefined);
  useEffect(() => {
    if (threadId) void ensureThreadModelSettings(threadId).catch(() => {});
  }, [threadId]);
  const retrySettings = useCallback(async () => {
    if (threadId) await retryThreadModelSettings(threadId);
  }, [threadId]);
  useConfigStore();
  const settings = getThreadModelSettings(threadId);
  const setModel = useCallback(
    (model: string) => {
      if (threadId) changeThreadModel(threadId, { model });
      else useConfigStore.getState().setModel(model);
    },
    [threadId],
  );
  const setModelSelection = useCallback(
    ({ model, reasoningEffort, serviceTier }: ModelSelection) => {
      if (threadId) changeThreadModel(threadId, {
        model,
        reasoningEffort,
        ...(serviceTier === undefined ? {} : { serviceTier }),
      });
      else useConfigStore.getState().setModelSelection({ model, reasoningEffort, serviceTier });
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
  const setServiceTier = useCallback(
    (serviceTier: string | null) => {
      if (threadId) changeThreadModel(threadId, { serviceTier });
      else useConfigStore.getState().setServiceTier(serviceTier);
    },
    [threadId],
  );
  const setAccessMode = useCallback(
    (sandbox: SandboxMode) => {
      if (threadId)
        changeThreadModel(threadId, {
          sandbox,
          sandboxPolicy: null,
          webSearchRequest: getThreadModelSettings(threadId).permissionSources?.webSearchRequest ? getThreadModelSettings(threadId).webSearchRequest : false,
          approvalPolicy: SANDBOX_APPROVAL_MAP[sandbox],
        });
      else useConfigStore.getState().setAccessMode(sandbox);
    },
    [threadId],
  );
  const setPersonality = useCallback(
    (personality: Personality | null) => {
      if (threadId) changeThreadModel(threadId, { personality });
      else useConfigStore.getState().setPersonality(personality);
    },
    [threadId],
  );
  const setCollaborationMode = useCallback(
    (collaborationMode: "default" | "plan") => {
      if (threadId) changeThreadModel(threadId, { collaborationMode });
      else useConfigStore.getState().setCollaborationMode(collaborationMode);
    },
    [threadId],
  );
  const setApprovalsReviewer = useCallback(
    (approvalsReviewer: ApprovalsReviewer) => {
      if (threadId) changeThreadModel(threadId, { approvalsReviewer });
      else useConfigStore.getState().setApprovalsReviewer(approvalsReviewer);
    },
    [threadId],
  );
  const setWebSearch = useCallback(
    (webSearchRequest: boolean) => {
      if (threadId) {
        // Rebase policy/network inside the settings transaction. Copying this
        // page's current policy would race another page's canonical metadata.
        changeThreadModel(threadId, { webSearchRequest });
      } else useConfigStore.getState().setWebSearch(webSearchRequest);
    },
    [threadId],
  );
  return {
    ...settings,
    permissionsKnown: threadPermissionsKnown(settings),
    settingsStorage: storage,
    settingsLoading: !!threadId && (!storage || storage.status === "loading"),
    retrySettings,
    setModel,
    setModelSelection,
    setModelProvider,
    setReasoningEffort,
    setServiceTier,
    setAccessMode,
    setPersonality,
    setCollaborationMode,
    setApprovalsReviewer,
    setWebSearch,
  };
}
