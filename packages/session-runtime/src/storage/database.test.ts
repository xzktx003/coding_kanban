import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SessionDatabase } from "./database.js";
import { acpHistorySessionId } from "../acp/history-identity.js";

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

test("opening another bot connection prunes only empty sessions and preserves untitled real replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-db-replay-"));
  const db = new SessionDatabase(dir);
  try {
    for (const sessionId of ["empty", "replayed"])
      db.upsertSession({ sessionId, agentId: "fixture", cwd: dir, botId: "b" });
    db.appendUpdate("replayed", {
      historyReplayed: true,
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "actual native replay" },
    });
    db.upsertSession({
      sessionId: "next",
      agentId: "fixture",
      cwd: dir,
      botId: "b",
    });
    assert.equal(db.getSessionInfo("empty"), undefined);
    assert.ok(
      db.getSessionInfo("replayed"),
      "native replay with no local title is not an empty bot session",
    );
    assert.equal(db.getUpdates("replayed").length, 1);
    assert.deepEqual(
      db.listBotSessions("b").map((row) => row.sessionId),
      ["replayed"],
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, nextRuntime, nextConnection] of [
  ["another connection", "runtime-a", "connection-b"],
  ["another runtime", "runtime-b", "connection-a"],
] as const) {
  test(`a bot opened in ${label} cannot prune a scoped owner awaiting its first update`, () => {
    const dir = mkdtempSync(join(tmpdir(), "session-db-pending-owner-"));
    const db = new SessionDatabase(dir);
    try {
      const owner = {
        nativeSessionId: "native-shared-id",
        runtimeInstance: "runtime-a",
        connectionId: "connection-a",
        agentId: "fixture",
        cwd: dir,
        botId: "same-bot",
      };
      const original = acpHistorySessionId(
        owner.runtimeInstance,
        owner.connectionId,
        owner.agentId,
        owner.nativeSessionId,
      );
      db.upsertSession({ ...owner, sessionId: original });
      const next = acpHistorySessionId(
        nextRuntime,
        nextConnection,
        owner.agentId,
        owner.nativeSessionId,
      );
      db.upsertSession({
        ...owner,
        runtimeInstance: nextRuntime,
        connectionId: nextConnection,
        sessionId: next,
      });
      assert.ok(
        db.getSessionInfo(original),
        "zero updates cannot prove a scoped live/replaying/unknown owner is safe to delete",
      );
      assert.ok(db.getSessionInfo(next));
      assert.deepEqual(
        db.listBotSessions(owner.botId),
        [],
        "empty sources stay hidden without deleting their owner identity",
      );
      db.appendUpdate(original, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "late original response" },
      });
      assert.equal(
        db.getSessionInfo(original)?.connectionId,
        owner.connectionId,
      );
      assert.deepEqual(
        db.listBotSessions(owner.botId).map((row) => row.sessionId),
        [original],
      );
      assert.deepEqual(db.getUpdates(next), []);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
