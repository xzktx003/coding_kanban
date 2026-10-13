/** Shared Codex workbench membership. Selection, layout and native columns stay on each browser. */
export interface CodexFollowedThread {
  id: string;
  cwd: string;
  title: string;
}
export type CodexTabAction =
  | { type: "add"; thread: CodexFollowedThread }
  | { type: "update"; thread: CodexFollowedThread }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; beforeId: string | null };
export interface CodexTabOperation {
  /** Stable per-action retry identity; never shared with another page's action. */
  id?: string;
  seq: number;
  action: CodexTabAction;
}
export interface SharedCodexTabs {
  initialized: boolean;
  revision: number;
  threads: CodexFollowedThread[];
}
export interface CodexTabsRequest {
  clientId: string;
  operations: CodexTabOperation[];
  seed?: CodexFollowedThread[];
}

export function applyCodexTabAction(
  threads: CodexFollowedThread[],
  action: CodexTabAction,
): CodexFollowedThread[] {
  if (action.type === "add" || action.type === "update") {
    const index = threads.findIndex((thread) => thread.id === action.thread.id);
    if (index < 0) return action.type === "add" ? [...threads, action.thread] : threads;
    const result = [...threads];
    result[index] = { ...threads[index], ...action.thread };
    return result;
  }
  const index = threads.findIndex((thread) => thread.id === action.id);
  if (index < 0) return threads;
  if (action.type === "remove") return threads.filter((_, item) => item !== index);
  if (action.beforeId === action.id) return threads;
  const result = threads.filter((_, item) => item !== index);
  const target = action.beforeId === null ? -1 : result.findIndex((thread) => thread.id === action.beforeId);
  result.splice(target < 0 ? result.length : target, 0, threads[index]);
  return result;
}
