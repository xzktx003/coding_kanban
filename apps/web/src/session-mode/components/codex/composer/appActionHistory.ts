/** In-memory Codex app action stack. Plugin undo/redo is Electron-only history. */
export type AppAction = {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  current?: () => boolean;
  expiresAt?: number;
};

const past: AppAction[] = [];
const future: AppAction[] = [];
const listeners = new Set<() => void>();
let generation = 0, version = 0, recordRevision = 0;
let pending: object | undefined;
const changed = () => { version++; for (const listener of listeners) listener(); };
export const subscribeAppActionHistory = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const appActionHistoryVersion = () => version;

export function recordAppAction(action: AppAction) {
  past.push(action);
  if (past.length > 100) past.splice(0, past.length - 100);
  future.length = 0;
  recordRevision++; changed();
}

export function canUndoAppAction() {
  return !pending && past.length > 0;
}

export function canRedoAppAction() {
  return !pending && future.length > 0;
}

async function transition(direction: "undo" | "redo", exact?: AppAction) {
  if (pending) return null;
  const from = direction === "undo" ? past : future;
  const to = direction === "undo" ? future : past;
  const action = exact ? from.includes(exact) ? exact : undefined : from.at(-1);
  if (!action) return null;
  if ((action.expiresAt !== undefined && action.expiresAt < Date.now()) || action.current?.() === false) throw new Error("此操作的状态或范围已变化，无法撤销或重做");
  const owner = {}, epoch = generation, revision = recordRevision;
  pending = owner; changed();
  try {
    await action[direction]();
    if (generation !== epoch) return null;
    // A later committed action clears redo. Remove only our own completed
    // transaction; a delayed ACK cannot pop the later action's history entry.
    const index = from.indexOf(action);
    if (index >= 0) from.splice(index, 1);
    if (recordRevision === revision) { to.push(action); if (to.length > 100) to.splice(0, to.length - 100); }
    return action.label;
  } finally { if (pending === owner) { pending = undefined; changed(); } }
}

export const undoAppAction = () => transition("undo");
export const redoAppAction = () => transition("redo");
/** A toast owns one precise entry; it must never undo a newer unrelated action. */
export const undoAppActionEntry = (action: AppAction) => transition("undo", action);

export function resetAppActionHistory() {
  past.length = 0;
  future.length = 0;
  generation++; recordRevision++; pending = undefined; changed();
}

if (import.meta.hot) import.meta.hot.dispose(() => { resetAppActionHistory(); listeners.clear(); });
