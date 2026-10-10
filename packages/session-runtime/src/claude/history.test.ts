import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeHistory, type historyCall } from "./history.js";

test("Claude metadata cache coalesces idle lists, refreshes only changed metadata, and filters global worktrees", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-metadata-"));
  const projects = join(home, ".claude/projects/p");
  await mkdir(projects, { recursive: true });
  const file = join(projects, "session.jsonl");
  await writeFile(file, "metadata");
  let scans = 0;
  let rows = [
    { sessionId: "plain", summary: "plain", lastModified: 1, cwd: "/project" },
    {
      sessionId: "worktree",
      summary: "branch",
      lastModified: 2,
      cwd: "/project/.codexia/worktrees/branch",
    },
    { sessionId: "unknown", summary: "unknown", lastModified: 3 },
  ];
  const call = (async (method) => {
    assert.equal(method, "listSessions");
    scans++;
    await new Promise((r) => setImmediate(r));
    return rows;
  }) as typeof historyCall;
  const history = new ClaudeHistory(
    home,
    { HOME: home },
    { call, metadataCheckIntervalMs: 0 },
  );
  try {
    await Promise.all([history.list(), history.list()]);
    assert.equal(scans, 1);
    assert.deepEqual(
      (await history.list(undefined, undefined, 0, false)).sessions.map(
        (row) => row.session_id,
      ),
      ["plain"],
    );
    await history.list("/project", 10, 0, true);
    assert.equal(scans, 1);
    rows = [
      {
        sessionId: "plain",
        summary: "changed",
        lastModified: 4,
        cwd: "/project",
      },
    ];
    await appendFile(file, " changed");
    assert.equal((await history.list()).sessions[0].summary, "changed");
    assert.equal((await history.list()).total, 1);
    assert.equal(scans, 2);
    const restarted = new ClaudeHistory(
      home,
      { HOME: home },
      { call, metadataCheckIntervalMs: 0 },
    );
    assert.equal((await restarted.list()).total, 1);
    assert.equal(scans, 2);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Claude metadata check budget defers repeated stats and SDK failures preserve existing SQLite cache", async () => {
  const home = await mkdtemp(join(tmpdir(), "cc-metadata-budget-"));
  const projects = join(home, ".claude/projects/p");
  await mkdir(projects, { recursive: true });
  const file = join(projects, "session.jsonl");
  await writeFile(file, "metadata");
  let scans = 0;
  let now = 0;
  let fail = false;
  const call = (async () => {
    scans++;
    if (fail) throw new Error("fixture SDK scan failed");
    return [
      {
        sessionId: "plain",
        summary: "plain",
        lastModified: 1,
        cwd: "/project",
      },
    ];
  }) as typeof historyCall;
  const history = new ClaudeHistory(
    home,
    { HOME: home },
    { call, metadataCheckIntervalMs: 2000, now: () => now },
  );
  try {
    await history.list();
    await appendFile(file, " changed");
    for (let n = 0; n < 20; n++) await history.list();
    assert.equal(scans, 1);
    now = 2001;
    fail = true;
    await assert.rejects(history.list(), /fixture SDK scan failed/);
    fail = false;
    assert.equal((await history.list()).total, 1);
    assert.equal(scans, 3);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
