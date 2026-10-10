import type { CodexHostOwner } from "./session-codex-host.js";
export interface CodexCloudCapability {
  configured: boolean;
  available: boolean;
  identity: string | null;
  reason: string | null;
  recovery: string;
  plan: string | null;
  snapshotAvailable?: boolean | null;
  snapshotReason?: string | null;
}
export interface CodexCloudEnvironment {
  id: string;
  name: string;
  repositories: string[];
}
export interface CodexCloudSnapshot {
  id: string;
  cwd: string;
  filename: string;
  bytes: number;
  files: string[];
  commitSha: string;
  branch: string;
  sha256: string;
  state: "prepared" | "uploading" | "verified" | "failed";
}
export interface CodexCloudTaskRequest {
  owner: CodexHostOwner;
  requestId: string;
  identity: string;
  prompt: string;
  environmentId?: string;
  snapshotId?: string;
  modelSlug?: string;
  localDelegation?: boolean;
  taskId?: string;
  turnId?: string;
}
