export type TerminalMouseGestureAction =
  | "hold"
  | "start-selection"
  | "continue-selection"
  | "finish-selection"
  | "replay-click";

interface TerminalMouseGestureInput {
  phase: "move" | "up";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  selectionStarted: boolean;
  dragThreshold?: number;
}

interface TerminalContextMenuInput {
  interactive: boolean;
  inputEnabled: boolean;
  targetIsTerminal: boolean;
}

export function shouldSuppressTerminalContextMenu({
  interactive,
  inputEnabled,
  targetIsTerminal,
}: TerminalContextMenuInput): boolean {
  return interactive && inputEnabled && targetIsTerminal;
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
