import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  NativeSteerReceipt,
  NativeSteerReceiptPage,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "./durable-json.js";

type Saved = Omit<NativeSteerReceipt, "status"> & {
  status: "unknown" | "accepted";
};
type NativeProof = Pick<
  Saved,
  "sourceId" | "operationId" | "clientId" | "threadId" | "turnId" | "namespace"
> & { status: "native" };
type RecordFile = { version: 1; segment: number; row: Saved | NativeProof };
type Index = { version: 1; entries: Array<{ id: string; bytes: number }> };
const MAX_BYTES = 8 * 1024 * 1024,
  PAGE_BYTES = 1024 * 1024;
const PAGE_PAYLOAD_BYTES = PAGE_BYTES - 4096;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function fail(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

/** Display provenance only. Cold segments stay on disk; no global body/index is
 * retained in memory, and a full segment never becomes a lifetime steer limit.
 * Only an exact native completed item can remove the unique display content.
 */
export class NativeSteerReceipts {
  // Non-durable mode is restricted to isolated tests by the native submit guard.
  private memory = new Map<string, RecordFile>();
  private memoryIndexes = new Map<string, Index>();
  private memoryMeta = new Map<string, number>();
  private memoryIdentities = new Map<
    string,
    { version: 1; key: string; sourceId: string | null }
  >();
  constructor(private directory: (threadId: string) => string | null) {}
  private path(threadId: string, ...names: string[]) {
    const dir = this.directory(threadId);
    return dir ? join(dir, "steer-display", ...names) : null;
  }
  private async json(path: string, max: number): Promise<any | undefined> {
    try {
      if ((await stat(path)).size > max) fail("补充说明记录超过读取预算");
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async meta(threadId: string) {
    const path = this.path(threadId, "meta.json"),
      value = path
        ? await this.json(path, 4096)
        : { version: 1, current: this.memoryMeta.get(threadId) ?? 0 };
    if (value === undefined) return 0;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.current) ||
      value.current < 0
    )
      fail("补充说明分段索引损坏");
    return value.current as number;
  }
  private async index(
    threadId: string,
    segment: number,
    required = false,
  ): Promise<Index> {
    const path = this.path(threadId, "segments", `${segment}.json`),
      value = path
        ? await this.json(path, 256 * 1024)
        : this.memoryIndexes.get(`${threadId}:${segment}`);
    if (value === undefined) {
      if (required) fail("补充说明冷历史索引缺失，已停止读取");
      return { version: 1, entries: [] };
    }
    const ids = new Set<string>();
    if (
      value.version !== 1 ||
      !Array.isArray(value.entries) ||
      value.entries.length > 512 ||
      value.entries.some((entry: any) => {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 ||
          entry.bytes > PAGE_BYTES ||
          ids.has(entry.id)
        )
          return true;
        ids.add(entry.id);
        return false;
      }) ||
      value.entries.reduce((sum: number, entry: any) => sum + entry.bytes, 0) >
        MAX_BYTES
    )
      fail("补充说明分段索引损坏");
    return value;
  }
  private async record(
    threadId: string,
    operationId: string,
  ): Promise<RecordFile | undefined> {
    const path = this.path(threadId, "records", hash(operationId) + ".json"),
      value = path
        ? await this.json(path, PAGE_BYTES + 1024)
        : structuredClone(this.memory.get(`${threadId}:${operationId}`));
    if (value === undefined) return;
    const row = value.row;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.segment) ||
      value.segment < 0 ||
      !row ||
      row.threadId !== threadId ||
      row.operationId !== operationId ||
      row.sourceId !== operationId ||
      typeof row.clientId !== "string" ||
      typeof row.turnId !== "string" ||
      !["unknown", "accepted", "native"].includes(row.status) ||
      (row.status !== "native" &&
        (typeof row.text !== "string" ||
          !Array.isArray(row.images) ||
          row.images.some((image: unknown) => typeof image !== "string") ||
          !Number.isFinite(row.createdAt)))
    )
      fail("补充说明记录损坏，已阻止覆盖或重发");
    return value;
  }
  private async saveRecord(
    threadId: string,
    operationId: string,
    value: RecordFile,
  ) {
    const path = this.path(threadId, "records", hash(operationId) + ".json");
    if (path) await writeDurableJson(path, value);
    else this.memory.set(`${threadId}:${operationId}`, structuredClone(value));
  }
  private async identity(
    threadId: string,
    turnId: string,
    clientId: string,
    namespace?: string,
  ) {
    const key = JSON.stringify([namespace, turnId, clientId]),
      path = this.path(threadId, "identities", hash(key) + ".json");
    const value = path
      ? await this.json(path, 4096)
      : this.memoryIdentities.get(`${threadId}:${key}`);
    if (
      value !== undefined &&
      (value.version !== 1 ||
        value.key !== key ||
        (value.sourceId !== null && typeof value.sourceId !== "string"))
    )
      fail("补充说明来源身份记录损坏");
    return { key, path, value };
  }
  async prepare(row: Omit<Saved, "status">) {
    const bytes = Buffer.byteLength(
      JSON.stringify({ ...row, status: "accepted" }),
    );
    if (bytes > PAGE_PAYLOAD_BYTES)
      fail("补充说明超过显示保存预算；本次尚未发送，原内容已保留");
    const previous = await this.record(row.threadId, row.operationId);
    if (previous) {
      if (
        previous.row.status === "native" ||
        JSON.stringify({ ...previous.row, status: undefined }) !==
          JSON.stringify({ ...row, status: undefined })
      )
        fail("同一补充说明来源不能对应不同内容");
      return;
    }
    const identity = await this.identity(
      row.threadId,
      row.turnId,
      row.clientId,
      row.namespace,
    );
    const sourceId =
      identity.value === undefined ||
      identity.value.sourceId === row.operationId
        ? row.operationId
        : null;
    const identityValue = { version: 1 as const, key: identity.key, sourceId };
    if (identity.path) await writeDurableJson(identity.path, identityValue);
    else
      this.memoryIdentities.set(
        `${row.threadId}:${identity.key}`,
        identityValue,
      );
    let segment = await this.meta(row.threadId),
      index = await this.index(row.threadId, segment);
    if (
      index.entries.length >= 512 ||
      index.entries.reduce((sum, entry) => sum + entry.bytes, 0) + bytes >
        MAX_BYTES
    ) {
      segment++;
      index = await this.index(row.threadId, segment);
    }
    // Publish the segment number before appending; a crash may leave an empty
    // next segment, never hide a segment that already contains an accepted row.
    const meta = this.path(row.threadId, "meta.json");
    if (meta) await writeDurableJson(meta, { version: 1, current: segment });
    else this.memoryMeta.set(row.threadId, segment);
    await this.saveRecord(row.threadId, row.operationId, {
      version: 1,
      segment,
      row: { ...row, status: "unknown" },
    });
    index.entries.push({ id: row.operationId, bytes });
    const path = this.path(row.threadId, "segments", `${segment}.json`);
    if (path) await writeDurableJson(path, index);
    else
      this.memoryIndexes.set(
        `${row.threadId}:${segment}`,
        structuredClone(index),
      );
  }
  async accept(threadId: string, operationId: string) {
    const value = await this.record(threadId, operationId);
    if (!value) fail("补充说明接收记录缺失，原发送回执待核对");
    if (value.row.status === "native") return;
    value.row.status = "accepted";
    await this.saveRecord(threadId, operationId, value);
  }
  async acknowledge(
    threadId: string,
    turnId: string,
    clientId: string,
    namespace?: string,
  ) {
    const identity = await this.identity(threadId, turnId, clientId, namespace);
    if (!identity.value?.sourceId) return;
    const value = await this.record(threadId, identity.value.sourceId),
      row = value?.row;
    if (
      !value ||
      !row ||
      row.status === "native" ||
      row.turnId !== turnId ||
      row.clientId !== clientId ||
      row.namespace !== namespace
    )
      return;
    value.row = {
      status: "native",
      sourceId: row.sourceId,
      operationId: row.operationId,
      clientId,
      threadId,
      turnId,
      namespace,
    };
    await this.saveRecord(threadId, row.operationId, value);
  }
  async page(
    threadId: string,
    namespace?: string,
    cursor: string | null = null,
    limit = 30,
    accepted?: (row: Saved) => Promise<boolean>,
  ): Promise<NativeSteerReceiptPage> {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 30 ||
      (cursor !== null && !/^\d{1,12}:\d{1,3}$/.test(cursor))
    )
      fail("补充说明分页参数无效");
    const current = await this.meta(threadId);
    let [segment, offset] = cursor
      ? cursor.split(":").map(Number)
      : [current, (await this.index(threadId, current)).entries.length - 1];
    if (segment > current || offset > 512) fail("补充说明分页位置无效");
    const data: NativeSteerReceipt[] = [];
    let bytes = 0,
      scanned = 0;
    while (segment >= 0) {
      const index = await this.index(threadId, segment, segment < current);
      if (offset >= index.entries.length) fail("补充说明分页位置无效");
      while (offset >= 0) {
        // Empty pages may carry a next cursor; bounded scanning also applies to
        // unknown intents, old namespaces and rows replaced by native history.
        if (scanned >= 512) return { data, nextCursor: `${segment}:${offset}` };
        const entry = index.entries[offset],
          value = await this.record(threadId, entry.id);
        if (!value || value.segment !== segment)
          fail("补充说明分段记录缺失，已停止读取");
        const row = value.row;
        if (
          row.status === "unknown" &&
          row.namespace === namespace &&
          accepted &&
          (await accepted(row))
        ) {
          row.status = "accepted";
          await this.saveRecord(threadId, row.operationId, value);
        }
        if (row.status === "accepted" && row.namespace === namespace) {
          const size = Buffer.byteLength(JSON.stringify(row));
          if (bytes + size > PAGE_PAYLOAD_BYTES || data.length >= limit)
            return { data, nextCursor: `${segment}:${offset}` };
          const identity = await this.identity(
            threadId,
            row.turnId,
            row.clientId,
            row.namespace,
          );
          bytes += size;
          data.unshift({
            ...row,
            status: "accepted",
            nativeIdentityUnique: identity.value?.sourceId === row.operationId,
          });
        }
        offset--;
        scanned++;
      }
      segment--;
      offset =
        segment >= 0
          ? (await this.index(threadId, segment, true)).entries.length - 1
          : -1;
    }
    return { data, nextCursor: null };
  }
}
