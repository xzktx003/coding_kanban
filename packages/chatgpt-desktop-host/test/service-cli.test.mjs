import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readDesktopServiceConfig,
  runDesktopService,
  readDesktopServiceStatus,
  parseDesktopServiceArguments,
} from "../src/service-cli.mjs";
import { decodeWireValue, encodeWireValue } from "../src/wire-value.mjs";
import { createDesktopControlService } from "../src/control-service.mjs";
import { startContainerDesktopService } from "../src/container-host-service.mjs";
import { seedDesktopAccountSnapshot } from "../src/account-snapshot.mjs";

const defer = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-cli-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = join(dir, "state");
  await mkdir(state, { mode: 0o700 });
  const options = {
    imageDigest: "sha256:" + "a".repeat(64),
    sourceRoot: join(dir, "source"),
    runtimeRoot: join(dir, "runtime"),
    bridgeRoot: join(dir, "bridge"),
    cpuId: 1,
    macAsarPath: join(dir, "mac.asar"),
    macAsarSha256: "b".repeat(64),
    profileFile: join(state, "profile.json"),
    controlSocketPath: join(state, "control.sock"),
    dockerPath: "/usr/bin/docker",
    dockerSha256: "c".repeat(64),
    pythonPath: "/usr/bin/python3",
    pythonSha256: "d".repeat(64),
    nodePath: process.execPath,
    nodeSha256: "e".repeat(64),
  };
  const configFile = join(dir, "service.json");
  const save = async (value = { version: 1, options }) =>
    writeFile(configFile, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
  await save();
  return {
    dir,
    state,
    options,
    configFile,
    save,
    read: () => readDesktopServiceConfig(configFile),
  };
}
function service() {
  return {
    profileId: randomUUID(),
    generation: randomUUID(),
    nativeExited: new Promise(() => {}),
    closeCalls: 0,
    async close() {
      this.closeCalls++;
    },
  };
}

test("server SSH is an explicit boolean CLI option passed unchanged to the new host", async (t) => {
  const f = await fixture(t), defaults = await f.read();
  assert.equal(defaults.options.serverSsh, undefined);
  for (const enabled of [false, true]) {
    await f.save({ version: 1, options: { ...f.options, serverSsh: enabled } });
    const config = await f.read();
    assert.equal(config.options.serverSsh, enabled);
    assert.notEqual(config.fingerprint, defaults.fingerprint);
  }
  const owned = service(), abort = new AbortController();
  let starts = 0;
  const result = await runDesktopService(await f.read(), {
    signal: abort.signal,
    startService: async options => { starts++; assert.equal(options.serverSsh, true); return owned; },
    onEvent: event => { if (event.state === "published") abort.abort(); },
  });
  assert.equal(result.state, "retired");
  assert.equal(starts, 1);
  assert.equal(owned.closeCalls, 1);
});

test("server SSH rejects non-booleans, accessors and caller-selected socket settings before startup", async (t) => {
  const f = await fixture(t);
  for (const serverSsh of [null, 0, 1, "true", {}, [], { socketPath: "/tmp/server-ssh.sock" }]) {
    await f.save({ version: 1, options: { ...f.options, serverSsh } });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
  for (const extra of [{ serverSshSocketPath: "/tmp/server-ssh.sock" }, { sshBinary: "/usr/bin/ssh" }, { serverSshOptions: {} }]) {
    await f.save({ version: 1, options: { ...f.options, serverSsh: true, ...extra } });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
  const options = { ...f.options };
  let accessed = false, started = false;
  Object.defineProperty(options, "serverSsh", { enumerable: true, get() { accessed = true; return true; } });
  await assert.rejects(runDesktopService({ options, fingerprint: "a".repeat(64) }, {
    signal: new AbortController().signal,
    startService: async () => { started = true; return service(); },
  }), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  assert.equal(accessed, false);
  assert.equal(started, false);
});

test("CLI recovery invokes only the exact retained native service, never a new start", async (t) => {
  const f = await fixture(t), owned = service(), abort = new AbortController(), ready = defer();
  const containerId = "a".repeat(64), identity = (pid, ppid, ns) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 2), nspids: [pid, ns], cpus: "1",
    noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]",
  });
  const anchor = {
    version: 1, containerId, profileId: owned.profileId, generation: owned.generation,
    bootId: randomUUID(), configSha256: "a".repeat(64), filesSha256: "b".repeat(64),
    account: { kind: "anonymous", binding: null }, projects: [],
    processes: { init: identity(101, 1, 1), bridge: identity(102, 101, 2), node: identity(103, 102, 3), native: identity(104, 103, 4) },
  };
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    recovery: { identity: anchor, configSha256: anchor.configSha256 },
    startService: async () => assert.fail("recovery must not start a new native"),
    reattachService: async (_options, context) => {
      assert.deepEqual(context.identity, anchor); ready.resolve(); return owned;
    },
  });
  const outcome = await Promise.race([ready.promise.then(() => "ready"), run.then(() => "ended")]);
  assert.equal(outcome, "ready"); abort.abort();
  const result = await run;
  assert.equal(result.state, "retired");
  assert.equal(owned.closeCalls, 1);
});

test("account-sync recovery reopens the same upstream and restores its sync guard before readiness", async (t) => {
  const f = await fixture(t), owned = service(), abort = new AbortController(), ready = defer();
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  const containerId = "a".repeat(64), identity = (pid, ppid, ns) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 2), nspids: [pid, ns], cpus: "1",
    noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]",
  });
  const anchor = {
    version: 1, containerId, profileId: owned.profileId, generation: owned.generation,
    bootId: randomUUID(), configSha256: "a".repeat(64), filesSha256: "b".repeat(64),
    account: { kind: "chatgpt", binding: "c".repeat(64) }, projects: [],
    processes: { init: identity(101, 1, 1), bridge: identity(102, 101, 2), node: identity(103, 102, 3), native: identity(104, 103, 4) },
  };
  let synced = false, loopClosed = false, calls = 0;
  const run = runDesktopService(await f.read(), {
    signal: abort.signal, recovery: { identity: anchor, configSha256: anchor.configSha256 },
    startService: async () => assert.fail("must not start a native"),
    startUpstream: async () => assert.fail("must not start a new upstream"),
    reattachUpstream: async (_options, context) => {
      calls++; assert.deepEqual(context.identity, anchor);
      return { verifyIdentity: async () => true, upstream: {}, disconnectTransport: async () => {}, containerId, nativeExited: new Promise(() => {}) };
    },
    createAccountSynchronizer: async () => ({ async syncNow() { synced = true; return { state: "unchanged" }; }, async close() {} }),
    startAccountSyncLoop: () => ({ status: () => ({ state: "running" }), async close() { loopClosed = true; } }),
    reattachService: async (options, context, deps) => {
      assert.equal(options.accountSync, undefined); assert.deepEqual(context.identity, anchor);
      const upstream = await deps.startUpstream({ profileId: owned.profileId, generation: owned.generation });
      assert.equal(synced, true); assert.equal(await upstream.verifyIdentity(), true); ready.resolve(); return owned;
    },
  });
  const outcome = await Promise.race([ready.promise.then(() => "ready"), run.then(() => "ended")]);
  assert.equal(outcome, "ready"); abort.abort();
  assert.equal((await run).state, "retired");
  assert.equal(calls, 1); assert.equal(loopClosed, true);
});

