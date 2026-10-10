import { constants } from "node:fs";
import {
  readFile,
  realpath,
  lstat,
  readdir,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { SessionDatabase } from "../storage/database.js";
import { JsonStore } from "../core/json-store.js";
import { isObject, object, HttpError, type JsonObject } from "../core/json.js";
import {
  importDatabaseWorker,
  type ImportDatabaseOperation,
} from "./database-worker-client.js";
async function optionalObject(path: string): Promise<JsonObject> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(value)) throw new Error("Expected object");
    return value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
async function info(path: string) {
  try {
    return await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
export interface ImportOptions {
  db: SessionDatabase;
  dataDir: string;
  settings: JsonStore;
  importTasks: (tasks: unknown[]) => Promise<number>;
}
export class ImportService {
  private tail: Promise<unknown> = Promise.resolve();
  private active = new Set<ImportDatabaseOperation<unknown>>();
  private closed = false;
  constructor(readonly options: ImportOptions) {
    // Readers on this connection remain available while the worker commits the
    // import transaction. SQLite still serializes writers (see migration notes).
    options.db.db.pragma("journal_mode=WAL");
  }
  private assertOpen() {
    if (this.closed) throw new Error("Import service is closed");
  }
  private async databaseOperation<T>(
    source: string,
    apply = false,
  ): Promise<T> {
    this.assertOpen();
    const operation = importDatabaseWorker<T>(
      join(source, "cache.db"),
      apply ? join(this.options.dataDir, "cache.db") : undefined,
    );
    this.active.add(operation);
    try {
      return await operation.promise;
    } finally {
      this.active.delete(operation);
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.active].map((operation) => operation.cancel()),
    );
    await this.tail;
  }
  private async source(input: string) {
    if (typeof input !== "string" || !isAbsolute(input) || input.includes("\0"))
      throw new Error("Choose an absolute Codexia data directory");
    const source = await realpath(input);
    if (!(await lstat(source)).isDirectory())
      throw new Error("Data source must be a directory");
    const target = await realpath(this.options.dataDir);
    const rel = relative(source, target);
    if (
      source === target ||
      (rel && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel))
    )
      throw new Error("Source and destination must be separate");
    return source;
  }
  private async tasks(source: string) {
    const root = await optionalObject(join(source, "automations.json"));
    if (root.tasks !== undefined && !Array.isArray(root.tasks))
      throw new Error("Invalid imported tasks");
    return (root.tasks ?? []) as unknown[];
  }
  async preview(input: string) {
    this.assertOpen();
    const source = await this.source(input),
      workspace = object(
        (await optionalObject(join(source, "settings.json"))).workspace,
      ),
      tasks = await this.tasks(source);
    const records =
      await this.databaseOperation<Record<string, number>>(source);
    return {
      projects: Array.isArray(workspace.projects)
        ? workspace.projects.length
        : 0,
      tasks: tasks.length,
      records,
    };
  }
  private importDatabase(source: string) {
    return this.databaseOperation<number>(source, true);
  }
  private async copyMemory(source: string) {
    let count = 0;
    const srcBots = join(source, "bots");
    if (
      !(await info(srcBots))?.isDirectory() ||
      (await lstat(srcBots)).isSymbolicLink()
    )
      return 0;
    const ensure = async (path: string) => {
      const stat = await info(path);
      if (stat) {
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error("Memory destination must be a real directory");
      } else await mkdir(path, { mode: 0o700 });
    };
    const copy = async (src: string, dst: string) => {
      await ensure(dst);
      for (const entry of await readdir(src, { withFileTypes: true })) {
        this.assertOpen();
        if (entry.isSymbolicLink()) continue;
        const from = join(src, entry.name),
          to = join(dst, entry.name);
        if (entry.isDirectory()) await copy(from, to);
        else if (entry.isFile()) {
          const stat = await info(to);
          if (stat) continue;
          await copyFile(from, to, constants.COPYFILE_EXCL);
          count++;
        }
      }
    };
    const dstBots = join(this.options.dataDir, "bots");
    await ensure(dstBots);
    for (const entry of await readdir(srcBots, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.name))
        continue;
      const memory = join(srcBots, entry.name, "memory");
      const stat = await info(memory);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
      const dstBot = join(dstBots, entry.name);
      await ensure(dstBot);
      await copy(memory, join(dstBot, "memory"));
    }
    return count;
  }
  apply(input: string) {
    if (this.closed)
      return Promise.reject(new Error("Import service is closed"));
    const work = this.tail.then(() => this.applyOnce(input));
    this.tail = work.catch(() => undefined);
    return work;
  }
  private async applyOnce(input: string) {
    this.assertOpen();
    const source = await this.source(input);
    const tasks = await this.tasks(source);
    const workspace = object(
      (await optionalObject(join(source, "settings.json"))).workspace,
    );
    await this.options.settings.read();
    const records = await this.importDatabase(source);
    this.assertOpen();
    const warnings: string[] = [];
    let taskCount = 0,
      memoryFiles = 0;
    try {
      taskCount = await this.options.importTasks(tasks);
    } catch (e) {
      warnings.push(`定时任务未导入: ${String(e)}`);
    }
    this.assertOpen();
    try {
      memoryFiles = await this.copyMemory(source);
    } catch (e) {
      warnings.push(`记忆文件未完全导入: ${String(e)}`);
    }
    this.assertOpen();
    let projectCount = 0;
    try {
      await this.options.settings.update((current) => {
        const old = object(current.workspace);
        const merge = (key: string) => {
          const existing = old[key] ?? [];
          if (!Array.isArray(existing))
            throw new Error("Invalid destination workspace");
          const out = [...existing];
          for (const value of Array.isArray(workspace[key])
            ? workspace[key]
            : [])
            if (
              typeof value === "string" &&
              isAbsolute(value) &&
              !value.includes("\0") &&
              !out.includes(value)
            )
              out.push(value);
          return out;
        };
        const projects = merge("projects");
        projectCount = projects.length;
        return {
          ...current,
          workspace: {
            ...old,
            projects,
            historyProjects: merge("historyProjects"),
          },
        };
      });
    } catch (e) {
      warnings.push(`项目设置未导入: ${String(e)}`);
    }
    return {
      projects: projectCount,
      records,
      tasks: taskCount,
      memoryFiles,
      warnings,
    };
  }
}
export function registerImportRoutes(
  app: FastifyInstance,
  service: ImportService,
) {
  for (const action of ["preview", "apply"] as const)
    app.post(`/api/import/${action}`, async (req) => {
      try {
        return await service[action]((req.body as { source: string }).source);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    });
}
