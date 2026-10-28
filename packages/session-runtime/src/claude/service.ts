import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  query,
  forkSession,
  renameSession,
  type Options,
  type Query,
  type SDKUserMessage,
  type HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import type { EventHub } from "../core/events.js";
import {
  HttpError,
  bodyObject,
  object,
  type JsonObject,
} from "../core/json.js";
import { KeyedSerial } from "../core/serial.js";
import { ClaudeConfig, absolutePath, validateMcpConfig } from "./config.js";
import { ClaudeHistory, validateSessionId } from "./history.js";
import { ClaudeUsage } from "./usage.js";

class Input implements AsyncIterableIterator<SDKUserMessage> {
  private pending?: SDKUserMessage;
  private waiter?: (result: IteratorResult<SDKUserMessage>) => void;
  private closed = false;
  [Symbol.asyncIterator]() {
    return this;
  }
  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.pending) {
      const value = this.pending;
      this.pending = undefined;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => (this.waiter = resolve));
  }
  push(value: SDKUserMessage) {
    if (this.closed) throw new Error("Claude input is closed");
    if (this.pending) throw new HttpError(409, "Claude input is busy");
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ value, done: false });
    } else this.pending = value;
  }
  close() {
    this.closed = true;
    this.pending = undefined;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = undefined;
  }
}
interface Active {
  token: string;
  resolve: () => void;
  reject: (e: Error) => void;
  done: Promise<void>;
}
interface Session {
  id: string;
  options: JsonObject;
  mode: string;
  input: Input;
  query?: Query;
  ready?: Promise<void>;
  reader?: Promise<void>;
  active?: Active;
  allowed: Set<string>;
  closed: boolean;
  controller: AbortController;
  nativeId?: string;
  onStarted?: (id: string) => void;
}
interface Pending {
  session: Session;
  turn: string;
  resolve: (decision: string) => void;
  cleanup: () => void;
}
/**
 * Session-file operations. These act on the session JSONL rather than a live
 * Query, so they also work for sessions that are not currently connected.
 */
