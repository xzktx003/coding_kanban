import { useShallow } from "zustand/react/shallow";
import { useCodexStore } from "../stores";
import { codexRuntimeState } from "@session/utils/codexRuntimeState";

export function useTurnControl(threadId?: string) {
  return useCodexStore(useShallow(state => {
    const { running, turnId } = codexRuntimeState(state, threadId ?? state.currentThreadId);
    return { running, turnId };
  }));
}
