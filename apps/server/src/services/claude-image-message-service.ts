import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { SshTarget } from "@agent-orchestrator/shared";

import { buildSshArgs } from "./ssh-command.js";

const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAUDE_IMAGE_COMMAND_TIMEOUT_MS = 180_000;
const CLAUDE_IMAGE_OUTPUT_LIMIT_BYTES = 1024 * 1024;

const MEDIA_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type ClaudeImageExtension = keyof typeof MEDIA_TYPES;

export interface ClaudeImageCommandOptions {
  cwd?: string;
  stdin?: string;
  onStdout?: (chunk: string) => Promise<void> | void;
}

export type ClaudeImageCommandRunner = (
  command: string,
  args: string[],
  options: ClaudeImageCommandOptions,
) => Promise<number>;

interface ClaudeImageMessageServiceOptions {
  createId?: () => string;
  runCommand?: ClaudeImageCommandRunner;
  tempRoot?: string;
}

export interface SendClaudeImageMessageInput {
  sessionId: string;
  message: string;
  image: Buffer;
  imageExtension: ClaudeImageExtension;
  workingDirectory?: string;
  sshTarget?: SshTarget;
}

export class ClaudeImageMessageUnavailableError extends Error {}

interface ClaudeResultRecord {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
}

function resolveWorkingDirectory(
  workingDirectory: string | undefined,
): string | undefined {
  if (!workingDirectory) return undefined;
  if (workingDirectory === "~") return homedir();
  if (workingDirectory.startsWith("~/")) {
    return join(homedir(), workingDirectory.slice(2));
  }
  return isAbsolute(workingDirectory)
    ? workingDirectory
    : resolve(process.cwd(), workingDirectory);
}

export function buildClaudeResumeArgs(input: {
  sessionId: string;
  message: string;
}): string[] {
  return [
    "-p",
    input.message,
    "--resume",
    input.sessionId,
    "--permission-mode",
    "bypassPermissions",
    "--dangerously-skip-permissions",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

function buildStreamPayload(input: SendClaudeImageMessageInput): string {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: MEDIA_TYPES[input.imageExtension],
            data: input.image.toString("base64"),
          },
        },
        { type: "text", text: input.message },
      ],
    },
  })}\n`;
}

function describeClaudeResult(result: string): string {
  if (/too small|dimensions/i.test(result)) {
    return "图片尺寸太小，宽和高都需要至少 8 像素";
  }
  const detail = result.replace(/\s+/g, " ").trim().slice(0, 300);
  return detail ? `Claude 图片发送失败：${detail}` : "Claude 图片发送失败";
}

function parseResultLine(line: string): ClaudeResultRecord | null {
  try {
    const record = JSON.parse(line) as ClaudeResultRecord;
    return record.type === "result" ? record : null;
  } catch {
    return null;
  }
}

const defaultRunCommand: ClaudeImageCommandRunner = (command, args, options) =>
  new Promise<number>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => rejectPromise(new Error("Claude 图片发送超时")));
    }, CLAUDE_IMAGE_COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      void Promise.resolve(options.onStdout?.(chunk.toString("utf8"))).catch(
        (error: unknown) => {
          child.kill("SIGTERM");
          finish(() => rejectPromise(error));
        },
      );
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.length > CLAUDE_IMAGE_OUTPUT_LIMIT_BYTES) {
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("close", (code) => finish(() => resolvePromise(code ?? 1)));
    child.stdin?.end(options.stdin ?? "");
  });

function toUnavailableError(error: unknown): ClaudeImageMessageUnavailableError {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (/ENOENT|not found|command not found/i.test(detail)) {
    return new ClaudeImageMessageUnavailableError(
      "当前会话主机未找到 claude 命令，无法发送图片",
    );
  }
  return new ClaudeImageMessageUnavailableError(
    detail ? `Claude 图片发送失败：${detail}` : "Claude 图片发送失败",
  );
}

export class ClaudeImageMessageService {
  private readonly createId: () => string;
  private readonly runCommand: ClaudeImageCommandRunner;
  private readonly tempRoot: string;

  constructor(options: ClaudeImageMessageServiceOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.tempRoot = options.tempRoot ?? tmpdir();
  }

  async send(input: SendClaudeImageMessageInput): Promise<void> {
    if (!CLAUDE_SESSION_ID_PATTERN.test(input.sessionId)) {
      throw new ClaudeImageMessageUnavailableError(
        "当前终端没有可用的 Claude 会话标识",
      );
    }
    if (input.sshTarget) {
      throw new ClaudeImageMessageUnavailableError(
        "远程 Claude 会话暂不支持发送图片",
      );
    }

    const tempDirectory = await mkdtemp(
      join(this.tempRoot, "coding-kanban-claude-image-"),
    );
    const payloadPath = join(tempDirectory, `${this.createId()}.jsonl`);
    let resultError: string | null = null;
    let buffer = "";

    try {
      const payload = buildStreamPayload(input);
      await writeFile(payloadPath, payload, { mode: 0o600 });
      const consume = (chunk: string) => {
        buffer = `${buffer}${chunk}`.slice(-CLAUDE_IMAGE_OUTPUT_LIMIT_BYTES);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const record = parseResultLine(line);
          if (record?.is_error === true) {
            resultError = describeClaudeResult(
              typeof record.result === "string" ? record.result : "",
            );
          }
        }
      };

      const exitCode = await this.runCommand(
        "claude",
        buildClaudeResumeArgs(input),
        {
          cwd: resolveWorkingDirectory(input.workingDirectory),
          stdin: payload,
          onStdout: consume,
        },
      );
      consume("\n");
      if (resultError) {
        throw new ClaudeImageMessageUnavailableError(resultError);
      }
      if (exitCode !== 0) {
        throw new ClaudeImageMessageUnavailableError("Claude 图片发送失败");
      }
    } catch (error) {
      if (error instanceof ClaudeImageMessageUnavailableError) throw error;
      throw toUnavailableError(error);
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  }
}
