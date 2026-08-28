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
}

interface TerminalWheelCaptureOptions {
  wheelPassthrough: boolean;
}

const TERMINAL_WHEEL_MOUSE_TRACKING_MODES = new Set(["vt200", "drag", "any"]);
const TERMINAL_WHEEL_BLOCKING_OVERLAYS = [
  ".discovery-overlay",
  ".file-browser-modal",
  ".file-browser-fullscreen-preview",
  ".agent-transcript-backdrop",
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
}: TerminalWheelApplicationRoutingOptions): boolean {
  return (
    interactive &&
    inputEnabled &&
    TERMINAL_WHEEL_MOUSE_TRACKING_MODES.has(mouseTrackingMode) &&
    !shiftKey
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
