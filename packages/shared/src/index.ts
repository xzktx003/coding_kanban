export type AgentSourceType =
  | "local"
  | "remote-connect"
  | "remote-tmux-discovered";

export type ConnectionState = "online" | "degraded" | "offline";

export type InteractionState =
  | "awaiting_input"
  | "running"
  | "idle"
  | "detached"
  | "exited";

export type StateConfidence = "high" | "medium" | "low";
export type AgentOutputStream = "stdout" | "stderr" | "system";
export type AgentControlMode = "observe" | "control";

export interface AgentTransportRef {
  terminalId?: string;
  processId?: number;
  tmuxSession?: string;
  tmuxPane?: string;
  runtimeId?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
}

export interface SshTarget {
  host: string;
  port?: number;
  username?: string;
  identityFile?: string;
}

export interface SshHostPreset {
  name: string;
  host: string;
  port: number;
  username?: string;
  identityFile?: string;
  defaultPath: string;
}

export interface SshHostsResponse {
  hosts: SshHostPreset[];
}

export interface AgentSessionRecord {
  id: string;
  workspaceId: string;
  hostId?: string;
  sourceType: AgentSourceType;
  agentKind: string;
  displayName: string;
  workingDirectory?: string;
  connectionState: ConnectionState;
  interactionState: InteractionState;
  hasUnreadCompletion?: boolean;
  stateConfidence?: StateConfidence;
  lastOutputAt?: string;
  lastHeartbeatAt?: string;
  lastRefreshedAt?: string;
  outputPreview?: string;
  lastUserMessageSummary?: string;
  lastAgentMessageSummary?: string;
  taskSummaryUpdatedAt?: string;
  projectName?: string;
  repositoryRoot?: string;
  gitBranch?: string;
  gitChangedFiles?: number;
  gitAddedLines?: number;
  gitDeletedLines?: number;
  gitIsWorktree?: boolean;
  gitSummaryUpdatedAt?: string;
  controlMode?: AgentControlMode;
  transportRef?: AgentTransportRef;
  agentSessionId?: string;
  sshTarget?: SshTarget;
  remoteCommand?: string;
  hidden?: boolean;
  tags?: string[];
}

export function isLocalCodexSessionCandidate(
  session: Pick<
    AgentSessionRecord,
    "agentKind" | "agentSessionId" | "hostId" | "sshTarget" | "transportRef"
  >,
): boolean {
  if (session.sshTarget || (session.hostId && session.hostId !== "local")) {
    return false;
  }

  const agentKind = session.agentKind.trim().toLowerCase();
  if (agentKind === "codex") {
    return true;
  }
  if (agentKind !== "node" && agentKind !== "shell") {
    return false;
  }

  return Boolean(
    session.agentSessionId ||
    session.transportRef?.tmuxPane ||
    session.transportRef?.tmuxSession,
  );
}

export interface AgentOutputEntry {
  id: string;
  timestamp: string;
  stream: AgentOutputStream;
  text: string;
}

export interface ListAgentSessionsResponse {
  items: AgentSessionRecord[];
  activeAgentSessionId: string | null;
  updatedAt: string;
}

export type GitAutoUpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "updated"
  | "conflict"
  | "error";

export type GitAutoUpdateConflictReason =
  | "local-changes"
  | "diverged"
  | "merge-blocked";

export interface GitAutoUpdateStatus {
  enabled: boolean;
  intervalMinutes: 10 | 30 | null;
  phase: GitAutoUpdatePhase;
  branch: string | null;
  remoteHead: string | null;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  conflictReason: GitAutoUpdateConflictReason | null;
  message: string | null;
}

export interface AppVersionResponse {
  runtimeId: string;
  startedAt: string;
  sourceRevision: string;
  gitAvailable: boolean;
  gitHead: string | null;
  gitBranch: string | null;
  autoUpdate?: GitAutoUpdateStatus;
}

export interface RestoreManagedSessionFailure {
  agentSessionId: string;
  displayName: string;
  error: string;
}

export interface RestoreManagedSessionsResponse {
  restoredIds: string[];
  alreadyConnectedIds: string[];
  manualRecoveryIds: string[];
  failed: RestoreManagedSessionFailure[];
}

export interface AgentSessionDetailResponse {
  agentSession: AgentSessionRecord;
  outputEntries: AgentOutputEntry[];
}

export type AgentTranscriptEntryKind = "user" | "assistant" | "tool";

