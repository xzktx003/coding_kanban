import type { AgentSessionRecord } from "@agent-orchestrator/shared";

// Compare the complete JSON record. A render-field allowlist silently loses
// newly added metadata (task summaries, tags, transport targets, etc.).
export function sameJsonValue(previous: unknown, next: unknown): boolean {
  if (Object.is(previous, next)) return true;
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object"
  )
    return false;
  if (Array.isArray(previous) !== Array.isArray(next)) return false;
  if (Array.isArray(previous) && previous.length !== (next as unknown[]).length)
    return false;
  const left = previous as Record<string, unknown>;
  const right = next as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameJsonValue(left[key], right[key]),
    )
  );
}

export function stabilizeSessionList(
  previous: AgentSessionRecord[],
  next: AgentSessionRecord[],
): AgentSessionRecord[] {
  if (previous === next) return previous;
  const byId = new Map(previous.map((session) => [session.id, session]));
  const stable = next.map((session) => {
    const prior = byId.get(session.id);
    return prior && sameJsonValue(prior, session) ? prior : session;
  });
  return previous.length === stable.length &&
    stable.every((session, index) => session === previous[index])
    ? previous
    : stable;
}
