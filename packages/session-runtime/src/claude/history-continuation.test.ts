import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeHistory } from "./history.js";
import Database from "better-sqlite3";

test("continued-in parent remains listed with readable native history as in the legacy session list", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-continued-"));
  const cwd = join(home, "project");
  await mkdir(cwd);
  const root = join(
    home,
    ".claude/projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  await mkdir(root, { recursive: true });
  const parent = randomUUID(),
    successor = randomUUID();
  const row = (id: string) => ({
    type: "user",
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: id,
    cwd,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "Synthetic fixture prompt" },
  });
  const parentFile = join(root, parent + ".jsonl");
  const parentText =
    [row(parent), { type: "continued-in", continuedInSessionId: successor }]
      .map((v) => JSON.stringify(v))
      .join("\n") + "\n";
  await writeFile(parentFile, parentText);
  await writeFile(
    join(root, successor + ".jsonl"),
    JSON.stringify(row(successor)) + "\n",
  );
  const history = new ClaudeHistory(home, {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    PATH: process.env.PATH,
  });
  try {
    const result = await history.list(cwd);
    assert.deepEqual(
      new Set(result.sessions.map((s) => s.session_id)),
      new Set([parent, successor]),
    );
    assert.equal(((await history.messages(parent)) as unknown[]).length, 1);
    assert.equal(await readFile(parentFile, "utf8"), parentText);
    const db = new Database(join(home, ".codexia/cache.db"));
    try {
      db.prepare("DELETE FROM cc_sessions WHERE session_id=?").run(parent);
      db.prepare(
        "UPDATE cc_session_metadata SET fingerprint=replace(fingerprint,'continued-parents-v1:','')",
      ).run();
    } finally {
      db.close();
    }
    const restarted = new ClaudeHistory(home, {
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      PATH: process.env.PATH,
    });
    assert.deepEqual(
      new Set((await restarted.list(cwd)).sessions.map((s) => s.session_id)),
      new Set([parent, successor]),
    );
    assert.equal(await readFile(parentFile, "utf8"), parentText);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
