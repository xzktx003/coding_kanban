import { setTimeout as sleep } from "node:timers/promises";
import { HistoryBudget, type HistoryBudgetLimits } from "../core/history-budget.js";
import { sanitizeCodexHistory } from "./projection.js";
import { KeyedSerial } from "../core/serial.js";
import { isObject, object, type Json, type JsonObject } from "../core/json.js";

export type Rpc = (method: string, params: Json) => Promise<Json>;
type AccessState = "readonly" | "acquiring" | "owned" | "releasing" | "external" | "unknown";
interface Entry {
  state: AccessState; reason: string; generation: number;
  uncertain: boolean; awaitingFirstTurn: boolean; releasingSince?: number;
}
const mutations = new Set(["turn/start", "turn/steer", "turn/interrupt", "review/start", "thread/resume",
  "thread/rollback", "thread/revert", "thread/compact/start", "thread/goal/set", "thread/goal/clear",
  "thread/settings/update", "thread/name/set", "thread/archive", "thread/delete", "thread/shellCommand",
  "thread/inject_items", "thread/metadata/update", "thread/memoryMode/set"]);
const directInput = new Set(["turn/start", "turn/steer", "review/start", "thread/rollback", "thread/revert",
  "thread/goal/set", "thread/goal/clear", "thread/settings/update"]);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const writerConflict = (error: unknown) => /active writer|already being used|writer lock/i.test(message(error));

export function parentThread(thread: JsonObject): string | undefined {
  if (typeof thread.parentThreadId === "string") return thread.parentThreadId;
  const source = object(thread.source);
  for (const agent of [object(source.subAgent), object(source.subagent)]) {
    const parent = object(agent.thread_spawn).parent_thread_id ?? object(agent.threadSpawn).parentThreadId;
    if (typeof parent === "string") return parent;
  }
  return;
}

export async function loadedIds(raw: Rpc): Promise<Set<string>> {
  const ids = new Set<string>(), seen = new Set<string>();
  let cursor: Json = null;
  while (true) {
    const page = object(await raw("thread/loaded/list", { cursor, limit: 100 }));
    if (!Array.isArray(page.data) || page.data.some(id => typeof id !== "string")) throw new Error("Invalid loaded/list data");
    for (const id of page.data) ids.add(id as string);
    cursor = page.nextCursor;
    if (cursor === null) return ids;
    if (typeof cursor !== "string") throw new Error("Invalid loaded/list cursor");
    if (seen.has(cursor)) throw new Error("Repeated loaded/list cursor");
    seen.add(cursor);
  }
}

export class Ownership {
  private entries = new Map<string, Entry>();
  private locks = new KeyedSerial();
  private revision = 0;
  private queueSequence = 0n;
  private queue?: { when: number; busy: boolean; ids: Set<string> };
  private pending = new Map<string, string>();
  private now: () => number;
  private pause: (milliseconds: number) => Promise<void>;
  private releaseTimeout: number;

  constructor(private readonly raw: Rpc, options: { now?: () => number; pause?: (milliseconds: number) => Promise<void>; releaseTimeoutMs?: number } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.pause = options.pause ?? sleep;
    this.releaseTimeout = options.releaseTimeoutMs ?? 8000;
  }

  private entry(id: string): Entry {
    let value = this.entries.get(id);
    if (!value) { value = { state: "readonly", reason: "", generation: 0, uncertain: false, awaitingFirstTurn: false }; this.entries.set(id, value); }
    return value;
  }
  private snapshot(entry: Entry): JsonObject { return { state: entry.state, reason: entry.reason, generation: entry.generation }; }
  ids(): string[] { return [...this.entries.keys()]; }
  access(id: string): Promise<JsonObject> { return this.locks.run(id, async () => this.snapshot(this.entry(id))); }

  queueUpdate(sequence: bigint, busy: boolean, ids: string[]): boolean {
    if (sequence <= this.queueSequence) return false;
    this.queueSequence = sequence; this.revision++;
    this.queue = { when: this.now(), busy, ids: new Set(ids) };
    return true;
  }
  pendingRequest(id: string | number, thread: string): void { this.revision++; this.pending.set(JSON.stringify(id), thread); }
  resolveRequest(id: string | number): void { this.revision++; this.pending.delete(JSON.stringify(id)); }
  observe(method: string, params: Json): void {
    const body = object(params);
    if (method === "serverRequest/resolved" && (typeof body.requestId === "string" || Number.isSafeInteger(body.requestId)))
      this.resolveRequest(body.requestId as string | number);
    if (body.threadId !== undefined || body.thread !== undefined) this.revision++;
  }
  invalidate(): void {
    this.revision++; this.pending.clear(); this.queue = undefined;
    for (const entry of this.entries.values()) { entry.state = "unknown"; entry.reason = "运行连接已断开，执行状态待确认"; entry.uncertain = true; }
  }
  private hold(id: string): string | undefined {
    if (!this.queue || this.now() - this.queue.when >= 10_000) return "等待网关确认队列状态";
    if (this.queue.busy || this.queue.ids.has(id)) return "队列正在执行或有待确认的发送";
    if ([...this.pending.values()].includes(id)) return "等待审批或回答";
    return;
  }

