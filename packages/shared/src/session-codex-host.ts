/** Coding Kanban companion protocol; it is independent from the native Codex app-server. */
export const CODEX_HOST_CHANNEL = "coding-kanban.codex-host";
export const CODEX_HOST_VERSION = 1 as const;
export interface CodexHostOwner {
  cwd: string;
  threadId: string | null;
  draftOwner: string;
  agentId?: string;
}
export interface CodexEditorContext {
  path: string;
  text: string;
  languageId?: string;
  range?: {
    start: number;
    end: number;
    startColumn?: number;
    endColumn?: number;
  };
  dirty?: boolean;
}
export interface CodexHostCapabilities {
  context: boolean;
  openLocation: boolean;
  showDiff: boolean;
  todoCodeLens: boolean;
  lsp: boolean;
}
export type CodexHostCommand =
  | { type: "context"; selectionOnly?: boolean }
  | { type: "workspaceState" }
  | { type: "openLocation"; path: string; line?: number; column?: number }
  | {
      type: "showDiff";
      path: string;
      before: string;
      after: string;
      title?: string;
    }
  | { type: "definitions"; path: string; line: number; column: number };
export interface CodexHostWorkspace {
  cwd: string;
  git: {
    available: boolean;
    repoRoot: string | null;
    mutationAllowed: boolean;
    reason: string | null;
  };
  branch: string | null;
  branches: string[];
  dirty: boolean | null;
  agents: { text: string; revision: string; exists: boolean };
  recommendedSkills: Array<{
    id: string;
    name: string;
    description: string;
    installed: boolean;
  }>;
}
export interface CodexHostEnvelope {
  channel: typeof CODEX_HOST_CHANNEL;
  version: typeof CODEX_HOST_VERSION;
  nonce: string;
  owner: CodexHostOwner;
  type:
    | "init"
    | "ready"
    | "command"
    | "result"
    | "context"
    | "status"
    | "dispose";
  requestId?: string;
  payload?: unknown;
  error?: string;
}
export interface CodexHostStatus {
  available: boolean;
  reason: string | null;
  capabilities: CodexHostCapabilities;
  instanceId: string | null;
}
