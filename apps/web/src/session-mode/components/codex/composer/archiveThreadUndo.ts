import type { Thread } from "@session/bindings/v2";
import { toast } from "sonner";
import { archiveThread, unarchiveThread } from "@session/services/apiAdapt/codex";
import { useAgentCenterStore, agentCardKey, sharedCardMetadata, type AgentCenterCard } from "@session/stores/useAgentCenterStore";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "@session/services/codexOperationScope";
import { useCodexStore } from "../stores/useCodexStore";
import { recordAppAction, undoAppActionEntry, type AppAction } from "./appActionHistory";

const UNDO_WINDOW_MS = 60_000;
type ThreadSnapshot = {
  thread: Thread | undefined;
  threadIndex: number;
  card: AgentCenterCard | undefined;
  beforeKey: string | null;
  scope: ReturnType<typeof captureCodexOperationScope>;
};

/** Keep bounded list metadata, never turn or message bodies, in undo history. */
export function captureArchivedThread(threadId: string): ThreadSnapshot {
  const threads = useCodexStore.getState().threads;
  const cards = useAgentCenterStore.getState().cards;
  const threadIndex = threads.findIndex(thread => thread.id === threadId);
  const cardIndex = cards.findIndex(card => card.kind === "codex" && card.id === threadId);
  const thread = threads[threadIndex];
  return {
    thread: thread ? { ...thread, preview: (thread.preview ?? "").slice(0, 512), extra: null, gitInfo: null, turns: [] } : undefined,
    threadIndex,
    card: cardIndex < 0 ? undefined : sharedCardMetadata(cards[cardIndex]),
    beforeKey: cards[cardIndex + 1] ? agentCardKey(cards[cardIndex + 1]) : null,
    scope: captureCodexOperationScope(),
  };
}
function restore(snapshot: ThreadSnapshot) {
  if (snapshot.thread) {
    const thread = snapshot.thread;
    useCodexStore.setState(state => {
      if (state.threads.some(row => row.id === thread.id)) return state;
      const next = [...state.threads]; next.splice(Math.max(0, snapshot.threadIndex), 0, thread);
      return { threads: next };
    });
  }
  if (snapshot.card) {
    const store = useAgentCenterStore.getState();
    if (!store.cards.some(card => agentCardKey(card) === agentCardKey(snapshot.card!))) {
      store.addAgentCard(snapshot.card, { activate: false });
      const beforeKey = snapshot.beforeKey && useAgentCenterStore.getState().cards.some(card => agentCardKey(card) === snapshot.beforeKey) ? snapshot.beforeKey : null;
      useAgentCenterStore.getState().reorderCard(agentCardKey(snapshot.card), beforeKey);
    }
  }
}
function remove(threadId: string) {
  useAgentCenterStore.getState().removeCard({ kind: "codex", id: threadId });
  useCodexStore.setState(state => ({ threads: state.threads.filter(thread => thread.id !== threadId) }));
}
/** Archive and undo share the async global history; toast targets this exact entry. */
export function archiveUndoNotice(threadId: string, snapshot: ThreadSnapshot): {
  id: string; duration: number; action: { label: string; onClick: () => void };
} {
  const id = `codex-archive-${threadId}`;
  const action: AppAction = {
    label: "归档聊天", expiresAt: Date.now() + UNDO_WINDOW_MS,
    current: () => isCodexOperationScopeCurrent(snapshot.scope),
    undo: async () => {
      await unarchiveThread(threadId);
      if (!isCodexOperationScopeCurrent(snapshot.scope)) throw new Error("账号或运行范围已变化，原会话恢复回执已保留");
      restore(snapshot);
      toast.success("聊天已恢复", { id: `${id}-undone` });
    },
    // Redo uses ordinary archive. It never silently stops a newly running turn.
    redo: async () => {
      await archiveThread(threadId);
      if (!isCodexOperationScopeCurrent(snapshot.scope)) throw new Error("账号或运行范围已变化，原会话归档回执已保留");
      remove(threadId);
    },
  };
  recordAppAction(action);
  return { id, duration: UNDO_WINDOW_MS, action: { label: "撤销", onClick: () => {
    void undoAppActionEntry(action).catch(error => toast.error("取消归档对话失败", { id: `${id}-failed`, description: error instanceof Error ? error.message : String(error) }));
  } } };
}
