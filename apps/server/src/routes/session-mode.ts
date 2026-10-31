import { createSessionRuntimeProtocol } from "../services/session-runtime-protocol.js";
import { projectCodexChatValue, projectAuxiliaryChatEnvelope } from "@agent-orchestrator/shared";
import { registerSessionItemDetail } from "./session-item-detail.js";
import { registerSessionFollowupRoutes } from "./session-followups.js";
import { registerSessionSubagentRoutes } from "./session-subagents.js";
import { registerSessionProjectsRoutes } from "./session-projects.js";
import { registerWorkspaceFileRoutes } from "./workspace-files.js";
import { registerSessionTabsRoutes } from "./session-tabs.js";
import { registerSessionSavedPatchRoutes } from "./session-saved-patch.js";
import { registerSessionGitHunkRoutes } from "./session-git-hunks.js";
import { registerSessionGitReviewRoutes } from "./session-git-review.js";
import { registerSessionGuardianDenialRoutes } from "./session-codex-guardian.js";
import { registerCodexHostRoutes } from "./session-codex-host.js";
import { registerCodexCloudRoutes } from "./session-codex-cloud.js";
import { registerSessionGroupsRoutes } from "./session-groups.js";
import { registerSessionManagementRoutes } from "./session-management.js";
import { registerSessionLifecycleRoutes } from "./session-lifecycle.js";
import { registerSessionClientControlRoutes } from "./session-client-control.js";
import { createCodexHostOwnerResolver } from "../services/codex-host-owner.js";
import { projectCodexPriorConversation } from "../services/codex-cloud-history.js";
import { AuxiliaryHistoryError, auxiliaryRecentProvider, auxiliaryRecentRequest, readAuxiliaryRecentResponse } from "../services/auxiliary-history-projection.js";
import { SessionAuxiliaryHistory, auxiliaryLocalTarget } from "../services/session-auxiliary-history.js";
import { CodexHostCompanionCredential, prepareCodexHostCompanion } from "../services/codex-host-companion.js";
import type { VsCodeWebManager } from "../services/vscode-web-manager.js";
import { saveSessionAttachment } from "../services/session-attachments.js";
import { SessionCodexFeishuReplyService } from "../services/session-codex-feishu-reply-service.js";
import type { FeishuReplyBindingStore } from "../services/feishu-reply-binding-store.js";
import { SessionCodexFeishuNotifier } from "../services/session-codex-feishu-notifier.js";
import { createSessionCodexCompletionCheck } from "../services/session-codex-completion-check.js";
import { registerSessionCodexActivityRoutes, readSessionCodexActivity } from "./session-codex-activity.js";
import type { FeishuCompletionSenderLike } from "../services/agent-completion-feishu-notifier.js";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket from "ws";

interface SessionModeRouteOptions {
  loadAuxiliaryHistory?: () => Promise<typeof import("@agent-orchestrator/session-runtime/auxiliary-history")>;
  loadDetailChannel?: () => Promise<{
    registerLocalItemDetailChannel: (app: FastifyInstance, dataDir: string) => void;
    registerLocalChatHistoryChannel?: (app: FastifyInstance, dataDir: string, fallback: (request: FastifyRequest, reply: FastifyReply) => unknown, readCurrentTurn?: (threadId: string, signal: AbortSignal) => Promise<Awaited<ReturnType<typeof readSessionCodexActivity>>["turn"]>) => void;
  }>;
  origin?: string;
  attachmentRoot?: string;
  fetch?: typeof globalThis.fetch;
  projects?: () => string[];
  ensureRuntime?: () => Promise<string | undefined>;
  vsCodeWebManager?: VsCodeWebManager;
  completionNotifications?: {
    settings: { get(): { configured: boolean; enabled: boolean } };
    sender: FeishuCompletionSenderLike;
    bindings?: Pick<FeishuReplyBindingStore, "record">;
  };
}

function validateOrigin(origin: string): URL {
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Session runtime origin must be a plain HTTP loopback origin",
    );
  }
  return url;
}

