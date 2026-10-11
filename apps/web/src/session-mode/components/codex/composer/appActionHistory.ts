/** In-memory Codex app action stack. Plugin undo/redo is Electron-only history. */
type AppAction = {
  label: string;
  undo: () => void;
  redo: () => void;
};

const past: AppAction[] = [];
const future: AppAction[] = [];

export function recordAppAction(action: AppAction) {
  past.push(action);
  future.length = 0;
}

export function canUndoAppAction() {
  return past.length > 0;
}

export function canRedoAppAction() {
  return future.length > 0;
}

export function undoAppAction() {
  const action = past.pop();
  if (!action) return null;
  action.undo();
  future.push(action);
  return action.label;
}

export function redoAppAction() {
  const action = future.pop();
  if (!action) return null;
  action.redo();
  past.push(action);
  return action.label;
}

export function resetAppActionHistory() {
  past.length = 0;
  future.length = 0;
}
