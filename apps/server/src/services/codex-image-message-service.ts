import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  formatWorkingDirectory,
  type SshTarget,
} from "@agent-orchestrator/shared";

import {
  buildInteractiveShellCommand,
  quoteForPosixShell,
} from "./runtime-compat.js";
import { buildSshArgs } from "./ssh-command.js";
import type { SftpService } from "./sftp-service.js";

const CODEX_THREAD_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const CODEX_IMAGE_COMMAND_TIMEOUT_MS = 30_000;
const CODEX_IMAGE_COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const REMOTE_IMAGE_DIRECTORY = "~/.cache/coding-kanban/codex-images";
export const CODEX_IMAGE_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

export type CodexImageExtension = "jpg" | "png" | "webp";

export interface CodexImageCommandOptions {
  cwd?: string;
}

export type CodexImageCommandRunner = (
  command: string,
  args: string[],
  options: CodexImageCommandOptions,
) => Promise<void>;

export type CodexImageCleanupScheduler = (
  callback: () => Promise<void>,
  delayMs: number,
) => void;

export interface CodexImageRemoteFileAccess {
  ensureDirectory(target: SshTarget, path: string): Promise<void>;
  resolveRemotePath(target: SshTarget, path: string): Promise<string>;
  writeFile(target: SshTarget, path: string, image: Buffer): Promise<void>;
  remove(target: SshTarget, path: string): Promise<void>;
}

export function createCodexImageRemoteFileAccess(
  sftpService: Pick<
    SftpService,
    "createWriteStream" | "ensureDirectory" | "remove" | "resolveRemotePath"
  >,
): CodexImageRemoteFileAccess {
  return {
    ensureDirectory: (target, path) =>
      sftpService.ensureDirectory(target, path),
    resolveRemotePath: (target, path) =>
      sftpService.resolveRemotePath(target, path),
    async writeFile(target, path, image) {
      const output = await sftpService.createWriteStream(target, path);
      await pipeline(Readable.from([image]), output);
    },
    remove: (target, path) => sftpService.remove(target, path),
  };
}

interface CodexImageMessageServiceOptions {
  createId?: () => string;
  remoteFileAccess?: CodexImageRemoteFileAccess;
  runCommand?: CodexImageCommandRunner;
  scheduleCleanup?: CodexImageCleanupScheduler;
  tempRoot?: string;
}

export interface SendCodexImageMessageInput {
  threadId: string;
  message: string;
  image: Buffer;
  imageExtension: CodexImageExtension;
  workingDirectory?: string;
  sshTarget?: SshTarget;
}

export class CodexImageMessageUnavailableError extends Error {}

function resolveLocalWorkingDirectory(
  workingDirectory: string | undefined,
): string | undefined {
  if (!workingDirectory) {
    return undefined;
  }
  if (workingDirectory === "~") {
    return homedir();
  }
  if (workingDirectory.startsWith("~/")) {
    return join(homedir(), workingDirectory.slice(2));
  }
  return isAbsolute(workingDirectory)
    ? workingDirectory
    : resolve(process.cwd(), workingDirectory);
}

function buildRemoteQueueCommand(input: {
  threadId: string;
  message: string;
  imagePath?: string;
  workingDirectory?: string;
}): string {
  const remoteMessage = /\r|\n/.test(input.message)
    ? `"$(printf %s ${quoteForPosixShell(Buffer.from(input.message, "utf8").toString("base64"))} | base64 -d)"`
    : quoteForPosixShell(input.message);
  const queueCommand = [
    "codex queue",
    `--thread ${quoteForPosixShell(input.threadId)}`,
    `--message ${remoteMessage}`,
    ...(input.imagePath ? [`-i ${quoteForPosixShell(input.imagePath)}`] : []),
  ].join(" ");

  return input.workingDirectory
    ? `cd ${formatWorkingDirectory(input.workingDirectory)} && ${queueCommand}`
    : queueCommand;
}

const defaultRunCommand: CodexImageCommandRunner = (command, args, options) =>
  new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        encoding: "utf8",
        maxBuffer: CODEX_IMAGE_COMMAND_MAX_BUFFER_BYTES,
        timeout: CODEX_IMAGE_COMMAND_TIMEOUT_MS,
      },
      (error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      },
    );
  });

const defaultScheduleCleanup: CodexImageCleanupScheduler = (
  callback,
  delayMs,
) => {
  const timer = setTimeout(() => {
    void callback().catch(() => {});
  }, delayMs);
  timer.unref();
};

function isUnsupportedQueueImageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not support image attachments/i.test(error.message)
  );
}

function buildFallbackImageMessage(message: string, imagePath: string): string {
  return [
    message,
    "",
    "[Kanban 图片附件]",
    "当前 Codex CLI 不支持通过 queue 直接附加图片。请先使用可用的图片查看工具读取以下本机文件，再结合图片回答：",
    imagePath,
  ].join("\n");
}

function buildLocalQueueArgs(input: {
  threadId: string;
  message: string;
  imagePath?: string;
}): string[] {
  return [
    "queue",
    "--thread",
    input.threadId,
    "--message",
    input.message,
    ...(input.imagePath ? ["-i", input.imagePath] : []),
  ];
}

function buildCapabilityKey(sshTarget: SshTarget | undefined): string {
  if (!sshTarget) {
    return "local";
  }
  return [sshTarget.username ?? "", sshTarget.host, sshTarget.port ?? 22].join(
    "@",
  );
}

function toUnavailableError(error: unknown): CodexImageMessageUnavailableError {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (/ENOENT|not found|command not found/i.test(detail)) {
    return new CodexImageMessageUnavailableError(
      "当前会话主机未找到 codex 命令，无法发送图片",
    );
  }
  return new CodexImageMessageUnavailableError(
    detail ? `Codex 图片发送失败：${detail}` : "Codex 图片发送失败",
  );
}

