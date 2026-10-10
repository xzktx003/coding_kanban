import { realpath } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  CodexCloudTaskRequest,
  CodexHostOwner,
} from "@agent-orchestrator/shared";
import { CodexCloudService } from "../services/codex-cloud.js";
import {
  parseCodexHostOwner,
  validateCodexHostBrowserSource,
} from "./session-codex-host.js";
import type { CodexPriorConversation } from "../services/codex-cloud-history.js";
const invalid = (message = "无效的云任务请求", statusCode = 400): never => {
  throw Object.assign(new Error(message), { statusCode });
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))
    invalid();
  return value as string;
}
export function registerCodexCloudRoutes(
  app: FastifyInstance,
  options: {
    dataHome: string;
    resolveOwner: (owner: CodexHostOwner) => Promise<string>;
    priorConversation?: (
      request: CodexCloudTaskRequest,
    ) => Promise<CodexPriorConversation>;
    authFile?: string;
    apiOrigin?: string;
    fetch?: typeof fetch;
    service?: CodexCloudService;
  },
) {
  const service = options.service ?? new CodexCloudService(options);
  const capture = async (request: FastifyRequest) => {
    validateCodexHostBrowserSource(request);
    const b = object(request.body),
      owner = parseCodexHostOwner(b.owner);
    const cwd = await realpath(await options.resolveOwner(owner));
    if (cwd !== (await realpath(owner.cwd)))
      invalid("云任务请求与原会话项目不一致", 409);
    return { b, owner: { ...owner, cwd } };
  };
  app.get("/api/session/codex-cloud/capability", async (request) => {
    validateCodexHostBrowserSource(request);
    return service.capability();
  });
  for (const [name, action] of [
    ["environments", (identity: string) => service.environments(identity)],
    ["tasks", (identity: string) => service.tasks(identity)],
  ] as const)
    app.post("/api/session/codex-cloud/" + name, async (request) => {
      const { b } = await capture(request);
      return action(id(b.identity));
    });
  app.post("/api/session/codex-cloud/prepare", async (request) => {
    const { owner } = await capture(request);
    return service.prepare(owner.cwd);
  });
  app.post("/api/session/codex-cloud/upload", async (request) => {
    const { b, owner } = await capture(request);
    return service.upload(id(b.snapshotId), owner.cwd, id(b.identity));
  });
  app.post(
    "/api/session/codex-cloud/create",
    { bodyLimit: 1024 * 1024 },
    async (request) => {
      const { b, owner } = await capture(request);
      if (
        typeof b.prompt !== "string" ||
        !b.prompt.trim() ||
        b.prompt.length > 800_000 ||
        b.prompt.includes("\0")
      )
        invalid();
      if (
        b.localDelegation !== undefined &&
        typeof b.localDelegation !== "boolean"
      )
        invalid();
      if (
        b.modelSlug !== undefined &&
        (typeof b.modelSlug !== "string" ||
          !/^[a-zA-Z0-9_.-]{1,160}$/.test(b.modelSlug))
      )
        invalid();
      const captured: CodexCloudTaskRequest = {
        owner,
        requestId: id(b.requestId),
        identity: id(b.identity),
        prompt: b.prompt as string,
        ...(b.environmentId === undefined
          ? {}
          : { environmentId: id(b.environmentId) }),
        ...(b.snapshotId === undefined ? {} : { snapshotId: id(b.snapshotId) }),
        ...(b.taskId === undefined ? {} : { taskId: id(b.taskId) }),
        ...(b.turnId === undefined ? {} : { turnId: id(b.turnId) }),
        ...(b.modelSlug === undefined
          ? {}
          : { modelSlug: b.modelSlug as string }),
        ...(b.localDelegation === true ? { localDelegation: true } : {}),
      };
      if (captured.environmentId && captured.snapshotId)
        invalid("环境与工作区快照只能选择一个");
      return service.create(captured);
    },
  );
  app.post("/api/session/codex-cloud/result", async (request) => {
    const { b } = await capture(request);
    const taskId = id(b.taskId),
      identity = id(b.identity);
    return {
      task: await service.task(taskId, identity),
      turns: await service.turns(taskId, identity),
      ...(b.turnId === undefined
        ? {}
        : { logs: await service.logs(taskId, id(b.turnId), identity) }),
    };
  });
  return service;
}
