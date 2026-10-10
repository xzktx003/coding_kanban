/** Actual generated gallery ss, called by native qf: four slots, natural fit, then square carousel. */
export function nativeImageGalleryLayout(
  width: number | null,
  ratios: readonly number[],
  minimumSlotCount = 0,
) {
  const count = ratios.length,
    single = Math.max(count, minimumSlotCount) === 1 ? ratios[0] : null;
  const height =
    width === null
      ? 0
      : single === null
        ? Math.max((width - 24) / 4, 0)
        : width / single;
  const total =
    ratios.reduce((sum, ratio) => sum + ratio * height, 0) +
    Math.max(count - 1, 0) * 8;
  if (single !== null || width === null || total <= width)
    return {
      height,
      square: false,
      visibleCount: count,
      maxStartIndex: 0,
      overflowCount: 0,
    };
  const visibleCount = Math.min(count, 4),
    overflowCount = Math.max(count - visibleCount, 0);
  return {
    height,
    square: true,
    visibleCount,
    maxStartIndex: overflowCount,
    overflowCount,
  };
}
