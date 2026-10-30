import type { FastifyInstance } from "fastify";
import { SessionLifecycle, type ResumeIntent, type ArchiveIntent } from "../services/session-lifecycle.js";

function invalid(message = "无效的会话操作"): never { throw Object.assign(new Error(message), { statusCode: 400 }); }
function object(value: unknown): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, any>; }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function id(value: unknown): string { if (typeof value !== "string" || !/^[-a-zA-Z0-9_:]{1,160}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) invalid(); return value; }
function parameters(value: unknown): Record<string, unknown> {
  const result = object(value);
  keys(result, ["cwd", "model", "effort", "serviceTier", "approvalPolicy", "approvalsReviewer", "sandboxPolicy", "collaborationMode", "personality", "permissions"]);
  if (JSON.stringify(result).length > 32_000) invalid();
  for (const name of ["cwd", "model", "effort", "serviceTier"])
    if (result[name] != null && (typeof result[name] !== "string" || result[name].length > 4096 || /[\x00-\x1f]/.test(result[name]))) invalid();
  if (result.cwd != null && !result.cwd.startsWith("/")) invalid("工作目录必须是绝对路径");
  if (result.permissions != null && (typeof result.permissions !== "string" || !result.permissions.trim() || result.permissions.length > 4096 || /[\x00-\x1f]/.test(result.permissions))) invalid();
  if (result.permissions != null && result.sandboxPolicy != null) invalid("命名权限配置不能与沙箱策略同时提交");
  return result;
}

