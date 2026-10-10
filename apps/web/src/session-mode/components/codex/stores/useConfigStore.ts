import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReasoningEffort } from "@session/bindings";
import type {
  AskForApproval,
  SandboxMode,
  ApprovalsReviewer,
} from "@session/bindings/v2";
import type { Provider } from "@session/stores/settings";

export type Personality = "friendly" | "pragmatic";
export type ModeKind = "default" | "plan";
export type ThreadCwdMode = "local" | "worktree";

export interface ConfigStore {
  sandbox: SandboxMode;
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  reasoningEffort: ReasoningEffort;
  serviceTier: string | null;
  webSearchRequest: boolean;
  modelProvider: Provider;
  model: string;
  // Last-used model id per provider key (e.g. { openai: 'o3', custom: 'my-model' })
  providerModels: Record<string, string>;
  personality: Personality | null;
  collaborationMode: ModeKind;
  threadCwdMode: ThreadCwdMode;
  setModel: (model: string) => void;
  setModelProvider: (provider: Provider) => void;
  setAccessMode: (sandbox: SandboxMode) => void;
  setApprovalsReviewer: (reviewer: ApprovalsReviewer) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setServiceTier: (serviceTier: string | null) => void;
  setWebSearch: (webSearchRequest: boolean) => void;
  setPersonality: (personality: Personality | null) => void;
  setCollaborationMode: (mode: ModeKind) => void;
  setThreadCwdMode: (mode: ThreadCwdMode) => void;
}

export const SANDBOX_APPROVAL_MAP: Record<SandboxMode, AskForApproval> = {
  "read-only": "untrusted",
  "workspace-write": "on-request",
  "danger-full-access": "never",
};

export const SANDBOX_APPROVALS_REVIEWER_MAP: Record<
  SandboxMode,
  ApprovalsReviewer
> = {
  "read-only": "user",
  "workspace-write": "auto_review",
  "danger-full-access": "user",
};

export const approvalsReviewerForSandbox = (
  sandbox: SandboxMode,
): ApprovalsReviewer => SANDBOX_APPROVALS_REVIEWER_MAP[sandbox];

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      webSearchRequest: false,
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      reasoningEffort: "medium",
      serviceTier: null,
      modelProvider: "openai",
      model: "",
      providerModels: {},
      personality: "friendly",
      collaborationMode: "default",
      threadCwdMode: "local",

      setModel: (model: string) => {
        set((state) => ({
          model,
          providerModels: {
            ...state.providerModels,
            [state.modelProvider]: model,
          },
        }));
      },

      setModelProvider: (modelProvider: Provider) => {
        set((state) => ({
          modelProvider,
          model: state.providerModels[modelProvider] ?? "",
        }));
      },

      setAccessMode: (sandbox: SandboxMode) => {
        const approvalPolicy = SANDBOX_APPROVAL_MAP[sandbox];
        set({ sandbox, approvalPolicy });
      },
      setApprovalsReviewer: (approvalsReviewer) => set({ approvalsReviewer }),

      setReasoningEffort: (effort: ReasoningEffort) => {
        set({ reasoningEffort: effort });
      },
      setServiceTier: (serviceTier) => set({ serviceTier }),

      setWebSearch: (webSearchRequest: boolean) => {
        set({ webSearchRequest });
      },

      setPersonality: (personality: Personality | null) => {
        set({ personality });
      },

      setCollaborationMode: (mode: ModeKind) => {
        set({ collaborationMode: mode });
      },

      setThreadCwdMode: (mode: ThreadCwdMode) => {
        set({ threadCwdMode: mode });
      },
    }),
    {
      name: "kanban.session.codex-config-storage",
      version: 1,
      migrate: (persisted, version) => {
        const saved = persisted as Partial<ConfigStore>;
        // Update the legacy new-chat default once. Per-thread native settings
        // live in a separate store; subsequent explicit choices stay saved.
        if (
          version === 0 &&
          saved.sandbox === "workspace-write" &&
          saved.approvalPolicy === "on-request"
        )
          return {
            ...saved,
            sandbox: "danger-full-access" as const,
            approvalPolicy: "never" as const,
          };
        return saved;
      },
    },
  ),
);
