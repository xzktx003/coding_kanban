import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../server.js";
test("complete runtime registers legacy HTTP contract with shared isolated storage and no eager CLI startup", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "session-ts-integration-"));
  const runtime = await createRuntime({
    dataHome: join(root, "data"),
    instance: "isolated",
    env: {
      ...process.env,
      HOME: join(root, "home"),
      CODEX_HOME: join(root, "codex"),
      CODEX_PATH: join(root, "not-installed"),
    },
  });
  t.after(async () => {
    await runtime.app.close();
    await rm(root, { recursive: true, force: true });
  });
  const routes = JSON.parse(
    await readFile(
      new URL("../../route-contract.json", import.meta.url),
      "utf8",
    ),
  ) as { method: "GET" | "POST"; path: string }[];
  assert.deepEqual(
    routes.filter(
      (r) => !runtime.app.hasRoute({ method: r.method, url: r.path }),
    ),
    [],
  );
  assert.deepEqual((await runtime.app.inject("/health")).json().capabilities, {
    codexOwnership: true,
    codexMcpAuthV1: true,
    codexMcpOAuthThreadId: false,
    codexAccountMutationsV1: true,
    acpImages: true,
  });
  assert.equal(runtime.app.hasRoute({method:"POST",url:"/api/codex/mcp/reload"}),true);
  for (const [path, payload, expected] of [
    ["bots/list", {}, []],
    ["automation/list", {}, []],
    ["acp/sessions", {}, []],
  ] as const) {
    const response = await runtime.app.inject({
      method: "POST",
      url: "/api/" + path,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), expected);
  }
  const created = await runtime.app.inject({
    method: "POST",
    url: "/api/bots/create",
    payload: {
      id: "test",
      name: "test",
      avatar: "",
      color: "",
      agentId: "keke",
      cwd: root,
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    (
      await runtime.app.inject({
        method: "POST",
        url: "/api/bots/list",
        payload: {},
      })
    ).json().length,
    1,
  );
});

test("constructor failure closes resources allocated before platform configuration is read", async (t) => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { SessionDatabase } = await import("../storage/database.js");
  const { EventHub } = await import("../core/events.js");
  const root = await mkdtemp(join(tmpdir(), "runtime-failed-init-"));
  await mkdir(join(root, ".codexia"));
  await writeFile(join(root, ".codexia", "device-token"), "");
  let databaseClosed = 0,
    hubClosed = 0;
  const closeDb = SessionDatabase.prototype.close,
    closeHub = EventHub.prototype.close;
  t.mock.method(
    SessionDatabase.prototype,
    "close",
    function (this: InstanceType<typeof SessionDatabase>) {
      databaseClosed++;
      closeDb.call(this);
    },
  );
  t.mock.method(
    EventHub.prototype,
    "close",
    function (this: InstanceType<typeof EventHub>) {
      hubClosed++;
      closeHub.call(this);
    },
  );
  try {
    await assert.rejects(
      createRuntime({
        dataHome: root,
        instance: "failure",
        env: { ...process.env, HOME: join(root, "home") },
      }),
      /Empty device token/,
    );
    assert.equal(databaseClosed, 1);
    assert.equal(hubClosed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("one cleanup failure cannot leave event consumers or other resources open", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runtime-close-error-"));
  const runtime = await createRuntime({
    dataHome: root,
    instance: "close-error",
    env: { ...process.env, HOME: join(root, "home") },
  });
  const subscription = runtime.hub.subscribe();
  const close = runtime.db.close.bind(runtime.db);
  t.mock.method(runtime.db, "close", () => {
    close();
    throw new Error("fixture close failure");
  });
  try {
    await assert.rejects(runtime.app.close(), /cleanup|fixture close failure/);
    assert.equal(runtime.hub.subscriberCount, 0);
    assert.equal((await subscription.next()).done, true);
  } finally {
    runtime.hub.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("automation scheduler starts after successful listening, never during construction or route injection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "runtime-scheduler-"));
  const runtime = await createRuntime({
    dataHome: root,
    instance: "scheduler",
    env: { ...process.env, HOME: join(root, "home") },
  });
  let ticks = 0;
  t.mock.method(runtime.automation, "tick", async () => {
    ticks++;
  });
  try {
    await runtime.app.inject("/health");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(ticks, 0);
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.ok(ticks > 0);
  } finally {
    await runtime.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
