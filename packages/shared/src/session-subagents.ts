/** Tolerant native metadata view: fields absent on old runtimes remain unknown. */
export interface SubagentThread {
  id: string;
  parentThreadId?: string | null;
  source?: unknown;
  sessionId?: string;
  agentNickname?: string | null;
  agentRole?: string | null;
  name?: string | null;
  preview?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  cwd?: string | null;
  createdAt?: number;
  updatedAt?: number;
  canAcceptDirectInput?: boolean | null;
  historyMode?: string;
  status?: { type: string; activeFlags?: string[] };
  turns?: Array<{ id: string; status: string; startedAt?: number | null; items?: unknown[] }>;
}
export interface SubagentSnapshot {
  threads: SubagentThread[];
  complete: boolean;
  errors: string[];
  checkedAt: number;
  unavailableIds?: string[];
}
export interface AgentMention { name: string; path: string }
export interface SubagentStopTarget { threadId: string; turnId: string }
export interface SubagentStopResult extends SubagentStopTarget {
  phase: "requested" | "confirmed" | "superseded" | "failed" | "uncertain";
  message?: string;
}
export function subagentParent(thread: SubagentThread): string | null {
  const source = thread.source as { subAgent?: { thread_spawn?: { parent_thread_id?: string }; threadSpawn?: { parentThreadId?: string } }; subagent?: { thread_spawn?: { parent_thread_id?: string } } } | undefined;
  return thread.parentThreadId ?? source?.subAgent?.thread_spawn?.parent_thread_id ?? source?.subAgent?.threadSpawn?.parentThreadId ?? source?.subagent?.thread_spawn?.parent_thread_id ?? null;
}
/** Older servers keep nickname/role in the spawn source instead of top-level metadata. */
export function normalizeSubagentThread(thread: SubagentThread): SubagentThread {
  const source = thread.source as { subAgent?: { thread_spawn?: Record<string, unknown>; threadSpawn?: Record<string, unknown> }; subagent?: { thread_spawn?: Record<string, unknown> } } | undefined;
  const spawn = source?.subAgent?.thread_spawn ?? source?.subAgent?.threadSpawn ?? source?.subagent?.thread_spawn;
  const nickname = spawn?.agent_nickname ?? spawn?.agentNickname;
  const role = spawn?.agent_role ?? spawn?.agentRole;
  return { ...thread, ...(!thread.agentNickname && typeof nickname === "string" ? { agentNickname: nickname } : {}), ...(!thread.agentRole && typeof role === "string" ? { agentRole: role } : {}) };
}
export function validAgentMention(value: unknown): value is AgentMention {
  if (!value || typeof value !== "object") return false;
  const v = value as AgentMention;
  return typeof v.name === "string" && v.name.length > 0 && v.name.length <= 160 && !/[\x00-\x1f]/.test(v.name) && typeof v.path === "string" && /^(agent|subagent):\/\/[-a-zA-Z0-9_:]{1,160}$/.test(v.path);
}
