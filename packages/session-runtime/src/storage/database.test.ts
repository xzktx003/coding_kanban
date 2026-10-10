import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SessionDatabase } from "./database.js";

test("legacy SQLite is upgraded without changing bot permissions or history timestamps", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-db-"));
  try {
    const old = new Database(join(dir, "cache.db"));
    old.exec(
      "CREATE TABLE acp_sessions(session_id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,agent_title TEXT,cwd TEXT NOT NULL,title TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); INSERT INTO acp_sessions VALUES('old','keke',NULL,'/tmp','hello','yesterday','yesterday')",
    );
    old.close();
    const db = new SessionDatabase(dir);
    db.upsertSession({ sessionId: "old", agentId: "keke", cwd: "/tmp" });
    assert.equal(db.listSessions()[0]?.updatedAt, "yesterday");
    const bot = db.createBot({
      id: "bot",
      name: "Bot",
      avatar: "B",
      color: "#fff",
      cwd: "/tmp",
    });
    assert.equal(bot.allowedBotIds, "[]");
    db.upsertSession({
      sessionId: "bot-session",
      agentId: "keke",
      cwd: "/tmp",
      botId: "bot",
    });
    db.setTitleIfEmpty("bot-session", "message");
    db.appendUpdate("bot-session", { text: "saved" });
    assert.equal(db.listSessions().length, 1);
    assert.equal(db.listBotSessions("bot").length, 1);
    assert.deepEqual(db.getUpdates("bot-session"), [{ text: "saved" }]);
    const updated = db.updateBot("bot", {
      unreadCount: 0,
      lastViewedAt: "now",
    });
    assert.equal(updated.updatedAt, bot.updatedAt);
    db.deleteBot("bot");
    assert.deepEqual(db.getUpdates("bot-session"), []);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid patch cannot mutate path or standing permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-db-"));
  const db = new SessionDatabase(dir);
  try {
    db.createBot({ id: "b", name: "Bot", avatar: "", color: "", cwd: "/tmp" });
    assert.throws(() => db.updateBot("b", { cwd: "relative" }));
    assert.throws(() => db.updateBot("b", { allowedBotIds: ["../x"] }));
    assert.equal(db.getBot("b")?.allowedBotIds, "[]");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
