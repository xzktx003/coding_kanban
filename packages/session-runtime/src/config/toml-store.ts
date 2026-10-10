import { AsyncLocalStorage } from "node:async_hooks";
import TOML from "@iarna/toml";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, open, rename, rm, copyFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { JsonObject } from "../core/json.js";
const stores = new Map<string, TomlStore>();
export function getTomlStore(path: string): TomlStore {
  if (!isAbsolute(path) || /[\x00-\x1f]/.test(path))
    throw new Error("Invalid TOML config path");
  let store = stores.get(path);
  if (!store) {
    store = new TomlStore(path);
    stores.set(path, store);
  }
  return store;
}
export class TomlStore {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly context = new AsyncLocalStorage<boolean>();
  /** Reentrant for initialization reads made by native writers within this transaction. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    const work = this.tail.then(() => this.context.run(true, operation));
    this.tail = work.catch(() => undefined);
    return work;
  }
  constructor(readonly path: string) {}
  private async source() {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  }
  async read(): Promise<JsonObject> {
    if (!this.context.getStore()) await this.tail;
    return TOML.parse(await this.source()) as JsonObject;
  }
  update(
    change: (config: JsonObject) => JsonObject | Promise<JsonObject>,
  ): Promise<JsonObject> {
    return this.exclusive(async () => {
      const source = await this.source();
      const parsed = TOML.parse(source) as JsonObject;
      const next = await change(parsed);
      const encoded = TOML.stringify(next as TOML.JsonMap); // Serialize before touching either existing document or backup.
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temp, "wx", 0o600);
        try {
          await file.writeFile(encoded);
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          await copyFile(this.path, `${this.path}.bak`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temp, this.path);
      } finally {
        await rm(temp, { force: true });
      }
      return next;
    });
  }
}
