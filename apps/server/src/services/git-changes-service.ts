import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  CheckoutDiffResponse,
  DiffFileChange,
  DiffFileStatus,
  RevertGitHunkResponse,
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

interface ParsedStatus {
  status: DiffFileStatus;
  previousPath?: string;
}

function parseStatus(status: string): Map<string, ParsedStatus> {
  const files = new Map<string, ParsedStatus>();
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
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
    const previousPath = code.includes("R") || code.includes("C")
      ? entries[index + 1]
      : undefined;
    if (previousPath) index += 1;
    files.set(path, { status: statusCode, previousPath });
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

interface ParsedGitHunk {
  header: string;
  index: number;
  lines: string[];
  oldCount: number;
  oldStart: number;
}

interface ParsedGitPatch {
  hunks: ParsedGitHunk[];
  prelude: string[];
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseGitPatch(patch: string): ParsedGitPatch {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const firstHunkIndex = lines.findIndex((line) => hunkHeaderPattern.test(line));
  if (firstHunkIndex < 0) {
    return { hunks: [], prelude: lines.filter(Boolean) };
  }

  const hunks: ParsedGitHunk[] = [];
  let current: ParsedGitHunk | null = null;
  for (const line of lines.slice(firstHunkIndex)) {
    const header = line.match(hunkHeaderPattern);
    if (header) {
      current = {
        header: line,
        index: hunks.length,
        lines: [line],
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
      };
      hunks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  return { hunks, prelude: lines.slice(0, firstHunkIndex) };
}

function buildGitPatch(
  parsed: ParsedGitPatch,
  hunks: ParsedGitHunk[],
  normalizeToCurrentPath = false,
): string {
  const currentPathHeader = normalizeToCurrentPath
    ? parsed.prelude.find((line) => line.startsWith("+++ "))?.slice(4)
    : undefined;
  const prelude = parsed.prelude
    .filter(
      (line) =>
        line.startsWith("diff --git ") ||
        line.startsWith("index ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ "),
    )
    .map((line) => {
      if (!currentPathHeader) return line;
      if (line.startsWith("diff --git ")) {
        return `diff --git ${currentPathHeader} ${currentPathHeader}`;
      }
      if (line.startsWith("--- ")) return `--- ${currentPathHeader}`;
      return line;
    });
  return `${[...prelude, ...hunks.flatMap((hunk) => hunk.lines)]
    .join("\n")
    .replace(/\n+$/, "")}\n`;
}

function hunkRangesOverlap(left: ParsedGitHunk, right: ParsedGitHunk): boolean {
  const leftEnd = left.oldStart + Math.max(left.oldCount, 1);
  const rightEnd = right.oldStart + Math.max(right.oldCount, 1);
  return left.oldStart < rightEnd && right.oldStart < leftEnd;
}

async function runGitPatch(
  cwd: string,
  args: string[],
  patch: string,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("git apply timed out"));
    }, GIT_TIMEOUT_MS);

    child.once("error", (error) => finish(error));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `git apply failed (${signal ?? code ?? "unknown"}): ${stderr.trim()}`,
        ),
      );
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(patch);
  });
}

