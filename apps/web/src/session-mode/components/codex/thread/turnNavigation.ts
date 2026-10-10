import type { ThreadRow } from "./threadRows";
/** Uses protocol ownership, including command-only turns; never guesses from row order. */
export function findTurnRowIndex(
  rows: readonly ThreadRow[],
  threadId: string,
  turnId: string,
): number {
  return rows.findIndex((row) => {
    if (row.item.kind === "cmdGroup")
      return row.item.actionSources.some(
        (source) => source.threadId === threadId && source.turnId === turnId,
      );
    const params = row.item.event.params;
    return (
      "threadId" in params &&
      params.threadId === threadId &&
      (("turnId" in params && params.turnId === turnId) ||
        ("turn" in params && params.turn.id === turnId))
    );
  });
}
