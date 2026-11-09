import test from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
const require = createRequire(import.meta.url);
const {
  createSharedThreadAuthorityServer,
  createSharedThreadAuthorityClient,
} = require("../src/shared-thread-authority-channel.cjs");

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "shared-thread-ipc-"));
  await chmod(dir, 0o700);
  const socketPath = join(dir, "authority.sock"),
    profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID();
  const daemonGeneration = randomUUID(),
    clientId = randomUUID(),
    writes = [];
  let live = true,
    connected,
    observeCancel;
  const connection = new Promise((resolve) => (connected = resolve)),
    cancelled = new Promise((resolve) => (observeCancel = resolve));
  const server = createServer((socket) => {
    const verifyBindingSync = (binding) =>
      live &&
      binding.runtimeGeneration === generation &&
      binding.daemonGeneration === daemonGeneration &&
      binding.accountRevision === 1 &&
      binding.viewId === viewId &&
      binding.clientId === clientId &&
      binding.threadId === threadId;
    const gate = createSharedDaemonRpcGate({
      verifyBindingSync,
      verifyHistorySync: () => live,
      verifyReadSync: () => live,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    });
    const authority = createSharedThreadAuthorityServer({
      socket,
      profileId,
      generation,
      resolveBinding: async (request) => ({
        hostId: request.hostId,
        runtimeGeneration: generation,
        daemonGeneration,
        accountRevision: 1,
        projectId: "fixture-project",
        threadId: request.threadId,
        viewId: request.viewId,
        clientId,
      }),
      verifyViewSync: (request) =>
        request.viewId === viewId &&
        request.hostId === "local" &&
        request.threadId === threadId,
      verifyBindingSync,
      gate,
      onCancel: observeCancel,
    });
    connected(authority);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  const child = fork(
    join(import.meta.dirname, "fixtures", "shared-thread-authority-worker.cjs"),
    [],
    {
      env: {
        PATH: process.env.PATH,
        SOCKET: socketPath,
        PROFILE: profileId,
        GENERATION: generation,
        VIEW: viewId,
        THREAD: threadId,
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  const messages = [],
    waiters = [];
  child.on("message", (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  const next = () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolve) => waiters.push(resolve));
  const authority = await connection;
  assert.deepEqual(await next(), { type: "ready" });
  t.after(async () => {
    child.send({ type: "close" });
    await new Promise((resolve) => child.once("exit", resolve));
    authority.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return {
    child,
    next,
    writes,
    cancelled,
    revoke() {
      live = false;
    },
  };
}

test(
  "real private Unix stream binds view, generations, account and actual RPC id before synchronous dispatch",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    f.child.send({ type: "authorize" });
    assert.deepEqual(await f.next(), { type: "authorized", accepted: true });
    f.child.send({ type: "dispatch" });
    assert.deepEqual(await f.next(), { type: "dispatched", accepted: true });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].method, "thread/resume");
    assert.equal(f.writes[0].params.excludeTurns, true);
    f.child.send({ type: "dispatch" });
    assert.deepEqual(await f.next(), { type: "dispatched", accepted: false });
    assert.equal(f.writes.length, 1);
  },
);
test(
  "cancel processed on the same stream prevents a late queued write",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    f.child.send({ type: "authorize" });
    assert.deepEqual(await f.next(), { type: "authorized", accepted: true });
    f.child.send({ type: "cancel" });
    assert.deepEqual(await f.next(), { type: "cancelled" });
    await f.cancelled;
    f.child.send({ type: "dispatch" });
    assert.deepEqual(await f.next(), { type: "dispatched", accepted: false });
    assert.equal(f.writes.length, 0);
  },
);
test(
  "account or native generation invalidation is checked at the final writer",
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    f.child.send({ type: "authorize" });
    assert.deepEqual(await f.next(), { type: "authorized", accepted: true });
    f.revoke();
    f.child.send({ type: "dispatch" });
    assert.deepEqual(await f.next(), { type: "dispatched", accepted: false });
    assert.equal(f.writes.length, 0);
  },
);

test(
  "expired bindings release their bounded slots without depending on a future authorization",
  { timeout: 10000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "shared-thread-expire-")),
      socketPath = join(dir, "authority.sock");
    await chmod(dir, 0o700);
    const profileId = randomUUID(),
      generation = randomUUID(),
      viewId = randomUUID(),
      daemonGeneration = randomUUID(),
      clientId = randomUUID();
    let now = 0,
      authority;
    const server = createServer((socket) => {
      authority = createSharedThreadAuthorityServer(
        {
          socket,
          profileId,
          generation,
          resolveBinding: async (request) => ({
            hostId: request.hostId,
            runtimeGeneration: generation,
            daemonGeneration,
            accountRevision: 1,
            projectId: "fixture-project",
            threadId: request.threadId,
            viewId: request.viewId,
            clientId,
          }),
          verifyViewSync: () => true,
          verifyBindingSync: () => true,
          gate: {
            registerConnect: () => true,
            write: () => {},
            close: () => {},
          },
        },
        { bindingNow: () => now },
      );
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const socket = createConnection(socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));
    const client = createSharedThreadAuthorityClient({
      socket,
      profileId,
      generation,
    });
    t.after(async () => {
      client.close();
      authority.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    });
    for (let i = 0; i < 16; i++)
      await client.resolveBinding({
        viewId,
        hostId: "local",
        threadId: randomUUID(),
      });
    await assert.rejects(
      client.resolveBinding({
        viewId,
        hostId: "local",
        threadId: randomUUID(),
      }),
    );
    now = 30001;
    const fresh = await client.resolveBinding({
      viewId,
      hostId: "local",
      threadId: randomUUID(),
    });
    assert.equal(fresh.viewId, viewId);
  },
);

test(
  "unresolved binding callbacks time out and release their bounded slots",
  { timeout: 10000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "shared-thread-hang-")),
      socketPath = join(dir, "authority.sock");
    await chmod(dir, 0o700);
    const profileId = randomUUID(),
      generation = randomUUID(),
      viewId = randomUUID();
    let authority,
      calls = 0;
    const server = createServer((socket) => {
      authority = createSharedThreadAuthorityServer(
        {
          socket,
          profileId,
          generation,
          resolveBinding: () => {
            calls++;
            return new Promise(() => {});
          },
          verifyViewSync: () => true,
          verifyBindingSync: () => true,
          gate: {
            registerConnect: () => true,
            write: () => {},
            close: () => {},
          },
        },
        { bindTimeoutMs: 20 },
      );
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const socket = createConnection(socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));
    const client = createSharedThreadAuthorityClient({
      socket,
      profileId,
      generation,
    });
    t.after(async () => {
      client.close();
      authority.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    });
    const unresolved = Array.from({ length: 16 }, () =>
      client
        .resolveBinding({ viewId, hostId: "local", threadId: randomUUID() })
        .then(
          () => false,
          () => true,
        ),
    );
    const timely = await Promise.race([
      Promise.all(unresolved),
      new Promise((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    assert.ok(timely && timely.every(Boolean));
    assert.equal(calls, 16);
    const next = client
      .resolveBinding({ viewId, hostId: "local", threadId: randomUUID() })
      .then(
        () => false,
        () => true,
      );
    assert.equal(
      await Promise.race([
        next,
        new Promise((resolve) => setTimeout(() => resolve(false), 100)),
      ]),
      true,
    );
    assert.equal(calls, 17);
  },
);
