import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { apiGet, apiPost } from "../core/transport";

export type ListAgentSessionsResponse = AgentSessionRecord[];

export async function listSessions(): Promise<AgentSessionRecord[]> {
  const data = await apiGet<ListAgentSessionsResponse>("/api/agent-sessions");
  return Array.isArray(data) ? data : [];
}

export async function getSession(
  id: string,
): Promise<AgentSessionRecord | null> {
  try {
    return await apiGet<AgentSessionRecord>(`/api/agent-sessions/${id}`);
  } catch {
    return null;
  }
}

export async function sendInput(id: string, input: string): Promise<void> {
  await apiPost(`/api/agent-sessions/${id}/stdin`, { input });
}

export async function resizeSession(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  await apiPost(`/api/agent-sessions/${id}/resize`, { cols, rows });
}

export async function reconnectSession(id: string): Promise<void> {
  await apiPost(`/api/agent-sessions/${id}/reconnect`);
}

export async function health(): Promise<{ status: string }> {
  return apiGet<{ status: string }>("/api/health");
}

export interface TranscriptEntry {
  kind: string;
  [key: string]: unknown;
}

export async function getTranscript(id: string): Promise<TranscriptEntry[]> {
  const data = await apiGet<TranscriptEntry[] | { items?: TranscriptEntry[] }>(
    `/api/agent-sessions/${id}/transcript`,
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function getTaskSummary(id: string): Promise<{ [key: string]: unknown }> {
  return apiGet<{ [key: string]: unknown }>(`/api/agent-sessions/${id}/task-summary`);
}
