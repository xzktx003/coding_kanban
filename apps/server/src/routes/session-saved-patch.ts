import type { FastifyInstance } from "fastify";
import type { SavedPatchRequest } from "@agent-orchestrator/shared";
import { CodexSavedPatch } from "../services/codex-saved-patch.js";
function invalid(): never {
  throw Object.assign(new Error("无效的保存 patch 操作请求"), {
    statusCode: 400,
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) invalid();
}
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    invalid();
  return value;
}
function path(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f]/.test(value)
  )
    invalid();
  return value;
}
function parse(value: unknown): SavedPatchRequest {
  const b = object(value);
  keys(b, [
    "requestId",
    "threadId",
    "turnId",
    "action",
    "expectedChanges",
    "filePath",
  ]);
  id(b.requestId);
  id(b.threadId);
  id(b.turnId);
  if (b.action !== "undo" && b.action !== "reapply") invalid();
  if (b.filePath !== undefined) path(b.filePath);
  if (!Array.isArray(b.expectedChanges) || b.expectedChanges.length > 1000)
    invalid();
  const seen = new Set<string>();
  for (const batch of b.expectedChanges) {
    const item = object(batch);
    keys(item, ["id", "changes"]);
    const itemId = id(item.id);
    if (seen.has(itemId)) invalid();
    seen.add(itemId);
    if (
      !Array.isArray(item.changes) ||
      !item.changes.length ||
      item.changes.length > 1000
    )
      invalid();
    for (const change of item.changes) {
      const c = object(change);
      keys(c, ["path", "kind", "diff"]);
      path(c.path);
      const kind = object(c.kind);
      keys(kind, ["type", "move_path"]);
      if (!["add", "delete", "update"].includes(String(kind.type))) invalid();
      if (kind.move_path != null) {
        if (kind.type !== "update") invalid();
        path(kind.move_path);
      }
      if (
        typeof c.diff !== "string" ||
        c.diff.length > 1024 * 1024 ||
        c.diff.includes("\0")
      )
        invalid();
    }
  }
  return b as unknown as SavedPatchRequest;
}
export function registerSessionSavedPatchRoutes(
  app: FastifyInstance,
  options: {
    origin: () => string | null;
    fetch?: typeof fetch;
    file?: string;
    service?: Pick<CodexSavedPatch, "apply" | "status">;
  },
) {
  const fetcher = options.fetch ?? fetch;
  const service =
    options.service ??
    new CodexSavedPatch(async (threadId) => {
      const origin = options.origin();
      if (!origin)
        throw Object.assign(new Error("会话服务未连接，未应用保存的 patch"), {
          statusCode: 503,
        });
      const response = await fetcher(origin + "/api/codex/thread/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw Object.assign(
          new Error("无法只读核对原生轮次，未应用保存的 patch"),
          { statusCode: response.status === 404 ? 409 : 503 },
        );
      return response.json();
    }, options.file);
  app.post(
    "/api/session/saved-patches/apply",
    { bodyLimit: 2 * 1024 * 1024 },
    async (request) => service.apply(parse(request.body)),
  );
  app.get<{ Querystring: { threadId: string; requestId: string } }>(
    "/api/session/saved-patches/status",
    async (request) => ({
      result: await service.status(
        id(request.query.threadId),
        id(request.query.requestId),
      ),
    }),
  );
}
