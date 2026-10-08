import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  emptyFollowupThread,
  composeContextText,
  type FollowupAction,
  type FollowupSubmit,
  type FollowupThread,
  type FollowupMessage,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "./durable-json.js";

export interface FollowupRuntime {
  statuses(ids: string[]): Promise<Record<string, string>>;
  call(method: string, params: Record<string, unknown>): Promise<any>;
}
export class FollowupRejected extends Error {}
const pending = (m: FollowupMessage) =>
  m.status !== "sent" && m.status !== "cancelled";
const conflict = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};

/** One gateway owns dispatch; browser replicas never execute the persisted outbox. */
export class CodexFollowups {
  private state: Record<string, FollowupThread> = {};
  private loaded = false;
  private serial: Promise<unknown> = Promise.resolve();
  private statuses: Record<string, string> = {};
  private errorRecoveryAllowed = new Set<string>();
  private activeTurns: Record<string, string> = {};
  private epochs: Record<string, number> = {};
  constructor(
    private runtime: FollowupRuntime,
    private file?: string,
  ) {}
  private run<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial.then(async () => {
      await this.load();
      return work();
    });
    this.serial = task.catch(() => {});
    return task;
  }
  private async load() {
    if (this.loaded) return;
    if (this.file)
      try {
        const saved = JSON.parse(await readFile(this.file, "utf8"));
        if (
          saved.version !== 1 ||
          !saved.threads ||
          typeof saved.threads !== "object" ||
          Array.isArray(saved.threads)
        )
          throw new Error("无法读取消息队列记录");
        for (const thread of Object.values(saved.threads) as FollowupThread[]) {
          if (
            !Array.isArray(thread.items) ||
            !Number.isSafeInteger(thread.revision)
          )
            throw new Error("消息队列记录损坏");
          if (
            thread.awaitingTurnId &&
            thread.items.some(pending) &&
            !thread.paused
          ) {
            thread.paused = "重新连接后等待任务完成确认";
            thread.revision++;
          }
          for (const item of thread.items)
            if (item.status === "sending") {
              item.status = "uncertain";
              item.error = "服务重启前的发送结果尚未确认，请先查看对话";
              thread.paused = "送达结果待确认";
              thread.revision++;
            } else if (item.status === "queued" && item.mode === "steer") {
              item.status = "failed";
              item.error = "重启前的引导尚未提交，请确认目标轮次后操作";
              thread.paused = "待重新确认引导";
              thread.revision++;
            }
        }
        this.state = saved.threads;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    this.loaded = true;
  }
  private thread(id: string) {
    return this.state[id] ?? (this.state[id] = emptyFollowupThread());
  }
  private async save() {
    if (this.file)
      await writeDurableJson(this.file, { version: 1, threads: this.state });
  }
  private snapshot(id: string) {
    return structuredClone(this.thread(id));
  }
  private async transaction(work: () => void) {
    const before = structuredClone(this.state);
    try {
      work();
      await this.save();
    } catch (error) {
      this.state = before;
      throw error;
    }
  }
  async drain() {
    await this.serial;
  }
  recover(reason: string) {
    for (const id of Object.keys(this.state))
      this.epochs[id] = (this.epochs[id] ?? 0) + 1;
    return this.run(async () => {
      this.statuses = {};
      this.errorRecoveryAllowed.clear();
      await this.transaction(() => {
        for (const thread of Object.values(this.state))
          if (thread.items.some(pending) && !thread.paused) {
            thread.paused = reason;
            thread.revision++;
          }
      });
    });
  }
  review(
    id: string,
    delivery: "inline" | "detached",
    target: Record<string, unknown>,
  ) {
    return this.run(async () => {
      const thread = this.thread(id);
      if (delivery === "inline") {
        const status = await this.runtime.statuses([id]);
        if (
          !["idle", "systemError"].includes(status[id]) ||
          (!thread.paused && thread.items.some(pending))
        )
          conflict("请等待当前任务结束并暂停队列，或选择独立审查");
      }
      let result: any;
      try {
        result = await this.runtime.call("review/start", {
          threadId: id,
          delivery,
          target,
        });
      } catch (error) {
        // Current Codex paginated history rejects detached review before starting it.
        if (
          delivery !== "detached" ||
          !(error instanceof FollowupRejected) ||
          !error.message.includes(
            "paginated threads do not support detached review",
          )
        )
          throw error;
        const fork = await this.runtime.call("thread/fork", { threadId: id });
        if (typeof fork?.thread?.id !== "string" || fork.thread.id === id)
          throw new Error("服务未返回独立审查会话");
        result = await this.runtime.call("review/start", {
          threadId: fork.thread.id,
          delivery: "inline",
          target,
        });
      }
      if (
        typeof result?.reviewThreadId !== "string" ||
        typeof result?.turn?.id !== "string"
      )
        throw new Error("审查启动结果尚未确认，请先查看会话");
      const targetThread = this.thread(result.reviewThreadId);
      await this.transaction(() => {
        targetThread.awaitingTurnId = result.turn.id;
        targetThread.review = { turnId: result.turn.id, status: "inProgress" };
        targetThread.revision++;
      });
      this.activeTurns[result.reviewThreadId] = result.turn.id;
      this.statuses[result.reviewThreadId] = "active";
      return result;
    });
  }
  get(id: string) {
    return this.run(async () => this.snapshot(id));
  }
  submit(value: FollowupSubmit): Promise<FollowupThread> {
    return this.run(async () => {
      const data = structuredClone(value),
        thread = this.thread(data.threadId);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
      const previous = thread.items.find((m) => m.id === data.id);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          conflict("同一请求标识不能用于不同消息");
        return this.snapshot(data.threadId);
      }
      if (thread.items.filter(pending).length >= 100)
        conflict("队列已满，请处理已有消息");
      if (data.mode !== "queue" && !data.expectedTurnId)
        conflict("正在同步当前任务，请稍后重试");
      if (data.mode === "replace" && thread.stopTurnId)
        conflict("正在等待当前任务停止");
      // This is explicit new input after a visible error, not permission to drain
      // messages queued before the failure. Persisted paused queues still require Resume.
      if (data.recoverAfterError && data.mode === "queue" && !thread.paused && !thread.awaitingTurnId && !thread.items.some(pending)) {
        this.statuses[data.threadId] = "systemError";
        this.errorRecoveryAllowed.add(data.threadId);
      }
      const item: FollowupMessage = {
        ...data,
        fingerprint,
        status: "queued",
        createdAt: Date.now(),
      };
      await this.transaction(() => {
        thread.items.push(item);
        thread.revision++;
      });
      if (data.mode === "steer") await this.deliver(data.threadId, item, true);
      if (data.mode === "replace") {
        await this.transaction(() => {
          thread.paused = "停止后队列已暂停";
          thread.replacementId = item.id;
          thread.stopTurnId = data.expectedTurnId;
          thread.revision++;
        });
        try {
          await this.runtime.call("turn/interrupt", {
            threadId: data.threadId,
            turnId: data.expectedTurnId,
          });
        } catch (error) {
          await this.transaction(() => {
            item.status =
              error instanceof FollowupRejected ? "failed" : "uncertain";
            item.error = String(error);
            delete thread.replacementId;
            delete thread.stopTurnId;
            thread.revision++;
          });
        }
      }
      return this.snapshot(data.threadId);
    });
  }
  change(
    id: string,
    revision: number,
    action: FollowupAction,
  ): Promise<FollowupThread> {
    return this.run(async () => {
      const thread = this.thread(id);
      if (thread.revision !== revision)
        conflict("队列已在其他页面更新，请查看最新状态后重试");
      const item =
        "id" in action
          ? thread.items.find((m) => m.id === action.id)
          : undefined;
      if ("id" in action && (!item || !pending(item)))
        conflict("消息已发送或移除");
      if (item?.status === "sending") conflict("消息正在发送，暂时不能修改");
      if (action.type === "steer" && !action.expectedTurnId)
        conflict("尚未获取当前任务");
      if (
        item?.status === "uncertain" &&
        !("confirmUncertain" in action && action.confirmUncertain) &&
        action.type !== "delete"
      )
        conflict("请先确认这条消息未送达，再重试");
      await this.transaction(() => {
        const before = item && (action.type === "delete" || action.type === "edit")
          && ["queued", "failed"].includes(item.status) && item.mode === "queue"
          ? structuredClone(item) : undefined;
        switch (action.type) {
          case "undo": {
            const saved = thread.undo;
            if (!saved || saved.token !== action.token || saved.expiresAt < Date.now())
              return conflict("此操作已无法撤销，请查看当前队列");
            const current = thread.items.find(m => m.id === saved.before.id);
            if (!current || JSON.stringify(current) !== JSON.stringify(saved.after))
              conflict("消息已发送或发生变化，无法撤销；请勿重复发送");
            thread.items = thread.items.filter(m => m.id !== saved.before.id);
            thread.items.splice(Math.min(saved.index, thread.items.length), 0, structuredClone(saved.before));
            delete thread.undo;
            break;
          }
          case "pause":
            thread.paused = "队列已暂停";
            break;
          case "resume":
            if (
              thread.items.some(
                (m) => m.status === "uncertain" || m.status === "failed",
              )
            )
              conflict("请先处理失败或送达不明的消息");
            thread.paused = null;
            this.errorRecoveryAllowed.add(id);
            delete thread.awaitingTurnId;
            delete thread.stopTurnId;
            break;
          case "clear":
            if (thread.items.some((m) => m.status === "sending"))
              conflict("请等待发送完成后清空");
            for (const m of thread.items)
              if (pending(m)) m.status = "cancelled";
            thread.paused = null;
            delete thread.replacementId;
            delete thread.stopTurnId;
            delete thread.undo;
            break;
          case "delete":
            item!.status = "cancelled";
            if (thread.replacementId === item!.id) delete thread.replacementId;
            break;
          case "edit":
            if (composeContextText(action.text, item!.contexts).length > 200_000)
              conflict("正文与上下文合计不能超过 200,000 字符");
            if (!action.text.trim() && !item!.images.length && !item!.contexts?.length)
              conflict("消息不能为空");
            item!.text = action.text;
            item!.error = undefined;
            if (item!.status === "failed") item!.status = "queued";
            break;
          case "retry":
            item!.status = "queued";
            item!.error = undefined;
            item!.mode = "queue";
            thread.paused = null;
            break;
          case "steer":
            item!.mode = "steer";
            item!.expectedTurnId = action.expectedTurnId;
            break;
          case "reorder": {
            const items = thread.items.filter(pending);
            if (
              action.ids.length !== items.length ||
              new Set(action.ids).size !== items.length ||
              items.some((m) => !action.ids.includes(m.id))
            )
              conflict("排序必须包含当前所有待发送消息");
            thread.items = [
              ...action.ids.map((key) => items.find((m) => m.id === key)!),
              ...thread.items.filter((m) => !pending(m)),
            ];
            break;
          }
        }
        if (before) thread.undo = {
          token: randomUUID(), kind: action.type as "edit" | "delete",
          before, after: structuredClone(item!), index: thread.items.findIndex(m => m.id === before.id),
          expiresAt: Date.now() + 10 * 60_000,
        };
        thread.revision++;
      });
      if (action.type === "steer") await this.deliver(id, item!, true);
      return this.snapshot(id);
    });
  }
  stop(id: string, turnId: string): Promise<void> {
    return this.run(async () => {
      const thread = this.thread(id);
      await this.transaction(() => {
        thread.paused = "你已停止当前任务，队列已暂停";
        thread.stopTurnId = turnId;
        thread.revision++;
      });
      await this.runtime.call("turn/interrupt", { threadId: id, turnId });
    });
  }
  observe(event: any): Promise<void> {
    // Advance before queueing behind a network request, so a stale snapshot cannot dispatch.
    const eventId = event?.params?.threadId ?? event?.params?.thread?.id;
    if (
      typeof eventId !== "string" ||
      ![
        "thread/started",
        "thread/status/changed",
        "turn/started",
        "turn/completed",
        "error",
      ].includes(event.method)
    )
      return Promise.resolve();
    this.epochs[eventId] = (this.epochs[eventId] ?? 0) + 1;
    return this.run(async () => {
      const p = event?.params,
        id = p?.threadId ?? p?.thread?.id;
      if (typeof id !== "string") return;
      if (event.method === "thread/started") {
        if (!this.statuses[id] || this.statuses[id] === "unknown")
          this.statuses[id] = p.thread.status?.type;
        return;
      }
      if (event.method === "thread/status/changed") {
        const previous = this.statuses[id];
        this.statuses[id] = p.status?.type;
        if (p.status?.type === "systemError" && previous !== "systemError") {
          this.errorRecoveryAllowed.delete(id);
          if (this.state[id]) await this.transaction(() => {
            this.state[id].paused ??= "上一轮执行失败，请检查后继续";
            this.state[id].revision++;
          });
        }
        return;
      }
      if (event.method === "turn/started") {
        this.errorRecoveryAllowed.delete(id);
        this.statuses[id] = "active";
        this.activeTurns[id] = p.turn.id;
        const thread = this.state[id];
        if (
          thread?.review?.status === "inProgress" &&
          !thread.review.executionTurnId
        )
          await this.transaction(() => {
            thread.review!.executionTurnId = p.turn.id;
            thread.revision++;
          });
        return;
      }
      if (event.method === "error") {
        if (p.willRetry || !this.state[id]) return;
        const active = this.activeTurns[id] ?? this.state[id].awaitingTurnId;
        if (active && active !== p.turnId) return;
        this.errorRecoveryAllowed.delete(id);
        this.statuses[id] = "systemError";
        await this.transaction(() => {
          this.state[id].paused = "当前任务报告错误，请检查后继续";
          this.state[id].revision++;
        });
        return;
      }
      if (event.method !== "turn/completed") return;
      if (
        this.activeTurns[id] &&
        this.activeTurns[id] !== p.turn?.id &&
        this.state[id]?.review?.turnId !== p.turn?.id
      )
        return;
      delete this.activeTurns[id];
      this.errorRecoveryAllowed.delete(id);
      this.statuses[id] = p.turn.status === "failed" ? "systemError" : "idle";
      const thread = this.state[id];
      if (!thread) return;
      await this.transaction(() => {
        if (
          thread.review &&
          [thread.review.turnId, thread.review.executionTurnId].includes(
            p.turn.id,
          )
        ) {
          thread.review.status = p.turn.status;
          thread.review.durationMs = p.turn.durationMs ?? null;
          if (thread.stopTurnId === thread.review.executionTurnId)
            delete thread.stopTurnId;
          if (thread.awaitingTurnId === thread.review.turnId)
            delete thread.awaitingTurnId;
        }
        if (thread.stopTurnId === p.turn.id) delete thread.stopTurnId;
        if (thread.awaitingTurnId === p.turn.id) {
          delete thread.awaitingTurnId;
          if (
            thread.paused === "重新连接后等待任务完成确认" &&
            p.turn.status === "completed"
          )
            thread.paused = null;
        }
        if (p.turn.status === "failed" || p.turn.status === "interrupted")
          thread.paused =
            p.turn.status === "failed"
              ? "上一轮执行失败，请检查后继续"
              : "当前任务已中断，队列已暂停";
        thread.revision++;
      });
    });
  }
  tick(): Promise<void> {
    return this.run(async () => {
      const ids = Object.keys(this.state).filter((id) =>
        this.state[id].items.some((m) => m.status === "queued"),
      );
      if (!ids.length) return;
      const epochs = { ...this.epochs };
      let fresh: Record<string, string>;
      try {
        fresh = await this.runtime.statuses(ids);
      } catch {
        return;
      }
      for (const id of ids) {
        if (epochs[id] !== this.epochs[id]) continue;
        this.statuses[id] = fresh[id] ?? this.statuses[id] ?? "unknown";
        const thread = this.thread(id);
        if (this.statuses[id] === "systemError" && !this.errorRecoveryAllowed.has(id)) {
          if (!thread.paused) await this.transaction(() => { thread.paused = "上一轮执行失败，请检查后继续"; thread.revision++; });
          continue;
        }
        if (
          // systemError is a finished turn too. The pause below still requires
          // explicit recovery; a resumed queue must be able to start a new turn.
          !["idle", "systemError"].includes(this.statuses[id]) ||
          thread.stopTurnId ||
          thread.awaitingTurnId
        )
          continue;
        const item = thread.replacementId
          ? thread.items.find((m) => m.id === thread.replacementId)
          : thread.paused
            ? undefined
            : thread.items.find(pending);
        if (!item || item.status !== "queued") continue;
        await this.deliver(id, item, false);
      }
    });
  }
  private async deliver(id: string, item: FollowupMessage, steer: boolean) {
    const thread = this.thread(id);
    await this.transaction(() => {
      item.status = "sending";
      item.error = undefined;
      thread.revision++;
    });
    const text = composeContextText(item.text, item.contexts);
    const input = [
      ...(text.trim()
        ? [{ type: "text", text, text_elements: [] }]
        : []),
      ...item.images.map((path) => ({ type: "localImage", path })),
    ];
    let response: any;
    try {
      response = await this.runtime.call(
        steer ? "turn/steer" : "turn/start",
        steer
          ? {
              threadId: id,
              expectedTurnId: item.expectedTurnId,
              input,
              clientUserMessageId: item.id,
            }
          : {
              ...item.parameters,
              threadId: id,
              input,
              clientUserMessageId: item.id,
            },
      );
      const turnId = steer ? response?.turnId : response?.turn?.id;
      if (typeof turnId !== "string") throw new Error("服务未返回消息接收凭据");
      // Record accepted delivery before considering another message. Persistence failure must not retry it.
      item.status = "sent";
      item.turnId = turnId;
      thread.awaitingTurnId = turnId;
      thread.revision++;
      this.errorRecoveryAllowed.delete(id);
      this.activeTurns[id] = turnId;
      this.statuses[id] = "active";
      if (thread.replacementId === item.id) delete thread.replacementId;
      await this.save();
    } catch (error) {
      item.status = error instanceof FollowupRejected ? "failed" : "uncertain";
      item.error = error instanceof Error ? error.message : String(error);
      thread.paused =
        item.status === "uncertain" ? "送达结果待确认" : "消息发送失败";
      thread.revision++;
      await this.save();
    }
  }
}
