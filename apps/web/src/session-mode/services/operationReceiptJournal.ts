type Receipt = { status: string; at?: number };
/** Small metadata-only receipts. Every operation owns its own durable key so
 * another page's stale read/modify/write cannot erase an unknown mutation. */
export class OperationReceiptJournal<T extends Receipt> {
  private prefix: string;
  constructor(
    private key: string,
    private identity: (row: T) => string,
    private validate: (value: unknown) => T,
    private same: (a: T, b: T) => boolean,
  ) {
    this.prefix = key + ":";
  }
  read(): T[] {
    const legacy = JSON.parse(localStorage.getItem(this.key) ?? "[]");
    if (!Array.isArray(legacy) || legacy.length > 100)
      throw new Error("操作回执损坏，请先核对已有操作");
    const rows = new Map<string, T>();
    for (const value of legacy) {
      const row = this.validate(value);
      rows.set(this.identity(row), row);
    }
    let count = 0,
      bytes = 0;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      bytes += raw.length;
      if (++count > 256 || bytes > 1024 * 1024)
        throw new Error("操作回执超过核对预算，请先处理已有操作");
      const row = this.validate(JSON.parse(raw)),
        id = this.identity(row),
        old = rows.get(id);
      if (key !== this.prefix + id || (old && !this.same(old, row)))
        throw new Error("操作回执身份或范围冲突，请先核对已有操作");
      rows.set(id, row);
    }
    return [...rows.values()].sort(
      (a, b) =>
        (a.at ?? 0) - (b.at ?? 0) ||
        this.identity(a).localeCompare(this.identity(b)),
    );
  }
  save(value: T) {
    const rows = this.read(),
      id = this.identity(value),
      old = rows.find((row) => this.identity(row) === id);
    if (old && !this.same(old, value))
      throw new Error("操作回执身份或范围冲突，请先核对已有操作");
    if (
      !old &&
      value.status === "unknown" &&
      rows.filter((row) => row.status === "unknown").length >= 100
    )
      throw new Error("待核对的操作过多，请先处理原回执");
    if (old && old.status !== "unknown" && value.status === "unknown") return;
    const record = { ...value, at: value.at ?? old?.at ?? Date.now() };
    localStorage.setItem(
      this.prefix + id,
      JSON.stringify(this.validate(record)),
    );
    const settled = this.read().filter(
      (row) =>
        row.status !== "unknown" &&
        localStorage.getItem(this.prefix + this.identity(row)) !== null,
    );
    for (const row of settled.slice(0, Math.max(0, settled.length - 100))) {
      const key = this.prefix + this.identity(row),
        raw = localStorage.getItem(key);
      if (raw && this.validate(JSON.parse(raw)).status !== "unknown")
        localStorage.removeItem(key);
    }
  }
}
