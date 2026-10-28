/**
 * Reading upward must page in older history before the reader reaches a dead
 * top edge. Loading starts slightly early so continued upward scrolling is not
 * interrupted by an empty gap.
 */
export const EARLIER_HISTORY_SCROLL_MARGIN = 240;

export interface EarlierHistoryScrollInput {
  scrollTop: number;
  /** Following live output: the reader is not reading history. */
  pinnedToBottom: boolean;
  cursor: string | null | undefined;
  /** Set when the memory governor released older turns of a loaded thread. */
  trimmedAnchor: string | undefined;
  loading: boolean | undefined;
  error: string | undefined;
}

/** Either paging source can still reach older turns. */
export function hasEarlierHistory({
  cursor,
  trimmedAnchor,
}: Pick<EarlierHistoryScrollInput, "cursor" | "trimmedAnchor">) {
  return Boolean(cursor) || Boolean(trimmedAnchor);
}

export function shouldLoadEarlierOnScroll({
  scrollTop,
  pinnedToBottom,
  cursor,
  trimmedAnchor,
  loading,
  error,
}: EarlierHistoryScrollInput) {
  // A failed page keeps its visible retry control; scrolling must not reissue
  // the request on every frame, and a running read must not be stacked.
  if (pinnedToBottom || loading || error) return false;
  if (!hasEarlierHistory({ cursor, trimmedAnchor })) return false;
  return scrollTop <= EARLIER_HISTORY_SCROLL_MARGIN;
}
