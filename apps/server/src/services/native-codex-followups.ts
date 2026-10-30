import { randomUUID } from "node:crypto";
import {
  NativeQueueActions,
  actionHash,
  type NativeActionRecord,
} from "./native-queue-actions.js";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  composeContextText,
  type FollowupAction,
  type FollowupMessage,
  type FollowupSubmit,
  type FollowupThread,
  type NativeSteerReference,
} from "@agent-orchestrator/shared";
import { FollowupRejected, type FollowupRuntime } from "./codex-followups.js";
import { writeDurableJson } from "./durable-json.js";
import { NativeSteerReceipts } from "./native-steer-receipts.js";

interface Receipt {
  fingerprint: string;
  kind?: "review";
  reviewThreadId?: string;
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
  threadId: string;
  id: string;
  status: "accepted" | "uncertain" | "failed";
  createdAt: number;
  nativeId?: string;
  turnId?: string;
  legacyId?: string;
  namespace?: string;
  dismissed?: boolean;
  retryOperationId?: string;
  error?: string;
  /** Steer keeps its unique text until the display ledger is durably accepted. */
  content?: FollowupSubmit;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}
const inputFor = (
  item: Pick<FollowupSubmit, "text" | "images" | "contexts" | "mentions">,
) => {
  const text = composeContextText(item.text, item.contexts);
  return [
    ...(item.mentions ?? []).map((m) => ({
      type: "mention",
      name: m.name,
      path: m.path,
    })),
    ...(text.trim() ? [{ type: "text", text, text_elements: [] }] : []),
    ...item.images.map((path) => ({ type: "localImage", path })),
  ];
};
const settingsFields = new Set([
  "cwd",
  "model",
  "effort",
  "serviceTier",
  "approvalPolicy",
  "approvalsReviewer",
  "permissions",
  "sandboxPolicy",
  "collaborationMode",
  "personality",
]);
const BUDGET = 8 * 1024 * 1024;

/** Official queue is the sole execution scheduler. This adapter only records
 * submission certainty; tick/reconnect never calls turn/start or replays add.
 * Receipt files are addressed by hash and read on demand, avoiding an ever-growing
 * in-memory UUID set while preserving idempotency across gateway restarts.
 */
