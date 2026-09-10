import {
  isCodexSessionCandidate,
  type AgentSessionRecord,
  type FeishuNotificationSettingsResponse,
} from "@agent-orchestrator/shared";

import type { FeishuReplyBinding } from "./feishu-reply-binding-store.js";
import type { CodexImageMessageService } from "./codex-image-message-service.js";

const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const MAX_PROMPT_CHARACTERS = 8_000;
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface FeishuInboundMessageEvent {
  type?: string;
  message_id?: string;
  reply_to?: string;
  root_id?: string;
  chat_id?: string;
  chat_type?: string;
  sender_id?: string;
  sender_type?: string;
  message_type?: string;
  content?: string;
}

export type FeishuReplyCommandOutcome =
  | "delivered"
  | "ignored_disabled"
  | "ignored_untrusted"
  | "ignored_unbound"
  | "ignored_duplicate"
  | "ignored_invalid_text"
  | "ignored_unavailable";

interface FeishuReplyCommandServiceOptions {
  allowedUserId: string;
  settings: { get(): FeishuNotificationSettingsResponse };
  bindings: {
    resolve(messageId: string): FeishuReplyBinding | null;
    hasProcessed(messageId: string): boolean;
    recordProcessedReply(input: {
      messageId: string;
      parent: FeishuReplyBinding;
      codexThreadId: string;
    }): void;
  };
  registry: { get(sessionId: string): AgentSessionRecord };
  codex: {
    resolveSessionId(session: AgentSessionRecord): Promise<string | undefined>;
    sendText: CodexImageMessageService["sendText"];
  };
}

function normalizePrompt(content: string): string | null {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (
    !normalized ||
    Array.from(normalized).length > MAX_PROMPT_CHARACTERS ||
    UNSAFE_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isAvailableCodexSession(session: AgentSessionRecord): boolean {
  return (
    isCodexSessionCandidate(session) &&
    session.connectionState === "online" &&
    session.interactionState !== "exited" &&
    session.interactionState !== "detached" &&
    session.controlMode !== "observe" &&
    (!session.hostId ||
      session.hostId === "local" ||
      Boolean(session.sshTarget))
  );
}

export class FeishuReplyCommandService {
  readonly #allowedUserId: string;
  readonly #settings: FeishuReplyCommandServiceOptions["settings"];
  readonly #bindings: FeishuReplyCommandServiceOptions["bindings"];
  readonly #registry: FeishuReplyCommandServiceOptions["registry"];
  readonly #codex: FeishuReplyCommandServiceOptions["codex"];
  readonly #inFlightMessageIds = new Set<string>();

  constructor(options: FeishuReplyCommandServiceOptions) {
    this.#allowedUserId = USER_ID_PATTERN.test(options.allowedUserId)
      ? options.allowedUserId
      : "";
    this.#settings = options.settings;
    this.#bindings = options.bindings;
    this.#registry = options.registry;
    this.#codex = options.codex;
  }

  async handle(
    event: FeishuInboundMessageEvent,
  ): Promise<FeishuReplyCommandOutcome> {
    const settings = this.#settings.get();
    if (
      !settings.replyConfigured ||
      !settings.replyEnabled ||
      settings.destinationType !== "user"
    ) {
      return "ignored_disabled";
    }

    if (
      !this.#allowedUserId ||
      event.type !== "im.message.receive_v1" ||
      event.chat_type !== "p2p" ||
      event.sender_type !== "user" ||
      event.sender_id !== this.#allowedUserId ||
      (event.message_type !== "text" && event.message_type !== "post") ||
      typeof event.message_id !== "string" ||
      !MESSAGE_ID_PATTERN.test(event.message_id) ||
      typeof event.reply_to !== "string" ||
      !MESSAGE_ID_PATTERN.test(event.reply_to)
    ) {
      return "ignored_untrusted";
    }

    let binding = this.#bindings.resolve(event.reply_to);
    if (
      (!binding || binding.chatId !== event.chat_id) &&
      typeof event.root_id === "string" &&
      MESSAGE_ID_PATTERN.test(event.root_id)
    ) {
      binding = this.#bindings.resolve(event.root_id);
    }
    if (!binding || binding.chatId !== event.chat_id) {
      return "ignored_unbound";
    }
    if (
      this.#bindings.hasProcessed(event.message_id) ||
      this.#inFlightMessageIds.has(event.message_id)
    ) {
      return "ignored_duplicate";
    }

    const prompt =
      typeof event.content === "string" ? normalizePrompt(event.content) : null;
    if (!prompt) {
      return "ignored_invalid_text";
    }

    let session: AgentSessionRecord;
    try {
      session = this.#registry.get(binding.sessionId);
    } catch {
      return "ignored_unavailable";
    }
    if (!isAvailableCodexSession(session)) {
      return "ignored_unavailable";
    }

    this.#inFlightMessageIds.add(event.message_id);
    try {
      const threadId = await this.#codex.resolveSessionId(session);
      if (
        !threadId ||
        !isAvailableCodexSession(this.#registry.get(binding.sessionId))
      ) {
        return "ignored_unavailable";
      }
      // The native queue acknowledges receipt without relying on TUI paste,
      // focus, Enter timing, or an idle composer. Busy threads keep the message.
      await this.#codex.sendText({
        threadId,
        message: prompt,
        workingDirectory: session.workingDirectory,
        sshTarget: session.sshTarget,
      });
      this.#bindings.recordProcessedReply({
        messageId: event.message_id,
        parent: binding,
        codexThreadId: threadId,
      });
      return "delivered";
    } finally {
      this.#inFlightMessageIds.delete(event.message_id);
    }
  }
}
