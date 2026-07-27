import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { AppVersionResponse } from "@agent-orchestrator/shared";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES = 4 * 1024;
const MAX_UNTRACKED_CONTENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 1_000;
const GIT_DIFF_TIMEOUT_MS = 5_000;

export interface AppVersionServiceOptions {
  sourceRoot: string;
  cacheTtlMs?: number;
  runtimeId?: string;
  startedAt?: string;
  sourceStateLoader?: (sourceRoot: string) => Promise<AppVersionSourceState>;
}

export interface AppVersionSourceState {
  sourceRevision: string;
  gitAvailable: boolean;
  gitHead: string | null;
  gitBranch: string | null;
}

async function runGit(sourceRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: sourceRoot,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    timeout: 5_000,
  });
  return result.stdout;
}

export async function readBoundedFilePrefix(
  path: string,
  maxBytes: number,
): Promise<Buffer> {
  const byteLimit = Number.isFinite(maxBytes)
    ? Math.max(0, Math.floor(maxBytes))
    : 0;
  if (byteLimit === 0) {
    return Buffer.alloc(0);
  }

  const fileHandle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(byteLimit);
    let totalBytesRead = 0;
    while (totalBytesRead < byteLimit) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        totalBytesRead,
        byteLimit - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) {
        break;
      }
      totalBytesRead += bytesRead;
    }
    return buffer.subarray(0, totalBytesRead);
  } finally {
    await fileHandle.close();
  }
}

function splitNullDelimited(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function resolveRepositoryPath(
  sourceRoot: string,
  relativePath: string,
): string | null {
  const root = resolve(sourceRoot);
  const candidate = resolve(root, relativePath);
  return candidate === root || candidate.startsWith(`${root}${sep}`)
    ? candidate
    : null;
}

async function hashUntrackedFiles(
  hash: ReturnType<typeof createHash>,
  sourceRoot: string,
  paths: string[],
): Promise<void> {
  let remainingContentBytes = MAX_UNTRACKED_CONTENT_BYTES;

  for (const relativePath of paths.sort()) {
    const absolutePath = resolveRepositoryPath(sourceRoot, relativePath);
    if (!absolutePath) {
      continue;
    }

    hash.update(`untracked:${relativePath}\0`);

    try {
      const stats = await lstat(absolutePath);
      hash.update(
        `${stats.mode}:${stats.size}:${stats.mtimeMs}:${stats.isFile() ? "file" : "other"}\0`,
      );

      if (!stats.isFile() || remainingContentBytes <= 0) {
        continue;
      }

      const bounded = await readBoundedFilePrefix(
        absolutePath,
        remainingContentBytes,
      );
      hash.update(bounded);
      remainingContentBytes -= bounded.byteLength;
    } catch {
      hash.update("unreadable\0");
    }
  }
}

async function hashGitDiff(sourceRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        "git",
        ["diff", "--no-ext-diff", "--binary", "HEAD", "--"],
        {
          cwd: sourceRoot,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      reject(error);
      return;
    }

    const hash = createHash("sha256");
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const onStdoutData = (chunk: Buffer | string) => {
      hash.update(chunk);
    };
    const onStderrData = (chunk: Buffer | string) => {
      if (stderrBytes >= MAX_GIT_STDERR_BYTES) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const bounded = buffer.subarray(0, MAX_GIT_STDERR_BYTES - stderrBytes);
      stderrChunks.push(bounded);
      stderrBytes += bounded.byteLength;
    };
    const diagnostic = () => {
      const message = Buffer.concat(stderrChunks).toString("utf8").trim();
      return message ? `: ${message}` : "";
    };
    const terminate = () => {
      child.kill("SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("data", onStdoutData);
      child.stdout?.removeListener("error", onStreamError);
      child.stderr?.removeListener("data", onStderrData);
      child.stderr?.removeListener("error", onStreamError);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      terminate();
      cleanup();
      reject(error);
    };
    const onError = (error: Error) => {
      fail(new Error(`git diff spawn failed${diagnostic()}: ${error.message}`));
    };
    const onStreamError = (error: Error) => {
      fail(
        new Error(`git diff stream failed${diagnostic()}: ${error.message}`),
      );
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        settled = true;
        cleanup();
        resolve(hash.digest("hex"));
        return;
      }

      const status = signal
        ? `signal ${signal}`
        : `exit code ${code ?? "unknown"}`;
      fail(new Error(`git diff failed with ${status}${diagnostic()}`));
    };

    child.stdout?.on("data", onStdoutData);
    child.stdout?.on("error", onStreamError);
    child.stderr?.on("data", onStderrData);
    child.stderr?.on("error", onStreamError);
    child.once("error", onError);
    child.once("close", onClose);
    timeout = setTimeout(() => {
      fail(new Error(`git diff timed out after ${GIT_DIFF_TIMEOUT_MS}ms`));
    }, GIT_DIFF_TIMEOUT_MS);
  });
}

async function computeGitSourceState(
  sourceRoot: string,
): Promise<AppVersionSourceState> {
  try {
    const [headOutput, branchOutput, diffDigest, untrackedOutput] =
      await Promise.all([
        runGit(sourceRoot, ["rev-parse", "HEAD"]),
        runGit(sourceRoot, ["branch", "--show-current"]),
        hashGitDiff(sourceRoot),
        runGit(sourceRoot, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]),
      ]);

    const gitHead = headOutput.trim();
    const gitBranch = branchOutput.trim() || null;
    const hash = createHash("sha256");
    hash.update(`head:${gitHead}\0branch:${gitBranch ?? ""}\0`);
    hash.update(`diff:${diffDigest}\0`);
    await hashUntrackedFiles(
      hash,
      sourceRoot,
      splitNullDelimited(untrackedOutput),
    );

    return {
      sourceRevision: hash.digest("hex"),
      gitAvailable: true,
      gitHead,
      gitBranch,
    };
  } catch {
    return {
      sourceRevision: createHash("sha256")
        .update(`git-unavailable:${resolve(sourceRoot)}`)
        .digest("hex"),
      gitAvailable: false,
      gitHead: null,
      gitBranch: null,
    };
  }
}

export class AppVersionService {
  private readonly cacheTtlMs: number;
  private readonly runtimeId: string;
  private readonly startedAt: string;
  private readonly sourceStateLoader: (
    sourceRoot: string,
  ) => Promise<AppVersionSourceState>;
  private inFlight: Promise<AppVersionResponse> | undefined;
  private cached:
    | {
        expiresAt: number;
        value: AppVersionResponse;
      }
    | undefined;

  constructor(private readonly options: AppVersionServiceOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.runtimeId = options.runtimeId ?? randomUUID();
    this.startedAt = options.startedAt ?? new Date().toISOString();
    this.sourceStateLoader = options.sourceStateLoader ?? computeGitSourceState;
  }

  async getVersion(): Promise<AppVersionResponse> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.value;
    }

    if (!this.inFlight) {
      this.inFlight = this.sourceStateLoader(this.options.sourceRoot).then(
        (sourceState) => {
          const value: AppVersionResponse = {
            runtimeId: this.runtimeId,
            startedAt: this.startedAt,
            ...sourceState,
          };
          this.cached = {
            expiresAt: Date.now() + this.cacheTtlMs,
            value,
          };
          return value;
        },
      );
    }

    const operation = this.inFlight;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = undefined;
      }
    }
  }
}
