import type { Json, JsonObject } from "../core/json.js";
import type { AcpClient } from "./client.js";
export interface AcpAgentDef {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  available?: boolean;
  local?: boolean;
}
export interface AcpHistory {
  upsertSession(record: {
    sessionId: string;
    agentId: string;
    agentTitle?: string;
    cwd: string;
    botId?: string;
  }): void;
  appendUpdate(sessionId: string, payload: unknown): void;
  setTitleIfEmpty(sessionId: string, title: string): void;
  listSessions(cwd?: string, limit?: number): unknown[];
  getUpdates(sessionId: string): unknown[];
  deleteSession(sessionId: string): void;
  incrementUnread?(botId: string): void;
}
export interface ConnectionPolicy {
  strictMcp?: boolean;
  mcpServers?: Json[];
  readOnly?: boolean;
  unattended?: { allowAll: boolean; approvedTools: string[]; blocked: boolean };
  /** A fresh per-session capability set. The owner revokes all issued tokens onClose. */
  sessionMcpServers?: () => Json[];
  onClose?: () => void;
}
export interface ResolvedBot {
  agent: AcpAgentDef;
  cwd: string;
  policy: ConnectionPolicy;
  selectProvider?: (client: AcpClient) => Promise<void>;
  applySettings?: (client: AcpClient, sessionId: string) => Promise<void>;
}
export type ResolveBot = (
  botId: string,
  options: { unattended: boolean; allowCollaboration: boolean },
) => Promise<ResolvedBot>;
export interface AcpStartResult {
  connectionId: string;
  sessionId: string | null;
  initialize: Json;
  session: Json | null;
  sessionError: string | null;
}
export interface RunReport {
  sessionId: string;
  reply: string;
  blocked: boolean;
}
export interface AcpImage {
  mimeType: string;
  data: string;
}