export class CodexImageMessageService {
  private readonly createId: () => string;
  private readonly remoteFileAccess?: CodexImageRemoteFileAccess;
  private readonly runCommand: CodexImageCommandRunner;
  private readonly scheduleCleanup: CodexImageCleanupScheduler;
  private readonly tempRoot: string;
  private readonly imageAttachmentSupportByTarget = new Map<string, boolean>();

  constructor(options: CodexImageMessageServiceOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.remoteFileAccess = options.remoteFileAccess;
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.scheduleCleanup = options.scheduleCleanup ?? defaultScheduleCleanup;
    this.tempRoot = options.tempRoot ?? tmpdir();
  }

  async send(input: SendCodexImageMessageInput): Promise<void> {
    if (!CODEX_THREAD_ID_PATTERN.test(input.threadId)) {
      throw new CodexImageMessageUnavailableError(
        "当前终端没有可用的 Codex 会话标识",
      );
    }

    try {
      if (input.sshTarget) {
        await this.sendRemote(input);
        return;
      }
      await this.sendLocal(input);
    } catch (error) {
      if (error instanceof CodexImageMessageUnavailableError) {
        throw error;
      }
      throw toUnavailableError(error);
    }
  }

  private async sendLocal(input: SendCodexImageMessageInput): Promise<void> {
    const tempDirectory = await mkdtemp(
      join(this.tempRoot, "coding-kanban-codex-image-"),
    );
    const imagePath = join(
      tempDirectory,
      `${this.createId()}.${input.imageExtension}`,
    );

    let cleanupDeferred = false;
    try {
      await writeFile(imagePath, input.image, { mode: 0o600 });
      const capabilityKey = buildCapabilityKey(undefined);
      const workingDirectory = resolveLocalWorkingDirectory(
        input.workingDirectory,
      );
      if (this.imageAttachmentSupportByTarget.get(capabilityKey) !== false) {
        try {
          await this.runCommand(
            "codex",
            buildLocalQueueArgs({
              threadId: input.threadId,
              message: input.message,
              imagePath,
            }),
            { cwd: workingDirectory },
          );
          this.imageAttachmentSupportByTarget.set(capabilityKey, true);
          return;
        } catch (error) {
          if (!isUnsupportedQueueImageError(error)) {
            throw error;
          }
          this.imageAttachmentSupportByTarget.set(capabilityKey, false);
        }
      }

      await this.runCommand(
        "codex",
        buildLocalQueueArgs({
          threadId: input.threadId,
          message: buildFallbackImageMessage(input.message, imagePath),
        }),
        { cwd: workingDirectory },
      );
      cleanupDeferred = true;
      this.scheduleCleanup(
        () => rm(tempDirectory, { force: true, recursive: true }),
        CODEX_IMAGE_FALLBACK_TTL_MS,
      );
    } finally {
      if (!cleanupDeferred) {
        await rm(tempDirectory, { force: true, recursive: true });
      }
    }
  }

  private async sendRemote(input: SendCodexImageMessageInput): Promise<void> {
    if (!input.sshTarget || !this.remoteFileAccess) {
      throw new CodexImageMessageUnavailableError(
        "远程会话暂时无法上传图片，请检查 SFTP 配置",
      );
    }

    await this.remoteFileAccess.ensureDirectory(
      input.sshTarget,
      REMOTE_IMAGE_DIRECTORY,
    );
    const remoteImagePath = await this.remoteFileAccess.resolveRemotePath(
      input.sshTarget,
      `${REMOTE_IMAGE_DIRECTORY}/${this.createId()}.${input.imageExtension}`,
    );
    let uploaded = false;
    let cleanupDeferred = false;

    try {
      await this.remoteFileAccess.writeFile(
        input.sshTarget,
        remoteImagePath,
        input.image,
      );
      uploaded = true;
      const capabilityKey = buildCapabilityKey(input.sshTarget);
      if (this.imageAttachmentSupportByTarget.get(capabilityKey) !== false) {
        const remoteCommand = buildInteractiveShellCommand(
          buildRemoteQueueCommand({
            threadId: input.threadId,
            message: input.message,
            imagePath: remoteImagePath,
            workingDirectory: input.workingDirectory,
          }),
        );
        try {
          await this.runRemoteQueueCommand(input.sshTarget, remoteCommand);
          this.imageAttachmentSupportByTarget.set(capabilityKey, true);
          return;
        } catch (error) {
          if (!isUnsupportedQueueImageError(error)) {
            throw error;
          }
          this.imageAttachmentSupportByTarget.set(capabilityKey, false);
        }
      }

      const fallbackCommand = buildInteractiveShellCommand(
        buildRemoteQueueCommand({
          threadId: input.threadId,
          message: buildFallbackImageMessage(input.message, remoteImagePath),
          workingDirectory: input.workingDirectory,
        }),
      );
      await this.runRemoteQueueCommand(input.sshTarget, fallbackCommand);
      cleanupDeferred = true;
      this.scheduleCleanup(
        () => this.remoteFileAccess!.remove(input.sshTarget!, remoteImagePath),
        CODEX_IMAGE_FALLBACK_TTL_MS,
      );
    } finally {
      if (uploaded && !cleanupDeferred) {
        await this.remoteFileAccess
          .remove(input.sshTarget, remoteImagePath)
          .catch(() => {});
      }
    }
  }

  private runRemoteQueueCommand(
    sshTarget: SshTarget,
    remoteCommand: string,
  ): Promise<void> {
    return this.runCommand(
      "ssh",
      buildSshArgs(sshTarget, {
        batchMode: true,
        connectTimeoutSeconds: 10,
        remoteCommand,
      }),
      {},
    );
  }
}
