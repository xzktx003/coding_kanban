/** Local browser cursors are translated to passive native pagination, never sent as native cursors. */
export const MEMORY_HISTORY_RESTART_CURSOR = "kanban-memory-reload:";
export const memoryHistoryWindows = new Map<string, Set<string>>();
export function pinMemoryHistoryPage(id: string, turnIds: string[]) {
  memoryHistoryWindows.delete(id);
  memoryHistoryWindows.set(id, new Set(turnIds));
  if (memoryHistoryWindows.size > 50)
    memoryHistoryWindows.delete(memoryHistoryWindows.keys().next().value!);
}

export const MEMORY_ITEM_CURSOR = "kanban-memory-items:";
