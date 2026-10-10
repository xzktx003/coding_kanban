import { randomUUID } from "node:crypto";
import { open, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { EventHub } from "../core/events.js";
import { KeyedSerial } from "../core/serial.js";
import { object, type Json, type JsonObject } from "../core/json.js";
import { StdioRpc, type ServerRequest } from "../transport/rpc.js";
import type {
  AcpAgentDef,
  AcpHistory,
  AcpImage,
  ConnectionPolicy,
} from "./types.js";

export class AcpClient {
  readonly rpc: StdioRpc;
  readonly sessions = new Set<string>();
  readonly replaying = new Set<string>();
  readonly policy: ConnectionPolicy;
  private lastSession?: string;
  private serial = new KeyedSerial();
  private activePrompts = new Set<string>();
  private uncertainSessions = new Set<string>();
  private lifecycleUnknown = false;
  private stopped = false;
  private supportsImages = false;
  private permissionBytes = 0;
  private permissions = new Map<
    string,
    {
      id: string | number;
      sessionId: string;
      options: Set<string>;
      bytes: number;
    }
  >();
  constructor(
    readonly connectionId: string,
    readonly agent: AcpAgentDef,
    readonly botId: string | undefined,
    private options: {
      hub: EventHub;
      history: AcpHistory;
      env: NodeJS.ProcessEnv;
      cwd: string;
      policy?: ConnectionPolicy;
      timeoutMs?: number;
      onExit?: () => void;
    },
  ) {
    this.policy = options.policy ?? {};
    this.rpc = new StdioRpc({
      command: agent.command,
      args: [
        ...(agent.args ?? []),
        ...(this.policy.strictMcp ? ["--mcp-policy", "client-only"] : []),
      ],
      cwd: options.cwd,
      env: { ...options.env, ...agent.env },
      jsonrpc: true,
      maxFrameBytes: 48 * 1024 * 1024,
      maxQueuedBytes: 48 * 1024 * 1024,
      onNotification: (m) => this.notification(m),
      onRequest: (r) => this.handleRequest(r),
      onDiagnostic: (line) => this.emit({ kind: "stderr", line }),
      onExit: () => {
        this.cleanup();
        this.emit({ kind: "exited" });
      },
    });
    // RPC failure can precede process termination (for example stdout EOF).
    // Keep a live process registered so explicit stop can still reach it, but
    // release ownership on exit even if the transport already failed. Waiting
    // only for close leaves a dead connection registered while stdio drains.
    const processExited = () => {
      this.rpc.child.off("exit", processExited);
      this.rpc.child.off("close", processExited);
      this.options.onExit?.();
    };
    this.rpc.child.once("exit", processExited);
    // Failed spawn can emit error + close without an exit event.
    this.rpc.child.once("close", processExited);
  }
  private emit(payload: JsonObject) {
    this.options.hub.publish("acp-message", {
      ...payload,
      connectionId: this.connectionId,
      agentId: this.agent.id,
    });
  }
  private cleanup() {
    if (this.stopped) return;
    this.stopped = true;
    this.permissions.clear();
    this.permissionBytes = 0;
    this.sessions.clear();
    this.replaying.clear();
    this.activePrompts.clear();
    this.uncertainSessions.clear();
    this.policy.onClose?.();
  }
  async initialize(): Promise<Json> {
    try {
      const result = await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
        clientInfo: { name: "codexia", version: "0.1.0" },
      });
      if (
        this.policy.strictMcp &&
        object(object(result)._meta)["keke.dev/mcp-policy"] !== "client-only"
      )
        throw new Error(
          "runtime did not confirm client-only MCP policy; refusing to open a Bot session",
        );
      this.supportsImages =
        object(object(object(result).agentCapabilities).promptCapabilities)
          .image === true;
      return result;
    } catch (e) {
      await this.close();
      throw new Error(
        `${this.policy.strictMcp ? "Bot requires keke strict MCP isolation (--mcp-policy client-only): " : ""}${(e as Error).message}`,
      );
    }
  }
  request(
    method: string,
    params: Json,
    timeoutMs = this.options.timeoutMs ?? 120_000,
  ): Promise<Json> {
    return this.rpc.request(method, params, { timeoutMs });
  }
  private checkLifecycle() {
    if (this.stopped) throw new Error("NOT_SENT: ACP connection closed");
    if (this.lifecycleUnknown)
      throw new Error(
        "DELIVERY_UNKNOWN: ACP session lifecycle requires explicit stop and reconnect",
      );
  }
  private mcpServers(): Json[] {
    return this.policy.sessionMcpServers?.() ?? this.policy.mcpServers ?? [];
  }
  async newSession(cwd: string): Promise<Json> {
    return this.serial.run("session", async () => {
      this.checkLifecycle();
      await validateCwd(cwd);
      let result: Json;
      try {
        result = await this.request("session/new", {
          cwd,
          mcpServers: this.mcpServers(),
        });
      } catch (e) {
        if ((e as Error).message.includes("DELIVERY_UNKNOWN"))
          this.lifecycleUnknown = true;
        throw e;
      }
      const id = object(result).sessionId;
      if (typeof id !== "string" || !id)
        throw new Error("session/new returned no sessionId");
      this.track(id, cwd);
      return result;
    });
  }
  async loadSession(sessionId: string, cwd: string): Promise<Json> {
    return this.serial.run("session", async () => {
      this.checkLifecycle();
      await validateCwd(cwd);
      if (this.activePrompts.has(sessionId))
        throw new Error("ACP session has an active prompt");
      this.replaying.add(sessionId);
      try {
        const result = await this.request("session/load", {
          sessionId,
          cwd,
          mcpServers: this.mcpServers(),
        });
        this.track(sessionId, cwd);
        return result;
      } catch (e) {
        if ((e as Error).message.includes("DELIVERY_UNKNOWN"))
          this.lifecycleUnknown = true;
        throw e;
      } finally {
        this.replaying.delete(sessionId);
      }
    });
  }
  private track(id: string, cwd: string) {
    this.sessions.add(id);
    this.lastSession = id;
    this.options.history.upsertSession({
      sessionId: id,
      agentId: this.agent.id,
      agentTitle: this.agent.name,
      cwd,
      botId: this.botId,
    });
  }
  resolveSession(sessionId?: string): string {
    const id = sessionId ?? this.lastSession;
    if (!id) throw new Error("no active ACP session");
    if (!this.sessions.has(id)) throw new Error(`unknown ACP session: ${id}`);
    return id;
  }
  async sessionRequest(
    sessionId: string | undefined,
    method: string,
    params: JsonObject,
  ): Promise<Json> {
    return this.serial.run("session", async () => {
      this.checkLifecycle();
      return this.request(method, {
        ...params,
        sessionId: this.resolveSession(sessionId),
      });
    });
  }
  authenticate(methodId: string): Promise<Json> {
    return this.request("authenticate", {
      methodId,
      _meta: { persist: false },
    });
  }
  setMode(sessionId: string | undefined, modeId: string): Promise<Json> {
    return this.sessionRequest(sessionId, "session/set_mode", { modeId });
  }
  setModel(
    sessionId: string | undefined,
    modelId: string,
    reasoningEffort?: string,
  ): Promise<Json> {
    return this.sessionRequest(sessionId, "session/set_model", {
      modelId,
      ...(reasoningEffort ? { _meta: { reasoningEffort } } : {}),
    });
  }
  setConfigOption(
    sessionId: string | undefined,
    configId: string,
    value: Json,
  ): Promise<Json> {
    return this.sessionRequest(sessionId, "session/set_config_option", {
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" } : {}),
      value,
    });
  }
  async prompt(
    sessionId: string | undefined,
    text: string,
    images: AcpImage[] = [],
    timeoutMs = 60 * 60_000,
  ): Promise<Json> {
    if (images.length && !this.supportsImages)
      throw new Error("当前 Agent 不支持图片输入");
    const id = await this.serial.run("session", async () => {
      this.checkLifecycle();
      const id = this.resolveSession(sessionId);
      if (this.activePrompts.has(id) || this.uncertainSessions.has(id))
        throw new Error(
          "ACP session already has an active or delivery-unknown prompt",
        );
      this.activePrompts.add(id);
      return id;
    });
    try {
      const prompt: Json[] = [];
      if (text || !images.length) prompt.push({ type: "text", text });
      for (const image of images) prompt.push({ type: "image", ...image });
      this.persist(id, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text },
      });
      for (const image of images)
        this.persist(id, {
          sessionUpdate: "user_message_chunk",
          content: { type: "image", ...image },
        });
      this.options.history.setTitleIfEmpty(id, text);
      return await this.request(
        "session/prompt",
        { sessionId: id, prompt },
        timeoutMs,
      );
    } catch (e) {
      if ((e as Error).message.includes("DELIVERY_UNKNOWN"))
        this.uncertainSessions.add(id);
      throw e;
    } finally {
      this.activePrompts.delete(id);
      await this.cancelPermissions(id);
    }
  }
  async cancel(sessionId?: string) {
    const id = this.resolveSession(sessionId);
    await this.rpc.notify("session/cancel", { sessionId: id });
    await this.cancelPermissions(id);
  }
  async respondPermission(
    requestId: string,
    optionId?: string,
    sessionId?: string,
  ) {
    const req = this.permissions.get(requestId);
    if (!req) throw new Error(`unknown permission request: ${requestId}`);
    if (sessionId !== undefined && sessionId !== req.sessionId)
      throw new Error("permission session does not match");
    if (optionId !== undefined && !req.options.has(optionId))
      throw new Error("unknown permission option");
    this.permissions.delete(requestId);
    this.permissionBytes -= req.bytes;
    await this.rpc.respond(req.id, {
      outcome:
        optionId === undefined
          ? { outcome: "cancelled" }
          : { outcome: "selected", optionId },
    });
  }
  private async cancelPermissions(sessionId: string) {
    for (const [key, req] of this.permissions) {
      if (req.sessionId !== sessionId) continue;
      this.permissions.delete(key);
      this.permissionBytes -= req.bytes;
      await this.rpc
        .respond(req.id, { outcome: { outcome: "cancelled" } })
        .catch(() => {});
    }
  }
  private persist(id: string, update: Json) {
    if (!this.replaying.has(id)) {
      try {
        this.options.history.appendUpdate(id, update);
      } catch (e) {
        this.emit({
          kind: "stderr",
          line: `ACP history persistence failed: ${(e as Error).message}`,
        });
      }
    }
  }
  private notification(message: JsonObject) {
    const params = object(message.params);
    if (message.method === "session/update") {
      if (typeof params.sessionId === "string" && params.update !== undefined)
        this.persist(params.sessionId, params.update);
      this.emit({
        kind: "update",
        sessionId: params.sessionId ?? null,
        update: params.update ?? null,
      });
    } else
      this.emit({
        kind: "notification",
        method: message.method ?? null,
        params,
      });
  }
  private async handleRequest(request: ServerRequest) {
    try {
      const p = object(request.params);
      const sessionId =
        typeof p.sessionId === "string" ? p.sessionId : undefined;
      if (
        !sessionId ||
        (!this.sessions.has(sessionId) && !this.replaying.has(sessionId))
      )
        throw new Error("unknown ACP session for client request");
      if (request.method === "session/request_permission") {
        const options = Array.isArray(p.options) ? p.options.map(object) : [];
        if (this.policy.unattended) {
          const policy = this.policy.unattended;
          const tool = object(p.toolCall);
          const key = String(tool.kind ?? tool.title ?? "");
          const allowed = policy.allowAll || policy.approvedTools.includes(key);
          if (!allowed) policy.blocked = true;
          const picked = options.find(
            (o) => o.kind === (allowed ? "allow_once" : "reject_once"),
          );
          await this.rpc.respond(request.id, {
            outcome:
              typeof picked?.optionId === "string"
                ? { outcome: "selected", optionId: picked.optionId }
                : { outcome: "cancelled" },
          });
          return;
        }
        const permissionBytes = Buffer.byteLength(JSON.stringify(p));
        if (
          this.permissions.size >= 1024 ||
          this.permissionBytes + permissionBytes > 1024 * 1024
        )
          throw new Error("ACP permission byte/count limit exceeded");
        const requestId = `${this.connectionId}-${randomUUID()}`;
        if ([...this.permissions.values()].some((p) => p.id === request.id))
          throw new Error("duplicate ACP permission request");
        this.permissionBytes += permissionBytes;
        this.permissions.set(requestId, {
          bytes: permissionBytes,
          id: request.id,
          sessionId,
          options: new Set(
            options.flatMap((o) =>
              typeof o.optionId === "string" ? [o.optionId] : [],
            ),
          ),
        });
        this.emit({
          kind: "permission",
          requestId,
          sessionId,
          toolCall: p.toolCall ?? null,
          options: p.options ?? null,
        });
        return;
      }
      if (
        request.method === "fs/read_text_file" ||
        request.method === "fs/write_text_file"
      ) {
        const path = p.path;
        if (
          typeof path !== "string" ||
          !isAbsolute(path) ||
          /[\x00-\x1f]/.test(path)
        )
          throw new Error("Invalid ACP file path");
        if (request.method === "fs/write_text_file") {
          if (this.policy.readOnly)
            throw new Error(
              "this agent is read-only: writing files is not allowed",
            );
          if (typeof p.content !== "string")
            throw new Error("Invalid file content");
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, p.content);
          await this.rpc.respond(request.id, null);
          return;
        }
        const file = await open(path, "r");
        let content: string;
        try {
          const info = await file.stat();
          const limit = 16 * 1024 * 1024;
          if (!info.isFile() || info.size > limit)
            throw new Error("ACP file exceeds read limit");
          const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
          let used = 0;
          while (used < bytes.length) {
            const part = await file.read(
              bytes,
              used,
              bytes.length - used,
              used,
            );
            if (!part.bytesRead) break;
            used += part.bytesRead;
          }
          if (used > info.size)
            throw new Error("ACP file changed while reading");
          content = bytes.subarray(0, used).toString("utf8");
        } finally {
          await file.close();
        }
        for (const key of ["line", "limit"])
          if (
            p[key] !== undefined &&
            (!Number.isSafeInteger(p[key]) || Number(p[key]) < 0)
          )
            throw new Error(`Invalid ${key}`);
        if (p.line !== undefined || p.limit !== undefined) {
          const lines = content.split(/\r?\n/);
          if (lines.at(-1) === "") lines.pop();
          const start = Math.max(0, Number(p.line ?? 1) - 1);
          content = lines
            .slice(
              start,
              p.limit === undefined ? undefined : start + Number(p.limit),
            )
            .join("\n");
        }
        await this.rpc.respond(request.id, { content });
        return;
      }
      throw new Error(`unsupported client method: ${request.method}`);
    } catch (e) {
      await this.rpc
        .respondError(request.id, -32603, (e as Error).message)
        .catch(() => {});
    }
  }
  async close() {
    this.cleanup();
    await this.rpc.close();
  }
}
export async function validateCwd(cwd: string) {
  if (!isAbsolute(cwd) || /[\x00-\x1f]/.test(cwd))
    throw new Error("Invalid process working directory");
  if (!(await stat(cwd)).isDirectory())
    throw new Error("Process working directory is not a directory");
}
