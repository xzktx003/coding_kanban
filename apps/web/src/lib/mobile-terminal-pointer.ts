export type MobileTerminalPointerAction =
  | { type: "click"; clientX: number; clientY: number }
  | { type: "drag"; clientX: number; clientY: number; deltaY: number }
  | { type: "scroll"; deltaY: number }
  | { type: "ignore" };

const TAP_SLOP_PX = 10;

export function classifyMobileTerminalPointer({
  moved,
  startX,
  startY,
  x,
  y,
  tmuxMouse,
}: {
  moved: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  tmuxMouse: boolean;
}): MobileTerminalPointerAction {
  if (!tmuxMouse) {
    return moved > TAP_SLOP_PX
      ? { type: "scroll", deltaY: y - startY }
      : { type: "ignore" };
  }
  if (moved <= TAP_SLOP_PX) {
    return { type: "click", clientX: startX, clientY: startY };
  }
  return { type: "drag", clientX: x, clientY: y, deltaY: y - startY };
}

export function buildSgrMouseReport({
  button,
  release,
  clientX,
  clientY,
  screenLeft,
  screenTop,
  screenWidth,
  screenHeight,
  cols,
  rows,
}: {
  button: number;
  release: boolean;
  clientX: number;
  clientY: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  screenHeight: number;
  cols: number;
  rows: number;
}): string | null {
  if (screenWidth <= 0 || screenHeight <= 0 || cols <= 0 || rows <= 0) {
    return null;
  }
  const column = Math.max(
    1,
    Math.min(cols, Math.floor((clientX - screenLeft) / (screenWidth / cols)) + 1),
  );
  const row = Math.max(
    1,
    Math.min(rows, Math.floor((clientY - screenTop) / (screenHeight / rows)) + 1),
  );
  return `\u001b[<${button};${column};${row}${release ? "m" : "M"}`;
}
