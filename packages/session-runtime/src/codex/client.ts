import { randomUUID } from "node:crypto";
import { EventHub } from "../core/events.js";
import { KeyedSerial } from "../core/serial.js";
import {
  HttpError,
  isObject,
  object,
  type Json,
  type JsonObject,
} from "../core/json.js";
import { StdioRpc, type ServerRequest } from "../transport/rpc.js";
import { sanitizeCodexNotification } from "./projection.js";
import { discoverCodex } from "./executable.js";
import { Ownership, readHistory, type Rpc } from "./ownership.js";
import { boundedText, rollback } from "./protocol.js";

export interface CodexOptions {
  hub: EventHub;
  instance: string;
  env?: NodeJS.ProcessEnv;
  launch?: { command: string; args: string[] };
  sweepIntervalMs?: number;
  resolveEnv?: () => Promise<NodeJS.ProcessEnv>;
}
const requests: Record<string, { event: string; kind: string }> = {
  "item/commandExecution/requestApproval": {
    event: "codex/approval-request",
    kind: "commandExecution",
  },
  "item/fileChange/requestApproval": {
    event: "codex/approval-request",
    kind: "fileChange",
  },
  "item/tool/requestUserInput": {
    event: "codex/request-user-input",
    kind: "requestUserInput",
  },
  "mcpServer/elicitation/request": {
    event: "codex/elicitation-request",
    kind: "mcpServerElicitation",
  },
  "item/permissions/requestApproval": {
    event: "codex/permissions-request",
    kind: "permissionsApproval",
  },
};

export class CodexService {
  readonly ownership: Ownership;
  readonly accountOperations = new KeyedSerial();
  private starting?: Promise<StdioRpc>;
  private transport?: StdioRpc;
  private closed = false;
  private sweep?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private pending = new Map<string, { event: string; payload: JsonObject }>();
  private rollbacks = new Map<string, { key: string; work: Promise<Json> }>();

  constructor(readonly options: CodexOptions) {
    this.ownership = new Ownership(this.raw);
  }

