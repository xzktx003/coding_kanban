import type {
  AddDiscoveredTmuxInput,
  AgentSessionDetailResponse,
  AgentSessionSnapshotEvent,
  AgentSessionRecord,
  ChmodInput,
  DirectorySuggestionsInput,
  DirectorySuggestionsResponse,
  DiscoverTmuxInput,
  DiscoverTmuxSessionsResponse,
  FileOperationInput,
  FilePreviewInput,
  FilePreviewResponse,
  FileUploadResponse,
  FocusAgentSessionInput,
  ListFilesInput,
  ListFilesResponse,
  LaunchLocalAgentInput,
  LaunchRemoteAgentInput,
  LaunchSshPtyInput,
  ListAgentSessionsResponse,
  OpenVsCodeWebResponse,
  RegisterAgentSessionInput,
  ScanDirectoryInput,
  ScanDirectoryResponse,
  SshHostsResponse,
  StdinAgentSessionInput,
  TerminalHistoryDiagnosticsResponse,
  TmuxControlActionResponse,
  UpdateAgentSessionInput,
  VsCodeWebProxyDiagnosticsResponse,
} from "@agent-orchestrator/shared";

import { recordAgentSnapshotFrame } from "./resource-diagnostics";

const viteEnv = import.meta.env ?? {};
const rawApiBaseUrl = viteEnv.VITE_API_BASE_URL ?? "";

function normalizeHttpBaseUrl(value: string): string {
  if (!value) {
    return "";
  }

  const url = new URL(value, window.location.origin);
  url.protocol = "http:";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeWsBaseUrl(value: string): string {
  const withoutAgentSessions = value.replace(/\/ws\/agent-sessions\/?$/, "");
  const url = new URL(withoutAgentSessions, window.location.origin);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

const apiBaseUrl = normalizeHttpBaseUrl(rawApiBaseUrl);

function defaultWebSocketProtocol(): "ws:" | "wss:" {
  return window.location.protocol === "https:" ? "wss:" : "ws:";
}

function wsBase(): string {
  if (viteEnv.VITE_API_WS_URL) {
    return normalizeWsBaseUrl(viteEnv.VITE_API_WS_URL);
  }

  if (apiBaseUrl) {
    const httpUrl = new URL(apiBaseUrl, window.location.origin);
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    httpUrl.search = "";
    httpUrl.hash = "";
    return httpUrl.toString().replace(/\/$/, "");
  }

  return `${defaultWebSocketProtocol()}//${window.location.host}`;
}

function buildWebSocketUrl(): string {
  return `${wsBase()}/ws/agent-sessions`;
}

export function buildTerminalWebSocketUrl(agentSessionId: string): string {
  return `${wsBase()}/ws/agent-sessions/${agentSessionId}/terminal`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers,
    ...init,
  });

  if (!response.ok) {
    throw new Error(await parseFailedResponseMessage(response));
  }

  return parseSuccessfulResponse<T>(response);
}

