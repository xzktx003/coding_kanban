import { none } from "stream-chain";
import type { Token } from "stream-json/parser.js";
import stringer from "stream-json/stringer.js";
import { HttpError, isObject } from "../core/json.js";

export interface DetailRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  expectedType: "commandExecution" | "mcpToolCall" | "fileChange";
}
export function detailRequest(body: unknown): DetailRequest {
  if (
    !isObject(body) ||
    Object.keys(body).length !== 4 ||
    Object.keys(body).some(
      (k) => !["threadId", "turnId", "itemId", "expectedType"].includes(k),
    )
  )
    throw new HttpError(400, "DETAIL_INVALID_REQUEST");
  for (const k of ["threadId", "turnId", "itemId"])
    if (
      typeof body[k] !== "string" ||
      !body[k] ||
      body[k].length > 512 ||
      /[\x00-\x1f\x7f-\x9f]/.test(body[k])
    )
      throw new HttpError(400, "DETAIL_INVALID_REQUEST");
  if (
    typeof body.expectedType !== "string" ||
    !["commandExecution", "mcpToolCall", "fileChange"].includes(
      body.expectedType,
    )
  )
    throw new HttpError(400, "DETAIL_INVALID_REQUEST");
  return body as unknown as DetailRequest;
}
const bad = () => new HttpError(502, "DETAIL_PROTOCOL_ERROR");
type Role =
  | "rpc"
  | "result"
  | "thread"
  | "turns"
  | "turn"
  | "items"
  | "item"
  | "error"
  | "discard";
