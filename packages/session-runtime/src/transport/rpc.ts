import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { isObject, object, type Json, type JsonObject } from "../core/json.js";

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: Json,
  ) {
    super(message);
  }
}

export interface ServerRequest {
  id: string | number;
  method: string;
  params: Json;
}
interface RpcOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  jsonrpc?: boolean;
  maxFrameBytes?: number;
  maxQueuedBytes?: number;
  onNotification?: (message: JsonObject) => void;
  onRequest?: (request: ServerRequest) => void | Promise<void>;
  onDiagnostic?: (message: string) => void;
  onExit?: (error: Error) => void;
}
interface Pending {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/** Newline JSON-RPC over an explicitly owned process. Never restarts or replays requests. */
export class StdioRpc {
  readonly child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private failure?: Error;
  private writes: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private stderrTail = "";
  private readonly maxFrameBytes: number;
  private readonly exited: Promise<void>;

  constructor(private readonly options: RpcOptions) {
    if (
      !options.command ||
      /[\x00-\x1f]/.test(options.command) ||
      options.args.some((s) => s.includes("\0"))
    )
      throw new Error("Invalid process command or arguments");
    if (
      options.cwd &&
      (!isAbsolute(options.cwd) || /[\x00-\x1f]/.test(options.cwd))
    )
      throw new Error("Invalid process working directory");
    this.maxFrameBytes = options.maxFrameBytes ?? 32 * 1024 * 1024;
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.exited = new Promise((resolve) =>
      this.child.once("close", () => resolve()),
    );
    this.child.on("error", (error) =>
      this.fail(
        new Error(`DELIVERY_UNKNOWN: process failed: ${error.message}`),
      ),
    );
    this.child.on("exit", (code, signal) =>
      this.fail(
        new Error(`DELIVERY_UNKNOWN: process exited (${signal ?? code})`),
      ),
    );
    this.child.stdin.on("error", (error) =>
      this.fail(new Error(`DELIVERY_UNKNOWN: stdin failed: ${error.message}`)),
    );
    this.child.stdout.on("error", (error) =>
      this.fail(new Error(`DELIVERY_UNKNOWN: stdout failed: ${error.message}`)),
    );
    this.child.stdout.on("end", () =>
      this.fail(new Error("DELIVERY_UNKNOWN: protocol stream ended")),
    );
    this.child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    this.child.stderr.on("error", () => undefined);
    this.child.stderr.on("data", (chunk: Buffer) => {
      // Logging must not retain arbitrary process output or block draining stderr.
      this.stderrTail += chunk.toString("utf8");
      let newline: number;
      while ((newline = this.stderrTail.indexOf("\n")) >= 0) {
        this.diagnostic(this.stderrTail.slice(0, newline));
        this.stderrTail = this.stderrTail.slice(newline + 1);
      }
      if (this.stderrTail.length > 8192) {
        this.diagnostic(this.stderrTail);
        this.stderrTail = "";
      }
    });
  }

  get pendingCount(): number {
    return this.pending.size;
  }
  get available(): boolean {
    return !this.failure;
  }

  private diagnostic(message: string): void {
    try {
      this.options.onDiagnostic?.(message.slice(0, 8192));
    } catch {
      /* Observer cannot break protocol IO. */
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.fragments = [];
    this.fragmentBytes = 0;
    this.stderrTail = "";
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    try {
      this.options.onExit?.(error);
    } catch {
      /* Observers cannot keep promises pending. */
    }
  }

  private consume(chunk: Buffer): void {
    if (this.failure) return;
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      this.fragmentBytes += part.length;
      if (this.fragmentBytes > this.maxFrameBytes) {
        this.fail(new Error("DELIVERY_UNKNOWN: RPC frame exceeded byte limit"));
        this.child.kill("SIGTERM");
        return;
      }
      // Copy partial views: short tail slices must not retain previous huge buffers.
      if (part.length) this.fragments.push(Buffer.from(part));
      if (newline < 0) return;
      const line = Buffer.concat(this.fragments, this.fragmentBytes).toString(
        "utf8",
      );
      this.fragments = [];
      this.fragmentBytes = 0;
      if (line.trim()) this.message(line);
      start = newline + 1;
    }
  }

