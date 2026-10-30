import type { CcAgentOptionsPayload } from "@session/types/cc/agentOptions";
import { claudeConnectionOwner } from "../claudeConnectionIdentity";
import { useCCStore } from "../../stores/cc";
import {
  getJson,
  postJson,
  postJsonWithOptions,
  postNoContent,
} from "./shared";

export async function ccNewSession(options: CcAgentOptionsPayload) {
  return await postJson<string>("/api/cc/new-session", { options });
}

export async function ccSendMessage(
  sessionId: string,
  message: string,
  imagePaths: string[] = [],
) {
  const trimmed = message.trim();
  await postNoContent("/api/cc/send-message", {
    session_id: sessionId,
    message: trimmed,
    image_paths: imagePaths,
    ...ccOwnerProof(sessionId),
  });
}

export async function ccInterrupt(sessionId: string) {
  await postNoContent("/api/cc/interrupt", { session_id: sessionId, ...ccOwnerProof(sessionId) });
}

function ccOwnerProof(id: string) {
  const owner=claudeConnectionOwner(id);
  return owner ? {expected_runtime_instance:owner.runtimeInstance,expected_cwd:owner.cwd} : {};
}
export interface ClaudeSessionSnapshot {
  runtimeInstance: string; sessionId: string; eventSessionId: string; nativeSessionId: string|null;
  cwd: string; optionsKnown: boolean; options: Record<string,unknown>; connected: boolean; running: boolean;
  permissions: Array<{requestId:string;sessionId:string;toolName:string;toolInput:Record<string,unknown>;alwaysAllowTarget:"project"|"session";toolInputTruncated:boolean;inputAvailable:boolean;inputRevision:string;executionId:string;inputError?:string}>;
  revision: number;
  historyRecoveryError?: string;
}
export function ccReadSessionSnapshot(id:string,cwd:string,options?:{signal?:AbortSignal;suppressToast?:boolean}) {
  return postJsonWithOptions<ClaudeSessionSnapshot>("/api/cc/session-snapshot",{session_id:id,...ccOwnerProof(id),expected_cwd:cwd},options);
}
export function ccReadPermissionDetail(id:string,requestId:string,runtimeInstance:string,offset:number,itemRevision?:string,signal?:AbortSignal) {
  return postJsonWithOptions<{text:string;nextOffset:number|null;itemRevision:string;format:"json"}>("/api/cc/permission-detail",{
    session_id:id,request_id:requestId,expected_runtime_instance:runtimeInstance,offset,limit:65536,...(itemRevision?{expected_item_revision:itemRevision}:{}),
  },{signal,suppressToast:true});
}

export async function ccResumeSession(
  sessionId: string,
  options: CcAgentOptionsPayload,
) {
  await postNoContent("/api/cc/resume-session", {
    session_id: sessionId,
    options,
  });
}

export async function ccGetInstalledSkills() {
  return await getJson<string[]>("/api/cc/installed-skills");
}

export async function ccGetSlashCommands(cwd?: string) {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  return await getJson<string[]>(`/api/cc/slash-commands${qs}`);
}

type CcListSessionsOptions = {
  limit?: number;
  offset?: number;
  includeWorktrees?: boolean;
};

export type CcSessionListResult<T> = { sessions: T[]; total: number };

export async function ccListSessions<T = unknown>(
  directory?: string | null,
  options: CcListSessionsOptions = {},
) {
  const { offset = 0, includeWorktrees = true, limit } = options;

  const params = new URLSearchParams({
    offset: String(offset),
    includeWorktrees: String(includeWorktrees),
  });
  if (directory) {
    params.set("directory", directory);
  }
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  return await getJson<CcSessionListResult<T>>(
    `/api/cc/sessions?${params.toString()}`,
  );
}

export async function ccGetSettings<T = unknown>() {
  return await getJson<T>("/api/cc/settings");
}

