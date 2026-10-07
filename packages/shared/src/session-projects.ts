export type ProjectAction =
  | { type: "add"; path: string }
  | { type: "remove"; path: string }
  | { type: "move"; path: string; beforePath: string | null };
export interface ProjectOperation {
  seq: number;
  action: ProjectAction;
}
export interface SharedProjects {
  initialized: boolean;
  revision: number;
  projects: string[];
}
export interface ProjectsRequest {
  clientId: string;
  operations: ProjectOperation[];
  seed?: string[];
}
export function applyProjectAction(
  projects: string[],
  action: ProjectAction,
): string[] {
  const index = projects.indexOf(action.path);
  if (action.type === "add")
    return index < 0 ? [...projects, action.path] : projects;
  if (index < 0) return projects;
  const next = projects.filter((p) => p !== action.path);
  if (action.type === "remove") return next;
  if (action.beforePath === action.path) return projects;
  const target =
    action.beforePath === null ? -1 : next.indexOf(action.beforePath);
  next.splice(target < 0 ? next.length : target, 0, action.path);
  return next;
}
