import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const STATE_VERSION = 1;
const DEFAULT_BINDING_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_BINDINGS = 10_000;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;

export interface FeishuReplyBinding {
  messageId: string;
  chatId: string;
  sessionId: string;
  completionId: string;
  createdAt: string;
}

interface ProcessedFeishuReply {
  messageId: string;
  processedAt: string;
}

interface PersistedFeishuReplyState {
  version: typeof STATE_VERSION;
  bindings: FeishuReplyBinding[];
  processed: ProcessedFeishuReply[];
}

export interface RecordFeishuReplyBindingsInput {
  sessionId: string;
  completionId: string;
  messages: Array<{ messageId: string; chatId: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseBinding(value: unknown): FeishuReplyBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  const { messageId, chatId, sessionId, completionId, createdAt } = value;
  if (
    typeof messageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(messageId) ||
    typeof chatId !== "string" ||
    !CHAT_ID_PATTERN.test(chatId) ||
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    typeof completionId !== "string" ||
    !completionId.trim() ||
    !isValidTimestamp(createdAt)
  ) {
    return null;
  }

  return { messageId, chatId, sessionId, completionId, createdAt };
}

function parseProcessed(value: unknown): ProcessedFeishuReply | null {
  if (!isRecord(value)) {
    return null;
  }
  const { messageId, processedAt } = value;
  if (
    typeof messageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(messageId) ||
    !isValidTimestamp(processedAt)
  ) {
    return null;
  }
  return { messageId, processedAt };
}

export class FeishuReplyBindingStore {
  readonly #statePath: string;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  #bindings = new Map<string, FeishuReplyBinding>();
  #processed = new Map<string, ProcessedFeishuReply>();

  constructor(options: {
    statePath: string;
    ttlMs?: number;
    now?: () => Date;
  }) {
    this.#statePath = options.statePath;
    this.#ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_BINDING_TTL_MS);
    this.#now = options.now ?? (() => new Date());
    this.#load();
  }

  record(input: RecordFeishuReplyBindingsInput): void {
    const createdAt = this.#now().toISOString();
    for (const message of input.messages) {
      if (
        !MESSAGE_ID_PATTERN.test(message.messageId) ||
        !CHAT_ID_PATTERN.test(message.chatId)
      ) {
        continue;
      }
      this.#bindings.set(message.messageId, {
        messageId: message.messageId,
        chatId: message.chatId,
        sessionId: input.sessionId,
        completionId: input.completionId,
        createdAt,
      });
    }
    this.#prune();
    this.#persist();
  }

  resolve(messageId: string): FeishuReplyBinding | null {
    const changed = this.#prune();
    if (changed) {
      this.#persist();
    }
    return this.#bindings.get(messageId) ?? null;
  }

  hasProcessed(messageId: string): boolean {
    const changed = this.#prune();
    if (changed) {
      this.#persist();
    }
    return this.#processed.has(messageId);
  }

  markProcessed(messageId: string): void {
    if (!MESSAGE_ID_PATTERN.test(messageId)) {
      return;
    }
    this.#processed.set(messageId, {
      messageId,
      processedAt: this.#now().toISOString(),
    });
    this.#prune();
    this.#persist();
  }

  #load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.#statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || parsed.version !== STATE_VERSION) {
        return;
      }
      for (const candidate of Array.isArray(parsed.bindings)
        ? parsed.bindings
        : []) {
        const binding = parseBinding(candidate);
        if (binding) {
          this.#bindings.set(binding.messageId, binding);
        }
      }
      for (const candidate of Array.isArray(parsed.processed)
        ? parsed.processed
        : []) {
        const processed = parseProcessed(candidate);
        if (processed) {
          this.#processed.set(processed.messageId, processed);
        }
      }
      this.#prune();
    } catch {
      this.#bindings.clear();
      this.#processed.clear();
    }
  }

  #prune(): boolean {
    const cutoff = this.#now().getTime() - this.#ttlMs;
    let changed = false;
    for (const [messageId, binding] of this.#bindings) {
      if (Date.parse(binding.createdAt) < cutoff) {
        this.#bindings.delete(messageId);
        changed = true;
      }
    }
    for (const [messageId, processed] of this.#processed) {
      if (Date.parse(processed.processedAt) < cutoff) {
        this.#processed.delete(messageId);
        changed = true;
      }
    }

    changed =
      this.#trimOldest(this.#bindings, (value) => value.createdAt) || changed;
    changed =
      this.#trimOldest(this.#processed, (value) => value.processedAt) ||
      changed;
    return changed;
  }

  #trimOldest<T>(
    entries: Map<string, T>,
    timestamp: (value: T) => string,
  ): boolean {
    if (entries.size <= MAX_BINDINGS) {
      return false;
    }
    const overflow = entries.size - MAX_BINDINGS;
    const oldest = [...entries.entries()]
      .sort((left, right) =>
        timestamp(left[1]).localeCompare(timestamp(right[1])),
      )
      .slice(0, overflow);
    for (const [key] of oldest) {
      entries.delete(key);
    }
    return oldest.length > 0;
  }

  #persist(): void {
    const state: PersistedFeishuReplyState = {
      version: STATE_VERSION,
      bindings: [...this.#bindings.values()],
      processed: [...this.#processed.values()],
    };
    const directory = dirname(this.#statePath);
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;

    mkdirSync(directory, { mode: 0o700, recursive: true });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.#statePath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
}
