import { codexRuntimeState } from "@session/utils/codexRuntimeState";
import type { ThreadStatus } from '@session/bindings/v2/ThreadStatus';
import { useCodexStore } from '@session/components/codex/stores';

/** Full ThreadStatus for a given thread (or currentThreadId). */
export function useThreadStatus(threadId?: string | null): ThreadStatus | undefined {
  return useCodexStore(state => {
    const id = threadId !== undefined ? threadId : state.currentThreadId;
    return id ? state.threadStatusMap[id] : undefined;
  });
}

/** True when the thread is active (thinking, waiting for approval, or waiting for input). */
export function useIsProcessing(threadId?: string | null): boolean {
  return useCodexStore(s => codexRuntimeState(s, threadId === undefined ? s.currentThreadId : threadId).running);
}
