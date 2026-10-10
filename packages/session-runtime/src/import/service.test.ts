import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDatabase } from "../storage/database.js";
import { ImportService } from "./service.js";
import { JsonStore } from "../core/json-store.js";
test("explicit import preserves duplicate events, is idempotent, isolates credentials and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "import-"));
  const source = join(root, "source"),
    target = join(root, "target");
  const from = new SessionDatabase(source),
    to = new SessionDatabase(target);
  try {
    from.upsertSession({ sessionId: "s", agentId: "keke", cwd: "/tmp" });
    from.appendUpdate("s", { text: "same" });
    from.appendUpdate("s", { text: "same" });
    from.db.prepare("UPDATE acp_session_updates SET created_at='same'").run();
    await writeFile(
      join(source, "settings.json"),
      JSON.stringify({
        workspace: {
          projects: ["/imported"],
          historyProjects: ["relative", "/history"],
        },
        remote: { token: "SECRET" },
      }),
    );
    await mkdir(join(source, "bots", "b", "memory"), { recursive: true });
    await writeFile(join(source, "bots", "b", "memory", "note.md"), "memory");
    await symlink(
      join(source, "settings.json"),
      join(source, "bots", "b", "memory", "secret-link"),
    );
    const service = new ImportService({
      db: to,
      dataDir: target,
      settings: new JsonStore(join(target, "settings.json"), () => ({
        version: 1,
      })),
      importTasks: async () => 0,
    });
    assert.equal((await service.preview(source)).projects, 1);
    const result = await service.apply(source);
    assert.equal(result.records, 3);
    assert.equal(result.memoryFiles, 1);
    assert.equal(to.getUpdates("s").length, 2);
    const again = await service.apply(source);
    assert.equal(again.records, 0);
    assert.equal(again.memoryFiles, 0);
    assert.equal(to.getUpdates("s").length, 2);
    assert.deepEqual(
      JSON.parse(await readFile(join(target, "settings.json"), "utf8")),
      {
        version: 1,
        workspace: { projects: ["/imported"], historyProjects: ["/history"] },
      },
    );
    await assert.rejects(service.apply(target));
    await assert.rejects(service.preview("relative"));
  } finally {
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("malformed destination settings abort import before touching database", async () => {
  const root = await mkdtemp(join(tmpdir(), "import-"));
  const from = new SessionDatabase(join(root, "source")),
    to = new SessionDatabase(join(root, "target"));
  try {
    from.upsertSession({ sessionId: "s", agentId: "keke", cwd: "/tmp" });
    const path = join(root, "target", "settings.json");
    await writeFile(path, "{broken");
    const service = new ImportService({
      db: to,
      dataDir: join(root, "target"),
      settings: new JsonStore(path, () => ({})),
      importTasks: async () => 0,
    });
    await assert.rejects(service.apply(join(root, "source")));
    assert.equal(to.listSessions().length, 0);
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally {
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an incompatible source row rolls back all previously copied tables", async () => {
  const root = await mkdtemp(join(tmpdir(), "import-atomic-"));
  const source = join(root, "source"),
    target = join(root, "target");
  const from = new SessionDatabase(source),
    to = new SessionDatabase(target);
  try {
    from.createBot({ id: "b", name: "B", avatar: "", color: "", cwd: "/tmp" });
    from.db.exec(
      "ALTER TABLE acp_sessions DROP COLUMN agent_id; INSERT INTO acp_sessions(session_id,cwd,created_at,updated_at) VALUES('bad','/tmp','now','now')",
    );
    const service = new ImportService({
      db: to,
      dataDir: target,
      settings: new JsonStore(join(target, "settings.json"), () => ({})),
      importTasks: async () => 0,
    });
    await assert.rejects(service.apply(source));
    assert.equal(to.listBots().length, 0);
  } finally {
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("large transcript import keeps event-loop heartbeats responsive", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "import-responsive-"));
  const source = join(root, "source"),
    target = join(root, "target");
  const from = new SessionDatabase(source),
    to = new SessionDatabase(target);
  let timer: NodeJS.Timeout | undefined;
  try {
    from.upsertSession({ sessionId: "bulk", agentId: "keke", cwd: "/tmp" });
    const put = from.db.prepare(
      "INSERT INTO acp_session_updates(session_id,payload,created_at) VALUES(?,?,?)",
    );
    from.db.transaction(() => {
      for (let i = 0; i < 8000; i++)
        put.run("bulk", JSON.stringify({ text: "x".repeat(256), i }), "same");
    })();
    const service = new ImportService({
      db: to,
      dataDir: target,
      settings: new JsonStore(join(target, "settings.json"), () => ({})),
      importTasks: async () => 0,
    });
    let last = performance.now(),
      maxGap = 0,
      ticks = 0;
    timer = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      ticks++;
    }, 5);
    const result = await service.apply(source);
    await new Promise((r) => setTimeout(r, 10));
    clearInterval(timer);
    assert.equal(result.records, 8001);
    assert.ok(ticks >= 5, `only ${ticks} heartbeats while importing`);
    assert.ok(maxGap < 200, `main thread blocked ${maxGap.toFixed(1)}ms`);
    t.diagnostic(
      JSON.stringify({
        importedEvents: 8000,
        heartbeatTicks: ticks,
        maxHeartbeatGapMs: Number(maxGap.toFixed(2)),
      }),
    );
  } finally {
    if (timer) clearInterval(timer);
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling an in-progress worker rolls back its transaction and closes its connections", async () => {
  const { importDatabaseWorker } = await import("./database-worker-client.js");
  const root = await mkdtemp(join(tmpdir(), "import-cancel-"));
  const source = join(root, "source"),
    target = join(root, "target"),
    from = new SessionDatabase(source),
    to = new SessionDatabase(target);
  try {
    from.upsertSession({ sessionId: "bulk", agentId: "keke", cwd: "/tmp" });
    const put = from.db.prepare(
      "INSERT INTO acp_session_updates(session_id,payload,created_at) VALUES(?,?,?)",
    );
    from.db.transaction(() => {
      for (let i = 0; i < 10000; i++)
        put.run("bulk", JSON.stringify({ i, text: "x".repeat(256) }), "same");
    })();
    const operation = importDatabaseWorker<number>(
      join(source, "cache.db"),
      join(target, "cache.db"),
    );
    const result = operation.promise.catch((e) => e as Error);
    await operation.started;
    await operation.cancel();
    assert.match(String(await result), /cancelled/);
    assert.equal(to.listSessions().length, 0);
    assert.equal(to.getUpdates("bulk").length, 0);
    to.upsertSession({ sessionId: "after", agentId: "keke", cwd: "/tmp" });
    assert.equal(to.listSessions().length, 1);
  } finally {
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("worker errors do not expose trigger details or source record contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "import-private-error-"));
  const from = new SessionDatabase(join(root, "source")),
    to = new SessionDatabase(join(root, "target"));
  try {
    from.upsertSession({
      sessionId: "private-session",
      agentId: "keke",
      cwd: "/tmp",
    });
    to.db.exec(
      "CREATE TRIGGER reject_import BEFORE INSERT ON acp_sessions BEGIN SELECT RAISE(ABORT,'PRIVATE_TRIGGER_SECRET'); END",
    );
    const service = new ImportService({
      db: to,
      dataDir: join(root, "target"),
      settings: new JsonStore(
        join(root, "target", "settings.json"),
        () => ({}),
      ),
      importTasks: async () => 0,
    });
    await assert.rejects(
      service.apply(join(root, "source")),
      (error) =>
        String(error).includes("transaction failed") &&
        !String(error).includes("PRIVATE_TRIGGER_SECRET") &&
        !String(error).includes("private-session"),
    );
    await service.close();
    assert.equal(to.listSessions().length, 0);
    await assert.rejects(service.apply(join(root, "source")), /closed/);
  } finally {
    from.close();
    to.close();
    await rm(root, { recursive: true, force: true });
  }
});
