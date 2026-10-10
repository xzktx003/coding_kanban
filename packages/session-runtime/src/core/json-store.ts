import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { isObject, type JsonObject } from "./json.js";

/** A runtime owns one store per path. Mutations serialize and replace atomically. */
export class JsonStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly defaultValue: () => JsonObject,
  ) {
    if (!isAbsolute(path) || /[\x00-\x1f]/.test(path))
      throw new Error("Invalid store path");
  }

  private async readFile(): Promise<JsonObject> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!isObject(value)) throw new Error("Expected JSON object in store");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.defaultValue();
      throw error;
    }
  }

  async read(): Promise<JsonObject> {
    await this.tail;
    return this.readFile();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.tail.then(operation);
    this.tail = work.catch(() => undefined);
    return work;
  }

  private async replace(value: JsonObject): Promise<void> {
    const encoded = JSON.stringify(value, null, 2);
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
      await rename(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
  }

  write(value: JsonObject): Promise<void> {
    // Capture now, before a queued caller can change its object.
    const snapshot = JSON.parse(JSON.stringify(value)) as JsonObject;
    return this.enqueue(() => this.replace(snapshot));
  }

  update(
    change: (value: JsonObject) => JsonObject | Promise<JsonObject>,
  ): Promise<JsonObject> {
    return this.enqueue(async () => {
      const next = await change(await this.readFile());
      await this.replace(next);
      return next;
    });
  }
}
