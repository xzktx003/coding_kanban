export const MOBILE_TERMINAL_MIN_FONT_SIZE = 11;
export const MOBILE_TERMINAL_MAX_FONT_SIZE = 24;
export const MOBILE_TERMINAL_DEFAULT_FONT_SIZE = 15;
export const MOBILE_TERMINAL_FONT_SIZE_STORAGE_KEY =
  "mobile-terminal-font-size";

export interface TouchPointLike {
  clientX: number;
  clientY: number;
}

export interface MobileTerminalScrollState {
  accumulatedDeltaY: number;
  lineHeight: number;
}

interface MobileTerminalCursorTarget {
  blur: () => void;
  focus: () => void;
}

export function initializeMobileTerminalCursor({
  inputEnabled,
  mobileTouchMode,
  terminal,
}: {
  inputEnabled: boolean;
  mobileTouchMode: boolean;
  terminal: MobileTerminalCursorTarget;
}): boolean {
  if (!mobileTouchMode || inputEnabled) {
    return false;
  }

  // xterm does not render a cursor until it has been focused at least once.
  // Mobile monitor mode forwards input outside xterm, so initialize it and
  // immediately return to the inactive cursor without enabling direct stdin.
  terminal.focus();
  terminal.blur();
  return true;
}

export function getMobileTerminalCursorOptions(mobileTouchMode: boolean): {
  cursorInactiveStyle: "outline" | "underline";
  cursorStyle: "block" | "underline";
} {
  return mobileTouchMode
    ? {
        cursorInactiveStyle: "underline",
        cursorStyle: "underline",
      }
    : {
        cursorInactiveStyle: "outline",
        cursorStyle: "block",
      };
}

export function clampMobileTerminalFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return MOBILE_TERMINAL_DEFAULT_FONT_SIZE;
  }

  return Math.min(
    MOBILE_TERMINAL_MAX_FONT_SIZE,
    Math.max(MOBILE_TERMINAL_MIN_FONT_SIZE, Math.round(fontSize)),
  );
}

export function measureTouchDistance(
  first: TouchPointLike,
  second: TouchPointLike,
): number {
  return Math.hypot(
    first.clientX - second.clientX,
    first.clientY - second.clientY,
  );
}

export function computeMobilePinchFontSize({
  currentDistance,
  startDistance,
  startFontSize,
}: {
  currentDistance: number;
  startDistance: number;
  startFontSize: number;
}): number {
  if (startDistance <= 0) {
    return clampMobileTerminalFontSize(startFontSize);
  }

  return clampMobileTerminalFontSize(
    startFontSize * (currentDistance / startDistance),
  );
}

export function computeMobileTerminalScrollLines({
  accumulatedDeltaY,
  lineHeight,
}: MobileTerminalScrollState): {
  remainingDeltaY: number;
  scrollLines: number;
} {
  const safeLineHeight = Math.max(1, lineHeight);
  const movedLines = Math.trunc(accumulatedDeltaY / safeLineHeight);

  return {
    remainingDeltaY: accumulatedDeltaY - movedLines * safeLineHeight,
    scrollLines: movedLines === 0 ? 0 : -movedLines,
  };
}

export function loadMobileTerminalFontSize(): number {
  try {
    const raw = localStorage.getItem(MOBILE_TERMINAL_FONT_SIZE_STORAGE_KEY);
    return clampMobileTerminalFontSize(raw ? Number(raw) : NaN);
  } catch {
    return MOBILE_TERMINAL_DEFAULT_FONT_SIZE;
  }
}

export function saveMobileTerminalFontSize(fontSize: number): void {
  try {
    localStorage.setItem(
      MOBILE_TERMINAL_FONT_SIZE_STORAGE_KEY,
      String(clampMobileTerminalFontSize(fontSize)),
    );
  } catch {
    // ignore storage failures
  }
}
