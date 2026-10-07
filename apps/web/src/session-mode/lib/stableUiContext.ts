export function stableUiContext<T>(
  key: string,
  create: () => T,
  data?: Record<string, unknown>,
): T {
  if (!data) return create();
  const cache =
    (data.sessionUiContexts as Map<string, unknown> | undefined) ??
    new Map<string, unknown>();
  data.sessionUiContexts = cache;
  if (cache.has(key)) return cache.get(key) as T;
  const context = create();
  cache.set(key, context);
  return context;
}
