import type { SessionRuntimeProtocol } from "../services/session-runtime-protocol.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type {
  FollowupAction,
  FollowupSubmit,
} from "@agent-orchestrator/shared";
import { validNativeInputMention } from "@agent-orchestrator/shared";
import { composeContextText } from "@agent-orchestrator/shared";
import {
  CodexFollowups,
  FollowupRejected,
  type FollowupRuntime,
} from "../services/codex-followups.js";
import { NativeCodexFollowups } from "../services/native-codex-followups.js";
import type { SessionCodexFeishuNotifier } from "../services/session-codex-feishu-notifier.js";

class QueueOwnedElsewhere extends Error {
  readonly statusCode = 409;
  readonly code = "FOLLOWUP_QUEUE_OWNED_ELSEWHERE";
  constructor() { super("消息队列已由另一服务管理；本次消息未入队，草稿已保留"); }
}
function followupErrorHandler(error: Error, _request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof QueueOwnedElsewhere)
    return reply.code(409).send({ error: error.message, code: error.code, deliveryStage: "not-admitted" });
  if (error instanceof FollowupRejected)
    return reply.code(409).send({ error: error.message, code: "FOLLOWUP_REJECTED" });
  return reply.send(error);
}

function invalid(message = "无效的消息队列请求"): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalid();
  return v as Record<string, any>;
};
const keys = (v: Record<string, unknown>, names: string[]) => {
  if (Object.keys(v).some((k) => !names.includes(k))) invalid();
};
const id = (v: unknown): string => {
  if (
    typeof v !== "string" ||
    !/^[-a-zA-Z0-9_:]{1,160}$/.test(v) ||
    ["__proto__", "constructor", "prototype"].includes(v)
  )
    invalid();
  return v;
};
const message = (v: unknown): string => {
  if (typeof v !== "string" || v.length > 200_000 || v.includes("\0"))
    invalid();
  return v;
};
function submit(value: unknown): FollowupSubmit {
  const v = object(value);
  keys(v, [
    "id",
    "threadId",
    "text",
    "images",
    "contexts",
    "mentions",
    "parameters",
    "mode",
    "expectedTurnId",
    "recoverAfterError",
    "expectedScope",
  ]);
  id(v.id);
  id(v.threadId);
  if (v.expectedScope !== undefined && (typeof v.expectedScope !== "string" || v.expectedScope.length < 1 || v.expectedScope.length > 512)) invalid();
  message(v.text);
  if (!["queue", "steer", "replace"].includes(v.mode)) invalid();
  if (v.expectedTurnId !== undefined) id(v.expectedTurnId);
  if (
    v.recoverAfterError !== undefined &&
    typeof v.recoverAfterError !== "boolean"
  )
    invalid();
  if (
    !Array.isArray(v.images) ||
    v.images.length > 8 ||
    v.images.some(
      (p: unknown) =>
        typeof p !== "string" ||
        !p.startsWith("/") ||
        p.length > 4096 ||
        /[\x00-\x1f]/.test(p),
    )
  )
    invalid();
  if (
    v.mentions !== undefined &&
    (!Array.isArray(v.mentions) ||
      v.mentions.length > 32 ||
      v.mentions.some((m: unknown) => !validNativeInputMention(m)))
  )
    invalid("无效的原生引用");
  if (v.contexts !== undefined) {
    if (!Array.isArray(v.contexts) || v.contexts.length > 32) invalid();
    const seen = new Set<string>();
    for (const entry of v.contexts) {
      const c = object(entry);
      keys(c, [
        "id",
        "kind",
        "name",
        "text",
        "path",
        "range",
        "sourceThreadId",
        "sourceItemId",
      ]);
      id(c.id);
      if (seen.has(c.id)) invalid();
      seen.add(c.id);
      if (!["file", "paste", "quote"].includes(c.kind)) invalid();
      if (
        typeof c.name !== "string" ||
        c.name.length > 512 ||
        /[\x00-\x1f]/.test(c.name)
      )
        invalid();
      message(c.text);
      if (
        c.path !== undefined &&
        (typeof c.path !== "string" ||
          !c.path.startsWith("/") ||
          c.path.length > 4096 ||
          /[\x00-\x1f]/.test(c.path))
      )
        invalid();
      for (const field of ["sourceThreadId", "sourceItemId"])
        if (c[field] !== undefined) id(c[field]);
      if (c.range !== undefined) {
        const range = object(c.range);
        keys(range, ["start", "end"]);
        if (
          !Number.isSafeInteger(range.start) ||
          !Number.isSafeInteger(range.end) ||
          range.start < 1 ||
          range.end < range.start
        )
          invalid();
      }
    }
    message(composeContextText(v.text, v.contexts));
  }
  if (!v.text.trim() && !v.images.length && !v.contexts?.length)
    invalid("消息不能为空");
  const p = object(v.parameters);
  keys(p, [
    "cwd",
    "model",
    "effort",
    "serviceTier",
    "approvalPolicy",
    "approvalsReviewer",
    "sandboxPolicy",
    "collaborationMode",
    "personality",
    "permissions",
  ]);
  if (JSON.stringify(p).length > 32000) invalid();
  if (p.permissions != null && (typeof p.permissions !== "string" || !p.permissions.trim() || p.permissions.length > 4096 || /[\x00-\x1f]/.test(p.permissions))) invalid();
  if (p.permissions != null && p.sandboxPolicy != null) invalid("命名权限配置不能与沙箱策略同时提交");
  for (const name of ["cwd", "model", "effort"])
    if (
      p[name] != null &&
      (typeof p[name] !== "string" ||
        p[name].length > 4096 ||
        /[\x00-\x1f]/.test(p[name]))
    )
      invalid();
  // Cached clients can submit the empty directory placeholder from thread restore.
  // Null inherits the native thread directory rather than changing its project.
  if (typeof p.cwd === "string" && !p.cwd.trim()) p.cwd = null;
  if (p.cwd != null && !p.cwd.startsWith("/"))
    invalid("消息工作目录必须是绝对路径");
  if (
    p.personality != null &&
    !["friendly", "pragmatic", "none"].includes(p.personality)
  )
    invalid();
  if (
    p.serviceTier != null &&
    (typeof p.serviceTier !== "string" ||
      !p.serviceTier.trim() ||
      p.serviceTier.length > 256 ||
      /[\x00-\x1f]/.test(p.serviceTier))
  )
    invalid();
  if (
    p.approvalsReviewer != null &&
    !["user", "auto_review", "guardian_subagent"].includes(p.approvalsReviewer)
  )
    invalid();
  if (p.approvalPolicy != null) {
    if (typeof p.approvalPolicy === "string") {
      if (
        !["untrusted", "on-failure", "on-request", "never"].includes(
          p.approvalPolicy,
        )
      )
        invalid();
    } else {
      const policy = object(p.approvalPolicy);
      keys(policy, ["granular"]);
      const granular = object(policy.granular);
      const fields = [
        "sandbox_approval",
        "rules",
        "skill_approval",
        "request_permissions",
        "mcp_elicitations",
      ];
      keys(granular, fields);
      if (fields.some((name) => typeof granular[name] !== "boolean")) invalid();
    }
  }
  if (p.sandboxPolicy != null) {
    const s = object(p.sandboxPolicy);
    keys(s, [
      "type",
      "networkAccess",
      "writableRoots",
      "excludeTmpdirEnvVar",
      "excludeSlashTmp",
    ]);
    if (
      ![
        "readOnly",
        "workspaceWrite",
        "dangerFullAccess",
        "externalSandbox",
      ].includes(s.type)
    )
      invalid();
    if (s.type === "externalSandbox") {
      if (
        s.networkAccess != null &&
        !["restricted", "enabled"].includes(s.networkAccess)
      )
        invalid();
    } else if (s.networkAccess != null && typeof s.networkAccess !== "boolean")
      invalid();
    for (const k of ["excludeTmpdirEnvVar", "excludeSlashTmp"])
      if (s[k] != null && typeof s[k] !== "boolean") invalid();
    if (
      s.writableRoots != null &&
      (!Array.isArray(s.writableRoots) ||
        s.writableRoots.some(
          (x: unknown) =>
            typeof x !== "string" ||
            !x.startsWith("/") ||
            /[\x00-\x1f]/.test(x),
        ))
    )
      invalid();
  }
  if (p.collaborationMode != null) {
    const c = object(p.collaborationMode);
    keys(c, ["mode", "settings"]);
    if (!["default", "plan"].includes(c.mode)) invalid();
    const s = object(c.settings);
    keys(s, ["model", "reasoning_effort", "developer_instructions"]);
    if (
      typeof s.model !== "string" ||
      s.model.length > 512 ||
      s.developer_instructions != null ||
      (s.reasoning_effort != null && typeof s.reasoning_effort !== "string")
    )
      invalid();
  }
  return v as FollowupSubmit;
}
function action(value: unknown): FollowupAction {
  const a = object(value);
  if (a.type === "undo") {
    keys(a, ["type", "token", "confirmExecution"]);
    id(a.token);
    if (a.confirmExecution != null && a.confirmExecution !== true) invalid();
    return a as FollowupAction;
  }
  if (a.type === "migrate") {
    keys(a, ["type", "id", "confirmThreadSettings"]);
    id(a.id);
    if (a.confirmThreadSettings !== true) invalid();
    return a as FollowupAction;
  }
  if (["clear", "pause", "resume"].includes(a.type)) {
    keys(a, ["type"]);
    return a as FollowupAction;
  }
  if (a.type === "reorder") {
    keys(a, ["type", "ids"]);
    if (!Array.isArray(a.ids) || a.ids.length > 100) invalid();
    a.ids.forEach(id);
    return a as FollowupAction;
  }
  if (a.type === "edit") {
    keys(a, ["type", "id", "text"]);
    id(a.id);
    message(a.text);
    return a as FollowupAction;
  }
  if (["delete", "retry", "steer"].includes(a.type)) {
    keys(a, ["type", "id", "expectedTurnId", "confirmUncertain"]);
    id(a.id);
    if (a.expectedTurnId !== undefined) id(a.expectedTurnId);
    if (
      a.confirmUncertain !== undefined &&
      typeof a.confirmUncertain !== "boolean"
    )
      invalid();
    return a as FollowupAction;
  }
  return invalid();
}