export interface AgentTranscriptEntry {
  id: string;
  timestamp: string;
  kind: AgentTranscriptEntryKind;
  title: string;
  text: string;
  collapsedByDefault: boolean;
}

export interface AgentTranscriptResponse {
  available: boolean;
  agentKind: "codex";
  sessionId: string | null;
  matchedBy: "session-id" | "working-directory" | null;
  updatedAt: string | null;
  entries: AgentTranscriptEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  message?: string;
}

export interface AgentTaskSummaryResponse {
  available: boolean;
  lastUserMessageSummary?: string;
  lastAgentMessageSummary?: string;
  updatedAt: string | null;
}

export interface AgentGitSummary {
  available: boolean;
  projectName?: string;
  repositoryRoot?: string;
  branch?: string;
  head?: string;
  isGitRepository?: boolean;
  isWorktree?: boolean;
  changedFiles?: number;
  addedLines?: number;
  deletedLines?: number;
  unavailableReason?: string;
  updatedAt: string | null;
}

export type DiffFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted"
  | "binary";

export interface DiffFileChange {
  path: string;
  previousPath?: string;
  status: DiffFileStatus;
  addedLines: number;
  deletedLines: number;
  patch: string;
  binary?: boolean;
  truncated?: boolean;
}

export interface CheckoutDiffResponse {
  available: boolean;
  scope: "checkout";
  projectName?: string;
  repositoryRoot?: string;
  branch?: string;
  head?: string;
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  files: DiffFileChange[];
  generatedAt: string;
  truncated?: boolean;
  unavailableReason?: string;
}

export interface RevertGitHunkInput {
  path: string;
  hunkIndex: number;
  hunkHeader: string;
}

export interface RevertGitHunkResponse {
  ok: true;
  path: string;
  hunkIndex: number;
  hunkHeader: string;
}

export interface AgentTaskDiffResponse {
  available: boolean;
  scope: "task";
  agentKind: "codex";
  sessionId: string | null;
  matchedBy: "session-id" | "working-directory" | null;
  confidence: "medium" | "unavailable";
  taskTitle?: string;
  startedAt?: string;
  completedAt?: string;
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  files: DiffFileChange[];
  generatedAt: string;
  warning?: string;
  unavailableReason?: string;
}

export interface RegisterAgentSessionInput {
  workspaceId: string;
  hostId?: string;
  sourceType: AgentSourceType;
  agentKind: string;
  displayName: string;
  workingDirectory?: string;
  connectionState?: ConnectionState;
  interactionState?: InteractionState;
  stateConfidence?: StateConfidence;
  controlMode?: AgentControlMode;
  outputPreview?: string;
  transportRef?: AgentTransportRef;
  agentSessionId?: string;
  sshTarget?: SshTarget;
  remoteCommand?: string;
}

export interface FocusAgentSessionInput {
  agentSessionId: string;
}

export interface UpdateAgentSessionInput {
  displayName?: string;
  hidden?: boolean;
  hasUnreadCompletion?: boolean;
}

export interface StdinAgentSessionInput {
  input: string;
}

export interface LaunchLocalAgentInput {
  workspaceId: string;
  displayName: string;
  agentKind: string;
  workingDirectory?: string;
  hostId?: string;
  command: string;
  tmuxSessionName?: string;
  tmuxPaneId?: string;
}

export interface LaunchRemoteAgentInput {
  workspaceId: string;
  displayName: string;
  agentKind: string;
  workingDirectory?: string;
  command: string;
  sshTarget: SshTarget;
}

export interface DiscoverTmuxSessionsResponse {
  items: AgentSessionRecord[];
  unavailable: boolean;
}

export interface TmuxControlActionResponse {
  agentSession: AgentSessionRecord;
  outputEntries: AgentOutputEntry[];
}

export interface AgentSessionSnapshotEvent {
  type: "snapshot";
  payload: ListAgentSessionsResponse;
}

export interface AgentSessionDeltaEvent {
  type: "delta";
  payload: {
    upserts: AgentSessionRecord[];
    removedIds: string[];
    orderedIds: string[];
    activeAgentSessionId: string | null;
    updatedAt: string;
  };
}

export type AgentSessionStreamEvent =
  | AgentSessionSnapshotEvent
  | AgentSessionDeltaEvent;

export interface PtyResizeInput {
  cols: number;
  rows: number;
}

export interface ScanDirectoryInput {
  path: string;
  hostId?: string;
  sshTarget?: SshTarget;
}

export interface DirectorySuggestionsInput {
  prefix: string;
  sshTarget?: SshTarget;
}

