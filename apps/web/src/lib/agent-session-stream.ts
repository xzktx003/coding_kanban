import type {
  AgentSessionDeltaEvent,
  AgentSessionRecord,
  AgentSessionStreamEvent,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSessionList(value: unknown): value is ListAgentSessionsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    (typeof value.activeAgentSessionId === "string" ||
      value.activeAgentSessionId === null) &&
    typeof value.updatedAt === "string"
  );
}

function isDelta(value: unknown): value is AgentSessionDeltaEvent["payload"] {
  return (
    isRecord(value) &&
    Array.isArray(value.upserts) &&
    Array.isArray(value.removedIds) &&
    value.removedIds.every((id) => typeof id === "string") &&
    Array.isArray(value.orderedIds) &&
    value.orderedIds.every((id) => typeof id === "string") &&
    (typeof value.activeAgentSessionId === "string" ||
      value.activeAgentSessionId === null) &&
    typeof value.updatedAt === "string"
  );
}

export function parseAgentSessionStreamEvent(
  text: string,
): AgentSessionStreamEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(event)) return null;
  if (event.type === "snapshot" && isSessionList(event.payload)) {
    return { type: "snapshot", payload: event.payload };
  }
  if (event.type === "delta" && isDelta(event.payload)) {
    return { type: "delta", payload: event.payload };
  }
  return null;
}

export function applyAgentSessionStreamEvent(
  current: ListAgentSessionsResponse | null,
  event: AgentSessionStreamEvent,
): ListAgentSessionsResponse | null {
  if (event.type === "snapshot") return event.payload;
  if (!current) return null;

  const removedIds = new Set(event.payload.removedIds);
  const upserts = new Map<string, AgentSessionRecord>(
    event.payload.upserts.map((item) => [item.id, item]),
  );
  const mergedItems = current.items
    .filter((item) => !removedIds.has(item.id))
    .map((item) => upserts.get(item.id) ?? item);
  const existingIds = new Set(mergedItems.map((item) => item.id));
  for (const item of event.payload.upserts) {
    if (!existingIds.has(item.id)) mergedItems.push(item);
  }
  const itemsById = new Map(mergedItems.map((item) => [item.id, item]));
  const items = event.payload.orderedIds.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });

  return {
    items,
    activeAgentSessionId: event.payload.activeAgentSessionId,
    updatedAt: event.payload.updatedAt,
  };
}
