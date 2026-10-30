import type { FastifyInstance } from "fastify";
import type { SessionManagementOperation } from "@agent-orchestrator/shared";
import { SessionManagement } from "../services/session-management.js";

function invalid(): never { throw Object.assign(new Error("无效的会话管理操作"), { statusCode: 400 }); }
function object(v: unknown): Record<string, any> { if (!v || typeof v !== "object" || Array.isArray(v)) invalid(); return v as Record<string, any>; }
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) invalid(); }
function text(v: unknown, length = 512) { return typeof v === "string" && v.length > 0 && v.length <= length && !/[\x00-\x1f]/.test(v); }
function parse(v: unknown): SessionManagementOperation {
  const input = object(v); keys(input, ["operationId", "windowId", "target", "action"]);
  if (!text(input.operationId, 160) || !/^[-\w:]+$/.test(input.operationId)) invalid();
  if (!text(input.windowId, 160)) invalid();
  const target = object(input.target); keys(target, ["namespace", "kind", "id"]);
  if (!text(target.namespace, 128) || !["codex", "cc", "acp"].includes(target.kind) || !text(target.id)) invalid();
  const action = object(input.action);
  if (action.type === "pin") {
    keys(action, ["type", "value", "expectedRevision", "title", "cwd"]);
    if (typeof action.value !== "boolean" || !Number.isSafeInteger(action.expectedRevision) || action.expectedRevision < 0) invalid();
    if (action.title !== undefined && !text(action.title, 2048)) invalid();
    if (action.cwd !== undefined && (!text(action.cwd, 4096) || !action.cwd.startsWith("/"))) invalid();
  } else if (action.type === "complete") { keys(action, ["type", "replyId"]); if (!text(action.replyId)) invalid(); }
  else if (action.type === "read" || action.type === "unread") {
    keys(action, action.type === "read" ? ["type", "replyId", "manualUnreadRevision", "nativeReadRevision", "nativeScope"] : ["type", "nativeReadRevision", "nativeScope"]);
    if (action.type === "read" && (!text(action.replyId) || !Number.isSafeInteger(action.manualUnreadRevision) || action.manualUnreadRevision < 0)) invalid();
    if (action.nativeReadRevision !== undefined && !text(action.nativeReadRevision)) invalid();
    if (action.nativeScope !== undefined && !text(action.nativeScope)) invalid();
    if ((action.nativeReadRevision === undefined) !== (action.nativeScope === undefined)) invalid();
  } else invalid();
  return input as SessionManagementOperation;
}
export function registerSessionManagementRoutes(app: FastifyInstance, options: ConstructorParameters<typeof SessionManagement>[0]) {
  const service = new SessionManagement(options);
  app.get("/api/session/management", async (_req, reply) => { reply.header("cache-control", "no-store"); return service.snapshot(); });
  app.post("/api/session/management", { bodyLimit: 16_384 }, async (req, reply) => { reply.header("cache-control", "no-store"); return service.apply(parse(req.body)); });
  return service;
}