export async function parseFailedResponseMessage(
  response: Response,
): Promise<string> {
  const fallback = `Request failed: ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  const text = (await response.text()).trim();

  if (!text) {
    return fallback;
  }

  if (!contentType.includes("application/json")) {
    return text;
  }

  try {
    const payload = JSON.parse(text) as { error?: unknown };
    return typeof payload.error === "string" && payload.error.trim()
      ? payload.error
      : fallback;
  } catch {
    return fallback;
  }
}

export async function parseSuccessfulResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Response returned invalid JSON");
  }
}

export function listAgentSessions(): Promise<ListAgentSessionsResponse> {
  return request<ListAgentSessionsResponse>("/api/agent-sessions");
}

export function getAgentSessionDetail(
  agentSessionId: string,
): Promise<AgentSessionDetailResponse> {
  return request<AgentSessionDetailResponse>(
    `/api/agent-sessions/${agentSessionId}`,
  );
}

export function registerAgentSession(
  body: RegisterAgentSessionInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-sessions/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function focusAgentSession(
  body: FocusAgentSessionInput,
): Promise<ListAgentSessionsResponse> {
  return request<ListAgentSessionsResponse>("/api/agent-sessions/focus", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function sendAgentInput(
  agentSessionId: string,
  body: StdinAgentSessionInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>(
    `/api/agent-sessions/${agentSessionId}/stdin`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function launchLocalAgent(
  body: LaunchLocalAgentInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-launch/local", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function launchRemoteAgent(
  body: LaunchRemoteAgentInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-launch/remote", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function discoverTmuxSessions(
  body?: DiscoverTmuxInput,
): Promise<DiscoverTmuxSessionsResponse> {
  return request<DiscoverTmuxSessionsResponse>(
    "/api/agent-discovery/tmux/scan",
    {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

export function takeOverTmuxSession(
  agentSessionId: string,
): Promise<TmuxControlActionResponse> {
  return request<TmuxControlActionResponse>(
    `/api/agent-sessions/${agentSessionId}/tmux/takeover`,
    {
      method: "POST",
    },
  );
}

export function releaseTmuxSession(
  agentSessionId: string,
): Promise<TmuxControlActionResponse> {
  return request<TmuxControlActionResponse>(
    `/api/agent-sessions/${agentSessionId}/tmux/release`,
    {
      method: "POST",
    },
  );
}

export function refreshTmuxSession(
  agentSessionId: string,
): Promise<TmuxControlActionResponse> {
  return request<TmuxControlActionResponse>(
    `/api/agent-sessions/${agentSessionId}/tmux/refresh`,
    {
      method: "POST",
    },
  );
}

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentSessionListPayload(
  value: unknown,
): value is ListAgentSessionsResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.items) &&
    (typeof value.activeAgentSessionId === "string" ||
      value.activeAgentSessionId === null) &&
    typeof value.updatedAt === "string"
  );
}

export function parseAgentSessionSnapshotEvent(
  text: string,
): AgentSessionSnapshotEvent | null {
  let payload: unknown;

  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(payload) || payload.type !== "snapshot") {
    return null;
  }

  if (!isAgentSessionListPayload(payload.payload)) {
    return null;
  }

  return {
    type: "snapshot",
    payload: payload.payload,
  };
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export function subscribeAgentSessions(
  onSnapshot: (snapshot: ListAgentSessionsResponse) => void,
  onStatusChange?: (status: ConnectionStatus) => void,
): () => void {
  let closed = false;
  let closeAfterOpen = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let socket = new WebSocket(buildWebSocketUrl());

  function reportStatus(status: ConnectionStatus) {
    if (onStatusChange && !closed) {
      onStatusChange(status);
    }
  }

  async function handleMessageData(data: unknown) {
    const text =
      typeof data === "string"
        ? data
        : data instanceof Blob
          ? await data.text()
          : null;

    if (!text || closed) {
      return;
    }

    recordAgentSnapshotFrame(text);
    const payload = parseAgentSessionSnapshotEvent(text);

    if (payload && !closed) {
      onSnapshot(payload.payload);
    }
  }

  function connect() {
    reportStatus("connecting");
    socket.addEventListener("message", (event) => {
      void handleMessageData(event.data);
    });

    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      reportStatus("connected");
      if (closeAfterOpen) {
        socket.close();
      }
    });

    socket.addEventListener("close", () => {
      if (closeAfterOpen || closed) {
        return;
      }

      reportStatus("reconnecting");
      const delay = Math.min(
        WS_RECONNECT_BASE_MS * 2 ** reconnectAttempts,
        WS_RECONNECT_MAX_MS,
      );
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => {
        if (closed) return;
        socket = new WebSocket(buildWebSocketUrl());
        connect();
      }, delay);
    });
  }

  connect();

  return () => {
    closed = true;
    reportStatus("disconnected");

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket.readyState === WebSocket.CONNECTING) {
      closeAfterOpen = true;
      return;
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  };
}

export function launchPtyAgent(
  body: LaunchLocalAgentInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-launch/pty", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function launchSshPtyAgent(
  body: LaunchSshPtyInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-launch/ssh-pty", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function scanDirectory(
  body: ScanDirectoryInput,
): Promise<ScanDirectoryResponse> {
  return request<ScanDirectoryResponse>("/api/agent-discovery/scan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function addScanResult(
  body: ScanDirectoryInput & { index: number },
): Promise<AgentSessionRecord> {
  const { index, ...scanInput } = body;
  return request<AgentSessionRecord>(`/api/agent-discovery/scan/${index}/add`, {
    method: "POST",
    body: JSON.stringify(scanInput),
  });
}

export function getSshHosts(): Promise<SshHostsResponse> {
  return request<SshHostsResponse>("/api/ssh-hosts");
}

export function getDirectorySuggestions(
  body: DirectorySuggestionsInput,
): Promise<DirectorySuggestionsResponse> {
  return request<DirectorySuggestionsResponse>("/api/directory-suggestions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listFiles(body: ListFilesInput): Promise<ListFilesResponse> {
  return request<ListFilesResponse>("/api/fs/list", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fileOperation(body: FileOperationInput): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/fs/operation", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function previewFile(
  body: FilePreviewInput,
): Promise<FilePreviewResponse> {
  return request<FilePreviewResponse>("/api/fs/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function chmodFile(body: ChmodInput): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/fs/chmod", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function downloadFile(body: {
  path: string;
  sshTarget?: ListFilesInput["sshTarget"];
}): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/fs/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const filename = parseDownloadFilename(
    response.headers.get("Content-Disposition") ?? "",
    body.path,
  );

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function stripHeaderQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function sanitizeSuggestedDownloadFilename(filename: string): string {
  return filename.replace(/[\\/]/g, "_").replace(/[\x00-\x1f\x7f]/g, "_");
}

function parseEncodedHeaderFilename(value: string): string | null {
  const stripped = stripHeaderQuotes(value);
  const match = stripped.match(/^([^']*)'[^']*'(.*)$/);
  if (!match) {
    return null;
  }

  const charset = match[1]?.toLowerCase() ?? "";
  if (charset && charset !== "utf-8") {
    return null;
  }

  try {
    const decoded = decodeURIComponent(match[2] ?? "");
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

export function parseDownloadFilename(
  contentDisposition: string,
  fallbackPath: string,
): string {
  const encodedFilenameMatch = contentDisposition.match(
    /(?:^|;)\s*filename\*=([^;]+)/i,
  );
  const encodedFilename = encodedFilenameMatch?.[1]
    ? parseEncodedHeaderFilename(encodedFilenameMatch[1])
    : null;
  if (encodedFilename) {
    return sanitizeSuggestedDownloadFilename(encodedFilename);
  }

  const quotedFilenameMatch = contentDisposition.match(
    /(?:^|;)\s*filename="([^"]*)"/i,
  );
  if (quotedFilenameMatch?.[1]?.trim()) {
    return sanitizeSuggestedDownloadFilename(quotedFilenameMatch[1]);
  }

  const unquotedFilenameMatch = contentDisposition.match(
    /(?:^|;)\s*filename=([^;]+)/i,
  );
  const unquotedFilename = unquotedFilenameMatch?.[1]
    ? stripHeaderQuotes(unquotedFilenameMatch[1])
    : "";
  if (unquotedFilename.trim()) {
    return sanitizeSuggestedDownloadFilename(unquotedFilename);
  }

  return sanitizeSuggestedDownloadFilename(
    fallbackPath.split(/[\\/]/).filter(Boolean).pop() ?? "download",
  );
}

export function uploadFiles(options: {
  path?: string;
  overwritePath?: string;
  sshTarget?: ListFilesInput["sshTarget"];
  files: File[];
  relativePaths?: string[];
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}): Promise<FileUploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();

    if (options.path) {
      formData.append("path", options.path);
    }

    if (options.overwritePath) {
      formData.append("overwritePath", options.overwritePath);
    }

    if (options.sshTarget) {
      formData.append("sshTarget", JSON.stringify(options.sshTarget));
    }

    if (options.relativePaths && options.relativePaths.length > 0) {
      formData.append("relativePaths", JSON.stringify(options.relativePaths));
    }

    for (const file of options.files) {
      formData.append("files", file);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl}/api/fs/upload`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed: ${xhr.status}`));
        return;
      }

      try {
        resolve(parseXhrUploadResponse(xhr.response, () => xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new Error("Upload cancelled"));
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.send(formData);
  });
}

export function parseFileUploadResponse(
  response: unknown,
  responseText: string,
): FileUploadResponse {
  const parsed =
    response ??
    (() => {
      try {
        return JSON.parse(responseText) as unknown;
      } catch {
        throw new Error("Upload returned invalid JSON");
      }
    })();

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Upload returned an invalid response");
  }

  const uploadedPaths = (parsed as Partial<FileUploadResponse>).uploadedPaths;
  if (
    !Array.isArray(uploadedPaths) ||
    uploadedPaths.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Upload returned an invalid response");
  }

  return { uploadedPaths };
}

export function parseXhrUploadResponse(
  response: unknown,
  readResponseText: () => string,
): FileUploadResponse {
  if (response !== null && response !== undefined) {
    return parseFileUploadResponse(response, "");
  }

  let responseText = "";
  try {
    responseText = readResponseText();
  } catch {
    responseText = "";
  }

  return parseFileUploadResponse(response, responseText);
}

export function deleteAgentSession(agentSessionId: string): Promise<void> {
  return fetch(`${apiBaseUrl}/api/agent-sessions/${agentSessionId}`, {
    method: "DELETE",
  }).then((res) => {
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  });
}

export function updateAgentSession(
  agentSessionId: string,
  input: UpdateAgentSessionInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>(`/api/agent-sessions/${agentSessionId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function reconnectAgentSession(
  agentSessionId: string,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>(
    `/api/agent-sessions/${agentSessionId}/reconnect`,
    { method: "POST" },
  );
}

export function openVsCodeWeb(
  agentSessionId: string,
): Promise<OpenVsCodeWebResponse> {
  return request<OpenVsCodeWebResponse>(
    `/api/agent-sessions/${agentSessionId}/vscode-web`,
    { method: "POST" },
  );
}

export function getVsCodeWebProxyDiagnostics(): Promise<VsCodeWebProxyDiagnosticsResponse> {
  return request<VsCodeWebProxyDiagnosticsResponse>(
    "/api/diagnostics/vscode-web-proxy",
  );
}

export function getTerminalHistoryDiagnostics(): Promise<TerminalHistoryDiagnosticsResponse> {
  return request<TerminalHistoryDiagnosticsResponse>(
    "/api/diagnostics/terminal-history",
  );
}

export async function deleteAgentSessionSafe(
  agentSessionId: string,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(
    `${apiBaseUrl}/api/agent-sessions/${agentSessionId}`,
    { method: "DELETE" },
  );
  return { ok: res.ok, status: res.status };
}

export function hideAgentSession(
  agentSessionId: string,
): Promise<AgentSessionRecord> {
  return updateAgentSession(agentSessionId, { hidden: true });
}

export function unhideAgentSession(
  agentSessionId: string,
): Promise<AgentSessionRecord> {
  return updateAgentSession(agentSessionId, { hidden: false });
}

export function killTmuxSession(agentSessionId: string): Promise<void> {
  return request<void>(`/api/agent-sessions/${agentSessionId}/tmux/kill`, {
    method: "POST",
  });
}

export function addDiscoveredTmux(
  input: AddDiscoveredTmuxInput,
): Promise<AgentSessionRecord> {
  return request<AgentSessionRecord>("/api/agent-discovery/tmux/add", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
