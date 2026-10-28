import { apiGet, apiPost } from "../core/transport";

// Minimal local mirror of the Codex session-mode types (full generated
// bindings live in apps/web/src/session-mode/bindings/v2). We keep only the
// fields this client renders.

export interface SessionThread {
  id: string;
  name: string | null;
  preview: string;
  status: string;
  cwd: string;
  canAcceptDirectInput: boolean | null;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
}

export interface SessionItem {
  id: string;
  type: string;
  text?: string;
  content?: Array<{ type?: string; text?: string; url?: string }>;
  name?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string | null;
  status?: string;
  changes?: Array<unknown>;
  summary?: Array<string>;
  [key: string]: unknown;
}

export interface SessionTurn {
  id: string;
  items: SessionItem[];
  status: string;
  startedAt: number | null;
  completedAt: number | null;
}

export interface ThreadListResponse {
  data: SessionThread[];
  nextCursor: string | null;
}

export interface TurnsListResponse {
  data: SessionTurn[];
  nextCursor: string | null;
}

export interface TurnStartResponse {
  turn: SessionTurn;
}

export async function listThreads(
  params: { cursor?: string; limit?: number } = {},
): Promise<ThreadListResponse> {
  return apiPost<ThreadListResponse>("/api/codex/thread/list", {
    cursor: params.cursor ?? null,
    limit: params.limit ?? 80,
  });
}

export async function listTurns(
  threadId: string,
  opts: { cursor?: string; limit?: number; itemsView?: "summary" | "full" } = {},
): Promise<TurnsListResponse> {
  return apiPost<TurnsListResponse>("/api/codex/thread/turns/list?view=chat", {
    threadId,
    cursor: opts.cursor ?? null,
    limit: opts.limit ?? 40,
    sortDirection: "desc",
    itemsView: opts.itemsView ?? "full",
  });
}

export async function startTurn(
  threadId: string,
  text: string,
  model?: string,
): Promise<TurnStartResponse> {
  return apiPost<TurnStartResponse>("/api/codex/turn/start", {
    threadId,
    clientUserMessageId: cryptoRandom(),
    input: [{ type: "text", text, text_elements: [] }],
    ...(model ? { model } : {}),
  });
}

export async function interruptTurn(threadId: string): Promise<unknown> {
  return apiPost("/api/codex/turn/interrupt", { threadId });
}

export async function listModels(): Promise<Array<{ id: string; name?: string; provider?: string }>> {
  try {
    return await apiPost<Array<{ id: string; name?: string; provider?: string }>>(
      "/api/codex/model/list",
      {},
    );
  } catch {
    return [];
  }
}

export function extractItemText(item: SessionItem): string {
  if (item.type === "userMessage") {
    const content = item.content ?? [];
    return content
      .map((c) => c.text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  if (item.type === "agentMessage" || item.type === "plan") return item.text ?? "";
  if (item.type === "reasoning") {
    return (item.summary ?? []).join("\n");
  }
  if (item.type === "commandExecution") return item.command ?? "";
  return item.name ?? "";
}

function cryptoRandom(): string {
  // RN Hermes exposes crypto.randomUUID in recent versions; fall back to a
  // random id otherwise.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  try {
    return g.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random()}`;
  } catch {
    return `m-${Date.now()}-${Math.random()}`;
  }
}

// SSE subscription using react-native-sse. Returns a cleanup function.
import EventSource from "react-native-sse";
import { buildUrl } from "../core/transport";

export function subscribeToEvents(onEvent: (eventName: string, data: string) => void): () => void {
  const es = new EventSource(buildUrl("/api/events"), {
    method: "GET",
    headers: { Accept: "text/event-stream" },
  });
  es.addEventListener("open", () => {});
  es.addEventListener("message", (e: { data?: string | null }) => {
    if (e.data) onEvent("message", e.data);
  });
  es.addEventListener("error", (e: { type?: string }) => {
    onEvent("error", e.type ?? "error");
  });
  return () => {
    es.close();
  };
}
