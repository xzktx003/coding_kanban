import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { EventHub } from "../core/events.js";
import {
  bodyObject,
  HttpError,
  object,
  stringField,
  type Json,
} from "../core/json.js";
import { AcpClient, validateCwd } from "./client.js";
import { installAgent, listAgents, validateAgent } from "./agents.js";
import { readImages } from "./images.js";
import type {
  AcpAgentDef,
  AcpHistory,
  AcpStartResult,
  ConnectionPolicy,
  ResolveBot,
  ResolvedBot,
  RunReport,
} from "./types.js";
export * from "./types.js";
export { AcpClient } from "./client.js";
export interface AcpServiceOptions {
  hub: EventHub;
  dataHome: string;
  env?: NodeJS.ProcessEnv;
  history: AcpHistory;
  resolveBot?: ResolveBot;
  timeoutMs?: number;
}
export class AcpService {
  private connections = new Map<string, AcpClient>();
  private bots = new Map<string, ResolvedBot>();
  private env: NodeJS.ProcessEnv;
  private botResolver?: ResolveBot;
  constructor(private options: AcpServiceOptions) {
    this.env = options.env ?? process.env;
    this.botResolver = options.resolveBot;
  }
  setBotResolver(resolve: ResolveBot) {
    this.botResolver = resolve;
  }
  listAgents() {
    return listAgents(this.options.dataHome, this.env);
  }
  installAgent(id: string) {
    return installAgent(id, this.options.dataHome, this.env);
  }
  async connect(params: {
    agent: AcpAgentDef;
    cwd: string;
    botId?: string;
    policy?: ConnectionPolicy;
    signal?: AbortSignal;
  }) {
    if (params.signal?.aborted) throw new Error("Bot run aborted");
    await validateCwd(params.cwd);
    const agent = validateAgent(params.agent);
    const connectionId = randomUUID();
    const client = new AcpClient(connectionId, agent, params.botId, {
      hub: this.options.hub,
      history: this.options.history,
      env: this.env,
      cwd: params.cwd,
      policy: params.policy,
      timeoutMs: this.options.timeoutMs,
      onExit: () => {
        this.connections.delete(connectionId);
        this.bots.delete(connectionId);
      },
    });
    const aborted = () => {
      void client.close().catch(() => {});
    };
    params.signal?.addEventListener("abort", aborted, { once: true });
    let initialize: Json;
    try {
      if (params.signal?.aborted) throw new Error("Bot run aborted");
      initialize = await client.initialize();
    } catch (e) {
      await client.close();
      throw e;
    } finally {
      params.signal?.removeEventListener("abort", aborted);
    }
    if (!client.rpc.available) {
      await client.close();
      throw new Error("ACP connection exited during initialization");
    }
    this.connections.set(connectionId, client);
    return { client, initialize };
  }
  async start(params: {
    agent_id: string;
    cwd: string;
    custom?: AcpAgentDef;
    bot_id?: string;
  }): Promise<AcpStartResult> {
    let bot: ResolvedBot | undefined;
    if (params.bot_id) {
      if (!this.botResolver)
        throw new Error("Bot configuration resolver is unavailable");
      bot = await this.botResolver(params.bot_id, {
        unattended: false,
        allowCollaboration: true,
      });
    }
    const agent =
      bot?.agent ??
      params.custom ??
      (await this.listAgents()).find((a) => a.id === params.agent_id);
    if (!agent) throw new Error(`unknown ACP agent: ${params.agent_id}`);
    const { client, initialize } = await this.connect({
      agent,
      cwd: params.cwd,
      botId: params.bot_id,
      policy: bot?.policy,
    });
    if (bot) this.bots.set(client.connectionId, bot);
    try {
      await bot?.selectProvider?.(client);
    } catch (e) {
      await this.stop(client.connectionId);
      throw e;
    }
    let session: Json | null = null;
    let sessionError: string | null = null;
    try {
      session = await this.newSession(client.connectionId, params.cwd);
    } catch (e) {
      sessionError = (e as Error).message;
    }
    return {
      connectionId: client.connectionId,
      sessionId:
        typeof object(session).sessionId === "string"
          ? (object(session).sessionId as string)
          : null,
      initialize,
      session,
      sessionError,
    };
  }
  get(connectionId: string) {
    const client = this.connections.get(connectionId);
    if (!client) throw new Error(`unknown ACP connection: ${connectionId}`);
    return client;
  }
  async newSession(connectionId: string, cwd: string) {
    const client = this.get(connectionId);
    const session = await client.newSession(cwd);
    await this.bots
      .get(connectionId)
      ?.applySettings?.(client, object(session).sessionId as string);
    return session;
  }
  async loadSession(connectionId: string, sessionId: string, cwd: string) {
    const client = this.get(connectionId);
    const session = await client.loadSession(sessionId, cwd);
    await this.bots.get(connectionId)?.applySettings?.(client, sessionId);
    return session;
  }
  async prompt(
    connectionId: string,
    sessionId: string | undefined,
    text: string,
    imagePaths: string[] = [],
  ) {
    const client = this.get(connectionId);
    const images = await readImages(
      imagePaths,
      join(this.options.dataHome, "uploads"),
    );
    return client.prompt(sessionId, text, images);
  }
  async cancel(connectionId: string, sessionId?: string) {
    await this.get(connectionId).cancel(sessionId);
  }
  async authenticate(connectionId: string, methodId: string) {
    return this.get(connectionId).authenticate(methodId);
  }
  async setMode(
    connectionId: string,
    sessionId: string | undefined,
    modeId: string,
  ) {
    return this.get(connectionId).setMode(sessionId, modeId);
  }
  async setModel(
    connectionId: string,
    sessionId: string | undefined,
    modelId: string,
    effort?: string,
  ) {
    return this.get(connectionId).setModel(sessionId, modelId, effort);
  }
  async setConfigOption(
    connectionId: string,
    sessionId: string | undefined,
    configId: string,
    value: Json,
  ) {
    return this.get(connectionId).setConfigOption(sessionId, configId, value);
  }
  async respondPermission(
    connectionId: string,
    requestId: string,
    optionId?: string,
    sessionId?: string,
  ) {
    await this.get(connectionId).respondPermission(
      requestId,
      optionId,
      sessionId,
    );
  }
  listSessions(cwd?: string, limit?: number) {
    return this.options.history.listSessions(cwd, limit);
  }
  getSession(sessionId: string) {
    return this.options.history.getUpdates(sessionId);
  }
  deleteSession(sessionId: string) {
    this.options.history.deleteSession(sessionId);
  }
  async stop(connectionId: string) {
    const client = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    this.bots.delete(connectionId);
    await client?.close();
  }
  async close() {
    await Promise.all([...this.connections.keys()].map((id) => this.stop(id)));
  }
  async runBotUnattended(
    botId: string,
    prompt: string,
    cwd?: string,
    allowCollaboration = true,
    onStarted?: (sessionId: string) => void,
    signal?: AbortSignal,
  ): Promise<RunReport> {
    if (!this.botResolver)
      throw new Error("Bot configuration resolver is unavailable");
    const bot = await this.botResolver(botId, {
      unattended: true,
      allowCollaboration,
    });
    if (!bot.policy.unattended)
      throw new Error("Unattended bot policy is required");
    const workdir = cwd || bot.cwd;
    const { client } = await this.connect({
      agent: bot.agent,
      cwd: workdir,
      botId,
      policy: bot.policy,
      signal,
    });
    const aborted = () => {
      void this.stop(client.connectionId).catch(() => {});
    };
    signal?.addEventListener("abort", aborted, { once: true });
    let sessionId = "";
    const emit = (status: string) =>
      this.options.hub.publish("bot:activity", { botId, sessionId, status });
    try {
      if (signal?.aborted) throw new Error("Bot run aborted");
      const session = await client.newSession(workdir);
      sessionId = object(session).sessionId as string;
      await bot.applySettings?.(client, sessionId);
      onStarted?.(sessionId);
      emit("working");
      await client.prompt(sessionId, prompt);
      const blocked = bot.policy.unattended.blocked;
      const parts: string[] = [];
      let bytes = 0;
      for (const item of this.options.history.getUpdates(sessionId)) {
        const update = object(item);
        const content = object(update.content);
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          content.type === "text" &&
          typeof content.text === "string"
        ) {
          bytes += Buffer.byteLength(content.text);
          if (bytes > 4 * 1024 * 1024)
            throw new Error("Bot reply exceeds 4 MiB limit");
          parts.push(content.text);
        }
      }
      this.options.history.incrementUnread?.(botId);
      emit(blocked ? "blocked" : "done");
      return { sessionId, reply: parts.join(""), blocked };
    } catch (e) {
      emit("failed");
      throw e;
    } finally {
      signal?.removeEventListener("abort", aborted);
      await this.stop(client.connectionId);
    }
  }
}
export function createAcpService(options: AcpServiceOptions) {
  return new AcpService(options);
}
export function registerAcpRoutes(app: FastifyInstance, service: AcpService) {
  const optional = (b: ReturnType<typeof bodyObject>, key: string) =>
    b[key] === undefined || b[key] === null ? undefined : stringField(b, key);
  app.get("/api/acp/agents", () => service.listAgents());
  app.post("/api/acp/install-agent", (r) =>
    service.installAgent(stringField(bodyObject(r.body), "agent_id")),
  );
  app.post("/api/acp/start", (r) => {
    const b = bodyObject(r.body);
    return service.start({
      agent_id: stringField(b, "agent_id"),
      cwd: stringField(b, "cwd"),
      custom: b.custom ? validateAgent(b.custom) : undefined,
      bot_id: optional(b, "bot_id"),
    });
  });
  app.post("/api/acp/new-session", (r) => {
    const b = bodyObject(r.body);
    return service.newSession(
      stringField(b, "connection_id"),
      stringField(b, "cwd"),
    );
  });
  app.post("/api/acp/load-session", (r) => {
    const b = bodyObject(r.body);
    return service.loadSession(
      stringField(b, "connection_id"),
      stringField(b, "session_id"),
      stringField(b, "cwd"),
    );
  });
  app.post("/api/acp/prompt", (r) => {
    const b = bodyObject(r.body);
    if (typeof b.text !== "string") throw new HttpError(400, "Invalid text");
    const paths = b.image_paths ?? [];
    if (
      !Array.isArray(paths) ||
      paths.some((p) => typeof p !== "string" || p.includes("\0"))
    )
      throw new HttpError(400, "Invalid image_paths");
    return service.prompt(
      stringField(b, "connection_id"),
      optional(b, "session_id"),
      b.text,
      paths as string[],
    );
  });
  app.post("/api/acp/cancel", async (r, reply) => {
    const b = bodyObject(r.body);
    await service.cancel(
      stringField(b, "connection_id"),
      optional(b, "session_id"),
    );
    return reply.code(200).send();
  });
  app.post("/api/acp/authenticate", async (r, reply) => {
    const b = bodyObject(r.body);
    await service.authenticate(
      stringField(b, "connection_id"),
      stringField(b, "method_id"),
    );
    return reply.code(200).send();
  });
  app.post("/api/acp/set-mode", (r) => {
    const b = bodyObject(r.body);
    return service.setMode(
      stringField(b, "connection_id"),
      optional(b, "session_id"),
      stringField(b, "mode_id"),
    );
  });
  app.post("/api/acp/set-model", (r) => {
    const b = bodyObject(r.body);
    return service.setModel(
      stringField(b, "connection_id"),
      optional(b, "session_id"),
      stringField(b, "model_id"),
      optional(b, "reasoning_effort"),
    );
  });
  app.post("/api/acp/set-config-option", (r) => {
    const b = bodyObject(r.body);
    if (!("value" in b)) throw new HttpError(400, "Missing value");
    return service.setConfigOption(
      stringField(b, "connection_id"),
      optional(b, "session_id"),
      stringField(b, "config_id"),
      b.value,
    );
  });
  app.post("/api/acp/respond-permission", async (r, reply) => {
    const b = bodyObject(r.body);
    await service.respondPermission(
      stringField(b, "connection_id"),
      stringField(b, "request_id"),
      optional(b, "option_id"),
      optional(b, "session_id"),
    );
    return reply.code(200).send();
  });
  app.post("/api/acp/stop", async (r, reply) => {
    await service.stop(stringField(bodyObject(r.body), "connection_id"));
    return reply.code(200).send();
  });
  app.post("/api/acp/sessions", (r) => {
    const b = bodyObject(r.body);
    if (
      b.limit !== undefined &&
      (!Number.isSafeInteger(b.limit) || Number(b.limit) < 0)
    )
      throw new HttpError(400, "Invalid limit");
    return service.listSessions(
      optional(b, "cwd"),
      b.limit as number | undefined,
    );
  });
  app.post("/api/acp/session", (r) =>
    service.getSession(stringField(bodyObject(r.body), "session_id")),
  );
  app.post("/api/acp/delete-session", async (r, reply) => {
    service.deleteSession(stringField(bodyObject(r.body), "session_id"));
    return reply.code(200).send();
  });
}
