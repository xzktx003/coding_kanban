import { toast } from "sonner";
import { unarchiveThread } from "@session/services/apiAdapt/codex";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "../stores/useCodexStore";

/**
 * Original local-thread archive is an undo transaction, not a terminal action:
 * `s2n` (app-initial-41ab338a184f.js @2425337) hands `bu`/`Tx` an entry whose
 * `undo` calls `unarchiveConversation(id, {restorePin: true})`, and `ZMt`
 * (@323732) only emits the `appUndo.threadArchived` success toast from inside
 * that undo transition. `wjt = 6e4` (@311017) is the window the entry stays
 * undoable for.
 *
 * Two deliberate deviations, both forced by what we do and do not have:
 *
 * - Official reaches the undo through the global `undoAppAction` keyboard
 *   command (`kj("undoAppAction", …)` @2752155) backed by an app-wide undo
 *   stack. We have no such stack (nothing in session-mode registers one), so
 *   the entry is carried on the archive notice itself. The 60s window and the
 *   post-undo copy are the parts that are observable to a user, and those match.
 * - Official `restorePin` restores a pinned position we do not model. We
 *   instead restore the exact thread record and focus card we removed, at their
 *   original index, so an undo is a true inverse rather than a re-add that
 *   reorders the rail.
 */
const UNDO_WINDOW_MS = 60_000;

type ThreadSnapshot = {
  thread: { id: string } | undefined;
  threadIndex: number;
  card: { kind: string; id: string } | undefined;
  cardIndex: number;
};

/** Captured before removal so the undo restores, rather than re-creates, the row. */
export function captureArchivedThread(threadId: string): ThreadSnapshot {
  const threads = useCodexStore.getState().threads as { id: string }[];
  const cards = useAgentCenterStore.getState().cards as {
    kind: string;
    id: string;
  }[];
  const threadIndex = threads.findIndex((t) => t.id === threadId);
  const cardIndex = cards.findIndex(
    (c) => c.kind === "codex" && c.id === threadId,
  );
  return {
    thread: threadIndex < 0 ? undefined : threads[threadIndex],
    threadIndex,
    card: cardIndex < 0 ? undefined : cards[cardIndex],
    cardIndex,
  };
}

function restore(snapshot: ThreadSnapshot) {
  if (snapshot.thread) {
    const thread = snapshot.thread;
    useCodexStore.setState((state) => {
      const threads = state.threads as { id: string }[];
      if (threads.some((t) => t.id === thread.id)) return {} as never;
      const next = [...threads];
      next.splice(
        snapshot.threadIndex < 0 ? next.length : snapshot.threadIndex,
        0,
        thread,
      );
      return { threads: next } as never;
    });
  }
  if (snapshot.card) {
    const card = snapshot.card;
    useAgentCenterStore.setState((state) => {
      const cards = state.cards as { kind: string; id: string }[];
      if (cards.some((c) => c.kind === card.kind && c.id === card.id))
        return {} as never;
      const next = [...cards];
      next.splice(
        snapshot.cardIndex < 0 ? next.length : snapshot.cardIndex,
        0,
        card,
      );
      return { cards: next } as never;
    });
  }
}

/**
 * The sonner options for the archive notice. `threadId` is captured by the
 * caller at archive time, never read back from the store, so a later selection
 * cannot redirect the undo at a different thread.
 */
export function archiveUndoNotice(
  threadId: string,
  snapshot: ThreadSnapshot,
): {
  id: string;
  duration: number;
  action: { label: string; onClick: () => void };
} {
  const id = `codex-archive-${threadId}`;
  // One archive undoes once. Official discards the entry on the first undo
  // transition; a double click here would otherwise issue two unarchives.
  let spent = false;
  return {
    id,
    duration: UNDO_WINDOW_MS,
    action: {
      label: "撤销",
      onClick: () => {
        if (spent) return;
        spent = true;
        void unarchiveThread(threadId)
          .then(() => {
            restore(snapshot);
            // Official `appUndo.threadArchived`.
            toast.success("聊天已恢复", { id: `${id}-undone` });
          })
          .catch((error: unknown) => {
            // Official `localTaskRow.unarchiveError`. The thread stays archived:
            // the write did not land, so the list must keep reflecting that.
            spent = false;
            toast.error("取消归档对话失败", {
              id: `${id}-failed`,
              description:
                error instanceof Error ? error.message : String(error),
            });
          });
      },
    },
  };
}
