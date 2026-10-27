import { useMemo } from "react";
import { useCodexStore } from "../stores/useCodexStore";
import { useTurnControl } from "../hooks/useTurnControl";
import { useCodexContentOwner } from "../presentation/ownerContext";
import { aggregateTurnChangesFromContext } from "../items/fileChangeLogic";
import { useOpenReviewTab } from "../items/fileChangeUtils";
import { ComposerRailItem } from "./ComposerRail";
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
  const added = changes.reduce((sum, c) => sum + c.addedCount, 0),
    removed = changes.reduce((sum, c) => sum + c.removedCount, 0);
  return (
    <ComposerRailItem visible={running && changes.length > 0}>
      <div className="codex-running-changes">
        <button
          type="button"
          className="codex-running-changes-target"
          onClick={() => open()}
          aria-label={`${changes.length} 个文件已更改，查看变更`}
        >
          <span className="codex-running-changes-summary">
            <span className="codex-running-changes-title">
              {changes.length} 个文件已更改
            </span>
            <span className="codex-running-changes-meta">
              <span className="codex-running-changes-counts">
                <span className="codex-change-added">+{added}</span>
                <span className="codex-change-removed">-{removed}</span>
              </span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className="codex-running-changes-review"
          onClick={() => open()}
        >
          查看变更
        </button>
      </div>
    </ComposerRailItem>
  );
}