const CHAT_PROJECTION_VIEW = "chat";
const MAX_CHAT_SSE_FRAME_BYTES = 16 * 1024 * 1024;
const CHAT_PROJECTION_ERROR_EVENT = "session-projection-error";
const chatHistoryPaths = new Set([
  "/api/codex/thread/read",
  "/api/codex/thread/turns/list",
  "/api/codex/thread/items/list",
  "/api/codex/thread/metadata",
]);

const sessionWritePaths = new Set([
  "/api/codex/turn/start", "/api/codex/turn/steer", "/api/codex/turn/interrupt",
  "/api/codex/thread/resume", "/api/codex/thread/fork", "/api/codex/thread/archive",
  "/api/codex/thread/goal/set", "/api/codex/thread/goal/clear", "/api/codex/thread/goal/clear-completed",
  "/api/codex/thread/settings/update", "/api/codex/thread/queue/add", "/api/codex/thread/queue/start",
  "/api/codex/thread/queue/update", "/api/codex/thread/queue/delete", "/api/codex/thread/queue/reorder",
  "/api/codex/thread/rollback", "/api/codex/thread/delete", "/api/codex/thread/compact/start",
  "/api/codex/mcp/app/call",
  "/api/codex/realtime/start", "/api/codex/realtime/stop",
  "/api/codex/realtime/append-text",
  "/api/codex/review/start",
]);

function splitSessionSuffix(origin: string, suffix: string) {
  const url = new URL(suffix, origin);
  const chatProjection = url.searchParams.get("view") === CHAT_PROJECTION_VIEW;
  if (chatProjection) url.searchParams.delete("view");
  const upstreamSuffix = `${url.pathname}${url.search}`;
  return { chatProjection, upstreamSuffix };
}

function projectChatEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as Record<string, unknown>;
  if (envelope.event !== "codex:notification") return projectAuxiliaryChatEnvelope(value);
  const payload = projectCodexChatValue(envelope.payload);
  return payload === envelope.payload ? value : { ...envelope, payload };
}

function projectionErrorFrame(reason: string): string {
  return `event: ${CHAT_PROJECTION_ERROR_EVENT}\ndata: ${JSON.stringify({ error: reason })}\n\n`;
}

function projectSseFrame(frame: string): string {
  if (Buffer.byteLength(frame) > MAX_CHAT_SSE_FRAME_BYTES)
    return projectionErrorFrame(
      "Session event frame exceeds chat projection limit",
    );
  const data: string[] = [];
  const passthrough: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    } else if (line) {
      passthrough.push(line);
    }
  }
  if (!data.length) return `${frame}\n\n`;
  try {
    const projected = projectChatEnvelope(JSON.parse(data.join("\n")));
    return `${passthrough.length ? `${passthrough.join("\n")}\n` : ""}data: ${JSON.stringify(projected)}\n\n`;
  } catch {
    return Buffer.byteLength(frame) > 64 * 1024
      ? projectionErrorFrame("Invalid oversized session event frame")
      : `${frame}\n\n`;
  }
}

function findSseBoundary(buffer: string): { index: number; length: number } {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0) return { index: crlf, length: crlf < 0 ? 0 : 4 };
  if (crlf < 0 || lf < crlf) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

async function* projectChatSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Buffer> {
  const upstream = Readable.fromWeb(
    body as Parameters<typeof Readable.fromWeb>[0],
  );
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of upstream) {
      buffer += decoder.decode(chunk as Buffer, { stream: true });
      let boundary = findSseBoundary(buffer);
      while (boundary.index >= 0) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const projected = projectSseFrame(frame);
        yield Buffer.from(projected);
        if (projected.startsWith(`event: ${CHAT_PROJECTION_ERROR_EVENT}\n`))
          return;
        boundary = findSseBoundary(buffer);
      }
      if (Buffer.byteLength(buffer) > MAX_CHAT_SSE_FRAME_BYTES) {
        yield Buffer.from(
          projectionErrorFrame(
            "Session event frame exceeds chat projection limit",
          ),
        );
        return;
      }
    }
    buffer += decoder.decode();
    let boundary = findSseBoundary(buffer);
    while (boundary.index >= 0) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const projected = projectSseFrame(frame);
      yield Buffer.from(projected);
      if (projected.startsWith(`event: ${CHAT_PROJECTION_ERROR_EVENT}\n`))
        return;
      boundary = findSseBoundary(buffer);
    }
    if (buffer) yield Buffer.from(projectSseFrame(buffer));
  } finally {
    upstream.destroy();
  }
}

