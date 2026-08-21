import type {
  AgentSessionStreamEvent,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createAgentSessionStreamEvent(
  previous: ListAgentSessionsResponse | null,
  current: ListAgentSessionsResponse,
): AgentSessionStreamEvent {
  if (!previous) {
    return { type: "snapshot", payload: current };
  }

  const previousById = new Map(previous.items.map((item) => [item.id, item]));
  const currentIds = new Set(current.items.map((item) => item.id));

  return {
    type: "delta",
    payload: {
      upserts: current.items.filter(
        (item) => !recordsEqual(previousById.get(item.id), item),
      ),
      removedIds: previous.items
        .filter((item) => !currentIds.has(item.id))
        .map((item) => item.id),
      orderedIds: current.items.map((item) => item.id),
      activeAgentSessionId: current.activeAgentSessionId,
      updatedAt: current.updatedAt,
    },
  };
}