  private message(line: string): void {
    let message: JsonObject;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isObject(parsed)) throw new Error("Expected object");
      message = parsed;
    } catch {
      this.diagnostic("Invalid JSON-RPC message received");
      return;
    }
    const id = message.id;
    const hasId = typeof id === "string" || Number.isSafeInteger(id);
    if (typeof message.method === "string") {
      if (hasId) {
        const request = {
          id: id as string | number,
          method: message.method,
          params: message.params ?? null,
        };
        Promise.resolve()
          .then(async () => {
            if (this.options.onRequest) await this.options.onRequest(request);
            else
              await this.respondError(
                request.id,
                -32601,
                "Unsupported server request",
              );
          })
          .catch((error) =>
            this.diagnostic(`Server request handler failed: ${String(error)}`),
          );
      } else {
        try {
          this.options.onNotification?.(message);
        } catch (error) {
          this.diagnostic(`Notification handler failed: ${String(error)}`);
        }
      }
      return;
    }
    if (!hasId || !("result" in message || "error" in message)) return;
    const key = JSON.stringify(id);
    const pending = this.pending.get(key);
    if (!pending) return; // Includes a timed-out request's late response.
    this.pending.delete(key);
    pending.cleanup();
    if ("error" in message) {
      const error = object(message.error);
      pending.reject(
        new RpcError(
          typeof error.message === "string"
            ? error.message
            : "RPC request failed",
          typeof error.code === "number" ? error.code : -32603,
          error.data,
        ),
      );
    } else pending.resolve(message.result);
  }

  private write(
    value: JsonObject,
    stillNeeded: () => boolean = () => true,
  ): Promise<void> {
    if (this.failure)
      return Promise.reject(new Error("NOT_SENT: RPC transport unavailable"));
    const frame = Buffer.from(
      JSON.stringify(
        this.options.jsonrpc ? { jsonrpc: "2.0", ...value } : value,
      ) + "\n",
    );
    if (
      frame.length > this.maxFrameBytes ||
      this.queuedBytes + frame.length >
        (this.options.maxQueuedBytes ?? 32 * 1024 * 1024)
    )
      return Promise.reject(
        new Error("NOT_SENT: RPC write queue exceeded byte limit"),
      );
    this.queuedBytes += frame.length;
    const work = this.writes
      .then(async () => {
        if (!stillNeeded()) return;
        if (this.failure)
          throw new Error("NOT_SENT: RPC transport unavailable");
        await new Promise<void>((resolve, reject) => {
          this.child.stdin.write(frame, (error) =>
            error
              ? reject(new Error(`DELIVERY_UNKNOWN: ${error.message}`))
              : resolve(),
          );
        });
      })
      .finally(() => {
        this.queuedBytes -= frame.length;
      });
    this.writes = work.catch(() => undefined);
    return work;
  }

  request(
    method: string,
    params: Json,
    options: { timeoutMs?: number; signal?: AbortSignal; beforeSend?: () => void } = {},
  ): Promise<Json> {
    if (this.failure)
      return Promise.reject(new Error("NOT_SENT: RPC transport unavailable"));
    if (options.signal?.aborted)
      return Promise.reject(new Error("NOT_SENT: RPC request aborted"));
    const id = this.nextId++;
    const key = JSON.stringify(id);
    return new Promise((resolve, reject) => {
      let dispatched = false;
      const fail = (message: string) => {
        const pending = this.pending.get(key);
        if (!pending) return;
        this.pending.delete(key);
        pending.cleanup();
        reject(new Error(message));
      };
      const timer = setTimeout(
        () => fail(options.beforeSend && !dispatched ? "NOT_SENT: RPC dispatch queue timeout" : "DELIVERY_UNKNOWN: RPC response timeout"),
        options.timeoutMs ?? 30_000,
      );
      const aborted = () => fail(options.beforeSend && !dispatched ? "NOT_SENT: RPC request aborted before dispatch" : "DELIVERY_UNKNOWN: RPC response wait aborted");
      options.signal?.addEventListener("abort", aborted, { once: true });
      this.pending.set(key, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", aborted);
        },
      });
      this.write({ id, method, params }, () => {
        if (!this.pending.has(key)) return false;
        options.beforeSend?.();
        dispatched = true;
        return true;
      }).catch(
        (error) => fail(String(error.message ?? error)),
      );
    });
  }

  notify(method: string, params?: Json): Promise<void> {
    return this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: string | number, result: Json): Promise<void> {
    return this.write({ id, result });
  }
  respondError(
    id: string | number,
    code: number,
    message: string,
  ): Promise<void> {
    return this.write({ id, error: { code, message } });
  }

  async close(): Promise<void> {
    this.fail(new Error("DELIVERY_UNKNOWN: RPC transport closed"));
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      return this.exited;
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      this.child.kill("SIGKILL");
    }, 2_000);
    try {
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