export class NativeCodexFollowups {
  private serial = new Map<string, Promise<unknown>>();
  private memory = new Map<string, Receipt>();
  private reviewTargets = new Map<
    string,
    { source: string; operationId: string }
  >();
  private snapshots = new Map<
    string,
    {
      revision: number;
      fingerprint: string;
      paused: string | null;
      namespace?: string;
    }
  >();
  private actions = new NativeQueueActions((id) => this.directory(id));
  private steerDisplay = new NativeSteerReceipts((id) => this.directory(id));
  constructor(
    private runtime: FollowupRuntime,
    private legacyFile?: string,
  ) {}
  private async context(expectedScope?: string) {
    const context = await this.runtime.context?.();
    if (context && (!expectedScope || context.scope !== expectedScope))
      conflict("账号或运行服务已变化，消息尚未提交，请核对当前目标");
    return context;
  }
  private call(
    method: string,
    params: Record<string, unknown>,
    context?: { scope: string; namespace: string },
  ) {
    return context && this.runtime.guardedCall
      ? this.runtime.guardedCall(method, params, context.scope)
      : this.runtime.call(method, params);
  }
  private async applySettings(
    threadId: string,
    parameters: Record<string, unknown>,
    context?: { scope: string; namespace: string },
  ) {
    try {
      return await this.call(
        "thread/settings/update",
        { ...parameters, threadId },
        context,
      );
    } catch (error) {
      if (
        !(error instanceof FollowupRejected) ||
        !/thread (?:not found|is not loaded)|not loaded thread/i.test(
          error.message,
        )
      )
        throw error;
      // This path belongs only to an explicit user submission, never a history
      // read or a background warm-up. Loading can wake persistent native work.
      const [queue, goal, metadata] = await Promise.all([
        this.native(threadId),
        this.runtime.call("thread/goal/get", { threadId }),
        this.runtime.call("thread/read", { threadId, includeTurns: false }),
      ]);
      if (
        queue.length ||
        goal?.goal?.status === "active" ||
        metadata?.thread?.status?.type === "active"
      )
        conflict(
          "冷会话仍有原生队列或活动 Goal，请先显式确认继续范围；消息未提交",
        );
      await this.call("thread/resume", { threadId }, context);
      return this.call(
        "thread/settings/update",
        { ...parameters, threadId },
        context,
      );
    }
  }
  private directory(threadId: string) {
    return this.legacyFile
      ? join(this.legacyFile + ".official", digest(threadId))
      : null;
  }
  private run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.serial.get(id) ?? Promise.resolve()).then(work);
    const settled = result.catch(() => {});
    this.serial.set(id, settled);
    void settled.finally(() => {
      if (this.serial.get(id) === settled) this.serial.delete(id);
    });
    return result;
  }
  private async receipt(
    threadId: string,
    id: string,
  ): Promise<Receipt | undefined> {
    const dir = this.directory(threadId);
    if (!dir) return this.memory.get(`${threadId}:${id}`);
    const file = digest(id) + ".json";
    for (const section of ["receipts", "pending"])
      try {
        const result = JSON.parse(
          await readFile(join(dir, section, file), "utf8"),
        );
        if (
          result.id !== id ||
          result.threadId !== threadId ||
          typeof result.fingerprint !== "string" ||
          !["accepted", "uncertain", "failed"].includes(result.status)
        )
          throw new Error("官方消息回执记录损坏，禁止重发");
        return result;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    return undefined;
  }
  private async save(receipt: Receipt) {
    const dir = this.directory(receipt.threadId);
    if (!dir) {
      this.memory.set(
        `${receipt.threadId}:${receipt.id}`,
        structuredClone(receipt),
      );
      return;
    }
    const file = digest(receipt.id) + ".json";
    const section =
      receipt.status === "accepted" || receipt.dismissed
        ? "receipts"
        : "pending";
    await writeDurableJson(join(dir, section, file), receipt);
    if (section === "receipts") {
      const recent = (await this.accepted(receipt.threadId)).filter(
        (r) => r.id !== receipt.id,
      );
      const metadata = { ...receipt };
      delete metadata.content;
      recent.push(metadata);
      await writeDurableJson(join(dir, "recent.json"), recent.slice(-100));
      await rm(join(dir, "pending", file), { force: true });
      await rm(join(dir, "pending", file + ".bak"), { force: true });
    }
  }
  private async accepted(id: string): Promise<Receipt[]> {
    const dir = this.directory(id);
    if (!dir)
      return [...this.memory.values()]
        .filter(
          (r) => r.threadId === id && (r.status === "accepted" || r.dismissed),
        )
        .slice(-100);
    try {
      const rows = JSON.parse(await readFile(join(dir, "recent.json"), "utf8"));
      if (
        !Array.isArray(rows) ||
        rows.length > 100 ||
        rows.some(
          (r) =>
            r.threadId !== id ||
            (r.status !== "accepted" && !r.dismissed) ||
            typeof r.id !== "string" ||
            r.content !== undefined,
        )
      )
        throw new Error("官方消息接收元数据损坏");
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private async pending(id: string): Promise<Receipt[]> {
    const dir = this.directory(id);
    if (!dir)
      return [...this.memory.values()].filter(
        (r) => r.threadId === id && r.status !== "accepted" && !r.dismissed,
      );
    let files: string[];
    try {
      files = await readdir(join(dir, "pending"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const pending = files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file));
    if (pending.length > 100) conflict("待核对消息过多，请先处理已有消息");
    const result: Receipt[] = [];
    let bytes = 0;
    for (const name of pending) {
      const path = join(dir, "pending", name);
      const info = await stat(path);
      bytes += info.size;
      if (bytes > BUDGET) conflict("待核对消息超过显示预算，请先处理已有消息");
      const receipt = JSON.parse(await readFile(path, "utf8")) as Receipt;
      if (receipt.threadId !== id || typeof receipt.id !== "string")
        throw new Error("官方消息回执记录损坏");
      // A durable accepted receipt wins if cleanup was interrupted.
      const accepted = await this.receipt(id, receipt.id);
      if (accepted?.status !== "accepted" && !accepted?.dismissed)
        result.push(receipt);
    }
    return result;
  }
  private async legacy(id: string): Promise<FollowupMessage[]> {
    if (!this.legacyFile) return [];
    let saved: any;
    try {
      if ((await stat(this.legacyFile)).size > 16 * 1024 * 1024)
        conflict("旧队列文件过大，请先核对旧队列");
      saved = JSON.parse(await readFile(this.legacyFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (saved?.version !== 1 || !saved.threads || Array.isArray(saved.threads))
      throw new Error("旧队列记录损坏，已阻止覆盖");
    const items = saved.threads[id]?.items ?? [];
    if (!Array.isArray(items)) throw new Error("旧队列记录损坏");
    const result: FollowupMessage[] = [];
    for (const item of items)
      if (!["sent", "cancelled"].includes(item.status)) {
        const discard = await this.receipt(
          id,
          `discard_${digest([id, item.id]).slice(0, 48)}`,
        );
        if (discard?.dismissed) continue;
        const migration = await this.receipt(
          id,
          `migrate_${digest([id, item.id]).slice(0, 48)}`,
        );
        if (
          migration?.status === "accepted" ||
          migration?.status === "uncertain"
        )
          continue;
        result.push({
          ...item,
          authority: "legacy",
          error:
            "旧队列内容与逐条设置已保留；确认切换为线程设置后才能迁入官方队列",
        });
      }
    return result;
  }
  private async native(id: string) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    const rows: any[] = [];
    do {
      const page = await this.runtime.call("thread/queue/list", {
        threadId: id,
        limit: 50,
        cursor,
      });
      if (!Array.isArray(page?.data)) throw new Error("官方队列返回无效状态");
      rows.push(...page.data);
      if (Buffer.byteLength(JSON.stringify(rows)) > BUDGET)
        conflict("官方队列超过显示预算；内容仍保存在官方服务中");
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor)) throw new Error("官方队列游标重复");
      if (cursor) seen.add(cursor);
      if (seen.size > 100) throw new Error("官方队列分页超过读取预算");
    } while (cursor);
    return rows;
  }
  private project(threadId: string, value: any): FollowupMessage {
    if (
      typeof value?.id !== "string" ||
      typeof value.clientUserMessageId !== "string" ||
      !Array.isArray(value.input)
    )
      throw new Error("官方队列消息身份无效");
    return {
      id: `native_${value.id}`,
      threadId,
      authority: "native",
      nativeQueuedSubmissionId: value.id,
      nativeClientUserMessageId: value.clientUserMessageId,
      text: value.input
        .filter((i: any) => i.type === "text" && typeof i.text === "string")
        .map((i: any) => i.text)
        .join("\n"),
      images: value.input
        .filter(
          (i: any) => i.type === "localImage" && typeof i.path === "string",
        )
        .map((i: any) => i.path),
      parameters: {},
      mode: "queue",
      status: "queued",
      createdAt: 0,
      fingerprint: digest(value),
    };
  }
  private async snapshot(id: string): Promise<FollowupThread> {
    const context = await this.runtime.context?.();
    const native = await this.native(id),
      items = native.map((row) => this.project(id, row));
    const ids = new Set(items.map((item) => item.nativeClientUserMessageId));
    for (const receipt of await this.pending(id)) {
      if (receipt.namespace !== context?.namespace) continue;
      if (ids.has(receipt.id)) {
        receipt.status = "accepted";
        receipt.nativeId = items.find(
          (item) => item.nativeClientUserMessageId === receipt.id,
        )?.nativeQueuedSubmissionId;
        delete receipt.content;
        delete receipt.error;
        await this.save(receipt);
        continue; // A native queue entry proves acceptance, never execution.
      }
      const content = receipt.content;
      if (!content) {
        if (receipt.kind === "review")
          items.push({
            id: receipt.id,
            threadId: id,
            authority: "native",
            receiptOnly: true,
            text: "代码审查请求结果待核对",
            images: [],
            parameters: {},
            mode: "queue",
            status: receipt.status === "failed" ? "failed" : "uncertain",
            createdAt: receipt.createdAt,
            fingerprint: receipt.fingerprint,
            error: receipt.error ?? "请核对原审查回执，不会重复启动",
          });
        continue;
      }
      items.push({
        ...content,
        authority: "native",
        fingerprint: receipt.fingerprint,
        status: receipt.status === "failed" ? "failed" : "uncertain",
        createdAt: receipt.createdAt,
        error: receipt.error ?? "送达结果待核对，不能自动重发",
      });
    }
    let review: FollowupThread["review"];
    for (const receipt of await this.accepted(id))
      if (receipt.namespace === context?.namespace) {
        if (receipt.kind === "review") {
          if (receipt.reviewThreadId && receipt.turnId) {
            review = {
              turnId: receipt.turnId,
              status: receipt.turnStatus ?? "inProgress",
            };
            this.reviewTargets.set(receipt.reviewThreadId, {
              source: id,
              operationId: receipt.id,
            });
            while (this.reviewTargets.size > 64)
              this.reviewTargets.delete(
                this.reviewTargets.keys().next().value!,
              );
          }
          continue;
        }
        if (receipt.legacyId)
          items.push({
            id: receipt.legacyId,
            threadId: id,
            authority: "legacy",
            receiptOnly: true,
            status: "cancelled",
            mode: "queue",
            text: "",
            images: [],
            parameters: {},
            createdAt: receipt.createdAt,
            fingerprint: receipt.fingerprint,
          });
        if (!ids.has(receipt.id))
          items.push({
            id: receipt.id,
            threadId: id,
            authority: "native",
            receiptOnly: true,
            status: receipt.dismissed ? "cancelled" : "sent",
            mode: "queue",
            text: "",
            images: [],
            parameters: {},
            createdAt: receipt.createdAt,
            fingerprint: receipt.fingerprint,
            ...(receipt.turnId ? { turnId: receipt.turnId } : {}),
          });
      }
    const legacy = await this.legacy(id);
    items.push(...legacy);
    const recovery = await this.actions.visible(id, context?.namespace);
    for (const record of recovery.issues) {
      if (record.status === "rejected" && record.completed.length === 0)
        continue;
      const saved = record.original
        ? this.project(
            id,
            record.afterInput
              ? { ...record.original, input: record.afterInput }
              : record.original,
          )
        : undefined;
      items.push({
        ...(saved ?? {
          threadId: id,
          authority: "native" as const,
          text: "队列操作结果待核对",
          images: [],
          parameters: {},
          mode: "queue" as const,
          createdAt: record.at,
          fingerprint: record.fingerprint,
        }),
        id: `action_${record.id}`,
        nativeQueuedSubmissionId: undefined,
        nativeClientUserMessageId: undefined,
        receiptOnly: true,
        status: record.status === "unknown" ? "uncertain" : "failed",
        error:
          record.error ??
          "队列操作结果待核对，原内容已保存；不会自动补偿或重发",
      });
    }
    const dir = this.directory(id);
    let old = this.snapshots.get(id);
    if (!old && dir)
      try {
        old = JSON.parse(await readFile(join(dir, "snapshot.json"), "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    if (old?.namespace !== context?.namespace) old = undefined;
    const stopped = old?.paused?.includes("原生队列等待显式继续")
      ? old.paused
      : null;
    const paused = items.some((item) => item.status === "uncertain")
      ? "送达结果待核对"
      : (stopped ??
        (legacy.length && !native.length ? "旧队列等待显式迁移" : null));
    const fingerprint = digest({ items, paused, review, undo: recovery.undo });
    const revision =
      old?.fingerprint === fingerprint
        ? old.revision
        : Math.max((old?.revision ?? 0) + 1, Date.now());
    const current = {
      revision,
      fingerprint,
      paused,
      ...(context ? { namespace: context.namespace } : {}),
    };
    if (context && (await this.runtime.context!()).scope !== context.scope)
      throw new Error("读取期间账号或运行实例已变化，请重新核对队列");
    if (old?.fingerprint !== fingerprint && dir)
      await writeDurableJson(join(dir, "snapshot.json"), current);
    this.snapshots.set(id, current);
    while (this.snapshots.size > 64)
      this.snapshots.delete(this.snapshots.keys().next().value!);
    return {
      authority: "native",
      revision,
      paused,
      items,
      ...(review ? { review } : {}),
      ...(recovery.undo ? { undo: recovery.undo } : {}),
    };
  }
  get(id: string) {
    return this.run(id, () => this.snapshot(id));
  }
  inspect(id: string) {
    return this.get(id);
  }
  steerReceipts(
    id: string,
    expectedScope?: string,
    cursor: string | null = null,
    limit = 30,
  ) {
    return this.run(id, async () => {
      const context = await this.context(expectedScope);
      const result = await this.steerDisplay.page(
        id,
        context?.namespace,
        cursor,
        limit,
        async (row) => {
          if (row.clientId === row.operationId) {
            const receipt = await this.receipt(id, row.operationId);
            return (
              receipt?.status === "accepted" &&
              receipt.namespace === context?.namespace &&
              receipt.turnId === row.turnId
            );
          }
          if (row.clientId !== `queued_steer_${row.operationId}`) return false;
          const action = await this.actions.get(id, row.operationId);
          return (
            action?.status === "accepted" &&
            action.namespace === context?.namespace &&
            action.action.type === "steer" &&
            action.action.expectedTurnId === row.turnId
          );
        },
      );
      if (context && (await this.runtime.context!()).scope !== context.scope)
        conflict("读取期间账号或运行服务已变化，请重新核对补充说明");
      return result;
    });
  }
  /** Native owns dispatch. No timer is allowed to submit the ledger. */
  async tick() {}
  async drain() {
    await Promise.allSettled([...this.serial.values()]);
  }
  async recover(_reason: string) {}
  private async submitOne(
    input: FollowupSubmit,
    legacyId?: string,
  ): Promise<void> {
    if (this.runtime.context && !this.legacyFile)
      conflict("官方提交意图的持久存储不可用，消息尚未提交");
    const { expectedScope, ...content } = input;
    const fingerprint = digest(content),
      previous = await this.receipt(input.threadId, input.id);
    const currentContext = await this.runtime.context?.();
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        conflict("同一请求标识不能用于不同消息");
      if (previous.namespace !== currentContext?.namespace)
        conflict("该消息回执属于其他账号或历史范围");
      return;
    }
    const context = await this.context(expectedScope);
    const pending = await this.pending(input.threadId);
    if (
      pending.length >= 100 ||
      Buffer.byteLength(JSON.stringify([...pending, input])) > BUDGET
    )
      conflict("待核对消息已达预算，请先处理已有消息");
    const receipt: Receipt = {
      fingerprint,
      threadId: input.threadId,
      id: input.id,
      status: "uncertain",
      createdAt: Date.now(),
      content: structuredClone(content),
      ...(legacyId ? { legacyId } : {}),
      ...(context ? { namespace: context.namespace } : {}),
    };
    await this.save(receipt); // A lost add or steer acknowledgement can never lead to replay.
    try {
      const nativeInput = inputFor(input);
      if (input.mode === "replace") {
        if ((await this.native(input.threadId)).length)
          conflict(
            "已有官方待发消息，请先显式处理队列后再停止并发送；本次内容未提交",
          );
        const current = await this.runtime.call("thread/turns/list", {
          threadId: input.threadId,
          limit: 1,
          itemsView: "notLoaded",
          sortDirection: "desc",
        });
        const turn = current?.data?.[0];
        if (
          !input.expectedTurnId ||
          turn?.id !== input.expectedTurnId ||
          turn.status !== "inProgress"
        )
          conflict("当前轮次已变化，尚未停止或发送");
        const goal = await this.runtime.call("thread/goal/get", {
          threadId: input.threadId,
        });
        if (goal?.goal?.status === "active")
          conflict("活动 Goal 仍可能自动推进，请先显式暂停 Goal");
        await this.call(
          "turn/interrupt",
          { threadId: input.threadId, turnId: input.expectedTurnId },
          context,
        );
        let stopped = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const recent = await this.runtime.call("thread/turns/list", {
            threadId: input.threadId,
            limit: 1,
            itemsView: "notLoaded",
            sortDirection: "desc",
          });
          const latest = recent?.data?.[0];
          if (latest?.id !== input.expectedTurnId)
            conflict("停止期间轮次已变化，尚未发送新消息");
          if (latest.status !== "inProgress") {
            stopped = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!stopped) throw new Error("当前轮次停止结果待确认，新消息尚未提交");
      }
      if (input.mode === "steer") {
        if (!input.expectedTurnId) conflict("请核对当前精确轮次后再补充说明");
        await this.steerDisplay.prepare({
          sourceId: input.id,
          operationId: input.id,
          clientId: input.id,
          threadId: input.threadId,
          turnId: input.expectedTurnId,
          createdAt: receipt.createdAt,
          text: input.text,
          images: input.images,
          ...(input.contexts ? { contexts: input.contexts } : {}),
          ...(input.mentions ? { mentions: input.mentions } : {}),
          ...(context ?? {}),
        });
        const result = await this.call(
          "turn/steer",
          {
            threadId: input.threadId,
            expectedTurnId: input.expectedTurnId,
            clientUserMessageId: input.id,
            input: nativeInput,
          },
          context,
        );
        if (result?.turnId !== input.expectedTurnId)
          throw new Error("引导回执待核对");
        receipt.turnId = result.turnId;
        receipt.status = "accepted";
        await this.save(receipt); // Preserve native ACK even if display settlement fails.
        await this.steerDisplay.accept(input.threadId, input.id);
      } else {
        const parameters = Object.fromEntries(
          Object.entries(input.parameters).filter(([name]) =>
            settingsFields.has(name),
          ),
        );
        await this.applySettings(input.threadId, parameters, context);
        const result = await this.call(
          "thread/queue/add",
          {
            threadId: input.threadId,
            clientUserMessageId: input.id,
            input: nativeInput,
          },
          context,
        );
        if (
          typeof result?.queuedSubmission?.id !== "string" ||
          result.queuedSubmission.clientUserMessageId !== input.id
        )
          throw new Error("官方队列接收回执待核对");
        receipt.nativeId = result.queuedSubmission.id;
        if (input.mode === "replace") {
          // Queue acceptance is already known. A lost start acknowledgement must
          // never cause another add or another interrupt of a later turn.
          receipt.status = "accepted";
          delete receipt.content;
          await this.save(receipt);
          await this.call(
            "thread/queue/start",
            { threadId: input.threadId, queuedSubmissionId: receipt.nativeId },
            context,
          );
        }
      }
      receipt.status = "accepted";
      delete receipt.content;
      delete receipt.error;
    } catch (error) {
      if (receipt.status !== "accepted")
        receipt.status =
          error instanceof FollowupRejected ||
          (error as any)?.statusCode === 409
            ? "failed"
            : "uncertain";
      receipt.error = error instanceof Error ? error.message : String(error);
    }
    await this.save(receipt);
  }
  submit(input: FollowupSubmit) {
    return this.run(input.threadId, async () => {
      await this.submitOne(input);
      return this.snapshot(input.threadId);
    });
  }
  private actionResult(
    record: NativeActionRecord,
    snapshot: FollowupThread,
  ): FollowupThread {
    return {
      ...snapshot,
      operation: {
        id: record.id,
        status:
          record.dismissed && record.status === "unknown"
            ? "rejected"
            : record.status,
        ...(record.error ? { error: record.error } : {}),
      },
    };
  }
  actionReceipt(id: string, operationId: string, expectedScope?: string) {
    return this.run(id, async () => {
      const context = await this.context(expectedScope),
        record = await this.actions.get(id, operationId);
      if (!record) return null;
      if (record.namespace !== context?.namespace)
        conflict("队列操作回执属于其他账号或历史范围");
      return this.actionResult(record, await this.snapshot(id));
    });
  }
  change(
    id: string,
    revision: number,
    action: FollowupAction,
    expectedScope?: string,
    operationId?: string,
  ): Promise<FollowupThread> {
    return this.run(id, async () => {
      const context = await this.context(expectedScope);
      if (context && (!operationId || !this.legacyFile))
        conflict("请先持久保存队列操作意图");
      const opId = operationId ?? randomUUID(),
        hash = actionHash({ revision, action });
      const previous = await this.actions.get(id, opId);
      if (previous) {
        if (
          previous.namespace !== context?.namespace ||
          previous.fingerprint !== hash
        )
          conflict("队列操作标识或账号范围已变化");
        return this.actionResult(previous, await this.snapshot(id));
      }
      const before = await this.snapshot(id);
      if (before.revision !== revision)
        conflict("官方队列已被其他客户端更新，请查看最新状态后重试");
      if (action.type === "pause")
        conflict(
          "原生队列没有独立暂停接口；停止当前轮次会保留队列并阻止自动推进",
        );
      const rows = await this.native(id);
      const beforeNative = before.items.filter(
        (item) => item.nativeQueuedSubmissionId,
      );
      if (
        rows.length !== beforeNative.length ||
        rows.some(
          (row, index) =>
            beforeNative[index]?.nativeQueuedSubmissionId !== row.id ||
            beforeNative[index].fingerprint !== digest(row),
        )
      )
        conflict("读取期间官方队列已变化，请查看最新状态后重试");
      const record: NativeActionRecord = {
        id: opId,
        threadId: id,
        namespace: context?.namespace,
        fingerprint: hash,
        action: structuredClone(action),
        status: "unknown",
        phase: "prepared",
        at: Date.now(),
        completed: [],
      };
      let undoSource: NativeActionRecord | undefined;
      if (action.type === "undo") {
        undoSource = await this.actions.get(id, action.token);
        if (
          !undoSource?.undo ||
          undoSource.undone ||
          undoSource.status !== "accepted" ||
          undoSource.namespace !== context?.namespace ||
          undoSource.undo.expiresAt < Date.now()
        )
          conflict("恢复操作已过期或状态已变化");
        if (undoSource.undoOperationId && undoSource.undoOperationId !== opId)
          conflict("此恢复操作已有待核对回执，不会重复恢复");
        if (undoSource.afterProof !== digest(rows))
          conflict("官方队列已被其他客户端更新，不能覆盖较新的队列内容");
        if (
          undoSource.action.type === "delete" &&
          action.confirmExecution !== true
        )
          conflict("恢复到官方队列可能立即执行，请明确确认后再恢复");
        record.original = structuredClone(undoSource.original);
        record.undoOf = undoSource.id;
      } else if (
        ["delete", "edit", "steer"].includes(action.type) &&
        "id" in action
      ) {
        const projected = before.items.find((item) => item.id === action.id);
        const original = rows.find(
          (row) => row.id === projected?.nativeQueuedSubmissionId,
        );
        if (original) {
          record.original = structuredClone(original);
          record.index = rows.indexOf(original);
        }
      }
      if (action.type === "retry" && "id" in action) {
        if (action.confirmUncertain !== true)
          conflict("重试按线程当前设置发送，空闲时可能立即执行，请明确确认");
        if (action.id.startsWith("action_")) {
          const source = await this.actions.get(id, action.id.slice(7));
          if (source?.retryOperationId && source.retryOperationId !== opId)
            conflict("此消息已有待核对的恢复回执，不会重复发送");
          if (
            !source?.original ||
            source.dismissed ||
            source.namespace !== context?.namespace ||
            source.status === "accepted"
          )
            conflict("保存的原操作已变化，请先核对消息状态");
          record.original = structuredClone(
            source.afterInput
              ? { ...source.original, input: source.afterInput }
              : source.original,
          );
        } else {
          const failed = await this.receipt(id, action.id);
          if (failed?.retryOperationId && failed.retryOperationId !== opId)
            conflict("此消息已有待核对的重试回执，不会重复发送");
          if (
            !failed?.content ||
            failed.dismissed ||
            !["failed", "uncertain"].includes(failed.status)
          )
            conflict("此消息没有可显式恢复的保存内容，请先核对原消息");
          record.original = {
            id: action.id,
            clientUserMessageId: action.id,
            input: inputFor(failed!.content!),
          };
        }
      }
      await this.actions.save(record);
      if (undoSource) {
        undoSource.undoOperationId = opId;
        await this.actions.save(undoSource);
      }
      const step = async (
        method: string,
        params: Record<string, unknown>,
        phase: string,
      ) => {
        record.phase = phase;
        await this.actions.save(record);
        const result = await this.call(method, params, context);
        record.completed.push(phase);
        await this.actions.save(record);
        return result;
      };
      try {
        if (action.type === "resume") {
          try {
            await step("thread/queue/start", { threadId: id }, "starting");
          } catch (error) {
            if (
              !(error instanceof FollowupRejected) ||
              !error.message.includes(
                "resume the thread before starting a queued message",
              )
            )
              throw error;
            // Native proved the first start was not sent to a loaded thread.
            // The user's explicit continue authorizes restoring this exact queue.
            await step(
              "thread/queue/restore",
              { threadId: id, queuedSubmissionIds: rows.map((row) => row.id) },
              "restoring-queue",
            );
            const [current, metadata] = await Promise.all([
              this.native(id),
              this.runtime.call("thread/read", {
                threadId: id,
                includeTurns: false,
              }),
            ]);
            if (
              digest(current) !== digest(rows) ||
              metadata?.thread?.status?.type !== "idle"
            )
              throw new Error(
                "恢复原生会话后队列或轮次已变化，请查看当前进度；不会再次启动队列",
              );
            await step(
              "thread/queue/start",
              { threadId: id },
              "starting-restored-queue",
            );
          }
          const cached = this.snapshots.get(id);
          if (cached) cached.paused = null;
        } else if (action.type === "migrate") {
          const legacy = before.items.find(
            (item) => item.id === action.id && item.authority === "legacy",
          );
          if (
            !legacy ||
            !["queued", "failed"].includes(legacy.status) ||
            legacy.turnId ||
            action.confirmThreadSettings !== true
          )
            conflict("旧消息送达结果尚未确认，不能迁移或重发");
          await this.submitOne(
            {
              threadId: id,
              text: legacy.text,
              images: legacy.images,
              parameters: legacy.parameters,
              contexts: legacy.contexts,
              mentions: legacy.mentions,
              id: `migrate_${digest([id, legacy.id]).slice(0, 48)}`,
              mode: "queue",
              ...(expectedScope ? { expectedScope } : {}),
            },
            legacy.id,
          );
          const migrated = await this.receipt(
            id,
            `migrate_${digest([id, legacy.id]).slice(0, 48)}`,
          );
          if (migrated?.status !== "accepted")
            throw new Error(migrated?.error ?? "迁移结果待核对");
        } else if (action.type === "clear") {
          for (const item of rows)
            await step(
              "thread/queue/delete",
              { threadId: id, queuedSubmissionId: item.id },
              `clearing:${item.id}`,
            );
        } else if (action.type === "reorder") {
          const native = before.items.filter(
            (item) => item.nativeQueuedSubmissionId,
          );
          if (
            action.ids.length !== native.length ||
            new Set(action.ids).size !== native.length ||
            action.ids.some((key) => !native.some((item) => item.id === key))
          )
            conflict("排序必须包含当前全部原生待发消息；旧队列请先迁移");
          await step(
            "thread/queue/reorder",
            {
              threadId: id,
              queuedSubmissionIds: action.ids.map(
                (key) =>
                  native.find((item) => item.id === key)!
                    .nativeQueuedSubmissionId,
              ),
            },
            "reordering",
          );
        } else if (action.type === "undo") {
          if (undoSource!.action.type === "edit") {
            await step(
              "thread/queue/update",
              {
                threadId: id,
                queuedSubmissionId: record.original.id,
                input: record.original.input,
              },
              "undo-editing",
            );
          } else {
            let metadata = await this.runtime.call("thread/read", {
              threadId: id,
              includeTurns: false,
            });
            if (
              metadata?.thread?.id === id &&
              metadata.thread.status?.type === "notLoaded"
            ) {
              await step(
                "thread/queue/restore",
                {
                  threadId: id,
                  queuedSubmissionIds: rows.map((row) => row.id),
                },
                "restoring-for-undo",
              );
              metadata = await this.runtime.call("thread/read", {
                threadId: id,
                includeTurns: false,
              });
            }
            if (
              metadata?.thread?.id !== id ||
              !["idle", "active"].includes(metadata.thread.status?.type) ||
              metadata.thread.canAcceptDirectInput !== true
            )
              conflict("尚未确认原生会话可接收恢复消息，请先显式恢复该会话");
            const added = await step(
              "thread/queue/add",
              {
                threadId: id,
                clientUserMessageId: `undo_${opId}`,
                input: record.original.input,
              },
              "undo-adding",
            );
            if (
              typeof added?.queuedSubmission?.id !== "string" ||
              added.queuedSubmission.clientUserMessageId !== `undo_${opId}`
            )
              throw new Error("恢复消息接收结果待核对");
          }
          undoSource!.undone = true;
          await this.actions.save(undoSource!);
        } else if (action.type === "retry") {
          let metadata = await this.runtime.call("thread/read", {
            threadId: id,
            includeTurns: false,
          });
          if (
            metadata?.thread?.id === id &&
            metadata.thread.status?.type === "notLoaded"
          ) {
            await step(
              "thread/queue/restore",
              { threadId: id, queuedSubmissionIds: rows.map((row) => row.id) },
              "restoring-for-retry",
            );
            metadata = await this.runtime.call("thread/read", {
              threadId: id,
              includeTurns: false,
            });
          }
          if (
            metadata?.thread?.id !== id ||
            !["idle", "active"].includes(metadata.thread.status?.type) ||
            metadata.thread.canAcceptDirectInput !== true
          )
            conflict("尚未确认原生会话可接收消息，请先显式恢复该会话");
          if (action.id.startsWith("action_")) {
            const source = await this.actions.get(id, action.id.slice(7));
            if (source) {
              source.retryOperationId = opId;
              await this.actions.save(source);
            }
          } else {
            const source = await this.receipt(id, action.id);
            if (source) {
              source.retryOperationId = opId;
              await this.save(source);
            }
          }
          const added = await step(
            "thread/queue/add",
            {
              threadId: id,
              clientUserMessageId: `retry_${opId}`,
              input: record.original.input,
            },
            "retry-adding",
          );
          if (
            typeof added?.queuedSubmission?.id !== "string" ||
            added.queuedSubmission.clientUserMessageId !== `retry_${opId}`
          )
            throw new Error("重试消息接收结果待核对");
          if (action.id.startsWith("action_")) {
            const source = await this.actions.get(id, action.id.slice(7));
            if (source) {
              source.dismissed = true;
              delete source.original;
              delete source.afterInput;
              delete source.undo;
              await this.actions.save(source);
            }
          } else {
            const failed = await this.receipt(id, action.id);
            if (failed) {
              failed.dismissed = true;
              delete failed.content;
              await this.save(failed);
            }
          }
        } else if (
          action.type === "delete" ||
          action.type === "edit" ||
          action.type === "steer"
        ) {
          if (!record.original) {
            if (action.type !== "delete")
              conflict("此消息不在原生待发队列中，结果待核对");
            if (action.id.startsWith("action_")) {
              const saved = await this.actions.get(id, action.id.slice(7));
              if (!saved || saved.namespace !== context?.namespace)
                conflict("未找到原队列操作");
              saved.dismissed = true;
              delete saved.original;
              delete saved.afterInput;
              delete saved.undo;
              await this.actions.save(saved);
            } else {
              const legacy = before.items.find(
                (row) => row.id === action.id && row.authority === "legacy",
              );
              const receipt = legacy
                ? {
                    id: `discard_${digest([id, legacy.id]).slice(0, 48)}`,
                    threadId: id,
                    legacyId: legacy.id,
                    fingerprint: legacy.fingerprint,
                    status: "failed" as const,
                    createdAt: Date.now(),
                    namespace: context?.namespace,
                  }
                : await this.receipt(id, action.id);
              if (!receipt) conflict("消息回执不存在，请重新核对");
              receipt.dismissed = true;
              delete receipt.content;
              await this.save(receipt);
            }
          } else if (action.type === "delete") {
            await step(
              "thread/queue/delete",
              { threadId: id, queuedSubmissionId: record.original.id },
              "deleting",
            );
          } else if (action.type === "edit") {
            const input = record.original.input.filter(
              (part: any) => part.type !== "text",
            );
            if (action.text.trim())
              input.unshift({
                type: "text",
                text: action.text,
                text_elements: [],
              });
            if (!input.length) conflict("消息不能为空");
            record.afterInput = input;
            await step(
              "thread/queue/update",
              { threadId: id, queuedSubmissionId: record.original.id, input },
              "editing",
            );
          } else {
            const active = async () => {
              const metadata = await this.runtime.call("thread/read", {
                threadId: id,
                includeTurns: false,
              });
              const turns = await this.runtime.call("thread/turns/list", {
                threadId: id,
                limit: 1,
                sortDirection: "desc",
                itemsView: "notLoaded",
              });
              if (
                metadata?.thread?.id !== id ||
                metadata.thread.status?.type !== "active" ||
                metadata.thread.canAcceptDirectInput !== true ||
                turns?.data?.[0]?.id !== action.expectedTurnId ||
                turns.data[0].status !== "inProgress"
              )
                conflict("当前运行轮次已变化，尚未引导消息");
            };
            await active();
            const supplement = this.project(id, record.original);
            const nativeReferences: NativeSteerReference[] =
              record.original.input.filter((part: any) =>
                ["image", "audio", "localAudio", "mention", "skill"].includes(
                  part.type,
                ),
              );
            await this.steerDisplay.prepare({
              sourceId: opId,
              operationId: opId,
              clientId: `queued_steer_${opId}`,
              threadId: id,
              turnId: action.expectedTurnId!,
              createdAt: record.at,
              text: supplement.text,
              images: supplement.images,
              ...(nativeReferences.length ? { nativeReferences } : {}),
              ...(context ?? {}),
            });
            await step(
              "thread/queue/delete",
              { threadId: id, queuedSubmissionId: record.original.id },
              "steer-deleting",
            );
            const remaining = await this.native(id);
            if (
              digest(remaining) !==
              digest(rows.filter((row) => row.id !== record.original.id))
            )
              conflict(
                "删除期间队列已被其他客户端更新，原内容已保存，尚未引导",
              );
            await active();
            const result = await step(
              "turn/steer",
              {
                threadId: id,
                expectedTurnId: action.expectedTurnId,
                clientUserMessageId: `queued_steer_${opId}`,
                input: record.original.input,
              },
              "steering",
            );
            if (result?.turnId !== action.expectedTurnId)
              throw new Error("引导消息回执待核对，内容已保存");
            record.status = "accepted";
            record.phase = "steer-accepted";
            await this.actions.save(record);
            await this.steerDisplay.accept(id, opId);
          }
        } else conflict("此操作无法安全映射到官方共享队列，请核对后显式发送");
        record.status = "accepted";
        record.phase = "completed";
        record.afterProof = digest(await this.native(id));
        if (
          (action.type === "edit" || action.type === "delete") &&
          record.original
        ) {
          const projected = this.project(id, record.original);
          record.undo = {
            token: opId,
            kind: action.type,
            before: projected,
            after:
              action.type === "delete"
                ? { ...projected, status: "cancelled" }
                : {
                    ...projected,
                    text: action.type === "edit" ? action.text : projected.text,
                  },
            index: record.index ?? 0,
            expiresAt: Date.now() + 60_000,
          };
        }
      } catch (error) {
        record.error =
          error instanceof Error
            ? error.message.slice(0, 1024)
            : "队列操作结果待核对";
        if (record.status !== "accepted")
          record.status =
            error instanceof FollowupRejected ||
            (error as any)?.statusCode === 409
              ? "rejected"
              : "unknown";
        if (record.status === "rejected" && record.completed.length === 0) {
          if (undoSource?.undoOperationId === opId) {
            delete undoSource.undoOperationId;
            await this.actions.save(undoSource);
          }
          if (action.type === "retry") {
            if (action.id.startsWith("action_")) {
              const source = await this.actions.get(id, action.id.slice(7));
              if (source?.retryOperationId === opId) {
                delete source.retryOperationId;
                await this.actions.save(source);
              }
            } else {
              const source = await this.receipt(id, action.id);
              if (source?.retryOperationId === opId) {
                delete source.retryOperationId;
                await this.save(source);
              }
            }
          }
        }
      }
      await this.actions.save(record);
      return this.actionResult(record, await this.snapshot(id));
    });
  }
  /** Lifecycle already closed this gateway's admission. Actual native pause
   * requires a fresh exact interrupt proof in SessionLifecycle, never this flag. */
  async pause(_id: string) {}
  stop(id: string, turnId: string, expectedScope?: string) {
    return this.run(id, async () => {
      // Omission is reserved for trusted server integrations whose own preflight
      // has already checked the exact native target. Public HTTP requires a token.
      const context = expectedScope
        ? await this.context(expectedScope)
        : await this.runtime.context?.();
      await this.call("turn/interrupt", { threadId: id, turnId }, context);
      const before = this.snapshots.get(id) ?? {
        revision: Date.now(),
        fingerprint: "",
        paused: null,
      };
      this.snapshots.set(id, {
        ...before,
        ...(context ? { namespace: context.namespace } : {}),
        paused: "正在等待精确轮次停止确认，原生队列等待显式继续",
      });
      await this.snapshot(id);
    });
  }
  async observe(event: any) {
    const id = event?.params?.threadId;
    if (typeof id !== "string") return;
    if (
      event.method === "item/completed" &&
      event.params.item?.type === "userMessage"
    ) {
      const clientId =
        event.params.item.clientId ?? event.params.item.clientUserMessageId;
      if (
        typeof clientId === "string" &&
        typeof event.params.turnId === "string"
      )
        await this.run(id, async () => {
          const context = await this.runtime.context?.();
          await this.steerDisplay.acknowledge(
            id,
            event.params.turnId,
            clientId,
            context?.namespace,
          );
        });
    }
    const reviewTarget = this.reviewTargets.get(id);
    if (reviewTarget && event.method === "turn/completed")
      await this.run(reviewTarget.source, async () => {
        const receipt = await this.receipt(
            reviewTarget.source,
            reviewTarget.operationId,
          ),
          context = await this.runtime.context?.();
        if (
          receipt?.kind === "review" &&
          receipt.turnId === event.params.turn?.id &&
          receipt.namespace === context?.namespace &&
          ["completed", "interrupted", "failed"].includes(
            event.params.turn.status,
          )
        ) {
          receipt.turnStatus = event.params.turn.status;
          await this.save(receipt);
        }
      });
    if (
      ["item/started", "item/completed"].includes(event.method) &&
      event.params.item?.type === "userMessage"
    ) {
      const clientId =
        event.params.item.clientId ?? event.params.item.clientUserMessageId;
      if (typeof clientId === "string")
        await this.run(id, async () => {
          const receipt = await this.receipt(id, clientId);
          const context = await this.runtime.context?.();
          if (
            !receipt ||
            receipt.status === "accepted" ||
            receipt.namespace !== context?.namespace
          )
            return;
          receipt.status = "accepted";
          if (typeof event.params.turnId === "string")
            receipt.turnId = event.params.turnId;
          delete receipt.content;
          delete receipt.error;
          await this.save(receipt);
        });
    }
    if (event.method === "turn/started") {
      let before = this.snapshots.get(id);
      const context = await this.runtime.context?.(),
        dir = this.directory(id);
      if (!before && dir)
        try {
          before = JSON.parse(
            await readFile(join(dir, "snapshot.json"), "utf8"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      if (before?.paused && before.namespace === context?.namespace) {
        this.snapshots.set(id, { ...before, paused: null, fingerprint: "" });
        await this.get(id);
      }
    }
    if (
      event.method === "turn/completed" &&
      event.params.turn?.status === "interrupted"
    ) {
      const before = this.snapshots.get(id) ?? {
          revision: Date.now(),
          fingerprint: "",
          paused: null,
        },
        context = await this.runtime.context?.();
      this.snapshots.set(id, {
        ...before,
        ...(context ? { namespace: context.namespace } : {}),
        paused: "当前轮次已中断，原生队列等待显式继续",
      });
    }
  }
  private publicReview(receipt: Receipt) {
    return {
      operationId: receipt.id.replace(/^review_/, ""),
      threadId: receipt.threadId,
      status: receipt.dismissed
        ? ("rejected" as const)
        : receipt.status === "accepted"
          ? ("accepted" as const)
          : receipt.status === "failed"
            ? ("rejected" as const)
            : ("unknown" as const),
      ...(receipt.turnId
        ? {
            turn: {
              id: receipt.turnId,
              status: receipt.turnStatus ?? "inProgress",
              items: [],
            },
          }
        : {}),
      ...(receipt.reviewThreadId
        ? { reviewThreadId: receipt.reviewThreadId }
        : {}),
      ...(receipt.error ? { error: receipt.error } : {}),
    };
  }
  reviewReceipt(id: string, operationId: string, expectedScope?: string) {
    return this.run(id, async () => {
      const context = await this.context(expectedScope),
        receipt = await this.receipt(id, "review_" + operationId);
      if (!receipt) return null;
      if (receipt.kind !== "review" || receipt.namespace !== context?.namespace)
        conflict("此审查回执属于其他账号或历史范围");
      return this.publicReview(receipt);
    });
  }
  review(
    id: string,
    delivery: "inline" | "detached",
    target: Record<string, unknown>,
    operationId?: string,
    expectedScope?: string,
  ) {
    return this.run(id, async () => {
      const context = await this.context(expectedScope);
      if (context && (!this.legacyFile || !operationId))
        conflict("请先持久保存审查意图并核对当前运行范围");
      if (!operationId) conflict("审查操作缺少可核对的请求标识");
      const receiptId = "review_" + operationId,
        hash = digest({ id, delivery, target });
      const previous = await this.receipt(id, receiptId);
      if (previous) {
        if (
          previous.kind !== "review" ||
          previous.fingerprint !== hash ||
          previous.namespace !== context?.namespace
        )
          conflict("审查操作标识或账号范围已变化");
        return this.publicReview(previous);
      }
      if (
        (await this.pending(id)).some(
          (row) =>
            row.kind === "review" &&
            row.status === "uncertain" &&
            row.namespace === context?.namespace,
        )
      )
        conflict("已有审查结果待核对，请先查看原审查回执");
      if (delivery === "inline") {
        const metadata = await this.runtime.call("thread/read", {
          threadId: id,
          includeTurns: false,
        });
        const goal = await this.runtime.call("thread/goal/get", {
          threadId: id,
        });
        if (
          metadata?.thread?.id !== id ||
          !["idle", "notLoaded", "systemError"].includes(
            metadata.thread.status?.type,
          ) ||
          (await this.native(id)).length ||
          goal?.goal?.status === "active"
        )
          conflict("当前任务、队列或 Goal 仍在运行，请先处理或选择独立审查");
      }
      const receipt: Receipt = {
        kind: "review",
        threadId: id,
        id: receiptId,
        fingerprint: hash,
        status: "uncertain",
        createdAt: Date.now(),
        ...(context ? { namespace: context.namespace } : {}),
      };
      await this.save(receipt);
      try {
        const result = await this.call(
          "review/start",
          { threadId: id, delivery, target },
          context,
        );
        if (
          typeof result?.turn?.id !== "string" ||
          typeof result.reviewThreadId !== "string"
        )
          throw new Error("审查请求已发出，尚未确认执行轮次");
        receipt.status = "accepted";
        receipt.turnId = result.turn.id;
        receipt.turnStatus = "inProgress";
        receipt.reviewThreadId = result.reviewThreadId;
        this.reviewTargets.set(result.reviewThreadId, {
          source: id,
          operationId: receiptId,
        });
      } catch (error) {
        receipt.error =
          error instanceof Error
            ? error.message.slice(0, 1024)
            : "审查结果待核对";
        if (error instanceof FollowupRejected) receipt.status = "failed";
      }
      await this.save(receipt);
      return this.publicReview(receipt);
    });
  }
}