export function registerSessionModeRoutes(
  app: FastifyInstance,
  options: SessionModeRouteOptions = {},
): SessionCodexFeishuReplyService {
  registerSessionGitHunkRoutes(app);
  registerSessionGitReviewRoutes(app);
  registerSessionGuardianDenialRoutes(app, {
    file: options.attachmentRoot ? resolve(options.attachmentRoot, "..", "codex-guardian-denials.json") : undefined,
  });
  registerSessionTabsRoutes(app, {
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "followed-sessions.json")
      : undefined,
  });
  registerSessionGroupsRoutes(app, {
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "session-groups.json")
      : undefined,
  });
  const sharedProjects = registerSessionProjectsRoutes(app, {
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "projects.json")
      : undefined,
    legacyFile: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", ".codexia", "settings.json")
      : undefined,
  });
  let origin = options.origin ? validateOrigin(options.origin).origin : null;
  const fetchUpstream = options.fetch ?? globalThis.fetch;
  const auxiliaryHistory = options.attachmentRoot ? new SessionAuxiliaryHistory({ attachmentRoot: options.attachmentRoot, origin: () => origin, loadLibrary: options.loadAuxiliaryHistory }) : null;
  registerSessionCodexActivityRoutes(app, { origin: () => origin, fetch: fetchUpstream });
  if (options.attachmentRoot && process.env.SESSION_MODE_ENABLED !== "0") {
    app.register(async (detailScope) => {
      let channel;
      try {
        channel = await (options.loadDetailChannel?.() ?? import("@agent-orchestrator/session-runtime/item-detail"));
      } catch (error) {
        // A custom/disabled runtime may not have prepared the default TS library.
        // Keep the gateway and existing service available; never replace an Agent.
        if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
        registerSessionItemDetail(detailScope, () => origin, fetchUpstream);
        return;
      }
      channel.registerLocalItemDetailChannel(detailScope, resolve(options.attachmentRoot!, "..", ".codexia"));
      channel.registerLocalChatHistoryChannel?.(detailScope, resolve(options.attachmentRoot!, "..", ".codexia"), async (request, reply) => {
        if (!origin) return reply.code(503).send({ error: "会话服务尚未启动" });
        const body = request.body as Record<string, unknown> | undefined;
        if (new URL(request.raw.url!, "http://localhost").searchParams.get("view") === "chat" && body?.itemsView === "notLoaded") {
          if (typeof body.threadId !== "string" || body.limit !== 1 || body.cursor != null ||
              (body.sortDirection !== undefined && body.sortDirection !== "desc") ||
              Object.keys(body).some(key => !["threadId", "limit", "cursor", "sortDirection", "itemsView"].includes(key)))
            return reply.code(400).send({ error: "CHAT_HISTORY_INVALID_REQUEST" });
          try {
            const activity = await readSessionCodexActivity(origin, fetchUpstream, body.threadId);
            return reply.header("cache-control", "no-store").send({ data: activity.turn ? [activity.turn] : [], nextCursor: null });
          } catch {
            return reply.code(503).send({ error: "会话执行状态暂不可用" });
          }
        }
        // Only the explicit chat projection uses the independent bounded reader.
        // Full/raw consumers retain the existing runtime protocol and response.
        const suffix = request.raw.url!.slice("/api/session".length);
        const controller = new AbortController();
        const abort = () => { if (!reply.raw.writableFinished) controller.abort(); };
        request.raw.once("aborted", abort);
        reply.raw.once("close", abort);
        try {
          const response = await fetchUpstream(`${origin}${suffix}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(request.body ?? {}), redirect: "manual",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
          });
          reply.code(response.status).header("x-content-type-options", "nosniff");
          for (const key of ["content-type", "cache-control"]) {
            const value = response.headers.get(key);
            if (value) reply.header(key, value);
          }
          if (!response.body) {
            request.raw.off("aborted", abort); reply.raw.off("close", abort);
            return reply.send();
          }
          const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
          body.once("close", () => { request.raw.off("aborted", abort); reply.raw.off("close", abort); });
          return reply.send(body);
        } catch {
          request.raw.off("aborted", abort); reply.raw.off("close", abort);
          return reply.code(503).send({ error: "会话服务连接失败，请重试连接。" });
        }
      }, async (threadId, signal) => {
        if (!origin) throw new Error("会话服务尚未连接");
        return (await readSessionCodexActivity(origin, fetchUpstream, threadId, signal)).turn;
      });
    });
  } else {
    registerSessionItemDetail(app, () => origin, fetchUpstream);
  }
  if (options.attachmentRoot) {
    const dataHome = resolve(options.attachmentRoot, "..");
    const owners = createCodexHostOwnerResolver({
      origin: () => origin,
      fetch: fetchUpstream,
      projects: async () => [...(options.projects?.() ?? []), ...(await sharedProjects.getProjects())],
    });
    const credential = new CodexHostCompanionCredential(dataHome);
    let credentialReady: Promise<void> | undefined;
    app.addHook("onListen", async () => {
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("编辑器宿主网关尚未绑定 HTTP 端口");
      credentialReady = credential.write(`http://127.0.0.1:${address.port}`);
      await credentialReady;
    });
    options.vsCodeWebManager?.setCodexHostPreparation(async (paths) => {
      if (!credentialReady) throw new Error("编辑器宿主网关尚未监听，请稍后重新连接");
      await credentialReady;
      await prepareCodexHostCompanion({
        ...paths,
        packageRoot: resolve(import.meta.dirname, "../../../../packages/codex-host-bridge"),
        credentialFile: credential.file,
      });
    });
    registerCodexHostRoutes(app, { credential, resolveOwner: owners.resolve });
    registerCodexCloudRoutes(app, {
      dataHome,
      resolveOwner: owners.resolve,
      priorConversation: async (request) => projectCodexPriorConversation(await owners.readThread(request.owner.threadId!)),
    });
  }
  registerSessionSavedPatchRoutes(app, {
    origin: () => origin,
    fetch: fetchUpstream,
    file: options.attachmentRoot ? resolve(options.attachmentRoot, "..", "codex-saved-patches.json") : undefined,
  });
  const completionNotifier = options.completionNotifications
    ? new SessionCodexFeishuNotifier({
        ...options.completionNotifications,
        beforeSend: createSessionCodexCompletionCheck({
          origin: () => origin,
          fetch: fetchUpstream,
          queue: (threadId) => followups.inspect(threadId),
        }),
        deliveryRecorder: options.completionNotifications.bindings
          ? {
              record: (event, delivery) =>
                options.completionNotifications!.bindings!.record({
                  sessionId: event.sessionId,
                  sessionModeThreadId: event.sessionModeThreadId,
                  sessionModeScope: event.sessionModeScope,
                  sessionModeNamespace: event.sessionModeNamespace,
                  completionId: event.completionId ?? event.completedAt,
                  messages: delivery.messages,
                }),
            }
          : undefined,
        file: options.attachmentRoot
          ? resolve(
              options.attachmentRoot,
              "..",
              "codex-completion-notifications.json",
            )
          : undefined,
        readThread: async (threadId, turnId) => {
          if (!origin) throw new Error("会话服务尚未连接");
          const before = await nativeContext();
          const request = async (path: string, body: unknown) => {
            const response = await fetchUpstream(
              `${origin}/api/codex/thread/${path}`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(15000),
              },
            );
            if (!response.ok) throw new Error("无法读取任务完成记录");
            return response.json() as Promise<any>;
          };
          const metadata = await request("metadata", { threadId });
          const thread = metadata.thread;
          if (!thread || thread.id !== threadId)
            throw new Error("任务会话身份不匹配");
          if (thread.parentThreadId || thread.source?.subAgent) return metadata;
          let cursor: string | null = null;
          const seen = new Set<string>();
          do {
            const page = await request("turns/list", {
              threadId,
              cursor,
              limit: 20,
              sortDirection: "desc",
              itemsView: "full",
            });
            if (!Array.isArray(page.data)) throw new Error("任务历史格式无效");
            const turn = page.data.find((turn: any) => turn.id === turnId);
            if (turn) {
              const after = await nativeContext();
              if (before.scope !== after.scope || before.namespace !== after.namespace) throw new Error("读取完成记录期间账号或运行范围已变化");
              return { thread: { ...thread, turns: [turn] }, sessionModeContext: before };
            }
            cursor = page.nextCursor ?? null;
            if (cursor !== null) {
              if (typeof cursor !== "string" || seen.has(cursor))
                throw new Error("任务历史游标无效");
              seen.add(cursor);
            }
          } while (cursor !== null);
          throw new Error("任务完成记录暂未写入");
        },
        logError: (error) =>
          app.log.warn(
            { err: error },
            "Session Feishu notification unavailable",
          ),
      })
    : undefined;
  let lifecycle: ReturnType<typeof registerSessionLifecycleRoutes> | undefined;
  const protocol = createSessionRuntimeProtocol(() => nativeRequest("/health"));
  const followups = registerSessionFollowupRoutes(app, {
    protocol,
    origin: () => origin,
    fetch: fetchUpstream,
    file: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "codex-followups.json")
      : undefined,
    autoStart: Boolean(options.attachmentRoot),
    completionNotifier,
    withWrite: (threadId, work) => lifecycle ? lifecycle.write(threadId, work) : work(),
  });
  const nativeRequest = async (path: string, params?: Record<string, unknown>) => {
    if (!origin) throw Object.assign(new Error("会话服务尚未连接"), { statusCode: 503 });
    const response = await fetchUpstream(`${origin}${path}`, {
      method: params ? "POST" : "GET", headers: params ? { "content-type": "application/json" } : undefined,
      ...(params ? { body: JSON.stringify(params) } : {}), signal: AbortSignal.timeout(15_000), redirect: "manual",
    });
    const value = await response.json() as Record<string, any>;
    if (!response.ok) throw Object.assign(new Error(typeof value.error === "string" ? value.error : "原生会话状态暂不可用"), { statusCode: response.status });
    return value;
  };
  const nativeContext = async () => {
    const value = await nativeRequest("/api/internal/codex/operation-context");
    if (typeof value.scope !== "string" || typeof value.namespace !== "string" || !value.scope || !value.namespace)
      throw Object.assign(new Error("当前运行服务无法核实账号与运行范围"), { statusCode: 503 });
    return { scope: value.scope, namespace: value.namespace,
      ...(typeof value.daemonIdentity === "string" && /^[a-f0-9]{64}$/.test(value.daemonIdentity) ? { daemonIdentity: value.daemonIdentity } : {}),
    };
  };
  lifecycle = registerSessionLifecycleRoutes(app, {
    file: options.attachmentRoot ? resolve(options.attachmentRoot, "..", "session-lifecycle.json") : undefined,
    origin: () => origin, fetch: fetchUpstream,
    context: async () => {
      const selected = await protocol.read();
      if (selected.backend === "legacy-stdio") return selected;
      const context = await nativeContext(); return { scopeToken: context.scope, namespace: context.namespace, ...(context.daemonIdentity ? { daemonIdentity: context.daemonIdentity } : {}) };
    },
    followups,
  });
  const management = registerSessionManagementRoutes(app, {
    file: options.attachmentRoot ? resolve(options.attachmentRoot, "..", "session-management.json") : undefined,
    accountScope: async () => { try { return (await nativeContext()).namespace; } catch { return null; } },
    verifyTarget: async target => {
      if (target.kind !== "codex") return;
      const before = await nativeContext();
      const metadata = await nativeRequest("/api/codex/thread/metadata", { threadId: target.id });
      const after = await nativeContext();
      if (metadata.thread?.id !== target.id || before.scope !== after.scope)
        throw Object.assign(new Error("会话归属已变化，请查看最新状态后重试"), { statusCode: 409 });
    },
    nativeRead: async (target, expectedRevision, operation, scope) => {
      if (!scope) throw Object.assign(new Error("缺少实际阅读时的运行范围，请重新查看回复"), { statusCode: 409 });
      await nativeRequest("/api/internal/codex/guarded-read-state", { expectedScope: scope, threadId: target.id, expectedRevision, operation });
    },
  });
  registerSessionClientControlRoutes(app, { origin: () => origin, fetch: fetchUpstream, management, write: (threadId, work) => lifecycle!.write(threadId, work) });
  const replyService = new SessionCodexFeishuReplyService({
    attachmentRoot: options.attachmentRoot,
    context: nativeContext,
    submit: async (input) => {
      const context = await nativeContext();
      if (!input.expectedScope || input.expectedScope !== context.scope) throw new Error("原卡片的账号或运行范围已变化，消息尚未提交");
      const result = await followups.enqueue(input);
      const message = result.items.find(row => row.id === input.id || row.nativeClientUserMessageId === input.id);
      if (!message || !["queued", "sending", "sent"].includes(message.status)) throw new Error(message?.error ?? "原会话送达结果待核对，不会重复发送");
      return result;
    },
    readThread: async (threadId) => {
      if (!origin) throw new Error("会话服务尚未连接");
      const response = await fetchUpstream(
        `${origin}/api/codex/thread/metadata`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error("无法读取原会话");
      return response.json();
    },
  });
  registerSessionSubagentRoutes(app, {
    origin: () => origin,
    fetch: fetchUpstream,
    stop: (id, turn) => followups.stop(id, turn),
  });
  registerWorkspaceFileRoutes(app, {
    trashHome: options.attachmentRoot
      ? resolve(options.attachmentRoot, "..", "file-trash")
      : undefined,
    roots: async () => {
      let projects: string[] = [...(options.projects?.() ?? [])];
      if (options.attachmentRoot) {
        return [...projects, ...(await sharedProjects.getProjects())];
      }
      if (origin) {
        try {
          const response = await fetchUpstream(`${origin}/api/settings`, {
            signal: AbortSignal.timeout(2000),
          });
          if (response.ok) {
            const settings = (await response.json()) as {
              workspace?: { projects?: unknown[] };
            };
            projects = [
              ...projects,
              ...(settings.workspace?.projects ?? []).filter(
                (p): p is string =>
                  typeof p === "string" &&
                  p.startsWith("/") &&
                  !/[\\\x00-\x1f]/.test(p),
              ),
            ];
          }
        } catch {
          /* Registered terminal projects remain accessible during outages. */
        }
      }
      return projects;
    },
  });
  app.get("/api/workbench/projects", async () => {
    let sessionProjects: unknown[] = [];
    if (options.attachmentRoot)
      sessionProjects = await sharedProjects.getProjects();
    else if (origin) {
      try {
        const response = await fetchUpstream(`${origin}/api/settings`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) {
          const settings = (await response.json()) as {
            workspace?: { projects?: unknown[] };
          };
          sessionProjects = settings.workspace?.projects ?? [];
        }
      } catch {
        /* Terminal project access remains available during outages. */
      }
    }
    return {
      projects: [
        ...new Set(
          [...(options.projects?.() ?? []), ...sessionProjects].filter(
            (value): value is string =>
              typeof value === "string" &&
              value.startsWith("/") &&
              !/[\x00-\x1f]/.test(value),
          ),
        ),
      ],
    };
  });
  app.post<{ Body: { name: string; data: string } }>(
    "/api/session/files/upload",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      if (!options.attachmentRoot)
        return reply.code(503).send({ error: "会话附件存储不可用" });
      try {
        return {
          path: await saveSessionAttachment(
            resolve(options.attachmentRoot),
            request.body,
          ),
        };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Invalid attachment",
        });
      }
    },
  );
  app.route({
    method: ["GET", "POST"],
    url: "/api/session/*",
    bodyLimit: 16 * 1024 * 1024,
    async handler(request, reply) {
      if (
        request.raw.url?.split("?")[0] === "/api/session/health" &&
        options.ensureRuntime
      ) {
        try {
          const ready = await options.ensureRuntime();
          origin = ready ? validateOrigin(ready).origin : null;
        } catch {
          return reply
            .code(503)
            .send({ error: "会话运行服务暂时不可用，请稍后重试" });
        }
      }
      if (!origin)
        return reply.code(503).send({
          error: "会话服务尚未启动，请检查 session:build 和服务日志。",
        });
      const suffix = request.raw.url!.slice("/api/session".length);
      const pathname = suffix.split("?")[0];
      if (
        !pathname.startsWith("/") ||
        /[\\\x00-\x1f]/.test(pathname) ||
        /(?:^|\/)\.\.(?:\/|$)|%2e|%2f/i.test(pathname)
      ) {
        return reply.code(400).send({ error: "Invalid session API path" });
      }
      if (decodeURIComponent(pathname).startsWith("/api/internal/"))
        return reply.code(403).send({ error: "Internal session API" });
      const { chatProjection, upstreamSuffix } = splitSessionSuffix(
        origin,
        suffix,
      );
      const recentProvider = auxiliaryRecentProvider(request.method, suffix);
      const localHistoryTarget = auxiliaryHistory ? auxiliaryLocalTarget(request.method, suffix) : null;
      const controller = new AbortController();
      // ACP prompts and local inference can legitimately run for several minutes.
      const longRunning = [
        "/api/acp/prompt",
        "/api/acp/install-agent",
        "/api/dictation/transcribe",
      ].includes(pathname);
      const timeout = longRunning
        ? undefined
        : setTimeout(() => controller.abort(), 120_000);
      const abort = () => controller.abort();
      request.raw.on("aborted", abort);
      const pendingGoalMutation = request.method === "POST" && [
        "/api/codex/thread/goal/set",
        "/api/codex/thread/goal/clear",
        "/api/codex/thread/goal/clear-completed",
      ].includes(pathname);
      const goalReplyClosed = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      // Goal preflight may still be waiting before upstream response headers.
      // Browser cancellation must reach that wait before it can write to native.
      if (pendingGoalMutation) reply.raw.once("close", goalReplyClosed);
      // Bounded recent reads wait for validation before sending any response.
      // A completed POST can therefore be abandoned before upstream headers.
      if (recentProvider || localHistoryTarget) reply.raw.once("close", goalReplyClosed);
      try {
        let forwardedBody = request.body;
        if (request.method === "POST" && ["/api/codex/thread/start", "/api/codex/start-thread"].includes(pathname)) {
          const selected = await protocol.read();
          if (selected.backend === "legacy-stdio") {
            const body = request.body as Record<string, unknown>;
            if (!body || body.expectedScope !== selected.scopeToken) throw Object.assign(new Error("运行实例已变化，消息尚未发送"), { statusCode: 409 });
            const { expectedScope: _scope, ...nativeBody } = body;
            forwardedBody = nativeBody;
          }
        }
        const recentRequest = recentProvider ? auxiliaryRecentRequest(recentProvider, suffix, request.body) : null;
        const forward = () => fetchUpstream(`${origin}${upstreamSuffix}`, {
          method: request.method,
          headers:
            request.method === "POST"
              ? { "content-type": "application/json" }
              : undefined,
          body:
            request.method === "POST"
              ? JSON.stringify(forwardedBody ?? {})
              : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
        const writeThread = lifecycle && request.method === "POST" && sessionWritePaths.has(pathname) && typeof (request.body as any)?.threadId === "string"
          ? (request.body as { threadId: string }).threadId : undefined;
        const response = localHistoryTarget ? await auxiliaryHistory!.response(localHistoryTarget, suffix, request.body, controller.signal)
          : writeThread ? await lifecycle!.write(writeThread, forward) : await forward();
        if (recentRequest) {
          const value = await readAuxiliaryRecentResponse(response, recentRequest, controller.signal);
          clearTimeout(timeout);
          return reply.code(response.status).headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" }).send(value);
        }
        clearTimeout(timeout);
        reply.code(response.status);
        for (const name of [
          "content-type",
          "content-disposition",
          "cache-control",
          "etag",
          "x-content-type-options",
          "x-history-image-width",
          "x-history-image-height",
          "x-history-image-revision",
        ]) {
          const value = response.headers.get(name);
          if (value) reply.header(name, value);
        }
        reply.header("x-content-type-options", "nosniff");
        if (
          response.ok &&
          request.method === "POST" &&
          [
            "/api/codex/thread/start",
            "/api/codex/start-thread",
            "/api/codex/thread/resume",
            "/api/codex/thread/fork",
          ].includes(pathname)
        ) {
          const result = (await response.json()) as {
            thread?: { id?: string };
          };
          // Empty native threads are not listed in the state DB until their first turn.
          if (result.thread?.id)
            await followups.observe({
              method: "thread/started",
              params: { thread: result.thread },
            });
          return reply.send(result);
        }
        if (
          response.ok &&
          chatProjection &&
          request.method === "POST" &&
          chatHistoryPaths.has(pathname)
        ) {
          return reply.send(projectCodexChatValue(await response.json()));
        }
        if (!response.body) return reply.send();
        const stream =
          chatProjection &&
          request.method === "GET" &&
          pathname === "/api/events" &&
          response.headers.get("content-type")?.includes("text/event-stream")
            ? Readable.from(projectChatSseStream(response.body))
            : Readable.fromWeb(
                response.body as Parameters<typeof Readable.fromWeb>[0],
              );
        reply.raw.once("close", () => {
          if (!reply.raw.writableFinished) controller.abort();
        });
        return reply.send(stream);
      } catch (error) {
        if (error instanceof AuxiliaryHistoryError) {
          controller.abort();
          return reply.code(error.statusCode).headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" }).send({ error: error.message, code: error.code });
        }
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode && statusCode >= 400 && statusCode < 500)
          return reply.code(statusCode).send({ error: error instanceof Error ? error.message : "当前会话操作暂不可用", code: "SESSION_LIFECYCLE_BLOCKED", deliveryStage: "not-admitted" });
        request.log.warn(
          {
            error: error instanceof Error ? error.message : "upstream failure",
          },
          "session gateway unavailable",
        );
        return reply
          .code(503)
          .send({ error: "会话服务连接失败，请重试连接。" });
      } finally {
        clearTimeout(timeout);
        request.raw.off("aborted", abort);
        if (pendingGoalMutation || recentProvider || localHistoryTarget) reply.raw.off("close", goalReplyClosed);
      }
    },
  });
  // WebSocket routes require @fastify/websocket to be registered by the host.
  if (app.hasDecorator("websocketServer")) {
    app.get("/ws/session", { websocket: true }, (client, request) => {
      if (!origin) {
        client.close(1013, "Session service unavailable");
        return;
      }
      const upstream = new WebSocket(
        `${origin.replace(/^http/, "ws")}/ws${new URL(request.raw.url!, "http://gateway").search}`,
      );
      const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
      const close = () => {
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else upstream.close();
      };
      client.on("message", (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN)
          upstream.send(data, { binary });
        else if (pending.length < 32) pending.push({ data, binary });
        else client.close(1009, "Too many pending frames");
      });
      upstream.on("open", () => {
        for (const frame of pending.splice(0))
          upstream.send(frame.data, { binary: frame.binary });
      });
      upstream.on("message", (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      upstream.on("close", () => client.close());
      upstream.on("error", () =>
        client.close(1013, "Session service unavailable"),
      );
      client.on("close", close);
      client.on("error", close);
    });
  }
  return replyService;
}
