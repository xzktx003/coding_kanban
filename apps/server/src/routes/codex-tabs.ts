import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  applyCodexTabAction,
  type CodexFollowedThread,
  type CodexTabsRequest,
  type SharedCodexTabs,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "../services/durable-json.js";

type StoredTabs = SharedCodexTabs & { clients: Record<string, number> };
const MAX_TABS = 500;
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalid(message = "无效的 Codex 关注同步请求", statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function thread(value: unknown): asserts value is CodexFollowedThread {
  const row = object(value);
  keys(row, ["id", "cwd", "title"]);
  if (typeof row.id !== "string" || !THREAD_ID.test(row.id)) invalid();
  if (
    typeof row.cwd !== "string" || !row.cwd.startsWith("/") || row.cwd.length > 4096 ||
    row.cwd.trim() !== row.cwd || /[\\\x00-\x1f\x7f]/.test(row.cwd)
  ) invalid("Codex 关注项目必须是服务器上的绝对路径");
  if (typeof row.title !== "string" || row.title.length === 0 || row.title.length > 160 || /[\x00-\x1f\x7f]/.test(row.title))
    invalid();
}
function request(value: unknown): CodexTabsRequest {
  const input = object(value);
  keys(input, ["clientId", "operations", "seed"]);
  if (typeof input.clientId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.clientId)) invalid();
  if (!Array.isArray(input.operations) || input.operations.length > 100) invalid();
  if (input.seed !== undefined) {
    if (!Array.isArray(input.seed) || input.seed.length > MAX_TABS) invalid();
    input.seed.forEach(thread);
  }
  for (const raw of input.operations) {
    const operation = object(raw);
    keys(operation, ["seq", "action"]);
    if (!Number.isSafeInteger(operation.seq) || Number(operation.seq) < 1) invalid();
    const action = object(operation.action);
    if (action.type === "add" || action.type === "update") {
      keys(action, ["type", "thread"]);
      thread(action.thread);
    } else if (action.type === "remove" || action.type === "move") {
      keys(action, action.type === "move" ? ["type", "id", "beforeId"] : ["type", "id"]);
      if (typeof action.id !== "string" || !THREAD_ID.test(action.id)) invalid();
      if (action.type === "move" && action.beforeId !== null &&
        (typeof action.beforeId !== "string" || !THREAD_ID.test(action.beforeId))) invalid();
    } else invalid();
  }
  return input as unknown as CodexTabsRequest;
}

export function registerCodexTabsRoutes(app: FastifyInstance, { file }: { file?: string }) {
  let state: StoredTabs | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function load(): Promise<StoredTabs> {
    if (!file) invalid("Codex 关注存储不可用", 503);
    if (state) return state;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as StoredTabs;
      if (
        parsed.initialized !== true || !Number.isSafeInteger(parsed.revision) ||
        !Array.isArray(parsed.threads) || !parsed.clients || typeof parsed.clients !== "object"
      ) throw new Error("Invalid Codex tabs file");
      parsed.threads.forEach(thread);
      state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { initialized: false, revision: 0, threads: [], clients: {} };
    }
    return state;
  }
  const publicState = (stored: StoredTabs): SharedCodexTabs => ({
    initialized: stored.initialized, revision: stored.revision, threads: stored.threads,
  });
  app.get("/api/native-codex/tabs", async (_, reply) => {
    reply.header("cache-control", "no-store");
    return serialize(async () => publicState(await load()));
  });
  app.post("/api/native-codex/tabs", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const input = request(req.body);
    reply.header("cache-control", "no-store");
    return serialize(async () => {
      const previous = await load();
      const next: StoredTabs = { ...previous, threads: [...previous.threads], clients: { ...previous.clients } };
      if (!next.initialized) {
        const unique = new Map((input.seed ?? []).map((item) => [item.id, item]));
        next.threads = [...unique.values()];
        next.initialized = true;
      }
      let sequence = Object.hasOwn(next.clients, input.clientId) ? next.clients[input.clientId] : 0;
      for (const operation of input.operations) {
        if (operation.seq <= sequence) continue;
        if (operation.seq !== sequence + 1) invalid("Codex 关注同步操作序号不连续", 409);
        next.threads = applyCodexTabAction(next.threads, operation.action);
        if (next.threads.length > MAX_TABS) invalid("Codex 关注会话最多支持 500 个", 409);
        sequence = operation.seq;
      }
      Object.defineProperty(next.clients, input.clientId, {
        value: sequence, enumerable: true, configurable: true, writable: true,
      });
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        next.revision++;
        await writeDurableJson(file!, next);
        state = next;
      }
      return { ...publicState(state!), sequence };
    });
  });
}
