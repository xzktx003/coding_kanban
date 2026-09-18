import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectCodexImageExtension,
  MAX_CODEX_IMAGE_BYTES,
  type CodexImageExtension,
} from "./codex-image-message-service.js";

const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const IMAGE_KEY_PATTERN = /^img_[A-Za-z0-9_-]{8,256}$/;
const RENDERED_IMAGE_PATTERN = /^!\[Image\]\((img_[A-Za-z0-9_-]{8,256})\)$/;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

export const DEFAULT_FEISHU_IMAGE_PROMPT = "请查看这张从飞书回复发送的图片。";

export interface FeishuImageResource {
  image: Buffer;
  imageExtension: CodexImageExtension;
}

export interface DownloadFeishuImageInput {
  messageId: string;
  imageKey: string;
}

export type FeishuImageDownloadRunner = (
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<void>;

interface FeishuImageResourceServiceOptions {
  maxBytes?: number;
  runCommand?: FeishuImageDownloadRunner;
  tempRoot?: string;
}

export class FeishuImageResourceUnavailableError extends Error {}

export function extractFeishuImageKey(content: string): string | null {
  return RENDERED_IMAGE_PATTERN.exec(content.trim())?.[1] ?? null;
}

const defaultRunCommand: FeishuImageDownloadRunner = (args, options) =>
  new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(
      "lark-cli",
      args,
      {
        env: options.env,
        encoding: "utf8",
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        timeout: DOWNLOAD_TIMEOUT_MS,
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

export class FeishuImageResourceService {
  readonly #maxBytes: number;
  readonly #runCommand: FeishuImageDownloadRunner;
  readonly #tempRoot: string;

  constructor(options: FeishuImageResourceServiceOptions = {}) {
    this.#maxBytes = options.maxBytes ?? MAX_CODEX_IMAGE_BYTES;
    this.#runCommand = options.runCommand ?? defaultRunCommand;
    this.#tempRoot = options.tempRoot ?? tmpdir();
  }

  async download(
    input: DownloadFeishuImageInput,
  ): Promise<FeishuImageResource> {
    if (
      !MESSAGE_ID_PATTERN.test(input.messageId) ||
      !IMAGE_KEY_PATTERN.test(input.imageKey)
    ) {
      throw new FeishuImageResourceUnavailableError("飞书图片标识无效");
    }

    const tempDirectory = await mkdtemp(
      join(this.#tempRoot, "coding-kanban-feishu-image-"),
    );
    const outputPath = join(tempDirectory, "image.bin");

    try {
      await this.#runCommand(
        [
          "im",
          "+messages-resources-download",
          "--message-id",
          input.messageId,
          "--file-key",
          input.imageKey,
          "--type",
          "image",
          "--output",
          outputPath,
          "--as",
          "bot",
          "--format",
          "json",
        ],
        {
          env: {
            ...process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
        },
      );

      const metadata = await stat(outputPath);
      if (!metadata.isFile() || metadata.size <= 0) {
        throw new FeishuImageResourceUnavailableError("飞书图片内容为空");
      }
      if (metadata.size > this.#maxBytes) {
        throw new FeishuImageResourceUnavailableError("飞书图片不能超过 10 MB");
      }

      const image = await readFile(outputPath);
      const imageExtension = detectCodexImageExtension(image);
      if (!imageExtension) {
        throw new FeishuImageResourceUnavailableError(
          "飞书图片仅支持真实的 PNG、JPEG 或 WebP",
        );
      }
      return { image, imageExtension };
    } catch (error) {
      if (error instanceof FeishuImageResourceUnavailableError) {
        throw error;
      }
      throw new FeishuImageResourceUnavailableError(
        "飞书图片下载失败，请确认机器人已开通 im:message:readonly 权限",
      );
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  }
}