export function registerSessionFollowupRoutes(
  app: FastifyInstance,
  options: {
    file?: string;
    origin: () => string | null;
    fetch?: typeof fetch;
    runtime?: FollowupRuntime;
    autoStart?: boolean;
    nativeQueue?: boolean;
    protocol?: SessionRuntimeProtocol;
    /** Same admission gate as explicit lifecycle operations; never a native lock. */
    withWrite?: <T>(threadId: string, work: () => Promise<T>) => Promise<T>;
    completionNotifier?: Pick<
      SessionCodexFeishuNotifier,
      "cursor" | "observe" | "close"
    >;
  },
) {
  const fetcher = options.fetch ?? fetch,
    lifetime = new AbortController();
  let lease: ChildProcess | undefined,
    leaseExit: Promise<void> | undefined,
    init: Promise<void> | undefined;
  let streamConnected = false,
    streamGeneration = 0;
  let acquired = false;
  async function acquire() {
    if (acquired) return;
    if (!options.file) return;
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
    if (lifetime.signal.aborted) throw new Error("消息队列服务已停止");
    // Kernel lease is released even if the gateway is killed; no PID cleanup or process termination.
    await new Promise<void>((resolve, reject) => {
      if (lifetime.signal.aborted) {
        reject(new Error("消息队列服务已停止"));
        return;
      }
      const child = spawn(
        "flock",
        [
          "-n",
          "-E",
          "75",
          options.file + ".lock",
          process.execPath,
          "-e",
          "process.stdout.write('locked');process.stdin.resume()",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      lease = child;
      leaseExit = new Promise<void>((done) => {
        child.once("exit", () => done());
        child.once("error", () => done());
      });
      let held = false;
      let settled = false;
      const cleanup = () =>
        lifetime.signal.removeEventListener("abort", abortLease);
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const abortLease = () => {
        child.stdin?.end();
        if (!held) done(new Error("消息队列服务已停止"));
      };
      lifetime.signal.addEventListener("abort", abortLease, { once: true });
      child.stdout!.once("data", () => {
        held = true;
        done();
      });
      child.once("error", (error) => done(error));
      child.once("exit", (code) => {
        if (held && !lifetime.signal.aborted) lifetime.abort();
        done(
          lifetime.signal.aborted
            ? new Error("消息队列服务已停止")
            : code === 75 ? new QueueOwnedElsewhere() : new Error("无法获取消息队列锁，请检查队列服务"),
        );
      });
    });
  }
  async function upstream(path: string, params?: unknown) {
    const origin = options.origin();
    if (!origin) throw new FollowupRejected("会话服务尚未连接");
    const response = await fetcher(origin + path, {
      method: params === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(params === undefined ? {} : { body: JSON.stringify(params) }),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) {
      let error = "请求失败";
      try {
        error = ((await response.json()) as any).error ?? error;
      } catch {}
      if (response.status >= 500)
        throw Object.assign(new Error(error), { upstreamStatus: response.status });
      throw new FollowupRejected(error);
    }
    return response.json() as Promise<any>;
  }
  const runtime = options.runtime ?? {
    context: () => upstream("/api/internal/codex/operation-context"),
    guardedCall: (method: string, params: Record<string, unknown>, expectedScope: string) => {
      if (method === "thread/queue/restore") return upstream("/api/internal/codex/guarded-queue-restore", { expectedScope, ...params });
      if (method === "review/start") return upstream("/api/internal/codex/guarded-review", { expectedScope, ...params });
      if (method === "turn/interrupt") return upstream("/api/internal/codex/guarded-interrupt", { expectedScope, ...params });
      if (method === "thread/resume") return upstream("/api/internal/codex/guarded-queue-load", { expectedScope, threadId: params.threadId });
      return upstream("/api/internal/codex/guarded-queue", { expectedScope, method, params });
    },
    syncHolds: async (snapshot: { busy: boolean; threadIds: string[] }) => {
      const origin = options.origin();
      if (!origin) throw new Error("会话服务尚未连接");
      const response = await fetcher(
        origin + "/api/internal/codex/queue-holds",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...snapshot,
            sequence: process.hrtime.bigint().toString(),
          }),
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(5000)]),
        },
      );
      // A still-running older runtime has no ownership manager; preserve its
      // existing queue semantics until the runtime can be safely upgraded.
      if (response.status !== 404 && !response.ok)
        throw new Error("无法确认会话执行占用");
    },
    readThread: (threadId: string) =>
      upstream("/api/codex/thread/read", { threadId }),
    call: (method: string, params: Record<string, unknown>) =>
      upstream("/api/codex/" + method, params),
    statuses: async (ids: string[]) => {
      if (!streamConnected) throw new Error("正在重新连接任务事件");
      const connection = streamGeneration;
      const remaining = new Set(ids),
        result: Record<string, string> = {};
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await upstream("/api/codex/thread/list", {
          limit: 100,
          cursor,
          modelProviders: null,
          cwd: null,
          useStateDbOnly: true,
          sortKey: "updated_at",
        });
        if (!Array.isArray(page.data)) throw new Error("无效的会话状态");
        for (const t of page.data)
          if (remaining.has(t.id)) {
            remaining.delete(t.id);
            result[t.id] = t.status?.type;
          }
        cursor = page.nextCursor ?? null;
        if (cursor && seen.has(cursor)) throw new Error("会话分页重复");
        if (cursor) seen.add(cursor);
      } while (cursor && remaining.size);
      if (!streamConnected || connection !== streamGeneration)
        throw new Error("任务事件连接已变化");
      return result;
    },
  };
  const admit = <T>(threadId: string, work: () => Promise<T>): Promise<T> =>
    options.withWrite ? options.withWrite(threadId, work) : work();
  const writeMethods = new Set(["turn/start", "turn/steer", "turn/interrupt", "review/start", "thread/fork", "thread/resume", "thread/settings/update", "thread/queue/add", "thread/queue/update", "thread/queue/delete", "thread/queue/reorder", "thread/queue/start", "thread/queue/restore"]);
  const admittedRuntime: FollowupRuntime = {
    ...runtime,
    ...(runtime.guardedCall ? { guardedCall: async (method: string, params: Record<string, unknown>, expectedScope: string) => {
      let entered = false;
      try { return await admit(String(params.threadId), () => { entered = true; return runtime.guardedCall!(method, params, expectedScope); }); }
      catch (error) { if (!entered) throw new FollowupRejected(error instanceof Error ? error.message : "会话正在归档"); throw error; }
    } } : {}),
    call: async (method, params) => {
      if (!writeMethods.has(method) || typeof params.threadId !== "string")
        return runtime.call(method, params);
      let entered = false;
      try {
        return await admit(params.threadId, () => { entered = true; return runtime.call(method, params); });
      } catch (error) {
        // Admission rejection is certain: native never received this attempt.
        if (!entered) throw new FollowupRejected(error instanceof Error ? error.message : "会话正在归档");
        throw error;
      }
    },
  };
  let queue!: NativeCodexFollowups | CodexFollowups;
  let selecting: Promise<void> | undefined;
  let legacyScope: string | undefined;
  const assertLegacyScope = async (expected?: string) => {
    if (!legacyScope) return;
    const selected = await options.protocol!.read();
    if (selected.backend !== "legacy-stdio" || selected.scopeToken !== legacyScope || (expected !== undefined && expected !== legacyScope))
      throw new FollowupRejected("运行实例已变化，消息尚未发送，草稿已保留");
  };
  const selectQueue = async () => {
    if (queue) return;
    selecting ??= (async () => {
      const selected = await options.protocol?.read();
      await acquire();
      acquired = true;
      if (selected?.backend === "legacy-stdio") {
        legacyScope = selected.scopeToken;
        const legacyRuntime: FollowupRuntime = {
          ...admittedRuntime, context: undefined, guardedCall: undefined,
          call: async (method, params) => {
            await assertLegacyScope();
            return admittedRuntime.call(method, params);
          },
        };
        const candidate = new CodexFollowups(legacyRuntime, options.file);
        await candidate.recover("网关已更新，请确认原任务与队列后继续");
        queue = candidate;
      } else {
        queue = (options.nativeQueue ?? !options.runtime)
          ? new NativeCodexFollowups(admittedRuntime, options.file)
          : new CodexFollowups(admittedRuntime, options.file);
      }
    })().catch(error => { selecting = undefined; throw error; });
    await selecting;
  };
  const dispatchSoon = () => {
    if (options.autoStart === false) return;
    void queue
      .tick()
      .catch((error) =>
        app.log.warn({ err: error }, "Follow-up dispatch unavailable"),
      );
  };
  const ready = () => {
    if (lifetime.signal.aborted)
      return Promise.reject(new Error("消息队列服务已停止"));
    return (
      init ??
      (init = selectQueue().catch((e) => {
        init = undefined;
        throw e;
      }))
    );
  };
  // HTTP and trusted bot replies share validation, ownership lease and dispatch.
  async function enqueue(input: unknown) {
    const data = submit(input);
    await ready();
    if (legacyScope && data.expectedScope !== legacyScope) throw new FollowupRejected("运行服务范围已变化，消息尚未发送");
    await assertLegacyScope(data.expectedScope);
    const result = await admit(data.threadId, () => queue.submit(data));
    dispatchSoon();
    return result;
  }
  app.get<{ Querystring: { threadId: string } }>(
    "/api/session/followups",
    { errorHandler: followupErrorHandler },
    async (request, reply) => {
      const threadId = id(request.query.threadId);
      await ready();
      try {
        return await queue.get(threadId);
      } catch (error) {
        if (Number((error as { upstreamStatus?: unknown })?.upstreamStatus) >= 500)
          return reply.code(409).send({
            error: "官方队列状态暂不可用；原队列状态未知，已保留当前显示",
            code: "FOLLOWUP_READ_UNAVAILABLE",
          });
        throw error;
      }
    },
  );
  app.get<{ Querystring: { threadId?: string; expectedScope?: string; cursor?: string; limit?: string } }>("/api/session/followups/steer-receipts", { errorHandler: followupErrorHandler }, async (request, reply) => {
    await ready();
    if (!(queue instanceof NativeCodexFollowups)) return reply.code(409).send({ error: "旧运行服务不支持持久补充说明回执" });
    const threadId = id(request.query.threadId), limit = request.query.limit === undefined ? 30 : Number(request.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30 || (request.query.cursor !== undefined && (typeof request.query.cursor !== "string" || request.query.cursor.length > 280))) invalid("补充说明分页参数无效");
    await ready(); reply.header("cache-control", "no-store");
    return queue.steerReceipts(threadId, request.query.expectedScope, request.query.cursor ?? null, limit);
  });
  app.post(
    "/api/session/followups/submit",
    { bodyLimit: 1024 * 1024, errorHandler: followupErrorHandler },
    async (request) => {
      return enqueue(request.body);
    },
  );
  app.post("/api/session/followups/change", { errorHandler: followupErrorHandler }, async (request) => {
    const data = object(request.body);
    keys(data, ["threadId", "revision", "action", "expectedScope", "operationId"]);
    const threadId = id(data.threadId);
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) invalid();
    const op = action(data.action);
    await ready();
    if (legacyScope && data.expectedScope !== legacyScope) throw new FollowupRejected("运行服务范围已变化，操作尚未提交");
    await assertLegacyScope(data.expectedScope);
    const result = await admit(threadId, () => queue instanceof NativeCodexFollowups ? queue.change(threadId, data.revision, op, data.expectedScope, runtime.context ? id(data.operationId) : data.operationId) : queue.change(threadId, data.revision, op));
    dispatchSoon();
    return result;
  });
  app.get<{ Querystring: { threadId?: string; operationId?: string; expectedScope?: string } }>("/api/session/followups/actions", { errorHandler: followupErrorHandler }, async (request, reply) => {
    await ready();
    if (!(queue instanceof NativeCodexFollowups)) return reply.code(409).send({ error: "旧运行服务不支持官方队列操作回执" });
    await ready(); reply.header("cache-control", "no-store");
    return await queue.actionReceipt(id(request.query.threadId), id(request.query.operationId), request.query.expectedScope) ?? reply.code(404).send({ error: "尚未登记此队列操作" });
  });
  app.post("/api/session/followups/stop", { errorHandler: followupErrorHandler }, async (request) => {
    const data = object(request.body);
    keys(data, ["threadId", "turnId", "expectedScope"]);
    const threadId = id(data.threadId),
      turnId = id(data.turnId);
    await ready();
    if (legacyScope && data.expectedScope !== legacyScope) throw new FollowupRejected("运行服务范围已变化，操作尚未提交");
    await assertLegacyScope(data.expectedScope);
    if (queue instanceof NativeCodexFollowups) {
      if (runtime.context && (typeof data.expectedScope !== "string" || data.expectedScope.length > 512)) invalid("请先核对当前运行服务后再停止");
      await queue.stop(threadId, turnId, data.expectedScope);
    } else await queue.stop(threadId, turnId);
    return queue.get(threadId);
  });
  app.post("/api/session/followups/review", { errorHandler: followupErrorHandler }, async (request) => {
    const data = object(request.body);
    keys(data, ["threadId", "delivery", "target", "operationId", "expectedScope"]);
    const threadId = id(data.threadId);
    if (!["inline", "detached"].includes(data.delivery)) invalid();
    const target = object(data.target);
    const fields: Record<string, string[]> = {
      uncommittedChanges: ["type"],
      baseBranch: ["type", "branch"],
      commit: ["type", "sha", "title"],
      custom: ["type", "instructions"],
    };
    if (!Object.hasOwn(fields, String(target.type))) invalid();
    keys(target, fields[target.type]);
    for (const field of fields[target.type].filter(
      (f) => f !== "type" && f !== "title",
    ))
      if (!message(target[field]).trim()) invalid();
    if (target.title != null) message(target.title);
    await ready();
    if (legacyScope && data.expectedScope !== legacyScope) throw new FollowupRejected("运行服务范围已变化，操作尚未提交");
    await assertLegacyScope(data.expectedScope);
    return admit(threadId, () => queue instanceof NativeCodexFollowups ? queue.review(threadId, data.delivery, target, id(data.operationId), data.expectedScope) : queue.review(threadId, data.delivery, target));
  });
  app.get<{ Querystring: { threadId?: string; operationId?: string; expectedScope?: string } }>("/api/session/followups/review", { errorHandler: followupErrorHandler }, async (request, reply) => {
    await ready();
    if (!(queue instanceof NativeCodexFollowups)) return reply.code(409).send({ error: "旧运行服务不支持持久审查回执" });
    const threadId = id(request.query.threadId), operationId = id(request.query.operationId);
    await ready(); reply.header("cache-control", "no-store");
    return (await queue.reviewReceipt(threadId, operationId, request.query.expectedScope)) ?? reply.code(404).send({ error: "尚未登记此审查操作" });
  });
  let timer: ReturnType<typeof setTimeout> | undefined,
    streamTimer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      await ready();
      await queue.tick();
    } catch (error) {
      app.log.warn({ err: error }, "Follow-up queue unavailable");
    } finally {
      if (!lifetime.signal.aborted) {
        timer = setTimeout(() => void poll(), 1000);
        timer.unref();
      }
    }
  };
  let sequence: number | undefined, instance: string | undefined;
  async function stream() {
    try {
      await ready();
      const origin = options.origin();
      if (!origin) throw new Error("Not ready");
      const health = await upstream("/health");
      if (health.instance !== instance) {
        if (instance !== undefined)
          await queue.recover("会话服务已重启，请确认任务状态后继续队列");
        sequence = await options.completionNotifier?.cursor(health.instance);
        instance = health.instance;
      }
      const response = await fetcher(
        origin +
          "/api/events" +
          (sequence === undefined ? "" : `?since=${sequence}`),
        { signal: lifetime.signal },
      );
      if (!response.ok || !response.body) throw new Error("Events unavailable");
      streamConnected = true;
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (
            typeof event.seq !== "number" ||
            (sequence !== undefined && event.seq <= sequence)
          )
            continue;
          if (sequence !== undefined && event.seq > sequence + 1)
            await queue.recover("连接期间有任务事件缺失，请检查后继续队列");
          // Enqueue the receipt ahead of the notifier's serialized inspect,
          // without blocking the event stream on queue/runtime I/O.
          if (event.event === "codex:notification")
            void queue.observe(event.payload).catch((error) =>
              app.log.error({ err: error }, "Follow-up event failed"),
            );
          try {
            await options.completionNotifier?.observe(instance!, event);
          } catch (error) {
            // Notification storage must not disconnect the task dispatch stream.
            // Its durable cursor stays unchanged so a restored notifier can replay.
            app.log.warn(
              { err: error },
              "Session completion notification was not recorded",
            );
          }
          sequence = event.seq;
        }
        if (buffer.length > 8 * 1024 * 1024) throw new Error("Event too large");
      }
    } catch {
      /* Reconnect; durable sending records remain distinct from queued work. */
    } finally {
      streamConnected = false;
      streamGeneration++;
      if (!lifetime.signal.aborted) {
        streamTimer = setTimeout(() => void stream(), 1000);
        streamTimer.unref();
      }
    }
  }
  if (options.autoStart !== false)
    app.addHook("onReady", async () => {
      void poll();
      void stream();
    });
  app.addHook("onClose", async () => {
    lifetime.abort();
    clearTimeout(timer);
    clearTimeout(streamTimer);
    await options.completionNotifier?.close();
    await init?.catch(() => {});
    await queue?.drain();
    lease?.stdin?.end();
    await leaseExit?.catch(() => {});
  });
  return {
    enqueue,
    submit: enqueue,
    inspect: async (threadId: string) => { await ready(); return queue.inspect(threadId); },
    tick: async () => { await ready(); return queue.tick(); },
    observe: async (event: any) => { await ready(); return queue.observe(event); },
    get: async (threadId: string) => { await ready(); return queue.get(threadId); },
    recover: async (reason: string) => { await ready(); return queue.recover(reason); },
    drain: async () => { await ready(); return queue.drain(); },
    stop: async (threadId: string, turnId: string, scope?: string) => { await ready(); return queue instanceof NativeCodexFollowups ? queue.stop(threadId, turnId, scope) : queue.stop(threadId, turnId); },
    pause: async (threadId: string) => {
      await ready();
      if (queue instanceof NativeCodexFollowups) return queue.pause(threadId);
      const state = await queue.inspect(threadId);
      await queue.change(threadId, state.revision, { type: "pause" });
    },
  };
}
