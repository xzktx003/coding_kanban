import type { FollowupSubmit } from "@agent-orchestrator/shared";

import type { FeishuImageResource } from "./feishu-image-resource-service.js";
import { saveSessionAttachment } from "./session-attachments.js";

const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const IMAGE_EXTENSIONS = new Set(["jpg", "png", "webp"]);

export interface SessionCodexFeishuReplyInput {
  messageId: string;
  threadId: string;
  text: string;
  image?: FeishuImageResource;
}

interface SessionCodexFeishuReplyServiceOptions {
  readThread(threadId: string): Promise<any>;
  submit(input: FollowupSubmit): Promise<unknown>;
  attachmentRoot?: string;
}

export class SessionCodexFeishuReplyService {
  readonly #readThread: (threadId: string) => Promise<any>;
  readonly #submit: (input: FollowupSubmit) => Promise<unknown>;
  readonly #attachmentRoot?: string;

  constructor(options: SessionCodexFeishuReplyServiceOptions) {
    this.#readThread = options.readThread;
    this.#submit = options.submit;
    this.#attachmentRoot = options.attachmentRoot;
  }

  async send(input: SessionCodexFeishuReplyInput): Promise<void> {
    const messageId = validMessageId(input.messageId);
    const threadId = validThreadId(input.threadId);
    if (typeof input.text !== "string") throw targetUnavailable();

    await this.#assertTarget(threadId);
    const images = input.image
      ? [await this.#saveImage(messageId, input.image)]
      : [];
    await this.#submit({
      id: `feishu:${messageId}`,
      threadId,
      text: input.text,
      images,
      parameters: {},
      mode: "queue",
    });
  }

  async #assertTarget(threadId: string): Promise<void> {
    let result: any;
    try {
      result = await this.#readThread(threadId);
    } catch {
      throw targetUnavailable();
    }
    const thread = result?.thread;
    if (
      !thread ||
      thread.id !== threadId ||
      thread.parentThreadId ||
      thread.source?.subAgent ||
      thread.source?.subagent ||
      thread.archived === true ||
      thread.status?.type === "archived"
    ) {
      throw targetUnavailable();
    }
  }

  async #saveImage(
    messageId: string,
    image: FeishuImageResource,
  ): Promise<string> {
    if (!this.#attachmentRoot) throw targetUnavailable();
    if (
      !Buffer.isBuffer(image.image) ||
      !IMAGE_EXTENSIONS.has(image.imageExtension)
    ) {
      throw targetUnavailable();
    }
    return saveSessionAttachment(this.#attachmentRoot, {
      name: `${messageId}.${image.imageExtension}`,
      data: image.image.toString("base64"),
    });
  }
}

function validMessageId(value: string): string {
  if (typeof value !== "string" || !MESSAGE_ID_PATTERN.test(value)) {
    throw targetUnavailable();
  }
  return value;
}

function validThreadId(value: string): string {
  if (typeof value !== "string" || !THREAD_ID_PATTERN.test(value)) {
    throw targetUnavailable();
  }
  return value;
}

function targetUnavailable(): Error {
  return new Error("目标会话不可用");
}
