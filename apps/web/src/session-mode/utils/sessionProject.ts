import type { AgentCenterCard } from "../stores/useAgentCenterStore";
type Project = Pick<AgentCenterCard, "cwd" | "worktreePath">;
const clean = (path?: string | null) =>
  path?.trim().replace(/\/+$/, "") || (path === "/" ? "/" : null);
function uniqueSuffix(path: string, paths: string[]) {
  const parts = path.split("/").filter(Boolean);
  for (let n = 1; n <= parts.length; n++) {
    const suffix = parts.slice(-n).join("/");
    if (
      !paths.some(
        (other) =>
          other !== path &&
          (other === `/${suffix}` || other.endsWith(`/${suffix}`)),
      )
    )
      return suffix;
  }
  return path;
}
/** Only session metadata is authoritative; the active workspace is never a fallback. */
export function sessionProject(card: Project, peers: Project[]) {
  const projectPath = clean(card.cwd),
    worktree = clean(card.worktreePath);
  const path = worktree || projectPath;
  if (!path) return { label: "项目未知", path: null, projectPath: null };
  const root = projectPath || path;
  let label = uniqueSuffix(
    root,
    peers
      .map((c) => clean(c.cwd) || clean(c.worktreePath))
      .filter((p): p is string => Boolean(p)),
  );
  if (worktree && worktree !== root)
    label += ` · ${uniqueSuffix(
      worktree,
      peers
        .map((c) => clean(c.worktreePath))
        .filter((p): p is string => Boolean(p)),
    )}`;
  return { label, path, projectPath };
}
