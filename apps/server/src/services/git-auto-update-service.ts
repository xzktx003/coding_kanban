import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitAutoUpdateConflictReason,
  GitAutoUpdatePhase,
  GitAutoUpdateStatus,
} from "@agent-orchestrator/shared";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;
const GIT_READ_TIMEOUT_MS = 10_000;
const GIT_FETCH_TIMEOUT_MS = 120_000;
const SAFE_GIT_REF_PATTERN = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/;

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitUpdateRunResult {
  phase: Extract<
    GitAutoUpdatePhase,
    "idle" | "available" | "updated" | "conflict"
  >;
  branch: string;
  remoteHead: string;
  conflictReason: GitAutoUpdateConflictReason | null;
  message: string | null;
  updated: boolean;
}

type GitUpdateOperationKind = "check" | "apply";

interface GitUpdateOperation {
  kind: GitUpdateOperationKind;
  promise: Promise<GitAutoUpdateStatus>;
}

export interface GitAutoUpdateServiceOptions {
  sourceRoot: string;
  intervalMinutes: 10 | 30 | null;
  checkRunner?: (sourceRoot: string) => Promise<GitUpdateRunResult>;
  applyRunner?: (sourceRoot: string) => Promise<GitUpdateRunResult>;
  now?: () => Date;
}

class GitCommandError extends Error {
  constructor(
    message: string,
    readonly result: GitCommandResult,
  ) {
    super(message);
  }
}

async function runGit(
  sourceRoot: string,
  args: string[],
  options: {
    allowExitCodes?: number[];
    timeoutMs?: number;
  } = {},
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: sourceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: options.timeoutMs ?? GIT_READ_TIMEOUT_MS,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const exitCode =
      typeof commandError.code === "number" ? commandError.code : -1;
    const result = {
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? "",
      exitCode,
    };
    if (options.allowExitCodes?.includes(exitCode)) {
      return result;
    }
    throw new GitCommandError(`git ${args[0] ?? "command"} failed`, result);
  }
}

function requireSafeRef(ref: string, label: string): string {
  if (!SAFE_GIT_REF_PATTERN.test(ref)) {
    throw new Error(`${label} is not a safe Git ref`);
  }
  return ref;
}

function mergeConflictReason(
  result: GitCommandResult,
): GitAutoUpdateConflictReason {
  const diagnostic = `${result.stdout}\n${result.stderr}`;
  return /local changes|would be overwritten|please commit|please stash/i.test(
    diagnostic,
  )
    ? "local-changes"
    : "merge-blocked";
}

function conflictMessage(reason: GitAutoUpdateConflictReason): string {
  if (reason === "local-changes") {
    return "检测到远程新版本，但本地未提交修改会被覆盖，已停止自动更新。";
  }
  if (reason === "diverged") {
    return "检测到远程新版本，但本地与远程分支已经分叉，需要手动合并。";
  }
  return "检测到远程新版本，但 Git 无法安全快进，已停止自动更新。";
}

interface GitRepositoryRelation {
  branch: string;
  localHead: string;
  remoteHead: string;
  relation: "equal" | "behind" | "ahead" | "diverged";
}

async function inspectGitRepository(
  sourceRoot: string,
): Promise<GitRepositoryRelation> {
  const branch = requireSafeRef(
    (await runGit(sourceRoot, ["branch", "--show-current"])).stdout.trim(),
    "Current branch",
  );
  if (!branch) {
    throw new Error("Detached HEAD cannot be updated automatically");
  }

  const upstream = requireSafeRef(
    (
      await runGit(sourceRoot, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ])
    ).stdout.trim(),
    "Upstream branch",
  );

  await runGit(sourceRoot, ["fetch", "--prune"], {
    timeoutMs: GIT_FETCH_TIMEOUT_MS,
  });

  const localHead = (
    await runGit(sourceRoot, ["rev-parse", "--verify", "HEAD"])
  ).stdout.trim();
  const remoteHead = (
    await runGit(sourceRoot, ["rev-parse", "--verify", upstream])
  ).stdout.trim();

  if (localHead === remoteHead) {
    return { branch, localHead, remoteHead, relation: "equal" };
  }

  const localIsAncestor = await runGit(
    sourceRoot,
    ["merge-base", "--is-ancestor", localHead, remoteHead],
    { allowExitCodes: [0, 1] },
  );
  if (localIsAncestor.exitCode === 0) {
    return { branch, localHead, remoteHead, relation: "behind" };
  }

  const remoteIsAncestor = await runGit(
    sourceRoot,
    ["merge-base", "--is-ancestor", remoteHead, localHead],
    { allowExitCodes: [0, 1] },
  );
  return {
    branch,
    localHead,
    remoteHead,
    relation: remoteIsAncestor.exitCode === 0 ? "ahead" : "diverged",
  };
}

async function runGitCheck(sourceRoot: string): Promise<GitUpdateRunResult> {
  const repository = await inspectGitRepository(sourceRoot);
  const available =
    repository.relation === "behind" || repository.relation === "diverged";
  return {
    phase: available ? "available" : "idle",
    branch: repository.branch,
    remoteHead: repository.remoteHead,
    conflictReason: null,
    message: available ? "远程有新版本，等待用户确认后再拉取。" : null,
    updated: false,
  };
}