test("CLI arguments select one explicit command and owned config only", () => {
  assert.deepEqual(
    parseDesktopServiceArguments(["start", "--config", "/private/config.json"]),
    { command: "start", configFile: "/private/config.json" },
  );
  assert.deepEqual(
    parseDesktopServiceArguments([
      "status",
      "--config",
      "/private/config.json",
    ]),
    { command: "status", configFile: "/private/config.json" },
  );
  for (const command of ["supervisor-init", "supervisor-status", "supervise"]) {
    assert.deepEqual(parseDesktopServiceArguments([command, "--config", "/private/template.json"]), {
      command, configFile: "/private/template.json",
    });
  }
  for (const args of [
    [],
    ["restart", "--config", "/a"],
    ["start", "--config", "a"],
    ["start", "--config", "/a", "--force"],
    ["start", "--config", "/a", "status"],
  ])
    assert.throws(() => parseDesktopServiceArguments(args), {
      code: "DESKTOP_CLI_USAGE",
    });
});

test("reads bounded owned configuration, preserving the API default and explicit Codex preference", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.configFile);
  const config = await f.read();
  assert.deepEqual(config.options, f.options);
  assert.ok(Object.isFrozen(config.options));
  assert.equal(config.options.networkMode, undefined);
  assert.equal(config.options.initialMode, undefined);
  f.options.initialMode = "codex";
  f.options.networkMode = "bridge";
  f.options.projectRoots = [join(f.dir, "scratch-project")];
  f.options.connection = {
    httpsProxy: "http://proxy.test:8123",
    noProxy: "localhost,127.0.0.1",
  };
  f.options.accountSnapshot = {
    sourceFile: join(f.dir, "authorized-auth.json"),
    homeRoot: join(f.dir, "credential-home"),
  };
  await f.save();
  const explicit = await f.read();
  assert.deepEqual(explicit.options.projectRoots, f.options.projectRoots);
  assert.ok(Object.isFrozen(explicit.options.projectRoots));
  assert.deepEqual(explicit.options.connection, f.options.connection);
  assert.ok(Object.isFrozen(explicit.options.connection));
  assert.equal(explicit.options.initialMode, "codex");
  assert.ok(Object.isFrozen(explicit.options.accountSnapshot));
  assert.notEqual(explicit.fingerprint, config.fingerprint);
  assert.equal(before.equals(await readFile(f.configFile)), false);
});

test("rejects unsafe, malformed, ambiguous or over-budget config without starting anything", async (t) => {
  const f = await fixture(t);
  for (const value of [
    { version: 2, options: f.options },
    { version: 1, options: { ...f.options, command: "sh" } },
    { version: 1, options: { ...f.options, initialMode: "work" } },
    { version: 1, options: { ...f.options, projectRoots: ["relative"] } },
    {
      version: 1,
      options: {
        ...f.options,
        projectRoots: ["/tmp/project", "/tmp/project/nested"],
      },
    },
    {
      version: 1,
      options: {
        ...f.options,
        accountSnapshot: { sourceFile: "/auth", homeRoot: "/tmp/home" },
      },
    },
    { version: 1, options: { ...f.options, networkMode: "host" } },
    { version: 1, options: { ...f.options, cpuId: -1 } },
    { version: 1, options: { ...f.options, runtimeRoot: "relative" } },
  ]) {
    await f.save(value);
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
  await writeFile(f.configFile, '{"version":1,"version":1,"options":{}}');
  await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  await writeFile(f.configFile, '{"version":1,"\\u0076ersion":1,"options":{}}');
  await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  await writeFile(f.configFile, Buffer.from([0x7b, 0xff, 0x7d]));
  await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  await writeFile(f.configFile, " ".repeat(16 * 1024 + 1));
  await assert.rejects(f.read(), { code: "DESKTOP_CLI_CONFIG_UNAVAILABLE" });
  await f.save();
  await chmod(f.configFile, 0o644);
  await assert.rejects(f.read(), { code: "DESKTOP_CLI_CONFIG_UNAVAILABLE" });
  await chmod(f.configFile, 0o600);
  const alias = join(f.dir, "alias.json");
  await symlink(f.configFile, alias);
  await assert.rejects(readDesktopServiceConfig(alias), {
    code: "DESKTOP_CLI_CONFIG_UNAVAILABLE",
  });
});

test("CLI passes only a canonical explicit history root to the fixed service", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read()).options.historyRoot, undefined);
  const historyRoot = join(f.dir, "private-history");
  await f.save({ version: 1, options: { ...f.options, historyRoot } });
  assert.equal((await f.read()).options.historyRoot, historyRoot);

  const abort = new AbortController(), ready = defer(), owned = service();
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startService: async (options) => {
      assert.equal(options.historyRoot, historyRoot);
      ready.resolve();
      return owned;
    },
  });
  await ready.promise;
  abort.abort();
  await run;
  for (const value of [null, "", "/", "relative", "/tmp/../private", "/tmp/private,other", "/tmp/private\nnext", 1, {}, []]) {
    await f.save({ version: 1, options: { ...f.options, historyRoot: value } });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
});

