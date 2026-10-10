import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventHub } from "../core/events.js";
import { SessionDatabase } from "../storage/database.js";
import { AutomationService, scheduleToCron } from "./service.js";
test("cron normalization preserves local weekday and uniform interval contract", () => {
  assert.equal(
    scheduleToCron({
      mode: "daily",
      hour: 5,
      minute: 9,
      weekdays: ["monday", "fri"],
    }),
    "0 9 5 * * MON,FRI",
  );
  assert.equal(
    scheduleToCron({ mode: "interval", interval_hours: 24 }),
    "0 0 0 * * SUN,MON,TUE,WED,THU,FRI,SAT",
  );
  assert.throws(() => scheduleToCron({ mode: "interval", interval_hours: 7 }));
});
test("automation persistence, overlap, import-paused and final status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-ts-"));
  const db = new SessionDatabase(dir);
  const hub = new EventHub();
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const service = new AutomationService({
    dataDir: dir,
    db,
    hub,
    runners: {
      codex: async (spec) => {
        calls++;
        spec.onStarted("thread-" + calls);
        await gate;
        return "finished";
      },
    },
  });
  try {
    await service.initialize(false);
    const task = await service.create({
      name: " Test ",
      prompt: "do it",
      projects: ["/tmp"],
      schedule: { mode: "daily" },
    });
    const run = service.execute(task);
    await new Promise((r) => setTimeout(r, 10));
    await service.execute(task);
    assert.equal(calls, 1);
    assert.equal(db.listRuns()[0]?.status, "running");
    release();
    await run;
    assert.equal(db.listRuns()[0]?.status, "completed");
    await service.setPaused(task.id, true);
    assert.equal((await service.list())[0]?.paused, true);
    assert.equal(
      await service.importPaused([{ ...task, id: "imported", paused: false }]),
      1,
    );
    assert.equal(
      (await service.list()).find((t) => t.id === "imported")?.paused,
      true,
    );
    assert.equal(await service.importPaused([{ ...task, id: "imported" }]), 0);
  } finally {
    service.close();
    db.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler runs due tasks once per minute, pauses imports and records failed runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-tick-"));
  const db = new SessionDatabase(dir);
  const hub = new EventHub();
  let count = 0;
  const service = new AutomationService({
    dataDir: dir,
    db,
    hub,
    runners: {
      codex: async (spec) => {
        spec.onStarted("failed-" + ++count);
        throw new Error("fixture failure");
      },
    },
  });
  try {
    await service.initialize(false);
    await service.create({
      name: "test",
      prompt: "task",
      projects: [],
      schedule: { mode: "daily", hour: 3, minute: 15 },
    });
    const when = new Date(2031, 0, 7, 3, 15, 0);
    await service.tick(when);
    await new Promise((r) => setTimeout(r, 5));
    await service.tick(new Date(2031, 0, 7, 3, 15, 30));
    assert.equal(count, 1);
    assert.equal(db.listRuns()[0]?.status, "failed");
    await service.tick(new Date(2031, 0, 8, 3, 15, 0));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(count, 2);
  } finally {
    service.close();
    db.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("detached automation retains its overlap guard through the completion event", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-detached-"));
  const db = new SessionDatabase(dir);
  const hub = new EventHub();
  let count = 0;
  const service = new AutomationService({
    dataDir: dir,
    db,
    hub,
    runners: {
      codex: async (spec) => {
        spec.onStarted("detached-" + ++count);
        return "detached";
      },
    },
  });
  try {
    await service.initialize(false);
    const task = await service.create({
      name: "task",
      prompt: "work",
      projects: [],
      schedule: { mode: "daily" },
    });
    const first = service.execute(task);
    await new Promise((r) => setTimeout(r, 5));
    await service.execute(task);
    assert.equal(count, 1);
    hub.publish("codex:notification", {
      method: "turn/completed",
      params: { threadId: "detached-1", turn: { status: "completed" } },
    });
    await first;
    assert.equal(db.listRuns()[0]?.status, "completed");
  } finally {
    service.close();
    db.close();
    hub.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP automation request aliases and default projects remain compatible", async () => {
  const { default: fastify } = await import("fastify");
  const { registerAutomationRoutes } = await import("./service.js");
  const root = await mkdtemp(join(tmpdir(), "auto-http-"));
  const db = new SessionDatabase(root),
    hub = new EventHub();
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    runners: { bot: async () => "finished" },
  });
  const app = fastify();
  registerAutomationRoutes(app, service);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/automation/create",
      payload: {
        name: "task",
        prompt: "work",
        schedule: { mode: "daily" },
        agent: "bot",
        modelProvider: "fixture",
        cwdMode: "worktree",
        botId: "b",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().bot_id, "b");
    assert.equal(response.json().model_provider, "fixture");
    assert.equal(response.json().cwd_mode, "worktree");
    assert.deepEqual(response.json().projects, []);
    db.insertRunStarted(response.json().id, "task", "thread", null);
    db.insertRunStarted("other", "other", "other-thread", null);
    const runs = await app.inject({
      method: "POST",
      url: "/api/automation/runs/list",
      payload: { taskId: response.json().id },
    });
    assert.equal(runs.json().length, 1);
  } finally {
    await service.close();
    await app.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown aborts only its runners, drains before DB close and forbids queued targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-close-"));
  const db = new SessionDatabase(root),
    hub = new EventHub();
  const calls: string[] = [];
  let aborted = false;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    runners: {
      codex: async (spec) => {
        calls.push(spec.cwd!);
        spec.onStarted("owned");
        started();
        return new Promise((resolve) => {
          spec.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve("finished");
            },
            { once: true },
          );
        });
      },
    },
  });
  try {
    await service.initialize(false);
    const task = await service.create({
      name: "task",
      prompt: "work",
      projects: ["/first", "/second"],
      schedule: { mode: "daily" },
    });
    const run = service.execute(task);
    await ready;
    const closed = service.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aborted, true);
    await closed;
    await run;
    assert.deepEqual(calls, ["/first"]);
    assert.equal(db.listRuns()[0]?.status, "failed");
    await service.execute(task);
    assert.deepEqual(calls, ["/first"]);
    await assert.rejects(service.runNow(task.id), /closed/);
  } finally {
    await service.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("shutdown fences stalled worktree preparation and late runner callbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-late-close-"));
  const db = new SessionDatabase(root),
    hub = new EventHub();
  let release!: (path: string) => void;
  let entered!: () => void;
  let calls = 0;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    prepareWorktree: async () => {
      entered();
      return new Promise<string>((r) => {
        release = r;
      });
    },
    runners: {
      codex: async () => {
        calls++;
        return "finished";
      },
    },
  });
  try {
    await service.initialize(false);
    const task = await service.create({
      name: "task",
      prompt: "work",
      projects: ["/tmp"],
      cwd_mode: "worktree",
      schedule: { mode: "daily" },
    });
    const run = service.execute(task);
    await ready;
    await service.close();
    await run;
    release("/late");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 0);
    assert.equal(db.listRuns().length, 0);
  } finally {
    await service.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("large unrelated tool streams cannot evict automation completion or its event consumer", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-filter-"));
  const db = new SessionDatabase(root);
  const hub = new EventHub({
    subscriberBytes: 65536,
    subscriberCapacity: 16,
    replayBytes: 131072,
  });
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    runners: {},
  });
  try {
    await service.initialize(false);
    db.insertRunStarted("task", "Task", "thread", null);
    db.insertRunStarted("task", "Task", "second", null);
    for (let i = 0; i < 64; i++)
      hub.publish("codex:notification", {
        method: "item/commandExecution/outputDelta",
        params: { threadId: "other", delta: "x".repeat(65536) },
      });
    for (const threadId of ["thread", "second"])
      hub.publish("codex:notification", {
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            status: "completed",
            items: [
              {
                type: "commandExecution",
                aggregatedOutput: "x".repeat(131072),
              },
            ],
          },
        },
      });
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(db.listRuns().every((run) => run.status === "completed"));
    assert.equal(hub.subscriberCount, 1);
  } finally {
    await service.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("bot usage callbacks carry only names and do not break task execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-telemetry-"));
  const db = new SessionDatabase(root),
    hub = new EventHub();
  const events: string[] = [];
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    runners: { bot: async () => "finished" },
    track: async (event) => {
      events.push(event);
      throw new Error("offline");
    },
  });
  try {
    await service.initialize(false);
    await service.create({
      name: "private name",
      prompt: "private prompt",
      projects: [],
      agent: "bot",
      bot_id: "private-id",
      schedule: { mode: "daily" },
    });
    hub.publish("bot:activity", {
      botId: "private-id",
      sessionId: "private-session",
      status: "working",
    });
    for (const status of ["done", "blocked", "failed"])
      hub.publish("bot:activity", {
        botId: "private-id",
        sessionId: "private-session",
        status,
      });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(events, [
      "bot_routine_created",
      "bot_run_done",
      "bot_run_blocked",
      "bot_run_failed",
    ]);
    assert.equal(hub.subscriberCount, 1);
  } finally {
    await service.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Codex disconnect settles only Codex detached work and leaves Claude running", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-disconnect-"));
  const db = new SessionDatabase(root),
    hub = new EventHub();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const service = new AutomationService({
    dataDir: root,
    db,
    hub,
    runners: {
      codex: async (spec) => {
        spec.onStarted("codex-run");
        return "detached";
      },
      cc: async (spec) => {
        spec.onStarted("claude-run");
        await gate;
        return "finished";
      },
    },
  });
  try {
    await service.initialize(false);
    const base = {
      name: "task",
      prompt: "work",
      projects: [],
      schedule: { mode: "daily" as const },
    };
    const codex = await service.create({ ...base, agent: "codex" }),
      claude = await service.create({ ...base, agent: "cc" });
    const run = service.execute(codex),
      other = service.execute(claude);
    await new Promise((r) => setTimeout(r, 5));
    hub.publish("codex:disconnected", {});
    await run;
    assert.equal(
      db.listRuns().find((r) => r.thread_id === "codex-run")?.status,
      "failed",
    );
    assert.equal(
      db.listRuns().find((r) => r.thread_id === "claude-run")?.status,
      "running",
    );
    release();
    await other;
    assert.equal(
      db.listRuns().find((r) => r.thread_id === "claude-run")?.status,
      "completed",
    );
  } finally {
    release();
    await service.close();
    db.close();
    hub.close();
    await rm(root, { recursive: true, force: true });
  }
});
