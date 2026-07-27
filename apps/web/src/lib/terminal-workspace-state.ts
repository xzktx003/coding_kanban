import {
  getTerminalMonitorSlotIds,
  isTerminalMonitorLayoutMode,
  type TerminalMonitorLayoutMode,
  type TerminalMonitorSlot,
} from "./terminal-layout";

const STORAGE_KEY = "terminal-monitor-workspace-v1";
const LEGACY_LAYOUT_STORAGE_KEY = "terminal-monitor-layout-mode";
const DEFAULT_SLOT_ID = "terminal-monitor-slot-1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TerminalWorkspaceState {
  mode: TerminalMonitorLayoutMode;
  slots: TerminalMonitorSlot[];
  activeSlotId: string;
  closedSlotIds: string[];
}

function defaultState(
  mode: TerminalMonitorLayoutMode = "single",
): TerminalWorkspaceState {
  return {
    mode,
    slots: [],
    activeSlotId: DEFAULT_SLOT_ID,
    closedSlotIds: [],
  };
}

function resolveStorage(storage?: StorageLike): StorageLike {
  return storage ?? localStorage;
}

function parseSlots(
  value: unknown,
  validSlotIds: Set<string>,
): TerminalMonitorSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((slot) => {
    if (
      !slot ||
      typeof slot !== "object" ||
      !("id" in slot) ||
      typeof slot.id !== "string" ||
      !validSlotIds.has(slot.id)
    ) {
      return [];
    }

    const sessionId =
      "sessionId" in slot && typeof slot.sessionId === "string"
        ? slot.sessionId
        : "sessionId" in slot && slot.sessionId === null
          ? null
          : undefined;
    return sessionId === undefined ? [] : [{ id: slot.id, sessionId }];
  });
}

export function loadTerminalWorkspaceState(
  storage?: StorageLike,
): TerminalWorkspaceState {
  const target = resolveStorage(storage);

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyMode = target.getItem(LEGACY_LAYOUT_STORAGE_KEY);
      return defaultState(
        isTerminalMonitorLayoutMode(legacyMode) ? legacyMode : "single",
      );
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mode = isTerminalMonitorLayoutMode(parsed.mode)
      ? parsed.mode
      : "single";
    const validSlotIds = new Set(getTerminalMonitorSlotIds(mode));
    const slots = parseSlots(parsed.slots, validSlotIds);
    const activeSlotId =
      typeof parsed.activeSlotId === "string" &&
      validSlotIds.has(parsed.activeSlotId)
        ? parsed.activeSlotId
        : DEFAULT_SLOT_ID;
    const closedSlotIds = Array.isArray(parsed.closedSlotIds)
      ? parsed.closedSlotIds.filter(
          (slotId): slotId is string =>
            typeof slotId === "string" && validSlotIds.has(slotId),
        )
      : [];

    return {
      mode,
      slots,
      activeSlotId,
      closedSlotIds,
    };
  } catch {
    return defaultState();
  }
}

export function saveTerminalWorkspaceState(
  state: TerminalWorkspaceState,
  storage?: StorageLike,
): void {
  try {
    resolveStorage(storage).setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore unavailable or full browser storage.
  }
}
