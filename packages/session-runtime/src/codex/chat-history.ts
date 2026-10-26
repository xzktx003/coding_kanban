import { projectCodexChatValue } from "@agent-orchestrator/shared";
import type { Token } from "stream-json/parser.js";
import { HttpError, isObject } from "../core/json.js";

export const CHAT_HISTORY_BYTES = 16 * 1024 * 1024;
const bad = () => new HttpError(502, "CHAT_HISTORY_PROTOCOL_ERROR");
const limit = () => new HttpError(413, "CHAT_HISTORY_LIMIT_EXCEEDED");
export function chatHistoryRequest(body: unknown) {
  if (
    !isObject(body) ||
    Object.keys(body).some(
      (k) =>
        !["threadId", "cursor", "limit", "sortDirection", "itemsView"].includes(
          k,
        ),
    )
  )
    throw new HttpError(400, "CHAT_HISTORY_INVALID_REQUEST");
  if (
    typeof body.threadId !== "string" ||
    !body.threadId ||
    body.threadId.length > 512 ||
    /[\x00-\x1f\x7f-\x9f]/.test(body.threadId) ||
    (body.cursor != null &&
      (typeof body.cursor !== "string" ||
        body.cursor.length > 4096 ||
        /[\x00-\x1f]/.test(body.cursor))) ||
    (body.limit !== undefined &&
      (!Number.isInteger(body.limit) ||
        Number(body.limit) < 1 ||
        Number(body.limit) > 100)) ||
    (body.sortDirection !== undefined &&
      !["asc", "desc"].includes(String(body.sortDirection))) ||
    (body.itemsView !== undefined &&
      !["full", "summary"].includes(String(body.itemsView)))
  )
    throw new HttpError(400, "CHAT_HISTORY_INVALID_REQUEST");
  return {
    threadId: body.threadId,
    cursor: body.cursor ?? null,
    limit: body.limit ?? 10,
    sortDirection: body.sortDirection ?? "desc",
    itemsView: body.itemsView ?? "full",
  };
}

type Frame = {
  value: any;
  array: boolean;
  key: string;
  skip: boolean;
  mcpResult: boolean;
  seen: Set<string>;
  startBytes: number;
};
const projectedTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageView",
  "imageGeneration",
  "reasoning",
]);
class EncodedTool {
  readonly bytes: Buffer;
  constructor(value: unknown) {
    this.bytes = Buffer.from(JSON.stringify(value));
  }
}
function encodePage(value: unknown): Buffer {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const add = (value: string | Buffer) => {
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    bytes += chunk.length;
    if (bytes > CHAT_HISTORY_BYTES) throw limit();
    chunks.push(chunk);
  };
  const visit = (value: unknown) => {
    if (value instanceof EncodedTool) add(value.bytes);
    else if (Array.isArray(value)) {
      add("[");
      value.forEach((entry, i) => {
        if (i) add(",");
        visit(entry);
      });
      add("]");
    } else if (value && typeof value === "object") {
      add("{");
      Object.entries(value).forEach(([key, entry], i) => {
        if (i) add(",");
        add(JSON.stringify(key));
        add(":");
        visit(entry);
      });
      add("}");
    } else add(JSON.stringify(value));
  };
  visit(value);
  return Buffer.concat(chunks, bytes);
}
/** Parse one page with the existing chat projection. Discard private tool bodies
 * while tokens arrive, before building strings; never touch the Agent transport. */