test("account synchronization is explicit, private, and requires account-bound history", async (t) => {
  const f = await fixture(t), grantFile = join(f.dir, "grant", "sync"), historyRoot = join(f.dir, "history");
  assert.equal((await f.read()).options.accountSync, undefined);
  const options = { ...f.options, networkMode: "bridge", historyRoot, accountSnapshot: { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") }, accountSync: { grantFile } };
  await f.save({ version: 1, options });
  assert.deepEqual((await f.read()).options.accountSync, { grantFile });
  for (const value of [
    { ...options, historyRoot: undefined },
    { ...options, accountSnapshot: undefined },
    { ...options, networkMode: "none" },
    { ...options, accountSync: { grantFile: "relative" } },
    { ...options, accountSync: { grantFile: join(historyRoot, "sync") } },
    { ...options, accountSync: { grantFile, extra: true } },
  ]) {
    await f.save({ version: 1, options: value });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
});

test("sync enrollment and initial verification finish before the host can publish; close fences in-flight sync", async (t) => {
  const f = await fixture(t), grantFile = join(f.dir, "grant", "sync");
  f.options.networkMode = "bridge";
  f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile };
  await f.save();
  const abort = new AbortController(), verified = defer(), ready = defer(), closing = defer(), release = defer(), owned = service();
  let closed = 0, loopClosed = 0, given, published = false;
  const syncer = { async syncNow() { await verified.promise; return { state: "unchanged" }; }, async close() {} };
  const loop = { status: () => ({ state: "running", lastCheck: "unchanged" }), async close() { loopClosed++; closing.resolve(); await release.promise; } };
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: {}, disconnectTransport: async () => {}, containerId: "a".repeat(64), nativeExited: new Promise(() => {}) }),
    createAccountSynchronizer: async (value) => { given = value; return syncer; },
    startAccountSyncLoop: () => loop,
    startService: async (options, dependencies) => {
      assert.equal(options.accountSync, undefined);
      const upstream = await dependencies.startUpstream({ profileId: owned.profileId, generation: owned.generation });
      assert.equal(await upstream.verifyIdentity(), true);
      published = true; ready.resolve();
      return { ...owned, async close() { closed++; } };
    },
  });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(published, false);
  verified.resolve(); await ready.promise;
  assert.deepEqual(given, { ...f.options.accountSnapshot, grantFile });
  abort.abort(); await closing.promise;
  let settled = false; void run.then(() => { settled = true; });
  await new Promise((done) => setImmediate(done)); assert.equal(settled, false);
  release.resolve(); const result = await run;
  assert.equal(result.state, "retired"); assert.equal(loopClosed, 1); assert.equal(closed, 1);
});

test("sync initialization failure retains the new container without publishing or stopping it", async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  const abort = new AbortController(), events = [], profileId = randomUUID(), generation = randomUUID();
  let disconnected = 0, published = false;
  const run = await runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: {}, disconnectTransport: async () => { disconnected++; }, containerId: "a".repeat(64), nativeExited: new Promise(() => {}) }),
    createAccountSynchronizer: async () => { throw Object.assign(Error("private"), { code: "ACCOUNT_SYNC_IDENTITY_CHANGED" }); },
    startService: async (_options, dependencies) => {
      await dependencies.startUpstream({ profileId, generation });
      published = true; throw Error("must not reach");
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(published, false); assert.equal(disconnected, 1);
  assert.equal(run.state, "retained_unknown"); assert.equal(run.reasonCode, "ACCOUNT_SYNC_IDENTITY_CHANGED");
  assert.equal(events.some((e) => e.state === "published"), false);
});

test("a host that omits the sync hook cannot be announced ready", async (t) => {
  const f = await fixture(t), owned = service(), events = [];
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 200);
  const result = await runDesktopService(await f.read(), { signal: abort.signal, startService: async () => owned, onEvent: (e) => events.push(e) }); clearTimeout(timeout);
  assert.equal(result.state, "retained_unknown"); assert.equal(result.reasonCode, "ACCOUNT_SYNC_UNAVAILABLE");
  assert.equal(owned.closeCalls, 1); assert.equal(events.some((e) => e.state === "published"), false);
});

test("detected account identity change blocks upstream and retires only the service", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  const abort = new AbortController(), ready = defer(), owned = service();
  let state = { state: "running", lastCheck: "unchanged" }, wrapped, sent = 0, closeCalls = 0;
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: { async send() { sent++; }, subscribe() { return () => {}; } }, disconnectTransport: async () => {}, containerId: "a".repeat(64), nativeExited: new Promise(() => {}) }),
    createAccountSynchronizer: async () => ({ async syncNow() { return { state: "unchanged" }; }, async close() {} }),
    startAccountSyncLoop: () => ({ status: () => state, async close() {} }),
    startService: async (_options, dependencies) => {
      wrapped = await dependencies.startUpstream({ profileId: owned.profileId, generation: owned.generation });
      return { ...owned, async close() { closeCalls++; } };
    },
    onEvent: (event) => { if (event.state === "published") ready.resolve(); },
  });
  await ready.promise;
  state = { state: "stopped", code: "ACCOUNT_SYNC_IDENTITY_CHANGED" };
  assert.equal(await wrapped.verifyIdentity(), false);
  await assert.rejects(wrapped.upstream.send("fixture"), { code: "ACCOUNT_SYNC_IDENTITY_CHANGED" });
  assert.equal(sent, 0);
  const result = await run;
  assert.equal(result.state, "retained_unknown"); assert.equal(result.reasonCode, "ACCOUNT_SYNC_IDENTITY_CHANGED"); assert.equal(closeCalls, 1);
});

test("retirement after sync closes still permits the owned view teardown", async (t) => {
  const f = await fixture(t), owned = service(), ready = defer(), abort = new AbortController();
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  let state = { state: "running", lastCheck: "unchanged" }, wrapped, destroyed = 0;
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: { async send(encoded) { if (decodeWireValue(encoded)?.type === "destroyView") destroyed++; }, subscribe() { return () => {}; } }, disconnectTransport: async () => {}, containerId: "a".repeat(64), nativeExited: new Promise(() => {}) }),
    createAccountSynchronizer: async () => ({ async syncNow() { return { state: "unchanged" }; }, async close() {} }),
    startAccountSyncLoop: () => ({ status: () => state, async close() { state = { state: "closed" }; } }),
    startService: async (_options, dependencies) => {
      wrapped = await dependencies.startUpstream({ profileId: owned.profileId, generation: owned.generation });
      ready.resolve(); return { ...owned, async close() {
        assert.equal(await wrapped.verifyIdentity(), true);
        await assert.rejects(wrapped.upstream.send(encodeWireValue({ type: "createView" })), { code: "ACCOUNT_SYNC_REVOKED" });
        await wrapped.upstream.send(encodeWireValue({ type: "destroyView" }));
      } };
    },
  });
  await ready.promise; abort.abort();
  assert.equal((await run).state, "retired"); assert.equal(destroyed, 1);
});

