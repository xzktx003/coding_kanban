import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  FeishuNotificationDestinationType,
  FeishuNotificationSettingsResponse,
  UpdateFeishuNotificationSettingsInput,
} from "@agent-orchestrator/shared";

const LEGACY_SETTINGS_VERSION = 1;
const KANBAN_SETTINGS_VERSION = 2;
const SETTINGS_VERSION = 3;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;

interface PersistedFeishuNotificationSettings {
  version: typeof SETTINGS_VERSION;
  enabled: boolean;
  replyEnabled: boolean;
  deliveryMode: "kanban";
  updatedAt: string;
}

interface ResolvedPersistedFeishuNotificationSettings {
  enabled: boolean;
  replyEnabled: boolean;
  deliveryMode: "hook" | "kanban";
}

export interface FeishuNotificationSettingsServiceLike {
  get(): FeishuNotificationSettingsResponse;
  update(
    input: UpdateFeishuNotificationSettingsInput,
  ): FeishuNotificationSettingsResponse;
  subscribe?(
    listener: (settings: FeishuNotificationSettingsResponse) => void,
  ): () => void;
}

export class FeishuNotificationNotConfiguredError extends Error {
  constructor() {
    super(
      "飞书通知尚未配置：请在本地 .env 中设置一个有效的 FEISHU_NOTIFY_USER_ID 或 FEISHU_NOTIFY_CHAT_ID",
    );
    this.name = "FeishuNotificationNotConfiguredError";
  }
}

export class FeishuReplyNotConfiguredError extends Error {
  constructor() {
    super(
      "飞书回复控制只支持私聊：请在本地 .env 中配置有效的 FEISHU_NOTIFY_USER_ID，并移除群聊目标",
    );
    this.name = "FeishuReplyNotConfiguredError";
  }
}

function resolveDestinationType(
  env: NodeJS.ProcessEnv,
): FeishuNotificationDestinationType | null {
  const chatId = env.FEISHU_NOTIFY_CHAT_ID?.trim() ?? "";
  const userId = env.FEISHU_NOTIFY_USER_ID?.trim() ?? "";

  if (Boolean(chatId) === Boolean(userId)) {
    return null;
  }
  if (chatId) {
    return CHAT_ID_PATTERN.test(chatId) ? "chat" : null;
  }
  return USER_ID_PATTERN.test(userId) ? "user" : null;
}

function readPersistedSettings(
  statePath: string,
): ResolvedPersistedFeishuNotificationSettings | null {
  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.enabled !== "boolean") {
      return {
        enabled: false,
        replyEnabled: false,
        deliveryMode: "kanban",
      };
    }
    if (parsed.version === LEGACY_SETTINGS_VERSION) {
      return {
        enabled: parsed.enabled,
        replyEnabled: false,
        deliveryMode: "hook",
      };
    }
    if (
      parsed.version === KANBAN_SETTINGS_VERSION &&
      parsed.deliveryMode === "kanban"
    ) {
      return {
        enabled: parsed.enabled,
        replyEnabled: false,
        deliveryMode: "kanban",
      };
    }
    if (
      parsed.version === SETTINGS_VERSION &&
      parsed.deliveryMode === "kanban" &&
      typeof parsed.replyEnabled === "boolean"
    ) {
      return {
        enabled: parsed.enabled,
        replyEnabled: parsed.replyEnabled,
        deliveryMode: "kanban",
      };
    }
    return {
      enabled: false,
      replyEnabled: false,
      deliveryMode: "kanban",
    };
  } catch {
    return {
      enabled: false,
      replyEnabled: false,
      deliveryMode: "kanban",
    };
  }
}

export class FeishuNotificationSettingsService implements FeishuNotificationSettingsServiceLike {
  readonly #env: NodeJS.ProcessEnv;
  readonly #statePath: string;
  readonly #listeners = new Set<
    (settings: FeishuNotificationSettingsResponse) => void
  >();

  constructor(options: { env?: NodeJS.ProcessEnv; statePath: string }) {
    this.#env = options.env ?? process.env;
    this.#statePath = options.statePath;
  }

  get(): FeishuNotificationSettingsResponse {
    const destinationType = resolveDestinationType(this.#env);
    const configured = destinationType !== null;
    const replyConfigured = destinationType === "user";
    const persistedSettings = readPersistedSettings(this.#statePath);

    return {
      configured,
      destinationType,
      enabled: configured && (persistedSettings?.enabled ?? true),
      replyConfigured,
      replyEnabled:
        replyConfigured && (persistedSettings?.replyEnabled ?? false),
    };
  }

  activateKanbanDelivery(): FeishuNotificationSettingsResponse {
    const persistedSettings = readPersistedSettings(this.#statePath);
    this.#persist(
      persistedSettings?.enabled ?? true,
      persistedSettings?.replyEnabled ?? false,
    );
    return this.get();
  }

  update(
    input: UpdateFeishuNotificationSettingsInput,
  ): FeishuNotificationSettingsResponse {
    const destinationType = resolveDestinationType(this.#env);
    const persistedSettings = readPersistedSettings(this.#statePath);
    const enabled = input.enabled ?? persistedSettings?.enabled ?? true;
    const replyEnabled =
      input.replyEnabled ?? persistedSettings?.replyEnabled ?? false;
    if (enabled && destinationType === null) {
      throw new FeishuNotificationNotConfiguredError();
    }
    if (replyEnabled && destinationType !== "user") {
      throw new FeishuReplyNotConfiguredError();
    }

    this.#persist(enabled, replyEnabled);
    const settings = this.get();
    for (const listener of this.#listeners) {
      listener(settings);
    }
    return settings;
  }

  subscribe(
    listener: (settings: FeishuNotificationSettingsResponse) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #persist(enabled: boolean, replyEnabled: boolean): void {
    const payload: PersistedFeishuNotificationSettings = {
      version: SETTINGS_VERSION,
      enabled,
      replyEnabled,
      deliveryMode: "kanban",
      updatedAt: new Date().toISOString(),
    };
    const directory = dirname(this.#statePath);
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;

    mkdirSync(directory, { mode: 0o700, recursive: true });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.#statePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