  private async connect(): Promise<StdioRpc> {
    if (this.closed) throw new Error("NOT_SENT: Codex service closed");
    const env = this.options.resolveEnv
      ? await this.options.resolveEnv()
      : (this.options.env ?? process.env);
    const launch = this.options.launch ?? {
      command: await discoverCodex(env),
      args: ["app-server", "-c", "thread_unload_delay_secs=2"],
    };
    if (this.closed) throw new Error("NOT_SENT: Codex service closed");
    const rpc = new StdioRpc({
      ...launch,
      env,
      onRequest: (request) => this.onRequest(request),
      onNotification: (notification) => this.onNotification(notification),
      onDiagnostic: (text) =>
        this.options.hub.publish("codex:stderr", { message: text }),
      onExit: () => {
        this.pending.clear();
        this.ownership.invalidate();
        this.options.hub.invalidatePending("codex");
        this.options.hub.publish("codex:disconnected", {});
      },
    });
    this.transport = rpc;
    try {
      const response = await rpc.request("initialize", {
        clientInfo: {
          name: "codexia",
          title: "Coding Kanban",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: false,
          optOutNotificationMethods: null,
        },
      });
      await rpc.notify("initialized");
      this.options.hub.publish("codex:initialized", object(response));
      const interval = this.options.sweepIntervalMs ?? 1000;
      if (interval > 0) {
        this.sweep = setInterval(() => {
          if (this.sweeping || this.closed || !rpc.available) return;
          this.sweeping = true;
          void (async () => {
            for (const id of this.ownership.ids()) {
              if (this.closed || !rpc.available) break;
              await this.ownership.sweep(id);
            }
          })().finally(() => {
            this.sweeping = false;
          });
        }, interval);
        this.sweep.unref();
      }
      return rpc;
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }

  private ready(): Promise<StdioRpc> {
    if (this.closed)
      return Promise.reject(new Error("NOT_SENT: Codex service closed"));
    this.starting ??= this.connect();
    return this.starting;
  }
  readonly raw: Rpc = async (method, params) =>
    (await this.ready()).request(method, params);
  readonly call: Rpc = (method, params) => this.ownership.call(method, params);
  readHistory(id: string): Promise<Json> {
    return readHistory(this.raw, id);
  }

  private async onRequest(request: ServerRequest): Promise<void> {
    const mapping = requests[request.method];
    if (!mapping || !isObject(request.params)) {
      await this.transport?.respondError(
        request.id,
        -32601,
        "Unsupported server request",
      );
      return;
    }
    const payload: JsonObject = {
      ...request.params,
      requestId: request.id,
      type: mapping.kind,
      requestToken: `${this.options.instance}:${randomUUID()}`,
    };
    if (typeof payload.threadId === "string")
      this.ownership.pendingRequest(request.id, payload.threadId);
    this.pending.set(JSON.stringify(request.id), {
      event: mapping.event,
      payload,
    });
    this.options.hub.publish(mapping.event, payload);
  }

  private onNotification(notification: JsonObject): void {
    const sanitized = sanitizeCodexNotification(notification);
    if (!sanitized) return;
    notification = sanitized;
    const method = String(notification.method),
      params = object(notification.params);
    this.ownership.observe(method, params);
    if (method === "serverRequest/resolved")
      this.pending.delete(JSON.stringify(params.requestId));
    if (
      ["turn/completed", "thread/closed", "thread/deleted"].includes(method) ||
      (method === "error" && params.willRetry === false)
    ) {
      const turn =
        method === "turn/completed" ? object(params.turn).id : params.turnId;
      for (const [key, request] of this.pending)
        if (
          request.payload.threadId === params.threadId &&
          (["thread/closed", "thread/deleted"].includes(method) ||
            request.payload.turnId === turn)
        ) {
          this.pending.delete(key);
          this.ownership.resolveRequest(
            request.payload.requestId as string | number,
          );
        }
    }
    this.options.hub.publish("codex:notification", notification);
  }

  async respond(kind: string, body: JsonObject): Promise<void> {
    const id = body.request_id;
    if (!(typeof id === "string" || Number.isSafeInteger(id)))
      throw new HttpError(400, "Invalid request_id");
    const request = this.pending.get(JSON.stringify(id));
    if (!request || request.payload.type !== kind)
      throw new Error(
        "SESSION_RPC_EXPIRED: 请求身份、运行实例已改变，回复尚未发送",
      );
    let result: Json;
    if (kind === "commandExecution" || kind === "fileChange") {
      if (!("decision" in body)) throw new HttpError(400, "decision required");
      result = { decision: body.decision };
    } else if (kind === "requestUserInput") {
      if (!("response" in body)) throw new HttpError(400, "response required");
      result = body.response;
    } else if (kind === "mcpServerElicitation") {
      if (typeof body.action !== "string")
        throw new HttpError(400, "action required");
      result = {
        action: body.action,
        content: body.content ?? null,
        _meta: body.meta ?? null,
      };
    } else {
      if (!("permissions" in body) || typeof body.scope !== "string")
        throw new HttpError(400, "permissions and scope required");
      if (
        body.strict_auto_review !== undefined &&
        typeof body.strict_auto_review !== "boolean"
      )
        throw new HttpError(400, "Invalid strict_auto_review");
      result = {
        permissions: body.permissions,
        scope: body.scope,
        strictAutoReview: body.strict_auto_review ?? false,
      };
    }
    // Legacy callers may omit the identity object, but still must address a live matching RPC.
    const identity =
      body.request === undefined || body.request === null
        ? request.payload
        : object(body.request);
    if (
      !this.options.hub.claimReply(
        identity,
        id as string | number,
        request.event,
        kind,
      )
    )
      throw new Error(
        "SESSION_RPC_EXPIRED: 请求身份、运行实例已改变或正在提交，回复尚未发送",
      );
    if (!this.transport?.available)
      throw new Error("DELIVERY_UNKNOWN: Codex transport unavailable");
    await this.transport.respond(id as string | number, result);
    this.ownership.resolveRequest(id as string | number);
  }

  rollback(params: JsonObject): Promise<Json> {
    let id: string;
    try {
      id = boundedText(params.threadId, 512, "threadId", true);
    } catch (error) {
      return Promise.reject(error);
    }
    const key = JSON.stringify([params.numTurns, params.beforeTurnId ?? null]);
    const previous = this.rollbacks.get(id);
    if (previous)
      return previous.key === key
        ? previous.work
        : Promise.reject(
            new Error("SESSION_ROLLBACK_PENDING: 当前会话正在回滚其他边界"),
          );
    const work = rollback(params, this.call).finally(() =>
      this.rollbacks.delete(id),
    );
    this.rollbacks.set(id, { key, work });
    return work;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweep);
    await this.transport?.close();
  }
}