test("sync failure while recording the owned identity cannot announce readiness", { timeout: 5000 }, async (t) => {
  const f = await fixture(t), owned = service(), events = [];
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") }; await f.save();
  owned.containerId = "a".repeat(64);
  let state = { state: "running", lastCheck: "unchanged" };
  const result = await runDesktopService(await f.read(), {
    signal: new AbortController().signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: { async send() {}, subscribe() { return () => {}; } }, disconnectTransport: async () => {}, containerId: owned.containerId, nativeExited: owned.nativeExited }),
    createAccountSynchronizer: async () => ({ async syncNow() { return { state: "unchanged" }; }, async close() {} }),
    startAccountSyncLoop: () => ({ status: () => state, async close() {} }),
    startService: async (_options, dependencies) => { await dependencies.startUpstream({ profileId: owned.profileId, generation: owned.generation }); return owned; },
    onOwner: async () => { state = { state: "stopped", code: "ACCOUNT_SYNC_IDENTITY_CHANGED" }; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.state, "retained_unknown");
  assert.equal(result.reasonCode, "ACCOUNT_SYNC_IDENTITY_CHANGED");
  assert.equal(events.some((event) => event.state === "published"), false);
});

test("service enrollment copies a rotated synthetic account into its private tmpfs before readiness", { timeout: 5000 }, async (t) => {
  const f = await fixture(t), owned = service(), abort = new AbortController(), ready = defer();
  const source = join(f.dir, "source-auth"), grant = join(f.dir, "grant"), home = await mkdtemp("/dev/shm/desktop-service-sync-");
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(source, { mode: 0o700 }); await mkdir(grant, { mode: 0o700 });
  const sourceFile = join(source, "auth.json"), grantFile = join(grant, "sync");
  const jwt = (value) => ["eyJhbGciOiJub25lIn0", Buffer.from(JSON.stringify(value)).toString("base64url"), "c2ln"].join(".");
  const auth = (iat) => {
    const claims = { iss: "https://issuer.fixture", sub: "fixture-user", iat, exp: iat + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } };
    return { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: jwt({ ...claims, jti: `id-${iat}` }), access_token: jwt({ ...claims, jti: `access-${iat}` }), account_id: "fixture-account", refresh_token: "FAKE_REFRESH_ONLY_IN_SOURCE" } };
  };
  await writeFile(sourceFile, JSON.stringify(auth(100)), { mode: 0o600 });
  await writeFile(join(source, "auth.lock"), "", { mode: 0o600 });
  await writeFile(grantFile, "chatgpt-desktop-account-sync-v1\n", { mode: 0o600 });
  await seedDesktopAccountSnapshot({ sourceFile, homeRoot: home });
  const next = auth(200); await writeFile(sourceFile, JSON.stringify(next));
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile, homeRoot: home }; f.options.accountSync = { grantFile }; await f.save();
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => ({ verifyIdentity: async () => true, upstream: { async send() {}, subscribe() { return () => {}; } }, disconnectTransport: async () => {}, containerId: "a".repeat(64), nativeExited: owned.nativeExited }),
    startService: async (_options, dependencies) => { await dependencies.startUpstream({ profileId: owned.profileId, generation: owned.generation }); return owned; },
    onEvent: (event) => { if (event.state === "published") ready.resolve(); },
  });
  await ready.promise;
  const snapshot = JSON.parse(await readFile(join(home, ".codex", "auth.json"), "utf8"));
  assert.equal(snapshot.tokens.access_token, next.tokens.access_token);
  assert.equal(snapshot.tokens.refresh_token, "");
  abort.abort();
  assert.equal((await run).state, "retired");
});

test("real host composition cannot publish before the injected sync authorization passes", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") };
  await writeFile(f.options.macAsarPath, "fake archive", { mode: 0o600 }); await f.save();
  const abort = new AbortController(), gate = defer(), ready = defer();
  let published = false, revoked = false, detached = 0;
  const container = { upstream: { async send() {}, subscribe() { return () => {}; } }, verifyIdentity: async () => true, disconnectTransport: async () => { detached++; }, nativeExited: new Promise(() => {}), onUnavailable: () => () => {} };
  Object.defineProperty(container, "containerId", { value: "a".repeat(64) });
  const run = runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => container,
    createAccountSynchronizer: async () => ({ async syncNow() { await gate.promise; return { state: "unchanged" }; }, async close() {} }),
    startAccountSyncLoop: () => ({ status: () => ({ state: "running", lastCheck: "unchanged" }), async close() {} }),
    startService: (options, dependencies) => startContainerDesktopService(options, {
      ...dependencies,
      openArchive: async () => ({ close: async () => {} }),
      createBroker: async () => ({ close: async () => {} }),
      makePublisher: (_profile, checks) => ({ get published() { return published; }, async publish() { assert.equal(await checks.beforeLink(), true); published = true; }, async verify() { return published; }, async revoke() { revoked = true; published = false; } }),
    }),
    onEvent: (event) => { if (event.state === "published") ready.resolve(); },
  });
  await new Promise((done) => setTimeout(done, 20)); assert.equal(published, false);
  gate.resolve(); await ready.promise; assert.equal(published, true);
  abort.abort(); const result = await run;
  assert.equal(result.state, "retired"); assert.equal(revoked, true); assert.equal(detached, 1);
});