export interface DirectorySuggestionsResponse {
  enabled: boolean;
  suggestions: string[];
}

export interface ScanResult {
  agentKind: string;
  status: "running" | "stopped";
  displayName: string;
  workingDirectory: string;
  pid?: number;
  tmuxSession?: string;
  tmuxPane?: string;
  lastActivity?: string;
  historyPath?: string;
  sshTarget?: SshTarget;
  sessionId?: string;
  sessionName?: string;
  binaryPath?: string;
}

export interface LaunchSshPtyInput {
  workspaceId: string;
  displayName: string;
  agentKind: string;
  sshTarget: SshTarget;
  remoteCommand: string;
  workingDirectory?: string;
  agentSessionId?: string;
  tmuxSessionName?: string;
  tmuxPaneId?: string;
}

export interface ScanDirectoryResponse {
  results: ScanResult[];
  scannedPath: string;
  hostId: string;
}

export const interactionStateOrder: InteractionState[] = [
  "awaiting_input",
  "running",
  "idle",
  "detached",
  "exited",
];

// --- Discovery & Grid Control DTOs ---

export interface DiscoverTmuxInput {
  hostId?: string;
  sshTarget?: SshTarget;
}

export interface AddDiscoveredTmuxInput {
  tmuxSession: string;
  tmuxPane?: string;
  displayName: string;
  workingDirectory: string;
  agentKind: string;
  interactionState?: InteractionState;
  outputPreview?: string;
  sshTarget?: SshTarget;
}

export interface KillTmuxSessionInput {
  tmuxSessionName: string;
  hostId?: string;
  sshTarget?: SshTarget;
}

export type VsCodeWebProvider = "code-server" | "openvscode-server";

export interface OpenVsCodeWebResponse {
  provider: VsCodeWebProvider;
  url: string;
  reused: boolean;
  workingDirectory: string;
}

export interface VsCodeWebProxyDiagnosticsResponse {
  timestamp: string;
  http: {
    activeRequests: number;
    requestsPerSecond: number;
    uploadKilobytesPerSecond: number;
    downloadKilobytesPerSecond: number;
    totalRequests: number;
    totalUploadKilobytes: number;
    totalDownloadKilobytes: number;
    lastStatusCode: number | null;
  };
  websocket: {
    activeConnections: number;
    messagesPerSecond: number;
    uploadKilobytesPerSecond: number;
    downloadKilobytesPerSecond: number;
    totalUploadMessages: number;
    totalDownloadMessages: number;
    totalUploadKilobytes: number;
    totalDownloadKilobytes: number;
  };
}

export interface TerminalHistoryDiagnosticsResponse {
  timestamp: string;
  pty: {
    activeSessions: number;
    maxScrollbackBytes: number;
    totalScrollbackBytes: number;
    totalDroppedScrollbackBytes: number;
    totalDroppedScrollbackChunks: number;
    truncatedSessionCount: number;
    sessions: Array<{
      agentSessionId: string;
      scrollbackBytes: number;
      scrollbackChunks: number;
      droppedScrollbackBytes: number;
      droppedScrollbackChunks: number;
    }>;
  };
  registry: {
    maxOutputEntries: number;
  };
  tmux: {
    captureLines: number;
  };
}

export type FileEntryType = "file" | "directory" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  type: FileEntryType;
  size: number;
  modifiedAt: string;
  owner: string;
  permissions: string;
  isHidden: boolean;
  symlinkTargetType?: "file" | "directory";
}

export interface ListFilesInput {
  path: string;
  sshTarget?: SshTarget;
  showHidden?: boolean;
}

export interface ListFilesResponse {
  entries: FileEntry[];
  path: string;
}

export interface FilePreviewInput {
  path: string;
  sshTarget?: SshTarget;
  maxBytes?: number;
  offset?: number;
}

export interface FilePreviewResponse {
  path: string;
  content: string;
  encoding: "utf8" | "binary";
  truncated: boolean;
  size: number;
  mimeType: string | null;
  offset: number;
  bytesRead: number;
  previousOffset: number | null;
  nextOffset: number | null;
}

export interface ChmodInput {
  path: string;
  mode: string;
  sshTarget?: SshTarget;
}

export interface FileOperationInput {
  operation: "mkdir" | "rename" | "delete";
  path: string;
  newPath?: string;
  sshTarget?: SshTarget;
}

export interface FileUploadResponse {
  uploadedPaths: string[];
}

// --- Shell Utilities ---
export { shellQuote, formatWorkingDirectory } from "./shell-utils.js";
