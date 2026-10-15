import { watch, type FSWatcher } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EventHub } from "../core/events.js";
import { absolutePath } from "./paths.js";
import { pollingFileWatcher } from "./polling-file-watcher.js";

interface WatchRecord {
  path: string;
  directory: boolean;
  recursive: boolean;
  references: number;
  watchers: Map<string, Pick<FSWatcher, "close">>;
  refreshing: boolean;
  pollingBudget: { entries: number; limit: number };
}

/** Registration and release share one queue, including canonicalization and preflight. */
export class FileWatches {
  private records = new Map<string, WatchRecord>();
  private aliases = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private maxDirectories: number;
  private nativeWatch: typeof watch;
  private pollIntervalMs: number;

  constructor(
    private readonly hub: EventHub,
    options: { maxDirectories?: number; watch?: typeof watch; pollIntervalMs?: number } = {},
  ) {
    this.maxDirectories = options.maxDirectories ?? 1024;
    this.nativeWatch = options.watch ?? watch;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 25 || this.pollIntervalMs > 60_000)
      throw new Error("Invalid file watch polling interval");
    if (
      !Number.isSafeInteger(this.maxDirectories) ||
      this.maxDirectories < 1 ||
      this.maxDirectories > 65536
    )
      throw new Error("Invalid file watch directory limit");
  }

  get count(): number {
    return this.records.size;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.tail.then(operation);
    this.tail = work.catch(() => undefined);
    return work;
  }

  private async directories(root: string): Promise<string[] | undefined> {
    if (root === dirname(root) || root === homedir()) return;
    const result: string[] = [],
      queue = [root];
    while (queue.length) {
      const directory = queue.pop()!;
      result.push(directory);
      if (result.length > this.maxDirectories) return;
      for (const entry of await readdir(directory, {
        withFileTypes: true,
      }).catch(() => [])) {
        if (entry.isDirectory() && !entry.isSymbolicLink())
          queue.push(join(directory, entry.name));
        if (result.length + queue.length > this.maxDirectories) return;
      }
    }
    return result;
  }

  async allowsRecursive(path: string): Promise<boolean> {
    return Boolean(await this.directories(absolutePath(path)));
  }

  private async attach(record: WatchRecord, directory: string): Promise<void> {
    if (this.closed || record.watchers.has(directory)) return;
    const changed = (kind: string, name: string | Buffer | null) => {
      if (!name || this.closed || this.records.get(record.path) !== record)
        return;
      const changed = join(directory, name.toString());
      if (!record.directory && changed !== record.path) return;
      void stat(changed)
        .then(
          (info) => ({ exists: true, directory: info.isDirectory() }),
          () => ({ exists: false, directory: false }),
        )
        .then((info) => {
          if (this.closed || this.records.get(record.path) !== record) return;
          this.hub.publish("fs_change", {
            path: changed,
            kind:
              kind === "change" ? "modify" : info.exists ? "create" : "remove",
          });
          if (kind === "rename" && record.recursive) this.refresh(record);
        });
    };
    const reportError = (error: Error) => {
      if (!this.closed)
        this.hub.publish("fs:watch-error", {
          path: directory,
          error: error.message,
        });
    };
    let watcher: Pick<FSWatcher, "close">;
    try {
      const native = this.nativeWatch(directory, changed);
      native.on("error", reportError);
      watcher = native;
    } catch (error) {
      if (!["EMFILE", "ENOSPC"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      watcher = await pollingFileWatcher(directory, { file: record.directory ? undefined : record.path,
        intervalMs: this.pollIntervalMs, budget: record.pollingBudget, changed, error: reportError });
    }
    if (this.closed || this.records.get(record.path) !== record) { watcher.close(); return; }
    record.watchers.set(directory, watcher);
  }

  private refresh(record: WatchRecord): void {
    if (record.refreshing) return;
    record.refreshing = true;
    void this.serial(async () => {
      try {
        const directories = await this.directories(record.path);
        if (this.closed || this.records.get(record.path) !== record) return;
        const desired = new Set(directories ?? [record.path]);
        record.recursive = Boolean(directories);
        for (const [path, watcher] of record.watchers)
          if (!desired.has(path)) {
            watcher.close();
            record.watchers.delete(path);
          }
        for (const path of desired)
          if (!record.watchers.has(path)) {
            try {
              await this.attach(record, path);
            } catch {
              /* Directory disappeared during refresh. */
            }
          }
      } finally {
        record.refreshing = false;
      }
    });
  }

  watch(input: string): Promise<void> {
    const alias = absolutePath(input);
    return this.serial(async () => {
      if (this.closed) throw new Error("File watch service closed");
      const path = await realpath(alias);
      const existing = this.records.get(path);
      if (existing) {
        existing.references++;
        this.aliases.set(alias, path);
        return;
      }
      const info = await stat(path);
      const directories = info.isDirectory()
        ? await this.directories(path)
        : undefined;
      if (this.closed) throw new Error("File watch service closed");
      const record: WatchRecord = {
        path,
        directory: info.isDirectory(),
        recursive: Boolean(directories),
        references: 1,
        watchers: new Map(),
        refreshing: false,
        pollingBudget: { entries: 0, limit: 4096 },
      };
      this.records.set(path, record);
      try {
        for (const directory of directories ?? [
          info.isDirectory() ? path : dirname(path),
        ])
          await this.attach(record, directory);
        if (this.closed) throw new Error("File watch service closed");
        this.aliases.set(alias, path);
      } catch (error) {
        for (const watcher of record.watchers.values()) watcher.close();
        this.records.delete(path);
        throw error;
      }
    });
  }

  unwatch(input: string): Promise<void> {
    const alias = absolutePath(input);
    return this.serial(async () => {
      const path =
        this.aliases.get(alias) ?? (await realpath(alias).catch(() => alias));
      const record = this.records.get(path);
      if (!record || --record.references > 0) return;
      this.records.delete(path);
      for (const watcher of record.watchers.values()) watcher.close();
      for (const [name, target] of this.aliases)
        if (target === path) this.aliases.delete(name);
    });
  }

  close(): void {
    this.closed = true;
    for (const record of this.records.values())
      for (const watcher of record.watchers.values()) watcher.close();
    this.records.clear();
    this.aliases.clear();
  }
}
