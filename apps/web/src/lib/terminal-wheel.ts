export const TERMINAL_WHEEL_DELTA_PIXEL = 0;
export const TERMINAL_WHEEL_DELTA_LINE = 1;
export const TERMINAL_WHEEL_DELTA_PAGE = 2;

interface TerminalWheelScrollOptions {
  deltaMode: number;
  deltaY: number;
  lineHeight: number;
  pageHeight: number;
  previousDeltaY: number;
}

interface TerminalWheelScrollResult {
  remainingDeltaY: number;
  scrollLines: number;
}

interface TerminalWheelApplicationRoutingOptions {
  inputEnabled: boolean;
  interactive: boolean;
  mouseTrackingMode: string;
  shiftKey: boolean;
  tmuxMouseReporting?: boolean;
}

interface TerminalWheelCaptureOptions {
  wheelPassthrough: boolean;
}

interface TerminalWheelReportOptions {
  altKey: boolean;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  deltaY: number;
  metaKey: boolean;
  screenHeight: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  cols: number;
  rows: number;
  shiftKey: boolean;
}

const TERMINAL_WHEEL_MOUSE_TRACKING_MODES = new Set(["vt200", "drag", "any"]);
const TERMINAL_WHEEL_BLOCKING_OVERLAYS = [
  ".discovery-overlay",
  ".file-browser-modal",
  ".file-browser-fullscreen-preview",
  ".agent-transcript-backdrop",
  ".agent-transcript-fullscreen-backdrop",
  ".new-session-backdrop",
  ".terminal-session-switcher-menu",
  ".mobile-session-picker-menu",
];

interface ClosestTarget {
  closest(selector: string): unknown;
}

export function isTerminalWheelBlockedByOverlayTarget(
  target: EventTarget | null,
): boolean {
  if (
    !target ||
    typeof (target as Partial<ClosestTarget>).closest !== "function"
  ) {
    return false;
  }

  const element = target as unknown as ClosestTarget;
  return TERMINAL_WHEEL_BLOCKING_OVERLAYS.some((selector) =>
    Boolean(element.closest(selector)),
  );
}

export function shouldForwardTerminalWheelToApplication({
  inputEnabled,
  interactive,
  mouseTrackingMode,
  shiftKey,
  tmuxMouseReporting = false,
}: TerminalWheelApplicationRoutingOptions): boolean {
  return (
    interactive &&
    inputEnabled &&
    !shiftKey &&
    (TERMINAL_WHEEL_MOUSE_TRACKING_MODES.has(mouseTrackingMode) ||
      tmuxMouseReporting)
  );
}

export function shouldCaptureTerminalWheel({
  wheelPassthrough,
}: TerminalWheelCaptureOptions): boolean {
  return !wheelPassthrough;
}

export function shouldAllowTerminalWheelToBubble({
  wheelPassthrough,
}: TerminalWheelCaptureOptions): boolean {
  return wheelPassthrough;
}

export function buildTerminalWheelReport({
  altKey,
  clientX,
  clientY,
  ctrlKey,
  deltaY,
  metaKey,
  screenHeight,
  screenLeft,
  screenTop,
  screenWidth,
  cols,
  rows,
  shiftKey,
}: TerminalWheelReportOptions): string | null {
  if (
    !Number.isFinite(deltaY) ||
    deltaY === 0 ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    screenWidth <= 0 ||
    screenHeight <= 0 ||
    cols <= 0 ||
    rows <= 0
  ) {
    return null;
  }

  const cellWidth = screenWidth / cols;
  const cellHeight = screenHeight / rows;
  const column = Math.max(
    1,
    Math.min(cols, Math.floor((clientX - screenLeft) / cellWidth) + 1),
  );
  const row = Math.max(
    1,
    Math.min(rows, Math.floor((clientY - screenTop) / cellHeight) + 1),
  );
  let button = deltaY < 0 ? 64 : 65;
  if (shiftKey) button |= 4;
  if (metaKey || altKey) button |= 8;
  if (ctrlKey) button |= 16;

  return `\u001b[<${button};${column};${row}M`;
}

export function shouldScrollTerminalLayoutWheel({
  ctrlKey,
  hasOverflow,
  metaKey,
  shiftKey,
}: {
  ctrlKey: boolean;
  hasOverflow: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return hasOverflow && !ctrlKey && !metaKey && !shiftKey;
}

export function normalizeTerminalWheelDeltaY({
  deltaMode,
  deltaY,
  lineHeight,
  pageHeight,
}: Omit<TerminalWheelScrollOptions, "previousDeltaY">): number {
  const safeLineHeight = Math.max(1, lineHeight);
  const safePageHeight = Math.max(safeLineHeight, pageHeight);

  if (deltaMode === TERMINAL_WHEEL_DELTA_LINE) {
    return deltaY * safeLineHeight;
  }

  if (deltaMode === TERMINAL_WHEEL_DELTA_PAGE) {
    return deltaY * safePageHeight;
  }

  return deltaY;
}

export function computeTerminalWheelScrollLines({
  deltaMode,
  deltaY,
  lineHeight,
  pageHeight,
  previousDeltaY,
}: TerminalWheelScrollOptions): TerminalWheelScrollResult {
  const safeLineHeight = Math.max(1, lineHeight);
  const accumulatedDeltaY =
    previousDeltaY +
    normalizeTerminalWheelDeltaY({
      deltaMode,
      deltaY,
      lineHeight: safeLineHeight,
      pageHeight,
    });
  const scrollLines = Math.trunc(accumulatedDeltaY / safeLineHeight);

  return {
    remainingDeltaY: accumulatedDeltaY - scrollLines * safeLineHeight,
    scrollLines,
  };
}
