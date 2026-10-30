import type {
  ManagedSessionKind,
  SessionManagementAction,
  SessionManagementEntry,
  SessionManagementOperation,
  SharedSessionManagement,
} from "@agent-orchestrator/shared";
import { v4 as randomUUID } from "uuid";

export const MANAGEMENT_OPERATION_PREFIX =
  "kanban.session.management.operation.";
export const MANAGEMENT_CONFIRMATION_PREFIX =
  "kanban.session.management.confirmed.";
export interface PendingManagementOperation extends SessionManagementOperation {
  windowId: string;
  expiresAt: number;
  createdAt: number;
  state: "pending" | "unknown" | "blocked";
  error?: string;
}
type JournalStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
type Options = {
  storage: JournalStorage;
  fetch?: typeof fetch;
  apply?: (snapshot: SharedSessionManagement) => void;
  error?: (message: string) => void;
  success?: () => void;
};
export interface ManagementConfirmation {
  namespace: string;
  entry?: SessionManagementEntry;
}
type SavedConfirmation = ManagementConfirmation & {
  version: 1;
  operationId: string;
  intent: string;
  target: SessionManagementOperation["target"];
  at: number;
};
const confirmationIntent = (op: SessionManagementOperation) =>
  JSON.stringify({
    windowId: op.windowId,
    target: op.target,
    action: op.action,
  });

function validSnapshot(value: any): value is SharedSessionManagement {
  return (
    Number.isSafeInteger(value?.revision) &&
    value.revision >= 0 &&
    typeof value.operationWindow?.id === "string" &&
    Number.isFinite(value.operationWindow.expiresAt) &&
    value.namespaces &&
    ["codex", "cc", "acp"].every(
      (k) =>
        value.namespaces[k] === null || typeof value.namespaces[k] === "string",
    ) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 2048 &&
    value.entries.every(
      (e: any) =>
        ["codex", "cc", "acp"].includes(e?.kind) &&
        typeof e.id === "string" &&
        typeof e.namespace === "string" &&
        Number.isSafeInteger(e.revision) &&
        Number.isSafeInteger(e.pinRevision) &&
        Number.isSafeInteger(e.manualUnreadRevision) &&
        typeof e.pinned === "boolean" &&
        Array.isArray(e.completed) &&
        e.completed.length <= 32 &&
        e.completed.every(
          (r: any) => typeof r?.id === "string" && Number.isFinite(r.at),
        ) &&
        Array.isArray(e.read) &&
        e.read.length <= 32 &&
        e.read.every((id: unknown) => typeof id === "string"),
    )
  );
}
const matches = (
  entry: SessionManagementEntry,
  op: SessionManagementOperation,
) =>
  entry.namespace === op.target.namespace &&
  entry.kind === op.target.kind &&
  entry.id === op.target.id;

/** Durable metadata intentions only. Each intent owns a storage key, so two
 * pages cannot erase each other's journal with a read/modify/write of one map.
 * The server-issued window and namespace are captured once and never rebased.
 */
export class SessionManagementSync {
  private snapshot?: SharedSessionManagement;
  private running?: Promise<void>;
  private controller?: AbortController;
  private stopped = false;
  private lastPublished?: string;
  private confirmed = new Map<string, ManagementConfirmation>();
  private issued = new Map<string, PendingManagementOperation>();
  private fetcher: typeof fetch;
  constructor(private options: Options) {
    const fetcher = options.fetch ?? fetch;
    // Native Window.fetch rejects an unrelated class instance as its receiver.
    this.fetcher = (input, init) => fetcher(input, init);
  }

