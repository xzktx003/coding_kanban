import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export interface AcpSessionRecord {
  sessionId: string;
  agentId: string;
  agentTitle: string | null;
  cwd: string;
  botId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BotRecord {
  id: string;
  name: string;
  title: string | null;
  avatar: string;
  color: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  reasoningEffort: string | null;
  cwd: string;
  systemPrompt: string | null;
  trustLevel: string;
  approvedTools: string;
  mcpServers: string;
  allowedBotIds: string;
  pinned: boolean;
  archived: boolean;
  notificationsEnabled: boolean;
  unreadCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type BotPatch = Partial<
  Omit<
    BotRecord,
    | "id"
    | "agentId"
    | "createdAt"
    | "updatedAt"
    | "approvedTools"
    | "mcpServers"
    | "allowedBotIds"
  >
> & {
  approvedTools?: string[];
  mcpServers?: string[];
  allowedBotIds?: string[];
};
export interface AutomationRunRecord {
  run_id: string;
  task_id: string;
  task_name: string;
  thread_id: string;
  status: string;
  started_at: string;
  updated_at: string;
  cwd: string | null;
}
export function validId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new Error("Invalid identity");
}
export function validDirectory(value: unknown): asserts value is string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0"))
    throw new Error("Invalid absolute directory");
}
export function parseList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}
const camel = (row: unknown): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
const session = (row: unknown) => camel(row) as unknown as AcpSessionRecord;
const bot = (row: unknown): BotRecord => {
  const result = camel(row);
  for (const k of ["pinned", "archived", "notificationsEnabled"])
    result[k] = Boolean(result[k]);
  return result as unknown as BotRecord;
};
const capped = (limit = 100) =>
  Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;

