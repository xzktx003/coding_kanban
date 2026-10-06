import type { ThreadGoal } from '@session/bindings/v2';
import { useCodexStore } from '@session/components/codex/stores';

/** Full ThreadGoal for a given thread (or currentThreadId), if one is set. */
export function useThreadGoal(threadId?: string | null): ThreadGoal | undefined {
  return useCodexStore(state => {
    const id = threadId !== undefined ? threadId : state.currentThreadId;
    return id ? state.goalMap[id] : undefined;
  });
}
