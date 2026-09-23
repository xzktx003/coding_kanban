import { createHash, randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

import {
  isCodexSessionCandidate,
  type AgentSessionRecord,
  type FeishuNotificationSettingsResponse,
  type ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";
import type { FeishuReplyBindingStore } from "./feishu-reply-binding-store.js";
import type {
  FeishuQuickReply,
  FeishuQuickReplyCatalog,
} from "./feishu-quick-reply-store.js";

const CONTROL_MENU_EVENT_KEY = "kanban_codex_sessions";
const OVERVIEW_MENU_EVENT_KEY = "kanban_task_overview";
const QUICK_REPLIES_MENU_EVENT_KEY = "kanban_quick_replies";
const SUBMIT_ACTION_PREFIX = "kanban_submit_";
const MAX_PANEL_AGE_MS = 15 * 60 * 1_000;
const MAX_PANELS = 100;
const MAX_PROCESSED_EVENTS = 1_000;
const CONTROL_PAGE_SIZE = 50;
const OVERVIEW_PAGE_SIZE = 10;
const MAX_PROMPT_CHARACTERS = 1_000;
const MAX_LABEL_CHARACTERS = 120;
const MAX_SUMMARY_CHARACTERS = 300;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

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
  option?: string;
  token?: string;
  action_value?: string | Record<string, unknown>;
  form_value?: string | Record<string, unknown>;
}

export interface FeishuControlPanelCardInput {
  workspaceEnabled?: boolean;
  controlEnabled?: boolean;
  quickRepliesEnabled?: boolean;
  quickReplies?: {
    options: Array<{ value: string; label: string }>;
    message?: string;
    boundTargetLabel?: string;
    editor?: { label: string; text: string };
  };
  panelId: string;
  options: Array<{ value: string; label: string }>;
  truncated: boolean;
  page: number;
  pageCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  overview?: {
    updatedAt: string;
    total: number;
    running: number;
    awaitingInput: number;
    idle: number;
    unavailable: number;
    entries: Array<{ label: string; status: string; summary: string }>;
  };
}

export type FeishuControlPanelOutcome =
  | "workspace_opened"
  | "panel_sent"
  | "panel_updated"
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
  label: string;
  signature: string;
}

interface FeishuControlPanelBinding {
  panelId: string;
  mode: "control" | "overview" | "quick_replies";
  operatorId: string;
  chatId: string;
  messageId: string;
  expiresAtMs: number;
  targets: Map<string, FeishuControlPanelTarget>;
  submitted?: boolean;
  quickReplies?: Map<string, FeishuQuickReply>;
  quickRepliesRevision?: string;
  boundTarget?: FeishuControlPanelTarget;
  editorReply?: FeishuQuickReply;
}

export interface FeishuControlPanelSendCardInput {
  userId?: string;
  chatId?: string;
  card: unknown;
  idempotencyKey: string;
}

