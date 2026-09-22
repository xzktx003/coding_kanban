export type TerminalMouseGestureAction =
  | "hold"
  | "start-selection"
  | "continue-selection"
  | "finish-selection"
  | "replay-click";

// Some remote tmux configurations omit the mouse capability during the
// terminal handshake. Keep the browser-side report mode explicit so clicks
// still reach tmux instead of being treated as inert canvas events.
export const TMUX_MOUSE_REPORTING_ENABLE_SEQUENCE =
  "\u001b[?1002h\u001b[?1006h";

interface TerminalMouseGestureInput {
  phase: "move" | "up";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  selectionStarted: boolean;
  dragThreshold?: number;
}

export function resolveTerminalMouseGestureAction({
  phase,
  startX,
  startY,
  currentX,
  currentY,
  selectionStarted,
  dragThreshold = 4,
}: TerminalMouseGestureInput): TerminalMouseGestureAction {
  if (phase === "up") {
    return selectionStarted ? "finish-selection" : "replay-click";
  }

  if (selectionStarted) {
    return "continue-selection";
  }

  const deltaX = currentX - startX;
  const deltaY = currentY - startY;
  return deltaX * deltaX + deltaY * deltaY >= dragThreshold * dragThreshold
    ? "start-selection"
    : "hold";
}
