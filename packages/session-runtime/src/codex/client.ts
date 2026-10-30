import {
  mcpOAuthThreadIdSupported,
  classifySubagentThread,
  type SubagentThread,
} from "@agent-orchestrator/shared";
import { createHash, randomUUID } from "node:crypto";
import { nativeVersionFromUserAgent } from "./native-version.js";
import { EventHub } from "../core/events.js";
import { KeyedSerial } from "../core/serial.js";
import {
  HttpError,
  isObject,
  object,
  type Json,
  type JsonObject,
} from "../core/json.js";
import {
  JsonLineRpc,
  StdioRpc,
  type RpcCallbacks,
  type ServerRequest,
} from "../transport/rpc.js";
import { sanitizeCodexNotification } from "./projection.js";
import { connectDaemonStream, daemonConfig } from "./daemon.js";
import { Ownership, readHistory, loadedIds, type Rpc } from "./ownership.js";
import { readLegacyHistory } from "./legacy-history.js";
import { boundedText, rollback } from "./protocol.js";
import { GithubPreviewService } from "./github-preview.js";
import { SlackPreviewService } from "./slack-preview.js";
import {
  FeedbackPreflightService,
  type FeedbackPreflightOptions,
} from "./feedback-preflight.js";

export interface CodexOptions {
  hub: EventHub;
  instance: string;
  dataHome?: string;
  env?: NodeJS.ProcessEnv;
  launch?: { command: string; args: string[] };
  sweepIntervalMs?: number;
  resolveEnv?: () => Promise<NodeJS.ProcessEnv>;
  feedbackPreflight?: FeedbackPreflightOptions;
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

// These exact handshake versions passed isolated native parent-only release,
// writer transfer, same-ID history restore, and dispatch to the original child.
// Child writers remain with their original app-server; the verified transfer
// covers the parent writer and same-process restoration of the native family.
// Unknown/new versions retain loaded descendants until their lifecycle is tested.
const verifiedParentOnlyReleaseVersions = new Set([
  "0.162.1",
  "0.162.0-alpha.17.2",
]);
export function supportsParentOnlyRelease(userAgent: unknown): boolean {
  if (typeof userAgent !== "string") return false;
  const version = /^codexia\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(
    userAgent,
  )?.[1];
  return (
    version !== undefined && verifiedParentOnlyReleaseVersions.has(version)
  );
}

export class CodexService {
  mcpOAuthThreadId = false;
  readonly ownership: Ownership;
  readonly accountOperations = new KeyedSerial();
  private starting?: Promise<JsonLineRpc>;
  private transport?: JsonLineRpc;
  private readonly transports = new Set<JsonLineRpc>();
  private closed = false;
  private connectionGeneration = 0;
  private accountRevision = 0;
  private nativeVersion?: string;
  private verifiedOperationScope?: string;
  private readonly attachedThreads = new Set<string>();
  private loadedRead?: Promise<Set<string>>;
  private readonly accessReads = new Map<string, Promise<JsonObject>>();
  private connectionScope?: string;
  private verifyDaemonBinding?: () => Promise<string>;
  connectionSnapshot(): {
    mode: "shared-daemon" | "fixture";
    connected: boolean;
    generation: number;
    accountRevision: number;
    nativeVersion?: string;
    scope?: string;
  } {
    return {
      mode: this.options.launch ? "fixture" : "shared-daemon",
      connected: this.transport?.available ?? false,
      generation: this.connectionGeneration,
      accountRevision: this.accountRevision,
      ...(this.nativeVersion ? { nativeVersion: this.nativeVersion } : {}),
      ...(this.connectionScope ? { scope: this.connectionScope } : {}),
    };
  }
  private sweep?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private pending = new Map<
    string,
    { event: string; payload: JsonObject; fingerprint: string }
  >();
  private rollbacks = new Map<string, { key: string; work: Promise<Json> }>();
  private previews?: SlackPreviewService;
  private githubPreview?: GithubPreviewService;
  private feedbackPolicy?: FeedbackPreflightService;
  get feedbackPreflight(): FeedbackPreflightService {
    return (this.feedbackPolicy ??= new FeedbackPreflightService(
      (method, params, options) => this.raw(method, params, options),
      this.options.instance,
      {
        ...this.options.feedbackPreflight,
        baseURL:
          this.options.feedbackPreflight?.baseURL ??
          (this.options.env ?? process.env).SESSION_CODEX_FEEDBACK_API_BASE_URL,
      },
    ));
  }
  get githubPreviews(): GithubPreviewService {
    return (this.githubPreview ??= new GithubPreviewService(
      (method, params) => this.raw(method, params),
      this.options.instance,
    ));
  }
  get slackPreviews(): SlackPreviewService {
    return (this.previews ??= new SlackPreviewService(
      (method, params) => this.raw(method, params),
      this.options.instance,
    ));
  }

