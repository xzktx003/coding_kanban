import { readFile } from "node:fs/promises";
import { writeDurableJson } from "../services/durable-json.js";
import type { FastifyInstance } from "fastify";

const MAX_GROUPS = 200;
const MAX_ASSIGNMENTS = 2000;
const MAX_COLLAPSED = 500;

export interface StoredSessionGroup {
  id: string;
  name: string;
}

export interface StoredSessionGroups {
  groups: StoredSessionGroup[];
  assignments: Record<string, string>;
  collapsedGroupIds: string[];
}

type GroupAction =
  | { type: "add"; group: StoredSessionGroup; sessionKeys?: string[] }
  | { type: "rename"; groupId: string; name: string }
  | { type: "remove"; groupId: string }
  | { type: "assign"; sessionKeys: string[]; groupId: string | null }
  | { type: "setCollapsed"; key: string; collapsed: boolean };
type OperationRequest = {
  clientId: string;
  operations: { seq: number; action: GroupAction }[];
  seed?: StoredSessionGroups;
};
type StoredState = StoredSessionGroups & {
  initialized: boolean;
  revision: number;
  clients: Record<string, number>;
  protocol: 1 | 2;
};

const EMPTY_STATE: StoredSessionGroups = {
  groups: [],
  assignments: {},
  collapsedGroupIds: [],
};

function invalid(message = "无效的分组同步请求", statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

function text(value: unknown, limit = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !/[\x00-\x1f]/.test(value)
  );
}

function groupId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function group(value: unknown): asserts value is StoredSessionGroup {
  const g = object(value);
  keys(g, ["id", "name"]);
  if (!groupId(g.id) || g.id === "__ungrouped__" || !text(g.name) || !g.name.trim()) invalid();
}

function normalizeState(value: unknown): StoredSessionGroups {
  if (!value || typeof value !== "object") return EMPTY_STATE;
  const candidate = value as Partial<StoredSessionGroups>;
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups.filter((item): item is StoredSessionGroup => {
        try {
          group(item);
          return true;
        } catch {
          return false;
        }
      })
    : [];
  if (groups.length > MAX_GROUPS) invalid("分组数量超出上限", 409);
  const knownGroupIds = new Set(groups.map((item) => item.id));
  const assignments =
    candidate.assignments && typeof candidate.assignments === "object"
      ? Object.fromEntries(
          Object.entries(candidate.assignments).filter(
            ([sessionKey, assignedGroupId]) =>
              Boolean(sessionKey) &&
              sessionKey.length <= 512 &&
              typeof assignedGroupId === "string" &&
              knownGroupIds.has(assignedGroupId),
          ),
        )
      : {};
  if (Object.keys(assignments).length > MAX_ASSIGNMENTS)
    invalid("会话分组数量超出上限", 409);
  const collapsedGroupIds = Array.isArray(candidate.collapsedGroupIds)
    ? [
        ...new Set(
          candidate.collapsedGroupIds.filter(
            (item): item is string =>
              typeof item === "string" &&
              item.length <= 256 &&
              (knownGroupIds.has(item) ||
                item === "__ungrouped__" ||
                [...knownGroupIds, "__ungrouped__"].some((known) =>
                  item.endsWith(`:${known}`),
                )),
          ),
        ),
      ]
    : [];
  if (collapsedGroupIds.length > MAX_COLLAPSED)
    invalid("折叠分组数量超出上限", 409);
  return { groups, assignments, collapsedGroupIds };
}

function request(value: unknown): StoredSessionGroups {
  const r = object(value);
  keys(r, ["groups", "assignments", "collapsedGroupIds"]);
  // Reject malformed payloads instead of normalizing them into a grouping wipe.
  if (!Array.isArray(r.groups)) invalid();
  r.groups.forEach(group);
  if (r.assignments !== undefined) object(r.assignments);
  if (r.collapsedGroupIds !== undefined && !Array.isArray(r.collapsedGroupIds))
    invalid();
  return normalizeState(r);
}

function operationRequest(value: unknown): OperationRequest {
  const r = object(value);
  keys(r, ["clientId", "operations", "seed"]);
  if (typeof r.clientId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.clientId)) invalid();
  if (!Array.isArray(r.operations) || r.operations.length > 100) invalid();
  if (r.seed !== undefined) request(r.seed);
  for (const raw of r.operations) {
    const op = object(raw);
    keys(op, ["seq", "action"]);
    if (!Number.isSafeInteger(op.seq) || Number(op.seq) < 1) invalid();
    const a = object(op.action);
    switch (a.type) {
      case "add":
        keys(a, ["type", "group", "sessionKeys"]);
        group(a.group);
        if (a.sessionKeys !== undefined && (!Array.isArray(a.sessionKeys) || a.sessionKeys.length > 20 || !a.sessionKeys.every((key) => text(key, 512)))) invalid();
        break;
      case "rename":
        keys(a, ["type", "groupId", "name"]);
        if (!groupId(a.groupId) || !text(a.name) || !a.name.trim()) invalid();
        break;
      case "remove":
        keys(a, ["type", "groupId"]);
        if (!groupId(a.groupId)) invalid();
        break;
      case "assign":
        keys(a, ["type", "sessionKeys", "groupId"]);
        if (!Array.isArray(a.sessionKeys) || a.sessionKeys.length < 1 || a.sessionKeys.length > 20 || !a.sessionKeys.every((key) => text(key, 512)) || (a.groupId !== null && !groupId(a.groupId))) invalid();
        break;
      case "setCollapsed":
        keys(a, ["type", "key", "collapsed"]);
        if (!text(a.key, 256) || typeof a.collapsed !== "boolean") invalid();
        break;
      default:
        invalid();
    }
  }
  return r as OperationRequest;
}

