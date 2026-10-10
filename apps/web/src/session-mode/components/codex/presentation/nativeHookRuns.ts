import type { ServerNotification } from "@session/bindings";
import type { HookRunSummary } from "@session/bindings/v2/HookRunSummary";
export function projectNativeCompletedHookTurns(
  events: readonly ServerNotification[],
) {
  const keys = new Set<string>();
  for (const event of events) {
    if (
      event.method === "turn/completed" &&
      event.params.turn.status !== "inProgress"
    )
      keys.add(JSON.stringify([event.params.threadId, event.params.turn.id]));
    else if (
      event.method === "error" &&
      !event.params.willRetry &&
      event.params.turnId
    )
      keys.add(JSON.stringify([event.params.threadId, event.params.turnId]));
  }
  return keys;
}
export function nativeHookRunsForTurn(
  hooks: ReadonlyMap<string, readonly HookRunSummary[]>,
  threadId: string,
  turnId: string,
  runtime: { threadId: string; turnId: string | null; running: boolean },
  completed: ReadonlySet<string>,
) {
  const key = JSON.stringify([threadId, turnId]);
  if (
    runtime.threadId === threadId &&
    runtime.running &&
    (runtime.turnId === turnId ||
      (runtime.turnId === null && !completed.has(key)))
  )
    return;
  return hooks.get(key);
}
export function projectNativeHookRuns(
  events: readonly ServerNotification[],
): Map<string, readonly HookRunSummary[]> {
  const byOwner = new Map<string, Map<string, HookRunSummary>>();
  for (const event of events) {
    if (event.method !== "hook/started" && event.method !== "hook/completed")
      continue;
    const { threadId, turnId, run } = event.params;
    if (turnId == null) continue;
    const key = JSON.stringify([threadId, turnId]),
      runs = byOwner.get(key) ?? new Map<string, HookRunSummary>();
    const previous = runs.get(run.id);
    if (previous && previous.status !== "running" && run.status === "running")
      continue;
    runs.set(run.id, run);
    byOwner.set(key, runs);
  }
  return new Map(
    [...byOwner].map(([key, runs]) => [
      key,
      [...runs.values()].sort((a, b) =>
        a.displayOrder < b.displayOrder
          ? -1
          : a.displayOrder > b.displayOrder
            ? 1
            : 0,
      ),
    ]),
  );
}
