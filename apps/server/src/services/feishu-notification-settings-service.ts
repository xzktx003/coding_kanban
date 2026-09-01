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
} from "@agent-orchestrator/shared";

const LEGACY_SETTINGS_VERSION = 1;
const SETTINGS_VERSION = 2;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const USER_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;

interface PersistedFeishuNotificationSettings {
  version: typeof SETTINGS_VERSION;
  enabled: boolean;
  deliveryMode: "kanban";
  updatedAt: string;
}

interface ResolvedPersistedFeishuNotificationSettings {
  enabled: boolean;
  deliveryMode: "hook" | "kanban";
}

export interface FeishuNotificationSettingsServiceLike {
  get(): FeishuNotificationSettingsResponse;
  update(enabled: boolean): FeishuNotificationSettingsResponse;
}

export class FeishuNotificationNotConfiguredError extends Error {
  constructor() {
    super(
      "飞书通知尚未配置：请在本地 .env 中设置一个有效的 FEISHU_NOTIFY_USER_ID 或 FEISHU_NOTIFY_CHAT_ID",
    );
    this.name = "FeishuNotificationNotConfiguredError";
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
      return { enabled: false, deliveryMode: "kanban" };
    }
    if (parsed.version === LEGACY_SETTINGS_VERSION) {
      return { enabled: parsed.enabled, deliveryMode: "hook" };
    }
    if (
      parsed.version === SETTINGS_VERSION &&
      parsed.deliveryMode === "kanban"
    ) {
      return { enabled: parsed.enabled, deliveryMode: "kanban" };
    }
    return { enabled: false, deliveryMode: "kanban" };
  } catch {
    return { enabled: false, deliveryMode: "kanban" };
  }
}

export class FeishuNotificationSettingsService implements FeishuNotificationSettingsServiceLike {
  readonly #env: NodeJS.ProcessEnv;
  readonly #statePath: string;

  constructor(options: { env?: NodeJS.ProcessEnv; statePath: string }) {
    this.#env = options.env ?? process.env;
    this.#statePath = options.statePath;
  }

  get(): FeishuNotificationSettingsResponse {
    const destinationType = resolveDestinationType(this.#env);
    const configured = destinationType !== null;
    const persistedSettings = readPersistedSettings(this.#statePath);

    return {
      configured,
      destinationType,
      enabled: configured && (persistedSettings?.enabled ?? true),
    };
  }

  activateKanbanDelivery(): FeishuNotificationSettingsResponse {
    const persistedSettings = readPersistedSettings(this.#statePath);
    this.#persist(persistedSettings?.enabled ?? true);
    return this.get();
  }

  update(enabled: boolean): FeishuNotificationSettingsResponse {
    const destinationType = resolveDestinationType(this.#env);
    if (enabled && destinationType === null) {
      throw new FeishuNotificationNotConfiguredError();
    }

    this.#persist(enabled);

    return {
      configured: destinationType !== null,
      destinationType,
      enabled: enabled && destinationType !== null,
    };
  }

  #persist(enabled: boolean): void {
    const payload: PersistedFeishuNotificationSettings = {
      version: SETTINGS_VERSION,
      enabled,
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
