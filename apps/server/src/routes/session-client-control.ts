import type { FastifyInstance } from "fastify";
import { visibleSessionReadContext } from "../services/session-read-context.js";
import type { SessionManagement } from "../services/session-management.js";

export function registerSessionClientControlRoutes(
  app: FastifyInstance,
  options: {
    origin: () => string | null;
    fetch?: typeof fetch;
    management: SessionManagement;
    write<T>(threadId: string, work: () => Promise<T>): Promise<T>;
  },
) {
  const fetcher = options.fetch ?? fetch;
  const call = async (path: string, params?: Record<string, unknown>) => {
    const origin = options.origin();
    if (!origin)
      throw Object.assign(new Error("会话服务尚未连接"), { statusCode: 503 });
    const response = await fetcher(`${origin}${path}`, {
      method: params ? "POST" : "GET",
      headers: params ? { "content-type": "application/json" } : undefined,
      ...(params ? { body: JSON.stringify(params) } : {}),
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          typeof value?.error === "string" ? value.error : "会话操作暂时不可用",
        ),
        {
          statusCode: response.status,
          definitelyRejected: response.status >= 400 && response.status < 500,
        },
      );
    return value;
  };
  const id = (value: unknown): string => {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 512 ||
      /[\x00-\x1f]/.test(value)
    )
      throw Object.assign(new Error("无效的会话目标"), { statusCode: 400 });
    return value;
  };
  app.get<{
    Querystring: { threadId?: string; replyId?: string; namespace?: string };
  }>("/api/session/management/read-context", async (request, reply) => {
    const threadId = id(request.query.threadId),
      replyId = id(request.query.replyId);
    const snapshot = await options.management.snapshot();
    if (
      request.query.namespace !== snapshot.namespaces.codex ||
      !snapshot.namespaces.codex
    )
      throw Object.assign(new Error("账号范围已变化，请重新查看会话"), {
        statusCode: 409,
      });
    reply.header("cache-control", "no-store");
    const proof = await visibleSessionReadContext(
      {
        context: () => call("/api/internal/codex/operation-context"),
        call: (method, params) => call(`/api/codex/${method}`, params),
      },
      threadId,
      replyId,
    );
    const after = await options.management.snapshot();
    const native = await call("/api/internal/codex/operation-context");
    if (
      after.namespaces.codex !== request.query.namespace ||
      native.scope !== proof.scope
    )
      throw Object.assign(
        new Error("账号或运行范围已变化，请重新查看对应回复"),
        { statusCode: 409 },
      );
    return proof;
  });
  app.post(
    "/api/session/lifecycle/attach",
    { bodyLimit: 4096 },
    async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (k) => !["threadId", "expectedTurnId", "expectedScope"].includes(k),
        )
      )
        throw Object.assign(new Error("无效的实时连接请求"), {
          statusCode: 400,
        });
      const threadId = id(body.threadId),
        expectedTurnId = id(body.expectedTurnId),
        expectedScope = id(body.expectedScope);
      reply.header("cache-control", "no-store");
      try {
        return await options.write(threadId, () =>
          call("/api/internal/codex/guarded-attach", {
            threadId,
            expectedTurnId,
            expectedScope,
          }),
        );
      } catch (error) {
        const e = error as {
          statusCode?: number;
          message?: string;
          definitelyRejected?: boolean;
        };
        return reply
          .code(e.statusCode ?? 503)
          .send({
            error: e.message ?? "连接结果待核对",
            deliveryStage: e.definitelyRejected
              ? "not-admitted"
              : "outcome-unknown",
          });
      }
    },
  );
}
