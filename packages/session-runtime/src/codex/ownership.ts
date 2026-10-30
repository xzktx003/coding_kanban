import { setTimeout as sleep } from "node:timers/promises";
import { classifySubagentThread, subagentParent, type SubagentThread } from "@agent-orchestrator/shared";
import { HistoryBudget, HistoryBudgetExceeded, type HistoryBudgetLimits } from "../core/history-budget.js";
import { sanitizeCodexHistory } from "./projection.js";
import { KeyedSerial } from "../core/serial.js";
import { isObject, object, type Json, type JsonObject } from "../core/json.js";
import { clearCompletedGoalParams, sameGoal, threadGoal, type CompletedGoalResult, type GoalClearReason, type ThreadGoal } from "./goal-state.js";

export type Rpc = (method: string, params: Json, options?: { beforeSend?: () => void; timeoutMs?: number; signal?: AbortSignal }) => Promise<Json>;
type AccessState = "readonly" | "acquiring" | "owned" | "releasing" | "external" | "unknown";
interface Entry {
  state: AccessState; reason: string; generation: number;
  uncertain: boolean; awaitingFirstTurn: boolean; releasingSince?: number;
  firstTurnAck?: { epoch: number; generation: number };
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
  private goalRevisions = new Map<string, number>();
  private goals = new Map<string, ThreadGoal | null>();
  private activeTurns = new Map<string, string>();
  private queueSequence = 0n;
  private queue?: { when: number; busy: boolean; ids: Set<string> };
  private pending = new Map<string, string>();
  private now: () => number;
  private pause: (milliseconds: number) => Promise<void>;
  private releaseTimeout: number;
  private releaseIdleDescendants: boolean;
  private completedGoalWait: number;
  private goalMetadataWait: number;
  private readonly sharedDaemon: boolean;

  constructor(private readonly raw: Rpc, options: { now?: () => number; pause?: (milliseconds: number) => Promise<void>; releaseTimeoutMs?: number; releaseIdleDescendants?: boolean; completedGoalWaitMs?: number; goalMetadataWaitMs?: number; sharedDaemon?: boolean } = {}) {
    this.sharedDaemon = options.sharedDaemon === true;
    this.now = options.now ?? (() => performance.now());
    this.pause = options.pause ?? sleep;
    this.releaseTimeout = options.releaseTimeoutMs ?? 8000;
    // Production enables this only after the real initialize handshake matches
    // a native version whose parent-only subscription lifecycle was verified.
    this.releaseIdleDescendants = options.releaseIdleDescendants === true;
    this.completedGoalWait = options.completedGoalWaitMs ?? 5000;
    this.goalMetadataWait = options.goalMetadataWaitMs ?? 5000;
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
    if (id && method === "turn/started" && typeof object(body.turn).id === "string") this.activeTurns.set(id, object(body.turn).id as string);
    if (id && method === "turn/completed" && this.activeTurns.get(id) === object(body.turn).id) this.activeTurns.delete(id);
    if (id && ["thread/closed", "thread/deleted"].includes(method)) this.activeTurns.delete(id);
    if (id && (method === "thread/goal/updated" || method === "thread/goal/cleared")) {
      this.goalRevisions.set(id, (this.goalRevisions.get(id) ?? 0) + 1);
      const goal = method === "thread/goal/cleared" ? null : threadGoal(body.goal, id);
      if (goal === undefined) this.goals.delete(id);
      else this.goals.set(id, goal);
    }
    if (method === "thread/started") {
      const parent = parentThread(thread);
      if (parent) this.touch(parent);
      else if (identity(thread) !== "main") this.topologyRevision++;
    }
  }
  invalidate(): void {
    this.epoch++; this.revision++; this.pending.clear(); this.queue = undefined; this.threadRevisions.clear();
    this.goalRevisions.clear(); this.goals.clear(); this.activeTurns.clear();
    this.releaseIdleDescendants = false;
    for (const entry of this.entries.values()) { entry.state = "unknown"; entry.reason = "运行连接已断开，执行状态待确认"; entry.uncertain = true; }
  }
  private hold(id: string): string | undefined {
    if (!this.queue || this.now() - this.queue.when >= 10_000) return "等待网关确认队列状态";
    if (this.queue.busy || this.queue.ids.has(id)) return "队列正在执行或有待确认的发送";
    if ([...this.pending.values()].includes(id)) return "等待审批或回答";
    return;
  }
  private releaseHold(id: string): string | undefined {
    // Release must not trust an idle snapshot ahead of exact turn completion.
    // Goal cleanup has its own bounded wait for that completion and must retain it.
    if (this.activeTurns.has(id)) return "轮次尚未结束，保留执行实例";
    return this.hold(id);
  }