  async call(method: string, params: Json): Promise<Json> {
    const id = typeof object(params).threadId === "string" ? object(params).threadId as string : undefined;
    if (method === "thread/unsubscribe") {
      if (!id) throw new Error("threadId required");
      return this.release(id);
    }
    if (!mutations.has(method) || id === undefined) {
      const result = await this.raw(method, params);
      const created = object(object(result).thread).id;
      if (["thread/start", "thread/fork"].includes(method) && typeof created === "string") {
        await this.locks.run(created, async () => {
          const entry = this.entry(created); entry.state = "owned"; entry.awaitingFirstTurn = method === "thread/start";
        });
      }
      return result;
    }
    if (directInput.has(method)) {
      let metadata: Json;
      try { metadata = await this.raw("thread/read", { threadId: id, includeTurns: false }); }
      catch (error) { throw new Error(`SESSION_ACQUIRE_FAILED: 尚未发送，无法确认输入权限：${message(error)}`); }
      const thread = object(object(metadata).thread);
      if (thread.id !== id) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，线程身份未确认");
      if (parentThread(thread) && thread.canAcceptDirectInput !== true)
        throw new Error("SUBAGENT_DIRECT_INPUT_DISABLED: 子线程由主 Agent 调度，消息尚未发送；请在主会话中跟进");
    }
    return this.locks.run(id, async () => {
      const entry = this.entry(id);
      if (entry.state === "releasing") {
        const until = this.now() + this.releaseTimeout;
        while (await this.isLoadedForAcquire(id)) {
          if (this.now() >= until) throw new Error("SESSION_RELEASE_PENDING: 会话仍在释放，请稍后重试；消息尚未发送");
          await this.pause(100);
        }
        entry.state = "readonly"; entry.releasingSince = undefined;
      }
      entry.generation++;
      if (method !== "thread/resume" && !await this.isLoadedForAcquire(id)) {
        entry.state = "acquiring";
        try {
          await this.raw("thread/resume", { threadId: id, config: { "features.default_mode_request_user_input": true } });
          entry.state = "owned"; entry.reason = "";
        } catch (error) {
          entry.state = writerConflict(error) ? "external" : "unknown";
          entry.reason = writerConflict(error) ? "其他客户端正在使用，可查看历史；释放后可重试原消息" : message(error);
          throw new Error(writerConflict(error) ? `SESSION_OWNED_ELSEWHERE: ${entry.reason}` : `SESSION_ACQUIRE_FAILED: 尚未发送，恢复执行实例失败：${message(error)}`);
        }
      }
      try {
        const result = await this.raw(method, params);
        entry.state = "owned"; entry.reason = "";
        if (method === "turn/start" || method === "review/start") entry.uncertain = false;
        if (method === "turn/start") entry.awaitingFirstTurn = false;
        const review = object(result).reviewThreadId;
        if (method === "review/start" && typeof review === "string" && review !== id) this.entry(review).state = "owned";
        return result;
      } catch (error) {
        if (writerConflict(error)) { entry.state = "external"; entry.reason = "其他客户端正在使用，可查看历史"; throw new Error(`SESSION_OWNED_ELSEWHERE: ${entry.reason}`); }
        if (message(error).startsWith("DELIVERY_UNKNOWN")) { entry.uncertain = true; entry.state = "unknown"; entry.reason = "操作回执丢失，保留执行实例等待核对"; }
        throw error;
      }
    });
  }

  private async isLoadedForAcquire(id: string): Promise<boolean> {
    try { return (await loadedIds(this.raw)).has(id); }
    catch (error) { throw new Error(`SESSION_ACQUIRE_FAILED: 尚未发送，无法确认执行实例：${message(error)}`); }
  }