  constructor(readonly options: CodexOptions) {
    this.ownership = new Ownership(this.raw, { sharedDaemon: !options.launch });
  }

  private async connect(): Promise<JsonLineRpc> {
    if (this.closed) throw new Error("NOT_SENT: Codex service closed");
    const env =
      this.options.launch && this.options.resolveEnv
        ? await this.options.resolveEnv()
        : (this.options.env ?? process.env);
    if (this.closed) throw new Error("NOT_SENT: Codex service closed");
    let rpc: JsonLineRpc;
    const callbacks: RpcCallbacks = {
      onRequest: (request) => {
        if (this.transport === rpc && rpc.available)
          return this.onRequest(request);
      },
      onNotification: (notification) => {
        if (this.transport === rpc && rpc.available)
          this.onNotification(notification);
      },
      onDiagnostic: (text) =>
        this.options.hub.publish("codex:stderr", { message: text }),
      onExit: (error) => {
        if (this.transport !== rpc) return;
        if (!(rpc instanceof StdioRpc)) void rpc.close();
        this.transport = undefined;
        this.starting = undefined;
        clearInterval(this.sweep);
        this.sweep = undefined;
        this.sweeping = false;
        this.mcpOAuthThreadId = false;
        this.nativeVersion = undefined;
        this.verifyDaemonBinding = undefined;
        this.feedbackPolicy?.invalidate();
        this.previews?.invalidate();
        this.githubPreview?.invalidate();
        this.pending.clear();
        this.attachedThreads.clear();
        this.loadedRead = undefined;
        this.ownership.invalidate();
        this.options.hub.invalidatePending("codex");
        this.options.hub.publish("codex:disconnected", {
          reason: /frame exceeded/.test(error.message)
            ? "frame_limit"
            : /process exited/.test(error.message)
              ? "process_exit"
              : "transport_error",
          nativeProcessAlive: rpc instanceof StdioRpc ? rpc.processAlive : null,
          executionState: "unknown",
        });
      },
    };
    if (this.options.launch)
      rpc = new StdioRpc({ ...this.options.launch, env, ...callbacks });
    else {
      const connection = await connectDaemonStream(
        env,
        undefined,
        this.options.resolveEnv,
      );
      if (this.closed) {
        connection.stream.destroy();
        throw new Error("NOT_SENT: Codex service closed");
      }
      const closed = new Promise<void>((resolve) =>
        connection.stream.once("close", () => resolve()),
      );
      rpc = new JsonLineRpc(
        callbacks,
        connection.stream,
        connection.stream,
        closed,
      );
      this.connectionScope = connection.scope;
      this.verifyDaemonBinding = connection.verifyIdentity;
    }
    this.connectionGeneration++;
    // A broken pipe is not proof that the native task process exited. Retain
    // ownership until exit or explicit service shutdown; reconnect never kills it.
    this.transports.add(rpc);
    void rpc.closed.then(() => this.transports.delete(rpc));
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
      this.mcpOAuthThreadId = mcpOAuthThreadIdSupported(
        object(response).userAgent,
      );
      this.nativeVersion = nativeVersionFromUserAgent(
        object(response).userAgent,
      );
      this.ownership.setIdleDescendantRelease(
        supportsParentOnlyRelease(object(response).userAgent),
      );
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
            if (this.transport === rpc) this.sweeping = false;
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

  private async ready(): Promise<JsonLineRpc> {
    if (this.closed)
      return Promise.reject(new Error("NOT_SENT: Codex service closed"));
    // stdout end can precede the exit/close events by a scheduling turn. Wait
    // briefly for that evidence without signalling an actually living process.
    const failed = [...this.transports].filter((rpc) => !rpc.available);
    await Promise.all(failed.map((rpc) => rpc.waitForExit(100)));
    if (failed.some((rpc) => rpc instanceof StdioRpc && rpc.processAlive))
      return Promise.reject(
        new Error(
          "NOT_SENT: 原生传输不可用，但执行进程仍存活；已保留任务，请核实后恢复连接",
        ),
      );
    // Also tolerate a retained failed transport (including a live legacy
    // runtime). Never retry the failed RPC; only a subsequent call reconnects.
    if (this.transport && !this.transport.available) {
      this.transport = undefined;
      this.starting = undefined;
      clearInterval(this.sweep);
      this.sweep = undefined;
      this.sweeping = false;
      this.pending.clear();
      this.ownership.invalidate();
      this.options.hub.invalidatePending("codex");
    }
    if (!this.starting) {
      const starting = this.connect();
      this.starting = starting;
      // Discovery/initialize can fail before onExit owns a transport. Clear only
      // this attempt; its late rejection must not discard a newer connection.
      void starting.catch(() => {
        if (this.starting === starting) this.starting = undefined;
      });
    }
    return this.starting;
  }
  readonly raw: Rpc = async (method, params, options) => {
    const transport = await this.ready();
    const response = await transport.request(method, params, options);
    if (this.transport === transport && transport.available) {
      const id = object(object(response).thread).id;
      if (
        ["thread/start", "thread/resume", "thread/fork"].includes(method) &&
        typeof id === "string"
      )
        this.attachedThreads.add(id);
      if (
        method === "thread/unsubscribe" &&
        typeof object(params).threadId === "string"
      )
        this.attachedThreads.delete(String(object(params).threadId));
    }
    return response;
  };
  readonly call: Rpc = (method, params, options) =>
    this.ownership.call(method, params, options);
  readHistory(id: string): Promise<Json> {
    // Full legacy transcripts can exceed the shared 32 MiB frame and kill the
    // live app-server. Paginated reads stay here; the legacy body is isolated.
    return readHistory(this.raw, id, {}, (threadId) =>
      readLegacyHistory(this.raw, this.options, threadId),
    );
  }

  private async onRequest(request: ServerRequest): Promise<void> {
    const mapping = requests[request.method];
    if (!mapping || !isObject(request.params)) {
      if (!this.options.launch) {
        // A shared native request may also be delivered to another capable client. An error
        // here can consume its global callback. Keep it unresolved rather than implicitly deny.
        this.options.hub.publish("codex:unsupported-request", {
          method: request.method,
          requestId: request.id,
        });
        return;
      }
      await this.transport?.respondError(
        request.id,
        -32601,
        "Unsupported server request",
      );
      return;
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([request.method, request.params]))
      .digest("hex");
    const previous = this.pending.get(JSON.stringify(request.id));
    if (previous?.fingerprint === fingerprint) return; // Native replay keeps the live approval token and claim.
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
      fingerprint,
    });
    this.options.hub.publish(mapping.event, payload);
  }

