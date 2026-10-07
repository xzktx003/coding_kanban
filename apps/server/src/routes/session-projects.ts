import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  applyProjectAction,
  type SharedProjects,
  type ProjectsRequest,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "../services/durable-json.js";

type StoredProjects = SharedProjects & { clients: Record<string, number> };
function fail(message = "无效的项目同步请求", statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((k) => !keys.includes(k))) fail();
}
function path(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4096 ||
    /[\\\x00-\x1f]/.test(value) ||
    value.trim() !== value
  )
    fail("项目路径必须是服务器上的绝对路径");
}
function request(value: unknown): ProjectsRequest {
  const input = object(value);
  only(input, ["clientId", "operations", "seed"]);
  if (
    typeof input.clientId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.clientId)
  )
    fail();
  if (!Array.isArray(input.operations) || input.operations.length > 100) fail();
  if (input.seed !== undefined) {
    if (!Array.isArray(input.seed) || input.seed.length > 500) fail();
    input.seed.forEach(path);
  }
  for (const raw of input.operations) {
    const op = object(raw);
    only(op, ["seq", "action"]);
    if (!Number.isSafeInteger(op.seq) || Number(op.seq) < 1) fail();
    const a = object(op.action);
    if (a.type !== "add" && a.type !== "remove" && a.type !== "move") fail();
    only(
      a,
      a.type === "move" ? ["type", "path", "beforePath"] : ["type", "path"],
    );
    path(a.path);
    if (a.type === "move" && a.beforePath !== null) path(a.beforePath);
  }
  return input as unknown as ProjectsRequest;
}
export function registerSessionProjectsRoutes(
  app: FastifyInstance,
  { file, legacyFile }: { file?: string; legacyFile?: string },
) {
  let state: StoredProjects | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function load(): Promise<StoredProjects> {
    if (!file) fail("项目记录存储不可用", 503);
    if (state) return state;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as StoredProjects;
      if (
        parsed.initialized !== true ||
        !Number.isSafeInteger(parsed.revision) ||
        !Array.isArray(parsed.projects) ||
        !parsed.clients ||
        typeof parsed.clients !== "object"
      )
        throw new Error("invalid records");
      parsed.projects.forEach(path);
      state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        fail("项目记录读取失败，原记录已保留", 503);
      let projects: string[] | undefined;
      if (legacyFile) {
        try {
          const legacy = JSON.parse(await readFile(legacyFile, "utf8"));
          if (legacy.workspace?.projects !== undefined) {
            if (!Array.isArray(legacy.workspace.projects))
              throw new Error("invalid legacy projects");
            legacy.workspace.projects.forEach(path);
            projects = [...new Set<string>(legacy.workspace.projects)];
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            fail("原项目配置读取失败，暂未迁移", 503);
        }
      }
      const initial: StoredProjects = {
        initialized: projects !== undefined,
        revision: projects === undefined ? 0 : 1,
        projects: projects ?? [],
        clients: {},
      };
      if (initial.initialized) await writeDurableJson(file, initial);
      state = initial;
    }
    return state;
  }
  const publicState = (s: StoredProjects): SharedProjects => ({
    initialized: s.initialized,
    revision: s.revision,
    projects: s.projects,
  });
  app.get("/api/session/projects", async (_, reply) => {
    reply.header("cache-control", "no-store");
    return serialize(async () => publicState(await load()));
  });
  app.post(
    "/api/session/projects",
    { bodyLimit: 1024 * 1024 },
    async (req, reply) => {
      const input = request(req.body);
      reply.header("cache-control", "no-store");
      return serialize(async () => {
        const previous = await load();
        const next: StoredProjects = {
          ...previous,
          projects: [...previous.projects],
          clients: { ...previous.clients },
        };
        if (!next.initialized) {
          next.projects = [...new Set(input.seed ?? [])];
          next.initialized = true;
        }
        let sequence = Object.hasOwn(next.clients, input.clientId)
          ? next.clients[input.clientId]
          : 0;
        for (const op of input.operations) {
          if (op.seq <= sequence) continue;
          if (op.seq !== sequence + 1) fail("项目同步操作序号不连续", 409);
          next.projects = applyProjectAction(next.projects, op.action);
          sequence = op.seq;
        }
        if (next.projects.length > 500) fail("项目记录最多支持 500 个", 409);
        Object.defineProperty(next.clients, input.clientId, {
          value: sequence,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          next.revision++;
          try {
            await writeDurableJson(file!, next);
          } catch {
            fail("项目记录保存失败，原记录已保留", 503);
          }
          state = next;
        }
        return { ...publicState(state!), sequence };
      });
    },
  );
  return { getProjects: () => serialize(async () => (await load()).projects) };
}
