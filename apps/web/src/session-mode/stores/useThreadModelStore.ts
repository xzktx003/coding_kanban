import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReasoningEffort, CollaborationMode } from "@session/bindings";
import type {
  AskForApproval,
  SandboxMode,
  SandboxPolicy,
  ApprovalsReviewer,
} from "@session/bindings/v2";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";

export interface ThreadModelSettings {
  model: string;
  modelProvider: string;
  reasoningEffort: ReasoningEffort | null;
  providerModels: Record<string, string>;
  serviceTier?: string | null;
  sandbox?: SandboxMode;
  sandboxPolicy?: SandboxPolicy | null;
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  autoReviewCapability?: ApprovalsReviewer | null;
  webSearchRequest?: boolean;
  collaborationMode?: "default" | "plan";
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
  pendingFields?: Array<keyof ThreadModelSettings>;
  observed?: Omit<ThreadModelSettings, "providerModels">;
  notice?: ModelChangeNotice;
}
const UNKNOWN: ThreadModelSettings = {
  model: "",
  modelProvider: "openai",
  reasoningEffort: null,
  providerModels: {},
  serviceTier: null,
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  autoReviewCapability: null,
  webSearchRequest: false,
  collaborationMode: "default",
};
const EDITABLE_FIELDS = [
  "model",
  "modelProvider",
  "reasoningEffort",
  "serviceTier",
  "sandbox",
  "sandboxPolicy",
  "approvalPolicy",
  "approvalsReviewer",
  "webSearchRequest",
  "collaborationMode",
] as const;
export const useThreadModelStore = create<{
  threads: Record<string, ThreadModelEntry>;
}>()(
  persist(() => ({ threads: {} }), {
    name: "kanban.session.codex-thread-models",
    version: 2,
    migrate: (saved) => {
      const state = saved as { threads?: Record<string, ThreadModelEntry> };
      return {
        threads: Object.fromEntries(
          Object.entries(state.threads ?? {}).map(([id, entry]) => [
            id,
            { ...UNKNOWN, ...entry },
          ]),
        ),
      };
    },
  }),
);

/** Global choices are defaults for a new chat, never overrides for an existing one. */
export function getThreadModelSettings(
  threadId: string | null,
): Required<ThreadModelSettings> {
  if (threadId)
    return {
      ...UNKNOWN,
      ...useThreadModelStore.getState().threads[threadId],
    } as Required<ThreadModelSettings>;
  return {
    ...UNKNOWN,
    ...useConfigStore.getState(),
  } as Required<ThreadModelSettings>;
}

export function changeThreadModel(
  threadId: string,
  patch: Partial<ThreadModelSettings>,
) {
  useThreadModelStore.setState((s) => {
    const old = s.threads[threadId];
    const before = { ...UNKNOWN, ...old };
    const next = { ...before, ...patch };
    const changedModel =
      next.model !== before.model ||
      next.modelProvider !== before.modelProvider;
    const changedFields = EDITABLE_FIELDS.filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]),
    );
    if (!changedFields.length) return s;
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
          pendingFields: [
            ...new Set([
              ...(old?.pendingFields ??
                (old?.pending
                  ? (["model", "modelProvider", "reasoningEffort"] as const)
                  : [])),
              ...changedFields.filter((key) => key !== "sandboxPolicy"),
            ]),
          ],
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
    serviceTier?: string | null;
    approvalPolicy?: AskForApproval;
    approvalsReviewer?: ApprovalsReviewer;
    sandbox?: SandboxMode | SandboxPolicy;
    sandboxPolicy?: SandboxPolicy;
    webSearchRequest?: boolean;
    collaborationMode?: CollaborationMode | "default" | "plan";
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
    const nativePolicy =
      value.sandboxPolicy ??
      (typeof value.sandbox === "object" ? value.sandbox : undefined);
    const normalized = {
      ...(value.approvalsReviewer !== undefined
        ? {
            approvalsReviewer: value.approvalsReviewer,
            ...(value.approvalsReviewer !== "user"
              ? { autoReviewCapability: value.approvalsReviewer }
              : {}),
          }
        : {}),
      ...(value.serviceTier !== undefined
        ? { serviceTier: value.serviceTier }
        : {}),
      ...(value.approvalPolicy !== undefined
        ? { approvalPolicy: value.approvalPolicy }
        : {}),
      ...(nativePolicy ? { sandboxPolicy: structuredClone(nativePolicy) } : {}),
      ...(typeof value.sandbox === "string"
        ? { sandbox: value.sandbox }
        : nativePolicy
          ? {
              sandbox:
                nativePolicy.type === "readOnly"
                  ? ("read-only" as const)
                  : nativePolicy.type === "dangerFullAccess"
                    ? ("danger-full-access" as const)
                    : ("workspace-write" as const),
            }
          : {}),
      ...(value.webSearchRequest !== undefined
        ? { webSearchRequest: value.webSearchRequest }
        : nativePolicy && "networkAccess" in nativePolicy
          ? {
              webSearchRequest:
                nativePolicy.networkAccess === true ||
                nativePolicy.networkAccess === "enabled",
            }
          : {}),
      ...(value.collaborationMode !== undefined
        ? {
            collaborationMode:
              typeof value.collaborationMode === "string"
                ? value.collaborationMode
                : value.collaborationMode.mode,
          }
        : {}),
    };
    const observed = {
      model: value.model!,
      modelProvider: value.modelProvider ?? old?.modelProvider ?? "openai",
      reasoningEffort:
        value.reasoningEffort === undefined
          ? (old?.reasoningEffort ?? null)
          : value.reasoningEffort,
      ...normalized,
    };
    const matches =
      old?.model === observed.model &&
      old.modelProvider === observed.modelProvider &&
      (old.reasoningEffort === null ||
        old.reasoningEffort === observed.reasoningEffort) &&
      (old.pendingFields ?? []).every(
        (key) =>
          key in observed &&
          JSON.stringify(old[key]) ===
            JSON.stringify(observed[key as keyof typeof observed]),
      );
    const sameObserved =
      old?.observed?.model === observed.model &&
      old.observed.modelProvider === observed.modelProvider &&
      old.observed.reasoningEffort === observed.reasoningEffort &&
      Object.entries(normalized).every(
        ([key, value]) =>
          JSON.stringify(old.observed?.[key as keyof typeof old.observed]) ===
          JSON.stringify(value),
      );
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
          ...UNKNOWN,
          ...(!old
            ? {
                sandbox: useConfigStore.getState().sandbox,
                approvalPolicy: useConfigStore.getState().approvalPolicy,
                webSearchRequest: useConfigStore.getState().webSearchRequest,
                collaborationMode: useConfigStore.getState().collaborationMode,
              }
            : {}),
          ...old,
          ...observed,
          observed,
          revision,
          pending: false,
          pendingFields: [],
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
