import { createHash, randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

import {
  isCodexSessionCandidate,
  type AgentSessionRecord,
  type AgentTranscriptEntry,
  type AgentTranscriptResponse,
  type FeishuNotificationSettingsResponse,
} from "@agent-orchestrator/shared";

export interface FeishuWorkspaceCardActionEvent {
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

export type FeishuSessionWorkspaceOutcome =
  | "workspace_sent"
  | "records_sent"
  | "files_sent"
  | "file_sent"
  | "form_sent"
  | "write_confirm_sent"
  | "write_applied"
  | "export_sent"
  | "download_sent"
  | "ignored_disabled"
  | "ignored_untrusted"
  | "ignored_stale_workspace"
  | "ignored_expired"
  | "ignored_duplicate"
  | "ignored_invalid_input"
  | "ignored_unavailable"
  | "ignored_changed_thread"
  | "delivery_uncertain";

export interface FeishuWorkspaceFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

export interface FeishuSessionWorkspaceOptions {
  allowedUserId: string;
  now?: () => number;
  createId?: () => string;
  settings: { get(): FeishuNotificationSettingsResponse };
  registry: { get(sessionId: string): AgentSessionRecord };
  resolveSessionId(session: AgentSessionRecord): Promise<string | undefined>;
  files: {
    list(
      session: AgentSessionRecord,
      relativePath: string,
    ): Promise<{ entries: FeishuWorkspaceFileEntry[]; truncated: boolean }>;
    read(
      session: AgentSessionRecord,
      path: string,
    ): Promise<{ content: string; revision: string; editable: boolean }>;
    write(
      session: AgentSessionRecord,
      path: string,
      content: string,
      expectedRevision: string | null,
    ): Promise<void>;
    download(
      session: AgentSessionRecord,
      path: string,
    ): Promise<{ name: string; data: Buffer }>;
  };
  transcript(
    session: AgentSessionRecord,
    threadId: string,
    cursor?: string,
  ): Promise<AgentTranscriptResponse>;
  exportTranscript(
    session: AgentSessionRecord,
    threadId: string,
  ): Promise<{ name: string; data: Buffer }>;
  notificationBindings?: {
    resolve(messageId: string): {
      messageId: string;
      chatId: string;
      sessionId: string;
      codexThreadId?: string;
    } | null;
  };
  messenger: {
    sendCard(input: {
      userId?: string;
      chatId?: string;
      card: unknown;
      idempotencyKey: string;
    }): Promise<{ messageId: string; chatId: string }>;
    sendText(input: {
      chatId: string;
      text: string;
      idempotencyKey: string;
    }): Promise<void>;
    sendFile(input: {
      name: string;
      data: Buffer;
      idempotencyKey: string;
    }): Promise<void>;
  };
}

type WorkspaceAction =
  | { kind: "home" }
  | { kind: "records"; cursor?: string }
  | { kind: "records_export" }
  | { kind: "files"; path: string; page: number }
  | { kind: "file_view"; path: string }
  | { kind: "file_download"; path: string }
  | { kind: "file_edit_form"; path: string }
  | { kind: "file_new_form"; directory: string }
  | { kind: "file_edit_submit"; path: string; expectedRevision: string }
  | { kind: "file_new_submit"; directory: string }
  | {
      kind: "write_confirm";
      path: string;
      content: string;
      expectedRevision: string | null;
      cancelToken: string;
      consumed?: boolean;
    }
  | { kind: "write_cancel"; confirmToken?: string; consumed?: boolean };

type WorkspaceActionMap = Map<string, WorkspaceAction>;

interface WorkspaceBinding {
  panelId: string;
  operatorId: string;
  chatId: string;
  messageId: string;
  sessionId: string;
  threadId: string;
  signature: string;
  expiresAtMs: number;
  actions: WorkspaceActionMap;
}

const ACTION_PREFIX = "kanban_workspace_";
const FORM_PREFIX = "kanban_workspace_form_";
const COMPLETION_RECORDS_ACTION = "kanban_completion_records";
const MAX_WORKSPACE_AGE_MS = 15 * 60 * 1_000;
const MAX_WORKSPACES = 100;
const MAX_PROCESSED_EVENTS = 1_000;
const FILE_PAGE_SIZE = 10;
const MAX_CARD_TEXT_CHARACTERS = 700;
const MAX_FILE_PREVIEW_CHARACTERS = 1_000;
const MAX_FORM_CONTENT_CHARACTERS = 1_000;
const MAX_BASENAME_BYTES = 100;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const CODEX_THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

const plain = (content: string) => ({ tag: "plain_text", content });

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

function supportsLocalFileWorkspace(session: AgentSessionRecord): boolean {
  return !session.sshTarget && (!session.hostId || session.hostId === "local");
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

function sanitizeCardText(input: string): string {
  return stripVTControlCharacters(input)
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .trim();
}

function truncateUnicode(input: string, maxCharacters: number): string {
  const characters = Array.from(input);
  if (characters.length <= maxCharacters) {
    return input;
  }
  return `${characters.slice(0, Math.max(0, maxCharacters - 3)).join("")}...`;
}

function buildIdempotencyKey(value: string): string {
  return `kw:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function buildSessionSignature(session: AgentSessionRecord): string {
  return JSON.stringify({
    workingDirectory: session.workingDirectory ?? "",
    repositoryRoot: session.repositoryRoot ?? "",
    hostId: session.hostId ?? "local",
    sshHost: session.sshTarget?.host ?? "",
    sshPort: session.sshTarget?.port ?? null,
    sshUsername: session.sshTarget?.username ?? "",
  });
}

function statusLabel(session: AgentSessionRecord): string {
  if (session.interactionState === "running") return "运行中";
  if (session.interactionState === "awaiting_input") return "等待输入";
  if (session.interactionState === "idle") return "空闲";
  return session.interactionState;
}

function dirnameOf(relativePath: string): string {
  if (!relativePath || relativePath === ".") return ".";
  const index = relativePath.lastIndexOf("/");
  return index <= 0 ? "." : relativePath.slice(0, index);
}

function joinRelative(directory: string, basename: string): string {
  return directory === "." ? basename : `${directory}/${basename}`;
}

function isValidBasename(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const value = input.trim();
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("..") &&
    !/[/\\]/u.test(value) &&
    !UNSAFE_CONTROL_CHARACTER_PATTERN.test(value) &&
    Buffer.byteLength(value, "utf8") <= MAX_BASENAME_BYTES
  );
}

function normalizeFormContent(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = input.replace(/\r\n?/g, "\n");
  return Array.from(normalized).length <= MAX_FORM_CONTENT_CHARACTERS &&
    !UNSAFE_CONTROL_CHARACTER_PATTERN.test(normalized)
    ? normalized
    : null;
}

function isPublicTranscriptEntry(entry: AgentTranscriptEntry): boolean {
  if ((entry as AgentTranscriptEntry & { internal?: boolean }).internal) {
    return false;
  }
  if (entry.kind !== "user" && entry.kind !== "assistant") {
    return false;
  }
  const text = `${entry.title}\n${entry.text}`;
  return !/goal\.internal_context|internal context/i.test(text);
}

function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function buildCard(input: {
  title: string;
  subtitle: string;
  tagText?: string;
  elements: Array<Record<string, unknown>>;
}) {
  return {
    schema: "2.0",
    config: {
      width_mode: "default",
      enable_forward: false,
      update_multi: true,
    },
    header: {
      title: plain(input.title),
      subtitle: plain(input.subtitle),
      template: "wathet",
      text_tag_list: input.tagText
        ? [
            {
              tag: "text_tag",
              text: plain(input.tagText),
              color: "wathet",
            },
          ]
        : undefined,
    },
    body: {
      direction: "vertical",
      padding: "12px 12px 20px 12px",
      vertical_spacing: "12px",
      elements: input.elements,
    },
  };
}

function callbackButton(
  text: string,
  actionToken: string,
  options: { type?: string; width?: string } = {},
) {
  return {
    tag: "button",
    text: plain(text),
    type: options.type ?? "default",
    width: options.width,
    behaviors: [
      {
        type: "callback",
        value: { action: ACTION_PREFIX, token: actionToken },
      },
    ],
  };
}

function infoBlock(content: string) {
  return {
    tag: "column_set",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 1,
        background_style: "grey-50",
        padding: "10px",
        vertical_spacing: "4px",
        elements: [{ tag: "div", text: plain(content) }],
      },
    ],
  };
}

function actionRow(buttons: Array<Record<string, unknown>>) {
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: buttons.map((button) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [button],
    })),
  };
}

export class FeishuSessionWorkspace {
  readonly #allowedUserId: string;
  readonly #settings: FeishuSessionWorkspaceOptions["settings"];
  readonly #registry: FeishuSessionWorkspaceOptions["registry"];
  readonly #resolveSessionId: FeishuSessionWorkspaceOptions["resolveSessionId"];
  readonly #files: FeishuSessionWorkspaceOptions["files"];
  readonly #transcript: FeishuSessionWorkspaceOptions["transcript"];
  readonly #exportTranscript: FeishuSessionWorkspaceOptions["exportTranscript"];
  readonly #notificationBindings: FeishuSessionWorkspaceOptions["notificationBindings"];
  readonly #messenger: FeishuSessionWorkspaceOptions["messenger"];
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #workspaces = new Map<string, WorkspaceBinding>();
  readonly #inFlightEventIds = new Set<string>();
  readonly #processedEventIds = new Set<string>();
  readonly #processedEventOrder: string[] = [];

  constructor(options: FeishuSessionWorkspaceOptions) {
    this.#allowedUserId = USER_ID_PATTERN.test(options.allowedUserId)
      ? options.allowedUserId
      : "";
    this.#settings = options.settings;
    this.#registry = options.registry;
    this.#resolveSessionId = options.resolveSessionId;
    this.#files = options.files;
    this.#transcript = options.transcript;
    this.#exportTranscript = options.exportTranscript;
    this.#notificationBindings = options.notificationBindings;
    this.#messenger = options.messenger;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  accepts(event: FeishuWorkspaceCardActionEvent): boolean {
    if (event.type !== "card.action.trigger") {
      return false;
    }
    const action = parseJsonObject(event.action_value);
    return (
      (action.action === COMPLETION_RECORDS_ACTION &&
        event.action_tag === "button") ||
      (typeof action.token === "string" &&
        action.action === ACTION_PREFIX &&
        event.action_tag === "button") ||
      (typeof event.action_name === "string" &&
        event.action_name.startsWith(FORM_PREFIX))
    );
  }

  async open(input: {
    sessionId: string;
    threadId: string;
    operatorId: string;
    chatId: string;
  }): Promise<FeishuSessionWorkspaceOutcome> {
    if (!isEnabled(this.#settings.get())) {
      return "ignored_disabled";
    }
    if (
      !this.#allowedUserId ||
      input.operatorId !== this.#allowedUserId ||
      !CHAT_ID_PATTERN.test(input.chatId)
    ) {
      return "ignored_untrusted";
    }
    const checked = await this.#resolveLiveSession(
      input.sessionId,
      input.threadId,
    );
    if (!checked.ok) {
      return checked.outcome;
    }

    const panelId = this.#createId();
    const actions = new Map<string, WorkspaceAction>();
    const binding: WorkspaceBinding = {
      panelId,
      operatorId: input.operatorId,
      chatId: input.chatId,
      messageId: "",
      sessionId: input.sessionId,
      threadId: input.threadId,
      signature: buildSessionSignature(checked.session),
      expiresAtMs: this.#now() + MAX_WORKSPACE_AGE_MS,
      actions,
    };
    const built = this.#buildHomeCard(binding, checked.session);
    const sent = await this.#messenger.sendCard({
      chatId: input.chatId,
      card: built.card,
      idempotencyKey: buildIdempotencyKey(`open:${panelId}:${input.threadId}`),
    });
    binding.chatId = sent.chatId;
    binding.messageId = sent.messageId;
    binding.actions = built.actions;
    this.#rememberWorkspace(binding);
    return "workspace_sent";
  }

  async handle(
    event: FeishuWorkspaceCardActionEvent,
  ): Promise<FeishuSessionWorkspaceOutcome> {
    if (!isEnabled(this.#settings.get())) {
      return "ignored_disabled";
    }
    if (!this.accepts(event)) {
      return "ignored_untrusted";
    }
    if (
      !this.#allowedUserId ||
      event.operator_id !== this.#allowedUserId ||
      typeof event.event_id !== "string" ||
      typeof event.message_id !== "string" ||
      typeof event.chat_id !== "string" ||
      !MESSAGE_ID_PATTERN.test(event.message_id) ||
      !CHAT_ID_PATTERN.test(event.chat_id)
    ) {
      return "ignored_untrusted";
    }
    if (this.#isDuplicateEvent(event.event_id)) {
      return "ignored_duplicate";
    }

    const actionValue = parseJsonObject(event.action_value);
    if (actionValue.action === COMPLETION_RECORDS_ACTION) {
      const notificationBinding = this.#notificationBindings?.resolve(
        event.message_id,
      );
      if (
        !notificationBinding ||
        notificationBinding.messageId !== event.message_id ||
        notificationBinding.chatId !== event.chat_id ||
        !notificationBinding.codexThreadId ||
        !CODEX_THREAD_ID_PATTERN.test(notificationBinding.codexThreadId)
      ) {
        return "ignored_untrusted";
      }

      const trustedEvent = {
        ...event,
        event_id: event.event_id,
        chat_id: event.chat_id,
      };
      this.#inFlightEventIds.add(trustedEvent.event_id);
      this.#rememberProcessedEvent(trustedEvent.event_id);
      try {
        const outcome = await this.#openRecords({
          event: trustedEvent,
          sessionId: notificationBinding.sessionId,
          threadId: notificationBinding.codexThreadId,
          operatorId: event.operator_id,
        });
        if (
          outcome === "ignored_unavailable" ||
          outcome === "ignored_changed_thread"
        ) {
          await this.#notify(
            trustedEvent.chat_id,
            outcome === "ignored_changed_thread"
              ? "该通知对应的 Codex 对话已经切换，无法再打开原记录。"
              : "该通知对应的 Codex 对话当前不可用。",
            trustedEvent.event_id,
          );
        }
        return outcome;
      } finally {
        this.#inFlightEventIds.delete(trustedEvent.event_id);
      }
    }

    const actionToken = this.#extractActionToken(event);
    if (!actionToken) {
      return "ignored_untrusted";
    }
    const binding = this.#resolveBinding(event, actionToken);
    if (!binding) {
      return "ignored_stale_workspace";
    }
    if (this.#isExpired(binding)) {
      this.#workspaces.delete(binding.panelId);
      await this.#notify(
        event.chat_id,
        "这个工作区面板已过期，请重新打开。",
        event.event_id,
      );
      return "ignored_expired";
    }
    const action = binding.actions.get(actionToken);
    if (!action) {
      return "ignored_stale_workspace";
    }

    const trustedEvent = {
      ...event,
      event_id: event.event_id,
      chat_id: event.chat_id,
    };
    this.#inFlightEventIds.add(trustedEvent.event_id);
    this.#rememberProcessedEvent(trustedEvent.event_id);
    const writeActionConsumed = this.#consumeWriteAction(
      binding,
      actionToken,
      action,
    );
    if (writeActionConsumed === "duplicate") {
      this.#inFlightEventIds.delete(trustedEvent.event_id);
      return "ignored_duplicate";
    }
    try {
      const checked = await this.#validateBinding(binding);
      if (!checked.ok) {
        await this.#notify(
          trustedEvent.chat_id,
          checked.message,
          trustedEvent.event_id,
        );
        return checked.outcome;
      }
      if (
        this.#isFileAction(action) &&
        !supportsLocalFileWorkspace(checked.session)
      ) {
        await this.#notify(
          trustedEvent.chat_id,
          "SSH 状态和记录可查看；文件读写暂仅支持本机会话。",
          trustedEvent.event_id,
        );
        return "ignored_unavailable";
      }
      return await this.#executeAction(
        trustedEvent,
        binding,
        actionToken,
        action,
        checked.session,
        writeActionConsumed === "consumed",
      );
    } finally {
      this.#inFlightEventIds.delete(trustedEvent.event_id);
    }
  }

  async #openRecords(input: {
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    };
    sessionId: string;
    threadId: string;
    operatorId: string;
  }): Promise<FeishuSessionWorkspaceOutcome> {
    const checked = await this.#resolveLiveSession(
      input.sessionId,
      input.threadId,
    );
    if (!checked.ok) {
      return checked.outcome;
    }

    const panelId = this.#createId();
    const binding: WorkspaceBinding = {
      panelId,
      operatorId: input.operatorId,
      chatId: input.event.chat_id,
      messageId: "",
      sessionId: input.sessionId,
      threadId: input.threadId,
      signature: buildSessionSignature(checked.session),
      expiresAtMs: this.#now() + MAX_WORKSPACE_AGE_MS,
      actions: new Map(),
    };
    const transcript = await this.#transcript(checked.session, input.threadId);
    const rechecked = await this.#validateBinding(binding);
    if (!rechecked.ok) {
      return rechecked.outcome;
    }
    await this.#sendRecords(
      input.event,
      binding,
      rechecked.session,
      transcript,
    );
    this.#rememberWorkspace(binding);
    return "records_sent";
  }

  async #executeAction(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    actionToken: string,
    action: WorkspaceAction,
    session: AgentSessionRecord,
    writeActionPreconsumed = false,
  ): Promise<FeishuSessionWorkspaceOutcome> {
    if (action.kind === "home") {
      await this.#sendHome(event, binding, session);
      return "workspace_sent";
    }
    if (action.kind === "records") {
      const transcript = await this.#transcript(
        session,
        binding.threadId,
        action.cursor,
      );
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      await this.#sendRecords(event, binding, rechecked.session, transcript);
      return "records_sent";
    }
    if (action.kind === "records_export") {
      const exported = await this.#exportTranscript(session, binding.threadId);
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      try {
        await this.#messenger.sendFile({
          ...exported,
          idempotencyKey: buildIdempotencyKey(`export:${event.event_id}`),
        });
      } catch {
        await this.#notify(
          event.chat_id,
          "完整记录发送结果不确定，请稍后重试。",
          event.event_id,
        );
        return "delivery_uncertain";
      }
      return "export_sent";
    }
    if (action.kind === "files") {
      const listing = await this.#files.list(session, action.path);
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      await this.#sendFiles(
        event,
        binding,
        rechecked.session,
        action.path,
        action.page,
        listing,
      );
      return "files_sent";
    }
    if (action.kind === "file_view") {
      let file: { content: string; revision: string; editable: boolean };
      try {
        file = await this.#files.read(session, action.path);
      } catch {
        const rechecked = await this.#validateBinding(binding);
        if (!rechecked.ok) {
          await this.#notify(event.chat_id, rechecked.message, event.event_id);
          return rechecked.outcome;
        }
        await this.#sendFilePreviewUnavailable(
          event,
          binding,
          rechecked.session,
          action.path,
        );
        return "file_sent";
      }
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      await this.#sendFileView(
        event,
        binding,
        rechecked.session,
        action.path,
        file,
      );
      return "file_sent";
    }
    if (action.kind === "file_download") {
      try {
        const file = await this.#files.download(session, action.path);
        const rechecked = await this.#validateBinding(binding);
        if (!rechecked.ok) {
          await this.#notify(event.chat_id, rechecked.message, event.event_id);
          return rechecked.outcome;
        }
        await this.#messenger.sendFile({
          ...file,
          idempotencyKey: buildIdempotencyKey(`download:${event.event_id}`),
        });
        return "download_sent";
      } catch {
        await this.#notify(
          event.chat_id,
          "文件下载结果不确定，请稍后重试。",
          event.event_id,
        );
        return "delivery_uncertain";
      }
    }
    if (action.kind === "file_edit_form") {
      const file = await this.#files.read(session, action.path);
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      if (
        !file.editable ||
        Array.from(file.content).length > MAX_FORM_CONTENT_CHARACTERS
      ) {
        await this.#notify(
          event.chat_id,
          "该文件超过飞书内编辑上限，请在终端或文件系统中编辑。",
          event.event_id,
        );
        return "ignored_invalid_input";
      }
      await this.#sendEditForm(
        event,
        binding,
        rechecked.session,
        action.path,
        file,
      );
      return "form_sent";
    }
    if (action.kind === "file_new_form") {
      await this.#sendNewFileForm(event, binding, session, action.directory);
      return "form_sent";
    }
    if (
      action.kind === "file_edit_submit" ||
      action.kind === "file_new_submit"
    ) {
      const formValue = parseJsonObject(event.form_value);
      const content = normalizeFormContent(formValue.content);
      if (content === null) {
        await this.#notify(
          event.chat_id,
          "文件内容最多 1000 字，且不能包含控制字符。",
          event.event_id,
        );
        return "ignored_invalid_input";
      }
      const path =
        action.kind === "file_edit_submit"
          ? action.path
          : isValidBasename(formValue.basename)
            ? joinRelative(action.directory, formValue.basename.trim())
            : null;
      if (!path) {
        await this.#notify(
          event.chat_id,
          "文件名只能是普通文件名，不能包含路径、.. 或控制字符。",
          event.event_id,
        );
        return "ignored_invalid_input";
      }
      const actions = new Map<string, WorkspaceAction>();
      const confirmToken = this.#createId();
      const cancelToken = this.#createId();
      actions.set(confirmToken, {
        kind: "write_confirm",
        path,
        content,
        expectedRevision:
          action.kind === "file_edit_submit" ? action.expectedRevision : null,
        cancelToken,
      });
      actions.set(cancelToken, { kind: "write_cancel", confirmToken });
      await this.#sendWriteConfirm(
        event,
        binding,
        session,
        path,
        content,
        confirmToken,
        cancelToken,
        actions,
      );
      return "write_confirm_sent";
    }
    if (action.kind === "write_confirm") {
      if (
        !writeActionPreconsumed &&
        this.#consumeWriteAction(binding, actionToken, action) !== "consumed"
      ) {
        return "ignored_duplicate";
      }
      const recheckedBeforeWrite = await this.#validateBinding(binding);
      if (!recheckedBeforeWrite.ok) {
        await this.#notify(
          event.chat_id,
          recheckedBeforeWrite.message,
          event.event_id,
        );
        return recheckedBeforeWrite.outcome;
      }
      try {
        await this.#files.write(
          recheckedBeforeWrite.session,
          action.path,
          action.content,
          action.expectedRevision,
        );
      } catch {
        await this.#notify(
          event.chat_id,
          "文件已变化或无法写入，未自动重试。",
          event.event_id,
        );
        return "delivery_uncertain";
      }
      const rechecked = await this.#validateBinding(binding);
      if (!rechecked.ok) {
        await this.#notify(event.chat_id, rechecked.message, event.event_id);
        return rechecked.outcome;
      }
      await this.#notify(
        event.chat_id,
        `已写入 ${action.path}。`,
        event.event_id,
      );
      return "write_applied";
    }
    if (action.kind === "write_cancel") {
      if (
        !writeActionPreconsumed &&
        this.#consumeWriteAction(binding, actionToken, action) !== "consumed"
      ) {
        return "ignored_duplicate";
      }
      await this.#notify(event.chat_id, "已取消文件写入。", event.event_id);
      return "files_sent";
    }
    return "ignored_untrusted";
  }

  #buildHomeCard(_binding: WorkspaceBinding, session: AgentSessionRecord) {
    const actions = new Map<string, WorkspaceAction>();
    const records = this.#storeAction(actions, { kind: "records" });
    const refresh = this.#storeAction(actions, { kind: "home" });
    const buttons = [
      callbackButton("查看完整记录", records, { type: "primary_filled" }),
    ];
    if (supportsLocalFileWorkspace(session)) {
      const files = this.#storeAction(actions, {
        kind: "files",
        path: ".",
        page: 1,
      });
      buttons.push(callbackButton("浏览项目文件", files));
    }
    const card = buildCard({
      title: "Coding Kanban · 会话工作区",
      subtitle: `${session.displayName} · ${statusLabel(session)}`,
      tagText: "15 分钟有效",
      elements: [
        infoBlock(
          [
            `会话：${sanitizeCardText(session.displayName)}`,
            `状态：${statusLabel(session)}${session.stateConfidence === "low" ? "（待确认）" : ""}`,
            `目录：${sanitizeCardText(session.workingDirectory ?? session.repositoryRoot ?? "未知")}`,
            supportsLocalFileWorkspace(session)
              ? "文件：本机会话可读写"
              : "文件：SSH 状态和记录可查看；文件读写暂仅支持本机会话",
          ].join("\n"),
        ),
        actionRow(buttons),
        callbackButton("刷新状态", refresh, { width: "fill" }),
      ],
    });
    return { card, actions };
  }

  async #sendHome(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
  ): Promise<void> {
    const built = this.#buildHomeCard(binding, session);
    await this.#sendCard(event, binding, built.card, built.actions);
  }

  async #sendRecords(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    transcript: AgentTranscriptResponse,
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    const entries = transcript.entries
      .filter(isPublicTranscriptEntry)
      .slice(-5);
    const elements: Array<Record<string, unknown>> = [
      infoBlock(
        transcript.available
          ? `会话：${sanitizeCardText(session.displayName)}\n更新时间：${transcript.updatedAt ?? "未知"}`
          : `完整记录暂不可用：${sanitizeCardText(transcript.message ?? "请稍后刷新")}`,
      ),
    ];
    let truncatedEntry = false;
    if (entries.length) {
      for (const entry of entries) {
        const text = sanitizeCardText(entry.text);
        truncatedEntry ||= Array.from(text).length > MAX_CARD_TEXT_CHARACTERS;
        elements.push({
          tag: "div",
          text: plain(
            `${entry.kind === "user" ? "用户" : "Codex"} · ${sanitizeCardText(entry.title)}\n${truncateUnicode(text, MAX_CARD_TEXT_CHARACTERS)}`,
          ),
        });
      }
    } else {
      elements.push({
        tag: "div",
        text: plain("暂无可展示的用户或 Codex 回复记录。"),
      });
    }
    const buttons = [
      callbackButton(
        "导出完整记录",
        this.#storeAction(actions, { kind: "records_export" }),
        { type: "primary_filled" },
      ),
      callbackButton(
        "返回工作区",
        this.#storeAction(actions, { kind: "home" }),
      ),
    ];
    if (transcript.hasMore && transcript.nextCursor) {
      buttons.splice(
        1,
        0,
        callbackButton(
          "更早记录",
          this.#storeAction(actions, {
            kind: "records",
            cursor: transcript.nextCursor,
          }),
        ),
      );
    }
    if (truncatedEntry || transcript.hasMore) {
      elements.push({
        tag: "div",
        text: plain("卡片为分段摘要；获取完整记录请点击导出完整记录下载文件。"),
      });
    }
    elements.push(actionRow(buttons));
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 完整记录",
        subtitle: `${session.displayName} · 仅展示用户与 Codex 回复`,
        elements,
      }),
      actions,
    );
  }

  async #sendFiles(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    path: string,
    page: number,
    listing: { entries: FeishuWorkspaceFileEntry[]; truncated: boolean },
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    const totalPages = pageCountFor(listing.entries.length, FILE_PAGE_SIZE);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * FILE_PAGE_SIZE;
    const pageEntries = listing.entries.slice(start, start + FILE_PAGE_SIZE);
    const elements: Array<Record<string, unknown>> = [
      infoBlock(
        `目录：${path}\n条目：${listing.entries.length}${listing.truncated ? "（已限制显示前 200 项）" : ""}`,
      ),
    ];
    for (const entry of pageEntries) {
      if (entry.type === "directory") {
        const token = this.#storeAction(actions, {
          kind: "files",
          path: entry.path,
          page: 1,
        });
        elements.push(
          actionRow([
            callbackButton(`打开目录 · ${entry.name}`, token, {
              type: "primary",
            }),
          ]),
        );
      } else {
        elements.push(
          actionRow([
            callbackButton(
              `预览文件 · ${entry.name}`,
              this.#storeAction(actions, {
                kind: "file_view",
                path: entry.path,
              }),
            ),
            callbackButton(
              `下载 · ${entry.name}`,
              this.#storeAction(actions, {
                kind: "file_download",
                path: entry.path,
              }),
            ),
          ]),
        );
      }
    }
    const nav: Array<Record<string, unknown>> = [];
    if (path !== ".") {
      nav.push(
        callbackButton(
          "上级目录",
          this.#storeAction(actions, {
            kind: "files",
            path: dirnameOf(path),
            page: 1,
          }),
        ),
      );
    }
    if (currentPage > 1) {
      nav.push(
        callbackButton(
          "上一页",
          this.#storeAction(actions, {
            kind: "files",
            path,
            page: currentPage - 1,
          }),
        ),
      );
    }
    if (currentPage < totalPages) {
      nav.push(
        callbackButton(
          "下一页",
          this.#storeAction(actions, {
            kind: "files",
            path,
            page: currentPage + 1,
          }),
        ),
      );
    }
    nav.push(
      callbackButton(
        "新建文件",
        this.#storeAction(actions, { kind: "file_new_form", directory: path }),
        { type: "primary_filled" },
      ),
    );
    nav.push(
      callbackButton(
        "返回工作区",
        this.#storeAction(actions, { kind: "home" }),
      ),
    );
    elements.push(
      infoBlock(
        `第 ${currentPage} / ${totalPages} 页。飞书内编辑仅支持 1000 字以内 UTF-8 文本，不支持任意二进制上传。`,
      ),
    );
    elements.push(actionRow(nav.slice(0, 3)));
    if (nav.length > 3) elements.push(actionRow(nav.slice(3, 6)));
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 文件浏览",
        subtitle: `${session.displayName} · 可读可写项目文件`,
        elements,
      }),
      actions,
    );
  }

  async #sendFileView(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    path: string,
    file: { content: string; revision: string; editable: boolean },
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    const contentLength = Array.from(file.content).length;
    const editable =
      file.editable && contentLength <= MAX_FORM_CONTENT_CHARACTERS;
    const preview = truncateUnicode(file.content, MAX_FILE_PREVIEW_CHARACTERS);
    const buttons = [
      callbackButton(
        "下载文件",
        this.#storeAction(actions, { kind: "file_download", path }),
        { type: "primary_filled" },
      ),
      callbackButton(
        "返回目录",
        this.#storeAction(actions, {
          kind: "files",
          path: dirnameOf(path),
          page: 1,
        }),
      ),
    ];
    if (editable) {
      buttons.splice(
        1,
        0,
        callbackButton(
          "编辑文件",
          this.#storeAction(actions, { kind: "file_edit_form", path }),
        ),
      );
    }
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 文件预览",
        subtitle: `${session.displayName} · ${path}`,
        elements: [
          infoBlock(
            `路径：${path}\n大小：${contentLength} 字符\n${editable ? "可在飞书内编辑" : "仅预览，超过飞书内编辑上限或不可编辑"}`,
          ),
          { tag: "div", text: plain(preview || "空文件") },
          actionRow(buttons),
        ],
      }),
      actions,
    );
  }

  async #sendFilePreviewUnavailable(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    path: string,
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 文件预览",
        subtitle: `${session.displayName} · ${path}`,
        elements: [
          infoBlock(
            `路径：${path}\n该文件无法作为 128KiB 内 UTF-8 文本预览，可直接下载。`,
          ),
          actionRow([
            callbackButton(
              "下载文件",
              this.#storeAction(actions, { kind: "file_download", path }),
              { type: "primary_filled" },
            ),
            callbackButton(
              "返回目录",
              this.#storeAction(actions, {
                kind: "files",
                path: dirnameOf(path),
                page: 1,
              }),
            ),
          ]),
        ],
      }),
      actions,
    );
  }

  async #sendEditForm(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    path: string,
    file: { content: string; revision: string },
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    const submitToken = this.#storeAction(actions, {
      kind: "file_edit_submit",
      path,
      expectedRevision: file.revision,
    });
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 编辑文件",
        subtitle: `${session.displayName} · ${path}`,
        elements: [
          infoBlock(`路径：${path}\n保存前会再次确认，不会直接写入。`),
          {
            tag: "form",
            name: `form_${submitToken}`,
            vertical_spacing: "12px",
            elements: [
              {
                tag: "input",
                name: "content",
                required: false,
                label: plain("文件内容"),
                default_value: file.content,
                input_type: "multiline_text",
                rows: 8,
                max_length: MAX_FORM_CONTENT_CHARACTERS,
                width: "fill",
              },
              {
                tag: "button",
                name: `${FORM_PREFIX}${submitToken}`,
                form_action_type: "submit",
                text: plain("预览并确认写入"),
                type: "primary_filled",
                width: "fill",
              },
            ],
          },
        ],
      }),
      actions,
    );
  }

  async #sendNewFileForm(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    directory: string,
  ): Promise<void> {
    const actions = new Map<string, WorkspaceAction>();
    const submitToken = this.#storeAction(actions, {
      kind: "file_new_submit",
      directory,
    });
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 新建文件",
        subtitle: `${session.displayName} · ${directory}`,
        elements: [
          infoBlock(
            `目录：${directory}\n文件名只能是 basename，不能包含路径或 ..。`,
          ),
          {
            tag: "form",
            name: `form_${submitToken}`,
            vertical_spacing: "12px",
            elements: [
              {
                tag: "input",
                name: "basename",
                required: true,
                label: plain("文件名"),
                max_length: MAX_BASENAME_BYTES,
                width: "fill",
              },
              {
                tag: "input",
                name: "content",
                required: false,
                label: plain("文件内容"),
                input_type: "multiline_text",
                rows: 8,
                max_length: MAX_FORM_CONTENT_CHARACTERS,
                width: "fill",
              },
              {
                tag: "button",
                name: `${FORM_PREFIX}${submitToken}`,
                form_action_type: "submit",
                text: plain("预览并确认创建"),
                type: "primary_filled",
                width: "fill",
              },
            ],
          },
        ],
      }),
      actions,
    );
  }

  async #sendWriteConfirm(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    session: AgentSessionRecord,
    path: string,
    content: string,
    confirmToken: string,
    cancelToken: string,
    actions: WorkspaceActionMap,
  ): Promise<void> {
    await this.#sendCard(
      event,
      binding,
      buildCard({
        title: "Coding Kanban · 确认写入",
        subtitle: `${session.displayName} · ${path}`,
        tagText: "需要二次确认",
        elements: [
          infoBlock(
            `路径：${path}\n内容长度：${Array.from(content).length} 字符`,
          ),
          {
            tag: "div",
            text: plain(
              truncateUnicode(content, MAX_FILE_PREVIEW_CHARACTERS) || "空文件",
            ),
          },
          actionRow([
            callbackButton("确认写入", confirmToken, {
              type: "primary_filled",
            }),
            callbackButton("取消", cancelToken),
          ]),
        ],
      }),
      actions,
    );
  }

  async #sendCard(
    event: FeishuWorkspaceCardActionEvent & {
      event_id: string;
      chat_id: string;
    },
    binding: WorkspaceBinding,
    card: unknown,
    actions: WorkspaceActionMap,
  ): Promise<void> {
    const sent = await this.#messenger.sendCard({
      chatId: event.chat_id,
      card,
      idempotencyKey: buildIdempotencyKey(
        `${event.event_id}:${binding.panelId}`,
      ),
    });
    binding.chatId = sent.chatId;
    binding.messageId = sent.messageId;
    binding.actions = actions;
  }

  async #notify(chatId: string, text: string, eventId: string): Promise<void> {
    await this.#messenger.sendText({
      chatId,
      text,
      idempotencyKey: buildIdempotencyKey(`notice:${eventId}`),
    });
  }

  #storeAction(actions: WorkspaceActionMap, action: WorkspaceAction): string {
    const token = this.#createId();
    actions.set(token, action);
    return token;
  }

  #extractActionToken(event: FeishuWorkspaceCardActionEvent): string | null {
    const action = parseJsonObject(event.action_value);
    if (action.action === ACTION_PREFIX && typeof action.token === "string") {
      return action.token;
    }
    if (
      typeof event.action_name === "string" &&
      event.action_name.startsWith(FORM_PREFIX)
    ) {
      return event.action_name.slice(FORM_PREFIX.length);
    }
    return null;
  }

  #resolveBinding(
    event: FeishuWorkspaceCardActionEvent & {
      message_id?: string;
      chat_id?: string;
    },
    actionToken: string,
  ): WorkspaceBinding | null {
    for (const binding of this.#workspaces.values()) {
      if (
        binding.actions.has(actionToken) &&
        binding.operatorId === event.operator_id &&
        binding.chatId === event.chat_id &&
        binding.messageId === event.message_id
      ) {
        return binding;
      }
    }
    return null;
  }

  async #resolveLiveSession(
    sessionId: string,
    threadId: string,
  ): Promise<
    | { ok: true; session: AgentSessionRecord }
    | { ok: false; outcome: "ignored_unavailable" | "ignored_changed_thread" }
  > {
    let session: AgentSessionRecord;
    try {
      session = this.#registry.get(sessionId);
    } catch {
      return { ok: false, outcome: "ignored_unavailable" };
    }
    if (!isAvailableCodexSession(session)) {
      return { ok: false, outcome: "ignored_unavailable" };
    }
    const currentThreadId = await this.#resolveSessionId(session);
    if (!currentThreadId) {
      return { ok: false, outcome: "ignored_unavailable" };
    }
    if (currentThreadId !== threadId) {
      return { ok: false, outcome: "ignored_changed_thread" };
    }
    try {
      session = this.#registry.get(sessionId);
    } catch {
      return { ok: false, outcome: "ignored_unavailable" };
    }
    if (!isAvailableCodexSession(session)) {
      return { ok: false, outcome: "ignored_unavailable" };
    }
    return { ok: true, session };
  }

  async #validateBinding(binding: WorkspaceBinding): Promise<
    | { ok: true; session: AgentSessionRecord }
    | {
        ok: false;
        outcome:
          | "ignored_disabled"
          | "ignored_unavailable"
          | "ignored_changed_thread";
        message: string;
      }
  > {
    if (!isEnabled(this.#settings.get())) {
      return {
        ok: false,
        outcome: "ignored_disabled",
        message: "飞书回复控制已关闭。",
      };
    }
    const checked = await this.#resolveLiveSession(
      binding.sessionId,
      binding.threadId,
    );
    if (!isEnabled(this.#settings.get())) {
      return {
        ok: false,
        outcome: "ignored_disabled",
        message: "飞书回复控制已关闭。",
      };
    }
    if (!checked.ok) {
      return {
        ok: false,
        outcome: checked.outcome,
        message:
          checked.outcome === "ignored_changed_thread"
            ? "目标 Codex 对话已变化，请重新打开工作区。"
            : "目标 Codex 对话当前不可用。",
      };
    }
    if (buildSessionSignature(checked.session) !== binding.signature) {
      return {
        ok: false,
        outcome: "ignored_changed_thread",
        message: "目标工作目录或主机已变化，请重新打开工作区。",
      };
    }
    return { ok: true, session: checked.session };
  }

  #isExpired(binding: WorkspaceBinding): boolean {
    return this.#now() > binding.expiresAtMs;
  }

  #consumeWriteAction(
    binding: WorkspaceBinding,
    actionToken: string,
    action: WorkspaceAction,
  ): "consumed" | "duplicate" | "not-write" {
    if (action.kind === "write_confirm") {
      if (action.consumed || !binding.actions.has(actionToken)) {
        return "duplicate";
      }
      action.consumed = true;
      binding.actions.delete(actionToken);
      binding.actions.delete(action.cancelToken);
      return "consumed";
    }
    if (action.kind === "write_cancel") {
      if (action.consumed || !binding.actions.has(actionToken)) {
        return "duplicate";
      }
      action.consumed = true;
      binding.actions.delete(actionToken);
      if (action.confirmToken) {
        binding.actions.delete(action.confirmToken);
      }
      return "consumed";
    }
    return "not-write";
  }

  #isFileAction(action: WorkspaceAction): boolean {
    return (
      action.kind.startsWith("file_") ||
      action.kind === "files" ||
      action.kind === "write_confirm" ||
      action.kind === "write_cancel"
    );
  }

  #rememberWorkspace(binding: WorkspaceBinding): void {
    this.#workspaces.set(binding.panelId, binding);
    while (this.#workspaces.size > MAX_WORKSPACES) {
      const [oldest] = this.#workspaces.keys();
      if (!oldest) break;
      this.#workspaces.delete(oldest);
    }
  }

  #isDuplicateEvent(eventId: string): boolean {
    return (
      this.#processedEventIds.has(eventId) ||
      this.#inFlightEventIds.has(eventId)
    );
  }

  #rememberProcessedEvent(eventId: string): void {
    if (this.#processedEventIds.has(eventId)) return;
    this.#processedEventIds.add(eventId);
    this.#processedEventOrder.push(eventId);
    while (this.#processedEventOrder.length > MAX_PROCESSED_EVENTS) {
      const oldest = this.#processedEventOrder.shift();
      if (oldest) this.#processedEventIds.delete(oldest);
    }
  }
}
