import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ManagedSessionKind, ManagedSessionTarget, SessionManagementEntry, SessionManagementOperation, SharedSessionManagement } from "@agent-orchestrator/shared";
import { writeDurableJson } from "./durable-json.js";

type State = { version: 1; domain: string; revision: number; entries: Record<string, SessionManagementEntry>; operations: Record<string, { fingerprint: string; status: "done" | "unknown"; windowId?: string }>; windows: Array<{ id: string; expiresAt: number }> };
const key = (v: ManagedSessionTarget) => JSON.stringify([v.namespace, v.kind, v.id]);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const conflict = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 409 }); };

/** Small management metadata only. No message body, draft, capability or auth token is stored. */
export class SessionManagement {
  private state: State = { version: 1, domain: randomUUID(), revision: 0, entries: {}, operations: {}, windows: [] };
  private loaded = false;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private options: { file?: string; accountScope?: () => Promise<string | null>; nativeRead?: (target: ManagedSessionTarget, expectedRevision: string, operation: "read" | "unread", scope?: string) => Promise<void>; verifyTarget?: (target: ManagedSessionTarget) => Promise<void> } = {}) {}
  private run<T>(work: () => Promise<T>): Promise<T> { const result = this.serial.then(async () => { await this.load(); return work(); }); this.serial = result.catch(() => {}); return result; }
  private async load() {
    if (this.loaded) return;
    if (this.options.file) try {
      const saved = JSON.parse(await readFile(this.options.file, "utf8"));
      if (saved?.version !== 1 || typeof saved.domain !== "string" || !Number.isSafeInteger(saved.revision) || !saved.entries || !saved.operations || Array.isArray(saved.entries) || Array.isArray(saved.operations)) throw new Error("会话管理记录损坏，禁止覆盖");
      this.state = { ...saved, windows: saved.windows ?? [] };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (this.options.file) await writeDurableJson(this.options.file, this.state);
    this.loaded = true;
  }
  private async save(next: State) { if (this.options.file) await writeDurableJson(this.options.file, next); this.state = next; }
  private async namespaces(): Promise<SharedSessionManagement["namespaces"]> {
    const base = hash(this.state.domain);
    const account = await this.options.accountScope?.();
    return { cc: base, acp: base, codex: account ? hash(`${this.state.domain}\0${account}`) : null };
  }
  private publicState(namespaces: SharedSessionManagement["namespaces"]): SharedSessionManagement {
    return { revision: this.state.revision, operationWindow: this.state.windows.at(-1)!, namespaces, entries: Object.values(this.state.entries).filter(e => e.namespace === namespaces[e.kind]).map(e => structuredClone(e)) };
  }
  private async window() {
    const live = this.state.windows.filter(window => window.expiresAt > Date.now());
    const removed = live.length !== this.state.windows.length;
    const current = live.at(-1);
    if (!current || current.expiresAt - Date.now() < 60_000) live.push({ id: randomUUID(), expiresAt: Date.now() + 10 * 60_000 });
    if (removed || live.length !== this.state.windows.length) {
      const next = structuredClone(this.state); next.windows = live;
      const ids = new Set(live.map(window => window.id));
      next.operations = Object.fromEntries(Object.entries(next.operations).filter(([, op]) => op.windowId && ids.has(op.windowId)));
      await this.save(next);
    }
    return this.state.windows.at(-1)!;
  }
  snapshot() { return this.run(async () => { await this.window(); return this.publicState(await this.namespaces()); }); }
  apply(input: SessionManagementOperation): Promise<SharedSessionManagement & { operationStatus: "done" | "unknown" }> {
    return this.run(async () => {
      const currentWindow = await this.window();
      // Omission is for isolated service fixtures only. HTTP requires the token.
      const windowId = input.windowId ?? (this.options.file ? "" : currentWindow.id);
      if (!this.state.windows.some(window => window.id === windowId && window.expiresAt > Date.now())) conflict("此管理操作窗口已失效，请核对最新状态；旧操作不能自动重发");
      const namespaces = await this.namespaces();
      if (input.target.namespace !== namespaces[input.target.kind]) conflict("账号或管理范围已变化，请查看当前会话后重试");
      const fingerprint = hash(JSON.stringify(input));
      const existing = this.state.operations[input.operationId];
      if (existing) { if (existing.fingerprint !== fingerprint) conflict("同一操作标识不能用于不同内容"); return { ...this.publicState(namespaces), operationStatus: existing.status }; }
      if (Object.keys(this.state.operations).length >= 8192) conflict("当前操作窗口繁忙，请在窗口到期后核对状态；旧操作不会重复执行");
      const targetKey = key(input.target);
      const previous = this.state.entries[targetKey];
      if (!previous && Object.keys(this.state.entries).length >= 2048) conflict("管理记录已达资源上限，请先整理已有记录");
      await this.options.verifyTarget?.(input.target);
      if ((await this.namespaces())[input.target.kind] !== input.target.namespace) conflict("账号或管理范围在核对期间变化，本次管理操作尚未保存");
      const next = structuredClone(this.state);
      const entry = next.entries[targetKey] ??= { ...input.target, revision: 0, pinRevision: 0, pinned: false, manualUnreadRevision: 0, completed: [], read: [] };
      const action = input.action;
      if (input.target.kind === "codex" && (action.type === "read" || action.type === "unread") && this.options.nativeRead &&
          (typeof action.nativeReadRevision !== "string" || !action.nativeReadRevision || typeof action.nativeScope !== "string" || !action.nativeScope))
        conflict("原生已读操作必须携带实际观察时捕获的revision与scope，请重新查看对应回复");
      switch (action.type) {
        case "pin":
          if (action.expectedRevision !== entry.pinRevision) conflict("置顶状态已被其他设备修改，请查看最新状态后重试");
          entry.pinned = action.value; entry.pinRevision++;
          if (action.title !== undefined) entry.title = action.title;
          if (action.cwd !== undefined) entry.cwd = action.cwd;
          break;
        case "complete":
          if (!entry.completed.some(reply => reply.id === action.replyId)) {
            entry.completed.push({ id: action.replyId, at: Date.now() });
            entry.completed = entry.completed.slice(-32);
            entry.read = entry.read.filter(id => entry.completed.some(reply => reply.id === id));
          }
          break;
        case "read": {
          if (action.manualUnreadRevision !== entry.manualUnreadRevision) conflict("未读状态已被其他设备修改，需要重新确认可见回复");
          const index = entry.completed.findIndex(reply => reply.id === action.replyId);
          if (index < 0) conflict("对应回复尚未确认，请等待会话同步");
          entry.read = [...new Set([...entry.read, ...entry.completed.slice(0, index + 1).map(reply => reply.id)])];
          break;
        }
        case "unread":
          entry.manualUnreadRevision++;
          entry.read = entry.read.filter(id => id !== entry.completed.at(-1)?.id);
          break;
      }
      entry.revision++; next.revision++;
      const needsNative = input.target.kind === "codex" && (action.type === "read" || action.type === "unread") && action.nativeReadRevision !== undefined;
      if (needsNative) {
        if (!this.options.nativeRead) conflict("当前运行服务无法确认原生已读协议，请升级后重试");
        // Record uncertainty before a native CAS. Lost acknowledgements must not
        // replay a read against a newer transcript or a later manual-unread intent.
        const uncertain = structuredClone(this.state);
        uncertain.operations[input.operationId] = { fingerprint, status: "unknown", windowId };
        await this.save(uncertain);
        await this.options.nativeRead!(input.target, action.nativeReadRevision!, action.type as "read" | "unread", action.nativeScope);
        if ((await this.namespaces())[input.target.kind] !== input.target.namespace) conflict("账号在原生已读确认期间变化，结果保留待核对，不发布到新账号");
      }
      next.operations[input.operationId] = { fingerprint, status: "done", windowId };
      await this.save(next);
      return { ...this.publicState(namespaces), operationStatus: "done" };
    });
  }
}
