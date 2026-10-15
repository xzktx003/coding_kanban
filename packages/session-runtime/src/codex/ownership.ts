import { setTimeout as sleep } from "node:timers/promises";
import { classifySubagentThread, subagentParent, type SubagentThread } from "@agent-orchestrator/shared";
import { HistoryBudget, type HistoryBudgetLimits } from "../core/history-budget.js";
import { sanitizeCodexHistory } from "./projection.js";
import { KeyedSerial } from "../core/serial.js";
import { isObject, object, type Json, type JsonObject } from "../core/json.js";

export type Rpc = (method: string, params: Json, options?: { beforeSend?: () => void }) => Promise<Json>;
type AccessState = "readonly" | "acquiring" | "owned" | "releasing" | "external" | "unknown";
interface Entry {
  state: AccessState; reason: string; generation: number;
  uncertain: boolean; awaitingFirstTurn: boolean; releasingSince?: number;
}
interface ReleaseCheckpoint { epoch: number; revision: number; generation: number; queueRevision: number; topologyRevision: number; }
interface Family { members: Set<string>; metadata: Map<string, JsonObject>; loaded: Set<string>; }
const mutations = new Set(["turn/start", "turn/steer", "turn/interrupt", "review/start", "thread/resume",
  "thread/rollback", "thread/revert", "thread/compact/start", "thread/goal/set", "thread/goal/clear",
  "thread/settings/update", "thread/name/set", "thread/archive", "thread/delete", "thread/shellCommand",
  "thread/inject_items", "thread/metadata/update", "thread/memoryMode/set"]);
const directInput = new Set(["turn/start", "turn/steer", "review/start", "thread/rollback", "thread/revert",
  "thread/goal/set", "thread/goal/clear", "thread/settings/update"]);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const writerConflict = (error: unknown) => /active writer|already being used|writer lock/i.test(message(error));

export function parentThread(thread: JsonObject): string | undefined {
  return subagentParent(thread as unknown as SubagentThread) ?? undefined;
}

