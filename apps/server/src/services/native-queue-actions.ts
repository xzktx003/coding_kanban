import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeDurableJson } from "./durable-json.js";
import type { FollowupAction, FollowupThread } from "@agent-orchestrator/shared";
export const actionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;
export type NativeActionRecord = {
  id: string; threadId: string; namespace?: string; fingerprint: string; action: FollowupAction;
  status: "accepted" | "rejected" | "unknown"; phase: string; at: number; error?: string; dismissed?: boolean;
  original?: any; afterInput?: any[]; afterProof?: string; index?: number; completed: string[];
  undoOf?: string; undone?: boolean; undoOperationId?: string; retryOperationId?: string; undo?: FollowupThread["undo"];
};
/** Content remains server-side for explicit recovery. No unknown step is replayed. */
export class NativeQueueActions {
  private memory = new Map<string, NativeActionRecord>();
  constructor(private directory: (id: string) => string | null) {}
  private path(thread: string, id: string) { const dir = this.directory(thread); return dir ? join(dir, "actions", actionHash(id) + ".json") : null; }
  async get(thread: string, id: string): Promise<NativeActionRecord | undefined> {
    const path = this.path(thread, id); if (!path) return this.memory.get(JSON.stringify([thread, id]));
    try {
      if ((await stat(path)).size > MAX_BYTES) throw new Error("队列操作内容超过核对预算");
      const row = JSON.parse(await readFile(path, "utf8"));
      if (row.id !== id || row.threadId !== thread || !["accepted", "rejected", "unknown"].includes(row.status) || !Array.isArray(row.completed)) throw new Error("队列操作回执损坏，禁止重发");
      return row;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  private async index(thread: string): Promise<string[]> {
    const dir = this.directory(thread); if (!dir) return [...this.memory.values()].filter(row => row.threadId === thread).map(row => row.id);
    try {
      const value = JSON.parse(await readFile(join(dir, "actions", "index.json"), "utf8"));
      if (!Array.isArray(value) || value.length > 64 || value.some(id => typeof id !== "string")) throw new Error("队列操作索引损坏");
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async rows(thread: string) {
    const rows: NativeActionRecord[] = []; let bytes = 0;
    for (const id of await this.index(thread)) {
      const row = await this.get(thread, id); if (!row) throw new Error("队列操作回执缺失，禁止重发");
      bytes += Buffer.byteLength(JSON.stringify(row)); if (bytes > MAX_BYTES) throw new Error("队列恢复内容超过核对预算");
      rows.push(row);
    }
    return rows;
  }
  async save(record: NativeActionRecord) {
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_BYTES / 2) throw new Error("单次队列恢复内容超过保存预算");
    const dir = this.directory(record.threadId);
    if (!dir) { this.memory.set(JSON.stringify([record.threadId, record.id]), structuredClone(record)); return; }
    const rows = (await this.rows(record.threadId)).filter(row => row.id !== record.id);
    rows.push(record);
    // Retain terminal idempotency tombstones outside the bounded recovery index.
    while (rows.length > 64 || Buffer.byteLength(JSON.stringify(rows)) > MAX_BYTES) {
      const index = rows.findIndex(row => row.id !== record.id && row.status !== "unknown" && (!row.undo || row.undone || row.undo.expiresAt < Date.now()));
      if (index < 0) throw new Error("队列恢复内容已达预算，请先核对或移除保存的记录");
      const [old] = rows.splice(index, 1);
      const compact = { ...old }; delete compact.original; delete compact.afterInput; delete compact.undo;
      await writeDurableJson(this.path(old.threadId, old.id)!, compact);
    }
    await writeDurableJson(this.path(record.threadId, record.id)!, record);
    await writeDurableJson(join(dir, "actions", "index.json"), rows.map(row => row.id));
  }
  async visible(thread: string, namespace?: string) {
    const rows = (await this.rows(thread)).filter(row => row.namespace === namespace && !row.dismissed);
    const undo = rows.filter(row => row.status === "accepted" && row.undo && !row.undone && !row.undoOperationId && row.undo.expiresAt >= Date.now()).sort((a, b) => b.at - a.at)[0]?.undo;
    const issues = rows.filter(row => row.status === "unknown" || (row.status === "rejected" && row.original && row.completed.length));
    return { undo, issues };
  }
}