  private onNotification(notification: JsonObject): void {
    const sanitized = sanitizeCodexNotification(notification);
    if (!sanitized) return;
    notification = sanitized;
    const method = String(notification.method),
      params = object(notification.params);
    if (["account/updated", "account/login/completed"].includes(method)) {
      this.accountRevision++;
      this.pending.clear();
      this.attachedThreads.clear();
      this.loadedRead = undefined;
      this.ownership.invalidate();
      this.options.hub.invalidatePending("codex");
    }
    if (
      ["thread/closed", "thread/deleted"].includes(method) &&
      typeof params.threadId === "string"
    )
      this.attachedThreads.delete(params.threadId);
    this.feedbackPolicy?.observe(method);
    this.previews?.observe(method, params);
    this.githubPreview?.observe(method, params);
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
    const transport = this.transport;
    await transport.respond(id as string | number, result, () => {
      if (
        this.transport !== transport ||
        !transport.available ||
        this.pending.get(JSON.stringify(id)) !== request
      )
        throw new Error(
          "SESSION_RPC_EXPIRED: 请求已由其他客户端处理或运行连接已改变，回复未发送",
        );
    });
    this.ownership.resolveRequest(id as string | number);
  }

  private operationScope(): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          this.options.instance,
          this.connectionScope ?? "fixture",
          this.connectionGeneration,
          this.accountRevision,
        ]),
      )
      .digest("hex");
  }
  /** Small read-only metadata for the explicit live-connection affordance. Never resumes a thread. */
  accessSnapshot(threadId: string): Promise<JsonObject> {
    if (this.options.launch) return this.ownership.access(threadId);
    const previous = this.accessReads.get(threadId);
    if (previous) return previous;
    const work = (async () => {
      await this.ready();
      const scope = this.operationScope();
      const access = await this.ownership.access(threadId);
      if (!this.loadedRead) {
        const reading = loadedIds(this.raw);
        this.loadedRead = reading;
        void reading
          .finally(() => {
            if (this.loadedRead === reading) this.loadedRead = undefined;
          })
          .catch(() => {});
      }
      const loaded = (await this.loadedRead).has(threadId);
      const attached = this.attachedThreads.has(threadId);
      let activeTurnId: string | null = null;
      if (loaded && !attached) {
        const metadata = object(
          await this.raw("thread/read", { threadId, includeTurns: false }),
        );
        if (object(object(metadata.thread).status).type === "active") {
          const page = object(
            await this.raw("thread/turns/list", {
              threadId,
              limit: 1,
              sortDirection: "desc",
              itemsView: "notLoaded",
            }),
          );
          const turn = object(Array.isArray(page.data) ? page.data[0] : null);
          if (typeof turn.id === "string" && turn.status === "inProgress")
            activeTurnId = turn.id;
        }
      }
      if (scope !== this.operationScope() || !this.transport?.available)
        throw new Error(
          "NOT_SENT: read-only access scope changed during verification",
        );
      return { ...access, sharedDaemon: true, attached, loaded, activeTurnId };
    })().finally(() => {
      if (this.accessReads.get(threadId) === work)
        this.accessReads.delete(threadId);
    });
    this.accessReads.set(threadId, work);
    return work;
  }
  async operationContext(): Promise<{
    scope: string;
    namespace: string;
    daemonIdentity?: string;
  }> {
    await this.ready();
    const scope = this.operationScope();
    const verifyBinding = this.verifyDaemonBinding;
    const daemonIdentity = verifyBinding ? await verifyBinding() : undefined;
    const response = object(
      await this.raw("account/read", { refreshToken: false }),
    );
    if (scope !== this.operationScope() || !this.transport?.available)
      throw new Error(
        "NOT_SENT: account or execution scope changed during context verification",
      );
    if (
      this.verifyDaemonBinding !== verifyBinding ||
      (verifyBinding && (await verifyBinding()) !== daemonIdentity) ||
      scope !== this.operationScope() ||
      !this.transport?.available
    )
      throw new Error(
        "NOT_SENT: official daemon endpoint changed during context verification",
      );
    const account = object(response.account);
    if (
      !("account" in response) ||
      typeof response.requiresOpenaiAuth !== "boolean" ||
      (response.account !== null &&
        !["apiKey", "chatgpt", "amazonBedrock", "gcp"].includes(
          String(account.type),
        ))
    )
      throw new Error(
        "DAEMON_CONTEXT_UNSUPPORTED: native account identity could not be verified",
      );
    const routing =
      object(response.workspaceRouting).chatgptAccountId ??
      account.accountId ??
      null;
    if (
      account.type === "chatgpt" &&
      (typeof routing !== "string" || !routing || routing.length > 512)
    )
      throw new Error(
        "DAEMON_CONTEXT_UNSUPPORTED: stable native ChatGPT account identity is unavailable",
      );
    const historyHome = daemonConfig(this.options.env ?? process.env).home;
    // API-key/Bedrock accounts expose no stable user ID. Their durable namespace is the
    // native history domain plus account kind, never an email/plan-derived authorization.
    const namespace = createHash("sha256")
      .update(
        JSON.stringify([
          historyHome,
          account.type ?? "unauthenticated",
          routing,
        ]),
      )
      .digest("hex");
    this.verifiedOperationScope = scope;
    return { scope, namespace, ...(daemonIdentity ? { daemonIdentity } : {}) };
  }
  isOperationScopeCurrent(expectedScope: string): boolean {
    return (
      !!this.transport?.available &&
      this.verifiedOperationScope === expectedScope &&
      this.operationScope() === expectedScope
    );
  }
  guardedCall(
    method: string,
    params: Json,
    expectedScope: string,
    beforeSend?: () => void,
  ): Promise<Json> {
    const guard = () => {
      if (!this.isOperationScopeCurrent(expectedScope))
        throw new Error(
          "NOT_SENT: account or execution scope changed; operation was not sent",
        );
      beforeSend?.();
    };
    guard();
    return this.ownership.call(method, params, { beforeSend: guard });
  }

  /** Explicit user interaction only. This is never called by history, prewarm, or reconnect. */
  async attachLoadedThread(
    threadId: string,
    expectedTurnId: string,
    expectedScope: string,
  ): Promise<Json> {
    let changed = false;
    const observation = this.options.hub.subscribe({
      filter: (event) => {
        if (event.event === "codex:notification") {
          const params = object(event.payload.params);
          if (
            params.threadId === threadId &&
            [
              "thread/status/changed",
              "thread/closed",
              "thread/deleted",
              "turn/started",
              "turn/completed",
            ].includes(String(event.payload.method))
          )
            changed = true;
        }
        return false;
      },
    });
    try {
      const metadata = object(
        await this.raw("thread/read", { threadId, includeTurns: false }),
      );
      if (
        object(metadata.thread).id !== threadId ||
        object(object(metadata.thread).status).type !== "active"
      )
        throw new Error(
          "NOT_SENT: live attachment requires the exact active thread",
        );
      if (!(await loadedIds(this.raw)).has(threadId))
        throw new Error(
          "NOT_SENT: thread is not loaded; explicit restore is required",
        );
      const latest = object(
        await this.raw("thread/turns/list", {
          threadId,
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        }),
      );
      const turn = object(
        Array.isArray(latest.data) ? latest.data[0] : undefined,
      );
      if (turn.id !== expectedTurnId || turn.status !== "inProgress")
        throw new Error("NOT_SENT: active turn changed before live attachment");
      return await this.guardedCall(
        "thread/resume",
        { threadId, excludeTurns: true },
        expectedScope,
        () => {
          if (changed)
            throw new Error(
              "NOT_SENT: task changed during live attachment; review its current state",
            );
        },
      );
    } finally {
      observation.close();
    }
  }

  /** Explicit send preparation only; never called while browsing or warming history. */
  async loadQueueThread(
    threadId: string,
    expectedScope: string,
  ): Promise<Json> {
    return this.prepareQueueThread(threadId, expectedScope, []);
  }

  /** Explicit continuation only: native resume itself may advance this captured queue. */
  async restoreQueueThread(
    threadId: string,
    expectedScope: string,
    queuedSubmissionIds: string[],
  ): Promise<Json> {
    if (
      !queuedSubmissionIds.length ||
      queuedSubmissionIds.length > 256 ||
      new Set(queuedSubmissionIds).size !== queuedSubmissionIds.length ||
      queuedSubmissionIds.some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          id.length > 512 ||
          /[\x00-\x1f]/.test(id),
      )
    )
      throw new HttpError(400, "Invalid captured native queue ids");
    return this.prepareQueueThread(
      threadId,
      expectedScope,
      queuedSubmissionIds,
    );
  }

  private async prepareQueueThread(
    threadId: string,
    expectedScope: string,
    expectedIds: string[],
  ): Promise<Json> {
    let changed = false;
    const observation = this.options.hub.subscribe({
      filter: (event) => {
        if (
          event.event === "codex:notification" &&
          object(event.payload.params).threadId === threadId &&
          [
            "thread/queue/changed",
            "thread/goal/updated",
            "thread/goal/cleared",
            "thread/status/changed",
            "thread/closed",
            "thread/deleted",
            "turn/started",
            "turn/completed",
          ].includes(String(event.payload.method))
        )
          changed = true;
        return false;
      },
    });
    try {
      const metadata = object(
          await this.raw("thread/read", { threadId, includeTurns: false }),
        ),
        thread = object(metadata.thread);
      if (
        thread.id !== threadId ||
        !["idle", "notLoaded"].includes(String(object(thread.status).type))
      )
        throw new Error(
          "NOT_SENT: task changed; review the active task before restoring its queue",
        );
      if (
        thread.canAcceptDirectInput === false ||
        (classifySubagentThread(thread as unknown as SubagentThread) !==
          "main" &&
          thread.canAcceptDirectInput !== true)
      )
        throw new Error("NOT_SENT: native task does not allow direct input");
      const ids: string[] = [],
        seen = new Set<string>();
      let cursor: Json = null;
      do {
        const queue = object(
          await this.raw("thread/queue/list", {
            threadId,
            limit: expectedIds.length ? 100 : 1,
            ...(cursor ? { cursor } : {}),
          }),
        );
        if (
          !Array.isArray(queue.data) ||
          queue.data.some((item) => typeof object(item).id !== "string") ||
          queue.nextCursor === undefined
        )
          throw new Error(
            "NOT_SENT: native queue identity could not be verified",
          );
        if (
          !expectedIds.length &&
          (queue.data.length || queue.nextCursor !== null)
        )
          throw new Error(
            "NOT_SENT: native queue already contains work; explicitly continue it before submitting",
          );
        ids.push(...queue.data.map((item) => String(object(item).id)));
        if (ids.length > expectedIds.length)
          throw new Error(
            "NOT_SENT: native queue contains uncaptured work; explicitly review it before continuing",
          );
        cursor = queue.nextCursor;
        if (cursor !== null && (typeof cursor !== "string" || seen.has(cursor)))
          throw new Error("NOT_SENT: invalid native queue cursor");
        if (typeof cursor === "string") seen.add(cursor);
        if (seen.size > 16)
          throw new Error(
            "NOT_SENT: native queue verification exceeded its page budget",
          );
      } while (cursor !== null);
      if (JSON.stringify(ids) !== JSON.stringify(expectedIds))
        throw new Error(
          "NOT_SENT: native queue changed; explicitly review it before continuing",
        );
      const goal = object(await this.raw("thread/goal/get", { threadId }));
      if (
        !("goal" in goal) ||
        (goal.goal !== null && object(goal.goal).status === "active")
      )
        throw new Error(
          "NOT_SENT: active or unverified Goal requires explicit continuation",
        );
      if ((await loadedIds(this.raw)).has(threadId))
        return { alreadyLoaded: true };
      return await this.guardedCall(
        "thread/resume",
        { threadId, excludeTurns: true },
        expectedScope,
        () => {
          if (changed)
            throw new Error(
              "NOT_SENT: task, queue, or Goal changed during explicit send preparation",
            );
        },
      );
    } finally {
      observation.close();
    }
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
    this.feedbackPolicy?.close();
    await this.previews?.close();
    await this.githubPreview?.close();
    this.closed = true;
    clearInterval(this.sweep);
    await Promise.all(
      [...this.transports].map((transport) => transport.close()),
    );
  }
}