  pending(): PendingManagementOperation[] {
    const result: PendingManagementOperation[] = [];
    const storage = this.options.storage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(MANAGEMENT_OPERATION_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (!raw || raw.length > 20_000)
        throw new Error("会话管理操作记录无效，已保留等待核对");
      let op: PendingManagementOperation;
      try {
        op = JSON.parse(raw);
      } catch {
        throw new Error("会话管理操作记录无法读取，已保留等待核对");
      }
      if (
        !op?.operationId ||
        !op.target ||
        !op.action ||
        !["pending", "unknown", "blocked"].includes(op.state) ||
        typeof op.windowId !== "string" ||
        !Number.isFinite(op.expiresAt) ||
        !Number.isFinite(op.createdAt) ||
        !["codex", "cc", "acp"].includes(op.target.kind) ||
        typeof op.target.namespace !== "string" ||
        typeof op.target.id !== "string"
      )
        throw new Error("会话管理操作记录无效，已保留等待核对");
      result.push(op);
      if (result.length > 256)
        throw new Error("待核对的会话管理操作过多，请先处理同步提示");
    }
    return result.sort(
      (a, b) =>
        a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId),
    );
  }
  private save(op: PendingManagementOperation) {
    try {
      this.options.storage.setItem(
        MANAGEMENT_OPERATION_PREFIX + op.operationId,
        JSON.stringify(op),
      );
    } catch {
      throw new Error("无法保存会话管理操作，尚未发送，请检查浏览器存储");
    }
  }
  projection(): SharedSessionManagement | undefined {
    if (!this.snapshot) return;
    const value = structuredClone(this.snapshot);
    for (const op of this.pending()) {
      if (
        op.state !== "pending" ||
        op.target.namespace !== value.namespaces[op.target.kind]
      )
        continue;
      let entry = value.entries.find((e) => matches(e, op));
      if (!entry) {
        entry = {
          ...op.target,
          revision: 0,
          pinRevision: 0,
          pinned: false,
          manualUnreadRevision: 0,
          completed: [],
          read: [],
        };
        value.entries.push(entry);
      }
      const a = op.action;
      if (a.type === "pin" && a.expectedRevision === entry.pinRevision) {
        entry.pinned = a.value;
        entry.pinRevision++;
        if (a.title !== undefined) entry.title = a.title;
        if (a.cwd !== undefined) entry.cwd = a.cwd;
      } else if (
        a.type === "complete" &&
        !entry.completed.some((r) => r.id === a.replyId)
      ) {
        entry.completed.push({ id: a.replyId, at: op.createdAt });
        entry.completed = entry.completed.slice(-32);
      } else if (a.type === "unread") {
        entry.manualUnreadRevision++;
        entry.read = entry.read.filter(
          (id) => id !== entry!.completed.at(-1)?.id,
        );
      } else if (
        a.type === "read" &&
        a.manualUnreadRevision === entry.manualUnreadRevision
      ) {
        const index = entry.completed.findIndex((r) => r.id === a.replyId);
        if (index >= 0)
          entry.read = [
            ...new Set([
              ...entry.read,
              ...entry.completed.slice(0, index + 1).map((r) => r.id),
            ]),
          ];
      }
    }
    return value;
  }
  private publish() {
    const projected = this.projection();
    if (!projected) return;
    // Only bounded management metadata is compared; never transcript bodies.
    const signature = JSON.stringify(projected);
    if (signature === this.lastPublished) return;
    this.options.apply?.(projected);
    this.lastPublished = signature;
  }
  record(
    kind: ManagedSessionKind,
    id: string,
    action: (entry?: SessionManagementEntry) => SessionManagementAction,
  ) {
    if (!id || id.length > 512) throw new Error("会话目标无效");
    const current = this.projection();
    const namespace = current?.namespaces[kind];
    if (!current || !namespace)
      throw new Error("尚未确认当前账号，操作保留在本机，请连接后重试");
    if (current.operationWindow.expiresAt <= Date.now())
      throw new Error("管理同步状态已过期，请刷新同步状态后重试操作");
    if (this.pending().length >= 256)
      throw new Error("待核对的管理操作过多，请先处理同步提示");
    const op: PendingManagementOperation = {
      operationId: randomUUID(),
      windowId: current.operationWindow.id,
      expiresAt: current.operationWindow.expiresAt,
      createdAt: Math.max(
        Date.now(),
        ...this.pending().map((op) => op.createdAt + 1),
      ),
      state: "pending",
      target: { namespace, kind, id },
      action: structuredClone(
        action(
          current.entries.find(
            (e) => e.namespace === namespace && e.kind === kind && e.id === id,
          ),
        ),
      ),
    };
    this.issued.set(op.operationId, structuredClone(op));
    while (this.issued.size > 256)
      this.issued.delete(this.issued.keys().next().value!);
    this.save(op);
    this.publish();
    return op.operationId;
  }
  dismiss(operationId: string) {
    const operation = this.pending().find(
      (op) => op.operationId === operationId,
    );
    if (!operation || operation.state === "pending")
      throw new Error("正在同步的操作不能忽略，请先等待状态核对");
    this.options.storage.removeItem(MANAGEMENT_OPERATION_PREFIX + operationId);
    this.publish();
  }
  async confirmation(
    operationId: string,
    timeoutMs = 15_000,
  ): Promise<ManagementConfirmation> {
    const expected =
      this.issued.get(operationId) ??
      this.pending().find((op) => op.operationId === operationId);
    const until = Date.now() + timeoutMs;
    while (!this.stopped && Date.now() < until) {
      if (
        expected &&
        this.snapshot?.namespaces[expected.target.kind] !==
          expected.target.namespace
      )
        throw new Error("账号范围已变化，原回执不会应用到新账号");
      const done =
        (expected ? this.readConfirmation(expected) : undefined) ??
        this.confirmed.get(operationId);
      if (done) {
        this.confirmed.delete(operationId);
        this.issued.delete(operationId);
        return done;
      }
      const pending = this.pending().find(
        (op) => op.operationId === operationId,
      );
      if (!pending || pending.state !== "pending")
        throw new Error(pending?.error ?? "操作结果待核对，尚未确认完成");
      await this.syncOnce();
      if (!this.confirmed.has(operationId))
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("操作结果待核对，尚未确认完成");
  }
  private readConfirmation(
    op: PendingManagementOperation,
  ): ManagementConfirmation | undefined {
    const raw = this.options.storage.getItem(
      MANAGEMENT_CONFIRMATION_PREFIX + op.operationId,
    );
    if (raw === null) return;
    if (raw.length > 64 * 1024) throw new Error("管理回执超过读取预算");
    const value = JSON.parse(raw) as SavedConfirmation;
    if (
      value.version !== 1 ||
      value.operationId !== op.operationId ||
      value.intent !== confirmationIntent(op) ||
      value.namespace !== op.target.namespace ||
      value.target?.namespace !== op.target.namespace ||
      value.target?.kind !== op.target.kind ||
      value.target?.id !== op.target.id ||
      !Number.isFinite(value.at)
    )
      throw new Error("管理回执身份或原操作内容不一致，未确认完成");
    if (Date.now() - value.at > 15 * 60_000) return;
    if (this.snapshot?.namespaces[op.target.kind] !== op.target.namespace)
      throw new Error("账号范围已变化，原回执不会应用到新账号");
    if (
      value.entry &&
      (!matches(value.entry, op) ||
        !validSnapshot({
          revision: 0,
          operationWindow: { id: "receipt", expiresAt: 1 },
          namespaces: { codex: null, cc: null, acp: null },
          entries: [value.entry],
        }))
    )
      throw new Error("管理回执目标或修订无效，未确认完成");
    return {
      namespace: value.namespace,
      ...(value.entry ? { entry: value.entry } : {}),
    };
  }
  private saveConfirmation(
    op: PendingManagementOperation,
    confirmation: ManagementConfirmation,
  ) {
    if (this.readConfirmation(op)) return;
    const storage = this.options.storage,
      value: SavedConfirmation = {
        version: 1,
        operationId: op.operationId,
        intent: confirmationIntent(op),
        target: op.target,
        at: Date.now(),
        ...confirmation,
      },
      raw = JSON.stringify(value);
    if (raw.length > 64 * 1024)
      throw new Error("管理回执超过保存预算，原操作保留待核对");
    const rows: Array<{ key: string; at: number; bytes: number }> = [];
    let bytes = 0;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(MANAGEMENT_CONFIRMATION_PREFIX)) continue;
      const saved = storage.getItem(key);
      if (saved === null) continue;
      if (saved.length > 64 * 1024 || rows.length >= 256)
        throw new Error("管理回执超过核对预算");
      const parsed = JSON.parse(saved);
      if (!Number.isFinite(parsed?.at)) throw new Error("管理回执记录无效");
      rows.push({ key, at: parsed.at, bytes: saved.length });
      bytes += saved.length;
    }
    rows.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
    while (rows.length >= 64 || bytes + raw.length > 512 * 1024) {
      const old = rows.shift();
      if (!old) throw new Error("管理回执超过保存预算");
      storage.removeItem(old.key);
      bytes -= old.bytes;
    }
    // Publish the exact immutable ACK before removing the shared intent. A
    // different page may own the waiting UI, so an in-memory receipt is not enough.
    storage.setItem(MANAGEMENT_CONFIRMATION_PREFIX + op.operationId, raw);
  }
  syncOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return (this.running ??= this.sync().finally(() => {
      this.running = undefined;
    }));
  }
  private async request(init: RequestInit) {
    const response = await this.fetcher("/api/session/management", {
      ...init,
      cache: "no-store",
      signal: this.controller!.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(
          typeof data?.error === "string" ? data.error : "会话管理同步失败",
        ),
        { status: response.status },
      );
    if (!validSnapshot(data)) throw new Error("会话管理同步响应不完整");
    return data as SharedSessionManagement & {
      operationStatus?: "done" | "unknown";
    };
  }
  private async sync() {
    this.controller = new AbortController();
    const timer = setTimeout(() => this.controller?.abort(), 10_000);
    try {
      // Always establish the current namespace before transmitting stored intent.
      this.snapshot = await this.request({ method: "GET" });
      if (this.stopped) return;
      for (const op of this.pending()) {
        if (op.state !== "pending") continue;
        if (
          op.target.namespace !== this.snapshot.namespaces[op.target.kind] ||
          op.expiresAt <= Date.now()
        ) {
          op.state = "blocked";
          op.error =
            op.expiresAt <= Date.now()
              ? "操作确认期限已过，请核对最新状态后重新操作"
              : "账号范围已变化，旧操作已保留";
          this.save(op);
          this.options.error?.(op.error);
          continue;
        }
        try {
          const { operationId, windowId, target, action } = op;
          const result = await this.request({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ operationId, windowId, target, action }),
          });
          if (this.stopped) return;
          this.snapshot = result;
          if (result.operationStatus !== "done") {
            op.state = "unknown";
            op.error = "操作结果待核对，未自动重复执行";
            this.save(op);
            this.options.error?.(op.error);
          } else {
            // Bounded metadata receipts for local async UI transactions.
            const entry = result.entries.find((e) => matches(e, op));
            const confirmation = {
              namespace: op.target.namespace,
              ...(entry ? { entry: structuredClone(entry) } : {}),
            };
            this.saveConfirmation(op, confirmation);
            this.confirmed.set(operationId, confirmation);
            while (this.confirmed.size > 64)
              this.confirmed.delete(this.confirmed.keys().next().value!);
            this.options.storage.removeItem(
              MANAGEMENT_OPERATION_PREFIX + operationId,
            );
          }
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) {
            op.state = "blocked";
            op.error =
              error instanceof Error ? error.message : "操作需要重新确认";
            this.save(op);
            this.options.error?.(op.error);
            continue;
          }
          throw error; // Retry the exact durable identity, never a new window.
        }
      }
      this.publish();
      this.options.success?.();
    } catch (error) {
      if (!this.stopped)
        this.options.error?.(
          error instanceof Error ? error.message : "会话管理同步失败",
        );
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
    }
  }
  close() {
    this.stopped = true;
    this.controller?.abort();
    this.confirmed.clear();
    this.issued.clear();
  }
}
