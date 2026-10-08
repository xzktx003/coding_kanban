import type { FastifyInstance } from "fastify";
import { CodexSubagents } from "../services/codex-subagents.js";
import type { SubagentStopTarget } from "@agent-orchestrator/shared";
const id = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[-a-zA-Z0-9_:]{1,160}$/.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    throw Object.assign(new Error("无效的线程身份"), { statusCode: 400 });
  return value;
};
export function registerSessionSubagentRoutes(
  app: FastifyInstance,
  options: {
    origin: () => string | null;
    fetch: typeof fetch;
    stop: (id: string, turn: string) => Promise<unknown>;
  },
) {
  const call = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<any> => {
    const origin = options.origin();
    if (!origin)
      throw Object.assign(new Error("会话服务尚未连接"), { statusCode: 503 });
    const response = await options.fetch(`${origin}/api/codex/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    });
    if (method === "thread/metadata" && response.status === 404)
      return call("thread/read", params);
    const data = (await response.json()) as any;
    if (!response.ok)
      throw Object.assign(new Error(data.error ?? "子任务请求失败"), {
        statusCode: response.status,
      });
    return data;
  };
  const service = new CodexSubagents(call);
  app.post<{ Body: { rootId: unknown; observedIds?: unknown } }>(
    "/api/session/subagents/snapshot",
    async (request) => {
      const root = id(request.body?.rootId),
        observed = request.body.observedIds ?? [];
      if (!Array.isArray(observed) || observed.length > 200)
        throw Object.assign(new Error("子任务补查范围过大"), {
          statusCode: 400,
        });
      return service.discover(root, observed.map(id));
    },
  );
  app.post<{ Body: { rootId: unknown; threadId: unknown } }>(
    "/api/session/subagents/verify",
    async (request) => {
      const threads: import("@agent-orchestrator/shared").SubagentThread[] = [];
      const thread = await service.verify(
        id(request.body?.rootId),
        id(request.body?.threadId),
        (node) => threads.push(node),
      );
      return { thread, threads };
    },
  );
  app.post<{ Body: { rootId: unknown; targets: unknown } }>(
    "/api/session/subagents/stop",
    async (request) => {
      const root = id(request.body?.rootId),
        targets = request.body.targets;
      if (
        !Array.isArray(targets) ||
        targets.length > 200 ||
        targets.length === 0
      )
        throw Object.assign(new Error("无效的停止范围"), { statusCode: 400 });
      const seen = new Set<string>();
      const validated: SubagentStopTarget[] = targets.map((t) => {
        const target = { threadId: id(t?.threadId), turnId: id(t?.turnId) };
        if (seen.has(target.threadId))
          throw Object.assign(new Error("停止范围包含重复线程"), {
            statusCode: 400,
          });
        seen.add(target.threadId);
        return target;
      });
      return { results: await service.stop(root, validated, options.stop) };
    },
  );
  app.post<{ Body: { rootId: unknown } }>(
    "/api/session/subagents/roles",
    async (request) => {
      const { cwd } = await service.metadata(id(request.body?.rootId));
      // The client supplies only a thread identity, never a config path or arbitrary cwd.
      try {
        return await call("agents/roles", { cwd: cwd ?? null });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
        const effective = await call("config/read", {
          cwd: cwd ?? null,
          includeLayers: false,
        });
        // Compatibility uses the same native effective config, reduced on the
        // gateway before returning anything to the browser.
        const entries = effective?.config?.agents;
        return {
          roles:
            entries && typeof entries === "object"
              ? Object.entries(entries).flatMap(([name, value]) => {
                  if (
                    !/^[-a-zA-Z0-9_:]{1,160}$/.test(name) ||
                    !value ||
                    typeof value !== "object"
                  )
                    return [];
                  const description = (value as { description?: unknown })
                    .description;
                  return [
                    {
                      name,
                      description:
                        typeof description === "string" ? description : "",
                    },
                  ];
                })
              : [],
        };
      }
    },
  );
}