  /**
   * Official-style local compare-and-clear, using only the writer we already
   * own. Native clear has no CAS: another process can still change the goal
   * between its get and clear. Never send a fictitious ifGoalUnchanged field.
   */
  async clearCompletedGoal(value: unknown, options: { signal?: AbortSignal } = {}): Promise<CompletedGoalResult> {
    const { threadId: id, expectedGoal, expectedAccessGeneration } = clearCompletedGoalParams(value);
    const epoch = this.epoch, until = this.now() + this.completedGoalWait;
    const cancelled = () => { if (options.signal?.aborted) throw new Error("NOT_SENT: 目标清理已取消"); };
    return this.locks.run(id, async () => {
      cancelled();
      const entry = this.entries.get(id);
      const skipped = (reason: GoalClearReason): CompletedGoalResult => ({ cleared: false, reason });
      const ownerReason = (): GoalClearReason | undefined => {
        if (this.epoch !== epoch) return "generationChanged";
        if (!entry || entry.state !== "owned" || entry.uncertain) return "notOwned";
        if (entry.generation !== expectedAccessGeneration) return "generationChanged";
        if (entry.awaitingFirstTurn || this.hold(id)) return "busy";
        return;
      };
      const initial = ownerReason(); if (initial) return skipped(initial);
      const read: Rpc = (method, params) => this.raw(method, params, { timeoutMs: Math.max(1, until - this.now()), signal: options.signal });
      if (!(await loadedIds(read)).has(id)) return skipped("notOwned");
      let revision = this.threadRevisions.get(id) ?? 0;
      while (true) {
        cancelled();
        const reason = ownerReason(); if (reason) return skipped(reason);
        if (this.now() >= until) return skipped("busy");
        revision = this.threadRevisions.get(id) ?? 0;
        let metadata: JsonObject;
        try { metadata = await this.inputMetadata(id, epoch, read); }
        catch { return skipped(ownerReason() ?? "unsupported"); }
        const changed = ownerReason(); if (changed) return skipped(changed);
        // A completion event can arrive before its final turn has drained. Only
        // read metadata while waiting; never start/resume a turn or read history.
        if (object(metadata.status).type === "idle" && !this.activeTurns.has(id) && revision === (this.threadRevisions.get(id) ?? 0)) break;
        await this.pause(Math.min(100, Math.max(0, until - this.now())));
      }
      if (!(await loadedIds(read)).has(id)) return skipped("notOwned");
      const reason = ownerReason(); if (reason) return skipped(reason);
      const goalRevision = this.goalRevisions.get(id) ?? 0;
      const response = object(await read("thread/goal/get", { threadId: id }));
      if (goalRevision !== (this.goalRevisions.get(id) ?? 0)) return skipped("goalChanged");
      const current = threadGoal(response.goal, id);
      if (!current) return skipped(response.goal === null ? "goalChanged" : "unsupported");
      if (!sameGoal(current, expectedGoal)) return skipped("goalChanged");
      this.goals.set(id, current);
      let dispatchedGeneration: number | undefined;
      try {
        const ack = object(await this.raw("thread/goal/clear", { threadId: id }, { signal: options.signal, beforeSend: () => {
          cancelled();
          let guard = ownerReason();
          if (!guard && ((this.goalRevisions.get(id) ?? 0) !== goalRevision || !sameGoal(this.goals.get(id), expectedGoal))) guard = "goalChanged";
          if (!guard && (revision !== (this.threadRevisions.get(id) ?? 0) || this.activeTurns.has(id) || this.now() >= until)) guard = "busy";
          if (guard) throw new Error(`NOT_SENT: GOAL_CLEAR_SKIPPED:${guard}`);
          dispatchedGeneration = ++entry!.generation;
          this.touch(id);
        } }));
        if (this.epoch !== epoch || entry!.generation !== dispatchedGeneration || typeof ack.cleared !== "boolean")
          throw new Error("DELIVERY_UNKNOWN: completed goal clear acknowledgement is no longer valid");
        if (ack.cleared && (this.goalRevisions.get(id) ?? 0) === goalRevision) {
          this.goals.set(id, null); this.goalRevisions.set(id, goalRevision + 1);
        }
        return { cleared: ack.cleared };
      } catch (error) {
        const notSent = /^NOT_SENT: GOAL_CLEAR_SKIPPED:(notOwned|generationChanged|goalChanged|busy|unsupported)$/.exec(message(error));
        if (notSent) return skipped(notSent[1] as GoalClearReason);
        if (this.epoch === epoch && entry) {
          if (writerConflict(error)) { entry.state = "external"; entry.reason = "其他客户端正在使用，可查看历史"; }
          else if (message(error).startsWith("DELIVERY_UNKNOWN")) { entry.uncertain = true; entry.state = "unknown"; entry.reason = "目标清理回执丢失，保留完成状态等待核对"; }
        }
        throw error;
      }
    });
  }

