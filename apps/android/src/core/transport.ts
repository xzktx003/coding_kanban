import { loadServerConfig } from "./config";

let baseUrl = "";
let emitChange: (() => void) | null = null;

export function onBaseUrlChange(listener: () => void): () => void {
  emitChange = listener;
  return () => {
    if (emitChange === listener) emitChange = null;
  };
}

function notify(): void {
  emitChange?.();
}

export async function initBaseUrl(): Promise<string> {
  baseUrl = await loadServerConfig();
  return baseUrl;
}

export function setBaseUrl(url: string): string {
  baseUrl = url;
  notify();
  return baseUrl;
}

export function getBaseUrl(): string {
  return baseUrl;
}

export function buildUrl(path: string): string {
  if (!baseUrl) throw new Error("Server URL not configured");
  const prefix = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${suffix}`;
}

export function buildWebSocketUrl(path: string): string {
  const http = buildUrl(path);
  return http.replace(/^http/, "ws");
}

/**
 * Thin fetch wrapper that prefixes the configured server URL and always
 * parses JSON when the response is JSON, mirroring apps/web/src/lib/api.ts.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = buildUrl(path);
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

export async function apiPost<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}
