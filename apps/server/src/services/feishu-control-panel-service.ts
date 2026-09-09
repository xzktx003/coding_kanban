import { createHash, randomUUID } from "node:crypto";

import {
  isCodexSessionCandidate,
  type AgentSessionRecord,
  type FeishuNotificationSettingsResponse,
  type ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

const MENU_EVENT_KEY = "kanban_codex_sessions";
const SUBMIT_ACTION_PREFIX = "kanban_submit_";
const MAX_PANEL_AGE_MS = 15 * 60 * 1_000;
const MAX_PANELS = 100;
const MAX_PROCESSED_EVENTS = 1_000;
const PAGE_SIZE = 50;
const MAX_PROMPT_CHARACTERS = 1_000;
const MAX_LABEL_CHARACTERS = 120;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface FeishuMenuEvent {
  type?: string;
  event_id?: string;
  event_key?: string;
  operator_id?: string;
}

export interface FeishuCardActionEvent {
  type?: string;
  event_id?: string;
  operator_id?: string;
  message_id?: string;
  chat_id?: string;
  action_tag?: string;
  action_name?: string;
  action_value?: string;
  form_value?: string;
}

export interface FeishuControlPanelCardInput {
  panelId: string;
  options: Array<{ value: string; label: string }>;
  truncated: boolean;
  page: number;
  pageCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export type FeishuControlPanelOutcome =
  | "panel_sent"
  | "delivered"
  | "ignored_disabled"
  | "ignored_untrusted"
  | "ignored_stale_panel"
  | "ignored_expired"
  | "ignored_duplicate"
  | "ignored_invalid_input"
  | "ignored_unavailable"
  | "ignored_changed_thread"
  | "delivery_uncertain";

interface FeishuControlPanelTarget {
  token: string;
  sessionId: string;
  threadId: string;
}

interface FeishuControlPanelBinding {
  panelId: string;
  operatorId: string;
  chatId: string;
  messageId: string;
  expiresAtMs: number;
  targets: Map<string, FeishuControlPanelTarget>;
  submitted?: boolean;
}

export interface FeishuControlPanelSendCardInput {
  userId?: string;
  chatId?: string;
  card: unknown;
  idempotencyKey: string;
}

export interface FeishuControlPanelServiceOptions {
  allowedUserId: string;
  now?: () => number;
  createId?: () => string;
  settings: { get(): FeishuNotificationSettingsResponse };
  registry: {
    list(): ListAgentSessionsResponse;
    get(sessionId: string): AgentSessionRecord;
  };
  codex: {
    resolveSessionId(session: AgentSessionRecord): Promise<string | undefined>;
    sendText(input: {
      threadId: string;
      message: string;
      workingDirectory?: string;
      sshTarget?: AgentSessionRecord["sshTarget"];
    }): Promise<void>;
  };
  cards: {
    buildControlPanelCard(input: FeishuControlPanelCardInput): unknown;
  };
  messenger: {
    sendCard(input: FeishuControlPanelSendCardInput): Promise<{
      messageId: string;
      chatId: string;
    }>;
    sendText(input: {
      chatId: string;
      text: string;
      idempotencyKey: string;
    }): Promise<void>;
  };
}

function isEnabled(settings: FeishuNotificationSettingsResponse): boolean {
  return (
    settings.replyConfigured &&
    settings.replyEnabled &&
    settings.destinationType === "user"
  );
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

function normalizePrompt(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  if (
    !normalized ||
    Array.from(normalized).length > MAX_PROMPT_CHARACTERS ||
    UNSAFE_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function parseJsonObject(input: string | undefined): Record<string, unknown> {
  if (!input) {
    return {};
  }
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildSessionLabel(session: AgentSessionRecord): string {
  const path =
    session.projectName ??
    session.repositoryRoot ??
    session.workingDirectory ??
    session.transportRef?.tmuxSession;
  const label = path
    ? `${session.displayName} [${session.id.slice(0, 8)}] · ${path}`
    : `${session.displayName} [${session.id.slice(0, 8)}]`;
  if (Array.from(label).length <= MAX_LABEL_CHARACTERS) {
    return label;
  }
  return `${Array.from(label)
    .slice(0, MAX_LABEL_CHARACTERS - 3)
    .join("")}...`;
}

function pageCountFor(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function buildIdempotencyKey(value: string): string {
  return `kc:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export class FeishuControlPanelService {
  readonly #allowedUserId: string;
  readonly #settings: FeishuControlPanelServiceOptions["settings"];
  readonly #registry: FeishuControlPanelServiceOptions["registry"];
  readonly #codex: FeishuControlPanelServiceOptions["codex"];
  readonly #cards: FeishuControlPanelServiceOptions["cards"];
  readonly #messenger: FeishuControlPanelServiceOptions["messenger"];
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #panels = new Map<string, FeishuControlPanelBinding>();
  readonly #inFlightEventIds = new Set<string>();
  readonly #processedEventIds = new Set<string>();
  readonly #processedEventOrder: string[] = [];

  constructor(options: FeishuControlPanelServiceOptions) {
    this.#allowedUserId = USER_ID_PATTERN.test(options.allowedUserId)
      ? options.allowedUserId
      : "";
    this.#settings = options.settings;
    this.#registry = options.registry;
    this.#codex = options.codex;
    this.#cards = options.cards;
    this.#messenger = options.messenger;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  async handle(
    event: FeishuMenuEvent | FeishuCardActionEvent,
  ): Promise<FeishuControlPanelOutcome> {
    if (!isEnabled(this.#settings.get())) {
      return "ignored_disabled";
    }

    if (event.type === "application.bot.menu_v6") {
      return this.#handleMenu(event);
    }
    if (event.type === "card.action.trigger") {
      return this.#handleCardAction(event);
    }
    return "ignored_untrusted";
  }

  async #handleMenu(
    event: FeishuMenuEvent,
  ): Promise<FeishuControlPanelOutcome> {
    if (
      !this.#allowedUserId ||
      typeof event.event_id !== "string" ||
      event.event_key !== MENU_EVENT_KEY ||
      event.operator_id !== this.#allowedUserId
    ) {
      return "ignored_untrusted";
    }
    if (this.#isDuplicateEvent(event.event_id)) {
      return "ignored_duplicate";
    }
    this.#inFlightEventIds.add(event.event_id);
    try {
      const outcome = await this.#sendPanel({
        operatorId: event.operator_id,
        userId: event.operator_id,
        page: 1,
        idempotencyKey: buildIdempotencyKey(event.event_id),
      });
      this.#rememberProcessedEvent(event.event_id);
      return outcome;
    } finally {
      this.#inFlightEventIds.delete(event.event_id);
    }
  }

  async #handleCardAction(
    event: FeishuCardActionEvent,
  ): Promise<FeishuControlPanelOutcome> {
    const eventId = event.event_id;
    const chatId = event.chat_id;
    const messageId = event.message_id;
    if (
      !this.#allowedUserId ||
      event.operator_id !== this.#allowedUserId ||
      event.action_tag !== "button" ||
      typeof eventId !== "string" ||
      typeof messageId !== "string" ||
      typeof chatId !== "string" ||
      !MESSAGE_ID_PATTERN.test(messageId) ||
      !CHAT_ID_PATTERN.test(chatId)
    ) {
      return "ignored_untrusted";
    }

    const actionValue = parseJsonObject(event.action_value);
    if (actionValue.action === "kanban_refresh") {
      const panel = this.#resolvePanel(event, actionValue.panelId);
      if (!panel) {
        return "ignored_stale_panel";
      }
      if (this.#isExpired(panel)) {
        this.#panels.delete(panel.panelId);
        await this.#notify(chatId, "这个控制面板已过期，请重新打开。", eventId);
        return "ignored_expired";
      }
      return this.#sendNavigationPanel(eventId, {
        operatorId: event.operator_id,
        chatId,
        page: 1,
      });
    }

    if (actionValue.action === "kanban_page") {
      const panel = this.#resolvePanel(event, actionValue.panelId);
      if (!panel) {
        return "ignored_stale_panel";
      }
      if (this.#isExpired(panel)) {
        this.#panels.delete(panel.panelId);
        await this.#notify(chatId, "这个控制面板已过期，请重新打开。", eventId);
        return "ignored_expired";
      }
      const page =
        typeof actionValue.page === "number" &&
        Number.isSafeInteger(actionValue.page)
          ? actionValue.page
          : 1;
      return this.#sendNavigationPanel(eventId, {
        operatorId: event.operator_id,
        chatId,
        page,
      });
    }

    const panelId = this.#parseSubmitPanelId(event.action_name);
    if (!panelId) {
      return "ignored_untrusted";
    }
    if (
      this.#processedEventIds.has(eventId) ||
      this.#inFlightEventIds.has(eventId)
    ) {
      return "ignored_duplicate";
    }
    const panel = this.#resolvePanel(event, panelId);
    if (!panel || panel.submitted) {
      return "ignored_stale_panel";
    }
    if (this.#isExpired(panel)) {
      this.#panels.delete(panel.panelId);
      await this.#notify(chatId, "这个控制面板已过期，请重新打开。", eventId);
      return "ignored_expired";
    }
    const formValue = parseJsonObject(event.form_value);
    const targetToken =
      typeof formValue.target === "string" ? formValue.target : "";
    const target = panel.targets.get(targetToken);
    const prompt = normalizePrompt(formValue.prompt);
    if (!target || !prompt) {
      await this.#notify(chatId, "请选择一个 Codex 对话并填写指示。", eventId);
      return "ignored_invalid_input";
    }

    let session: AgentSessionRecord;
    try {
      session = this.#registry.get(target.sessionId);
    } catch {
      await this.#notify(chatId, "目标 Codex 对话已不可用。", eventId);
      return "ignored_unavailable";
    }
    if (!isAvailableCodexSession(session)) {
      await this.#notify(chatId, "目标 Codex 对话当前不可控。", eventId);
      return "ignored_unavailable";
    }

    this.#inFlightEventIds.add(eventId);
    this.#rememberProcessedEvent(eventId);
    // Consume the submit synchronously, but retain provenance so refresh still
    // works after sending. A second event cannot enter the queue await twice.
    panel.submitted = true;
    panel.targets.clear();
    try {
      const currentThreadId = await this.#codex.resolveSessionId(session);
      if (!currentThreadId) {
        await this.#notify(chatId, "目标 Codex 对话标识不可用。", eventId);
        return "ignored_unavailable";
      }
      if (!isEnabled(this.#settings.get())) {
        return "ignored_disabled";
      }
      let latestSession: AgentSessionRecord;
      try {
        latestSession = this.#registry.get(target.sessionId);
      } catch {
        await this.#notify(chatId, "目标 Codex 对话已不可用。", eventId);
        return "ignored_unavailable";
      }
      if (!isAvailableCodexSession(latestSession)) {
        await this.#notify(chatId, "目标 Codex 对话当前不可控。", eventId);
        return "ignored_unavailable";
      }
      if (currentThreadId !== target.threadId) {
        await this.#notify(
          chatId,
          "目标 Codex 对话已变化，请刷新后重试。",
          eventId,
        );
        return "ignored_changed_thread";
      }
      try {
        await this.#codex.sendText({
          threadId: currentThreadId,
          message: prompt,
          workingDirectory: latestSession.workingDirectory,
          sshTarget: latestSession.sshTarget,
        });
      } catch {
        await this.#notify(
          chatId,
          "提交结果不确定，请核实；不会自动重试。",
          eventId,
        );
        return "delivery_uncertain";
      }
      await this.#notify(
        chatId,
        `已发送到 ${latestSession.displayName}。`,
        eventId,
      );
      return "delivered";
    } finally {
      this.#inFlightEventIds.delete(eventId);
    }
  }

  async #sendPanel(input: {
    operatorId: string;
    userId?: string;
    chatId?: string;
    page: number;
    idempotencyKey: string;
  }): Promise<FeishuControlPanelOutcome> {
    const allSessions = this.#registry
      .list()
      .items.filter((session) => isAvailableCodexSession(session));
    const totalPages = pageCountFor(allSessions.length);
    const page = Math.min(Math.max(1, input.page), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pageTargets = await this.#collectTargets(
      allSessions.slice(start, start + PAGE_SIZE),
    );
    const panelId = this.#createId();
    const targets = new Map<string, FeishuControlPanelTarget>();
    const options = pageTargets.map((target) => {
      const token = this.#createId();
      const stored = { ...target, token };
      targets.set(token, stored);
      return {
        value: token,
        label: target.label,
      };
    });
    const card = this.#cards.buildControlPanelCard({
      panelId,
      options,
      truncated: totalPages > 1,
      page,
      pageCount: totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    });
    const sent = await this.#messenger.sendCard({
      userId: input.userId,
      chatId: input.chatId,
      card,
      idempotencyKey: input.idempotencyKey,
    });
    this.#rememberPanel({
      panelId,
      operatorId: input.operatorId,
      chatId: sent.chatId,
      messageId: sent.messageId,
      expiresAtMs: this.#now() + MAX_PANEL_AGE_MS,
      targets,
    });
    return "panel_sent";
  }

  async #sendNavigationPanel(
    eventId: string,
    input: {
      operatorId: string;
      chatId: string;
      page: number;
    },
  ): Promise<FeishuControlPanelOutcome> {
    if (this.#isDuplicateEvent(eventId)) {
      return "ignored_duplicate";
    }
    this.#inFlightEventIds.add(eventId);
    try {
      const outcome = await this.#sendPanel({
        ...input,
        idempotencyKey: buildIdempotencyKey(eventId),
      });
      this.#rememberProcessedEvent(eventId);
      return outcome;
    } finally {
      this.#inFlightEventIds.delete(eventId);
    }
  }

  async #collectTargets(
    sessions: AgentSessionRecord[],
  ): Promise<Array<{ sessionId: string; threadId: string; label: string }>> {
    const targets: Array<{
      sessionId: string;
      threadId: string;
      label: string;
    }> = [];
    for (const session of sessions) {
      const threadId = await this.#codex.resolveSessionId(session);
      if (!threadId) {
        continue;
      }
      targets.push({
        sessionId: session.id,
        threadId,
        label: buildSessionLabel(session),
      });
    }
    return targets;
  }

  #resolvePanel(
    event: FeishuCardActionEvent,
    panelId: unknown,
  ): FeishuControlPanelBinding | null {
    if (typeof panelId !== "string") {
      return null;
    }
    const panel = this.#panels.get(panelId);
    if (
      !panel ||
      panel.operatorId !== event.operator_id ||
      panel.messageId !== event.message_id ||
      panel.chatId !== event.chat_id
    ) {
      return null;
    }
    return panel;
  }

  #rememberPanel(panel: FeishuControlPanelBinding): void {
    this.#purgeExpired();
    this.#panels.set(panel.panelId, panel);
    while (this.#panels.size > MAX_PANELS) {
      const oldestPanelId = this.#panels.keys().next().value as
        | string
        | undefined;
      if (!oldestPanelId) {
        break;
      }
      this.#panels.delete(oldestPanelId);
    }
  }

  #parseSubmitPanelId(actionName: string | undefined): string | null {
    if (!actionName?.startsWith(SUBMIT_ACTION_PREFIX)) {
      return null;
    }
    return actionName.slice(SUBMIT_ACTION_PREFIX.length) || null;
  }

  #isExpired(panel: FeishuControlPanelBinding): boolean {
    return this.#now() > panel.expiresAtMs;
  }

  #isDuplicateEvent(eventId: string): boolean {
    return (
      this.#processedEventIds.has(eventId) ||
      this.#inFlightEventIds.has(eventId)
    );
  }

  #rememberProcessedEvent(eventId: string): void {
    if (this.#processedEventIds.has(eventId)) {
      return;
    }
    this.#processedEventIds.add(eventId);
    this.#processedEventOrder.push(eventId);
    while (this.#processedEventOrder.length > MAX_PROCESSED_EVENTS) {
      const oldestEventId = this.#processedEventOrder.shift();
      if (oldestEventId) {
        this.#processedEventIds.delete(oldestEventId);
      }
    }
  }

  async #notify(chatId: string, text: string, eventId: string): Promise<void> {
    try {
      await this.#messenger.sendText({
        chatId,
        text,
        idempotencyKey: buildIdempotencyKey(`reply:${eventId}:${text}`),
      });
    } catch {
      // Control delivery must not fail just because the acknowledgement failed.
    }
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [panelId, panel] of this.#panels) {
      if (now > panel.expiresAtMs) {
        this.#panels.delete(panelId);
      }
    }
  }
}
