import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { LaunchSshPtyInput } from "@agent-orchestrator/shared";
import { formatWorkingDirectory, shellQuote } from "@agent-orchestrator/shared";

import { buildInteractiveShellCommand } from "./runtime-compat.js";
import { buildSshArgs } from "./ssh-command.js";

const execFileAsync = promisify(execFile);
const supportedAgentKinds = new Set(["shell", "copilot", "codex", "claude"]);

const markers = {
  directory: "REMOTE_PREFLIGHT_DIRECTORY_UNAVAILABLE",
  agent: "REMOTE_PREFLIGHT_AGENT_UNAVAILABLE",
  tmux: "REMOTE_PREFLIGHT_TMUX_UNAVAILABLE",
  ok: "REMOTE_PREFLIGHT_OK",
} as const;

export type RemoteLaunchPreflightErrorCode =
  | "REMOTE_DIRECTORY_UNAVAILABLE"
  | "REMOTE_AGENT_UNAVAILABLE"
  | "REMOTE_TMUX_UNAVAILABLE"
  | "REMOTE_PREFLIGHT_FAILED";

export class RemoteLaunchPreflightError extends Error {
  constructor(
    readonly code: RemoteLaunchPreflightErrorCode,
    message: string,
    readonly httpStatus: 400 | 502,
  ) {
    super(message);
    this.name = "RemoteLaunchPreflightError";
  }
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

type ExecSsh = (
  file: string,
  args: string[],
  options: {
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
  },
) => Promise<ExecResult>;

function markerFailure(marker: string, exitCode: number): string {
  return `{ printf '%s\\n' ${shellQuote(marker)}; exit ${exitCode}; }`;
}

export function buildRemoteLaunchPreflightScript(
  input: LaunchSshPtyInput,
): string {
  if (!supportedAgentKinds.has(input.agentKind)) {
    throw new Error(`Unsupported remote agent kind: ${input.agentKind}`);
  }

  const workingDirectory = input.workingDirectory?.trim() || "~/";
  const checks = [
    `cd ${formatWorkingDirectory(workingDirectory)} || ${markerFailure(markers.directory, 71)}`,
  ];

  if (input.agentKind !== "shell") {
    checks.push(
      `command -v ${shellQuote(input.agentKind)} >/dev/null 2>&1 || ${markerFailure(markers.agent, 72)}`,
    );
  }

  if (input.tmuxSessionName) {
    checks.push(
      `command -v 'tmux' >/dev/null 2>&1 || ${markerFailure(markers.tmux, 73)}`,
    );
  }

  checks.push(`printf '%s\\n' '${markers.ok}'`);
  return checks.join("; ");
}

export function buildRemoteLaunchPreflightCommand(
  input: LaunchSshPtyInput,
): string {
  return buildInteractiveShellCommand(buildRemoteLaunchPreflightScript(input));
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const candidate = error as { stdout?: unknown; stderr?: unknown };
  return [candidate.stdout, candidate.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function sanitizedFirstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim())
      .find(Boolean)
      ?.slice(0, 240) ?? "SSH 命令执行失败"
  );
}

function classifyFailure(
  input: LaunchSshPtyInput,
  error: unknown,
): RemoteLaunchPreflightError {
  const output = errorText(error);
  const workingDirectory = input.workingDirectory?.trim() || "~/";

  if (output.includes(markers.directory)) {
    return new RemoteLaunchPreflightError(
      "REMOTE_DIRECTORY_UNAVAILABLE",
      `远程目录不存在或无法访问：${workingDirectory}`,
      400,
    );
  }

  if (output.includes(markers.agent)) {
    return new RemoteLaunchPreflightError(
      "REMOTE_AGENT_UNAVAILABLE",
      `远程服务器未找到 ${input.agentKind}，请先安装或配置交互式 shell PATH`,
      400,
    );
  }

  if (output.includes(markers.tmux)) {
    return new RemoteLaunchPreflightError(
      "REMOTE_TMUX_UNAVAILABLE",
      "远程服务器未安装 tmux，无法使用 tmux 启动模式",
      400,
    );
  }

  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (errorCode === "ETIMEDOUT") {
    return new RemoteLaunchPreflightError(
      "REMOTE_PREFLIGHT_FAILED",
      "远程启动检查超时，请检查服务器连接和 shell 配置",
      502,
    );
  }

  return new RemoteLaunchPreflightError(
    "REMOTE_PREFLIGHT_FAILED",
    `远程启动检查失败：${sanitizedFirstLine(output)}`,
    502,
  );
}

export interface RemoteLaunchPreflightLike {
  check(input: LaunchSshPtyInput): Promise<void>;
}

export class RemoteLaunchPreflight implements RemoteLaunchPreflightLike {
  constructor(
    private readonly execSsh: ExecSsh = async (file, args, options) => {
      const result = await execFileAsync(file, args, options);
      return { stdout: result.stdout, stderr: result.stderr };
    },
  ) {}

  async check(input: LaunchSshPtyInput): Promise<void> {
    const remoteCommand = buildRemoteLaunchPreflightCommand(input);
    const args = buildSshArgs(input.sshTarget, {
      batchMode: true,
      connectTimeoutSeconds: 8,
      remoteCommand,
    });

    try {
      const result = await this.execSsh("ssh", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 12_000,
      });
      if (!result.stdout.includes(markers.ok)) {
        throw Object.assign(new Error("missing preflight marker"), result);
      }
    } catch (error) {
      if (error instanceof RemoteLaunchPreflightError) {
        throw error;
      }
      throw classifyFailure(input, error);
    }
  }
}
