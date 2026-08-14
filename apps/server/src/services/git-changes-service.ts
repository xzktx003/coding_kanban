import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  CheckoutDiffResponse,
  DiffFileChange,
  DiffFileStatus,
} from "@agent-orchestrator/shared";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

async function runGit(cwd: string, args: string[], allowFailure = false): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
    });
    return result.stdout;
  } catch (error) {
    if (allowFailure && error && typeof error === "object" && "stdout" in error) {
      return String(error.stdout ?? "");
    }
    throw error;
  }
}

function parseStatus(status: string): Map<string, DiffFileStatus> {
  const files = new Map<string, DiffFileStatus>();
  const entries = status.split("\0").filter(Boolean);
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const rawPath = entry.slice(3);
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)! : rawPath;
    const statusCode = code.includes("?")
      ? "untracked"
      : code.includes("U")
        ? "conflicted"
        : code.includes("R")
          ? "renamed"
          : code.includes("A")
            ? "added"
            : code.includes("D")
              ? "deleted"
              : "modified";
    files.set(path, statusCode);
  }
  return files;
}

function countPatchLines(patch: string): { addedLines: number; deletedLines: number } {
  return patch.split("\n").reduce(
    (totals, line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) totals.addedLines += 1;
      if (line.startsWith("-") && !line.startsWith("---")) totals.deletedLines += 1;
      return totals;
    },
    { addedLines: 0, deletedLines: 0 },
  );
}

function filePatchPath(directory: string, path: string): string {
  const absolute = resolve(directory, path);
  const relativePath = relative(directory, absolute);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Git 文件路径越界");
  }
  return relativePath;
}

export class GitChangesService {
  async read(workingDirectory?: string): Promise<CheckoutDiffResponse> {
    const generatedAt = new Date().toISOString();
    const requestedDirectory = workingDirectory?.trim();
    if (!requestedDirectory) {
      return this.unavailable(generatedAt, "没有工作目录");
    }

    const directory = resolve(requestedDirectory);
    try {
      await access(directory);
      const repositoryRoot = (await runGit(directory, ["rev-parse", "--show-toplevel"])).trim();
      const [branch, head, status] = await Promise.all([
        runGit(directory, ["branch", "--show-current"]),
        runGit(directory, ["rev-parse", "--short", "HEAD"]),
        runGit(directory, [
          "status",
          "--porcelain=v1",
          "--untracked-files=no",
          "-z",
        ]),
      ]);
      const statuses = parseStatus(status);
      const files: DiffFileChange[] = [];
      for (const path of [...statuses.keys()].sort()) {
        const safePath = filePatchPath(directory, path);
        const statusValue = statuses.get(path)!;
        let patch = "";
        let binary = false;
        patch = await runGit(directory, [
          "diff",
          "HEAD",
          "--no-ext-diff",
          "--binary",
          "--",
          safePath,
        ], true);
        binary = patch.includes("Binary files") || patch.includes("GIT binary patch");
        const counts = binary
          ? { addedLines: 0, deletedLines: 0 }
          : countPatchLines(patch);
        files.push({ path, status: statusValue, patch, binary, ...counts });
      }

      return {
        available: true,
        scope: "checkout",
        projectName: basename(repositoryRoot),
        repositoryRoot,
        branch: branch.trim() || undefined,
        head: head.trim(),
        changedFiles: files.length,
        addedLines: files.reduce((sum, file) => sum + file.addedLines, 0),
        deletedLines: files.reduce((sum, file) => sum + file.deletedLines, 0),
        files,
        generatedAt,
      };
    } catch {
      return this.unavailable(generatedAt, "当前目录不是可读取的 Git 工作区");
    }
  }

  private unavailable(generatedAt: string, unavailableReason: string): CheckoutDiffResponse {
    return {
      available: false,
      scope: "checkout",
      changedFiles: 0,
      addedLines: 0,
      deletedLines: 0,
      files: [],
      generatedAt,
      unavailableReason,
    };
  }
}
