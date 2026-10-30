import { invoke } from "@tauri-apps/api/core";
import { toast } from "@session/components/ui/use-toast";
import {
  authHeaders,
  buildUrl,
  isDesktopTauri,
  isTauri,
} from "@session/hooks/runtime";
import { readResponseJson } from "./readResponseJson";

export type MarketplaceSkillItem = {
  name: string;
  description?: string | null;
  license?: string | null;
  skillMdPath: string;
  sourceDirPath: string;
  installed: boolean;
};

export type InstalledSkillItem = {
  name: string;
  path: string;
  skillMdPath?: string | null;
  description?: string | null;
};

export type SkillScope = "user" | "project";

/** Preserve HTTP certainty for callers that must not blindly resend mutations. */
export class SessionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly deliveryStage?: "not-admitted" | "outcome-unknown",
  ) {
    super(message);
  }
}
export function isExplicitRequestRejection(error: unknown): boolean {
  return (
    error instanceof SessionApiError &&
    error.deliveryStage !== "outcome-unknown" &&
    (error.deliveryStage === "not-admitted" ||
      [400, 401, 403, 404, 405, 409, 422].includes(error.status))
  );
}
export type SkillAgent = "codex" | "cc";
export type UnifiedMcpClientName = "codex" | "cc";

export type UnifiedMcpConfig = {
  mcpServers?: Record<string, unknown>;
};

export type TauriFileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  extension: string | null;
};

export type TerminalStartResponse = {
  session_id: string;
  shell: string;
};

async function extractApiError(response: Response) {
  let message = `Request failed: ${response.status}`;
  let code: string | undefined;
  let stage: SessionApiError["deliveryStage"];
  try {
    const payload = await readResponseJson<{
      message?: unknown;
      error?: unknown;
      code?: unknown;
      deliveryStage?: unknown;
    }>(response);
    if (typeof payload?.message === "string" && payload.message)
      message = payload.message;
    else if (typeof payload?.error === "string" && payload.error)
      message = payload.error;
    if (typeof payload?.code === "string") code = payload.code;
    if (
      payload?.deliveryStage === "not-admitted" ||
      payload?.deliveryStage === "outcome-unknown"
    )
      stage = payload.deliveryStage;
  } catch {
    // The status alone cannot prove that a mutation was rejected: a lost or
    // truncated error body may have carried an outcome-unknown receipt.
    stage = "outcome-unknown";
  }
  return new SessionApiError(message, response.status, code, stage);
}

export async function invokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, payload);
}

// Tauri errors arrive as plain strings, often wrapping a JSON-RPC error such as
// `Request failed: {"code":-32600,"message":"..."}`. Show the inner message.
function formatInvokeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const start = raw.indexOf("{");
  if (start !== -1) {
    try {
      const payload = JSON.parse(raw.slice(start)) as { message?: string };
      if (payload?.message) return payload.message;
    } catch {}
  }
  return raw;
}

// Same as `invokeTauri`, but surfaces failures as a toast like the web path does.
async function invokeTauriWithToast<T>(
  command: string,
  payload: Record<string, unknown> | undefined,
  options?: { suppressToast?: boolean },
): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    const message = formatInvokeError(error);
    if (!options?.suppressToast) {
      toast({
        title: "Request failed",
        description: message,
        variant: "destructive",
        id: message,
      });
    }
    throw new Error(message);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  return getJsonWithOptions<T>(path);
}

export async function getJsonWithOptions<T>(
  path: string,
  options?: { suppressToast?: boolean; signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal: options?.signal,
  });

  if (!response.ok) {
    const error = await extractApiError(response);
    const message = error.message;
    if (!options?.suppressToast) {
      toast({
        title: "Request failed",
        description: message,
        variant: "destructive",
        id: message,
      });
    }
    return Promise.reject(error);
  }

  return await readResponseJson<T>(response);
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return postJsonWithOptions<T>(path, body);
}

export async function postJsonWithOptions<T>(
  path: string,
  body?: unknown,
  options?: {
    suppressToast?: boolean;
    signal?: AbortSignal;
    readPriority?: "interactive" | "background";
  },
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(path === "/api/codex/thread/turns/list?view=chat" &&
      options?.readPriority
        ? { "x-session-read-priority": options.readPriority }
        : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: options?.signal,
  });

  if (!response.ok) {
    const error = await extractApiError(response);
    const message = error.message;
    if (!options?.suppressToast) {
      toast({
        title: "Request failed",
        description: message,
        variant: "destructive",
        id: message,
      });
    }
    return Promise.reject(error);
  }

  return await readResponseJson<T>(response);
}

export async function postNoContent(
  path: string,
  body?: unknown,
): Promise<void> {
  return postNoContentWithOptions(path, body);
}

export async function postNoContentWithOptions(
  path: string,
  body?: unknown,
  options?: { suppressToast?: boolean },
): Promise<void> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const error = await extractApiError(response);
    const message = error.message;
    if (!options?.suppressToast) {
      toast({
        title: "Request failed",
        description: message,
        variant: "destructive",
        id: message,
      });
    }
    return Promise.reject(error);
  }
}

export async function dual<T>(
  command: string,
  tauriArgs: Record<string, unknown> | undefined,
  path: string,
  body?: unknown,
  options?: { suppressToast?: boolean },
): Promise<T> {
  if (isDesktopTauri()) {
    return await invokeTauriWithToast<T>(command, tauriArgs, options);
  }
  return await postJsonWithOptions<T>(path, body, options);
}

export async function dualGet<T>(
  command: string,
  tauriArgs: Record<string, unknown> | undefined,
  path: string,
  options?: { suppressToast?: boolean },
): Promise<T> {
  if (isDesktopTauri()) {
    return await invokeTauriWithToast<T>(command, tauriArgs, options);
  }
  return await getJsonWithOptions<T>(path, options);
}

export async function dualVoid(
  command: string,
  tauriArgs: Record<string, unknown> | undefined,
  path: string,
  body?: unknown,
): Promise<void> {
  if (isDesktopTauri()) {
    await invokeTauriWithToast(command, tauriArgs);
    return;
  }
  await postNoContent(path, body);
}

export { isDesktopTauri, isTauri, toast };
