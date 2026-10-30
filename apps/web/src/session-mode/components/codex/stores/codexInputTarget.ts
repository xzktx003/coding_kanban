import { useCodexStore } from "./useCodexStore";

/** Select an input view synchronously, using only already known execution facts.
 * This never loads history or acquires/resumes native execution. */
export function selectCodexInputTarget(threadId: string | null) {
  threadId ||= null;
  const state = useCodexStore.getState();
  const cached = !!threadId && !!state.historyLoadedMap[threadId];
  let activeTurnId: string | null = null;
  if (threadId && cached) {
    const timing = state.turnTimingMap[threadId],
      status = state.threadStatusMap[threadId]?.type;
    activeTurnId =
      timing?.status === "inProgress" && status === "active"
        ? timing.turnId
        : null;
    if (!activeTurnId && status !== "idle" && status !== "systemError") {
      const events = state.events[threadId] ?? [];
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.method === "turn/started") {
          activeTurnId = (event.params as { turn: { id: string } }).turn.id;
          break;
        }
        if (event.method === "turn/completed" || event.method === "error")
          break;
      }
    }
  }
  useCodexStore.setState((current) => ({
    currentThreadId: threadId,
    currentTurnId: activeTurnId,
    inputFocusTrigger: current.inputFocusTrigger + 1,
  }));
  return {
    cached,
    active: !!threadId && state.activeThreadIds.includes(threadId),
  };
}
