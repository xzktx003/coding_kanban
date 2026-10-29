import type { CodexTranscriptBudgetResult } from "./codexTranscriptMemoryBudget";

/** Local browser cursors are translated to passive native pagination, never sent as native cursors. */
export const MEMORY_HISTORY_RESTART_CURSOR = "kanban-memory-reload:";
export const memoryHistoryWindows = new Map<string, Set<string>>();
/** Bounded so a long reading session cannot pin history without limit. */
export const MEMORY_HISTORY_WINDOW_TURNS = 400;
export function pinMemoryHistoryPage(id: string, turnIds: string[]) {
  // Successive pages accumulate: replacing the window made each click evict
  // what the previous click recovered, so paging never made progress.
  const existing = memoryHistoryWindows.get(id);
  const merged = new Set(existing ?? []);
  for (const turnId of turnIds) {
    merged.delete(turnId);
    merged.add(turnId);
  }
  while (merged.size > MEMORY_HISTORY_WINDOW_TURNS)
    merged.delete(merged.keys().next().value!);
  memoryHistoryWindows.delete(id);
  memoryHistoryWindows.set(id, merged);
  if (memoryHistoryWindows.size > 50)
    memoryHistoryWindows.delete(memoryHistoryWindows.keys().next().value!);
}

export const MEMORY_ITEM_CURSOR = "kanban-memory-items:";

/** Keep evicted display history reachable without retaining its body. */
export function transcriptBudgetRecoveryCursor(
  result: CodexTranscriptBudgetResult,
) {
  if (result.sameTurnTrimmedEventCount && result.truncatedTurnIds.length) {
    const turnId = result.truncatedTurnIds[0];
    const first = result.events.find(
      (event) =>
        (event.method === "item/started" ||
          event.method === "item/completed") &&
        event.params.turnId === turnId &&
        !["userMessage", "collabAgentToolCall", "subAgentActivity"].includes(
          event.params.item.type,
        ),
    );
    if (
      first &&
      (first.method === "item/started" || first.method === "item/completed")
    )
      return (
        MEMORY_ITEM_CURSOR +
        encodeURIComponent(
          JSON.stringify({ turnId, beforeItemId: first.params.item.id }),
        )
      );
  }
  return result.evicted
    ? MEMORY_HISTORY_RESTART_CURSOR +
        encodeURIComponent(result.oldestTurnId ?? "")
    : undefined;
}
