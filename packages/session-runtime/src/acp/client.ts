import { randomUUID } from "node:crypto";
import { acpHistorySessionId } from "./history-identity.js";
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
  private readonly recordingReplay = new Set<string>();
  private readonly recordedLoads = new Set<string>();
  readonly policy: ConnectionPolicy;
  private lastSession?: string;
  private readonly historyRuntimeInstance: string;
  private serial = new KeyedSerial();
  private activePrompts = new Set<string>();
  private uncertainSessions = new Set<string>();
  private lifecycleUnknown = false;
  private stopped = false;
  private supportsImages = false;
  private supportsSessionLoad = false;
  private initializeMetadata: JsonObject | null = null;
  private sessionMetadata = new Map<
    string,
    { cwd: string; session: JsonObject; bytes: number; settingsKnown: boolean }
  >();
  private sessionMetadataBytes = 0;
  private permissionBytes = 0;
  private permissions = new Map<
    string,
    {
      id: string | number;
      sessionId: string;
      options: Set<string>;
      bytes: number;
      toolCall: Json;
      choices: Json;
    }
  >();
  activitySnapshot() {
    return {
      activePrompts: this.activePrompts.size,
      pendingRequests: this.permissions.size,
      uncertainSessions:
        this.uncertainSessions.size + (this.lifecycleUnknown ? 1 : 0),
    };
  }
  constructor(
    readonly connectionId: string,
    readonly agent: AcpAgentDef,
    readonly botId: string | undefined,
    private options: {
      hub: EventHub;
      history: AcpHistory;
      env: NodeJS.ProcessEnv;
      cwd: string;
      runtimeInstance?: string;
      policy?: ConnectionPolicy;
      timeoutMs?: number;
      onExit?: () => void;
    },
  ) {
    this.policy = options.policy ?? {};
    this.historyRuntimeInstance = options.runtimeInstance ?? randomUUID();
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
  historySessionId(nativeSessionId: string): string {
    return acpHistorySessionId(
      this.historyRuntimeInstance,
      this.connectionId,
      this.agent.id,
      nativeSessionId,
    );
  }
  private emit(payload: JsonObject) {
    const nativeId =
      typeof payload.sessionId === "string"
        ? payload.sessionId
        : this.lastSession;
    this.options.hub.publish("acp-message", {
      ...payload,
      connectionId: this.connectionId,
      agentId: this.agent.id,
      runtimeInstance: this.historyRuntimeInstance,
      historySessionId:
        nativeId &&
        (this.sessions.has(nativeId) ||
          this.recordingReplay.has(nativeId) ||
          nativeId === this.lastSession)
          ? this.historySessionId(nativeId)
          : null,
    });
  }
  /** Gateway metadata, not an ACP protocol notification or a native receipt. */
  private executionState(sessionId: string) {
    if (this.stopped) return;
    this.emit({
      kind: "execution-state",
      sessionId,
      ...(this.options.runtimeInstance
        ? { runtimeInstance: this.options.runtimeInstance }
        : {}),
      running: this.activePrompts.has(sessionId),
      deliveryUnknown: this.uncertainSessions.has(sessionId),
      lifecycleUnknown: this.lifecycleUnknown,
      pendingRequestIds: [...this.permissions]
        .filter(([, request]) => request.sessionId === sessionId)
        .map(([id]) => id),
    });
  }
  private cleanup() {
    if (this.stopped) return;
    this.stopped = true;
    this.permissions.clear();
    this.permissionBytes = 0;
    this.sessions.clear();
    this.replaying.clear();
    this.recordingReplay.clear();
    this.recordedLoads.clear();
    this.activePrompts.clear();
    this.uncertainSessions.clear();
    this.sessionMetadata.clear();
    this.sessionMetadataBytes = 0;
    this.initializeMetadata = null;
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
      this.supportsSessionLoad =
        object(object(result).agentCapabilities).loadSession === true;
      const metadata = Object.fromEntries(
        Object.entries(object(result)).filter(([key]) =>
          [
            "protocolVersion",
            "agentInfo",
            "authMethods",
            "agentCapabilities",
          ].includes(key),
        ),
      ) as JsonObject;
      this.initializeMetadata =
        Buffer.byteLength(JSON.stringify(metadata)) <= 128 * 1024
          ? JSON.parse(JSON.stringify(metadata))
          : null;
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
  private unknownLifecycle(reason: string): never {
    this.lifecycleUnknown = true;
    for (const id of this.sessions) this.executionState(id);
    throw new Error(
      `DELIVERY_UNKNOWN: ${reason}; ACP lifecycle requires explicit verification or reconnect`,
    );
  }
  private lifecycleResult(
    value: Json,
    method: "new" | "load",
    requestedId?: string,
  ): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value))
      this.unknownLifecycle(`session/${method} returned an invalid result`);
    const result = value as JsonObject;
    if (method === "new") {
      try {
        if (typeof result.sessionId !== "string")
          throw new Error("missing identity");
        this.historySessionId(result.sessionId);
      } catch {
        this.unknownLifecycle("session/new returned no valid session identity");
      }
    } else if (
      Object.prototype.hasOwnProperty.call(result, "sessionId") &&
      result.sessionId !== requestedId
    ) {
      this.unknownLifecycle(
        "session/load returned a different or invalid session identity",
      );
    }
    // ACP v1 load success may be {}. Its exact JSON-RPC response is bound to
    // the captured request target; this added sessionId is a gateway projection.
    return result;
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
        if ((e as Error).message.includes("DELIVERY_UNKNOWN")) {
          this.lifecycleUnknown = true;
          for (const id of this.sessions) this.executionState(id);
        }
        throw e;
      }
      const response = this.lifecycleResult(result, "new");
      const id = response.sessionId as string;
      try {
        this.track(id, cwd, response);
      } catch {
        this.unknownLifecycle(
          "created ACP session could not establish its persistent source identity",
        );
      }
      return { ...response, historySessionId: this.historySessionId(id) };
    });
  }
  async loadSession(sessionId: string, cwd: string): Promise<Json> {
    return this.serial.run("session", async () => {
      this.checkLifecycle();
      if (!this.supportsSessionLoad)
        throw new Error("NOT_SENT: ACP agent does not support session/load");
      await validateCwd(cwd);
      if (this.activePrompts.has(sessionId))
        throw new Error("ACP session has an active prompt");
      const historyInfo = this.options.history.getSessionInfo?.(
        this.historySessionId(sessionId),
      );
      const freshSource = historyInfo
        ? historyInfo.hasUpdates === false
        : !this.sessions.has(sessionId);
      if (freshSource && !this.recordedLoads.has(sessionId)) {
        // Record the agent's actual replay into this connection's fresh source.
        // Existing transcripts are never copied or inferred from a bare native ID.
        this.registerHistory(sessionId, cwd);
        this.recordingReplay.add(sessionId);
        this.recordedLoads.add(sessionId);
      }
      this.replaying.add(sessionId);
      try {
        const result = await this.request("session/load", {
          sessionId,
          cwd,
          mcpServers: this.mcpServers(),
        });
        const response = this.lifecycleResult(result, "load", sessionId);
        try {
          this.track(sessionId, cwd, response);
        } catch {
          this.unknownLifecycle(
            "loaded ACP session could not establish its persistent source identity",
          );
        }
        return {
          ...response,
          sessionId,
          historySessionId: this.historySessionId(sessionId),
        };
      } catch (e) {
        if ((e as Error).message.includes("DELIVERY_UNKNOWN")) {
          this.lifecycleUnknown = true;
          for (const id of this.sessions) this.executionState(id);
        }
        throw e;
      } finally {
        this.replaying.delete(sessionId);
        this.recordingReplay.delete(sessionId);
      }
    });
  }
  private track(id: string, cwd: string, result: JsonObject) {
    this.registerHistory(id, cwd);
    this.sessions.add(id);
    this.lastSession = id;
    this.rememberSession(id, cwd, result);
  }
  private registerHistory(id: string, cwd: string) {
    this.options.history.upsertSession({
      sessionId: this.historySessionId(id),
      nativeSessionId: id,
      runtimeInstance: this.historyRuntimeInstance,
      connectionId: this.connectionId,
      agentId: this.agent.id,
      agentTitle: this.agent.name,
      cwd,
      botId: this.botId,
    });
  }
  private rememberSession(
    id: string,
    cwd: string,
    result: JsonObject,
    settingsKnown = true,
  ) {
    let session: JsonObject = { sessionId: id };
    for (const key of ["modes", "models", "configOptions"])
      if (result[key] !== undefined) session[key] = result[key]!;
    let raw = JSON.stringify(session);
    if (Buffer.byteLength(raw) > 128 * 1024) {
      session = { sessionId: id };
      raw = JSON.stringify(session);
      settingsKnown = false;
    }
    const previous = this.sessionMetadata.get(id);
    if (previous) {
      this.sessionMetadataBytes -= previous.bytes;
      this.sessionMetadata.delete(id);
    }
    const bytes = Buffer.byteLength(raw) + Buffer.byteLength(cwd);
    this.sessionMetadata.set(id, {
      cwd,
      session: JSON.parse(raw),
      bytes,
      settingsKnown,
    });
    this.sessionMetadataBytes += bytes;
    while (
      this.sessionMetadataBytes > 2 * 1024 * 1024 &&
      this.sessionMetadata.size > 1
    ) {
      const oldest = this.sessionMetadata.keys().next().value!;
      const value = this.sessionMetadata.get(oldest)!;
      this.sessionMetadata.delete(oldest);
      this.sessionMetadataBytes -= value.bytes;
    }
  }
  /** Observe this connection's actual state. No RPC, session/load or new process. */
  snapshot(sessionId: string) {
    const id = this.resolveSession(sessionId);
    const cached = this.sessionMetadata.get(id);
    const stored = cached
      ? undefined
      : this.options.history.getSessionInfo?.(this.historySessionId(id));
    const cwd =
      cached?.cwd ??
      (stored?.agentId === this.agent.id ? stored.cwd : undefined);
    if (!cwd) throw new Error("ACP session directory metadata is unavailable");
    const permissions = [...this.permissions.entries()]
      .filter(([, value]) => value.sessionId === id)
      .map(([requestId, value]) => ({
        connectionId: this.connectionId,
        agentId: this.agent.id,
        sessionId: id,
        requestId,
        toolCall: value.toolCall,
        options: value.choices,
      }));
    return {
      connectionId: this.connectionId,
      agentId: this.agent.id,
      sessionId: id,
      historySessionId: this.historySessionId(id),
      cwd,
      initialize: this.initializeMetadata ?? {},
      session: cached?.session ?? { sessionId: id },
      settingsKnown:
        !!cached?.settingsKnown && this.initializeMetadata !== null,
      running: this.activePrompts.has(id),
      deliveryUnknown: this.uncertainSessions.has(id),
      lifecycleUnknown: this.lifecycleUnknown,
      permissions,
    };
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
  async setMode(sessionId: string | undefined, modeId: string): Promise<Json> {
    const id = this.resolveSession(sessionId);
    const result = await this.sessionRequest(id, "session/set_mode", {
      modeId,
    });
    const cached = this.sessionMetadata.get(id);
    if (cached?.session.modes)
      this.rememberSession(
        id,
        cached.cwd,
        {
          ...cached.session,
          modes: { ...object(cached.session.modes), currentModeId: modeId },
        },
        cached.settingsKnown,
      );
    return result;
  }
  async setModel(
    sessionId: string | undefined,
    modelId: string,
    reasoningEffort?: string,
  ): Promise<Json> {
    const id = this.resolveSession(sessionId);
    const result = await this.sessionRequest(id, "session/set_model", {
      modelId,
      ...(reasoningEffort ? { _meta: { reasoningEffort } } : {}),
    });
    const cached = this.sessionMetadata.get(id);
    if (cached?.session.models)
      this.rememberSession(
        id,
        cached.cwd,
        {
          ...cached.session,
          models: { ...object(cached.session.models), currentModelId: modelId },
        },
        cached.settingsKnown,
      );
    return result;
  }
  async setConfigOption(
    sessionId: string | undefined,
    configId: string,
    value: Json,
  ): Promise<Json> {
    const id = this.resolveSession(sessionId);
    const result = await this.sessionRequest(id, "session/set_config_option", {
      configId,
      ...(typeof value === "boolean" ? { type: "boolean" } : {}),
      value,
    });
    const cached = this.sessionMetadata.get(id);
    if (cached && Array.isArray(cached.session.configOptions))
      this.rememberSession(
        id,
        cached.cwd,
        {
          ...cached.session,
          configOptions: cached.session.configOptions.map((option) =>
            object(option).id === configId
              ? { ...object(option), currentValue: value }
              : option,
          ),
        },
        cached.settingsKnown,
      );
    return result;
  }
  async prompt(
    sessionId: string | undefined,
    text: string,
    images: AcpImage[] = [],
    timeoutMs = 60 * 60_000,
    clientMessageId?: string,
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
      this.executionState(id);
      return id;
    });
    try {
      const prompt: Json[] = [];
      if (text || !images.length) prompt.push({ type: "text", text });
      for (const image of images) prompt.push({ type: "image", ...image });
      const sourceRows: { historySourceId: number; partIndex: number }[] = [];
      const persistPart = (update: JsonObject, partIndex: number) => {
        const sourceId = this.persist(id, {
          ...update,
          ...(clientMessageId ? { clientMessageId, partIndex } : {}),
        });
        if (sourceId !== undefined)
          sourceRows.push({ historySourceId: sourceId, partIndex });
      };
      persistPart(
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text },
        },
        0,
      );
      for (const [index, image] of images.entries())
        persistPart(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "image", ...image },
          },
          index + 1,
        );
      if (clientMessageId && sourceRows.length)
        this.emit({
          kind: "prompt-persisted",
          sessionId: id,
          clientMessageId,
          historySourceId: sourceRows[0]!.historySourceId,
          sourceRows,
        });
      this.options.history.setTitleIfEmpty(this.historySessionId(id), text);
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
      this.executionState(id);
    }
  }
  async cancel(sessionId?: string) {
    const id = this.resolveSession(sessionId);
    await this.rpc.notify("session/cancel", { sessionId: id });
    if (await this.cancelPermissions(id)) this.executionState(id);
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
    let changed = false;
    for (const [key, req] of this.permissions) {
      if (req.sessionId !== sessionId) continue;
      this.permissions.delete(key);
      changed = true;
      this.permissionBytes -= req.bytes;
      await this.rpc
        .respond(req.id, { outcome: { outcome: "cancelled" } })
        .catch(() => {});
    }
    return changed;
  }
  private persist(id: string, update: Json): number | undefined {
    if (
      (!this.replaying.has(id) && this.sessions.has(id)) ||
      this.recordingReplay.has(id)
    ) {
      try {
        const payload = this.recordingReplay.has(id)
          ? { ...object(update), historyReplayed: true }
          : update;
        const sourceId = this.options.history.appendUpdate(
          this.historySessionId(id),
          payload,
        );
        return Number.isSafeInteger(sourceId) && Number(sourceId) > 0
          ? Number(sourceId)
          : undefined;
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
      const historySourceId =
        typeof params.sessionId === "string" && params.update !== undefined
          ? this.persist(params.sessionId, params.update)
          : undefined;
      if (
        typeof params.sessionId === "string" &&
        this.sessions.has(params.sessionId)
      ) {
        const cached = this.sessionMetadata.get(params.sessionId),
          update = object(params.update);
        if (
          cached &&
          ["current_mode_update", "config_option_update"].includes(
            String(update.sessionUpdate),
          )
        ) {
          const session = { ...cached.session };
          if (update.sessionUpdate === "config_option_update")
            session.configOptions = update.configOptions ?? [];
          else if (session.modes)
            session.modes = {
              ...object(session.modes),
              currentModeId: update.currentModeId ?? null,
            };
          this.rememberSession(
            params.sessionId,
            cached.cwd,
            session,
            cached.settingsKnown,
          );
        }
      }
      this.emit({
        kind: "update",
        sessionId: params.sessionId ?? null,
        update: params.update ?? null,
        ...(historySourceId === undefined ? {} : { historySourceId }),
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
          toolCall: p.toolCall ?? null,
          choices: p.options ?? null,
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
