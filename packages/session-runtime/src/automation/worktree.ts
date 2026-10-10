import { basename } from "node:path";
import type { GitService } from "../git/index.js";
import { validDirectory, validId } from "../storage/database.js";
export function worktreeKey(taskId: string, project: string) {
  validId(taskId);
  validDirectory(project);
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(project)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${taskId}-${basename(project) || "repo"}-${hash.toString(16).padStart(16, "0").slice(0, 8)}`;
}
export function automationWorktree(git: GitService) {
  return async (taskId: string, project: string) => {
    const key = worktreeKey(taskId, project);
    const changes = await git.hasWorktreeChanges(project, key);
    if (!changes.has_changes) await git.removeWorktree(project, key);
    return (await git.createWorktree(project, key)).worktree_path;
  };
}