/** Directly opens the shipped Rust SQLite schema; no native CLI home is accessed. */
export class SessionDatabase {
  readonly db: Database.Database;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, "cache.db"));
    this.db.pragma("busy_timeout=5000");
    this.db.transaction(() => this.initialize())();
  }
  close() {
    this.db.close();
  }
  private initialize() {
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user_id TEXT,title TEXT NOT NULL,content TEXT NOT NULL,tags TEXT,is_favorited BOOLEAN NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,synced_at TEXT);
 CREATE TABLE IF NOT EXISTS automation_runs(run_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,task_name TEXT NOT NULL,thread_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,started_at TEXT NOT NULL,updated_at TEXT NOT NULL,cwd TEXT);
 CREATE TABLE IF NOT EXISTS automation_run_steps(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,step_kind TEXT NOT NULL,turn_id TEXT,message TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS acp_sessions(session_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,agent_title TEXT,cwd TEXT NOT NULL,title TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,bot_id TEXT);
 CREATE TABLE IF NOT EXISTS acp_session_updates(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY,name TEXT NOT NULL,title TEXT,avatar TEXT NOT NULL,color TEXT NOT NULL,agent_id TEXT NOT NULL,provider TEXT,model TEXT,reasoning_effort TEXT,cwd TEXT NOT NULL,system_prompt TEXT,trust_level TEXT NOT NULL,approved_tools TEXT NOT NULL DEFAULT '[]',mcp_servers TEXT NOT NULL DEFAULT '[]',pinned BOOLEAN NOT NULL DEFAULT 0,archived BOOLEAN NOT NULL DEFAULT 0,notifications_enabled BOOLEAN NOT NULL DEFAULT 1,unread_count INTEGER NOT NULL DEFAULT 0,last_viewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,allowed_bot_ids TEXT NOT NULL DEFAULT '[]');
 `);
    for (const [table, column, type] of [
      ["automation_runs", "cwd", "TEXT"],
      ["acp_sessions", "bot_id", "TEXT"],
      ["bots", "allowed_bot_ids", "TEXT NOT NULL DEFAULT '[]'"],
    ] as const) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === column))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_acp_sessions_bot_updated ON acp_sessions(bot_id,updated_at DESC);CREATE INDEX IF NOT EXISTS idx_acp_sessions_cwd_updated ON acp_sessions(cwd,updated_at DESC);CREATE INDEX IF NOT EXISTS idx_acp_session_updates_session ON acp_session_updates(session_id,id ASC);CREATE INDEX IF NOT EXISTS idx_bots_pinned_updated ON bots(pinned DESC,updated_at DESC);CREATE INDEX IF NOT EXISTS idx_automation_runs_task_started ON automation_runs(task_id,started_at DESC);CREATE INDEX IF NOT EXISTS idx_automation_runs_thread ON automation_runs(thread_id);CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run_created ON automation_run_steps(run_id,created_at ASC);CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);CREATE INDEX IF NOT EXISTS idx_notes_synced ON notes(synced_at);`,
    );
  }
  upsertSession(input: {
    sessionId: string;
    agentId: string;
    agentTitle?: string | null;
    cwd: string;
    botId?: string | null;
  }) {
    validDirectory(input.cwd);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO acp_sessions(session_id,agent_id,agent_title,cwd,bot_id,title,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?) ON CONFLICT(session_id) DO UPDATE SET agent_id=excluded.agent_id,agent_title=excluded.agent_title,cwd=excluded.cwd,bot_id=excluded.bot_id`,
        )
        .run(
          input.sessionId,
          input.agentId,
          input.agentTitle ?? null,
          input.cwd,
          input.botId ?? null,
          now,
          now,
        );
      if (input.botId) {
        this.db
          .prepare(
            "DELETE FROM acp_session_updates WHERE session_id IN (SELECT session_id FROM acp_sessions WHERE bot_id=? AND title IS NULL AND session_id!=?)",
          )
          .run(input.botId, input.sessionId);
        this.db
          .prepare(
            "DELETE FROM acp_sessions WHERE bot_id=? AND title IS NULL AND session_id!=?",
          )
          .run(input.botId, input.sessionId);
      }
    })();
  }
  appendUpdate(id: string, payload: unknown) {
    const raw = JSON.stringify(payload);
    if (raw === undefined) throw new Error("Invalid transcript payload");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO acp_session_updates(session_id,payload,created_at) VALUES(?,?,?)",
        )
        .run(id, raw, now);
      this.db
        .prepare("UPDATE acp_sessions SET updated_at=? WHERE session_id=?")
        .run(now, id);
    })();
  }
  setTitleIfEmpty(id: string, title: string) {
    this.db
      .prepare(
        "UPDATE acp_sessions SET title=? WHERE session_id=? AND (title IS NULL OR title='')",
      )
      .run([...title].slice(0, 120).join(""), id);
  }
  listSessions(cwd?: string, limit = 100) {
    return this.db
      .prepare(
        "SELECT * FROM acp_sessions WHERE (? IS NULL OR cwd=?) AND bot_id IS NULL ORDER BY updated_at DESC LIMIT ?",
      )
      .all(cwd ?? null, cwd ?? null, capped(limit))
      .map(session);
  }
  listBotSessions(id: string, limit = 100) {
    return this.db
      .prepare(
        "SELECT * FROM acp_sessions WHERE bot_id=? AND title IS NOT NULL ORDER BY updated_at DESC LIMIT ?",
      )
      .all(id, capped(limit))
      .map(session);
  }
  getUpdates(id: string): unknown[] {
    return (
      this.db
        .prepare(
          "SELECT payload FROM acp_session_updates WHERE session_id=? ORDER BY id ASC",
        )
        .all(id) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as unknown);
  }
  deleteSession(id: string) {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM acp_session_updates WHERE session_id=?")
        .run(id);
      this.db.prepare("DELETE FROM acp_sessions WHERE session_id=?").run(id);
    })();
  }
  createBot(input: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    cwd: string;
    agentId?: string;
    trustLevel?: string;
  }) {
    validId(input.id);
    validDirectory(input.cwd);
    const trust = input.trustLevel ?? "ask";
    if (!["ask", "read_only", "autonomous"].includes(trust))
      throw new Error("Invalid trust level");
    for (const v of [input.name, input.avatar, input.color])
      if (typeof v !== "string") throw new Error("Invalid bot fields");
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO bots(id,name,avatar,color,agent_id,cwd,trust_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.name,
        input.avatar,
        input.color,
        input.agentId ?? "keke",
        input.cwd,
        trust,
        now,
        now,
      );
    return this.getBot(input.id)!;
  }
  getBot(id: string) {
    const row = this.db.prepare("SELECT * FROM bots WHERE id=?").get(id);
    return row ? bot(row) : undefined;
  }
  listBots(includeArchived = false) {
    return this.db
      .prepare(
        "SELECT * FROM bots WHERE (?=1 OR archived=0) ORDER BY pinned DESC,updated_at DESC",
      )
      .all(Number(includeArchived))
      .map(bot);
  }
  updateBot(id: string, patch: BotPatch) {
    const sets: string[] = [],
      values: (string | number | null)[] = [];
    let edited = false;
    const stringKeys = [
      "name",
      "title",
      "avatar",
      "color",
      "provider",
      "model",
      "reasoningEffort",
      "cwd",
      "systemPrompt",
      "trustLevel",
      "lastViewedAt",
    ] as const;
    for (const key of stringKeys) {
      const value = patch[key];
      if (value == null) continue;
      if (typeof value !== "string") throw new Error(`Invalid ${key}`);
      if (key === "cwd") validDirectory(value);
      if (
        key === "trustLevel" &&
        !["ask", "read_only", "autonomous"].includes(value)
      )
        throw new Error("Invalid trust level");
      sets.push(`${key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}=?`);
      values.push(value);
      if (key !== "lastViewedAt") edited = true;
    }
    for (const key of [
      "approvedTools",
      "mcpServers",
      "allowedBotIds",
    ] as const) {
      const list = patch[key];
      if (list == null) continue;
      if (!Array.isArray(list) || !list.every((v) => typeof v === "string"))
        throw new Error(`Invalid ${key}`);
      if (key === "allowedBotIds") list.forEach(validId);
      sets.push(`${key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}=?`);
      values.push(JSON.stringify(list));
      edited = true;
    }
    for (const key of ["pinned", "archived", "notificationsEnabled"] as const) {
      if (patch[key] == null) continue;
      if (typeof patch[key] !== "boolean") throw new Error(`Invalid ${key}`);
      sets.push(`${key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}=?`);
      values.push(Number(patch[key]));
      edited = true;
    }
    if (patch.unreadCount != null) {
      if (!Number.isSafeInteger(patch.unreadCount) || patch.unreadCount < 0)
        throw new Error("Invalid unread count");
      sets.push("unread_count=?");
      values.push(patch.unreadCount);
    }
    if (edited) {
      sets.push("updated_at=?");
      values.push(new Date().toISOString());
    }
    if (sets.length)
      this.db
        .prepare(`UPDATE bots SET ${sets.join(",")} WHERE id=?`)
        .run(...values, id);
    const result = this.getBot(id);
    if (!result) throw new Error(`No bot with id ${id}`);
    return result;
  }
  deleteBot(id: string) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM acp_session_updates WHERE session_id IN (SELECT session_id FROM acp_sessions WHERE bot_id=?)",
        )
        .run(id);
      this.db.prepare("DELETE FROM acp_sessions WHERE bot_id=?").run(id);
      this.db.prepare("DELETE FROM bots WHERE id=?").run(id);
    })();
  }
  incrementUnread(id: string) {
    this.db
      .prepare(
        "UPDATE bots SET unread_count=unread_count+1,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), id);
    return this.getBot(id);
  }
  insertRunStarted(
    taskId: string,
    taskName: string,
    threadId: string,
    cwd: string | null,
    startedAt = new Date().toISOString(),
  ) {
    this.db
      .prepare(
        `INSERT INTO automation_runs(run_id,task_id,task_name,thread_id,status,started_at,updated_at,cwd) VALUES(?,?,?,?,'running',?,?,?) ON CONFLICT(thread_id) DO UPDATE SET task_id=excluded.task_id,task_name=excluded.task_name,status='running',started_at=excluded.started_at,updated_at=excluded.updated_at,cwd=excluded.cwd`,
      )
      .run(
        "run-" + randomUUID(),
        taskId,
        taskName,
        threadId,
        startedAt,
        new Date().toISOString(),
        cwd,
      );
  }
  markRunStatus(threadId: string, status: string) {
    this.db
      .prepare(
        "UPDATE automation_runs SET status=?,updated_at=? WHERE thread_id=?",
      )
      .run(status, new Date().toISOString(), threadId);
  }
  listRuns(taskId?: string, limit = 100): AutomationRunRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM automation_runs WHERE (? IS NULL OR task_id=?) ORDER BY started_at DESC LIMIT ?",
      )
      .all(
        taskId ?? null,
        taskId ?? null,
        capped(limit),
      ) as AutomationRunRecord[];
  }
}
