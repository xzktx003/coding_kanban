/** Row disclosure values must not outlive their retained transcript window. */
export function pruneRowState(
  cache: Map<string, Map<string, unknown>>,
  rowKeys: string[],
  visibleKeys: ReadonlySet<string> = new Set(),
  limit = 1000,
) {
  const retained = new Set(rowKeys);
  for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key);
  for (const key of cache.keys()) {
    if (cache.size <= limit) break;
    if (!visibleKeys.has(key)) cache.delete(key);
  }
}
