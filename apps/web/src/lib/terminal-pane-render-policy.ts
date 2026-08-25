export const SINGLE_PANE_TERMINAL_CACHE_SIZE = 3;

export function resolveRecentTerminalSessionIds(
  currentSessionId: string,
  recentSessionIds: readonly string[],
  capacity: number,
): string[] {
  const limit = Math.max(1, Math.floor(capacity));
  return [
    currentSessionId,
    ...recentSessionIds.filter((sessionId) => sessionId !== currentSessionId),
  ].slice(0, limit);
}

export function shouldMountTerminalPane({
  active,
  groupArrangement,
  visible,
}: {
  active: boolean;
  groupArrangement: boolean;
  visible: boolean;
}): boolean {
  return !groupArrangement || active || visible;
}
