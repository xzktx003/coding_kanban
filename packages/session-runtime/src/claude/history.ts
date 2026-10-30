import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, opendir, stat } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { absolutePath, ClaudeConfig } from "./config.js";
import { KeyedSerial } from "../core/serial.js";
import { HISTORY_WORKER_SOURCE } from "./history-worker-source.js";
import { HttpError, type JsonObject } from "../core/json.js";
import { historyBefore, historyDetailText, type RecentHistoryOptions } from "../core/recent-history.js";
import { ccRecentPage, ccMessageIdentity,ccMessageImageSources } from "./recent-history.js";
import { historyImage } from "../core/history-image.js";

/** SDK history APIs are filesystem-only. A short-lived worker isolates SDK environment caches per runtime. */
export async function historyCall(
  method: "listSessions" | "getSessionMessages" | "deleteSession",
  args: unknown[],
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  const module = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
  const source = HISTORY_WORKER_SOURCE;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        source,
        module,
        method,
        JSON.stringify(args),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(new Error("Claude history operation timed out"));
    }, 30_000);
    timer.unref();
    child.stdout.on("data", (data: Buffer) => {
      size += data.length;
      if (size > 64 * 1024 * 1024) {
        failed = true;
        child.kill();
        reject(new HttpError(413, "Claude history exceeds response limit"));
      } else chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < 4096)
        stderr += data.toString().slice(0, 4096 - stderr.length);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0)
        return reject(new Error(stderr || "Claude history operation failed"));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        reject(error);
      }
    });
  });
}
export interface ClaudeHistoryOptions {
  call?: typeof historyCall;
  metadataCheckIntervalMs?: number;
  now?: () => number;
}
export class ClaudeHistory {
  private readonly call: typeof historyCall;
  private readonly projects: string;
  private readonly serial = new KeyedSerial();
  private refreshInFlight?: Promise<void>;
  private nextCheckAt = -Infinity;
  constructor(
    readonly dataHome: string,
    readonly env: NodeJS.ProcessEnv,
    private readonly options: ClaudeHistoryOptions = {},
  ) {
    this.call = options.call ?? historyCall;
    this.projects = join(new ClaudeConfig(env).claudeHome, "projects");
    if (
      options.metadataCheckIntervalMs !== undefined &&
      (!Number.isFinite(options.metadataCheckIntervalMs) ||
        options.metadataCheckIntervalMs < 0)
    )
      throw new Error("Invalid metadata check interval");
  }
  private async cache() {
    const dir = join(this.dataHome, ".codexia");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const db = new Database(join(dir, "cache.db"));
    db.pragma("busy_timeout = 5000");
    db.exec(
      `CREATE TABLE IF NOT EXISTS cc_sessions(session_id TEXT PRIMARY KEY,summary TEXT NOT NULL,last_modified INTEGER NOT NULL,cwd TEXT,file_size INTEGER,custom_title TEXT,first_prompt TEXT,git_branch TEXT,tag TEXT,created_at INTEGER,synced_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_cc_sessions_cwd_last_modified ON cc_sessions(cwd,last_modified DESC);
       CREATE TABLE IF NOT EXISTS cc_session_metadata(source TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);`,
    );
    return db;
  }
  private refresh(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const now = (this.options.now ?? Date.now)();
    if (now < this.nextCheckAt) return Promise.resolve();
    const work = this.serial.run("history", async () => {
      // Stat metadata only. Idle lists do not spawn SDK workers or read transcript bodies.
      const fingerprint = await metadataFingerprint(this.projects);
      const db = await this.cache();
      try {
        const cached = db
          .prepare("SELECT fingerprint FROM cc_session_metadata WHERE source=?")
          .get(this.projects) as { fingerprint: string } | undefined;
        if (cached?.fingerprint !== fingerprint) {
          const rows = (await this.call(
            "listSessions",
            [{}],
            this.env,
          )) as Record<string, unknown>[];
          if (!Array.isArray(rows) || rows.length > 100_000)
            throw new HttpError(
              413,
              "Claude metadata exceeds the session count budget",
            );
          const insert = db.prepare(
            "INSERT INTO cc_sessions(session_id,summary,last_modified,file_size,custom_title,first_prompt,git_branch,cwd,tag,created_at,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          );
          // Only replace the cache after a complete, successful metadata scan. A failed
          // SDK/filesystem read leaves both old records and the old fingerprint intact.
          db.transaction(() => {
            db.prepare("DELETE FROM cc_sessions").run();
            for (const row of rows)
              insert.run(
                row.sessionId,
                row.summary,
                row.lastModified,
                row.fileSize ?? null,
                row.customTitle ?? null,
                row.firstPrompt ?? null,
                row.gitBranch ?? null,
                row.cwd ?? null,
                row.tag ?? null,
                row.createdAt ?? null,
                Math.floor(now / 1000),
              );
            db.prepare("DELETE FROM cc_session_metadata").run();
            db.prepare(
              "INSERT OR REPLACE INTO cc_session_metadata(source,fingerprint) VALUES(?,?)",
            ).run(this.projects, fingerprint);
          })();
        }
        this.nextCheckAt =
          (this.options.now ?? Date.now)() +
          (this.options.metadataCheckIntervalMs ?? 2000);
      } finally {
        db.close();
      }
    });
    this.refreshInFlight = work.finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }
  async list(
    directory?: string,
    limit?: number,
    offset = 0,
    includeWorktrees = true,
  ) {
    if (directory) absolutePath(directory);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    )
      throw new HttpError(400, "Invalid session pagination");
    await this.refresh();
    const db = await this.cache();
    try {
      const dir = directory === "/" ? directory : directory?.replace(/\/$/, "");
      const args: unknown[] = [];
      let where = "";
      if (dir) {
        args.push(dir);
        where = " WHERE cwd = ?";
        if (includeWorktrees) {
          const prefix = join(dir, ".codexia", "worktrees") + "/";
          where += " OR substr(cwd,1,?) = ?";
          args.push(prefix.length, prefix);
        }
      } else if (!includeWorktrees)
        where = " WHERE cwd NOT LIKE '%/.codexia/worktrees/%'";
      const total = (
        db
          .prepare(`SELECT count(*) AS total FROM cc_sessions${where}`)
          .get(...args) as { total: number }
      ).total;
      const sessions = db
        .prepare(
          `SELECT session_id,summary,last_modified,file_size,custom_title,first_prompt,git_branch,cwd,tag,created_at FROM cc_sessions${where} ORDER BY last_modified DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, limit ?? -1, offset) as JsonObject[];
      return { sessions, total };
    } finally {
      db.close();
    }
  }
  messages(id: string) {
    validateSessionId(id);
    return this.call("getSessionMessages", [id], this.env);
  }
  async messageRevision(id: string) {
    validateSessionId(id);
    await this.refresh();
    const db=await this.cache();
    try {
      const row=db.prepare("SELECT session_id,last_modified,file_size,created_at FROM cc_sessions WHERE session_id=?").get(id);
      return createHash("sha256").update(JSON.stringify(row ?? [id,"missing"])).digest("hex");
    } finally {db.close();}
  }
  async recentMessages(id: string, options: RecentHistoryOptions = {}) {
    validateSessionId(id);
    historyBefore("cc",id,options.cursor);
    const revision=await this.messageRevision(id);
    if (options.metadataOnly) return {data:[],nextCursor:null,revision,truncated:false,projection:"cc-messages" as const};
    return ccRecentPage(id,await this.messages(id),revision,options);
  }
  async messageDetail(id: string, itemId: string, options: {offset:number;limit:number}) {
    const rows=await this.messages(id);
    if (!Array.isArray(rows)) throw new HttpError(502,"Claude history did not return a message array");
    const row=rows.find((row,index)=>row&&typeof row==="object"&&ccMessageIdentity(row,index)===itemId);
    if (!row) throw new HttpError(404,"History item is unavailable");
    return {...historyDetailText(row,options),revision:await this.messageRevision(id)};
  }
  async messageImage(id:string,itemId:string,index:number,download=false) {
    const rows=await this.messages(id);
    if(!Array.isArray(rows))throw new HttpError(502,"Claude history did not return a message array");
    const row=rows.find((row,sourceIndex)=>row&&typeof row==="object"&&ccMessageIdentity(row,sourceIndex)===itemId);
    if(!row)throw new HttpError(404,"History image source is unavailable");
    const image=ccMessageImageSources(row)[index];
    if(!image||typeof image.data!=="string")throw new HttpError(404,"History image source is not a stored base64 image");
    return historyImage(image,download);
  }
  async delete(id: string) {
    validateSessionId(id);
    await this.serial.run("history", async () => {
      await this.call("deleteSession", [id], this.env);
      const db = await this.cache();
      try {
        db.prepare("DELETE FROM cc_sessions WHERE session_id=?").run(id);
      } finally {
        db.close();
        this.nextCheckAt = -Infinity;
      }
    });
  }
}

/** A fixed-size order-independent digest of JSONL metadata, without retaining file lists. */
async function metadataFingerprint(root: string): Promise<string> {
  const digest = Buffer.alloc(32);
  let files = 0,
    directories = 0;
  const add = (text: string) => {
    const bytes = createHash("sha256").update(text).digest();
    for (let index = 0; index < 32; index++) digest[index] ^= bytes[index];
  };
  const scan = async (path: string, depth: number): Promise<void> => {
    let dir;
    try {
      dir = await opendir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        add(`missing:${path}`);
        return;
      }
      throw error;
    }
    for await (const entry of dir) {
      const file = join(path, entry.name);
      if (entry.isDirectory() && depth === 0) {
        if (++directories > 10_000)
          throw new HttpError(413, "Claude metadata exceeds directory budget");
        await scan(file, 1);
      } else if (entry.isFile() && /\.jsonl?$/.test(entry.name)) {
        if (++files > 100_000)
          throw new HttpError(413, "Claude metadata exceeds transcript budget");
        try {
          const info = await stat(file);
          add(JSON.stringify([file, info.size, info.mtimeMs, info.ctimeMs]));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          add(`removed:${file}`);
        }
      }
    }
  };
  await scan(root, 0);
  return `continued-parents-v1:${directories}:${files}:${digest.toString("hex")}`;
}
export function validateSessionId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new HttpError(400, "Invalid session ID");
  return id;
}