/** Registers bounded, explicit lifecycle mutations. Native services stay alive on close. */
export function registerSessionLifecycleRoutes(app: FastifyInstance, options: {
  file?: string;
  origin: () => string | null;
  fetch?: typeof fetch;
  context?: () => Promise<{ scopeToken: string; namespace: string; daemonIdentity?: string }>;
  followups: {
    inspect(id: string): Promise<{ revision: number; paused: string | null; items: Array<{ status?: string }> }>;
    pause(id: string): Promise<void>;
  };
}) {
  const fetcher = options.fetch ?? fetch;
  const lifecycle = new SessionLifecycle({
    file: options.file, followups: options.followups, context: options.context,
    runtime: { async call(method, params) {
      const origin = options.origin();
      if (!origin) throw Object.assign(new Error("会话服务暂时不可用"), { definitelyRejected: true });
      const response = await fetcher(`${origin}/api/codex/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(15_000),
      });
      const value = await response.json() as any;
      if (!response.ok) throw Object.assign(new Error(value?.error ?? "会话操作失败"), { definitelyRejected: response.status >= 400 && response.status < 500, statusCode: response.status });
      return value;
    }, async guardedCall(method, params, expectedScope) {
      const endpoints: Record<string, string> = { "turn/start": "guarded-resume", "thread/settings/update": "guarded-settings", "thread/goal/set": "guarded-goal-pause", "turn/interrupt": "guarded-interrupt", "thread/archive": "guarded-archive", "thread/unarchive": "guarded-unarchive", "thread/name/set": "guarded-rename" };
      const endpoint = endpoints[method];
      if (!endpoint) throw new Error("不支持此原生受控操作");
      const origin = options.origin();
      if (!origin) throw Object.assign(new Error("会话服务暂时不可用"), { definitelyRejected: true });
      const { threadId, input: _input, ...parameters } = params;
      const body = ["turn/start", "thread/settings/update"].includes(method) ? { expectedScope, threadId, parameters } : { expectedScope, threadId, ...(method === "turn/interrupt" ? { turnId: params.turnId } : {}), ...(method === "thread/name/set" ? { name: params.name } : {}) };
      const response = await fetcher(`${origin}/api/internal/codex/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const value = await response.json() as any;
      if (!response.ok) throw Object.assign(new Error(value?.error ?? "恢复操作待核对"), { definitelyRejected: response.status >= 400 && response.status < 500, statusCode: response.status });
      return value;
    } },
  });
  app.get("/api/session/lifecycle/context", async (_req, reply) => { reply.header("cache-control", "no-store"); return lifecycle.context(); });
  app.get<{ Querystring: { operationId?: string; expectedScope?: string } }>("/api/session/lifecycle/resume", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const result = await lifecycle.receipt(id(req.query.operationId), req.query.expectedScope);
    return result ?? reply.code(404).send({ error: "尚未登记此恢复操作" });
  });
  app.post("/api/session/lifecycle/resume", { bodyLimit: 40_000 }, async (req, reply) => {
    const body = object(req.body); keys(body, ["operationId", "threadId", "sourceTurnId", "parameters", "expectedScope"]);
    if (typeof body.expectedScope !== "string" || body.expectedScope.length < 1 || body.expectedScope.length > 512) invalid();
    const input: ResumeIntent = { operationId: id(body.operationId), threadId: id(body.threadId), sourceTurnId: id(body.sourceTurnId), parameters: parameters(body.parameters), expectedScope: body.expectedScope };
    reply.header("cache-control", "no-store"); return lifecycle.resume(input);
  });
  app.get<{ Querystring: { operationId?: string; expectedScope?: string } }>("/api/session/lifecycle/settings", async (req, reply) => {
    reply.header("cache-control", "no-store"); const result = await lifecycle.settingsReceipt(id(req.query.operationId), req.query.expectedScope); return result ?? reply.code(404).send({ error: "尚未登记此设置操作" });
  });
  app.post("/api/session/lifecycle/settings", { bodyLimit: 40_000 }, async (req, reply) => {
    const body = object(req.body); keys(body, ["operationId", "threadId", "parameters", "expectedScope"]);
    if (typeof body.expectedScope !== "string" || body.expectedScope.length < 1 || body.expectedScope.length > 512) invalid();
    reply.header("cache-control", "no-store"); return lifecycle.settings({ operationId: id(body.operationId), threadId: id(body.threadId), parameters: parameters(body.parameters), expectedScope: body.expectedScope });
  });
  app.get<{ Querystring: { operationId?: string; expectedScope?: string } }>("/api/session/lifecycle/rename", async (req, reply) => {
    reply.header("cache-control", "no-store"); const result = await lifecycle.settingsReceipt(id(req.query.operationId), req.query.expectedScope); return result ?? reply.code(404).send({ error: "尚未登记此命名操作" });
  });
  app.post("/api/session/lifecycle/rename", { bodyLimit: 4096 }, async (req, reply) => {
    const body = object(req.body); keys(body, ["operationId", "threadId", "name", "expectedScope"]);
    if (typeof body.expectedScope !== "string" || !body.expectedScope || body.expectedScope.length > 512 || typeof body.name !== "string" || !body.name.trim() || body.name.length > 128 || /[\x00-\x1f]/.test(body.name)) invalid();
    reply.header("cache-control", "no-store"); return lifecycle.rename({ operationId: id(body.operationId), threadId: id(body.threadId), parameters: { name: body.name }, expectedScope: body.expectedScope });
  });
  app.post("/api/session/lifecycle/archive", { bodyLimit: 4096 }, async (req, reply) => {
    const body = object(req.body); keys(body, ["operationId", "threadId", "mode", "expectedTurnId", "expectedScope"]);
    if (!["idle", "stop"].includes(body.mode)) invalid();
    if (typeof body.expectedScope !== "string" || body.expectedScope.length < 1 || body.expectedScope.length > 512) invalid();
    const input: ArchiveIntent = { operationId: id(body.operationId), threadId: id(body.threadId), mode: body.mode, expectedScope: body.expectedScope, ...(body.expectedTurnId === undefined ? {} : { expectedTurnId: id(body.expectedTurnId) }) };
    reply.header("cache-control", "no-store"); return lifecycle.archive(input);
  });
  app.get<{ Querystring: { operationId?: string; expectedScope?: string } }>("/api/session/lifecycle/archive", async (req, reply) => {
    reply.header("cache-control", "no-store"); const result = await lifecycle.archiveReceipt(id(req.query.operationId), req.query.expectedScope); return result ?? reply.code(404).send({ error: "尚未登记此归档操作" });
  });
  for (const action of ["restore", "release"] as const) app.post(`/api/session/lifecycle/${action}`, { bodyLimit: 1024 }, async req => {
    const body = object(req.body); keys(body, ["threadId", "expectedScope"]);
    if (typeof body.expectedScope !== "string" || !body.expectedScope || body.expectedScope.length > 512) invalid();
    return lifecycle[action](id(body.threadId), body.expectedScope);
  });
  return lifecycle;
}
