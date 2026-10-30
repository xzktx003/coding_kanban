import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeDurableJson } from "./durable-json.js";

type Runtime = {
  call(method: string, params: Record<string, unknown>): Promise<any>;
  guardedCall?(
    method: string,
    params: Record<string, unknown>,
    expectedScope: string,
  ): Promise<any>;
};
type Queue = {
  inspect(
    id: string,
  ): Promise<{
    revision: number;
    paused: string | null;
    items: Array<{ status?: string }>;
  }>;
  pause(id: string): Promise<void>;
};
export interface ResumeIntent {
  operationId: string;
  threadId: string;
  sourceTurnId: string;
  parameters: Record<string, unknown>;
  expectedScope?: string;
}
export interface ResumeReceipt {
  operationId: string;
  threadId: string;
  status: "accepted" | "rejected" | "unknown";
  turnId?: string;
  error?: string;
}
export interface SettingsIntent {
  operationId: string;
  threadId: string;
  parameters: Record<string, unknown>;
  expectedScope?: string;
}
export interface ArchiveIntent {
  operationId: string;
  threadId: string;
  mode: "idle" | "stop";
  expectedTurnId?: string;
  expectedScope?: string;
}
export interface ArchiveReceipt {
  operationId: string;
  threadId: string;
  status: "archived" | "blocked" | "unknown";
  stage: string;
  error?: string;
}
type StoredResume = ResumeReceipt & {
  fingerprint: string;
  at: number;
  sourceTurnId: string;
  namespace?: string;
};
type StoredArchive = ArchiveReceipt & {
  fingerprint: string;
  at: number;
  mode: "idle" | "stop";
  expectedTurnId?: string;
  namespace?: string;
  cwd?: string;
};
type State = {
  version: 1;
  resumes: Record<string, StoredResume>;
  settings: Record<string, StoredResume>;
  archives: Record<string, StoredArchive>;
  gates: Record<string, string>;
};
const conflict = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};
const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.slice(0, 1024) : "操作结果待核对";
const activeGoal = (goal: any) => goal?.status === "active";
const queued = (items: Array<{ status?: string }>) =>
  items.some((m) => !["sent", "cancelled"].includes(m.status ?? ""));

/** Durable intent receipts and an admission gate for writes originating in this gateway.
 * The gate does not lock external CLI clients; every destructive step rechecks native state.
 */