test("real host reports a failed sync enrollment without publishing or stopping its native container", async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge"; f.options.historyRoot = join(f.dir, "history");
  f.options.accountSnapshot = { sourceFile: join(f.dir, "source-auth", "auth.json"), homeRoot: join(f.dir, "credential-home") };
  f.options.accountSync = { grantFile: join(f.dir, "grant", "sync") };
  await writeFile(f.options.macAsarPath, "fake archive", { mode: 0o600 }); await f.save();
  const abort = new AbortController(); let published = false, detached = 0;
  const container = { upstream: { async send() {}, subscribe() { return () => {}; } }, verifyIdentity: async () => true, disconnectTransport: async () => { detached++; }, nativeExited: new Promise(() => {}), onUnavailable: () => () => {} };
  Object.defineProperty(container, "containerId", { value: "a".repeat(64) });
  const result = await runDesktopService(await f.read(), {
    signal: abort.signal,
    startUpstream: async () => container,
    createAccountSynchronizer: async () => { throw Object.assign(Error("private"), { code: "ACCOUNT_SYNC_IDENTITY_CHANGED" }); },
    startService: (options, dependencies) => startContainerDesktopService(options, {
      ...dependencies,
      openArchive: async () => ({ close: async () => {} }),
      createBroker: async () => ({ close: async () => {} }),
      makePublisher: () => ({ async publish() { published = true; }, async verify() { return published; }, async revoke() {} }),
    }),
  });
  assert.equal(result.state, "retained_unknown"); assert.equal(result.reasonCode, "ACCOUNT_SYNC_IDENTITY_CHANGED");
  assert.equal(published, false); assert.equal(detached, 1);
});

test("supervisor CLI initializes and reads only its private deployment record", async (t) => {
  const f = await fixture(t), deploymentRoot = join(f.dir, "deploy"), historyRoot = join(f.dir, "history"), account = join(f.dir, "account");
  for (const path of [deploymentRoot, historyRoot, account]) await mkdir(path, { mode: 0o700 });
  const accountSourceFile = join(account, "auth.json"), templateFile = join(f.dir, "supervisor-template.json");
  await writeFile(accountSourceFile, "private fixture\n", { mode: 0o600 });
  const { runtimeRoot, bridgeRoot, profileFile, controlSocketPath, ...fixed } = f.options;
  fixed.pythonPath = await realpath("/usr/bin/python3");
  fixed.pythonSha256 = createHash("sha256").update(await readFile(fixed.pythonPath)).digest("hex");
  const template = { version: 1, deploymentId: randomUUID(), deploymentRoot, options: {
    ...fixed, networkMode: "bridge", projectRoots: [], historyRoot, accountSourceFile,
  } };
  await writeFile(templateFile, JSON.stringify(template) + "\n", { mode: 0o600 });
  const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
  const call = (command) => new Promise((resolve) => execFile(process.execPath, [cli, command, "--config", templateFile], {
    env: { HOME: f.dir, PATH: "/usr/bin:/bin" }, timeout: 5000,
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  const initialized = await call("supervisor-init");
  assert.equal(initialized.error, null, initialized.stderr);
  assert.deepEqual(JSON.parse(initialized.stdout), { state: "initialized" });
  const recordFile = join(deploymentRoot, "supervisor", "state.json");
  const before = await readFile(recordFile, "utf8");
  const status = await call("supervisor-status");
  assert.equal(status.error, null, status.stderr);
  assert.deepEqual(JSON.parse(status.stdout), { phase: "ready", nativeState: "unknown" });
  assert.notEqual((await call("supervisor-init")).error, null);
  assert.equal(await readFile(recordFile, "utf8"), before);
  await assert.rejects(lstat(join(deploymentRoot, "current.profile.json")), { code: "ENOENT" });

  const uncertain = { version: 1, deploymentId: template.deploymentId, phase: "starting", attemptId: randomUUID(), bootId: randomUUID(), managerPid: process.pid, managerStartTicks: "1", configSha256: "f".repeat(64), recovery: {
    dockerPath: fixed.dockerPath, dockerSha256: fixed.dockerSha256, imageDigest: fixed.imageDigest, bridgeRoot: join(f.dir, "old-bridge"), profileFile: join(f.dir, "old-profile"),
  } };
  await writeFile(recordFile, JSON.stringify(uncertain) + "\n", { mode: 0o600 });
  const blocked = await call("supervise");
  assert.equal(blocked.error?.code, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).state, "blocked");
  assert.equal(await readFile(recordFile, "utf8"), JSON.stringify(uncertain) + "\n");
});

test("CLI preserves finite explicit server memory budgets and rejects arbitrary byte or string values", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read()).options.memoryLimitMiB, undefined);
  for (const memoryLimitMiB of [2048, 4096, 8192]) {
    await f.save({ version: 1, options: { ...f.options, memoryLimitMiB } });
    assert.equal((await f.read()).options.memoryLimitMiB, memoryLimitMiB);
  }
  for (const memoryLimitMiB of [
    null,
    0,
    1024,
    3072,
    16384,
    "4096",
    false,
    {},
    4294967296,
  ]) {
    await f.save({ version: 1, options: { ...f.options, memoryLimitMiB } });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
});

test("CLI only accepts the finite server process budget and preserves default omission", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.read()).options.pidsLimit, undefined);
  for (const pidsLimit of [256, 512]) {
    await f.save({ version: 1, options: { ...f.options, pidsLimit } });
    assert.equal((await f.read()).options.pidsLimit, pidsLimit);
  }
  for (const pidsLimit of [null, 0, 128, 257, 1024, "512", false, {}]) {
    await f.save({ version: 1, options: { ...f.options, pidsLimit } });
    await assert.rejects(f.read(), { code: "DESKTOP_CLI_INVALID_CONFIG" });
  }
});

test("start invokes the fixed API once, publishes a safe ready event, and abort only retires its own service", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController(),
    ready = defer(),
    events = [],
    owned = service();
  let calls = 0;
  const run = runDesktopService(config, {
    signal: abort.signal,
    startService: async (options) => {
      calls++;
      assert.deepEqual(options, f.options);
      return owned;
    },
    onEvent: (event) => {
      events.push(event);
      if (event.state === "published") ready.resolve();
    },
  });
  await ready.promise;
  abort.abort();
  const result = await run;
  assert.equal(calls, 1);
  assert.equal(owned.closeCalls, 1);
  assert.equal(result.code, 0);
  assert.equal(result.state, "retired");
  assert.equal(events.filter((event) => event.state === "published").length, 1);
  assert.ok(!JSON.stringify(events).includes(f.dir));
  const attempt = JSON.parse(
    await readFile(f.options.profileFile + ".launch", "utf8"),
  );
  assert.equal(attempt.phase, "retired");
  assert.equal(attempt.profileId, owned.profileId);
  assert.equal(
    (await lstat(f.options.profileFile + ".launch")).mode & 0o777,
    0o600,
  );
  await assert.rejects(
    runDesktopService(config, {
      signal: new AbortController().signal,
      startService: async () => {
        calls++;
        return owned;
      },
    }),
    { code: "DESKTOP_CLI_ALREADY_ATTEMPTED" },
  );
  assert.equal(calls, 1);
});