function applyAction(state: StoredSessionGroups, action: GroupAction): StoredSessionGroups {
  const groups = [...state.groups];
  const assignments = { ...state.assignments };
  let collapsedGroupIds = [...state.collapsedGroupIds];
  if (action.type === "add") {
    if (!groups.some((g) => g.id === action.group.id || g.name.localeCompare(action.group.name.trim(), undefined, { sensitivity: "accent" }) === 0))
      groups.push({ ...action.group, name: action.group.name.trim() });
    if (groups.some((g) => g.id === action.group.id))
      for (const key of action.sessionKeys ?? []) Object.defineProperty(assignments, key, { value: action.group.id, enumerable: true, configurable: true, writable: true });
  } else if (action.type === "rename") {
    if (!groups.some((g) => g.id !== action.groupId && g.name.localeCompare(action.name.trim(), undefined, { sensitivity: "accent" }) === 0)) {
      const index = groups.findIndex((g) => g.id === action.groupId);
      if (index >= 0) groups[index] = { ...groups[index], name: action.name.trim() };
    }
  } else if (action.type === "remove") {
    const index = groups.findIndex((g) => g.id === action.groupId);
    if (index >= 0) groups.splice(index, 1);
    for (const [key, id] of Object.entries(assignments)) if (id === action.groupId) delete assignments[key];
    collapsedGroupIds = collapsedGroupIds.filter((key) => key !== action.groupId && !key.endsWith(`:${action.groupId}`));
  } else if (action.type === "assign") {
    if (action.groupId === null || groups.some((g) => g.id === action.groupId)) {
      for (const key of action.sessionKeys) {
        if (action.groupId === null) delete assignments[key];
        else Object.defineProperty(assignments, key, { value: action.groupId, enumerable: true, configurable: true, writable: true });
      }
    }
  } else {
    collapsedGroupIds = collapsedGroupIds.filter((key) => key !== action.key);
    if (action.collapsed) collapsedGroupIds.push(action.key);
  }
  return normalizeState({ groups, assignments, collapsedGroupIds });
}

export function registerSessionGroupsRoutes(
  app: FastifyInstance,
  { file }: { file?: string },
) {
  let state: StoredState | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  async function load(): Promise<StoredState> {
    if (!file) invalid("分组存储不可用", 503);
    if (state) return state;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      const data = object(parsed);
      const normalized = normalizeState(data);
      if (data.initialized !== undefined && (typeof data.initialized !== "boolean" || !Number.isSafeInteger(data.revision) || !data.clients || typeof data.clients !== "object" || Array.isArray(data.clients))) throw new Error("Invalid shared groups file");
      const clients = data.initialized === undefined ? {} : data.clients as Record<string, number>;
      if (Object.values(clients).some((seq) => !Number.isSafeInteger(seq) || seq < 0) || (data.protocol !== undefined && data.protocol !== 1 && data.protocol !== 2)) throw new Error("Invalid shared groups file");
      state = { ...normalized, initialized: data.initialized === undefined ? true : data.initialized as boolean, revision: data.initialized === undefined ? 0 : data.revision as number, clients, protocol: data.protocol === 2 ? 2 : 1 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { ...EMPTY_STATE, initialized: false, revision: 0, clients: {}, protocol: 1 };
    }
    return state;
  }
  const publicState = (s: StoredState) => ({ initialized: s.initialized, revision: s.revision, groups: s.groups, assignments: s.assignments, collapsedGroupIds: s.collapsedGroupIds });
  app.get("/api/session-groups", async (_, reply) => {
    reply.header("cache-control", "no-store");
    return serialize(async () => publicState(await load()));
  });
  app.post(
    "/api/session-groups",
    { bodyLimit: 1024 * 1024 },
    async (req, reply) => {
      const body = object(req.body);
      const isOperations = Object.hasOwn(body, "operations");
      const input = isOperations ? operationRequest(body) : request(body);
      reply.header("cache-control", "no-store");
      return serialize(async () => {
        const previous = await load();
        if (isOperations) {
          const ops = input as OperationRequest;
          const next: StoredState = { ...previous, clients: { ...previous.clients }, protocol: 2 };
          if (!next.initialized) {
            Object.assign(next, normalizeState(ops.seed));
            next.initialized = true;
          }
          let sequence = Object.hasOwn(next.clients, ops.clientId) ? next.clients[ops.clientId] : 0;
          for (const op of ops.operations) {
            if (op.seq <= sequence) continue;
            if (op.seq !== sequence + 1) invalid("分组同步操作序号不连续", 409);
            Object.assign(next, applyAction(next, op.action));
            sequence = op.seq;
          }
          Object.defineProperty(next.clients, ops.clientId, { value: sequence, enumerable: true, configurable: true, writable: true });
          if (JSON.stringify(next) !== JSON.stringify(previous)) {
            next.revision++;
            await writeDurableJson(file!, next);
            state = next;
          }
          return { ...publicState(state!), sequence };
        }
        if (previous.protocol === 2) invalid("分组同步版本已更新，请刷新界面", 409);
        const next: StoredState = { ...previous, ...normalizeState(input), initialized: true, revision: previous.revision + 1 };
        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          await writeDurableJson(file!, next);
          state = next; // publish only after durable write succeeds
        }
        return publicState(state!);
      });
    },
  );
}
