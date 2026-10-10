import type {
  WorkflowAnchor,
  WorkflowMessage,
  ThreadSearchMatch,
} from "@session/features/thread-workflows/model";
export async function prepareThreadSearchMatch({
  threadId,
  match,
  getMessages,
  loadCursor,
  isCurrent,
  waitForLayout,
}: {
  threadId: string;
  match: ThreadSearchMatch;
  getMessages: () => readonly WorkflowMessage[];
  loadCursor: (cursor: string) => Promise<unknown>;
  isCurrent: () => boolean;
  waitForLayout: () => Promise<void>;
}): Promise<WorkflowAnchor | null> {
  if (
    !isCurrent() ||
    (match.threadId !== undefined && match.threadId !== threadId) ||
    !match.turnId ||
    !match.itemId ||
    !match.query.trim()
  )
    return null;
  const locate = () =>
    getMessages().find(
      (message) =>
        message.turnId === match.turnId && message.itemId === match.itemId,
    );
  let message = locate();
  if (!message) {
    if (
      !match.turnCursor ||
      match.turnCursor.length > 4096 ||
      /[\u0000-\u001f]/.test(match.turnCursor)
    )
      return null;
    await loadCursor(match.turnCursor);
    if (!isCurrent()) return null;
    await waitForLayout();
    message = locate();
  }
  if (!isCurrent() || !message) return null;
  return {
    rowId: message.rowId,
    itemId: message.itemId,
    turnId: message.turnId,
    query: match.query,
    occurrence: match.occurrence,
    ...(match.offset !== undefined ? { offset: match.offset } : {}),
  };
}
