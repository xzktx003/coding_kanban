import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import type { AgentGitSummary } from "@agent-orchestrator/shared";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 4_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: GIT_TIMEOUT_MS,
  });
  return result.stdout.trim();
}

function parseNumstat(output: string): { added: number; deleted: number } {
  return output.split("\n").reduce(
    (totals, line) => {
      const [added, deleted] = line.split("\t");
      const addedLines = Number(added);
      const deletedLines = Number(deleted);
      if (Number.isFinite(addedLines)) totals.added += addedLines;
      if (Number.isFinite(deletedLines)) totals.deleted += deletedLines;
      return totals;
    },
    { added: 0, deleted: 0 },
  );
}

function resolveGitPath(directory: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(directory, value);
}

export class GitProjectSummaryService {
  async read(workingDirectory?: string): Promise<AgentGitSummary> {
    const requestedDirectory = workingDirectory?.trim();
    if (!requestedDirectory) {
      return {
        available: false,
        isGitRepository: false,
        unavailableReason: "没有工作目录",
        updatedAt: new Date().toISOString(),
      };
    }

    const directory = resolve(requestedDirectory);
    try {
      await access(directory);
    } catch {
      return {
        available: false,
        isGitRepository: false,
        unavailableReason: "工作目录不可访问",
        updatedAt: new Date().toISOString(),
      };
    }

    const projectName = basename(directory) || directory;
    try {
      const repositoryRoot = await runGit(directory, [
        "rev-parse",
        "--show-toplevel",
      ]);
      const [branch, head, gitDir, commonDir, status, numstat] =
        await Promise.all([
          runGit(directory, ["branch", "--show-current"]),
          runGit(directory, ["rev-parse", "--short", "HEAD"]),
          runGit(directory, ["rev-parse", "--git-dir"]),
          runGit(directory, ["rev-parse", "--git-common-dir"]),
          runGit(directory, ["status", "--porcelain=v1", "-z"]),
          runGit(directory, ["diff", "HEAD", "--numstat", "--"]),
        ]);
      const statusEntries = status.split("\0").filter(Boolean);
      const changedFiles = statusEntries.length;
      const totals = parseNumstat(numstat);
      const resolvedGitDir = resolveGitPath(directory, gitDir);
      const resolvedCommonDir = resolveGitPath(directory, commonDir);
      const isWorktree = resolvedGitDir !== resolvedCommonDir;
      return {
        available: true,
        projectName:
          (isWorktree ? basename(dirname(resolvedCommonDir)) : "") ||
          basename(repositoryRoot) ||
          projectName,
        repositoryRoot,
        branch: branch || undefined,
        head,
        isGitRepository: true,
        isWorktree,
        changedFiles,
        addedLines: totals.added,
        deletedLines: totals.deleted,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return {
        available: true,
        projectName,
        isGitRepository: false,
        updatedAt: new Date().toISOString(),
      };
    }
  }
}
