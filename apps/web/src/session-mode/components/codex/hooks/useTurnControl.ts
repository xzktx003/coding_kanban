import { useShallow } from "zustand/react/shallow";
import { useCodexStore } from "../stores";

/** Turn events also drive the composer when thread status is delayed or absent. */
export function useTurnControl() {
  return useCodexStore(
    useShallow((state) => {
      const id = state.currentThreadId;
      if (!id) return { running: false, turnId: null };
      const timing = state.turnTimingMap[id];
      if (timing)
        return {
          running: timing.status === "inProgress",
          turnId: timing.status === "inProgress" ? timing.turnId : null,
        };
      const turnId = state.currentTurnId;
      return {
        running: !!turnId || state.threadStatusMap[id]?.type === "active",
        turnId,
      };
    }),
  );
}