export class GitChangesService {
  async revertHunk(
    workingDirectory: string | undefined,
    path: string,
    hunkIndex: number,
    hunkHeader: string,
  ): Promise<RevertGitHunkResponse> {
    const requestedDirectory = workingDirectory?.trim();
    if (!requestedDirectory) {
      throw new GitHunkRevertError("没有工作目录", 400);
    }
    if (typeof path !== "string" || !path.trim()) {
      throw new GitHunkRevertError("缺少要还原的文件路径", 400);
    }
    if (!Number.isInteger(hunkIndex) || hunkIndex < 0) {
      throw new GitHunkRevertError("改动块序号无效", 400);
    }
    if (typeof hunkHeader !== "string" || !hunkHeader.trim()) {
      throw new GitHunkRevertError("缺少改动块标识", 400);
    }

    const directory = resolve(requestedDirectory);
    let safePath: string;
    try {
      safePath = filePatchPath(directory, path);
    } catch (error) {
      throw new GitHunkRevertError(
        error instanceof Error ? error.message : "Git 文件路径无效",
        400,
      );
    }

    await access(directory);
    const current = await this.read(directory);
    if (!current.available) {
      throw new GitHunkRevertError(
        current.unavailableReason ?? "当前 Git 工作区不可用",
        409,
      );
    }

    const change = current.files.find((file) => file.path === path);
    if (!change) {
      throw new GitHunkRevertError("该文件已不在当前变更列表中，请刷新后重试", 409);
    }

    const parsedPatch = parseGitPatch(change.patch);
    const targetHunk = parsedPatch.hunks[hunkIndex];
    if (!targetHunk || targetHunk.header !== hunkHeader) {
      throw new GitHunkRevertError(
        "改动块已发生变化，请刷新 Diff 后重试",
        409,
      );
    }

    const normalizeRenamedPath = change.status === "renamed";
    const worktreePatch = buildGitPatch(
      parsedPatch,
      [targetHunk],
      normalizeRenamedPath,
    );
    const cachedPathspec = change.previousPath
      ? [filePatchPath(directory, change.previousPath), safePath]
      : [safePath];
    const cachedPatchText = await runGit(directory, [
      "diff",
      "--cached",
      "HEAD",
      "--no-ext-diff",
      "--binary",
      "--",
      ...cachedPathspec,
    ]);
    const parsedCachedPatch = parseGitPatch(cachedPatchText);
    const cachedHunks = parsedCachedPatch.hunks.filter((hunk) =>
      hunkRangesOverlap(targetHunk, hunk),
    );
    const cachedPatch = cachedHunks.length
      ? buildGitPatch(parsedCachedPatch, cachedHunks, normalizeRenamedPath)
      : null;

    try {
      await runGitPatch(
        directory,
        ["apply", "--reverse", "--check", "--whitespace=nowarn"],
        worktreePatch,
      );
      if (cachedPatch) {
        await runGitPatch(
          directory,
          [
            "apply",
            "--reverse",
            "--cached",
            "--check",
            "--whitespace=nowarn",
          ],
          cachedPatch,
        );
        await runGitPatch(
          directory,
          ["apply", "--reverse", "--cached", "--whitespace=nowarn"],
          cachedPatch,
        );
      }

      try {
        await runGitPatch(
          directory,
          ["apply", "--reverse", "--whitespace=nowarn"],
          worktreePatch,
        );
      } catch (error) {
        if (cachedPatch) {
          await runGitPatch(
            directory,
            ["apply", "--cached", "--whitespace=nowarn"],
            cachedPatch,
          ).catch(() => undefined);
        }
        throw error;
      }
    } catch {
      throw new GitHunkRevertError(
        "无法还原该改动块，文件内容可能已变化，请刷新后重试",
        409,
      );
    }

    return { ok: true, path, hunkIndex, hunkHeader };
  }

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
          "--untracked-files=all",
          "-z",
        ]),
      ]);
      const statuses = parseStatus(status);
      const files: DiffFileChange[] = [];
      for (const path of [...statuses.keys()].sort()) {
        const safePath = filePatchPath(directory, path);
        const { status: statusValue, previousPath } = statuses.get(path)!;
        const safePreviousPath = previousPath
          ? filePatchPath(directory, previousPath)
          : undefined;
        const patch = statusValue === "untracked"
          ? await runGit(directory, [
              "diff",
              "--no-index",
              "--no-ext-diff",
              "--binary",
              "--",
              "/dev/null",
              safePath,
            ], true)
          : await runGit(directory, [
              "diff",
              "HEAD",
              "--no-ext-diff",
              "--binary",
              "--",
              ...(safePreviousPath ? [safePreviousPath, safePath] : [safePath]),
            ], true);
        const binary = patch.includes("Binary files") || patch.includes("GIT binary patch");
        const counts = binary
          ? { addedLines: 0, deletedLines: 0 }
          : countPatchLines(patch);
        files.push({ path, previousPath, status: statusValue, patch, binary, ...counts });
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

export class GitHunkRevertError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 409,
  ) {
    super(message);
    this.name = "GitHunkRevertError";
  }
}
