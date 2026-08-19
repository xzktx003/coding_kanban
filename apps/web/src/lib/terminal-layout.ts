export type TerminalMonitorLayoutMode =
  | "single"
  | "dual"
  | "dual-vertical"
  | "triple"
  | "quad"
  | "six"
  | "eight";

export interface TerminalMonitorSession {
  id: string;
}

export interface TerminalMonitorSlot {
  id: string;
  sessionId: string | null;
}

export type RestorableTerminalMonitorLayoutMode = Exclude<
  TerminalMonitorLayoutMode,
  "single"
>;

export interface TerminalMonitorLayoutSnapshot {
  mode: RestorableTerminalMonitorLayoutMode;
  slots: TerminalMonitorSlot[];
  activeSlotId: string;
  closedSlotIds: string[];
}

export interface NormalizeTerminalMonitorSlotsOptions {
  mode: TerminalMonitorLayoutMode;
  sessions: TerminalMonitorSession[];
  preferredSessionId?: string | null;
  preferredSlotId?: string | null;
  previousSlots?: TerminalMonitorSlot[];
}

export interface RestoreTerminalMonitorLayoutSnapshotOptions {
  snapshot: TerminalMonitorLayoutSnapshot;
  sessions: TerminalMonitorSession[];
  preferredSessionId?: string | null;
}

export interface RestoredTerminalMonitorLayout {
  mode: RestorableTerminalMonitorLayoutMode;
  slots: TerminalMonitorSlot[];
  activeSlotId: string;
  closedSlotIds: string[];
}

const TERMINAL_MONITOR_SLOT_IDS = [
  "terminal-monitor-slot-1",
  "terminal-monitor-slot-2",
  "terminal-monitor-slot-3",
  "terminal-monitor-slot-4",
  "terminal-monitor-slot-5",
  "terminal-monitor-slot-6",
  "terminal-monitor-slot-7",
  "terminal-monitor-slot-8",
] as const;

export const TERMINAL_MONITOR_LAYOUT_OPTIONS: ReadonlyArray<{
  mode: TerminalMonitorLayoutMode;
  label: string;
  capacity: number;
}> = [
  { mode: "single", label: "单屏", capacity: 1 },
  { mode: "dual", label: "左右双屏", capacity: 2 },
  { mode: "dual-vertical", label: "上下双屏", capacity: 2 },
  { mode: "triple", label: "左中右三屏", capacity: 3 },
  { mode: "quad", label: "四屏", capacity: 4 },
  { mode: "six", label: "六屏", capacity: 6 },
  { mode: "eight", label: "八屏", capacity: 8 },
];

export function getTerminalMonitorLayoutCapacity(
  mode: TerminalMonitorLayoutMode,
): number {
  switch (mode) {
    case "dual":
    case "dual-vertical":
      return 2;
    case "triple":
      return 3;
    case "quad":
      return 4;
    case "six":
      return 6;
    case "eight":
      return 8;
    case "single":
    default:
      return 1;
  }
}

export function isTerminalMonitorLayoutMode(
  value: unknown,
): value is TerminalMonitorLayoutMode {
  return (
    value === "single" ||
    value === "dual" ||
    value === "dual-vertical" ||
    value === "triple" ||
    value === "quad" ||
    value === "six" ||
    value === "eight"
  );
}

export function getTerminalMonitorSlotIds(
  mode: TerminalMonitorLayoutMode,
): string[] {
  return TERMINAL_MONITOR_SLOT_IDS.slice(
    0,
    getTerminalMonitorLayoutCapacity(mode),
  );
}

export function resolveFocusedTerminalMonitorSlotId({
  mode,
  slots,
  activeSlotId,
  focusedSessionId,
  closedSlotIds,
}: {
  mode: TerminalMonitorLayoutMode;
  slots: TerminalMonitorSlot[];
  activeSlotId: string;
  focusedSessionId: string;
  closedSlotIds?: ReadonlySet<string>;
}): string {
  const availableSlotIds = getTerminalMonitorSlotIds(mode);
  const focusedSlot = slots.find(
    (slot) =>
      availableSlotIds.includes(slot.id) &&
      !closedSlotIds?.has(slot.id) &&
      slot.sessionId === focusedSessionId,
  );

  if (focusedSlot) {
    return focusedSlot.id;
  }

  return availableSlotIds.includes(activeSlotId)
    ? activeSlotId
    : availableSlotIds[0]!;
}

export function normalizeTerminalMonitorSlots({
  mode,
  sessions,
  preferredSessionId,
  preferredSlotId,
  previousSlots = [],
}: NormalizeTerminalMonitorSlotsOptions): TerminalMonitorSlot[] {
  const sessionIds = sessions.map((session) => session.id);
  const availableSessionIds = new Set(sessionIds);
  const usedSessionIds = new Set<string>();
  const previousSlotById = new Map(
    previousSlots.map((slot) => [slot.id, slot]),
  );

  const slots = getTerminalMonitorSlotIds(mode).map((slotId, index) => {
    const previousSlot = previousSlotById.get(slotId) ?? previousSlots[index];
    const sessionId = previousSlot?.sessionId ?? null;
    if (
      !sessionId ||
      !availableSessionIds.has(sessionId) ||
      usedSessionIds.has(sessionId)
    ) {
      return { id: slotId, sessionId: null };
    }

    usedSessionIds.add(sessionId);
    return { id: slotId, sessionId };
  });

  const preferredIsAvailable =
    typeof preferredSessionId === "string" &&
    availableSessionIds.has(preferredSessionId);
  const preferredAlreadyVisible =
    preferredIsAvailable &&
    slots.some((slot) => slot.sessionId === preferredSessionId);

  if (preferredIsAvailable && !preferredAlreadyVisible) {
    const preferredSlotIndex = preferredSlotId
      ? slots.findIndex((slot) => slot.id === preferredSlotId)
      : -1;
    const emptySlotIndex = slots.findIndex((slot) => !slot.sessionId);
    const targetIndex =
      preferredSlotIndex >= 0
        ? preferredSlotIndex
        : emptySlotIndex >= 0
          ? emptySlotIndex
          : 0;
    const replacedSessionId = slots[targetIndex]?.sessionId;

    if (replacedSessionId) {
      usedSessionIds.delete(replacedSessionId);
    }
    slots[targetIndex] = {
      ...slots[targetIndex]!,
      sessionId: preferredSessionId,
    };
    usedSessionIds.add(preferredSessionId);
  }

  for (const slot of slots) {
    if (slot.sessionId) {
      continue;
    }

    const nextSessionId = sessionIds.find(
      (sessionId) => !usedSessionIds.has(sessionId),
    );
    if (!nextSessionId) {
      continue;
    }

    slot.sessionId = nextSessionId;
    usedSessionIds.add(nextSessionId);
  }

  return slots;
}