export interface ClaudeSessionOps {
  forkSession: typeof forkSession;
  renameSession: typeof renameSession;
}
export interface ClaudeServiceOptions {
  hub: EventHub;
  dataHome: string;
  env?: NodeJS.ProcessEnv;
  queryFactory?: typeof query;
  fetcher?: typeof fetch;
  sessionOps?: Partial<ClaudeSessionOps>;
}
const MODES = new Set([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "auto",
  "dontAsk",
  "manual",
]);
export function createClaudeService(options: ClaudeServiceOptions) {
  return new ClaudeService(options);
}
export class ClaudeService {
  readonly config: ClaudeConfig;
  readonly history: ClaudeHistory;
  readonly usage: ClaudeUsage;
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Pending>();
  private readonly serial = new KeyedSerial();
  private readonly env: NodeJS.ProcessEnv;
  constructor(private readonly options: ClaudeServiceOptions) {
    this.env = options.env ?? process.env;
    this.config = new ClaudeConfig(this.env);
    this.history = new ClaudeHistory(options.dataHome, this.env);
    this.usage = new ClaudeUsage(this.config, options.fetcher);
  }
  get activeCount() {
    return [...this.sessions.values()].filter((s) => s.active).length;
  }
  private get(id: string) {
    validateSessionId(id);
    const session =
      this.sessions.get(id) ??
      [...this.sessions.values()].find((s) => s.nativeId === id);
    if (!session || session.closed)
      throw new HttpError(404, "Client not found");
    return session;
  }
  async newSession(options: JsonObject) {
    const id = randomUUID();
    await this.replace(id, options);
    return id;
  }
  async resume(id: string, options: JsonObject) {
    await this.replace(id, { ...options, resume: options.resume ?? id });
  }
  async connect(params: JsonObject) {
    const id = String(params.sessionId ?? params.session_id ?? "");
    await this.replace(id, {
      ...params,
      resume: params.resumeId ?? params.resume_id ?? null,
    });
    await this.ensure(this.get(id));
  }
  private async replace(id: string, options: JsonObject) {
    validateSessionId(id);
    validateOptions(options);
    absolutePath(String(options.cwd ?? ""));
    const info = await stat(String(options.cwd));
    if (!info.isDirectory())
      throw new HttpError(400, "Claude cwd is not a directory");
    const mode = String(options.permissionMode ?? "default");
    if (!MODES.has(mode)) throw new HttpError(400, "Invalid permission mode");
    await this.serial.run(id, async () => {
      const previous = this.sessions.get(id);
      if (previous?.active)
        throw new HttpError(
          409,
          "A message is already running in this Claude session",
        );
      if (previous) await this.dispose(previous);
      this.sessions.set(id, {
        id,
        options: structuredClone(options),
        mode,
        input: new Input(),
        allowed: new Set(),
        closed: false,
        controller: new AbortController(),
      });
    });
  }
  private async ensure(session: Session) {
    if (session.closed) throw new HttpError(409, "Claude session disconnected");
    if (session.ready) return session.ready;
    session.ready = (async () => {
      const p = session.options;
      const options: Options = {
        cwd: String(p.cwd),
        env: { ...this.env },
        permissionMode: (session.mode === "manual"
          ? "default"
          : session.mode) as Options["permissionMode"],
        abortController: session.controller,
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input, _id, context) =>
                  input.hook_event_name === "PreToolUse"
                    ? this.permission(
                        session,
                        input.tool_name,
                        object(input.tool_input),
                        input.cwd,
                        context.signal,
                      )
                    : {},
              ],
            },
          ],
        },
      };
      for (const key of [
        "model",
        "effort",
        "fallbackModel",
        "maxTurns",
        "maxBudgetUsd",
        "maxThinkingTokens",
        "settings",
        "allowedTools",
        "disallowedTools",
        "mcpServers",
        "resume",
        "enableFileCheckpointing",
      ] as const)
        if (p[key] !== undefined && p[key] !== null)
          (options as unknown as JsonObject)[key] = p[key];
      if (p.continueConversation === true) options.continue = true;
      if (this.env.SESSION_CLAUDE_BIN)
        options.pathToClaudeCodeExecutable = this.env.SESSION_CLAUDE_BIN;
      if (session.mode === "bypassPermissions")
        options.allowDangerouslySkipPermissions = true;
      session.query = (this.options.queryFactory ?? query)({
        prompt: session.input,
        options,
      });
      session.reader = this.consume(session);
      const ms = Number(this.env.SESSION_CLAUDE_CONNECT_TIMEOUT_MS);
      const timeout =
        Number.isInteger(ms) && ms >= 1000 && ms <= 300000 ? ms : 60000;
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          session.query.initializationResult(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Claude 启动连接超时，请检查 CLI 模型和服务配置后重新建立会话",
                  ),
                ),
              timeout,
            );
            timer.unref();
          }),
        ]);
      } catch (error) {
        session.query.close();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return session.ready;
  }
  private async consume(session: Session) {
    try {
      for await (const message of session.query!) {
        if (session.closed) break;
        if ("session_id" in message && message.session_id) {
          session.nativeId = message.session_id;
          if (session.onStarted) {
            const started = session.onStarted;
            session.onStarted = undefined;
            started(message.session_id);
          }
        }
        // The frontend identity is stable even if native resume emits another ID.
        this.options.hub.publish("cc-message", {
          ...JSON.parse(JSON.stringify(message)),
          session_id: session.id,
        });
        if (message.type === "result") {
          const active = session.active;
          if (active) {
            session.active = undefined;
            this.cancelPermissions(session);
            if (message.is_error)
              active.reject(
                new Error(
                  "result" in message
                    ? String(message.result)
                    : "Claude execution failed",
                ),
              );
            else active.resolve();
          }
        }
      }
      if (!session.closed && session.active)
        this.fail(
          session,
          new Error("Claude response stream closed before completion"),
        );
    } catch (error) {
      if (!session.closed)
        this.fail(
          session,
          error instanceof Error ? error : new Error(String(error)),
        );
    } finally {
      session.query = undefined;
      session.input.close();
      if (!session.closed) session.closed = true;
      this.cancelPermissions(session);
    }
  }
  private fail(session: Session, error: Error) {
    const active = session.active;
    if (!active) return;
    session.active = undefined;
    this.cancelPermissions(session);
    this.options.hub.publish("cc-message", {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: session.id,
      result: error.message,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 0,
    });
    active.reject(error);
  }
  async send(
    id: string,
    message: string,
    images: string[] = [],
  ): Promise<void> {
    await this.startMessage(id, message, images);
  }
  async sendAndWait(id: string, message: string, images: string[] = []) {
    const active = await this.startMessage(id, message, images);
    await active.done;
  }
  private async startMessage(
    id: string,
    message: string,
    images: string[],
  ): Promise<Active> {
    if (
      typeof message !== "string" ||
      Buffer.byteLength(message) > 8 * 1024 * 1024
    )
      throw new HttpError(400, "Invalid message");
    if (!Array.isArray(images) || images.length > 16)
      throw new HttpError(400, "Invalid image_paths");
    const session = this.get(id);
    if (session.active)
      throw new HttpError(
        409,
        "A message is already running in this Claude session",
      );
    let resolve!: () => void, reject!: (error: Error) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void done.catch(() => undefined);
    const active: Active = { token: randomUUID(), done, resolve, reject };
    session.active = active;
    try {
      const content: unknown[] = [];
      if (message || !images.length)
        content.push({ type: "text", text: message });
      let bytes = 0;
      for (const path of images) {
        absolutePath(path);
        const info = await stat(path);
        if (!info.isFile() || (bytes += info.size) > 16 * 1024 * 1024)
          throw new HttpError(413, "Claude images exceed 16 MiB");
        const data = await readFile(path);
        const mime: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".png": "image/png",
        };
        const media = mime[extname(path).toLowerCase()];
        if (!media) throw new HttpError(400, "Unsupported image format");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: media,
            data: data.toString("base64"),
          },
        });
      }
      // The HTTP call acknowledges acceptance. Startup/execution failures are observable results.
      void this.ensure(session)
        .then(() => {
          if (session.active !== active || session.closed) return;
          session.input.push({
            type: "user",
            session_id: session.id,
            parent_tool_use_id: null,
            message: { role: "user", content },
          } as SDKUserMessage);
        })
        .catch((error) => {
          if (session.active === active)
            this.fail(
              session,
              error instanceof Error ? error : new Error(String(error)),
            );
        });
      return active;
    } catch (error) {
      if (session.active === active) session.active = undefined;
      active.reject(error as Error);
      throw error;
    }
  }
  private async permission(
    session: Session,
    tool: string,
    input: JsonObject,
    cwd: string,
    signal: AbortSignal,
  ): Promise<HookJSONOutput> {
    const output = (
      decision: "allow" | "deny",
      reason: string,
    ): HookJSONOutput => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    });
    const mode = session.mode;
    if (mode === "bypassPermissions")
      return output("allow", "bypassPermissions mode");
    if (mode === "auto") return {};
    const filename = basename(String(input.file_path ?? "")).toLowerCase();
    const sensitive =
      [
        ".env",
        "id_rsa",
        "id_ed25519",
        "id_ecdsa",
        "id_dsa",
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        ".secret",
      ].some((p) => filename === p || filename.endsWith(p)) ||
      filename.startsWith(".env.");
    if (
      (tool === "Read" && !sensitive) ||
      ["Glob", "Grep", "LS", "TodoRead"].includes(tool)
    )
      return output("allow", "Read-only tool");
    if (
      mode === "acceptEdits" &&
      ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)
    )
      return output("allow", "acceptEdits mode");
    if (session.allowed.has(tool))
      return output("allow", "Always allow for this session");
    if (mode === "dontAsk")
      return output("deny", "Not pre-approved, and dontAsk mode is on");
    if (!session.active || session.closed || signal.aborted)
      return output("deny", "Turn no longer active");
    const requestId = randomUUID();
    const decision = await new Promise<string>((resolve) => {
      const abort = () => {
        this.pending.delete(requestId);
        resolve("deny");
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, {
        session,
        turn: session.active!.token,
        resolve,
        cleanup: () => signal.removeEventListener("abort", abort),
      });
      this.options.hub.publish("cc-permission-request", {
        requestId,
        sessionId: session.id,
        toolName: tool,
        toolInput: input,
        alwaysAllowTarget: cwd ? "project" : "session",
      });
    });
    if (decision === "allow_always") session.allowed.add(tool);
    if (decision === "allow_project") await this.config.allowProject(cwd, tool);
    return output(
      decision.startsWith("allow") ? "allow" : "deny",
      decision.startsWith("allow") ? "Allowed by user" : "Denied by user",
    );
  }
  async resolvePermission(id: string, decision: string) {
    if (!["allow", "deny", "allow_always", "allow_project"].includes(decision))
      throw new HttpError(400, "Invalid permission decision");
    const pending = this.pending.get(id);
    if (
      !pending ||
      pending.session.closed ||
      pending.session.active?.token !== pending.turn
    )
      throw new HttpError(409, "Permission request not found or expired");
    this.pending.delete(id);
    pending.cleanup();
    pending.resolve(decision);
  }
  private cancelPermissions(session: Session) {
    for (const [id, p] of this.pending)
      if (p.session === session) {
        this.pending.delete(id);
        p.cleanup();
        p.resolve("deny");
      }
  }
  async setPermissionMode(id: string, mode: string) {
    if (!MODES.has(mode)) throw new HttpError(400, "Invalid permission mode");
    const session = this.get(id);
    if (session.query)
      await session.query.setPermissionMode(
        (mode === "manual" ? "default" : mode) as Parameters<
          Query["setPermissionMode"]
        >[0],
      );
    session.mode = mode;
  }
  /**
   * Rewinds tracked files to their state at a user message. Requires the
   * session to have been created with `enableFileCheckpointing`, since the
   * CLI has no backups to restore from otherwise.
   */
  async rewindFiles(id: string, userMessageId: string, dryRun = false) {
    const session = this.get(id);
    if (session.options.enableFileCheckpointing !== true)
      throw new HttpError(
        409,
        "File checkpointing is not enabled for this Claude session",
      );
    validateMessageId(userMessageId);
    await this.ensure(session);
    const query = session.query as
      | {
          rewindFiles?: (
            messageId: string,
            options?: { dryRun?: boolean },
          ) => Promise<unknown>;
        }
      | undefined;
    if (!query?.rewindFiles)
      throw new HttpError(
        501,
        "This Claude CLI does not support rewinding files",
      );
    return query.rewindFiles(userMessageId, { dryRun });
  }
  private get sessionOps(): ClaudeSessionOps {
    return {
      forkSession: this.options.sessionOps?.forkSession ?? forkSession,
      renameSession: this.options.sessionOps?.renameSession ?? renameSession,
    };
  }
  /** Validates a user-supplied session title and returns it trimmed. */
  private title(value: unknown) {
    if (typeof value !== "string") throw new HttpError(400, "Invalid title");
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128 || trimmed.includes("\0"))
      throw new HttpError(400, "Invalid title");
    return trimmed;
  }
  /**
   * Branches a session into a new one, optionally slicing the transcript at a
   * message. Reads the session file, so the session need not be connected.
   */
  async forkSession(
    id: string,
    params: { upToMessageId?: string; title?: string; cwd?: string } = {},
  ) {
    validateSessionId(id);
    const options: {
      dir?: string;
      upToMessageId?: string;
      title?: string;
    } = {};
    if (params.cwd !== undefined) options.dir = absolutePath(params.cwd);
    if (params.upToMessageId !== undefined)
      options.upToMessageId = validateMessageId(params.upToMessageId);
    if (params.title !== undefined) options.title = this.title(params.title);
    return this.sessionOps.forkSession(id, options);
  }
  /** Renames a session by appending a custom-title entry to its JSONL. */
  async renameSession(id: string, title: string, cwd?: string) {
    validateSessionId(id);
    const name = this.title(title);
    await this.sessionOps.renameSession(id, name, {
      ...(cwd === undefined ? {} : { dir: absolutePath(cwd) }),
    });
  }
  async interrupt(id: string) {
    const session = this.get(id);
    this.cancelPermissions(session);
    if (session.query) await session.query.interrupt();
    else if (session.active) {
      this.fail(session, new Error("当前消息已中断"));
    }
  }
  private async dispose(session: Session) {
    session.closed = true;
    this.cancelPermissions(session);
    if (session.active) {
      session.active.reject(new Error("Claude session disconnected"));
      session.active = undefined;
    }
    session.input.close();
    session.controller.abort();
    session.query?.close();
  }
  async disconnect(id: string) {
    await this.serial.run(id, async () => {
      const session = this.get(id);
      await this.dispose(session);
      this.sessions.delete(session.id);
    });
  }
  async deleteSession(id: string) {
    if (this.sessions.get(id)?.active)
      throw new HttpError(409, "Cannot delete a running Claude session");
    await this.history.delete(id);
    if (this.sessions.has(id)) await this.disconnect(id);
  }
  async runAutomation(spec: {
    prompt: string;
    model: string;
    cwd?: string;
    onStarted: (id: string) => void;
    signal: AbortSignal;
  }): Promise<"finished"> {
    if (spec.signal.aborted) throw new Error("Claude automation aborted");
    const id = await this.newSession({
      cwd: spec.cwd ?? process.cwd(),
      ...(spec.model.trim() ? { model: spec.model } : {}),
      permissionMode: "bypassPermissions",
    });
    const session = this.get(id);
    session.onStarted = spec.onStarted;
    const abort = () => {
      void this.dispose(session);
    };
    spec.signal.addEventListener("abort", abort, { once: true });
    try {
      if (spec.signal.aborted) throw new Error("Claude automation aborted");
      await this.sendAndWait(id, spec.prompt);
      return "finished";
    } finally {
      spec.signal.removeEventListener("abort", abort);
      await this.dispose(session);
      this.sessions.delete(id);
    }
  }
  async close() {
    await Promise.all(
      [...this.sessions.values()].map((session) => this.dispose(session)),
    );
    this.sessions.clear();
  }
}