export interface FeishuControlPanelServiceOptions {
  quickReplies?: { read(): FeishuQuickReplyCatalog };
  notificationBindings?: Pick<FeishuReplyBindingStore, "resolve">;
  workspace?: {
    open(input: {
      sessionId: string;
      threadId: string;
      operatorId: string;
      chatId: string;
    }): Promise<unknown>;
  };
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
    resolveSessionIds?(session: AgentSessionRecord): Promise<string[]>;
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
    updateCard?(input: {
      userId: string;
      token: string;
      card: unknown;
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

function isOverviewEnabled(
  settings: FeishuNotificationSettingsResponse,
): boolean {
  return (
    settings.replyConfigured &&
    settings.destinationType === "user" &&
    (settings.enabled || settings.replyEnabled)
  );
}

function isPanelEnabled(
  mode: FeishuControlPanelBinding["mode"],
  settings: FeishuNotificationSettingsResponse,
): boolean {
  return mode === "overview"
    ? isOverviewEnabled(settings)
    : isEnabled(settings);
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

function isAvailablePanelTarget(
  panel: FeishuControlPanelBinding,
  session: AgentSessionRecord,
): boolean {
  return (
    isAvailableCodexSession(session) &&
    (panel.mode === "control" || !session.hidden)
  );
}

function normalizePrompt(
  input: unknown,
  maxCharacters = MAX_PROMPT_CHARACTERS,
): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.replace(/\r\n?/g, "\n").trim();
  if (
    !normalized ||
    Array.from(normalized).length > maxCharacters ||
    UNSAFE_CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function targetSignature(session: AgentSessionRecord): string {
  return JSON.stringify([
    session.workingDirectory,
    session.hostId,
    session.sshTarget,
    session.transportRef,
  ]);
}

function hasUnfilledPlaceholders(
  reply: FeishuQuickReply,
  prompt: string,
): boolean {
  return (
    Boolean(reply.requiresEditing) &&
    [...reply.text.matchAll(/\[[^\]\r\n]{1,80}\](?!\()/gu)].some(
      ([placeholder]) => prompt.includes(placeholder),
    )
  );
}

function normalizeQuickReplyEditor(
  form: Record<string, unknown>,
  reply: FeishuQuickReply,
): string | null {
  // Feishu limits each input component to 1000 Unicode characters. Match the
  // fields rendered from the server-held template, never a client part count.
  const count = Math.max(1, Math.ceil(Array.from(reply.text).length / 1_000));
  const parts: string[] = [];
  for (let index = 0; index < count; index++) {
    const value = form[count === 1 ? "prompt" : `prompt_${index}`];
    if (typeof value !== "string" || Array.from(value).length > 1_000)
      return null;
    parts.push(value);
  }
  return normalizePrompt(parts.join(""), 8_000);
}

function sanitizeCardText(input: string): string {
  return stripVTControlCharacters(input)
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .trim();
}

function parseJsonObject(
  input: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input) {
    return {};
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  if (typeof input !== "string") {
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
  const label = sanitizeCardText(
    path
      ? `${session.displayName} [${session.id.slice(0, 8)}] · ${path}`
      : `${session.displayName} [${session.id.slice(0, 8)}]`,
  );
  return truncateUnicode(label, MAX_LABEL_CHARACTERS);
}

function truncateUnicode(input: string, maxCharacters: number): string {
  const characters = Array.from(input);
  if (characters.length <= maxCharacters) {
    return input;
  }
  return `${characters.slice(0, Math.max(0, maxCharacters - 3)).join("")}...`;
}

function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function buildIdempotencyKey(value: string): string {
  return `kc:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function isUnavailableForOverview(session: AgentSessionRecord): boolean {
  return (
    session.connectionState !== "online" ||
    session.interactionState === "exited" ||
    session.interactionState === "detached"
  );
}

function getOverviewStatus(session: AgentSessionRecord): string {
  let status: string;
  if (isUnavailableForOverview(session)) {
    status = "不可用";
  } else if (session.interactionState === "running") {
    status = "运行中";
  } else if (session.interactionState === "awaiting_input") {
    status = "等待输入";
  } else if (session.interactionState === "idle") {
    status = "空闲";
  } else {
    status = session.interactionState;
  }
  if (session.stateConfidence === "low") {
    status = `${status}（状态不确定）`;
  }
  const agentKind = session.agentKind.trim().toLowerCase();
  if (agentKind && agentKind !== "codex") {
    status = `${status} · ${truncateUnicode(sanitizeCardText(agentKind), 32)}`;
  }
  return status;
}

function buildOverviewSummary(session: AgentSessionRecord): string {
  const summary = sanitizeCardText(session.lastAgentMessageSummary ?? "");
  const raw = summary || sanitizeCardText(session.outputPreview ?? "");
  return truncateUnicode(raw, MAX_SUMMARY_CHARACTERS);
}

function buildOverview(
  sessions: AgentSessionRecord[],
  pageSessions: AgentSessionRecord[],
  updatedAt: string,
): FeishuControlPanelCardInput["overview"] {
  const visible = sessions.filter((session) => !session.hidden);
  return {
    updatedAt,
    total: visible.length,
    running: visible.filter(
      (session) =>
        !isUnavailableForOverview(session) &&
        session.interactionState === "running",
    ).length,
    awaitingInput: visible.filter(
      (session) =>
        !isUnavailableForOverview(session) &&
        session.interactionState === "awaiting_input",
    ).length,
    idle: visible.filter(
      (session) =>
        !isUnavailableForOverview(session) &&
        session.interactionState === "idle",
    ).length,
    unavailable: visible.filter(isUnavailableForOverview).length,
    entries: pageSessions.map((session) => ({
      label: buildSessionLabel(session),
      status: getOverviewStatus(session),
      summary: buildOverviewSummary(session),
    })),
  };
}

export class FeishuControlPanelService {
  readonly #quickReplies: FeishuControlPanelServiceOptions["quickReplies"];
  readonly #notificationBindings: FeishuControlPanelServiceOptions["notificationBindings"];
  readonly #workspace: FeishuControlPanelServiceOptions["workspace"];
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
  readonly #updatingPanels = new Set<string>();
  readonly #processedEventIds = new Set<string>();
  readonly #processedEventOrder: string[] = [];

  constructor(options: FeishuControlPanelServiceOptions) {
    this.#quickReplies = options.quickReplies;
    this.#notificationBindings = options.notificationBindings;
    this.#workspace = options.workspace;
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
    if (event.type === "application.bot.menu_v6") {
      const overview =
        (event as FeishuMenuEvent).event_key === OVERVIEW_MENU_EVENT_KEY;
      if (
        !isPanelEnabled(overview ? "overview" : "control", this.#settings.get())
      ) {
        return "ignored_disabled";
      }
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
      (event.event_key !== CONTROL_MENU_EVENT_KEY &&
        event.event_key !== OVERVIEW_MENU_EVENT_KEY &&
        event.event_key !== QUICK_REPLIES_MENU_EVENT_KEY) ||
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
        mode:
          event.event_key === OVERVIEW_MENU_EVENT_KEY
            ? "overview"
            : event.event_key === QUICK_REPLIES_MENU_EVENT_KEY
              ? "quick_replies"
              : "control",
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
      (event.action_tag !== "button" && event.action_tag !== "select_static") ||
      typeof eventId !== "string" ||
      typeof messageId !== "string" ||
      typeof chatId !== "string" ||
      !MESSAGE_ID_PATTERN.test(messageId) ||
      !CHAT_ID_PATTERN.test(chatId)
    ) {
      return "ignored_untrusted";
    }

    const actionValue = parseJsonObject(event.action_value);
    if (event.action_tag === "select_static") {
      return this.#handleQuickSelection(event, actionValue);
    }
    if (actionValue.action === "kanban_completion_quick_reply") {
      return this.#openCompletionQuickReplies(event);
    }
    if (actionValue.action === "kanban_quick_back") {
      return this.#handleQuickBack(event, actionValue);
    }
    if (
      actionValue.action === "kanban_refresh" ||
      actionValue.action === QUICK_REPLIES_MENU_EVENT_KEY
    ) {
      const panel = this.#resolvePanel(event, actionValue.panelId);
      if (!panel) {
        return "ignored_stale_panel";
      }
      if (!isPanelEnabled(panel.mode, this.#settings.get())) {
        return "ignored_disabled";
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
        mode:
          actionValue.action === QUICK_REPLIES_MENU_EVENT_KEY
            ? "quick_replies"
            : panel.mode,
        boundTarget: panel.boundTarget,
      });
    }

    if (actionValue.action === "kanban_page") {
      const panel = this.#resolvePanel(event, actionValue.panelId);
      if (!panel) {
        return "ignored_stale_panel";
      }
      if (!isPanelEnabled(panel.mode, this.#settings.get())) {
        return "ignored_disabled";
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
        mode: panel.mode,
        boundTarget: panel.boundTarget,
      });
    }

    const inspect = event.action_name?.startsWith("kanban_inspect_") === true;
    if (inspect && !this.#workspace) return "ignored_unavailable";
    const quickAction = /^kanban_quick_(send|edit|confirm)_(.+)$/.exec(
      event.action_name ?? "",
    );
    const panelId = quickAction
      ? quickAction[2]
      : inspect
        ? event.action_name!.slice("kanban_inspect_".length)
        : this.#parseSubmitPanelId(event.action_name);
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
    if (this.#updatingPanels.has(panelId)) return "ignored_duplicate";
    if (
      (panel.mode === "quick_replies") !== Boolean(quickAction) ||
      (quickAction &&
        Boolean(panel.editorReply) !== (quickAction[1] === "confirm"))
    ) {
      return "ignored_invalid_input";
    }
    if (quickAction && quickAction[1] !== "confirm") {
      // Cards sent before this interaction change still contain direct-send
      // buttons. They must not deliver a template without an editable preview.
      await this.#notify(
        chatId,
        "快捷回复面板已更新，请重新打开后选择模板预览。",
        eventId,
      );
      return "ignored_invalid_input";
    }
    if (!isEnabled(this.#settings.get())) {
      return "ignored_disabled";
    }
    if (this.#isExpired(panel)) {
      this.#panels.delete(panel.panelId);
      await this.#notify(chatId, "这个控制面板已过期，请重新打开。", eventId);
      return "ignored_expired";
    }
    const formValue = parseJsonObject(event.form_value);
    const selectedTarget = formValue.target;
    const targetToken =
      typeof selectedTarget === "string" ? selectedTarget : "";
    const target = panel.boundTarget ?? panel.targets.get(targetToken);
    const reply = quickAction ? panel.editorReply : undefined;
    const prompt = quickAction
      ? reply
        ? normalizeQuickReplyEditor(formValue, reply)
        : null
      : normalizePrompt(formValue.prompt);
    if (
      quickAction &&
      (!reply ||
        !prompt ||
        (quickAction[1] === "confirm" &&
          hasUnfilledPlaceholders(reply, prompt)))
    ) {
      await this.#notify(
        chatId,
        "请选择快捷回复，并补全模板占位符；每个编辑框最多 1000 字，总计最多 8000 字。",
        eventId,
      );
      return "ignored_invalid_input";
    }
    if (quickAction && !this.#isCurrentCatalog(panel)) {
      await this.#notify(
        chatId,
        "快捷回复内容已更新，请刷新面板后重新选择。",
        eventId,
      );
      return "ignored_stale_panel";
    }
    if (!target || (!inspect && !prompt)) {
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
    if (!isAvailablePanelTarget(panel, session)) {
      await this.#notify(chatId, "目标 Codex 对话当前不可控。", eventId);
      return "ignored_unavailable";
    }
    if (quickAction && target.signature !== targetSignature(session)) {
      await this.#notify(
        chatId,
        "目标 Codex 对话已变化，请刷新后重试。",
        eventId,
      );
      return "ignored_changed_thread";
    }

    this.#inFlightEventIds.add(eventId);
    this.#rememberProcessedEvent(eventId);
    // Consume the submit synchronously, but retain provenance so refresh still
    // works after sending. A second event cannot enter the queue await twice.
    if (!inspect) {
      panel.submitted = true;
      panel.targets.clear();
    }
    try {
      const currentThreadIds =
        panel.boundTarget && this.#codex.resolveSessionIds
          ? await this.#codex.resolveSessionIds(session)
          : [await this.#codex.resolveSessionId(session)].filter(
              (id): id is string => Boolean(id),
            );
      if (!currentThreadIds.length) {
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
      if (!isAvailablePanelTarget(panel, latestSession)) {
        await this.#notify(chatId, "目标 Codex 对话当前不可控。", eventId);
        return "ignored_unavailable";
      }
      if (
        !currentThreadIds.includes(target.threadId) ||
        (quickAction && target.signature !== targetSignature(latestSession))
      ) {
        await this.#notify(
          chatId,
          "目标 Codex 对话已变化，请刷新后重试。",
          eventId,
        );
        return "ignored_changed_thread";
      }
      if (quickAction && !this.#isCurrentCatalog(panel)) {
        await this.#notify(
          chatId,
          "快捷回复内容已更新，请刷新面板后重新选择。",
          eventId,
        );
        return "ignored_stale_panel";
      }
      if (inspect) {
        if (latestSession.hidden) return "ignored_unavailable";
        await this.#workspace!.open({
          sessionId: target.sessionId,
          threadId: target.threadId,
          operatorId: event.operator_id!,
          chatId,
        });
        return "workspace_opened";
      }
      try {
        await this.#codex.sendText({
          threadId: target.threadId,
          message: prompt!,
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

  async #handleQuickSelection(
    event: FeishuCardActionEvent,
    actionValue: Record<string, unknown>,
  ): Promise<FeishuControlPanelOutcome> {
    const selectingTarget =
      actionValue.action === "kanban_quick_target" &&
      (event.action_name === undefined || event.action_name === "target");
    const selectingReply =
      actionValue.action === "kanban_quick_preview" &&
      (event.action_name === undefined || event.action_name === "quickReply");
    if (!selectingTarget && !selectingReply) return "ignored_untrusted";
    const panel = this.#resolvePanel(event, actionValue.panelId);
    if (!panel || panel.mode !== "quick_replies" || panel.submitted) {
      return "ignored_stale_panel";
    }
    if (!isEnabled(this.#settings.get())) return "ignored_disabled";
    if (this.#isExpired(panel)) return "ignored_expired";
    if (
      this.#isDuplicateEvent(event.event_id!) ||
      this.#updatingPanels.has(panel.panelId)
    )
      return "ignored_duplicate";
    if (!this.#isCurrentCatalog(panel)) return "ignored_stale_panel";
    const option =
      event.option ??
      parseJsonObject(event.form_value)[
        selectingTarget ? "target" : "quickReply"
      ];
    if (typeof option !== "string") return "ignored_invalid_input";

    const target = selectingTarget
      ? panel.targets.get(option)
      : panel.boundTarget;
    const reply = selectingReply ? panel.quickReplies?.get(option) : undefined;
    if (
      !target ||
      (selectingTarget && panel.boundTarget) ||
      (selectingReply && (!reply || panel.editorReply))
    ) {
      return "ignored_invalid_input";
    }

    this.#inFlightEventIds.add(event.event_id!);
    this.#updatingPanels.add(panel.panelId);
    try {
      const unavailable = await this.#checkBoundTarget(target);
      if (unavailable) return unavailable;
      if (!isEnabled(this.#settings.get())) return "ignored_disabled";
      if (!this.#isCurrentCatalog(panel)) return "ignored_stale_panel";
      const updated = await this.#updateQuickPanel(event, panel, target, reply);
      if (updated !== "panel_updated") return updated;
      panel.boundTarget = target;
      if (reply) panel.editorReply = reply;
      this.#rememberProcessedEvent(event.event_id!);
      return "panel_updated";
    } finally {
      this.#updatingPanels.delete(panel.panelId);
      this.#inFlightEventIds.delete(event.event_id!);
    }
  }

  async #handleQuickBack(
    event: FeishuCardActionEvent,
    actionValue: Record<string, unknown>,
  ): Promise<FeishuControlPanelOutcome> {
    const panel = this.#resolvePanel(event, actionValue.panelId);
    if (
      !panel ||
      panel.mode !== "quick_replies" ||
      panel.submitted ||
      !panel.boundTarget ||
      !panel.editorReply
    )
      return "ignored_stale_panel";
    if (!isEnabled(this.#settings.get())) return "ignored_disabled";
    if (this.#isExpired(panel)) return "ignored_expired";
    if (
      this.#isDuplicateEvent(event.event_id!) ||
      this.#updatingPanels.has(panel.panelId)
    )
      return "ignored_duplicate";
    if (!this.#isCurrentCatalog(panel)) return "ignored_stale_panel";
    this.#inFlightEventIds.add(event.event_id!);
    this.#updatingPanels.add(panel.panelId);
    try {
      const unavailable = await this.#checkBoundTarget(panel.boundTarget);
      if (unavailable) return unavailable;
      const updated = await this.#updateQuickPanel(
        event,
        panel,
        panel.boundTarget,
      );
      if (updated !== "panel_updated") return updated;
      panel.editorReply = undefined;
      this.#rememberProcessedEvent(event.event_id!);
      return "panel_updated";
    } finally {
      this.#updatingPanels.delete(panel.panelId);
      this.#inFlightEventIds.delete(event.event_id!);
    }
  }

  async #updateQuickPanel(
    event: FeishuCardActionEvent,
    panel: FeishuControlPanelBinding,
    target: FeishuControlPanelTarget,
    editorReply?: FeishuQuickReply,
  ): Promise<FeishuControlPanelOutcome> {
    if (
      !this.#messenger.updateCard ||
      typeof event.token !== "string" ||
      event.token.length === 0 ||
      event.token.length > 4_096
    ) {
      return "ignored_unavailable";
    }
    const card = this.#cards.buildControlPanelCard({
      panelId: panel.panelId,
      options: [...panel.targets.values()].map((item) => ({
        value: item.token,
        label: item.label,
      })),
      truncated: false,
      page: 1,
      pageCount: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      quickReplies: {
        options: [...(panel.quickReplies ?? new Map())].map(
          ([token, reply]) => ({
            value: token,
            label: truncateUnicode(
              `${reply.category ? `${reply.category} · ` : ""}${reply.label}`,
              MAX_LABEL_CHARACTERS,
            ),
          }),
        ),
        boundTargetLabel: target.label,
        ...(editorReply
          ? { editor: { label: editorReply.label, text: editorReply.text } }
          : {}),
      },
    });
    try {
      await this.#messenger.updateCard({
        userId: this.#allowedUserId,
        token: event.token,
        card,
      });
      return "panel_updated";
    } catch {
      return "delivery_uncertain";
    }
  }

  #isCurrentCatalog(panel: FeishuControlPanelBinding): boolean {
    return (
      Boolean(this.#quickReplies) &&
      this.#quickReplies!.read().revision === panel.quickRepliesRevision
    );
  }

  async #openCompletionQuickReplies(
    event: FeishuCardActionEvent,
  ): Promise<FeishuControlPanelOutcome> {
    if (!isEnabled(this.#settings.get())) return "ignored_disabled";
    if (this.#isDuplicateEvent(event.event_id!)) return "ignored_duplicate";
    const binding = this.#notificationBindings?.resolve(event.message_id!);
    if (
      !binding ||
      binding.messageId !== event.message_id ||
      binding.chatId !== event.chat_id ||
      binding.transcriptAgentKind === "claude" ||
      !binding.codexThreadId
    ) {
      return "ignored_untrusted";
    }
    let session: AgentSessionRecord;
    try {
      session = this.#registry.get(binding.sessionId);
    } catch {
      return "ignored_unavailable";
    }
    if (!isAvailableCodexSession(session) || session.hidden)
      return "ignored_unavailable";
    return this.#sendNavigationPanel(event.event_id!, {
      operatorId: event.operator_id!,
      chatId: event.chat_id!,
      page: 1,
      mode: "quick_replies",
      boundTarget: {
        token: this.#createId(),
        sessionId: session.id,
        threadId: binding.codexThreadId,
        label: buildSessionLabel(session),
        signature: targetSignature(session),
      },
    });
  }

  async #checkBoundTarget(
    target: FeishuControlPanelTarget,
  ): Promise<FeishuControlPanelOutcome | null> {
    try {
      const session = this.#registry.get(target.sessionId);
      if (!isAvailableCodexSession(session) || session.hidden)
        return "ignored_unavailable";
      if (target.signature !== targetSignature(session))
        return "ignored_changed_thread";
      const ids = this.#codex.resolveSessionIds
        ? await this.#codex.resolveSessionIds(session)
        : [await this.#codex.resolveSessionId(session)];
      const latest = this.#registry.get(target.sessionId);
      if (!isAvailableCodexSession(latest) || latest.hidden)
        return "ignored_unavailable";
      if (
        !ids.includes(target.threadId) ||
        target.signature !== targetSignature(latest)
      ) {
        return "ignored_changed_thread";
      }
      return null;
    } catch {
      return "ignored_unavailable";
    }
  }

  async #sendPanel(input: {
    operatorId: string;
    userId?: string;
    chatId?: string;
    page: number;
    mode: FeishuControlPanelBinding["mode"];
    boundTarget?: FeishuControlPanelTarget;
    editorReply?: FeishuQuickReply;
    editorRevision?: string;
    idempotencyKey: string;
  }): Promise<FeishuControlPanelOutcome> {
    const initialSettings = this.#settings.get();
    if (!isPanelEnabled(input.mode, initialSettings)) {
      return "ignored_disabled";
    }
    const catalog =
      input.mode === "quick_replies"
        ? (this.#quickReplies?.read() ?? {
            items: [],
            revision: "",
            message: "尚未配置本地快捷回复文件。",
          })
        : undefined;
    if (input.editorReply && input.editorRevision !== catalog?.revision)
      return "ignored_stale_panel";
    if (input.boundTarget) {
      const unavailable = await this.#checkBoundTarget(input.boundTarget);
      if (unavailable) {
        if (input.chatId)
          await this.#notify(
            input.chatId,
            "原 Codex 对话已变化或不可用，请从新的完成通知打开。",
            input.idempotencyKey,
          );
        return unavailable;
      }
    }
    const snapshotTime = new Date(this.#now()).toISOString();
    const snapshot = this.#registry.list();
    const allSessions = input.boundTarget
      ? []
      : input.mode === "overview"
        ? snapshot.items.filter((session) => !session.hidden)
        : snapshot.items.filter(
            (session) =>
              isAvailableCodexSession(session) &&
              (input.mode !== "quick_replies" || !session.hidden),
          );
    const pageSize =
      input.mode === "overview" ? OVERVIEW_PAGE_SIZE : CONTROL_PAGE_SIZE;
    const totalPages = pageCountFor(allSessions.length, pageSize);
    const page = Math.min(Math.max(1, input.page), totalPages);
    const start = (page - 1) * pageSize;
    const pageSessions = allSessions.slice(start, start + pageSize);
    const controlEnabled = isEnabled(initialSettings);
    const pageTargets = input.boundTarget
      ? [input.boundTarget]
      : controlEnabled
        ? await this.#collectTargets(
            input.mode === "overview"
              ? pageSessions.filter((session) =>
                  isAvailableCodexSession(session),
                )
              : pageSessions,
            { tolerateResolveErrors: input.mode !== "control" },
          )
        : [];
    if (!isPanelEnabled(input.mode, this.#settings.get())) {
      return "ignored_disabled";
    }
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
    const quickReplies = new Map<string, FeishuQuickReply>();
    const quickOptions = (catalog?.items ?? []).map((reply) => {
      const token = this.#createId();
      quickReplies.set(token, { ...reply });
      return {
        value: token,
        label: truncateUnicode(
          `${reply.category ? `${reply.category} · ` : ""}${reply.label}`,
          MAX_LABEL_CHARACTERS,
        ),
      };
    });
    const card = this.#cards.buildControlPanelCard({
      ...(this.#workspace ? { workspaceEnabled: true } : {}),
      ...(this.#quickReplies ? { quickRepliesEnabled: true } : {}),
      ...(catalog
        ? {
            quickReplies: {
              options: quickOptions,
              message: catalog.message,
              boundTargetLabel: input.boundTarget?.label,
              editor: input.editorReply
                ? {
                    label: input.editorReply.label,
                    text: input.editorReply.text,
                  }
                : undefined,
            },
          }
        : {}),
      ...(input.mode === "overview" && !controlEnabled
        ? { controlEnabled: false }
        : {}),
      panelId,
      options,
      truncated: totalPages > 1,
      page,
      pageCount: totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
      ...(input.mode === "overview"
        ? {
            overview: buildOverview(snapshot.items, pageSessions, snapshotTime),
          }
        : {}),
    });
    const sent = await this.#messenger.sendCard({
      userId: input.userId,
      chatId: input.chatId,
      card,
      idempotencyKey: input.idempotencyKey,
    });
    this.#rememberPanel({
      panelId,
      mode: input.mode,
      operatorId: input.operatorId,
      chatId: sent.chatId,
      messageId: sent.messageId,
      expiresAtMs: this.#now() + MAX_PANEL_AGE_MS,
      targets,
      ...(catalog
        ? {
            quickReplies,
            quickRepliesRevision: catalog.revision,
            boundTarget: input.boundTarget,
            editorReply: input.editorReply,
          }
        : {}),
    });
    return "panel_sent";
  }

  async #sendNavigationPanel(
    eventId: string,
    input: {
      operatorId: string;
      chatId: string;
      page: number;
      mode: FeishuControlPanelBinding["mode"];
      boundTarget?: FeishuControlPanelTarget;
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
    options: { tolerateResolveErrors?: boolean } = {},
  ): Promise<Array<Omit<FeishuControlPanelTarget, "token">>> {
    const targets: Array<{
      sessionId: string;
      threadId: string;
      label: string;
      signature: string;
    }> = [];
    for (const session of sessions) {
      let threadId: string | undefined;
      try {
        threadId = await this.#codex.resolveSessionId(session);
      } catch (error) {
        if (!options.tolerateResolveErrors) {
          throw error;
        }
        continue;
      }
      if (!threadId) {
        continue;
      }
      targets.push({
        sessionId: session.id,
        threadId,
        label: buildSessionLabel(session),
        signature: targetSignature(session),
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
