import { useCallback } from "react";
import type { ReasoningEffort } from "@session/bindings";
import type { SandboxMode, ApprovalsReviewer } from "@session/bindings/v2";
import {
  useConfigStore,
  SANDBOX_APPROVAL_MAP,
} from "@session/components/codex/stores/useConfigStore";
import {
  changeThreadModel,
  getThreadModelSettings,
  useThreadModelStore,
} from "../stores/useThreadModelStore";

export function useThreadModelSettings(threadId: string | null) {
  useThreadModelStore((s) => (threadId ? s.threads[threadId] : undefined));
  useConfigStore();
  const settings = getThreadModelSettings(threadId);
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
          approvalPolicy: SANDBOX_APPROVAL_MAP[sandbox],
        });
      else useConfigStore.getState().setAccessMode(sandbox);
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
        const policy = getThreadModelSettings(threadId).sandboxPolicy;
        const sandboxPolicy =
          policy && "networkAccess" in policy
            ? policy.type === "externalSandbox"
              ? {
                  ...policy,
                  networkAccess: webSearchRequest
                    ? ("enabled" as const)
                    : ("restricted" as const),
                }
              : { ...policy, networkAccess: webSearchRequest }
            : policy;
        changeThreadModel(threadId, {
          webSearchRequest,
          ...(sandboxPolicy ? { sandboxPolicy } : {}),
        });
      } else useConfigStore.getState().setWebSearch(webSearchRequest);
    },
    [threadId],
  );
  return {
    ...settings,
    setModel,
    setModelProvider,
    setReasoningEffort,
    setServiceTier,
    setAccessMode,
    setCollaborationMode,
    setApprovalsReviewer,
    setWebSearch,
  };
}