  async call(method: string, params: Json, options?: { signal?: AbortSignal; beforeSend?: () => void }): Promise<Json> {
    const id = typeof object(params).threadId === "string" ? object(params).threadId as string : undefined;
    if (method === "thread/unsubscribe") {
      if (!id) throw new Error("threadId required");
      return this.release(id);
    }
    if (!mutations.has(method) || id === undefined) {
      const result = await this.raw(method, params, options);
      const created = object(object(result).thread).id;
      if (["thread/start", "thread/fork"].includes(method) && typeof created === "string") {
        await this.locks.run(created, async () => {
          const entry = this.entry(created); entry.state = "owned"; entry.awaitingFirstTurn = method === "thread/start";
          entry.firstTurnAck = undefined;
          this.touch(created);
          const parent = parentThread(object(object(result).thread));
          if (parent) this.touch(parent);
        });
      }
      return result;
    }
    const inputEpoch = directInput.has(method) ? this.epoch : undefined;
    const goalMutation = method === "thread/goal/set" || method === "thread/goal/clear";
    const goalSignal = goalMutation ? options?.signal : undefined;
    const goalRead: Rpc = (method, params) => this.raw(method, params, { signal: goalSignal });
    if (inputEpoch !== undefined) await (method === "thread/goal/set" ? this.goalInputMetadata(id, inputEpoch, goalSignal) : this.inputMetadata(id, inputEpoch, goalMutation ? goalRead : this.raw));
    return this.locks.run(id, async () => {
      if (goalSignal?.aborted) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，目标设置已取消");
      if (inputEpoch !== undefined && this.epoch !== inputEpoch)
        throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
      const entry = this.entry(id);
      if (entry.state === "releasing") {
        const until = this.now() + this.releaseTimeout;
        while (await this.isLoadedForAcquire(id, goalSignal)) {
          if (this.now() >= until) throw new Error("SESSION_RELEASE_PENDING: 会话仍在释放，请稍后重试；消息尚未发送");
          await this.pause(100);
        }
        entry.state = "readonly"; entry.releasingSince = undefined;
      }
      const loaded = method === "thread/resume" || await this.isLoadedForAcquire(id, goalSignal);
      // A permission read before the keyed lock can be stale while waiting for
      // another operation or for native unload. Re-read metadata, not history,
      // after those waits and before acquiring or dispatching any direct input.
      const metadata = inputEpoch === undefined ? undefined : await (method === "thread/goal/set" ? this.goalInputMetadata(id, inputEpoch, goalSignal) : this.inputMetadata(id, inputEpoch, goalMutation ? goalRead : this.raw));
      entry.generation++;
      this.touch(id);
      if (metadata) { const parent = parentThread(metadata); if (parent) this.touch(parent); }
      // Shared daemon metadata/settings/interrupt/archive operations must not wake a cold
      // persisted queue as a side effect. Only explicit execution can acquire a cold thread.
      if (!loaded && (!this.sharedDaemon || method === "turn/start" || method === "review/start")) {
        const previousState = entry.state, previousReason = entry.reason;
        entry.state = "acquiring";
        try {
          await this.raw("thread/resume", this.sharedDaemon ? { threadId: id, excludeTurns: true } : { threadId: id, config: { "features.default_mode_request_user_input": true } }, (goalMutation || options?.beforeSend) ? { signal: goalSignal, beforeSend: () => {
            options?.beforeSend?.();
            if (goalSignal?.aborted || (inputEpoch !== undefined && this.epoch !== inputEpoch)) throw new Error("NOT_SENT: 目标操作已取消或运行实例已改变，未恢复线程");
          } } : undefined);
          entry.state = "owned"; entry.reason = "";
        } catch (error) {
          if (message(error).startsWith("NOT_SENT:")) {
            entry.state = previousState; entry.reason = previousReason;
            throw error;
          }
          entry.state = writerConflict(error) ? "external" : "unknown";
          entry.reason = writerConflict(error) ? "其他客户端正在使用，可查看历史；释放后可重试原消息" : message(error);
          throw new Error(writerConflict(error) ? `SESSION_OWNED_ELSEWHERE: ${entry.reason}` : `SESSION_ACQUIRE_FAILED: 尚未发送，恢复执行实例失败：${message(error)}`);
        }
      }
      if (inputEpoch !== undefined && this.epoch !== inputEpoch)
        throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
      try {
        const dispatchRevision = this.threadRevisions.get(id) ?? 0;
        const result = await this.raw(method, params, (goalMutation || options?.beforeSend) ? { signal: goalSignal, beforeSend: () => {
          options?.beforeSend?.();
          if (goalSignal?.aborted) throw new Error("NOT_SENT: 目标操作已取消");
          if (inputEpoch !== undefined && this.epoch !== inputEpoch) throw new Error("NOT_SENT: 目标操作的运行实例已改变");
        } } : undefined);
        if (inputEpoch !== undefined && this.epoch !== inputEpoch)
          throw new Error("DELIVERY_UNKNOWN: 运行实例已改变，原操作回执已失效");
        entry.state = "owned"; entry.reason = "";
        if (method === "turn/start" || method === "review/start") entry.uncertain = false;
        if (method === "turn/start") {
          if (entry.awaitingFirstTurn) entry.firstTurnAck = { epoch: this.epoch, generation: entry.generation };
          entry.awaitingFirstTurn = false;
          const turn = object(object(result).turn);
          // Cover the acknowledgement/start-notification gap, but never revive
          // a turn whose newer completion already arrived before this reply.
          if (typeof turn.id === "string" && turn.status === "inProgress" &&
              dispatchRevision === (this.threadRevisions.get(id) ?? 0))
            this.activeTurns.set(id, turn.id);
        }
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

  private async goalInputMetadata(id: string, epoch: number, signal?: AbortSignal): Promise<JsonObject> {
    const entry = this.entries.get(id), proof = entry?.firstTurnAck;
    const valid = () => !!entry && !!proof && entry.firstTurnAck === proof && this.epoch === epoch && proof.epoch === epoch &&
      entry.state === "owned" && !entry.uncertain && !entry.awaitingFirstTurn && entry.generation === proof.generation;
    if (signal?.aborted) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，目标设置已取消");
    if (!valid()) return this.inputMetadata(id, epoch, (method, params) => this.raw(method, params, { signal }));
    const until = this.now() + this.goalMetadataWait;
    const read: Rpc = (method, params) => this.raw(method, params, { timeoutMs: Math.max(1, until - this.now()), signal });
    while (true) {
      if (signal?.aborted) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，目标设置已取消");
      if (!valid()) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，首轮输入归属或运行实例已改变");
      if (this.now() >= until) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，新会话元数据仍未就绪，请稍后重试目标设置");
      try {
        const metadata = await this.inputMetadata(id, epoch, read);
        if (!valid()) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，首轮输入归属或运行实例已改变");
        return metadata;
      } catch (error) {
        // The bundled native CLI can acknowledge the first turn before its new
        // rollout metadata has materialized. Only this exact, same-path error
        // permits another read. No turn or Goal mutation is ever retried.
        if (!/^SESSION_ACQUIRE_FAILED: 尚未发送，无法确认输入权限：failed to read thread: thread-store internal error: failed to read session metadata (.+\.jsonl): rollout at \1 is empty$/.test(message(error))) throw error;
        await this.pause(Math.min(100, Math.max(0, until - this.now())));
      }
    }
  }

  private async inputMetadata(id: string, epoch: number, read: Rpc = this.raw): Promise<JsonObject> {
    if (this.epoch !== epoch) throw new Error("SESSION_ACQUIRE_FAILED: 尚未发送，运行实例已改变，请重新核对会话");
    let metadata: Json;
    try { metadata = await read("thread/read", { threadId: id, includeTurns: false }); }
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

  private async isLoadedForAcquire(id: string, signal?: AbortSignal): Promise<boolean> {
    try { return (await loadedIds(signal ? (method, params) => this.raw(method, params, { signal }) : this.raw)).has(id); }
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
    const hold = this.releaseHold(id); if (hold) { entry.reason = hold; return; }
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
          this.releaseHold(member) || this.entries.get(member)?.uncertain || this.entries.get(member)?.awaitingFirstTurn ||
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
      const hold = this.releaseHold(id); if (hold) return prefix + hold;
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

/** A native reply that did not fit its decoder frame; the same cursor is safe to retry smaller. */
function oversizedFrame(error: unknown): boolean {
  const text = message(error);
  return (
    text.includes("RPC frame exceeded byte limit") ||
    text.includes("decoded message length too large")
  );
}

/** One turn's item bodies, in transcript order, bounded by the caller's remaining allowance. */
async function readTurnItems(
  raw: Rpc,
  budget: HistoryBudget,
  threadId: string,
  turnId: string,
  allowance: number,
): Promise<Json[]> {
  const items: Json[] = [], seen = new Set<string>();
  let cursor: Json = null;
  let limit = Math.min(100, Math.max(1, allowance));
  while (items.length < allowance) {
    budget.beginPage();
    const read = await readPageWithinFrame(
      raw,
      "thread/items/list",
      { threadId, turnId, cursor, sortDirection: "asc" },
      Math.min(limit, allowance - items.length),
    );
    if ("early" in read) break;
    const { page } = read;
    limit = read.limit;
    budget.add(page);
    if (!Array.isArray(page.data))
      throw new Error("items/list response missing data");
    for (const entry of page.data) {
      const row = object(entry);
      // A row from another turn would silently corrupt this transcript.
      if (row.turnId !== undefined && row.turnId !== turnId)
        throw new Error("items/list returned a foreign turn");
      items.push(row.item ?? entry);
    }
    cursor = page.nextCursor;
    if (cursor === null) break;
    if (typeof cursor !== "string") throw new Error("Invalid items/list cursor");
    if (seen.has(cursor)) throw new Error("Repeated items/list cursor");
    seen.add(cursor);
  }
  return items;
}

/** Request one page, halving `limit` while the native reply cannot be decoded. */
async function readPageWithinFrame(
  raw: Rpc,
  method: string,
  params: JsonObject,
  limit: number,
  onFirstFailure?: (error: unknown) => Json | undefined,
): Promise<{ page: JsonObject; limit: number } | { early: Json }> {
  let current = limit;
  for (;;) {
    try {
      return {
        page: object(await raw(method, { ...params, limit: current })),
        limit: current,
      };
    } catch (error) {
      const early = onFirstFailure?.(error);
      if (early !== undefined) return { early };
      if (current > 1 && oversizedFrame(error)) {
        current = Math.max(1, Math.floor(current / 2));
        continue;
      }
      throw error;
    }
  }
}

/** Read-only history loading is deliberately outside execution ownership. */
export async function readHistory(
  raw: Rpc,
  id: string,
  limits: Partial<HistoryBudgetLimits> & {
    allowPartial?: boolean;
    turnLimit?: number;
    itemBudget?: number;
    maxItemsPerTurn?: number;
  } = {},
  legacy?: (id: string) => Promise<Json>,
): Promise<Json> {
  const { allowPartial, turnLimit, itemBudget, maxItemsPerTurn, ...budgetLimits } = limits;
  const partial = allowPartial === true;
  const budget = new HistoryBudget(budgetLimits, { partial });
  const result = object(await raw("thread/read", { threadId: id, includeTurns: false }));
  budget.add(result);
  const thread = object(result.thread);
  if (thread.historyMode !== "paginated") {
    if (!legacy) {
      budget.beginPage();
      const history = await raw("thread/read", { threadId: id, includeTurns: true });
      budget.add(history);
      return sanitizeCodexHistory(history);
    }
    // The shared pipe dies when one native frame exceeds 32 MiB. Tests without
    // an isolated reader keep the original direct read.
    return legacy(id);
  }
  // Shells first, bodies separately: the official plugin never lets one page
  // carry whole item bodies, which is what pushes a reply past the frame cap.
  const pageTurns = Math.max(1, turnLimit ?? 100);
  const perTurnItems = Math.max(1, maxItemsPerTurn ?? 98);
  // This endpoint aggregates a whole thread, so the item allowance covers a
  // full page of turns; the byte/entry budget remains the real ceiling.
  let remainingItems = Math.max(1, itemBudget ?? pageTurns * perTurnItems);
  const turns: Json[] = [], seen = new Set<string>();
  let cursor: Json = null;
  let limit = pageTurns;
  let incomplete: string | undefined;
  let resumeCursor: Json = null;
  let lastTurnId: string | undefined;
  reading: for (;;) {
    let page: JsonObject;
    try {
      budget.beginPage();
      const read = await readPageWithinFrame(
        raw,
        "thread/turns/list",
        { threadId: id, cursor, sortDirection: "asc", itemsView: "notLoaded" },
        limit,
        (error) =>
          !turns.length &&
          cursor === null &&
          message(error).includes("not materialized yet") &&
          message(error).includes("before first user message")
            ? null
            : undefined,
      );
      if ("early" in read) {
        thread.turns = [];
        return result;
      }
      page = read.page;
      limit = read.limit;
      budget.add(page);
    } catch (error) {
      if (partial && error instanceof HistoryBudgetExceeded) {
        incomplete = "budget";
        resumeCursor = cursor;
        break;
      }
      throw error;
    }
    if (!Array.isArray(page.data)) throw new Error("turns/list response missing data");
    for (const shell of page.data) {
      const turn = object(shell);
      if (typeof turn.id !== "string" || !turn.id)
        throw new Error("turns/list response missing turn id");
      let items: Json[];
      try {
        items = await readTurnItems(raw, budget, id, turn.id, Math.min(perTurnItems, remainingItems));
      } catch (error) {
        if (partial && error instanceof HistoryBudgetExceeded) {
          incomplete = "budget";
          resumeCursor = cursor;
          break reading;
        }
        throw error;
      }
      remainingItems -= items.length;
      turns.push(
        sanitizeCodexHistory({
          ...turn,
          items,
          itemsView: items.length < perTurnItems ? "full" : "summary",
        } as Json),
      );
      lastTurnId = turn.id;
      if (remainingItems <= 0) {
        incomplete = "items";
        resumeCursor = page.nextCursor ?? null;
        break reading;
      }
    }
    cursor = page.nextCursor;
    if (cursor === null) break;
    if (typeof cursor !== "string") throw new Error("Invalid turns/list cursor");
    if (seen.has(cursor)) throw new Error("Repeated turns/list cursor");
    seen.add(cursor);
  }
  if (!isObject(result.thread)) throw new Error("Invalid thread response");
  if (incomplete) {
    result.thread.historyStatus = "incomplete";
    result.thread.historyIncompleteReason = incomplete;
    // A page cursor alone cannot express stopping mid-page, so name the last
    // turn actually read. Callers resume after it rather than guessing.
    result.thread.turnsNextCursor = resumeCursor;
    result.thread.turnsResumeAfterTurnId = lastTurnId ?? null;
  }
  result.thread.turns = turns;
  return sanitizeCodexHistory(result);
}
