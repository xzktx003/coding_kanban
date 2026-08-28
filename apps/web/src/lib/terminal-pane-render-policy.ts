import type { TerminalMonitorSlot } from "./terminal-layout";

export const SINGLE_PANE_TERMINAL_CACHE_SIZE = 3;

export function resolveRetainedTerminalMonitorSlots({
  currentSlots,
  retainedSlots,
  validSessionIds,
}: {
  currentSlots: readonly TerminalMonitorSlot[];
  retainedSlots: readonly TerminalMonitorSlot[];
  validSessionIds: ReadonlySet<string>;
}): TerminalMonitorSlot[] {
  const currentSlotIds = new Set(currentSlots.map((slot) => slot.id));
  const usedSessionIds = new Set<string>();
  const mergedSlots = [
    ...currentSlots,
    ...retainedSlots.filter((slot) => !currentSlotIds.has(slot.id)),
  ];

  return mergedSlots.map((slot) => {
    const sessionId = slot.sessionId;
    if (
      !sessionId ||
      !validSessionIds.has(sessionId) ||
      usedSessionIds.has(sessionId)
    ) {
      return { id: slot.id, sessionId: null };
    }

    usedSessionIds.add(sessionId);
    return { id: slot.id, sessionId };
  });
}

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