export class ChatHistorySelector {
  private stack: Frame[] = [];
  private scalar?: {
    kind: "key" | "string" | "number";
    text: string;
    skip: boolean;
  };
  private bytes = 0;
  private initialized = false;
  private complete = false;
  constructor(
    private readonly onInitialized: () => void,
    private readonly onReady: () => void,
  ) {}
  get done() {
    return this.complete;
  }
  private budget(bytes: number) {
    this.bytes += bytes;
    if (this.bytes > CHAT_HISTORY_BYTES) throw limit();
  }
  private discard(parent?: Frame) {
    return Boolean(
      parent &&
      (parent.skip ||
        (parent.value.type === "commandExecution" &&
          parent.key === "aggregatedOutput") ||
        (parent.value.type === "reasoning" && parent.key === "content") ||
        (parent.mcpResult &&
          ["content", "structuredContent"].includes(parent.key))),
    );
  }
  private put(parent: Frame, value: unknown) {
    if (parent.skip) return;
    if (parent.array) parent.value.push(value);
    else
      Object.defineProperty(parent.value, parent.key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  consume(token: Token): Buffer[] {
    const name = token.name,
      parent = this.stack.at(-1);
    if (name === "startObject" || name === "startArray") {
      if (this.scalar || this.stack.length >= 128 || this.complete) throw bad();
      if (!parent && name !== "startObject") throw bad();
      const skip = this.discard(parent),
        array = name === "startArray";
      const startBytes = this.bytes;
      if (!skip) this.budget(64);
      const value = array ? [] : Object.create(null);
      this.stack.push({
        value,
        array,
        key: "",
        skip,
        mcpResult: Boolean(
          parent?.value.type === "mcpToolCall" && parent.key === "result",
        ),
        seen: new Set(),
        startBytes,
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
        skip: name === "startKey" ? parent.skip : this.discard(parent),
      };
      if (!this.scalar.skip) this.budget(name === "startKey" ? 64 : 24);
    } else if (name === "stringChunk" || name === "numberChunk") {
      if (!this.scalar) throw bad();
      if (!this.scalar.skip) {
        this.budget(token.value.length * 2);
        this.scalar.text += token.value;
        if (this.scalar.kind === "key" && this.scalar.text.length > 512)
          throw bad();
      }
    } else if (
      name === "endKey" ||
      name === "endString" ||
      name === "endNumber"
    ) {
      if (!parent || !this.scalar) throw bad();
      const scalar = this.scalar;
      this.scalar = undefined;
      if (name === "endKey") {
        if (scalar.kind !== "key") throw bad();
        parent.key = scalar.text;
        if (!parent.skip) {
          if (parent.seen.has(parent.key)) throw bad();
          parent.seen.add(parent.key);
        }
      } else {
        if (scalar.kind !== (name === "endString" ? "string" : "number"))
          throw bad();
        this.put(
          parent,
          scalar.skip
            ? null
            : scalar.kind === "number"
              ? Number(scalar.text)
              : scalar.text,
        );
      }
    } else if (["nullValue", "trueValue", "falseValue"].includes(name)) {
      if (!parent || this.scalar) throw bad();
      if (!parent.skip) this.budget(8);
      this.put(parent, name === "nullValue" ? null : name === "trueValue");
    } else if (name === "endObject" || name === "endArray") {
      if (!parent || this.scalar || parent.array !== (name === "endArray"))
        throw bad();
      this.stack.pop();
      if (this.stack.length) {
        let value = parent.skip ? null : parent.value;
        if (!parent.skip && projectedTypes.has(parent.value.type)) {
          // Dense turns may contain thousands of tool objects. Retain their
          // already projected bytes, not a second full object graph per item.
          value = new EncodedTool(projectCodexChatValue(value));
          this.bytes = parent.startBytes;
          this.budget(value.bytes.length + 64);
        }
        this.put(this.stack.at(-1)!, value);
      }
      if (!this.stack.length) {
        const message = parent.value;
        this.bytes = 0;
        // Read-only native notifications do not alter the response or authorize writes.
        if (
          typeof message.method === "string" &&
          message.id === undefined &&
          !Object.hasOwn(message, "result") &&
          !Object.hasOwn(message, "error")
        )
          return [];
        if (
          message.id !== (this.initialized ? 2 : 1) ||
          Object.hasOwn(message, "result") ===
            Object.hasOwn(message, "error") ||
          message.method !== undefined
        )
          throw bad();
        if (message.error)
          throw new HttpError(
            message.error.code === -32601 ? 501 : 502,
            message.error.code === -32601
              ? "CHAT_HISTORY_UNSUPPORTED"
              : "CHAT_HISTORY_NATIVE_ERROR",
          );
        if (!this.initialized) {
          if (!isObject(message.result)) throw bad();
          this.initialized = true;
          this.onInitialized();
        } else {
          const page = message.result;
          if (
            !isObject(page) ||
            !Array.isArray(page.data) ||
            page.data.some(
              (t) =>
                !isObject(t) ||
                typeof t.id !== "string" ||
                !Array.isArray(t.items),
            ) ||
            (page.nextCursor != null && typeof page.nextCursor !== "string")
          )
            throw bad();
          const bounded = encodePage(page);
          const output = Buffer.from(
            JSON.stringify(
              projectCodexChatValue(JSON.parse(bounded.toString("utf8"))),
            ),
          );
          if (output.length > CHAT_HISTORY_BYTES) throw limit();
          this.complete = true;
          this.onReady();
          const chunks: Buffer[] = [];
          for (let offset = 0; offset < output.length; offset += 4096)
            chunks.push(output.subarray(offset, offset + 4096));
          return chunks;
        }
      }
    } else throw bad();
    return [];
  }
  end() {
    if (!this.complete || this.stack.length || this.scalar) throw bad();
  }
}
