/** Measure a new mount before paint; observer delivery must not force another layout. */
export function measureTranscriptRow(
  element: Element,
  entry?: ResizeObserverEntry,
  previousSize = 160,
) {
  if (entry) {
    const height = entry.borderBoxSize?.[0]?.blockSize;
    return typeof height === "number" && height > 0 ? height : previousSize;
  }
  const height = element.getBoundingClientRect().height;
  return height > 0 ? height : previousSize;
}

/** A newly mounted row has no previous visible height to preserve. */
export function shouldAdjustTranscriptRow(
  previousEnd: number,
  delta: number,
  scrollOffset: number,
  firstDomMeasurement: boolean,
) {
  const end = previousEnd + (firstDomMeasurement ? delta : 0);
  return end <= scrollOffset;
}