interface Frame {
  role: Role;
  array: boolean;
  key: string;
  seen: Set<string>;
  id?: string;
  type?: string;
  selected?: boolean;
  matching?: boolean;
  rpcId?: string;
  method?: string;
  code?: string;
  unsupportedMethod?: boolean;
}
const controls: Partial<Record<Role, string[]>> = {
  rpc: ["id", "jsonrpc", "method", "params", "result", "error", "emittedAtMs"],
  result: ["thread"],
  thread: ["id", "turns"],
  turn: ["id", "items"],
  item: ["type", "id"],
  error: ["code", "message"],
};
const keyTokens = (value: string): Token[] => [
  { name: "startKey" },
  { name: "stringChunk", value },
  { name: "endKey" },
];
const textTokens = (value: string): Token[] => [
  { name: "startString" },
  { name: "stringChunk", value },
  { name: "endString" },
];
/** Bounded structural adapter, never builds native values. Body keys/values are discarded or replayed token by token. */
export class DetailSelector {
  private stack: Frame[] = [];
  private scalar?: {
    kind: "key" | "string" | "number";
    text: string;
    capture: boolean;
  };
  private replayDepth = 0;
  private found = false;
  private matchedTurn = false;
  private initialized = false;
  private complete = false;
  private stringify = stringer({
    useValues: false,
    useKeyValues: false,
    useStringValues: false,
    useNumberValues: false,
    makeArray: false,
  });
  constructor(
    private wanted: DetailRequest,
    private onInitialized: () => void,
    private onSelected: () => void,
  ) {}
  get done() {
    return this.complete;
  }
  private encode(tokens: Token[]): Buffer[] {
    const out: Buffer[] = [];
    for (const token of tokens) {
      const s = this.stringify(token);
      if (s === none) continue;
      if (typeof s !== "string") throw bad();
      if (s)
        out.push(
          Buffer.from(
            s.replace(
              /[\ud800-\udfff]/g,
              (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
            ),
          ),
        );
    }
    return out;
  }
  private field(f: Frame, key: string) {
    if (controls[f.role]?.includes(key)) {
      if (f.seen.has(key)) throw bad();
      f.seen.add(key);
    }
    if (
      f.role === "rpc" &&
      ["result", "error"].includes(key) &&
      f.rpcId === undefined
    )
      throw bad();
    if (
      (f.role === "thread" || f.role === "turn") &&
      key !== "id" &&
      f.id === undefined
    )
      throw bad();
    if (
      f.role === "item" &&
      ((f.type === undefined && key !== "type") ||
        (f.type !== undefined && f.id === undefined && key !== "id"))
    )
      throw bad();
    if (f.role === "rpc" && !controls.rpc!.includes(key)) throw bad();
  }
  private captured(f: Frame) {
    return (controls[f.role] ?? []).includes(f.key);
  }
  private value(f: Frame, kind: string, value: string) {
    if (f.role === "turns" || f.role === "items") throw bad();
    if (!this.captured(f)) return;
    if (f.key === "id") {
      if (f.role === "rpc") {
        if (
          kind !== "number" ||
          !["1", "2"].includes(value) ||
          (!this.initialized && value !== "1") ||
          (this.initialized && value !== "2")
        )
          throw bad();
        f.rpcId = value;
        return;
      }
      if (
        kind !== "string" ||
        !value ||
        value.length > 512 ||
        /[\x00-\x1f\x7f-\x9f]/.test(value)
      )
        throw bad();
      f.id = value;
      if (f.role === "thread" && value !== this.wanted.threadId)
        throw new HttpError(409, "DETAIL_IDENTITY_CHANGED");
      if (f.role === "turn") {
        f.matching = value === this.wanted.turnId;
        if (f.matching) {
          if (this.matchedTurn) throw bad();
          this.matchedTurn = true;
        }
      }
      if (f.role === "item" && f.matching && value === this.wanted.itemId) {
        if (this.found) throw bad();
        if (f.type !== this.wanted.expectedType)
          throw new HttpError(409, "DETAIL_IDENTITY_CHANGED");
        f.selected = true;
      }
    } else if (f.role === "item" && f.key === "type") {
      if (kind !== "string" || !value) throw bad();
      f.type = value;
    } else if (f.role === "rpc" && f.key === "jsonrpc") {
      if (kind !== "string" || value !== "2.0") throw bad();
    } else if (f.role === "rpc" && f.key === "emittedAtMs") {
      if (kind !== "number" || !/^-[0-9]+$|^[0-9]+$/.test(value)) throw bad();
    } else if (f.role === "rpc" && f.key === "method") {
      if (kind !== "string" || !value) throw bad();
      f.method = value;
    } else if (f.role === "error" && f.key === "message") {
      if (kind !== "string") throw bad();
      f.unsupportedMethod =
        /unknown variant|unknown method/.test(value) &&
        value.includes("thread/read");
    } else if (f.role === "error" && f.key === "code") {
      if (kind !== "number" || !/^-[0-9]+$|^[0-9]+$/.test(value)) throw bad();
      f.code = value;
    } else throw bad();
  }
  private childRole(p: Frame | undefined, array: boolean): Role {
    if (!p) {
      if (array || this.complete) throw bad();
      return "rpc";
    }
    if (p.role === "rpc" && p.key === "result") {
      if (array || p.seen.has("error") || p.method) throw bad();
      return p.rpcId === "2" ? "result" : "discard";
    }
    if (p.role === "rpc" && p.key === "error") {
      if (array || p.seen.has("result") || p.method) throw bad();
      return "error";
    }
    if (p.role === "result" && p.key === "thread") {
      if (array) throw bad();
      return "thread";
    }
    if (p.role === "thread" && p.key === "turns") {
      if (!array || !p.id) throw bad();
      return "turns";
    }
    if (p.role === "turns") {
      if (array) throw bad();
      return "turn";
    }
    if (p.role === "turn" && p.key === "items") {
      if (!array || !p.id) throw bad();
      return "items";
    }
    if (p.role === "items") {
      if (array) throw bad();
      return "item";
    }
    if (this.captured(p) && !(p.role === "rpc" && p.key === "params"))
      throw bad();
    return "discard";
  }
  consume(token: Token): Buffer[] {
    let output: Token[] = [];
    let f = this.stack.at(-1);
    const wasReplay = this.replayDepth > 0;
    if (wasReplay) output.push(token);
    const name = token.name;
    if (name === "startKey") {
      if (!f || f.array || this.scalar) throw bad();
      this.scalar = { kind: "key", text: "", capture: f.role !== "discard" };
    } else if (name === "startString" || name === "startNumber") {
      if (!f || this.scalar || f.role === "turns" || f.role === "items")
        throw bad();
      this.scalar = {
        kind: name === "startString" ? "string" : "number",
        text: "",
        capture: this.captured(f),
      };
    } else if (name === "stringChunk" || name === "numberChunk") {
      if (!this.scalar) throw bad();
      if (this.scalar.capture) {
        this.scalar.text += token.value;
        if (this.scalar.text.length > 512) {
          if (f?.role === "error" && f.key === "message") {
            this.scalar.text = this.scalar.text.slice(0, 512);
          } else if (this.scalar.kind === "key") {
            this.scalar.capture = false;
            this.scalar.text = "";
          } else throw bad();
        }
      }
    } else if (name === "endKey") {
      if (!f || this.scalar?.kind !== "key") throw bad();
      f.key = this.scalar.capture ? this.scalar.text : "";
      this.scalar = undefined;
      this.field(f, f.key);
    } else if (name === "endString" || name === "endNumber") {
      if (!f || !this.scalar) throw bad();
      const scalar = this.scalar;
      this.scalar = undefined;
      if (scalar.capture) this.value(f, scalar.kind, scalar.text);
      if (f.selected && !this.found) {
        this.found = true;
        this.replayDepth = this.stack.length;
        this.onSelected();
        output = [
          { name: "startObject" },
          ...keyTokens("threadId"),
          ...textTokens(this.wanted.threadId),
          ...keyTokens("turnId"),
          ...textTokens(this.wanted.turnId),
          ...keyTokens("itemId"),
          ...textTokens(this.wanted.itemId),
          ...keyTokens("item"),
          { name: "startObject" },
          ...keyTokens("type"),
          ...textTokens(f.type!),
          ...keyTokens("id"),
          ...textTokens(f.id!),
        ];
      }
    } else if (name === "startObject" || name === "startArray") {
      if (this.scalar || this.stack.length >= 128) throw bad();
      const role = this.childRole(f, name === "startArray");
      this.stack.push({
        role,
        array: name === "startArray",
        key: "",
        seen: new Set(),
        matching:
          role === "items"
            ? f?.matching
            : role === "item"
              ? f?.matching
              : undefined,
      });
    } else if (name === "endObject" || name === "endArray") {
      if (!f || this.scalar || f.array !== (name === "endArray")) throw bad();
      if (f.role === "thread" && (!f.id || !f.seen.has("turns"))) throw bad();
      if (f.role === "turn" && (!f.id || !f.seen.has("items"))) throw bad();
      if (f.role === "item" && (!f.id || !f.type)) throw bad();
      if (f.role === "result" && !f.seen.has("thread")) throw bad();
      if (f.role === "error") {
        if (!f.code) throw bad();
        this.stack[this.stack.length - 2]!.code = f.code;
        this.stack[this.stack.length - 2]!.unsupportedMethod =
          f.unsupportedMethod;
      }
      if (this.replayDepth === this.stack.length) this.replayDepth = 0;
      this.stack.pop();
      if (f.role === "rpc") {
        if (f.method) {
          if (
            f.rpcId !== undefined ||
            f.seen.has("result") ||
            f.seen.has("error")
          )
            throw bad();
        } else {
          if (f.seen.has("emittedAtMs") || f.seen.has("params")) throw bad();
          if (!f.rpcId || (!f.seen.has("result") && !f.seen.has("error")))
            throw bad();
          if (f.seen.has("error"))
            throw new HttpError(
              f.code === "-32601" ||
                (f.code === "-32600" && f.unsupportedMethod)
                ? 501
                : 502,
              f.code === "-32601" ||
                (f.code === "-32600" && f.unsupportedMethod)
                ? "DETAIL_UNSUPPORTED"
                : "DETAIL_NATIVE_ERROR",
            );
          if (f.rpcId === "1") {
            this.initialized = true;
            this.onInitialized();
          } else {
            if (!this.found) throw new HttpError(404, "DETAIL_NOT_FOUND");
            this.complete = true;
            output.push({ name: "endObject" });
          }
        }
      }
    } else if (
      name === "nullValue" ||
      name === "trueValue" ||
      name === "falseValue"
    ) {
      if (!f || this.scalar) throw bad();
      this.value(f, "literal", name);
    } else throw bad();
    return this.encode(output);
  }
  end() {
    if (!this.complete || this.stack.length || this.scalar) throw bad();
  }
}
