import { createHash, randomUUID } from "node:crypto";
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
import { ClaudeSessionIdentity } from "./session-identity.js";

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
  historyRecoveryError?: string;
}
interface Pending {
  session: Session;
  turn: string;
  resolve: (decision: string) => void;
  cleanup: () => void;
  tool: string;
  target: "project" | "session";
  input?: JsonObject;
  inputBytes: number;
  inputRevision: string;
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
  runtimeInstance?: string;
}
const PERMISSION_INPUT_BYTES = 8 * 1024 * 1024;
const PERMISSION_TOTAL_BYTES = 16 * 1024 * 1024;
const PERMISSION_PREVIEW_BYTES = 32 * 1024;
function permissionInputIdentity(input: JsonObject) {
  const encoded=JSON.stringify(input);
  return { inputBytes:Buffer.byteLength(encoded),inputRevision:createHash("sha256").update(encoded).digest("hex") };
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
  private pendingInputBytes = 0;
  private readonly runtimeInstance: string;
  private readonly identity: ClaudeSessionIdentity;
  private readonly identityWrites=new Map<string,Promise<void>>();
  private readonly deleting=new Set<string>();
  private readonly requestAliases=new Map<string,string>();
  private readonly serial = new KeyedSerial();
  private readonly env: NodeJS.ProcessEnv;
  constructor(private readonly options: ClaudeServiceOptions) {
    this.env = options.env ?? process.env;
    this.runtimeInstance = options.runtimeInstance ?? randomUUID();
    this.config = new ClaudeConfig(this.env);
    this.identity = new ClaudeSessionIdentity(options.dataHome,this.config.claudeHome);
    this.history = new ClaudeHistory(options.dataHome, this.env);
    this.usage = new ClaudeUsage(this.config, options.fetcher);
  }
  get activeCount() {
    return [...this.sessions.values()].filter((s) => s.active).length;
  }
  activitySnapshot() {
    let connections = 0, activeTurns = 0;
    for (const session of this.sessions.values()) {
      if (session.closed) continue;
      connections++;
      if (session.active) activeTurns++;
    }
    return { connections, activeTurns, pendingRequests: this.pending.size };
  }
  private get(id: string) {
    validateSessionId(id);
    const session =
      this.sessions.get(id) ?? this.sessions.get(this.requestAliases.get(id)??"") ??
      [...this.sessions.values()].find((s) => s.nativeId === id || s.options.resume === id);
    if (!session || session.closed)
      throw new HttpError(404, "Client not found");
    return session;
  }
  private snapshotOwner(id: string, expectedInstance?: string, expectedCwd?: string) {
    if (expectedInstance !== undefined && expectedInstance !== this.runtimeInstance)
      throw new HttpError(409, "Claude runtime instance changed");
    const session = this.get(id);
    if (expectedCwd !== undefined && expectedCwd !== session.options.cwd)
      throw new HttpError(409, "Claude session directory changed");
    return session;
  }
  assertSessionScope(id: string, expectedInstance?: string, expectedCwd?: string) {
    this.snapshotOwner(id, expectedInstance, expectedCwd);
  }
  /** Resolve only an already-observed SDK identity; this never opens a Query. */
  async historySessionId(id: string) {
    validateSessionId(id);
    const session=this.sessions.get(id)??this.sessions.get(this.requestAliases.get(id)??"")??[...this.sessions.values()].find(s=>s.nativeId===id||s.options.resume===id);
    return session?.nativeId??(typeof session?.options.resume==="string"?session.options.resume:await this.identity.resolve(id));
  }
  sessionSnapshot(id: string, expectedInstance?: string, expectedCwd?: string) {
    const session = this.snapshotOwner(id, expectedInstance, expectedCwd);
    const safeOptions: JsonObject = { permissionMode: session.mode };
    for (const key of ["model", "effort", "fallbackModel", "maxTurns", "maxBudgetUsd", "maxThinkingTokens", "allowedTools", "disallowedTools"])
      if (session.options[key] !== undefined) safeOptions[key] = session.options[key];
    const optionsKnown = Buffer.byteLength(JSON.stringify(safeOptions)) <= 128 * 1024;
    const permissions = [...this.pending].filter(([, p]) => p.session === session && p.turn === session.active?.token).map(([requestId, p]) => ({
      requestId, sessionId: session.id, toolName: p.tool,
      toolInput: p.input && p.inputBytes <= PERMISSION_PREVIEW_BYTES ? JSON.parse(JSON.stringify(p.input)) as JsonObject : {},
      alwaysAllowTarget: p.target, toolInputTruncated: !p.input || p.inputBytes > PERMISSION_PREVIEW_BYTES,
      inputAvailable: !!p.input, inputRevision: p.inputRevision, executionId: p.turn,
      ...(!p.input ? { inputError: "审批参数超过安全预算，无法完整恢复；可拒绝此请求。" } : {}),
    }));
    const snapshot = { runtimeInstance: this.runtimeInstance, sessionId: id, eventSessionId: session.id,
      nativeSessionId: session.nativeId ?? null, cwd: String(session.options.cwd), optionsKnown,
      options: optionsKnown ? structuredClone(safeOptions) : {}, connected: !!session.query, running: !!session.active,
      permissions, revision: this.options.hub.cursor,...(session.historyRecoveryError?{historyRecoveryError:session.historyRecoveryError}:{}) };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024)
      throw new HttpError(413, "Claude pending-permission metadata exceeds the snapshot budget; live requests are retained");
    return snapshot;
  }
  permissionDetail(id: string, requestId: string, expectedInstance: string, options: { offset: number; limit: number; expectedItemRevision?: string }) {
    const session = this.snapshotOwner(id, expectedInstance);
    const p = this.pending.get(requestId);
    if (!p || p.session !== session || p.turn !== session.active?.token)
      throw new HttpError(409, "Claude permission request expired");
    if (!p.input) throw new HttpError(413, "Claude permission input is unavailable within the safe budget");
    if (!Number.isInteger(options.offset) || options.offset < 0 || !Number.isInteger(options.limit) || options.limit < 128 || options.limit > 65536)
      throw new HttpError(400, "Invalid permission detail range");
    const text = JSON.stringify(p.input);
    const revision = createHash("sha256").update(text).digest("hex");
    if (revision !== p.inputRevision || (options.expectedItemRevision !== undefined && options.expectedItemRevision !== revision))
      throw new HttpError(409, "Claude permission input revision changed");
    if(options.offset>text.length || (options.offset>0 && /[\uDC00-\uDFFF]/.test(text[options.offset]??"") && /[\uD800-\uDBFF]/.test(text[options.offset-1]??"")))
      throw new HttpError(400,"Invalid permission detail offset");
    let low=options.offset,high=Math.min(text.length,options.offset+options.limit);
    while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(text.slice(options.offset,mid)))<=options.limit-256)low=mid;else high=mid-1;}
    if(low<text.length&&/[\uD800-\uDBFF]/.test(text[low-1]??""))low--;
    if(low===options.offset&&low<text.length)throw new HttpError(400,"Permission detail limit is too small");
    return { text:text.slice(options.offset,low),nextOffset:low<text.length?low:null,itemRevision:revision,format:"json" as const };
  }
  private releasePermission(id: string) {
    const pending = this.pending.get(id);
    if (pending) { this.pendingInputBytes -= pending.inputBytes; this.pending.delete(id); }
    return pending;
  }
  async newSession(options: JsonObject) {
    const id = randomUUID();
    await this.replace(id, options);
    return id;
  }
  async resume(id: string, options: JsonObject) {
    validateOptions(options);
    const resume=await this.historySessionId(String(options.resume??id));
    await this.replace(id, { ...options, resume });
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
    const nativeTarget=String(options.resume??id);
    await this.serial.run(nativeTarget, async () => {
      const previous = this.sessions.get(id)??this.sessions.get(this.requestAliases.get(id)??"")??[...this.sessions.values()].find(s=>s.nativeId===nativeTarget||s.options.resume===nativeTarget||s.id===nativeTarget);
      if(previous&&this.deleting.has(previous.id))throw new HttpError(409,"Claude session deletion is in progress");
      if (previous?.active)
        throw new HttpError(
          409,
          "A message is already running in this Claude session",
        );
      if (previous) { await this.dispose(previous);this.sessions.delete(previous.id); }
      const canonical=previous?.id??id;
      if(canonical!==id){this.requestAliases.set(id,canonical);if(this.requestAliases.size>1024)this.requestAliases.delete(this.requestAliases.keys().next().value!);}
      this.sessions.set(canonical, {
        id:canonical,
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
      if (!p.resume && p.continueConversation !== true && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.id)) options.sessionId = session.id;
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
          const nativeId=message.session_id;
          if(session.nativeId!==nativeId){
            const write=(this.identityWrites.get(session.id)??Promise.resolve()).catch(()=>{}).then(()=>this.identity.remember(session.id,nativeId));
            this.identityWrites.set(session.id,write);
            void write.catch(()=>{session.historyRecoveryError="当前历史身份未能持久保存，重启前请保留原生会话 UUID。";}).finally(()=>{if(this.identityWrites.get(session.id)===write)this.identityWrites.delete(session.id);});
          }
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
    if(this.deleting.has(session.id))throw new HttpError(409,"Claude session deletion is in progress");
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
    // Do not retain a serialized copy across the waiting SDK hook.
    const {inputBytes,inputRevision}=permissionInputIdentity(input);
    const retainInput = inputBytes <= PERMISSION_INPUT_BYTES && this.pendingInputBytes + inputBytes <= PERMISSION_TOTAL_BYTES;
    const decision = await new Promise<string>((resolve) => {
      const abort = () => {
        this.releasePermission(requestId);
        resolve("deny");
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(requestId, {
        session,
        turn: session.active!.token,
        resolve,
        cleanup: () => signal.removeEventListener("abort", abort),
        tool, target: cwd ? "project" : "session", input: retainInput ? input : undefined,
        inputBytes: retainInput ? inputBytes : 0, inputRevision,
      });
      if (retainInput) this.pendingInputBytes += inputBytes;
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
  async resolvePermission(id: string, decision: string, expected?: { runtimeInstance: string; sessionId: string; executionId?: string; inputRevision?: string }) {
    if (!["allow", "deny", "allow_always", "allow_project"].includes(decision))
      throw new HttpError(400, "Invalid permission decision");
    const pending = this.pending.get(id);
    if (
      !pending ||
      pending.session.closed ||
      pending.session.active?.token !== pending.turn
    )
      throw new HttpError(409, "Permission request not found or expired");
    if (expected) {
      const session = this.snapshotOwner(expected.sessionId, expected.runtimeInstance);
      if (session !== pending.session || (expected.executionId !== undefined && expected.executionId !== pending.turn) || (expected.inputRevision !== undefined && expected.inputRevision !== pending.inputRevision))
        throw new HttpError(409, "Claude permission request ownership changed");
    }
    if (decision !== "deny" && !pending.input)
      throw new HttpError(409, "Claude permission input is unavailable; reject this request instead");
    if (decision !== "deny" && createHash("sha256").update(JSON.stringify(pending.input)).digest("hex") !== pending.inputRevision)
      throw new HttpError(409,"Claude permission input revision changed");
    this.releasePermission(id);
    pending.cleanup();
    pending.resolve(decision);
  }
  private cancelPermissions(session: Session) {
    for (const [id, p] of this.pending)
      if (p.session === session) {
        this.releasePermission(id);
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
    const session=this.sessions.get(id)??this.sessions.get(this.requestAliases.get(id)??"")??[...this.sessions.values()].find(s=>s.nativeId===id||s.options.resume===id);
    if (session?.active)
      throw new HttpError(409, "Cannot delete a running Claude session");
    const key=session?.id??id;
    if(this.deleting.has(key))throw new HttpError(409,"Claude session deletion is in progress");
    this.deleting.add(key);
    try{
      await this.history.delete(await this.historySessionId(id));
      if (session&&!session.closed) await this.disconnect(session.id);
    }finally{this.deleting.delete(key);}
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
    this.requestAliases.clear();
    await Promise.allSettled(this.identityWrites.values());
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
