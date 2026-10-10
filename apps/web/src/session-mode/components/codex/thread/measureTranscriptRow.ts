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
