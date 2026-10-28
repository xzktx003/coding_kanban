/**
 * The negative top inset Codex applies to its transcript observer
 * (`rootMargin: "-16px 0px 0px 0px"`, `At = 16` in
 * `thread-user-message-navigation-rail-5c89c24e73d1.js`). A turn with less than
 * this much left on screen stops counting as current slightly before it leaves,
 * so the marker releases as the turn scrolls away rather than at the last pixel.
 */
const VIEWPORT_TOP_INSET_PX = 16;

export interface VisibleRow {
  /** Row offsets in the virtualizer's coordinate space. */
  start: number;
  end: number;
  /** The turn this row belongs to, when it belongs to one. */
  turnId: string | undefined;
}

/**
 * The turns intersecting the transcript viewport, which the prompt rail marks
 * with `aria-current`. Codex derives this from an IntersectionObserver at the
 * observer default threshold of 0, so any overlap counts; our transcript is
 * virtualized and already knows each row's offsets, so the same set comes from
 * those numbers instead of a second observer that would race the virtualizer.
 */
export function visibleTurnIds(
  rows: readonly VisibleRow[],
  viewport: { scrollOffset: number; height: number },
): ReadonlySet<string> {
  const visible = new Set<string>();
  // Before first layout the transcript has no height; every turn would overlap
  // a zero-height band under a `>=` test, lighting the entire rail on mount.
  if (viewport.height <= 0) return visible;
  const top = viewport.scrollOffset + VIEWPORT_TOP_INSET_PX;
  const bottom = viewport.scrollOffset + viewport.height;
  for (const row of rows) {
    if (!row.turnId) continue;
    if (row.end > top && row.start < bottom) visible.add(row.turnId);
  }
  return visible;
}
