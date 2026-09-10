import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,50}$/;
const MAX_TEXT_CHARACTERS = 8_000;
const MAX_OUTPUT_BUFFER_BYTES = 256 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

export interface FeishuControlDelivery {
  messageId: string;
  chatId: string;
}

interface CommandOptions {
  cwd?: string;
  encoding: "utf8";
  maxBuffer: number;
  timeout: number;
  windowsHide: true;
  env: NodeJS.ProcessEnv;
}

type CommandRunner = (
  binary: string,
  args: string[],
  options: CommandOptions,
) => Promise<{ stdout: string }>;

interface FeishuControlMessengerOptions {
  binary?: string;
  allowedUserId?: string;
  runCommand?: CommandRunner;
}

function runCommand(
  binary: string,
  args: string[],
  options: CommandOptions,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });
}

function assertAllowedUserId(userId: string, allowedUserId: string): void {
  if (
    !USER_ID_PATTERN.test(userId) ||
    !allowedUserId ||
    userId !== allowedUserId
  ) {
    throw new Error("Feishu control message delivery failed");
  }
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new Error("Feishu control message delivery failed");
  }
}

function normalizeDelivery(stdout: string): FeishuControlDelivery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Feishu control message delivery failed");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Feishu control message delivery failed");
  }

  const envelope = parsed as Record<string, unknown>;
  if (
    envelope.ok !== true ||
    !envelope.data ||
    typeof envelope.data !== "object"
  ) {
    throw new Error("Feishu control message delivery failed");
  }

  const data = envelope.data as Record<string, unknown>;
  const messageId = data.message_id ?? data.messageId;
  const chatId = data.chat_id ?? data.chatId;
  if (
    typeof messageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(messageId) ||
    typeof chatId !== "string" ||
    !CHAT_ID_PATTERN.test(chatId)
  ) {
    throw new Error("Feishu control message delivery failed");
  }

  return { messageId, chatId };
}

export class FeishuControlMessenger {
  readonly #binary: string;
  readonly #allowedUserId: string;
  readonly #runCommand: CommandRunner;

  constructor(options: FeishuControlMessengerOptions = {}) {
    this.#binary = options.binary ?? "lark-cli";
    this.#allowedUserId =
      options.allowedUserId && USER_ID_PATTERN.test(options.allowedUserId)
        ? options.allowedUserId
        : "";
    this.#runCommand = options.runCommand ?? runCommand;
  }

  async sendCard(
    userId: string,
    card: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<FeishuControlDelivery> {
    return this.#send(userId, "interactive", card, idempotencyKey);
  }

  async sendText(
    userId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (!text || Array.from(text).length > MAX_TEXT_CHARACTERS) {
      throw new Error("Feishu control message delivery failed");
    }
    await this.#send(userId, "text", { text }, idempotencyKey);
  }

  async sendFile(
    userId: string,
    name: string,
    data: Buffer,
    idempotencyKey: string,
  ): Promise<void> {
    assertAllowedUserId(userId, this.#allowedUserId);
    assertIdempotencyKey(idempotencyKey);
    if (
      !name ||
      /^[.\-]/u.test(name) ||
      /[/\\\u0000-\u001f\u007f]/u.test(name) ||
      Buffer.byteLength(name) > 200 ||
      data.length > 10 * 1024 * 1024
    ) {
      throw new Error("Feishu control message delivery failed");
    }
    const directory = await mkdtemp(
      path.join(tmpdir(), "kanban-feishu-export-"),
    );
    try {
      await writeFile(path.join(directory, name), data, {
        mode: 0o600,
        flag: "wx",
      });
      const { stdout } = await this.#runCommand(
        this.#binary,
        [
          "im",
          "+messages-send",
          "--as",
          "bot",
          "--format",
          "json",
          "--user-id",
          userId,
          "--file",
          `./${name}`,
          "--idempotency-key",
          idempotencyKey,
        ],
        {
          cwd: directory,
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
          timeout: COMMAND_TIMEOUT_MS,
          windowsHide: true,
          env: {
            ...process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
        },
      );
      normalizeDelivery(stdout);
    } catch {
      throw new Error("Feishu control message delivery failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async #send(
    userId: string,
    msgType: "interactive" | "text",
    content: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<FeishuControlDelivery> {
    assertAllowedUserId(userId, this.#allowedUserId);
    assertIdempotencyKey(idempotencyKey);

    try {
      const { stdout } = await this.#runCommand(
        this.#binary,
        [
          "im",
          "+messages-send",
          "--as",
          "bot",
          "--format",
          "json",
          "--user-id",
          userId,
          "--msg-type",
          msgType,
          "--content",
          JSON.stringify(content),
          "--idempotency-key",
          idempotencyKey,
        ],
        {
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BUFFER_BYTES,
          timeout: COMMAND_TIMEOUT_MS,
          windowsHide: true,
          env: {
            ...process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
        },
      );
      return normalizeDelivery(stdout);
    } catch {
      throw new Error("Feishu control message delivery failed");
    }
  }
}
