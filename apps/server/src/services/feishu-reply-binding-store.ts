import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import type { FeishuCompletionFileReference } from "./feishu-completion-file-reference-service.js";

const STATE_VERSION = 1;
const DEFAULT_BINDING_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_BINDINGS = 10_000;
const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9_-]+$/;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9_-]+$/;
const CODEX_THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_REFERENCED_FILES = 5;

export interface FeishuReplyBinding {
  messageId: string;
  chatId: string;
  sessionId: string;
  completionId: string;
  codexThreadId?: string;
  referencedFiles?: FeishuCompletionFileReference[];
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
  codexThreadId?: string;
  referencedFiles?: FeishuCompletionFileReference[];
  messages: Array<{ messageId: string; chatId: string }>;
}

export interface RecordProcessedFeishuReplyInput {
  messageId: string;
  parent: FeishuReplyBinding;
  codexThreadId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseReferencedFiles(
  value: unknown,
): FeishuCompletionFileReference[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const references: FeishuCompletionFileReference[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_REFERENCED_FILES)) {
    if (!isRecord(candidate)) continue;
    const { path, line } = candidate;
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > 2_048 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      path
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..") ||
      (line !== undefined &&
        (typeof line !== "number" ||
          !Number.isSafeInteger(line) ||
          line < 1 ||
          line > 10_000_000))
    ) {
      continue;
    }
    const reference = {
      path,
      ...(typeof line === "number" ? { line } : {}),
    };
    const key = `${reference.path}:${reference.line ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push(reference);
    }
  }
  return references.length > 0 ? references : undefined;
}

function parseBinding(value: unknown): FeishuReplyBinding | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    messageId,
    chatId,
    sessionId,
    completionId,
    codexThreadId,
    referencedFiles,
    createdAt,
  } = value;
  if (
    typeof messageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(messageId) ||
    typeof chatId !== "string" ||
    !CHAT_ID_PATTERN.test(chatId) ||
    typeof sessionId !== "string" ||
    !sessionId.trim() ||
    typeof completionId !== "string" ||
    !completionId.trim() ||
    (codexThreadId !== undefined &&
      (typeof codexThreadId !== "string" ||
        !CODEX_THREAD_ID_PATTERN.test(codexThreadId))) ||
    !isValidTimestamp(createdAt)
  ) {
    return null;
  }
  const parsedReferencedFiles = parseReferencedFiles(referencedFiles);

  return {
    messageId,
    chatId,
    sessionId,
    completionId,
    ...(typeof codexThreadId === "string" ? { codexThreadId } : {}),
    ...(parsedReferencedFiles
      ? { referencedFiles: parsedReferencedFiles }
      : {}),
    createdAt,
  };
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
    const referencedFiles = parseReferencedFiles(input.referencedFiles);
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
        ...(input.codexThreadId &&
        CODEX_THREAD_ID_PATTERN.test(input.codexThreadId)
          ? { codexThreadId: input.codexThreadId }
          : {}),
        ...(referencedFiles ? { referencedFiles } : {}),
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

  recordProcessedReply(input: RecordProcessedFeishuReplyInput): void {
    if (
      !MESSAGE_ID_PATTERN.test(input.messageId) ||
      !CODEX_THREAD_ID_PATTERN.test(input.codexThreadId)
    ) {
      return;
    }
    const processedAt = this.#now().toISOString();
    this.#bindings.set(input.messageId, {
      messageId: input.messageId,
      chatId: input.parent.chatId,
      sessionId: input.parent.sessionId,
      completionId: input.parent.completionId,
      codexThreadId: input.codexThreadId,
      ...(input.parent.referencedFiles
        ? { referencedFiles: input.parent.referencedFiles }
        : {}),
      createdAt: processedAt,
    });
    this.#processed.set(input.messageId, {
      messageId: input.messageId,
      processedAt,
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