const identity = (thread: JsonObject) => classifySubagentThread(thread as unknown as SubagentThread);

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
  private epoch = 0;
  private queueRevision = 0;
  private topologyRevision = 0;
  private threadRevisions = new Map<string, number>();
  private queueSequence = 0n;
  private queue?: { when: number; busy: boolean; ids: Set<string> };
  private pending = new Map<string, string>();
  private now: () => number;
  private pause: (milliseconds: number) => Promise<void>;
  private releaseTimeout: number;
  private releaseIdleDescendants: boolean;

  constructor(private readonly raw: Rpc, options: { now?: () => number; pause?: (milliseconds: number) => Promise<void>; releaseTimeoutMs?: number; releaseIdleDescendants?: boolean } = {}) {
    this.now = options.now ?? (() => performance.now());
    this.pause = options.pause ?? sleep;
    this.releaseTimeout = options.releaseTimeoutMs ?? 8000;
    // Production enables this only after the real initialize handshake matches
    // a native version whose parent-only subscription lifecycle was verified.
    this.releaseIdleDescendants = options.releaseIdleDescendants === true;
  }

  setIdleDescendantRelease(supported: boolean): void {
    if (this.releaseIdleDescendants === supported) return;
    this.releaseIdleDescendants = supported;
    this.topologyRevision++;
  }
  private touch(id: string): void { this.threadRevisions.set(id, ++this.revision); }

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
    this.queueSequence = sequence;
    if (busy !== this.queue?.busy) this.queueRevision++;
    const next = new Set(ids);
    for (const id of new Set([...(this.queue?.ids ?? []), ...next])) {
      if (this.queue?.ids.has(id) !== next.has(id)) this.touch(id);
      // A newly held thread can introduce an as-yet unobserved descendant.
      if (next.has(id) && !this.queue?.ids.has(id)) this.topologyRevision++;
    }
    this.queue = { when: this.now(), busy, ids: next };
    return true;
  }
  pendingRequest(id: string | number, thread: string): void {
    const previous = this.pending.get(JSON.stringify(id));
    if (previous) this.touch(previous);
    this.touch(thread); this.pending.set(JSON.stringify(id), thread);
    // The request may be the first observation of a native child. Its ancestry
    // must be re-read before releasing any in-flight root subscription.
    this.topologyRevision++;
  }
  resolveRequest(id: string | number): void {
    const key = JSON.stringify(id), thread = this.pending.get(key);
    if (thread) this.touch(thread);
    this.pending.delete(key);
  }
  observe(method: string, params: Json): void {
    const body = object(params);
    if (method === "serverRequest/resolved" && (typeof body.requestId === "string" || Number.isSafeInteger(body.requestId)))
      this.resolveRequest(body.requestId as string | number);
    const thread = object(body.thread);
    const id = typeof body.threadId === "string" ? body.threadId : typeof thread.id === "string" ? thread.id : undefined;
    if (id) this.touch(id);
    if (method === "thread/started") {
      const parent = parentThread(thread);
      if (parent) this.touch(parent);
      else if (identity(thread) !== "main") this.topologyRevision++;
    }
  }
  invalidate(): void {
    this.epoch++; this.revision++; this.pending.clear(); this.queue = undefined; this.threadRevisions.clear();
    this.releaseIdleDescendants = false;
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
          this.touch(created);
          const parent = parentThread(object(object(result).thread));
          if (parent) this.touch(parent);
        });
      }
      return result;
    }
    const inputEpoch = directInput.has(method) ? this.epoch : undefined;
    if (inputEpoch !== undefined) await this.inputMetadata(id, inputEpoch);
    return this.locks.run(id, async () => {
      if (inputEpoch !== undefined && this.epoch !== inputEpoch)
        throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
      const entry = this.entry(id);
      if (entry.state === "releasing") {
        const until = this.now() + this.releaseTimeout;
        while (await this.isLoadedForAcquire(id)) {
          if (this.now() >= until) throw new Error("SESSION_RELEASE_PENDING: 会话仍在释放，请稍后重试；消息尚未发送");
          await this.pause(100);
        }
        entry.state = "readonly"; entry.releasingSince = undefined;
      }
      const loaded = method === "thread/resume" || await this.isLoadedForAcquire(id);
      // A permission read before the keyed lock can be stale while waiting for
      // another operation or for native unload. Re-read metadata, not history,
      // after those waits and before acquiring or dispatching any direct input.
      const metadata = inputEpoch === undefined ? undefined : await this.inputMetadata(id, inputEpoch);
      entry.generation++;
      this.touch(id);
      if (metadata) { const parent = parentThread(metadata); if (parent) this.touch(parent); }
      if (!loaded) {
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
      if (inputEpoch !== undefined && this.epoch !== inputEpoch)
        throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
      try {
        const result = await this.raw(method, params);
        if (inputEpoch !== undefined && this.epoch !== inputEpoch)
          throw new Error("DELIVERY_UNKNOWN: 运行实例已改变，原操作回执已失效");
        entry.state = "owned"; entry.reason = "";
        if (method === "turn/start" || method === "review/start") entry.uncertain = false;
        if (method === "turn/start") entry.awaitingFirstTurn = false;
        const review = object(result).reviewThreadId;
        if (method === "review/start" && typeof review === "string" && review !== id) { this.entry(review).state = "owned"; this.touch(review); }
        return result;
      } catch (error) {
        if (writerConflict(error)) { entry.state = "external"; entry.reason = "其他客户端正在使用，可查看历史"; throw new Error(`SESSION_OWNED_ELSEWHERE: ${entry.reason}`); }
        if (message(error).startsWith("DELIVERY_UNKNOWN")) { entry.uncertain = true; entry.state = "unknown"; entry.reason = "操作回执丢失，保留执行实例等待核对"; }
        throw error;
      }
    });
  }

  private async inputMetadata(id: string, epoch: number): Promise<JsonObject> {
    if (this.epoch !== epoch) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
    let metadata: Json;
    try { metadata = await this.raw("thread/read", { threadId: id, includeTurns: false }); }
    catch (error) { throw new Error(`SESSION_ACQUIRE_FAILED: 尚未发送，无法确认输入权限：${message(error)}`); }
    if (this.epoch !== epoch) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
    const thread = object(object(metadata).thread);
    if (thread.id !== id) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，线程身份未确认");
    const kind = identity(thread);
    if (kind === "unknown") throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，线程来源身份尚未确认");
    if (kind === "child" && (!parentThread(thread) || thread.canAcceptDirectInput !== true))
      throw new Error("SUBAGENT_DIRECT_INPUT_DISABLED: 子线程由主 Agent 调度，消息尚未发送；请在主会话中跟进");
    return thread;
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
    // The checkpoint precedes even loaded/list: notifications can arrive while
    // that response is in flight, including the creation of a new descendant.
    const checkpoint: ReleaseCheckpoint = { epoch: this.epoch, revision: this.revision, generation: entry.generation,
      queueRevision: this.queueRevision, topologyRevision: this.topologyRevision };
    const loaded = await loadedIds(this.raw);
    if (this.changed(checkpoint, entry, new Set([id]))) { this.changedReason(entry, checkpoint); return; }
    if (!loaded.has(id)) { entry.state = "readonly"; entry.reason = ""; entry.releasingSince = undefined; return; }
    if (entry.state === "releasing") {
      if (entry.releasingSince !== undefined && this.now() - entry.releasingSince > this.releaseTimeout) entry.reason = "原生服务尚未确认卸载，仍等待释放";
      return;
    }
    entry.state = "owned";
    if (entry.awaitingFirstTurn) { entry.reason = "新会话尚未接受首条消息，保留执行实例"; return; }
    if (entry.uncertain) { entry.reason = "操作送达结果待确认"; return; }
    const hold = this.hold(id); if (hold) { entry.reason = hold; return; }
    const root = object(object(await this.raw("thread/read", { threadId: id, includeTurns: false })).thread);
    if (root.id !== id) throw new Error("线程身份未确认");
    // AgentControl owns native child lifetimes. Never send unsubscribe to a
    // child, even when it appears idle, as a side effect of the parent policy.
    if (identity(root) !== "main") { entry.reason = "子 Agent 或线程来源尚未确认，执行实例由主会话协调"; return; }
    // Preserve the existing lightweight sweep for a busy root. An active main
    // thread already prevents release, so no descendant scan is needed yet.
    if (!["idle", "systemError"].includes(String(object(root.status).type))) { entry.reason = "任务仍在运行、重试或等待交互"; return; }
    const family = await this.family(id, loaded, root);
    if (this.changed(checkpoint, entry, family.members)) { this.changedReason(entry, checkpoint); return; }
    const reason = await this.familyHold(id, family);
    if (reason) { entry.reason = reason; return; }
    if (!this.releaseIdleDescendants && [...family.members].some(member => member !== id && loaded.has(member))) {
      entry.reason = "当前 Codex 版本尚未通过子 Agent 安全释放验收，保留执行实例"; return;
    }

    // Fresh loaded membership, complete ancestry, and native resources are all
    // checked again before dispatch. No child unsubscribe/interrupt is issued.
    const latest = await this.family(id, await loadedIds(this.raw));
    if (this.changed(checkpoint, entry, new Set([...family.members, ...latest.members])) ||
        family.members.size !== latest.members.size || [...family.members].some(member => !latest.members.has(member)) ||
        !latest.loaded.has(id)) { this.changedReason(entry, checkpoint); return; }
    const finalReason = await this.familyHold(id, latest);
    if (finalReason) { entry.reason = finalReason; return; }
    if (this.changed(checkpoint, entry, latest.members)) { this.changedReason(entry, checkpoint); return; }
    try {
      await this.raw("thread/unsubscribe", { threadId: id }, { beforeSend: () => {
        // This runs at the real stdin write boundary, after queued writes and
        // native request handlers have had an opportunity to change the family.
        if (this.changed(checkpoint, entry, latest.members) || [...latest.members].some(member =>
          this.hold(member) || this.entries.get(member)?.uncertain || this.entries.get(member)?.awaitingFirstTurn ||
          (member !== id && this.locks.busy(member)))) {
          throw new Error("NOT_SENT: 释放条件已改变，未发送取消订阅");
        }
      } });
    } catch (error) {
      if (message(error).startsWith("NOT_SENT:")) { this.changedReason(entry, checkpoint); return; }
      if (message(error).startsWith("DELIVERY_UNKNOWN")) {
        if (this.epoch === checkpoint.epoch) {
          entry.state = "releasing"; entry.reason = "释放回执待确认，等待原生服务卸载"; entry.releasingSince = this.now();
        }
        return;
      }
      throw error;
    }
    if (this.epoch !== checkpoint.epoch) return;
    entry.state = "releasing"; entry.reason = "等待原生服务关闭并释放写锁"; entry.releasingSince = this.now();
  }

  private changed(checkpoint: ReleaseCheckpoint, entry: Entry, members: Set<string>): boolean {
    return this.epoch !== checkpoint.epoch || entry.generation !== checkpoint.generation ||
      this.queueRevision !== checkpoint.queueRevision || this.topologyRevision !== checkpoint.topologyRevision ||
      [...members].some(member => (this.threadRevisions.get(member) ?? 0) > checkpoint.revision);
  }
  private changedReason(entry: Entry, checkpoint: ReleaseCheckpoint): void {
    if (this.epoch === checkpoint.epoch) {
      if (entry.state === "readonly") entry.state = "unknown";
      entry.reason = "状态发生变化，重新检查释放条件";
    }
  }

  private async family(id: string, loaded: Set<string>, root?: JsonObject): Promise<Family> {
    const metadata = new Map<string, JsonObject>(root ? [[id, root]] : []);
    const read = async (threadId: string) => {
      const existing = metadata.get(threadId);
      if (existing) return existing;
      const thread = object(object(await this.raw("thread/read", { threadId, includeTurns: false })).thread);
      if (thread.id !== threadId) throw new Error("线程身份未确认");
      metadata.set(threadId, thread); return thread;
    };
    await read(id);
    const candidates = new Set([...loaded, ...this.pending.values(), ...(this.queue?.ids ?? [])]);
    for (const [threadId, entry] of this.entries) {
      if (entry.uncertain || entry.awaitingFirstTurn || !["readonly", "external"].includes(entry.state)) candidates.add(threadId);
    }
    const members = new Set([id]);
    for (const candidate of candidates) {
      if (candidate === id) continue;
      const path = new Set<string>(); let current = candidate;
      while (current !== id) {
        // A closed cycle cannot reach this root. It is an unrelated family,
        // rather than a reason to retain every root in the native process.
        if (path.has(current)) break;
        if (path.size >= 64) throw new Error("子 Agent 祖先链过深，归属尚未确认");
        path.add(current);
        const thread = await read(current), parent = parentThread(thread);
        if (parent) { current = parent; continue; }
        if (identity(thread) !== "main") throw new Error("子 Agent 归属尚未确认，保留执行实例");
        break;
      }
      if (current === id) for (const member of path) members.add(member);
    }
    return { members, metadata, loaded };
  }

  private async familyHold(root: string, family: Family): Promise<string | undefined> {
    for (const id of family.members) {
      const prefix = id === root ? "" : "子 Agent：";
      const entry = this.entries.get(id);
      if (entry?.awaitingFirstTurn) return prefix + "新会话尚未接受首条消息，保留执行实例";
      if (entry?.uncertain) return prefix + "操作送达结果待确认";
      if (id !== root && this.locks.busy(id)) return prefix + "执行操作尚未结束，保留执行实例";
      const hold = this.hold(id); if (hold) return prefix + hold;
      const status = String(object(family.metadata.get(id)!.status).type);
      if (!family.loaded.has(id)) {
        if (!["notLoaded", "idle", "systemError"].includes(status)) return prefix + "执行状态尚未确认，保留执行实例";
        continue;
      }
      if (!["idle", "systemError"].includes(status)) return prefix + "任务仍在运行、重试或等待交互";
      const terminals = object(await this.raw("thread/backgroundTerminals/list", { threadId: id }));
      if (!Array.isArray(terminals.data)) throw new Error(prefix + "后台终端响应不完整");
      if (terminals.data.length || terminals.nextCursor !== null) return prefix + "会话仍有后台终端或状态未知，保留执行实例";
      const goal = object(await this.raw("thread/goal/get", { threadId: id })).goal;
      if (goal !== null && !["complete", "paused", "blocked", "budgetLimited"].includes(String(object(goal).status))) {
        return prefix + "会话有活动目标或目标状态未知";
      }
    }
    return;
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