export async function ccUpdateSettings(settings: unknown) {
  await postNoContent("/api/cc/settings", { settings });
}

export async function ccMcpAdd(request: unknown, workingDir: string) {
  await postJson("/api/cc/mcp/add", {
    request,
    working_dir: workingDir,
  });
}

export async function ccMcpList<T = unknown>(workingDir: string) {
  return await postJson<T>("/api/cc/mcp/list", {
    working_dir: workingDir,
  });
}

export async function ccMcpGet<T = unknown>(name: string, workingDir: string) {
  return await postJson<T>("/api/cc/mcp/get", {
    name,
    working_dir: workingDir,
  });
}

export async function ccListProjects() {
  return await getJson<string[]>("/api/cc/mcp/projects");
}

export async function ccMcpRemove(
  name: string,
  workingDir: string,
  scope = "local",
) {
  await postJson("/api/cc/mcp/remove", {
    name,
    working_dir: workingDir,
    scope,
  });
}

export async function ccMcpEnable(name: string, workingDir: string) {
  await postJson("/api/cc/mcp/enable", {
    name,
    working_dir: workingDir,
  });
}

export async function ccMcpDisable(name: string, workingDir: string) {
  await postJson("/api/cc/mcp/disable", {
    name,
    working_dir: workingDir,
  });
}

export async function ccDeleteSession(sessionId: string): Promise<void> {
  await postNoContent("/api/cc/delete-session", {
    session_id: sessionId,
  });
}

export interface SdkSessionMessage {
  type: "user" | "assistant";
  uuid: string;
  session_id: string;
  message?: Record<string, unknown> | null;
  parent_tool_use_id?: string | null;
  truncated?: boolean;
  historyDetail?: { itemId: string };
  historyImages?: Array<{ index: number; mimeType: string; label?: string }>;
}

export async function ccGetSessionMessages(
  sessionId: string,
  options?: { signal?: AbortSignal; suppressToast?: boolean },
): Promise<SdkSessionMessage[]> {
  return await postJsonWithOptions<SdkSessionMessage[]>(
    "/api/cc/session-messages",
    { session_id: sessionId },
    options,
  );
}

export interface ClaudeTranscriptPage {
  data: SdkSessionMessage[];
  nextCursor: string | null;
  revision: string;
  truncated: boolean;
  projection: "cc-messages";
}
/** Bounded read-only display projection. Never falls back to the raw full history. */
export async function ccReadSessionTranscript(
  sessionId: string,
  options: {
    signal?: AbortSignal;
    suppressToast?: boolean;
    cursor?: string;
    metadataOnly?: boolean;
  } = {},
): Promise<ClaudeTranscriptPage> {
  const { cursor, metadataOnly, ...requestOptions } = options;
  return postJsonWithOptions<ClaudeTranscriptPage>(
    "/api/cc/session-messages?view=recent",
    {
      session_id: sessionId,
      limit: 128,
      ...(cursor ? { cursor } : {}),
      ...(metadataOnly ? { metadataOnly: true } : {}),
    },
    requestOptions,
  );
}

export async function ccResolvePermission(
  requestId: string,
  decision: string,
): Promise<void> {
  const request=Object.values(useCCStore.getState().sessionMessagesMap).flat().find(m=>m.type==="permission_request"&&m.requestId===requestId);
  const proof=request?.type==="permission_request"&&request.recoveryRuntimeInstance?{session_id:request.sessionId,expected_runtime_instance:request.recoveryRuntimeInstance,execution_id:request.executionId,input_revision:request.inputRevision}:{};
  await postNoContent("/api/cc/resolve-permission", {
    request_id: requestId,
    decision,
    ...proof,
  });
}

export async function ccSetPermissionMode(sessionId: string, mode: string) {
  await postNoContent("/api/cc/set-permission-mode", {
    session_id: sessionId,
    mode,
    ...ccOwnerProof(sessionId),
  });
}