test("a private supervisor receives owned container identity without publishing it", async (t) => {
  const f = await fixture(t), config = await f.read(), abort = new AbortController();
  const ready = defer(), events = [], owned = service();
  owned.containerId = "f".repeat(64);
  let privateIdentity;
  const run = runDesktopService(config, {
    signal: abort.signal,
    startService: async () => owned,
    onOwner: async (identity) => { privateIdentity = identity; },
    onEvent: (event) => {
      events.push(event);
      if (event.state === "published") ready.resolve();
    },
  });
  await ready.promise;
  abort.abort();
  await run;
  assert.deepEqual(privateIdentity, {
    containerId: owned.containerId,
    profileId: owned.profileId,
    generation: owned.generation,
  });
  assert.ok(!JSON.stringify(events).includes(owned.containerId));
});

test("supervisor records the guarded recovery identity before announcing publication", async (t) => {
  const f = await fixture(t), config = await f.read(), abort = new AbortController();
  const entered = defer(), release = defer(), published = defer(), owned = service(), events = [];
  owned.containerId = "f".repeat(64);
  owned.captureRecoveryIdentity = async ({ configSha256 }) => {
    assert.equal(configSha256, config.fingerprint);
    return Object.freeze({ witness: "fixed-private-fixture" });
  };
  let captured;
  const run = runDesktopService(config, {
    signal: abort.signal,
    startService: async () => owned,
    recordRecoveryIdentity: true,
    onOwner: async (identity) => { captured = identity; entered.resolve(); await release.promise; },
    onEvent: (event) => { events.push(event); if (event.state === "published") published.resolve(); },
  });
  await entered.promise;
  assert.deepEqual(captured.recoveryIdentity, { witness: "fixed-private-fixture" });
  assert.equal(events.some((event) => event.state === "published"), false);
  release.resolve(); await published.promise; abort.abort(); await run;
  assert.ok(!JSON.stringify(events).includes("fixed-private-fixture"));
});

test("supervisor identity recording must settle before the CLI reports published; failure retains an unknown outcome", async (t) => {
  const f = await fixture(t), config = await f.read(), abort = new AbortController();
  const entered = defer(), release = defer(), owned = service(), events = [];
  owned.containerId = "a".repeat(64);
  const run = runDesktopService(config, {
    signal: abort.signal,
    startService: async () => owned,
    onOwner: async () => { entered.resolve(); await release.promise; throw Error("private recording failed"); },
    onEvent: (event) => events.push(event),
  });
  await entered.promise;
  assert.equal(events.some((event) => event.state === "published"), false);
  release.resolve();
  const result = await run;
  assert.equal(result.state, "retained_unknown");
  assert.equal(result.nativeState, "unknown");
  assert.equal(owned.closeCalls, 1);
  assert.equal(events.some((event) => event.state === "published"), false);
  assert.ok(!JSON.stringify(events).includes(owned.containerId));
});

test("existing profile and socket are preserved and prevent another startup", async (t) => {
  const f = await fixture(t),
    config = await f.read();
  await writeFile(f.options.profileFile, "keep", { mode: 0o600 });
  let calls = 0;
  await assert.rejects(
    runDesktopService(config, {
      signal: new AbortController().signal,
      startService: async () => {
        calls++;
      },
    }),
    { code: "DESKTOP_CLI_PROFILE_EXISTS" },
  );
  assert.equal(calls, 0);
  assert.equal(await readFile(f.options.profileFile, "utf8"), "keep");
  await rm(f.options.profileFile);
  const server = createServer();
  server.listen(f.options.controlSocketPath);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    runDesktopService(config, {
      signal: new AbortController().signal,
      startService: async () => {
        calls++;
      },
    }),
    { code: "DESKTOP_CLI_CONTROL_EXISTS" },
  );
  assert.equal(calls, 0);
});

test("two concurrent starts share no retry or owner and only one reaches the native API", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController(),
    ready = defer(),
    owned = service();
  let calls = 0;
  const dependencies = {
    signal: abort.signal,
    startService: async () => {
      calls++;
      return owned;
    },
    onEvent: (event) => {
      if (event.state === "published") ready.resolve();
    },
  };
  const outcomes = Promise.allSettled([
    runDesktopService(config, dependencies),
    runDesktopService(config, dependencies),
  ]);
  await ready.promise;
  abort.abort();
  const settled = await outcomes;
  assert.equal(calls, 1);
  assert.equal(owned.closeCalls, 1);
  assert.equal(
    settled.filter((value) => value.status === "fulfilled").length,
    1,
  );
  assert.equal(
    settled.find((value) => value.status === "rejected").reason.code,
    "DESKTOP_CLI_ALREADY_ATTEMPTED",
  );
});

test("abort during startup waits for the single outcome, then closes the late owner without ready or replay", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController(),
    entered = defer(),
    gate = defer(),
    owned = service(),
    events = [];
  const running = runDesktopService(config, {
    signal: abort.signal,
    startService: async () => {
      entered.resolve();
      return gate.promise;
    },
    onEvent: (event) => events.push(event),
  });
  await entered.promise;
  abort.abort();
  gate.resolve(owned);
  const result = await running;
  assert.equal(result.state, "retired");
  assert.equal(owned.closeCalls, 1);
  assert.equal(
    events.some((event) => event.state === "published"),
    false,
  );
});

test("cancellation while recording readiness does not emit a stale ready event", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController(),
    owned = service(),
    events = [];
  const pending = new Promise(() => {});
  Object.defineProperty(owned, "nativeExited", {
    get() {
      queueMicrotask(() => abort.abort());
      return pending;
    },
  });
  const result = await runDesktopService(config, {
    signal: abort.signal,
    startService: async () => owned,
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.state, "retired");
  assert.equal(owned.closeCalls, 1);
  assert.equal(
    events.some((event) => event.state === "published"),
    false,
  );
});

test("a known native exit before readiness is not announced as ready", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    owned = service(),
    events = [];
  owned.nativeExited = Promise.resolve({ state: "exited" });
  const result = await runDesktopService(config, {
    signal: new AbortController().signal,
    startService: async () => owned,
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.state, "native_exited");
  assert.equal(result.nativeState, "exited");
  assert.equal(owned.closeCalls, 1);
  assert.equal(
    events.some((event) => event.state === "published"),
    false,
  );
});

