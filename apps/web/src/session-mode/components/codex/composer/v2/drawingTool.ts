export type DrawingTool =
  | "select"
  | "hand"
  | "pen"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "comment";

const listeners = new Set<(tool: DrawingTool) => void>();
const promptListeners = new Set<
  (point: { x: number; y: number } | null) => void
>();

export function requestDrawingTool(tool: DrawingTool) {
  for (const listener of listeners) listener(tool);
}

export function onDrawingTool(listener: (tool: DrawingTool) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestCanvasPrompt(point: { x: number; y: number } | null) {
  for (const listener of promptListeners) listener(point);
}

export function onCanvasPrompt(
  listener: (point: { x: number; y: number } | null) => void,
) {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}
