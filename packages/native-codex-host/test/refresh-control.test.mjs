import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import { once } from "node:events";
import { captureProcessIdentity } from "../refresh-prototype/resources.mjs";

async function fixture(t) {
  const { listenRefreshControl, connectRefreshControl } =
    await import("../refresh-prototype/control-channel.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-refresh-control-")),
    consumers = new Map(),
    profileId = randomUUID(),
    instanceId = randomUUID();
  const serviceScope = {
    domain: randomUUID(),
    generation: randomUUID(),
    ...(await captureProcessIdentity(process.pid)),
  };
  const { nativeAuthorizationIdentity } =
    await import("../refresh-prototype/authorization-boundary.mjs");
  const binding = nativeAuthorizationIdentity(
    { account: null, requiresOpenaiAuth: false },
    serviceScope,
  );
  let invalidated = false,
    openHook = async () => {};
  const observers = new Set(),
    manager = {
      authorization: () => binding,
      serviceScope,
      snapshot: () => ({
        ready: !invalidated,
        authorizationBound: !invalidated,
      }),
      onInvalidated(fn) {
        observers.add(fn);
        return () => observers.delete(fn);
      },
      scopeForThread: async (threadId) => ({ threadId }),
      async open(key, { consumerId }) {
        await openHook();
        const ids = consumers.get(consumerId) ?? new Set();
        ids.add(key.threadId);
        consumers.set(consumerId, ids);
      },
      async disconnect(id) {
        consumers.delete(id);
      },
    };
  const server = await listenRefreshControl({
    manager,
    runtimeRoot: root,
    profiles: [profileId],
    leaseGraceMs: 3000,
  });
  const clients = [],
    sockets = [];
  t.after(async () => {
    for (const c of clients) await c.close();
    for (const s of sockets) s.destroy();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    manager,
    server,
    consumers,
    profileId,
    instanceId,
    sockets,
    async connect(record = server.record, options = {}) {
      const c = await connectRefreshControl({
        runtimeRoot: root,
        record,
        ...options,
      });
      clients.push(c);
      return c;
    },
    setOpenHook(fn) {
      openHook = fn;
    },
    invalidate() {
      invalidated = true;
      for (const fn of [...observers]) fn();
    },
    identity: { origin: "https://lan.example:8484", instanceId },
    hooks: { assertCurrent: async () => {}, onReplaced: () => {} },
  };
}
const wait = async (check, label) => {
  const end = performance.now() + 5000;
  while (performance.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error(label);
};

test("private control keeps a visible lease across gateway connection exit and does not replace another page", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    profile = a.visibility(f.profileId),
    id = randomUUID();
  assert.equal(profile.snapshot().available, true);
  const one = await profile.attach(f.identity, f.hooks);
  await one.update({ sequence: 1, threadIds: [id] });
  const other = await profile.attach(f.identity, f.hooks);
  await other.update({ sequence: 1, threadIds: [id] });
  const consumers = [...f.consumers.keys()];
  assert.equal(consumers.length, 2);
  await a.close();
  assert.equal(profile.snapshot().available, false);
  const b = await f.connect(),
    p = b.visibility(f.profileId),
    resumed = await p.attach({ ...f.identity, ...one.identity }, f.hooks);
  await resumed.update({ sequence: 1, threadIds: [id] });
  assert.equal(f.consumers.size, 2);
  assert.deepEqual([...f.consumers.keys()], consumers);
  const two = await p.attach({ ...f.identity, ...other.identity }, f.hooks);
  await two.update({ sequence: 1, threadIds: [id] });
  resumed.disconnect();
  await wait(
    () => f.server.snapshot().handles === 1,
    "only own handle disconnects",
  );
  assert.equal(p.snapshot().available, true);
});
test("private owner authorization returns only the manager's bound digest and refuses after revocation", async (t) => {
  const f = await fixture(t),
    client = await f.connect();
  assert.deepEqual(client.serviceScope, f.manager.serviceScope);
  assert.deepEqual(await client.authorization(), f.manager.authorization());
  assert.deepEqual(Object.keys(await client.authorization()).sort(), [
    "fingerprint",
    "kind",
  ]);
  f.invalidate();
  await wait(
    () => !client.visibility(f.profileId).snapshot().available,
    "owner authorization revoked",
  );
  await assert.rejects(client.authorization());
});
test("a private resource failure preserves its fixed code and operation without exposing the original error text", async (t) => {
  const f = await fixture(t),
    client = await f.connect(),
    handle = await client.visibility(f.profileId).attach(f.identity, f.hooks);
  f.setOpenHook(async () => {
    throw Object.assign(Error("private payload must stay hidden"), {
      code: "REFRESH_RESOURCES_UNAVAILABLE",
    });
  });
  await assert.rejects(
    handle.update({ sequence: 1, threadIds: [randomUUID()] }),
    (error) => {
      assert.equal(error.code, "REFRESH_RESOURCES_UNAVAILABLE");
      assert.equal(error.operation, "update");
      assert.equal(error.message.includes("private payload"), false);
      return true;
    },
  );
});
test("private control runs each native-host check remotely and closes only the replaced connection", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    p = a.visibility(f.profileId);
  let checks = 0,
    replaced = 0,
    allowed = true;
  const hooks = {
    assertCurrent: async () => {
      checks++;
      if (!allowed) throw Error("stale native host");
    },
    onReplaced: () => replaced++,
  };
  const one = await p.attach(f.identity, hooks);
  await one.update({ sequence: 1, threadIds: [randomUUID()] });
  assert.ok(checks >= 5);
  const b = await f.connect(),
    two = await b
      .visibility(f.profileId)
      .attach({ ...f.identity, ...one.identity }, f.hooks);
  await wait(() => replaced === 1, "old gateway receives replacement");
  await assert.rejects(one.update({ sequence: 2, threadIds: [] }));
  allowed = false;
  await assert.rejects(p.attach(f.identity, hooks));
  assert.equal(f.consumers.size, 1);
  two.disconnect();
});
test("private control rejects foreign service/process/token and unregistered profiles before consumer mutation", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { generation: randomUUID() },
    { token: "0".repeat(64) },
    { pid: process.pid + 10000000 },
    { nativeScope: { ...f.manager.serviceScope, generation: randomUUID() } },
  ])
    await assert.rejects(f.connect({ ...f.server.record, ...patch }));
  const c = await f.connect();
  assert.throws(() => c.visibility(randomUUID()), /profile/);
  assert.equal(f.consumers.size, 0);
  assert.equal((await lstat(join(f.root, "control.sock"))).mode & 0o777, 0o600);
  assert.equal(
    JSON.stringify(f.server.snapshot()).includes(f.server.record.token),
    false,
  );
});
test("authorization revocation invalidates control clients without stopping native or claiming unavailable protection", async (t) => {
  const f = await fixture(t),
    c = await f.connect(),
    p = c.visibility(f.profileId);
  let replaced = 0;
  await p.attach(f.identity, { ...f.hooks, onReplaced: () => replaced++ });
  f.invalidate();
  await wait(() => !p.snapshot().available, "control availability revoked");
  await wait(() => replaced === 1, "only own protection closed");
  await assert.rejects(p.attach(f.identity, f.hooks));
  await assert.rejects(f.connect());
  assert.equal(f.manager.snapshot().ready, false);
});
test("a disconnected gateway cannot finish a delayed visible update into its replacement", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    p = a.visibility(f.profileId),
    one = await p.attach(f.identity, f.hooks);
  let release, entered;
  const held = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r));
  f.setOpenHook(async () => {
    entered();
    await held;
  });
  const pending = assert.rejects(
    one.update({ sequence: 1, threadIds: [randomUUID()] }),
  );
  await started;
  await a.close();
  const b = await f.connect(),
    two = await b
      .visibility(f.profileId)
      .attach({ ...f.identity, ...one.identity }, f.hooks);
  f.setOpenHook(async () => {});
  release();
  await pending;
  const id = randomUUID();
  await two.update({ sequence: 1, threadIds: [id] });
  assert.deepEqual(
    [...f.consumers.values()].map((x) => [...x]),
    [[id]],
  );
});
test("private control bounds unauthenticated UTF-8 frames and never unlinks an existing or replaced endpoint", async (t) => {
  const f = await fixture(t),
    socketPath = join(f.root, "control.sock");
  for (const payload of [
    Buffer.from([0xff, 10]),
    Buffer.from("x".repeat(8193)),
    Buffer.from(
      JSON.stringify({
        type: "call",
        id: randomUUID(),
        method: "turn/start",
        args: { input: "forbidden" },
      }) + "\n",
    ),
  ]) {
    const socket = createConnection(socketPath);
    f.sockets.push(socket);
    socket.on("error", () => {});
    await once(socket, "connect");
    const closed = once(socket, "close");
    socket.write(payload);
    await closed;
  }
  const { listenRefreshControl } =
    await import("../refresh-prototype/control-channel.mjs");
  await assert.rejects(
    listenRefreshControl({
      manager: f.manager,
      runtimeRoot: f.root,
      profiles: [f.profileId],
    }),
    /existing/,
  );
  const c = await f.connect();
  assert.equal(c.visibility(f.profileId).snapshot().available, true);
  assert.equal(f.consumers.size, 0);
  await rm(socketPath);
  await writeFile(socketPath, "REPLACED_ENDPOINT", { mode: 0o600 });
  await f.server.close();
  assert.equal(await readFile(socketPath, "utf8"), "REPLACED_ENDPOINT");
});
test(
  "control verification timeout closes its own connection without retry or later consumer registration",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t),
      c = await f.connect(f.server.record, { timeoutMs: 1000 }),
      p = c.visibility(f.profileId);
    let release,
      entered,
      checks = 0;
    const held = new Promise((r) => (release = r)),
      started = new Promise((r) => (entered = r));
    const pending = assert.rejects(
      p.attach(f.identity, {
        assertCurrent: async () => {
          checks++;
          entered();
          await held;
        },
        onReplaced: () => {},
      }),
    );
    await started;
    await pending;
    assert.equal(p.snapshot().available, false);
    release();
    await wait(
      () => f.server.snapshot().pending === 0,
      "timed out control operation drained",
    );
    assert.equal(checks, 1);
    assert.equal(f.consumers.size, 0);
    assert.equal(f.server.snapshot().handles, 0);
  },
);
test("partial profile setup releases observers if the manager observer budget rejects later profiles", async (t) => {
  const { listenRefreshControl } =
    await import("../refresh-prototype/control-channel.mjs");
  const root = await mkdtemp(join(tmpdir(), "ck-control-observers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const observers = new Set(),
    manager = {
      serviceScope: {
        domain: randomUUID(),
        generation: randomUUID(),
        ...(await captureProcessIdentity(process.pid)),
      },
      snapshot: () => ({ ready: true, authorizationBound: true }),
      scopeForThread: async () => {},
      open: async () => {},
      disconnect: async () => {},
      onInvalidated(fn) {
        if (observers.size >= 2) throw Error("observer budget");
        observers.add(fn);
        return () => observers.delete(fn);
      },
    };
  await assert.rejects(
    listenRefreshControl({
      manager,
      runtimeRoot: root,
      profiles: [randomUUID(), randomUUID(), randomUUID()],
    }),
    /observer budget/,
  );
  assert.equal(observers.size, 0);
});
test("a replaced page's throwing callback cannot close unrelated pages on the same gateway control connection", async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    p = a.visibility(f.profileId);
  let replaced = 0;
  const first = await p.attach(f.identity, {
    assertCurrent: async () => {},
    onReplaced() {
      replaced++;
      throw Error("page callback failure");
    },
  });
  await first.update({ sequence: 1, threadIds: [randomUUID()] });
  const other = await p.attach(f.identity, f.hooks);
  await other.update({ sequence: 1, threadIds: [randomUUID()] });
  const b = await f.connect();
  await b
    .visibility(f.profileId)
    .attach({ ...f.identity, ...first.identity }, f.hooks);
  await wait(() => replaced === 1, "own replaced callback observed");
  assert.equal(p.snapshot().available, true);
  await other.update({ sequence: 2, threadIds: [] });
  assert.equal(f.consumers.size, 1);
});