test("already aborted start performs no launch, and startup unknown retains metadata without native stop", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController();
  abort.abort();
  let calls = 0;
  assert.equal(
    (
      await runDesktopService(config, {
        signal: abort.signal,
        startService: async () => {
          calls++;
        },
      })
    ).state,
    "cancelled",
  );
  assert.equal(calls, 0);
  const retained = service();
  Object.defineProperty(retained, "containerId", { value: "f".repeat(64) });
  const events = [];
  const result = await runDesktopService(config, {
    signal: new AbortController().signal,
    startService: async () => {
      calls++;
      throw Object.assign(Error("private native text"), {
        code: "CONTAINER_GRANT_OUTCOME_UNKNOWN",
        retainedOwner: retained,
      });
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(calls, 1);
  assert.equal(result.state, "retained_unknown");
  assert.equal(result.code, 1);
  assert.equal(retained.closeCalls, 0);
  assert.ok(!JSON.stringify(events).includes("private native text"));
  assert.ok(!JSON.stringify(events).includes(retained.containerId));
});

test("close failure is retained unknown and is not reported as a native exit", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    abort = new AbortController(),
    ready = defer(),
    owned = service();
  owned.close = async () => {
    owned.closeCalls++;
    throw Error("native maybe running");
  };
  const running = runDesktopService(config, {
    signal: abort.signal,
    startService: async () => owned,
    onEvent: (event) => {
      if (event.state === "published") ready.resolve();
    },
  });
  await ready.promise;
  abort.abort();
  const result = await running;
  assert.equal(result.state, "retained_unknown");
  assert.equal(result.code, 1);
  assert.equal(result.nativeState, "unknown");
  assert.equal(owned.closeCalls, 1);
});

async function profileRecord(f) {
  const source = await readFile(`/proc/${process.pid}/stat`, "utf8"),
    fields = source
      .slice(source.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/);
  return {
    version: 1,
    id: randomUUID(),
    generation: randomUUID(),
    pid: process.pid,
    startTicks: fields[19],
    uid: process.getuid(),
    macAsarPath: f.options.macAsarPath,
    macAsarSha256: f.options.macAsarSha256,
    linuxAsarPath: join(f.options.sourceRoot, "resources", "app.asar"),
    linuxAsarSha256:
      "1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e",
    controlSocketPath: f.options.controlSocketPath,
  };
}
async function published(t, f, reply) {
  const profile = await profileRecord(f);
  await writeFile(f.options.profileFile, JSON.stringify(profile), {
    mode: 0o600,
  });
  const frames = [],
    sockets = new Set(),
    server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      let body = "";
      socket.on("data", (chunk) => {
        body += chunk;
        const i = body.indexOf("\n");
        if (i < 0) return;
        const frame = decodeWireValue(body.slice(0, i));
        body = body.slice(i + 1);
        frames.push(frame);
        if (reply) reply(socket, profile, frame);
        else
          socket.write(
            encodeWireValue({
              v: 1,
              type: "hello",
              profileId: profile.id,
              generation: profile.generation,
              pid: profile.pid,
              startTicks: profile.startTicks,
            }) + "\n",
          );
      });
    });
  server.listen(f.options.controlSocketPath);
  await once(server, "listening");
  await chmod(f.options.controlSocketPath, 0o600);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return { profile, frames };
}

test("status verifies the published binding using hello only, without creating a view or sending native work", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    broker = await published(t, f);
  const result = await readDesktopServiceStatus(config);
  assert.equal(result.state, "broker_ready");
  assert.equal(result.nativeState, "not_observed");
  assert.equal(result.profileId, broker.profile.id);
  assert.deepEqual(
    broker.frames.map((frame) => frame.type),
    ["hello"],
  );
  assert.ok(!JSON.stringify(result).includes(f.dir));
});

test("server SSH status accepts only its configured profile socket and still sends broker hello only", async (t) => {
  const f = await fixture(t);
  f.options.serverSsh = true;
  await f.save();
  const config = await f.read(), broker = await published(t, f);
  broker.profile.serverSshSocketPath = join(f.options.bridgeRoot, "server-ssh.sock");
  await writeFile(f.options.profileFile, JSON.stringify(broker.profile));
  const result = await readDesktopServiceStatus(config);
  assert.equal(result.state, "broker_ready");
  assert.equal(result.nativeState, "not_observed");
  assert.equal(result.resourcesVerified, false);
  assert.equal(result.profileId, broker.profile.id);
  assert.deepEqual(broker.frames.map(frame => frame.type), ["hello"]);
  assert.ok(!JSON.stringify(result).includes("server-ssh.sock"));

  for (const socketPath of [undefined, null, "/tmp/server-ssh.sock", join(f.options.bridgeRoot, "other.sock"), `${f.options.bridgeRoot}/../bridge/server-ssh.sock`, {}, []]) {
    await writeFile(f.options.profileFile, JSON.stringify({ ...broker.profile, serverSshSocketPath: socketPath }));
    assert.equal((await readDesktopServiceStatus(config)).state, "unavailable");
  }
  assert.deepEqual(broker.frames.map(frame => frame.type), ["hello"]);
});

test("server SSH profile fields cannot enable SSH in an omitted or false CLI configuration", async (t) => {
  const f = await fixture(t), broker = await published(t, f);
  for (const serverSsh of [undefined, false]) {
    await f.save({ version: 1, options: { ...f.options, serverSsh } });
    const config = await f.read();
    await writeFile(f.options.profileFile, JSON.stringify(broker.profile));
    assert.equal((await readDesktopServiceStatus(config)).state, "broker_ready");
    await writeFile(f.options.profileFile, JSON.stringify({ ...broker.profile, serverSshSocketPath: join(f.options.bridgeRoot, "server-ssh.sock") }));
    assert.equal((await readDesktopServiceStatus(config)).state, "unavailable");
  }
  assert.deepEqual(broker.frames.map(frame => frame.type), ["hello", "hello"]);
});

