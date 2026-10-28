import type {
  FileEntry,
  FilePreviewResponse,
  ListFilesInput,
  ListFilesResponse,
  FileOperationInput,
  SshTarget,
} from "@agent-orchestrator/shared";
import { apiPost } from "../core/transport";

export type { FileEntry, ListFilesResponse, FilePreviewResponse, SshTarget };

export async function listFiles(
  body: ListFilesInput,
): Promise<ListFilesResponse> {
  return apiPost<ListFilesResponse>("/api/fs/list", body);
}

export async function previewFile(
  body: ListFilesInput,
): Promise<FilePreviewResponse> {
  return apiPost<FilePreviewResponse>("/api/fs/preview", body);
}

export async function fileOperation(
  body: FileOperationInput,
): Promise<{ ok: true; path?: string }> {
  return apiPost<{ ok: true; path?: string }>("/api/fs/operation", body);
}

export function buildFilePreviewUrl(path: string, sshTarget?: SshTarget): string {
  // Preview endpoint returns JSON; for images we use a dedicated image URL.
  const params = new URLSearchParams();
  params.set("path", path);
  if (sshTarget?.host) {
    params.set("sshHost", sshTarget.host);
    params.set("sshPort", String(sshTarget.port ?? 22));
    params.set("sshUser", sshTarget.username ?? "");
  }
  return `/api/fs/image?${params.toString()}`;
}

export function entryIsDirectory(entry: FileEntry): boolean {
  return entry.type === "directory";
}
