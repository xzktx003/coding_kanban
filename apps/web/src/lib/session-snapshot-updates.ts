import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

export function updateSessionUnreadCompletion(
  snapshot: ListAgentSessionsResponse | null,
  agentSessionId: string,
  unread: boolean,
): ListAgentSessionsResponse | null {
  if (!snapshot) return snapshot;

  let changed = false;
  const items = snapshot.items.map((session): AgentSessionRecord => {
    if (
      session.id !== agentSessionId ||
      Boolean(session.hasUnreadCompletion) === unread
    ) {
      return session;
    }

    changed = true;
    return { ...session, hasUnreadCompletion: unread };
  });

  return changed ? { ...snapshot, items } : snapshot;
}
