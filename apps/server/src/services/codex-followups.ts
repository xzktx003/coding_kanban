import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  emptyFollowupThread,
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
  private activeTurns: Record<string, string> = {};
  private epoch = 0;
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
          for (const item of thread.items)
            if (item.status === "sending") {
              item.status = "uncertain";
              item.error = "服务重启前的发送结果尚未确认，请先查看对话";
              thread.paused = "送达结果待确认";
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
        switch (action.type) {
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
            break;
          case "delete":
            item!.status = "cancelled";
            if (thread.replacementId === item!.id) delete thread.replacementId;
            break;
          case "edit":
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
    this.epoch++;
    return this.run(async () => {
      const p = event?.params,
        id = p?.threadId;
      if (typeof id !== "string") return;
      if (event.method === "thread/status/changed") {
        this.statuses[id] = p.status?.type;
        return;
      }
      if (event.method === "turn/started") {
        this.statuses[id] = "active";
        this.activeTurns[id] = p.turn.id;
        return;
      }
      if (event.method !== "turn/completed") return;
      if (this.activeTurns[id] && this.activeTurns[id] !== p.turn?.id) return;
      delete this.activeTurns[id];
      this.statuses[id] = "idle";
      const thread = this.state[id];
      if (!thread) return;
      await this.transaction(() => {
        if (thread.stopTurnId === p.turn.id) delete thread.stopTurnId;
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
      const epoch = this.epoch;
      let fresh: Record<string, string>;
      try {
        fresh = await this.runtime.statuses(ids);
      } catch {
        return;
      }
      if (epoch !== this.epoch) return;
      for (const id of ids) {
        this.statuses[id] = fresh[id] ?? "unknown";
        const thread = this.thread(id);
        if (this.statuses[id] !== "idle" || thread.stopTurnId) continue;
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
    const input = [
      ...(item.text.trim()
        ? [{ type: "text", text: item.text, text_elements: [] }]
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
      thread.revision++;
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