async function runGitApply(sourceRoot: string): Promise<GitUpdateRunResult> {
  const repository = await inspectGitRepository(sourceRoot);
  if (repository.relation === "equal" || repository.relation === "ahead") {
    return {
      phase: "idle",
      branch: repository.branch,
      remoteHead: repository.remoteHead,
      conflictReason: null,
      message: null,
      updated: false,
    };
  }

  if (repository.relation === "diverged") {
    return {
      phase: "conflict",
      branch: repository.branch,
      remoteHead: repository.remoteHead,
      conflictReason: "diverged",
      message: conflictMessage("diverged"),
      updated: false,
    };
  }

  try {
    await runGit(sourceRoot, ["merge", "--ff-only", repository.remoteHead], {
      timeoutMs: GIT_READ_TIMEOUT_MS,
    });
  } catch (error) {
    if (!(error instanceof GitCommandError)) {
      throw error;
    }
    const reason = mergeConflictReason(error.result);
    return {
      phase: "conflict",
      branch: repository.branch,
      remoteHead: repository.remoteHead,
      conflictReason: reason,
      message: conflictMessage(reason),
      updated: false,
    };
  }

  return {
    phase: "updated",
    branch: repository.branch,
    remoteHead: repository.remoteHead,
    conflictReason: null,
    message: "远程新版本已安全拉取，正在等待前端执行热更新恢复。",
    updated: true,
  };
}

export class GitAutoUpdateService {
  private status: GitAutoUpdateStatus;
  private inFlight: GitUpdateOperation | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly checkRunner: (
    sourceRoot: string,
  ) => Promise<GitUpdateRunResult>;
  private readonly applyRunner: (
    sourceRoot: string,
  ) => Promise<GitUpdateRunResult>;
  private readonly now: () => Date;

  constructor(private readonly options: GitAutoUpdateServiceOptions) {
    this.checkRunner = options.checkRunner ?? runGitCheck;
    this.applyRunner = options.applyRunner ?? runGitApply;
    this.now = options.now ?? (() => new Date());
    this.status = {
      enabled: options.intervalMinutes !== null,
      intervalMinutes: options.intervalMinutes,
      phase: options.intervalMinutes === null ? "disabled" : "idle",
      branch: null,
      remoteHead: null,
      lastCheckedAt: null,
      lastUpdatedAt: null,
      conflictReason: null,
      message: null,
    };
  }

  getStatus(): GitAutoUpdateStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.options.intervalMinutes === null || this.timer) {
      return;
    }

    void this.checkNow();
    this.timer = setInterval(
      () => void this.checkNow(),
      this.options.intervalMinutes * 60_000,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async checkNow(): Promise<GitAutoUpdateStatus> {
    if (this.options.intervalMinutes === null) {
      return this.getStatus();
    }
    if (this.inFlight) {
      return this.inFlight.promise;
    }
    return this.runOperation("check", this.checkRunner, true);
  }

  async applyUpdate(): Promise<GitAutoUpdateStatus> {
    if (this.options.intervalMinutes === null) {
      return this.getStatus();
    }

    const operation = this.inFlight;
    if (operation?.kind === "apply") {
      return operation.promise;
    }
    if (operation?.kind === "check") {
      await operation.promise;
      return this.applyUpdate();
    }

    return this.runOperation("apply", this.applyRunner, false);
  }

  private async runOperation(
    kind: GitUpdateOperationKind,
    runner: (sourceRoot: string) => Promise<GitUpdateRunResult>,
    preserveMatchingConflict: boolean,
  ): Promise<GitAutoUpdateStatus> {
    const previousStatus = this.status;
    this.status = {
      ...this.status,
      phase: "checking",
      conflictReason: null,
      message: null,
    };
    const promise = runner(this.options.sourceRoot)
      .then((result) => {
        const checkedAt = this.now().toISOString();
        if (
          preserveMatchingConflict &&
          previousStatus.phase === "conflict" &&
          result.phase === "available" &&
          previousStatus.remoteHead === result.remoteHead
        ) {
          this.status = {
            ...previousStatus,
            lastCheckedAt: checkedAt,
          };
          return this.getStatus();
        }

        this.status = {
          ...this.status,
          phase: result.phase,
          branch: result.branch,
          remoteHead: result.remoteHead,
          lastCheckedAt: checkedAt,
          lastUpdatedAt: result.updated ? checkedAt : this.status.lastUpdatedAt,
          conflictReason: result.conflictReason,
          message: result.message,
        };
        return this.getStatus();
      })
      .catch(() => {
        this.status = {
          ...this.status,
          phase: "error",
          lastCheckedAt: this.now().toISOString(),
          conflictReason: null,
          message:
            kind === "apply"
              ? "拉取远程版本失败，请检查 Git 上游分支、网络或凭证配置。"
              : "自动检查远程版本失败，请检查 Git 上游分支、网络或凭证配置。",
        };
        return this.getStatus();
      });
    this.inFlight = { kind, promise };

    try {
      return await promise;
    } finally {
      if (this.inFlight?.promise === promise) {
        this.inFlight = undefined;
      }
    }
  }
}