  release(id: string): Promise<JsonObject> {
    return this.locks.run(id, async () => {
      const entry = this.entry(id);
      await this.tryRelease(id, entry);
      return this.snapshot(entry);
    });
  }
  async sweep(id: string): Promise<void> {
    if (this.locks.busy(id)) return;
    await this.locks.run(id, async () => {
      const entry = this.entry(id);
      if (!["readonly", "external"].includes(entry.state)) await this.tryRelease(id, entry);
    });
  }
  private async tryRelease(id: string, entry: Entry): Promise<void> {
    try { await this.releaseLocked(id, entry); }
    catch (error) { if (entry.state !== "releasing") entry.state = "unknown"; entry.reason = `资源状态尚未确认，保留执行实例：${message(error)}`; }
  }
  private async releaseLocked(id: string, entry: Entry): Promise<void> {
    const loaded = await loadedIds(this.raw);
    if (!loaded.has(id)) { entry.state = "readonly"; entry.reason = ""; entry.releasingSince = undefined; return; }
    if (entry.state === "releasing") {
      if (entry.releasingSince !== undefined && this.now() - entry.releasingSince > this.releaseTimeout) entry.reason = "原生服务尚未确认卸载，仍等待释放";
      return;
    }
    entry.state = "owned";
    if (entry.awaitingFirstTurn) { entry.reason = "新会话尚未接受首条消息，保留执行实例"; return; }
    if (entry.uncertain) { entry.reason = "操作送达结果待确认"; return; }
    const hold = this.hold(id); if (hold) { entry.reason = hold; return; }
    const revision = this.revision;
    const thread = object(object(await this.raw("thread/read", { threadId: id, includeTurns: false })).thread);
    if (thread.id !== id) throw new Error("线程身份未确认");
    if (!["idle", "systemError"].includes(String(object(thread.status).type))) { entry.reason = "任务仍在运行、重试或等待交互"; return; }
    const terminals = object(await this.raw("thread/backgroundTerminals/list", { threadId: id }));
    if (!Array.isArray(terminals.data)) throw new Error("后台终端响应不完整");
    if (terminals.data.length || terminals.nextCursor !== null) { entry.reason = "会话仍有后台终端或状态未知，保留执行实例"; return; }
    const goal = object(await this.raw("thread/goal/get", { threadId: id })).goal;
    if (goal !== null && !["complete", "paused", "blocked", "budgetLimited"].includes(String(object(goal).status))) {
      entry.reason = "会话有活动目标或目标状态未知"; return;
    }
    const parents = new Map<string, string>();
    for (const child of loaded) if (child !== id) {
      const metadata = object(object(await this.raw("thread/read", { threadId: child, includeTurns: false })).thread);
      if (metadata.id !== child) throw new Error("子线程身份未确认");
      const parent = parentThread(metadata);
      if (parent) parents.set(child, parent);
      else if (object(metadata.source).subAgent !== undefined || object(metadata.source).subagent !== undefined) {
        entry.reason = "子 Agent 归属尚未确认，保留执行实例"; return;
      }
    }
    for (const child of parents.keys()) {
      const seen = new Set<string>(); let current = child;
      while (parents.has(current)) {
        const parent = parents.get(current)!;
        if (parent === id || seen.has(current)) { entry.reason = "仍有已加载的子 Agent，等待其退出后释放"; return; }
        seen.add(current); current = parent;
      }
    }
    if (this.revision !== revision || this.hold(id)) { entry.reason = "状态发生变化，重新检查释放条件"; return; }
    await this.raw("thread/unsubscribe", { threadId: id });
    entry.state = "releasing"; entry.reason = "等待原生服务关闭并释放写锁"; entry.releasingSince = this.now();
  }
}

/** Read-only history loading is deliberately outside execution ownership. */
export async function readHistory(raw: Rpc, id: string, limits: Partial<HistoryBudgetLimits> = {}): Promise<Json> {
  const budget = new HistoryBudget(limits);
  const result = object(await raw("thread/read", { threadId: id, includeTurns: false }));
  budget.add(result);
  const thread = object(result.thread);
  if (thread.historyMode !== "paginated") {
    budget.beginPage();
    const history = await raw("thread/read", { threadId: id, includeTurns: true });
    budget.add(history);
    return sanitizeCodexHistory(history);
  }
  const turns: Json[] = [], seen = new Set<string>(); let cursor: Json = null;
  while (true) {
    budget.beginPage();
    let page: JsonObject;
    try { page = object(await raw("thread/turns/list", { threadId: id, cursor, limit: 100, sortDirection: "asc", itemsView: "full" })); }
    catch (error) {
      if (!turns.length && cursor === null && message(error).includes("not materialized yet") && message(error).includes("before first user message")) {
        thread.turns = []; return result;
      }
      throw error;
    }
    budget.add(page);
    if (!Array.isArray(page.data)) throw new Error("turns/list response missing data");
    for (const turn of sanitizeCodexHistory(page.data)) turns.push(turn);
    cursor = page.nextCursor;
    if (cursor === null) break;
    if (typeof cursor !== "string") throw new Error("Invalid turns/list cursor");
    if (seen.has(cursor)) throw new Error("Repeated turns/list cursor");
    seen.add(cursor);
  }
  if (!isObject(result.thread)) throw new Error("Invalid thread response");
  result.thread.turns = turns;
  return sanitizeCodexHistory(result);
}