test("status does not connect to stale manager or revoked profile, and does not launch missing profiles", async (t) => {
  const f = await fixture(t),
    config = await f.read();
  assert.equal((await readDesktopServiceStatus(config)).state, "not_started");
  await writeFile(f.options.profileFile, '{"version":0,"state":"revoked"}', {
    mode: 0o600,
  });
  assert.equal((await readDesktopServiceStatus(config)).state, "revoked");
  const broker = await published(t, f);
  broker.profile.startTicks = String(BigInt(broker.profile.startTicks) + 1n);
  await writeFile(f.options.profileFile, JSON.stringify(broker.profile));
  assert.equal((await readDesktopServiceStatus(config)).state, "unavailable");
  assert.equal(broker.frames.length, 0);
});

test("status treats broker timeout and wrong generation as unavailable without fallback", async (t) => {
  const f = await fixture(t),
    config = await f.read();
  let respond = false;
  const broker = await published(t, f, (socket, profile) => {
    if (respond)
      socket.write(
        encodeWireValue({
          v: 1,
          type: "hello",
          profileId: profile.id,
          generation: randomUUID(),
          pid: profile.pid,
          startTicks: profile.startTicks,
        }) + "\n",
      );
  });
  assert.equal(
    (await readDesktopServiceStatus(config, { timeoutMs: 10 })).state,
    "unavailable",
  );
  assert.deepEqual(
    broker.frames.map((frame) => frame.type),
    ["hello"],
  );
  respond = true;
  assert.equal((await readDesktopServiceStatus(config)).state, "unavailable");
  assert.deepEqual(
    broker.frames.map((frame) => frame.type),
    ["hello", "hello"],
  );
});

test("status rejects a changed profile after hello rather than accepting a stale identity", async (t) => {
  const f = await fixture(t),
    config = await f.read();
  const broker = await published(t, f, async (socket, profile) => {
    await writeFile(
      f.options.profileFile,
      JSON.stringify({ ...profile, generation: randomUUID() }),
    );
    socket.write(
      encodeWireValue({
        v: 1,
        type: "hello",
        profileId: profile.id,
        generation: profile.generation,
        pid: profile.pid,
        startTicks: profile.startTicks,
      }) + "\n",
    );
  });
  const result = await readDesktopServiceStatus(config);
  assert.equal(result.state, "unavailable");
  assert.deepEqual(
    broker.frames.map((frame) => frame.type),
    ["hello"],
  );
});

test("the real status command emits bounded public metadata and leaves native work untouched", async (t) => {
  const f = await fixture(t),
    broker = await published(t, f);
  const output = await new Promise((resolveOutput, reject) =>
    execFile(
      process.execPath,
      [
        new URL("../src/service-cli.mjs", import.meta.url).pathname,
        "status",
        "--config",
        f.configFile,
      ],
      { encoding: "utf8", maxBuffer: 4096 },
      (error, stdout, stderr) =>
        error ? reject(error) : resolveOutput({ stdout, stderr }),
    ),
  );
  assert.equal(JSON.parse(output.stdout).state, "broker_ready");
  assert.equal(output.stderr, "");
  assert.ok(!output.stdout.includes(f.dir));
  assert.deepEqual(
    broker.frames.map((frame) => frame.type),
    ["hello"],
  );
});

test("status interoperates with the actual private broker without creating any upstream view", async (t) => {
  const f = await fixture(t),
    config = await f.read(),
    profile = await profileRecord(f);
  let nativeWrites = 0;
  await writeFile(f.options.profileFile, JSON.stringify(profile), {
    mode: 0o600,
  });
  const broker = await createDesktopControlService({
    socketPath: profile.controlSocketPath,
    profileId: profile.id,
    generation: profile.generation,
    pid: profile.pid,
    startTicks: profile.startTicks,
    upstream: {
      send: async () => {
        nativeWrites++;
        throw Error("native operation forbidden");
      },
      subscribe: () => () => {},
    },
    verifyIdentity: async () => true,
  });
  try {
    const result = await readDesktopServiceStatus(config);
    assert.equal(result.state, "broker_ready");
    assert.equal(nativeWrites, 0);
  } finally {
    await broker.close();
  }
  assert.equal(nativeWrites, 0);
});

test("successful CLI retirement ends only its own manager after close settles, even with a referenced native monitor", async (t) => {
  const f = await fixture(t);
  const child = spawn(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-loader",
      new URL("./fixtures/service-cli-loader.mjs", import.meta.url).href,
      new URL("../src/service-cli.mjs", import.meta.url).pathname,
      "start",
      "--config",
      f.configFile,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    exited = false;
  const completion = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    }),
  );
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    assert.ok(output.length <= 4096);
  });
  child.stderr.resume();
  t.after(async () => {
    if (!exited) child.kill("SIGKILL");
    await completion;
  });
  const until = Date.now() + 5000;
  while (!output.includes('"state":"published"') && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(output.includes('"state":"published"'));
  child.kill("SIGTERM");
  let timer;
  const result = await Promise.race([
    completion,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ state: "timeout" }), 3000);
    }),
  ]);
  clearTimeout(timer);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(
    await readFile(f.options.profileFile + ".fake-close", "utf8"),
    "completed",
  );
  assert.equal(
    JSON.parse(await readFile(f.options.profileFile + ".launch", "utf8")).phase,
    "retired",
  );
});

test("an unknown close keeps the CLI ownership record and is not forced into successful retirement", async (t) => {
  const f = await fixture(t);
  const child = spawn(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-loader",
      new URL("./fixtures/service-cli-loader.mjs", import.meta.url).href,
      new URL("../src/service-cli.mjs", import.meta.url).pathname,
      "start",
      "--config",
      f.configFile,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CHATGPT_FAKE_CLOSE_UNKNOWN: "1" },
    },
  );
  let output = "",
    exited = false;
  const completion = new Promise((resolve) =>
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    }),
  );
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    assert.ok(output.length <= 4096);
  });
  child.stderr.resume();
  // This is a synthetic child with no native, IPC or account. Cleanup belongs
  // only to the test and is never offered by the product CLI.
  t.after(async () => {
    if (!exited) child.kill("SIGKILL");
    await completion;
  });
  const until = Date.now() + 5000;
  while (!output.includes('"state":"published"') && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(output.includes('"state":"published"'));
  child.kill("SIGTERM");
  while (!output.includes('"state":"retained_unknown"') && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(output.includes('"state":"retained_unknown"'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(exited, false);
  assert.equal(
    JSON.parse(await readFile(f.options.profileFile + ".launch", "utf8")).phase,
    "retained_unknown",
  );
  assert.equal(
    await readFile(f.options.profileFile + ".fake-close", "utf8"),
    "completed",
  );
});
