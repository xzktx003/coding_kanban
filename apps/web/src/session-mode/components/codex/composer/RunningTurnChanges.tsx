import { useMemo } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useTurnControl } from "../hooks/useTurnControl";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { aggregateTurnChangesFromContext } from "../items/fileChangeLogic";
import { useOpenReviewTab } from "../items/fileChangeUtils";
export function RunningTurnChanges({ threadId }: { threadId: string | null }) {
  const { running, turnId } = useTurnControl(threadId ?? undefined);
  const { cwd } = useCodexContentOwner(threadId ?? undefined);
  const diff = useCodexStore((state) => {
    if (!running || !threadId || !turnId) return undefined;
    const events = state.events[threadId] ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (
        event.method === "turn/diff/updated" &&
        event.params.threadId === threadId &&
        event.params.turnId === turnId
      )
        return event;
      if (
        event.method === "turn/started" &&
        event.params.threadId === threadId &&
        event.params.turn.id === turnId
      )
        break;
    }
    return undefined;
  });
  const changes = useMemo(
    () =>
      diff && threadId && turnId
        ? aggregateTurnChangesFromContext(
            turnId,
            { events: [diff], eventIndex: 0 },
            threadId,
          )
        : [],
    [diff, threadId, turnId],
  );
  const open = useOpenReviewTab(
    threadId && turnId
      ? { threadId, turnId, cwd, changes, batches: [] }
      : undefined,
  );
  if (!running || !changes.length) return null;
  const added = changes.reduce((sum, c) => sum + c.addedCount, 0),
    removed = changes.reduce((sum, c) => sum + c.removedCount, 0);
  return (
    <button
      type="button"
      className="codex-running-changes"
      onClick={() => open()}
      aria-label={`${changes.length} 个文件已更改，查看变更`}
    >
      <span>{changes.length} 个文件已更改</span>
      <span className="codex-change-added">+{added}</span>
      <span className="codex-change-removed">−{removed}</span>
      <span className="codex-running-changes-review">查看变更</span>
    </button>
  );
}