/** A user-message UUID, stricter than the session-id charset check. */
function validateMessageId(id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new HttpError(400, "Invalid user message id");
  return id;
}
function validateOptions(options: JsonObject) {
  for (const key of ["model", "effort", "fallbackModel", "settings", "resume"])
    if (
      options[key] !== undefined &&
      options[key] !== null &&
      (typeof options[key] !== "string" || String(options[key]).includes("\0"))
    )
      throw new HttpError(400, `Invalid ${key}`);
  for (const key of ["maxTurns", "maxThinkingTokens"])
    if (
      options[key] !== undefined &&
      options[key] !== null &&
      (!Number.isSafeInteger(options[key]) ||
        Number(options[key]) < 0 ||
        Number(options[key]) > 4294967295)
    )
      throw new HttpError(400, `Invalid ${key}`);
  if (
    options.maxBudgetUsd !== undefined &&
    options.maxBudgetUsd !== null &&
    (typeof options.maxBudgetUsd !== "number" ||
      !Number.isFinite(options.maxBudgetUsd) ||
      options.maxBudgetUsd < 0)
  )
    throw new HttpError(400, "Invalid maxBudgetUsd");
  for (const key of ["allowedTools", "disallowedTools"])
    if (
      options[key] !== undefined &&
      options[key] !== null &&
      (!Array.isArray(options[key]) ||
        (options[key] as unknown[]).some(
          (v) => typeof v !== "string" || v.includes("\0"),
        ))
    )
      throw new HttpError(400, `Invalid ${key}`);
  if (options.mcpServers !== undefined && options.mcpServers !== null)
    for (const config of Object.values(bodyObject(options.mcpServers)))
      validateMcpConfig(config);
  if (
    options.continueConversation !== undefined &&
    options.continueConversation !== null &&
    typeof options.continueConversation !== "boolean"
  )
    throw new HttpError(400, "Invalid continueConversation");
  if (
    options.enableFileCheckpointing !== undefined &&
    options.enableFileCheckpointing !== null &&
    typeof options.enableFileCheckpointing !== "boolean"
  )
    throw new HttpError(400, "Invalid enableFileCheckpointing");
  if (typeof options.resume === "string") validateSessionId(options.resume);
}
