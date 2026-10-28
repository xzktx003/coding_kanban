import { HttpError, type Json } from "./json.js";

export interface HistoryBudgetLimits {
  maxPages: number;
  /** All retained JSON values, including nested tool items and scalar metadata. */
  maxEntries: number;
  maxBytes: number;
  maxDepth: number;
}
export const DEFAULT_HISTORY_BUDGET: Readonly<HistoryBudgetLimits> =
  Object.freeze({
    maxPages: 256,
    maxEntries: 100_000,
    maxBytes: 32 * 1024 * 1024,
    maxDepth: 128,
  });

/** Thrown where a caller opted into keeping the prefix it already read. */
export class HistoryBudgetExceeded extends Error {
  constructor(readonly dimension: string) {
    super(`HISTORY_LIMIT_EXCEEDED: ${dimension}`);
  }
}

/** Per-request bounded accumulation. No transcript or large serialized copy is retained. */
export class HistoryBudget {
  readonly limits: HistoryBudgetLimits;
  private pages = 0;
  private entries = 0;
  private bytes = 0;
  private readonly partial: boolean;
  constructor(
    limits: Partial<HistoryBudgetLimits> = {},
    options: { partial?: boolean } = {},
  ) {
    this.limits = { ...DEFAULT_HISTORY_BUDGET, ...limits };
    this.partial = options.partial === true;
    for (const [name, value] of Object.entries(this.limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`Invalid history budget ${name}`);
  }
  private exceeded(dimension: string): never {
    if (this.partial) throw new HistoryBudgetExceeded(dimension);
    throw new HttpError(
      413,
      `HISTORY_LIMIT_EXCEEDED: ${dimension}; 完整历史超出安全读取预算，请使用 /api/codex/thread/turns/list 或 /api/codex/thread/items/list 分页读取。`,
    );
  }
  beginPage() {
    if (++this.pages > this.limits.maxPages)
      this.exceeded(`page limit ${this.limits.maxPages}`);
  }
  add(value: Json) {
    this.visit(value, 0);
  }
  private size(bytes: number) {
    this.bytes += bytes;
    if (this.bytes > this.limits.maxBytes)
      this.exceeded(`byte limit ${this.limits.maxBytes}`);
  }
  private text(text: string) {
    // UTF-8 byte count does not create the otherwise potentially huge JSON.stringify copy.
    this.size(2 + Buffer.byteLength(text));
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92) this.size(1);
      else if (code < 32) this.size([8, 9, 10, 12, 13].includes(code) ? 1 : 5);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) i++;
        else this.size(3);
      } else if (code >= 0xdc00 && code <= 0xdfff) this.size(3);
    }
  }
  private visit(value: Json, depth: number): void {
    if (++this.entries > this.limits.maxEntries)
      this.exceeded(`entry limit ${this.limits.maxEntries}`);
    if (depth > this.limits.maxDepth)
      this.exceeded(`nesting limit ${this.limits.maxDepth}`);
    if (typeof value === "string") {
      this.text(value);
      return;
    }
    if (value === null) {
      this.size(4);
      return;
    }
    if (typeof value === "boolean") {
      this.size(value ? 4 : 5);
      return;
    }
    if (typeof value === "number") {
      this.size(Number.isFinite(value) ? String(value).length : 4);
      return;
    }
    this.size(2);
    let first = true;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (!first) this.size(1);
        first = false;
        this.visit(child, depth + 1);
      }
    } else {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (!first) this.size(1);
        first = false;
        this.text(key);
        this.size(1);
        this.visit(value[key]!, depth + 1);
      }
    }
  }
}