export function setTerminalMonitorSlotSession(
  slots: TerminalMonitorSlot[],
  slotId: string,
  sessionId: string,
): TerminalMonitorSlot[] {
  return slots.map((slot) => {
    if (slot.id === slotId) {
      return { ...slot, sessionId };
    }

    if (slot.sessionId === sessionId) {
      return { ...slot, sessionId: null };
    }

    return slot;
  });
}

export function closeTerminalMonitorSlot(
  slots: TerminalMonitorSlot[],
  slotId: string,
): TerminalMonitorSlot[] {
  return slots.map((slot) =>
    slot.id === slotId ? { ...slot, sessionId: null } : slot,
  );
}

export function closeTerminalMonitorSlotWithReplacement(
  slots: TerminalMonitorSlot[],
  slotId: string,
  replacementSessionId?: string | null,
): TerminalMonitorSlot[] {
  if (!replacementSessionId) {
    return closeTerminalMonitorSlot(slots, slotId);
  }

  return setTerminalMonitorSlotSession(slots, slotId, replacementSessionId);
}

export function findFirstTerminalMonitorReplacementSession(
  sessions: TerminalMonitorSession[],
  currentSessionId?: string | null,
): TerminalMonitorSession | null {
  return sessions.find((session) => session.id !== currentSessionId) ?? null;
}

export function findNextOccupiedTerminalMonitorSlot(
  slots: TerminalMonitorSlot[],
  excludedSlotId?: string | null,
): TerminalMonitorSlot | null {
  return (
    slots.find(
      (slot) => slot.id !== excludedSlotId && Boolean(slot.sessionId),
    ) ??
    slots.find((slot) => Boolean(slot.sessionId)) ??
    null
  );
}

export function getTerminalPaneContextPrimaryActionLabel(
  canRestoreMultiPaneLayout: boolean,
): "单屏展示" | "还原多屏展示" {
  return canRestoreMultiPaneLayout ? "还原多屏展示" : "单屏展示";
}

export function restoreTerminalMonitorLayoutSnapshot({
  snapshot,
  sessions,
  preferredSessionId,
}: RestoreTerminalMonitorLayoutSnapshotOptions): RestoredTerminalMonitorLayout {
  const validSlotIds = new Set(getTerminalMonitorSlotIds(snapshot.mode));
  const closedSlotIds = snapshot.closedSlotIds.filter((slotId) =>
    validSlotIds.has(slotId),
  );
  const closedSlotIdSet = new Set(closedSlotIds);
  const slots = normalizeTerminalMonitorSlots({
    mode: snapshot.mode,
    sessions,
    preferredSessionId,
    preferredSlotId: snapshot.activeSlotId,
    previousSlots: snapshot.slots,
  }).map((slot) =>
    closedSlotIdSet.has(slot.id) ? { ...slot, sessionId: null } : slot,
  );
  const activeSlot =
    slots.find((slot) => slot.id === snapshot.activeSlotId && slot.sessionId) ??
    findNextOccupiedTerminalMonitorSlot(slots) ??
    slots.find((slot) => slot.id === snapshot.activeSlotId) ??
    slots[0]!;

  return {
    mode: snapshot.mode,
    slots,
    activeSlotId: activeSlot.id,
    closedSlotIds,
  };
}

export function placeTerminalMonitorSlotSession(
  slots: TerminalMonitorSlot[],
  targetSlotId: string,
  sessionId: string,
  sourceSlotId?: string | null,
): TerminalMonitorSlot[] {
  const targetSlot = slots.find((slot) => slot.id === targetSlotId);
  if (!targetSlot) {
    return slots;
  }

  const sourceSlot = sourceSlotId
    ? slots.find((slot) => slot.id === sourceSlotId)
    : slots.find((slot) => slot.sessionId === sessionId);
  if (sourceSlot?.id === targetSlotId) {
    return slots;
  }

  return slots.map((slot) => {
    if (slot.id === targetSlotId) {
      return { ...slot, sessionId };
    }

    if (sourceSlot && slot.id === sourceSlot.id) {
      return { ...slot, sessionId: targetSlot.sessionId };
    }

    if (!sourceSlot && slot.sessionId === sessionId) {
      return { ...slot, sessionId: null };
    }

    return slot;
  });
}

export function areTerminalMonitorSlotsEqual(
  left: TerminalMonitorSlot[],
  right: TerminalMonitorSlot[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((slot, index) => {
    const other = right[index];
    return other?.id === slot.id && other.sessionId === slot.sessionId;
  });
}