export class SessionLifecycle {
  private state: State = {
    version: 1,
    resumes: {},
    settings: {},
    archives: {},
    gates: {},
  };
  private loading?: Promise<void>;
  private serial = new Map<string, Promise<unknown>>();
  private receiptClaims = new Map<string, Promise<unknown>>();
  private saves: Promise<void> = Promise.resolve();
  private writers = new Map<string, Set<Promise<unknown>>>();
  constructor(
    private options: {
      file?: string;
      runtime: Runtime;
      followups: Queue;
      context?: () => Promise<{ scopeToken: string; namespace: string; daemonIdentity?: string }>;
    },
  ) {}
  private load() {
    return (this.loading ??= (async () => {
      if (!this.options.file) return;
      try {
        const value = JSON.parse(await readFile(this.options.file, "utf8"));
        if (
          value?.version !== 1 ||
          !value.resumes ||
          !value.archives ||
          !value.gates ||
          [value.resumes, value.archives, value.gates].some(
            (x) => typeof x !== "object" || Array.isArray(x),
          )
        )
          throw new Error("生命周期记录损坏，禁止覆盖");
        this.state = { ...value, settings: value.settings ?? {} };
        for (const [key, operationId] of Object.entries(this.state.gates)) {
          if (key.startsWith("[")) continue;
          const record = await this.stored("archives", operationId);
          if (record?.namespace) {
            this.state.gates[
              JSON.stringify([record.namespace, record.threadId])
            ] = operationId;
            delete this.state.gates[key];
          }
        }
        // A process restart never retries a native mutation, even if the previous
        // process died between a successful write and its durable acknowledgement.
        for (const receipt of Object.values(this.state.resumes))
          if ((receipt.status as string) === "pending")
            receipt.status = "unknown";
        for (const receipt of Object.values(this.state.archives))
          if ((receipt.status as string) === "pending")
            receipt.status = "unknown";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    })());
  }
  private async save() {
    if (!this.options.file) return;
    const snapshot = structuredClone(this.state);
    const evictions: Array<{
      table: "resumes" | "settings" | "archives";
      id: string;
      fingerprint: string;
      status: string;
    }> = [];
    for (const table of ["resumes", "settings", "archives"] as const) {
      const finished = Object.values(snapshot[table])
        .filter((record) => record.status !== "unknown")
        .sort((a, b) => b.at - a.at)
        .slice(64);
      for (const record of finished)
        evictions.push({
          table,
          id: record.operationId,
          fingerprint: record.fingerprint,
          status: record.status,
        });
    }
    const saving = this.saves.then(async () => {
      // Old terminal receipts remain addressable on disk. Expelling their map
      // entry cannot turn a stale HTTP retry into a second native mutation.
      for (const entry of evictions) {
        await writeDurableJson(
          this.receiptFile(entry.table, entry.id)!,
          snapshot[entry.table][entry.id],
        );
        delete snapshot[entry.table][entry.id];
      }
      await writeDurableJson(this.options.file!, snapshot);
      for (const entry of evictions) {
        const current = this.state[entry.table][entry.id];
        if (
          current?.fingerprint === entry.fingerprint &&
          current.status === entry.status
        )
          delete this.state[entry.table][entry.id];
      }
    });
    this.saves = saving.catch(() => {});
    return saving;
  }
  private receiptFile(table: string, id: string) {
    return this.options.file
      ? join(this.options.file + ".receipts", table, fingerprint(id) + ".json")
      : null;
  }
  private async stored<T extends "resumes" | "settings" | "archives">(
    table: T,
    id: string,
  ): Promise<State[T][string] | undefined> {
    const live = this.state[table][id];
    if (live) return live as State[T][string];
    const file = this.receiptFile(table, id);
    if (!file) return;
    try {
      const record = JSON.parse(await readFile(file, "utf8"));
      if (
        record.operationId !== id ||
        typeof record.fingerprint !== "string" ||
        typeof record.threadId !== "string"
      )
        throw new Error("生命周期回执记录损坏，禁止重发");
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private admitNewReceipt() {
    const pending = [
      ...Object.values(this.state.resumes),
      ...Object.values(this.state.settings),
      ...Object.values(this.state.archives),
    ].filter((record) => record.status === "unknown");
    if (pending.length >= 1024)
      conflict(
        "待核对的生命周期操作过多，请先核对已有回执；未知结果不会自动重发",
      );
  }
  private async snapshot(threadId: string) {
    const result = await this.options.runtime.call("thread/read", {
      threadId,
      includeTurns: false,
    });
    const recent = await this.options.runtime.call("thread/turns/list", {
      threadId,
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    if (!Array.isArray(recent?.data)) throw new Error("无法读取当前轮次元数据");
    return { ...result?.thread, turns: recent.data };
  }
  private async nativeQueue(threadId: string) {
    const entries: Array<{ id: string; fingerprint: string }> = [],
      seen = new Set<string>();
    let cursor: string | null = null,
      bytes = 0;
    do {
      const page = await this.options.runtime.call("thread/queue/list", {
        threadId,
        limit: 20,
        cursor,
      });
      if (!Array.isArray(page?.data)) throw new Error("无法确认原生队列状态");
      for (const row of page.data) {
        if (typeof row?.id !== "string") throw new Error("原生队列身份无效");
        bytes += Buffer.byteLength(JSON.stringify(row));
        if (bytes > 8 * 1024 * 1024)
          conflict("原生队列超过核对预算，请先显式整理队列");
        entries.push({ id: row.id, fingerprint: fingerprint(row) });
      }
      cursor = page.nextCursor ?? null;
      if (cursor && (seen.has(cursor) || seen.size >= 100))
        throw new Error("原生队列分页无法确认");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return entries;
  }
  private async isArchived(threadId: string, cwd?: string) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await this.options.runtime.call("thread/list", {
        archived: true,
        limit: 100,
        cursor,
        sortKey: "updated_at",
        sortDirection: "desc",
        useStateDbOnly: true,
        ...(cwd ? { cwd } : {}),
      });
      if (!Array.isArray(page?.data)) throw new Error("归档列表返回无效状态");
      if (page.data.some((row: any) => row.id === threadId)) return true;
      cursor = page.nextCursor ?? null;
      if (!cursor) return false;
      if (seen.has(cursor)) throw new Error("归档列表游标重复");
      seen.add(cursor);
    }
    throw new Error("归档确认超过读取预算，请显式核对归档列表");
  }
  private run<T>(key: string, work: () => Promise<T>) {
    const result = (this.serial.get(key) ?? Promise.resolve()).then(
      async () => {
        await this.load();
        return work();
      },
    );
    const settled = result.catch(() => {});
    this.serial.set(key, settled);
    void settled.finally(() => {
      if (this.serial.get(key) === settled) this.serial.delete(key);
    });
    return result;
  }
  private runOperation<T>(
    table: "resumes" | "settings" | "archives",
    operationId: string,
    threadId: string,
    work: () => Promise<T>,
  ) {
    // The durable receipt is keyed by operation, while the admission gate is
    // keyed by thread. Hold both: independent thread locks cannot reserve the
    // same receipt ID between an asynchronous disk read and the first save.
    const key = JSON.stringify([table, operationId]);
    const result = (this.receiptClaims.get(key) ?? Promise.resolve()).then(() =>
      this.run(threadId, work),
    );
    const settled = result.catch(() => {});
    this.receiptClaims.set(key, settled);
    void settled.finally(() => {
      if (this.receiptClaims.get(key) === settled)
        this.receiptClaims.delete(key);
    });
    return result;
  }
  private gateKey(threadId: string, context?: { namespace: string }) {
    return context ? JSON.stringify([context.namespace, threadId]) : threadId;
  }
  async assertWritable(threadId: string) {
    await this.load();
    const context = await this.options.context?.();
    if (Object.hasOwn(this.state.gates, this.gateKey(threadId, context)))
      conflict("会话正在归档或已归档，请先核对并显式恢复");
  }
  /** Wrap the whole admitted mutation, not just a preflight check. */
  async write<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    await this.load();
    const context = await this.options.context?.();
    const gateKey = this.gateKey(threadId, context);
    // No await between the final check and registering this writer.
    if (Object.hasOwn(this.state.gates, gateKey))
      conflict("会话正在归档或已归档，请先核对并显式恢复");
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const current = this.writers.get(gateKey) ?? new Set();
    current.add(done);
    this.writers.set(gateKey, current);
    try {
      return await work();
    } finally {
      finish();
      current.delete(done);
      if (!current.size) this.writers.delete(gateKey);
    }
  }
  async context() {
    if (!this.options.context)
      throw Object.assign(new Error("当前服务未提供原生运行范围核对"), {
        statusCode: 503,
      });
    return this.options.context();
  }
  private async capturedContext(expectedScope?: string) {
    if (!this.options.context) return undefined; // Isolated unit runtime only.
    const context = await this.context();
    if (!expectedScope || context.scopeToken !== expectedScope)
      conflict("账号或运行实例已变化，请重新确认当前目标");
    return context;
  }
  async receipt(operationId: string, expectedScope?: string) {
    await this.load();
    const context = await this.capturedContext(expectedScope);
    const r = await this.stored("resumes", operationId);
    if (!r) return null;
    if (context && r.namespace !== context.namespace)
      conflict("此回执属于其他账号或历史范围");
    return this.publicResume(r);
  }
  async settingsReceipt(operationId: string, expectedScope?: string) {
    await this.load();
    const context = await this.capturedContext(expectedScope);
    const r = await this.stored("settings", operationId);
    if (!r) return null;
    if (context && r.namespace !== context.namespace)
      conflict("此回执属于其他账号或历史范围");
    return this.publicResume(r);
  }
  async archiveReceipt(operationId: string, expectedScope?: string) {
    await this.load();
    const context = await this.capturedContext(expectedScope);
    const record = await this.stored("archives", operationId);
    if (!record) return null;
    if (context && record.namespace !== context.namespace)
      conflict("此回执属于其他账号或历史范围");
    // Read-only reconciliation may establish an accepted archive, never retry it.
    if (
      record.status === "unknown" &&
      record.stage === "archiving" &&
      (await this.isArchived(record.threadId, record.cwd))
    ) {
      await this.capturedContext(expectedScope);
      record.status = "archived";
      record.stage = "archived";
      delete record.error;
      await this.save();
    }
    return this.publicArchive(record);
  }
  private settingMutation(
    input: SettingsIntent,
    method: "thread/settings/update" | "thread/name/set",
  ): Promise<ResumeReceipt> {
    return this.runOperation(
      "settings",
      input.operationId,
      input.threadId,
      async () => {
        const context = await this.capturedContext(input.expectedScope);
        const hash = fingerprint({ method, ...input }),
          previous = await this.stored("settings", input.operationId);
        if (previous) {
          if (previous.fingerprint !== hash)
            conflict("同一操作标识不能用于不同的设置请求");
          if (context && previous.namespace !== context.namespace)
            conflict("此回执属于其他账号或历史范围");
          return this.publicResume(previous);
        }
        await this.assertWritable(input.threadId);
        this.admitNewReceipt();
        const record: StoredResume = {
          operationId: input.operationId,
          threadId: input.threadId,
          sourceTurnId: method,
          fingerprint: hash,
          status: "unknown",
          at: Date.now(),
          ...(context ? { namespace: context.namespace } : {}),
        };
        this.state.settings[input.operationId] = record;
        await this.save();
        let attempted = false;
        try {
          await this.capturedContext(input.expectedScope);
          const params = { ...input.parameters, threadId: input.threadId };
          attempted = true;
          if (context)
            await this.options.runtime.guardedCall!(
              method,
              params,
              context.scopeToken,
            );
          else await this.options.runtime.call(method, params);
          record.status = "accepted";
        } catch (error) {
          record.error = errorText(error);
          if (!attempted || (error as any)?.definitelyRejected === true)
            record.status = "rejected";
        }
        await this.save();
        return this.publicResume(record);
      },
    );
  }
  settings(input: SettingsIntent) {
    return this.settingMutation(input, "thread/settings/update");
  }
  rename(input: SettingsIntent) {
    return this.settingMutation(input, "thread/name/set");
  }
  resume(input: ResumeIntent): Promise<ResumeReceipt> {
    return this.runOperation(
      "resumes",
      input.operationId,
      input.threadId,
      async () => {
        const context = await this.capturedContext(input.expectedScope);
        const hash = fingerprint(input),
          previous = await this.stored("resumes", input.operationId);
        if (previous) {
          if (previous.fingerprint !== hash)
            conflict("同一操作标识不能用于不同的恢复请求");
          if (context && previous.namespace !== context.namespace)
            conflict("此回执属于其他账号或历史范围");
          return this.publicResume(previous);
        }
        this.admitNewReceipt();
        await this.assertWritable(input.threadId);
        const receipt: StoredResume = {
          operationId: input.operationId,
          threadId: input.threadId,
          sourceTurnId: input.sourceTurnId,
          status: "rejected",
          fingerprint: hash,
          at: Date.now(),
          ...(context ? { namespace: context.namespace } : {}),
        };
        const duplicate = Object.values(this.state.resumes).find(
          (r) =>
            r.threadId === input.threadId &&
            r.sourceTurnId === input.sourceTurnId &&
            r.namespace === context?.namespace &&
            r.status !== "rejected",
        );
        if (duplicate) {
          receipt.status =
            duplicate.status === "unknown" ? "unknown" : "rejected";
          receipt.error =
            duplicate.status === "unknown"
              ? "其他页面已提交此恢复操作，回执待核对；不会重复提交"
              : "其他页面已恢复此轮次，请查看最新会话";
          this.state.resumes[input.operationId] = receipt;
          await this.save();
          return this.publicResume(receipt);
        }
        this.state.resumes[input.operationId] = receipt; // Reserve the operation ID before asynchronous preflights.
        const thread = await this.snapshot(input.threadId);
        const latest = thread?.turns?.at(-1);
        const queue = await this.options.followups.inspect(input.threadId);
        const goal = (
          await this.options.runtime.call("thread/goal/get", {
            threadId: input.threadId,
          })
        )?.goal;
        const nativeQueue = await this.options.runtime.call(
          "thread/queue/list",
          { threadId: input.threadId, limit: 1 },
        );
        if (!Array.isArray(nativeQueue?.data))
          throw new Error("无法确认原生队列状态");
        if (
          !thread ||
          thread.id !== input.threadId ||
          !["idle", "notLoaded"].includes(thread.status?.type) ||
          latest?.id !== input.sourceTurnId ||
          latest.status !== "interrupted"
        )
          receipt.error = "原中断轮次已变化，请查看最新会话";
        else if (
          queued(queue.items) ||
          nativeQueue?.data?.length ||
          activeGoal(goal)
        )
          receipt.error = "请先处理待发队列或活动 Goal，再恢复此轮次";
        if (receipt.error) {
          this.state.resumes[input.operationId] = receipt;
          await this.save();
          return this.publicResume(receipt);
        }
        receipt.status = "unknown"; // Persist BEFORE the only possible native write.
        this.state.resumes[input.operationId] = receipt;
        await this.save();
        let attempted = false;
        try {
          await this.capturedContext(input.expectedScope);
          const params = {
            ...input.parameters,
            threadId: input.threadId,
            input: [],
          };
          attempted = true;
          const result = context
            ? await this.options.runtime.guardedCall!(
                "turn/start",
                params,
                context.scopeToken,
              )
            : await this.options.runtime.call("turn/start", params);
          if (typeof result?.turn?.id !== "string")
            throw new Error("恢复已提交，但尚未确认新的轮次");
          receipt.status = "accepted";
          receipt.turnId = result.turn.id;
        } catch (error) {
          receipt.error = errorText(error);
          if (!attempted || (error as any)?.definitelyRejected === true)
            receipt.status = "rejected";
        }
        await this.save();
        return this.publicResume(receipt);
      },
    );
  }
  private publicResume(value: StoredResume): ResumeReceipt {
    const {
      fingerprint: _,
      at: __,
      sourceTurnId: ___,
      namespace: ____,
      ...r
    } = value;
    return structuredClone(r);
  }
  private publicArchive(value: StoredArchive): ArchiveReceipt {
    const {
      fingerprint: _,
      at: __,
      mode: ___,
      expectedTurnId: ____,
      namespace: _____,
      cwd: ______,
      ...r
    } = value;
    return structuredClone(r);
  }
  archive(input: ArchiveIntent): Promise<ArchiveReceipt> {
    return this.runOperation(
      "archives",
      input.operationId,
      input.threadId,
      async () => {
        const context = await this.capturedContext(input.expectedScope);
        const hash = fingerprint(input),
          previous = await this.stored("archives", input.operationId);
        if (previous) {
          if (previous.fingerprint !== hash)
            conflict("同一操作标识不能用于不同的归档请求");
          if (context && previous.namespace !== context.namespace)
            conflict("此回执属于其他账号或历史范围");
          return this.publicArchive(previous);
        }
        this.admitNewReceipt();
        await this.assertWritable(input.threadId);
        const { expectedScope: _expectedScope, ...metadata } = input;
        const r: StoredArchive = {
          ...metadata,
          status: "unknown",
          stage: "checking",
          fingerprint: hash,
          at: Date.now(),
          ...(context ? { namespace: context.namespace } : {}),
        };
        const gateKey = this.gateKey(input.threadId, context);
        this.state.gates[gateKey] = input.operationId;
        this.state.archives[input.operationId] = r;
        await this.save(); // Close new admission before awaiting any existing writer.
        await Promise.allSettled([...(this.writers.get(gateKey) ?? [])]);
        let mutated = false,
          nativeAttempted = false;
        try {
          const queue = await this.options.followups.inspect(input.threadId);
          if (
            queue.items.some(
              (m) => m.status === "sending" || m.status === "uncertain",
            )
          )
            conflict("消息送达结果待核对，尚未停止或归档");
          let thread = await this.snapshot(input.threadId);
          if (thread?.id !== input.threadId) conflict("未确认原会话身份");
          if (typeof thread.cwd === "string") r.cwd = thread.cwd;
          let turn = thread.turns?.at(-1);
          const goal = (
            await this.options.runtime.call("thread/goal/get", {
              threadId: input.threadId,
            })
          )?.goal;
          const nativeQueue = await this.nativeQueue(input.threadId);
          let nativePauseProof = false;
          if (input.mode === "idle") {
            if (
              !["idle", "notLoaded", "systemError"].includes(
                thread.status?.type,
              ) ||
              queued(queue.items) ||
              nativeQueue.length ||
              activeGoal(goal)
            )
              conflict("普通归档仅适用于空闲且无待处理队列或活动 Goal 的会话");
          } else {
            if (
              nativeQueue.length &&
              !(
                thread.status?.type === "active" &&
                turn?.status === "inProgress" &&
                turn?.id === input.expectedTurnId
              )
            )
              conflict(
                "原生队列没有当前精确轮次的暂停证明，请先显式确认停止范围",
              );
            await this.options.followups.pause(input.threadId);
            mutated = true;
            r.stage = "queue-admission-frozen";
            await this.save();
            if (activeGoal(goal)) {
              const currentGoal = (
                await this.options.runtime.call("thread/goal/get", {
                  threadId: input.threadId,
                })
              )?.goal;
              if (fingerprint(currentGoal) !== fingerprint(goal))
                conflict("活动 Goal 已变化，请重新确认影响范围");
              const params = {
                threadId: input.threadId,
                status: "paused",
                origin: "user",
              };
              nativeAttempted = true;
              const result = context
                ? await this.options.runtime.guardedCall!(
                    "thread/goal/set",
                    params,
                    context.scopeToken,
                  )
                : await this.options.runtime.call("thread/goal/set", params);
              if (result?.goal?.status !== "paused")
                throw new Error("尚未确认 Goal 已暂停");
              r.stage = "goal-paused";
              await this.save();
            }
            if (
              thread.status?.type === "active" ||
              turn?.status === "inProgress"
            ) {
              if (!input.expectedTurnId || turn?.id !== input.expectedTurnId)
                conflict("当前轮次已变化，请重新确认停止范围");
              r.stage = "stopping";
              await this.save();
              const params = {
                threadId: input.threadId,
                turnId: input.expectedTurnId,
              };
              nativeAttempted = true;
              if (context)
                await this.options.runtime.guardedCall!(
                  "turn/interrupt",
                  params,
                  context.scopeToken,
                );
              else await this.options.runtime.call("turn/interrupt", params);
              // An interrupt acknowledgement is not evidence of terminal state.
              for (let attempt = 0; attempt < 50; attempt++) {
                thread = await this.snapshot(input.threadId);
                turn = thread?.turns?.at(-1);
                if (turn?.id !== input.expectedTurnId)
                  conflict("停止期间当前轮次已变化，尚未归档");
                if (
                  thread?.status?.type !== "active" &&
                  turn?.status !== "inProgress"
                )
                  break;
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              if (
                thread?.status?.type === "active" ||
                turn?.status === "inProgress"
              )
                throw new Error("正在等待精确轮次停止确认，尚未归档");
              nativePauseProof = turn?.status === "interrupted";
              if (nativeQueue.length && !nativePauseProof)
                conflict("当前轮次未返回原生中断终态，不能确认队列已暂停");
              r.stage = "native-queue-paused";
              await this.save();
            }
          }
          // External clients are outside our gate. Recheck immediately before archive.
          thread = await this.snapshot(input.threadId);
          const checkGoal = (
            await this.options.runtime.call("thread/goal/get", {
              threadId: input.threadId,
            })
          )?.goal;
          const checkQueue = await this.nativeQueue(input.threadId);
          if (
            thread?.id !== input.threadId ||
            !["idle", "notLoaded", "systemError"].includes(
              thread.status?.type,
            ) ||
            activeGoal(checkGoal) ||
            fingerprint(checkQueue) !== fingerprint(nativeQueue) ||
            (checkQueue.length > 0 && !nativePauseProof)
          )
            conflict("会话已被其他客户端更新，尚未归档");
          r.stage = "archiving";
          await this.save();
          mutated = true;
          nativeAttempted = true;
          if (context)
            await this.options.runtime.guardedCall!(
              "thread/archive",
              { threadId: input.threadId },
              context.scopeToken,
            );
          else
            await this.options.runtime.call("thread/archive", {
              threadId: input.threadId,
            });
          if (!(await this.isArchived(input.threadId, r.cwd)))
            throw new Error("归档请求已提交，尚未从官方归档列表确认结果");
          r.status = "archived";
          r.stage = "archived";
        } catch (error) {
          r.error = errorText(error);
          r.status =
            !nativeAttempted ||
            (error as any)?.statusCode === 409 ||
            (error as any)?.definitelyRejected === true
              ? "blocked"
              : "unknown";
          if (!mutated) delete this.state.gates[gateKey];
        }
        await this.save();
        return this.publicArchive(r);
      },
    );
  }
  /** An explicit restore changes membership only; queue and Goal remain paused. */
  restore(threadId: string, expectedScope?: string) {
    return this.run(threadId, async () => {
      const context = await this.capturedContext(expectedScope),
        gateKey = this.gateKey(threadId, context);
      const previous = this.state.gates[gateKey]
        ? await this.stored("archives", this.state.gates[gateKey])
        : undefined;
      if (
        context &&
        previous?.namespace &&
        previous.namespace !== context.namespace
      )
        conflict("归档记录属于其他账号或历史范围");
      if (context)
        await this.options.runtime.guardedCall!(
          "thread/unarchive",
          { threadId },
          context.scopeToken,
        );
      else await this.options.runtime.call("thread/unarchive", { threadId });
      delete this.state.gates[gateKey];
      await this.save();
      return { restored: true };
    });
  }
  /** Explicitly abandon a blocked local lifecycle operation; never resumes work. */
  release(threadId: string, expectedScope?: string) {
    return this.run(threadId, async () => {
      const context = await this.capturedContext(expectedScope),
        gateKey = this.gateKey(threadId, context);
      const op = this.state.gates[gateKey];
      if (!op) return { released: true };
      const record = await this.stored("archives", op);
      if (record?.status === "archived" || record?.status === "unknown")
        conflict("归档回执尚未确认，请先查看会话并恢复");
      delete this.state.gates[gateKey];
      await this.save();
      return { released: true };
    });
  }
}
