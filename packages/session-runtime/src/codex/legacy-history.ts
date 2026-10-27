import type { Token } from "stream-json/parser.js";
import type { CodexOptions } from "./client.js";
import { HttpError, isObject, type Json } from "../core/json.js";
import {
  DEFAULT_HISTORY_BUDGET,
  HistoryBudget,
  type HistoryBudgetLimits,
} from "../core/history-budget.js";
import { readNativeProjection } from "./item-detail.js";
import { sanitizeCodexHistory } from "./projection.js";

const bad = () => new HttpError(502, "LEGACY_HISTORY_PROTOCOL_ERROR");
const tooLarge = (maxBytes: number) =>
  new HttpError(
    413,
    `HISTORY_LIMIT_EXCEEDED: byte limit ${maxBytes}; 完整历史超出安全读取预算，请使用 /api/codex/thread/turns/list 或 /api/codex/thread/items/list 分页读取。`,
  );
type Frame = { value: any; array: boolean; key: string; seen: Set<string> };

/** One legacy transcript, assembled off the shared Agent transport. */
export class LegacyHistorySelector {
  private stack: Frame[] = [];
  private scalar?: { kind: "key" | "string" | "number"; text: string };
  private initialized = false;
  private complete = false;
  private value: Json = null;
  private readonly budget: HistoryBudget;
  private readonly maxScalarBytes: number;
  private scalarBytes = 0;
  constructor(
    private readonly onInitialized: () => void,
    private readonly onReady: () => void,
    limits: Partial<HistoryBudgetLimits> = {},
  ) {
    this.budget = new HistoryBudget(limits);
    this.maxScalarBytes = limits.maxBytes ?? DEFAULT_HISTORY_BUDGET.maxBytes;
  }
  get done() {
    return this.complete;
  }
  get thread(): Json {
    return this.value;
  }
  consume(token: Token): Buffer[] {
    const name = token.name;
    const parent = this.stack.at(-1);
    if (name === "startObject" || name === "startArray") {
      if (this.scalar || this.stack.length >= 128 || this.complete) throw bad();
      if (!parent && name !== "startObject") throw bad();
      this.budget.add(null);
      this.stack.push({
        value: name === "startArray" ? [] : Object.create(null),
        array: name === "startArray",
        key: "",
        seen: new Set(),
      });
    } else if (
      name === "startKey" ||
      name === "startString" ||
      name === "startNumber"
    ) {
      if (!parent || this.scalar || (name === "startKey" && parent.array))
        throw bad();
      this.scalar = {
        kind:
          name === "startKey"
            ? "key"
            : name === "startString"
              ? "string"
              : "number",
        text: "",
      };
      this.scalarBytes = 0;
    } else if (name === "stringChunk" || name === "numberChunk") {
      if (!this.scalar) throw bad();
      this.scalarBytes += Buffer.byteLength(token.value);
      if (
        this.scalar.kind !== "key" &&
        this.scalarBytes > this.maxScalarBytes
      )
        throw tooLarge(this.maxScalarBytes);
      this.scalar.text += token.value;
      if (this.scalar.kind === "key" && this.scalar.text.length > 512)
        throw bad();
    } else if (
      name === "endKey" ||
      name === "endString" ||
      name === "endNumber"
    ) {
      if (!parent || !this.scalar) throw bad();
      const scalar = this.scalar;
      this.scalar = undefined;
      this.scalarBytes = 0;
      if (name === "endKey") {
        if (scalar.kind !== "key" || parent.seen.has(scalar.text)) throw bad();
        parent.key = scalar.text;
        parent.seen.add(scalar.text);
      } else
        this.put(
          parent,
          scalar.kind === "number" ? Number(scalar.text) : scalar.text,
        );
    } else if (["nullValue", "trueValue", "falseValue"].includes(name)) {
      if (!parent || this.scalar) throw bad();
      this.put(parent, name === "nullValue" ? null : name === "trueValue");
    } else if (name === "endObject" || name === "endArray") {
      if (!parent || this.scalar || parent.array !== (name === "endArray"))
        throw bad();
      this.stack.pop();
      if (this.stack.length) this.put(this.stack.at(-1)!, parent.value);
      else this.finish(parent.value);
    } else throw bad();
    return [];
  }
  end() {
    if (!this.complete || this.stack.length || this.scalar) throw bad();
  }
  private put(parent: Frame, value: unknown) {
    this.budget.add(typeof value === "string" ? value : null);
    if (parent.array) parent.value.push(value);
    else
      Object.defineProperty(parent.value, parent.key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  private finish(message: any) {
    if (
      typeof message?.method === "string" &&
      message.id === undefined &&
      !Object.hasOwn(message, "result") &&
      !Object.hasOwn(message, "error")
    )
      return;
    if (
      message?.id !== (this.initialized ? 2 : 1) ||
      Object.hasOwn(message, "result") === Object.hasOwn(message, "error") ||
      message.method !== undefined
    )
      throw bad();
    if (message.error)
      throw new HttpError(
        message.error.code === -32601 ? 501 : 502,
        message.error.code === -32601
          ? "LEGACY_HISTORY_UNSUPPORTED"
          : "LEGACY_HISTORY_NATIVE_ERROR",
      );
    if (!this.initialized) {
      if (!isObject(message.result)) throw bad();
      this.initialized = true;
      this.onInitialized();
      return;
    }
    const thread = isObject(message.result) ? message.result.thread : undefined;
    if (!isObject(thread) || !Array.isArray(thread.turns)) throw bad();
    this.value = sanitizeCodexHistory(message.result);
    this.complete = true;
    this.onReady();
  }
}

/** Shared metadata decides the mode. A legacy body never shares the live Agent pipe. */
export async function readLegacyHistory(
  raw: (method: string, params: Json) => Promise<Json>,
  options: Pick<CodexOptions, "env" | "resolveEnv" | "launch">,
  id: string,
  limits: Partial<HistoryBudgetLimits> = {},
): Promise<Json> {
  const metadata = await raw("thread/read", {
    threadId: id,
    includeTurns: false,
  });
  new HistoryBudget(limits).add(metadata);
  const thread = isObject(metadata) ? metadata.thread : undefined;
  if (!isObject(thread)) throw bad();
  if (thread.historyMode === "paginated") return metadata;
  let selector!: LegacyHistorySelector;
  const reading = await readNativeProjection(
    options,
    {
      channel: "legacy",
      method: "thread/read",
      params: { threadId: id, includeTurns: true },
      selector: (initialized, ready) =>
        (selector = new LegacyHistorySelector(initialized, ready, limits)),
    },
    AbortSignal.timeout(120_000),
  );
  try {
    for await (const _chunk of reading.body) {
      /* The accepted response stays in the selector; projected stdout is empty. */
    }
  } finally {
    await reading.finished.catch(() => undefined);
  }
  if (!selector?.done) throw bad();
  return selector.thread;
}
