import { create } from "zustand";
import { readWithDeadline } from "./sessionReadQueue";

export type ConnectionChannel = "health" | "tabs" | "projects" | "events";
export type ConnectionFailureKind =
  | "http"
  | "timeout"
  | "network"
  | "response"
  | "storage"
  | "stale"
  | "unknown";
export class SessionSyncError extends Error {
  constructor(
    readonly kind: ConnectionFailureKind,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(kind);
  }
}
export interface ConnectionFailure {
  kind: ConnectionFailureKind;
  status?: number;
  firstAt: number;
  lastAt: number;
  attempts: number;
}
interface ChannelDiagnostic {
  failure: ConnectionFailure | null;
  lastFailure: ConnectionFailure | null;
  totalFailures: number;
  requests: number;
  startedAt: number;
  lastSuccessAt: number | null;
  durationMs: number;
  retryAt: number | null;
  pending: number;
  mode: "read" | "write";
}
const empty = (): ChannelDiagnostic => ({
  failure: null,
  lastFailure: null,
  totalFailures: 0,
  requests: 0,
  startedAt: 0,
  lastSuccessAt: null,
  durationMs: 0,
  retryAt: null,
  pending: 0,
  mode: "read",
});
/** Four fixed records, no payloads, URLs, credentials or unbounded request log. */
export const useSessionConnectionDiagnostics = create<
  Record<ConnectionChannel, ChannelDiagnostic>
>(() => ({
  health: empty(),
  tabs: empty(),
  projects: empty(),
  events: empty(),
}));

/** Explicit support export: fixed connection metadata, never store payloads. */
export function connectionDiagnosticSnapshot() {
  const failure = (f: ConnectionFailure | null) =>
    f
      ? {
          kind: f.kind,
          status: f.status,
          firstAt: f.firstAt,
          lastAt: f.lastAt,
          attempts: f.attempts,
        }
      : null;
  const state = useSessionConnectionDiagnostics.getState();
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    channels: Object.fromEntries(
      (["health", "tabs", "projects", "events"] as const).map((channel) => {
        const s = state[channel];
        return [
          channel,
          {
            requests: s.requests,
            startedAt: s.startedAt,
            lastSuccessAt: s.lastSuccessAt,
            durationMs: s.durationMs,
            retryAt: s.retryAt,
            pending: s.pending,
            mode: s.mode,
            failure: failure(s.failure),
            lastFailure: failure(s.lastFailure),
            totalFailures: s.totalFailures,
          },
        ];
      }),
    ),
  };
}
/** Available after transient recovery too; only the last failure is retained. */
export function downloadSessionConnectionDiagnostic() {
  const snapshot = {
    ...connectionDiagnosticSnapshot(),
    page: {
      protocol: location.protocol,
      visibility: document.visibilityState,
      onlineHint: navigator.onLine,
      build: import.meta.env.DEV ? "development" : "production",
    },
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanban-connection-diagnostics.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function beginConnectionCheck(
  channel: ConnectionChannel,
  mode: "read" | "write" = "read",
  pending = 0,
) {
  useSessionConnectionDiagnostics.setState((state) => ({
    [channel]: {
      ...state[channel],
      requests: state[channel].requests + 1,
      startedAt: Date.now(),
      retryAt: null,
      mode,
      pending,
    },
  }));
}
export function connectionCheckSucceeded(channel: ConnectionChannel) {
  useSessionConnectionDiagnostics.setState((state) => ({
    [channel]: {
      ...state[channel],
      failure: null,
      lastSuccessAt: Date.now(),
      durationMs: Date.now() - state[channel].startedAt,
      retryAt: null,
    },
  }));
}
export function connectionCheckFailed(
  channel: ConnectionChannel,
  error: unknown,
  local = false,
) {
  const kind =
    error instanceof SessionSyncError
      ? error.kind
      : local
        ? "storage"
        : error instanceof DOMException && error.name === "TimeoutError"
          ? "timeout"
          : error instanceof SyntaxError
            ? "response"
            : error instanceof TypeError
              ? "network"
              : "unknown";
  const status = error instanceof SessionSyncError ? error.status : undefined;
  useSessionConnectionDiagnostics.setState((state) => {
    const previous = state[channel].failure;
    const failure = {
      kind,
      status,
      firstAt: previous?.firstAt ?? Date.now(),
      lastAt: Date.now(),
      attempts: (previous?.attempts ?? 0) + 1,
    };
    return {
      [channel]: {
        ...state[channel],
        durationMs: Date.now() - state[channel].startedAt,
        failure,
        lastFailure: failure,
        totalFailures: Math.min(
          Number.MAX_SAFE_INTEGER,
          state[channel].totalFailures + 1,
        ),
      },
    };
  });
  return kind;
}
export function scheduleConnectionRetry(
  channel: ConnectionChannel,
  delay: number,
) {
  useSessionConnectionDiagnostics.setState((state) => ({
    [channel]: { ...state[channel], retryAt: Date.now() + delay },
  }));
}
export function syncRetryDelay(
  attempts: number,
  error?: unknown,
  random = Math.random,
): number {
  const base = Math.min(
    30_000,
    5000 * 2 ** Math.min(Math.max(0, attempts - 1), 3),
  );
  const jitter = attempts <= 1 ? 0 : Math.floor(random() * 1000);
  const advised =
    error instanceof SessionSyncError ? (error.retryAfterMs ?? 0) : 0;
  return Math.max(Math.min(30_000, base + jitter), advised);
}
export async function readSharedSnapshot<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<T> {
  return readWithDeadline(
    async (current) => {
      const response = await fetcher(url, { ...init, signal: current });
      if (!response.ok) {
        const raw = response.headers?.get("retry-after");
        const seconds = raw?.trim() ? Number(raw) : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : raw
            ? Date.parse(raw) - Date.now()
            : 0;
        throw new SessionSyncError(
          "http",
          response.status,
          Math.min(60_000, Math.max(0, Number.isFinite(delay) ? delay : 0)),
        );
      }
      return response.json();
    },
    10_000,
    signal,
  );
}
export function connectionFailureText(
  failure: ConnectionFailure | null,
): string | null {
  if (!failure) return null;
  switch (failure.kind) {
    case "http":
      return `服务返回 HTTP ${failure.status}`;
    case "timeout":
      return "同步请求超时";
    case "network":
      return "浏览器暂时无法访问服务";
    case "response":
      return "服务返回的同步数据无效";
    case "storage":
      return "本机同步记录无法读写，请检查存储空间";
    case "stale":
      return "服务端列表版本落后，已保留本机列表";
    default:
      return "共享列表暂未同步";
  }
}
