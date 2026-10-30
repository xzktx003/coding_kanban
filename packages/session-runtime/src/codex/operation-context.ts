import type { FastifyInstance, FastifyRequest } from "fastify";
import { bodyObject, HttpError, object } from "../core/json.js";
import type { CodexService } from "./client.js";
import { boundedText } from "./protocol.js";

/** Fixed lifecycle operations; context metadata is consumed here and is never sent to native RPC. */
export function registerCodexOperationRoutes(
  app: FastifyInstance,
  service: CodexService,
): void {
  const context = () => service.operationContext();
  const post = (path: string, handler: (request: FastifyRequest) => unknown) =>
    app.post(path, async (request) => {
      try {
        return await handler(request);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("NOT_SENT:"))
          throw new HttpError(409, error.message);
        throw error;
      }
    });
  app.get("/api/internal/codex/operation-context", context);
  app.get("/api/codex/lifecycle/context", context);
  const parse = (value: unknown, fields: string[]) => {
    const body = bodyObject(value);
    if (Object.keys(body).some((key) => !fields.includes(key)))
      throw new HttpError(400, "Unexpected lifecycle operation parameter");
    return {
      body,
      scope: boundedText(body.expectedScope, 64, "expectedScope", true),
      threadId: boundedText(body.threadId, 512, "threadId", true),
    };
  };
  post("/api/internal/codex/guarded-resume", async (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "parameters",
    ]);
    if (
      body.parameters !== undefined &&
      (body.parameters === null ||
        typeof body.parameters !== "object" ||
        Array.isArray(body.parameters))
    )
      throw new HttpError(400, "Invalid resume parameters");
    const parameters = object(body.parameters);
    const allowed = new Set([
      "model",
      "effort",
      "serviceTier",
      "approvalPolicy",
      "approvalsReviewer",
      "sandboxPolicy",
      "permissions",
      "collaborationMode",
      "summary",
      "personality",
      "disabledPluginIds",
    ]);
    if (Object.keys(parameters).some((key) => !allowed.has(key)))
      throw new HttpError(400, "Unexpected resume setting");
    return service.guardedCall(
      "turn/start",
      { ...parameters, threadId, input: [] },
      scope,
    );
  });
  post("/api/internal/codex/guarded-interrupt", (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "turnId",
    ]);
    return service.guardedCall(
      "turn/interrupt",
      { threadId, turnId: boundedText(body.turnId, 512, "turnId", true) },
      scope,
    );
  });
  post("/api/internal/codex/guarded-attach", (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "expectedTurnId",
    ]);
    return service.attachLoadedThread(
      threadId,
      boundedText(body.expectedTurnId, 512, "expectedTurnId", true),
      scope,
    );
  });
  post("/api/internal/codex/guarded-queue-load", (request) => {
    const { scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
    ]);
    return service.loadQueueThread(threadId, scope);
  });
  post("/api/internal/codex/guarded-queue-restore", request => {
    const {body, scope, threadId} = parse(request.body, ["expectedScope", "threadId", "queuedSubmissionIds"]);
    if (!Array.isArray(body.queuedSubmissionIds) || !body.queuedSubmissionIds.length || body.queuedSubmissionIds.length > 256)
      throw new HttpError(400, "Invalid captured native queue ids");
    const ids = body.queuedSubmissionIds.map(id => boundedText(id, 512, "queuedSubmissionId", true));
    return service.restoreQueueThread(threadId, scope, ids);
  });
  post("/api/internal/codex/guarded-archive", (request) => {
    const { scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
    ]);
    return service.guardedCall("thread/archive", { threadId }, scope);
  });
  post("/api/internal/codex/guarded-unarchive", (request) => {
    const { scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
    ]);
    return service.guardedCall("thread/unarchive", { threadId }, scope);
  });
  post("/api/internal/codex/guarded-rename", (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "name",
    ]);
    const name = body.name;
    if (
      typeof name !== "string" ||
      !name ||
      name.length > 128 ||
      /[\x00-\x1f\x7f-\x9f]/.test(name)
    )
      throw new HttpError(400, "Invalid name");
    return service.guardedCall("thread/name/set", { threadId, name }, scope);
  });
  post("/api/internal/codex/guarded-goal-pause", (request) => {
    const { scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
    ]);
    return service.guardedCall(
      "thread/goal/set",
      { threadId, status: "paused", origin: "user" },
      scope,
    );
  });
  post("/api/internal/codex/guarded-review", (request) => {
    const { body, scope, threadId } = parse(request.body, ["expectedScope", "threadId", "delivery", "target"]);
    if (!["inline", "detached"].includes(String(body.delivery)) || !body.target || typeof body.target !== "object" || Array.isArray(body.target))
      throw new HttpError(400, "Invalid review delivery or target");
    const target = object(body.target);
    const fields: Record<string, string[]> = { uncommittedChanges: ["type"], baseBranch: ["type", "branch"], commit: ["type", "sha", "title"], custom: ["type", "instructions"] };
    const allowed = fields[String(target.type)];
    if (!allowed || Object.keys(target).some(key => !allowed.includes(key))) throw new HttpError(400, "Invalid review target");
    if (target.type === "baseBranch") boundedText(target.branch, 512, "branch", true);
    if (target.type === "commit") {
      boundedText(target.sha, 512, "sha", true);
      if (target.title !== undefined && target.title !== null) boundedText(target.title, 2048, "title");
    }
    if (target.type === "custom") boundedText(target.instructions, 16_384, "instructions");
    return service.guardedCall("review/start", { threadId, delivery: body.delivery!, target }, scope);
  });
  post("/api/internal/codex/guarded-settings", (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "parameters",
    ]);
    if (
      body.parameters === undefined ||
      body.parameters === null ||
      typeof body.parameters !== "object" ||
      Array.isArray(body.parameters)
    )
      throw new HttpError(400, "Invalid thread settings");
    const parameters = object(body.parameters);
    const allowed = new Set([
      "model",
      "effort",
      "serviceTier",
      "approvalPolicy",
      "approvalsReviewer",
      "sandboxPolicy",
      "permissions",
      "collaborationMode",
      "summary",
      "personality",
      "disabledPluginIds",
    ]);
    if (Object.keys(parameters).some((key) => !allowed.has(key)))
      throw new HttpError(400, "Unexpected thread setting");
    return service.guardedCall(
      "thread/settings/update",
      { ...parameters, threadId },
      scope,
    );
  });
  post("/api/internal/codex/guarded-read-state", (request) => {
    const { body, scope, threadId } = parse(request.body, [
      "expectedScope",
      "threadId",
      "expectedRevision",
      "operation",
    ]);
    if (
      typeof body.expectedRevision !== "string" ||
      !body.expectedRevision ||
      body.expectedRevision.length > 512 ||
      /[\x00-\x1f]/.test(body.expectedRevision) ||
      !["read", "unread"].includes(String(body.operation))
    )
      throw new HttpError(
        400,
        "Invalid native read-state revision or operation",
      );
    return service.guardedCall(
      "thread/readState/update",
      {
        threadId,
        expectedRevision: body.expectedRevision,
        operation: { type: body.operation },
      },
      scope,
    );
  });
  post("/api/internal/codex/guarded-queue", (request) => {
    const body = bodyObject(request.body);
    if (
      Object.keys(body).some(
        (key) => !["expectedScope", "method", "params"].includes(key),
      )
    )
      throw new HttpError(400, "Unexpected native queue parameter");
    const scope = boundedText(body.expectedScope, 64, "expectedScope", true);
    const method = boundedText(body.method, 64, "method", true);
    const methods = new Set([
      "thread/settings/update",
      "thread/queue/add",
      "thread/queue/update",
      "thread/queue/delete",
      "thread/queue/reorder",
      "thread/queue/start",
      "turn/steer",
    ]);
    if (
      !methods.has(method) ||
      !body.params ||
      typeof body.params !== "object" ||
      Array.isArray(body.params)
    )
      throw new HttpError(400, "Unsupported native queue operation");
    const params = object(body.params);
    boundedText(params.threadId, 512, "threadId", true);
    return service.guardedCall(method, params, scope);
  });
}
