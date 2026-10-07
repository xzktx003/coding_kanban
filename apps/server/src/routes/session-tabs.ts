import { readFile } from "node:fs/promises";
import { writeDurableJson } from "../services/durable-json.js";
import type { FastifyInstance } from "fastify";
import {
  applySessionTabAction,
  followedSessionKey,
  type FollowedSession,
  type SharedSessionTabs,
  type SessionTabsRequest,
} from "@agent-orchestrator/shared";

type StoredTabs = SharedSessionTabs & { clients: Record<string, number> };
const MAX_TABS = 500;
function invalid(message = "无效的关注会话同步请求", statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function text(value: unknown, limit = 2048): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !/[\x00-\x1f]/.test(value)
  );
}
function card(value: unknown): asserts value is FollowedSession {
  const c = object(value);
  keys(c, ["kind", "id", "preview", "cwd", "worktreePath"]);
  if (!["codex", "cc"].includes(String(c.kind)) || !text(c.id, 512)) invalid();
  // Preview is display text and may contain line breaks; paths are metadata, never executed here.
  if (
    c.preview !== undefined &&
    (typeof c.preview !== "string" || c.preview.length > 8192)
  )
    invalid();
  if (c.cwd !== undefined && c.cwd !== null && !text(c.cwd)) invalid();
  if (c.worktreePath !== undefined && !text(c.worktreePath)) invalid();
}
function request(value: unknown): SessionTabsRequest {
  const r = object(value);
  keys(r, ["clientId", "operations", "seed"]);
  if (
    typeof r.clientId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(r.clientId)
  )
    invalid();
  if (!Array.isArray(r.operations) || r.operations.length > 100) invalid();
  if (r.seed !== undefined) {
    if (!Array.isArray(r.seed) || r.seed.length > MAX_TABS) invalid();
    r.seed.forEach(card);
  }
  for (const raw of r.operations) {
    const op = object(raw);
    keys(op, ["seq", "action"]);
    if (!Number.isSafeInteger(op.seq) || Number(op.seq) < 1) invalid();
    const a = object(op.action);
    if (a.type === "add" || a.type === "update") {
      keys(a, ["type", "card"]);
      card(a.card);
    } else if (a.type === "remove" || a.type === "move") {
      keys(
        a,
        a.type === "move" ? ["type", "key", "beforeKey"] : ["type", "key"],
      );
      if (!text(a.key, 520) || !/^(codex|cc):./.test(a.key)) invalid();
      if (
        a.type === "move" &&
        a.beforeKey !== null &&
        (!text(a.beforeKey, 520) || !/^(codex|cc):./.test(a.beforeKey))
      )
        invalid();
    } else invalid();
  }
  return r as unknown as SessionTabsRequest;
}

export function registerSessionTabsRoutes(
  app: FastifyInstance,
  { file }: { file?: string },
) {
  let state: StoredTabs | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function load(): Promise<StoredTabs> {
    if (!file) invalid("关注会话存储不可用", 503);
    if (state) return state;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as StoredTabs;
      if (
        parsed.initialized !== true ||
        !Number.isSafeInteger(parsed.revision) ||
        !Array.isArray(parsed.cards) ||
        !parsed.clients ||
        typeof parsed.clients !== "object"
      )
        throw new Error("Invalid shared tabs file");
      parsed.cards.forEach(card);
      state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { initialized: false, revision: 0, cards: [], clients: {} };
    }
    return state;
  }
  const publicState = (s: StoredTabs): SharedSessionTabs => ({
    initialized: s.initialized,
    revision: s.revision,
    cards: s.cards,
  });
  app.get("/api/session/tabs", async (_, reply) => {
    reply.header("cache-control", "no-store");
    return serialize(async () => publicState(await load()));
  });
  app.post(
    "/api/session/tabs",
    { bodyLimit: 1024 * 1024 },
    async (req, reply) => {
      const input = request(req.body);
      reply.header("cache-control", "no-store");
      return serialize(async () => {
        const previous = await load();
        const next: StoredTabs = {
          ...previous,
          cards: [...previous.cards],
          clients: { ...previous.clients },
        };
        if (!next.initialized) {
          const unique = new Map(
            (input.seed ?? []).map((c) => [followedSessionKey(c), c]),
          );
          next.cards = [...unique.values()];
          next.initialized = true;
        }
        let sequence = Object.hasOwn(next.clients, input.clientId)
          ? next.clients[input.clientId]
          : 0;
        for (const op of input.operations) {
          if (op.seq <= sequence) continue; // a lost response/retry must not replay an old add or move
          if (op.seq !== sequence + 1) invalid("关注同步操作序号不连续", 409);
          next.cards = applySessionTabAction(next.cards, op.action);
          if (next.cards.length > MAX_TABS)
            invalid("关注会话最多支持 500 个", 409);
          sequence = op.seq;
        }
        // Defend against object prototype names; client IDs are data, never paths.
        Object.defineProperty(next.clients, input.clientId, {
          value: sequence,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          next.revision++;
          await writeDurableJson(file!, next);
          state = next; // publish only after durable write succeeds
        }
        return { ...publicState(state!), sequence };
      });
    },
  );
}
