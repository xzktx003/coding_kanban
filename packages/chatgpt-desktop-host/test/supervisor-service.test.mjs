import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeDesktopSupervisor,
  inspectExitedDesktopContainer,
  readDesktopSupervisorStatus,
  runDesktopSupervisor,
} from "../src/supervisor-service.mjs";
import {
  readDesktopServiceConfig,
  runDesktopService,
} from "../src/service-cli.mjs";
import { publishStableProfileAlias } from "../src/stable-profile-alias.mjs";

const pythonPath = await realpath("/usr/bin/python3");
const pythonSha256 = createHash("sha256")
  .update(await readFile(pythonPath))
  .digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 250; i++) {
    try {
      if (await predicate()) return;
    } catch (error) {
      if (error.code !== "DESKTOP_SUPERVISOR_STATE_UNAVAILABLE") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting for supervisor state");
};
async function waitForChildOutput(child) {
  let stderr = "",
    timer;
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4096)
      stderr += chunk.toString().slice(0, 4096 - stderr.length);
  });
  const safeStderr = () =>
    stderr
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\/(?:[^\s:()]+\/?)+/g, "<path>")
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "?")
      .slice(0, 1024);
  try {
    return await Promise.race([
      once(child.stdout, "data").then(([chunk]) => chunk.toString()),
      once(child, "exit").then(([code, signal]) => {
        throw Error(
          `private fixture exited (${code ?? signal}): ${safeStderr()}`,
        );
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`private fixture timed out: ${safeStderr()}`)),
          5000,
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-supervisor-"));
  await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, "state");
  const deploymentId = randomUUID();
  await initializeDesktopSupervisor({ stateDirectory, deploymentId });
  const signal = new AbortController().signal;
  const options = {
    stateDirectory,
    deploymentId,
    pythonPath,
    pythonSha256,
    signal,
  };
  const events = [];
  const configs = [];
  const owner = {
    containerId: "b".repeat(64),
    generation: randomUUID(),
    profileId: randomUUID(),
  };
  const createConfig = async ({ attemptId }) => {
    configs.push(attemptId);
    return {
      fingerprint: createHash("sha256").update(attemptId).digest("hex"),
      options: {
        dockerPath: "/usr/bin/docker",
        dockerSha256: "c".repeat(64),
        imageDigest: "sha256:" + "d".repeat(64),
        bridgeRoot: join(dir, "bridge", attemptId),
        profileFile: join(dir, `g${attemptId.replaceAll("-", "")}`, "p.json"),
        accountSnapshot: { sourceFile: "/secret-value-must-not-be-recorded" },
      },
    };
  };
  return { dir, options, configs, owner, events, createConfig };
}
function exited(owner) {
  return { state: "exited", ...owner };
}
const fixtureAlias = async ({ candidates }) =>
  candidates.length
    ? { state: "matched", attemptId: candidates.at(-1).attemptId }
    : { state: "absent" };
const fixtureCapture = async ({ current }) => ({
  dev: "1",
  ino: BigInt(
    "0x" + current.attemptId.replaceAll("-", "").slice(0, 14),
  ).toString(),
});

test("fresh deployment runs the existing service exactly once and records no credentials", async (t) => {
  const f = await fixture(t);
  const end = deferred();
  t.after(() => end.resolve({ state: "retained_unknown" }));
  let calls = 0;
  const run = runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      calls++;
      onOwner(f.owner);
      return end.promise;
    },
    onEvent: (event) => f.events.push(event),
  });
  await waitFor(
    async () =>
      (await readDesktopSupervisorStatus(f.options)).phase === "owned",
  );
  assert.equal(calls, 1);
  assert.equal(f.configs.length, 1);
  const record = await readFile(
    join(f.options.stateDirectory, "state.json"),
    "utf8",
  );
  assert.ok(!record.includes("secret-value"));
  end.resolve({ state: "retained_unknown", nativeState: "unknown" });
  const result = await run;
  assert.equal(result.state, "blocked");
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
});

test("supervisor durably records the original live recovery identity before publication", async (t) => {
  const f = await fixture(t), bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const identity = (pid, ppid, ns) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 2), nspids: [pid, ns], cpus: "1",
    noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${f.owner.containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]",
  });
  let witness;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (config, { onOwner }) => {
      witness = {
        version: 1, ...f.owner, bootId, configSha256: config.fingerprint,
        filesSha256: "a".repeat(64), account: { kind: "anonymous", binding: null }, projects: [],
        processes: { init: identity(101, 1, 1), bridge: identity(102, 101, 2), node: identity(103, 102, 3), native: identity(104, 103, 4) },
      };
      await onOwner({ ...f.owner, recoveryIdentity: witness });
      return { state: "retained_unknown", nativeState: "unknown" };
    },
  });
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
  const record = JSON.parse(await readFile(join(f.options.stateDirectory, "state.json"), "utf8"));
  assert.equal(record.phase, "retained");
  assert.deepEqual(record.liveAnchor, witness);
  assert.ok(!JSON.stringify(record).includes("secret-value"));
});

test("supervisor reattaches the same anchored native and replaces only its broker profile", async (t) => {
  const f = await fixture(t), bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const identity = (pid, ppid, ns) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 2), nspids: [pid, ns], cpus: "1",
    noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${f.owner.containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]",
  });
  let original, oldConfig, alias = null, normalStarts = 0, recoverStarts = 0;
  const witness = (fingerprint) => ({
    version: 1, ...f.owner, bootId, configSha256: fingerprint, filesSha256: "a".repeat(64),
    account: { kind: "anonymous", binding: null }, projects: [],
    processes: { init: identity(101, 1, 1), bridge: identity(102, 101, 2), node: identity(103, 102, 3), native: identity(104, 103, 4) },
  });
  const inspectAlias = async ({ candidates, mayBeAbsent }) => {
    if (alias === null) return mayBeAbsent ? { state: "absent" } : { state: "unknown" };
    return candidates.some((candidate) => candidate.attemptId === alias)
      ? { state: "matched", attemptId: alias } : { state: "unknown" };
  };
  const publishProfile = async ({ attemptId, verifyLease }) => {
    assert.equal(await verifyLease(), true); alias = attemptId;
  };
  const first = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    runService: async (config, { onOwner }) => {
      normalStarts++; oldConfig = config; original = witness(config.fingerprint);
      await onOwner({ ...f.owner, recoveryIdentity: original });
      return { state: "retained_unknown", nativeState: "unknown" };
    },
  });
  assert.equal(first.state, "blocked");
  const oldAlias = alias;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    inspectPrevious: async () => ({ state: "unknown" }),
    inspectManagerGone: async () => true,
    verifyRecoveryIdentity: async (value) => { assert.deepEqual(value, original); return true; },
    createRecoveryConfig: async ({ attemptId, previous }) => {
      assert.equal(previous.attemptId, f.configs[0]);
      const config = await f.createConfig({ attemptId });
      return { ...config, options: { ...config.options, bridgeRoot: oldConfig.options.bridgeRoot } };
    },
    runService: async (config, { onOwner, recovery }) => {
      recoverStarts++;
      assert.deepEqual(recovery.identity, original);
      assert.equal(recovery.configSha256, oldConfig.fingerprint);
      await onOwner({ ...f.owner, recoveryIdentity: witness(config.fingerprint) });
      return { state: "retained_unknown", nativeState: "unknown" };
    },
  });
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
  assert.equal(normalStarts, 1);
  assert.equal(recoverStarts, 1);
  assert.notEqual(alias, oldAlias);
  const saved = JSON.parse(await readFile(join(f.options.stateDirectory, "state.json"), "utf8"));
  assert.equal(saved.phase, "retained");
  assert.deepEqual(saved.native, f.owner);
  assert.equal(saved.aliasState.candidates.length, 1);
  assert.equal(saved.aliasState.candidates[0].attemptId, alias);
  assert.equal(Object.hasOwn(saved, "recoveryFrom"), false);
});

test("an unanchored prior native is never reattached or replaced", async (t) => {
  const f = await fixture(t);
  let alias = null, recoveryAttempts = 0;
  const inspectAlias = async ({ candidates, mayBeAbsent }) => alias === null
    ? (mayBeAbsent ? { state: "absent" } : { state: "unknown" })
    : (candidates.some((candidate) => candidate.attemptId === alias) ? { state: "matched", attemptId: alias } : { state: "unknown" });
  const publishProfile = async ({ attemptId }) => { alias = attemptId; };
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    runService: async (_config, { onOwner }) => {
      await onOwner(f.owner); return { state: "retained_unknown", nativeState: "unknown" };
    },
  });
  const before = await readFile(join(f.options.stateDirectory, "state.json"), "utf8"), oldAlias = alias;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    createRecoveryConfig: async () => { recoveryAttempts++; throw Error(); },
    inspectPrevious: async () => ({ state: "unknown" }), inspectManagerGone: async () => true,
    verifyRecoveryIdentity: async () => assert.fail("no original anchor"),
    runService: async () => assert.fail("must not start or attach"),
  });
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
  assert.equal(recoveryAttempts, 0);
  assert.equal(alias, oldAlias);
  assert.equal(await readFile(join(f.options.stateDirectory, "state.json"), "utf8"), before);
});

test("reattachment refuses a live old manager and an identity revoked before publication", async (t) => {
  const f = await fixture(t), bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const processIdentity = (pid, ppid, ns) => ({
    pid, ppid, uid: 1000, ticks: String(pid * 2), nspids: [pid, ns], cpus: "1",
    noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000",
    cgroup: `0::/system.slice/docker-${f.owner.containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]",
  });
  const witness = (fingerprint) => ({
    version: 1, ...f.owner, bootId, configSha256: fingerprint, filesSha256: "a".repeat(64),
    account: { kind: "anonymous", binding: null }, projects: [],
    processes: { init: processIdentity(101, 1, 1), bridge: processIdentity(102, 101, 2), node: processIdentity(103, 102, 3), native: processIdentity(104, 103, 4) },
  });
  let original, oldConfig, alias = null, attachments = 0, recoverConfigs = 0;
  const inspectAlias = async ({ candidates, mayBeAbsent }) => alias === null
    ? (mayBeAbsent ? { state: "absent" } : { state: "unknown" })
    : (candidates.some((candidate) => candidate.attemptId === alias) ? { state: "matched", attemptId: alias } : { state: "unknown" });
  const publishProfile = async ({ attemptId, verifyLease }) => { assert.equal(await verifyLease(), true); alias = attemptId; };
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    runService: async (config, { onOwner }) => {
      oldConfig = config; original = witness(config.fingerprint);
      await onOwner({ ...f.owner, recoveryIdentity: original });
      return { state: "retained_unknown", nativeState: "unknown" };
    },
  });
  const before = await readFile(join(f.options.stateDirectory, "state.json"), "utf8"), oldAlias = alias;
  const common = {
    createConfig: f.createConfig, inspectAlias, captureProfile: fixtureCapture, publishProfile,
    inspectPrevious: async () => ({ state: "unknown" }),
    createRecoveryConfig: async ({ attemptId }) => {
      recoverConfigs++;
      const config = await f.createConfig({ attemptId });
      return { ...config, options: { ...config.options, bridgeRoot: oldConfig.options.bridgeRoot } };
    },
    runService: async (config, { onOwner }) => {
      attachments++;
      await onOwner({ ...f.owner, recoveryIdentity: witness(config.fingerprint) });
      return { state: "retained_unknown", nativeState: "unknown" };
    },
  };
  const alive = await runDesktopSupervisor(f.options, {
    ...common, inspectManagerGone: async () => false,
    verifyRecoveryIdentity: async () => assert.fail("live manager prevents identity inspection"),
  });
  assert.equal(alive.reasonCode, "DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
  assert.equal(recoverConfigs, 0); assert.equal(attachments, 0); assert.equal(alias, oldAlias);
  assert.equal(await readFile(join(f.options.stateDirectory, "state.json"), "utf8"), before);

  let checks = 0;
  const revoked = await runDesktopSupervisor(f.options, {
    ...common, inspectManagerGone: async () => true,
    verifyRecoveryIdentity: async (value) => { assert.deepEqual(value, original); return ++checks < 3; },
  });
  assert.equal(revoked.reasonCode, "DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
  assert.equal(attachments, 1); assert.equal(alias, oldAlias);
  const saved = JSON.parse(await readFile(join(f.options.stateDirectory, "state.json"), "utf8"));
  assert.equal(saved.phase, "owned"); assert.ok(saved.recoveryFrom);
  assert.equal(saved.aliasState.candidates.length, 2);
  const repeated = await runDesktopSupervisor(f.options, {
    ...common, inspectManagerGone: async () => true, verifyRecoveryIdentity: async () => true,
  });
  assert.equal(repeated.reasonCode, "DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
  assert.equal(attachments, 1); assert.equal(alias, oldAlias);
});

test("an active supervisor owns the kernel lock and a competitor cannot launch", async (t) => {
  const f = await fixture(t);
  const end = deferred();
  t.after(() => end.resolve({ state: "retained_unknown" }));
  const first = runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      onOwner(f.owner);
      return end.promise;
    },
  });
  await waitFor(
    async () =>
      (await readDesktopSupervisorStatus(f.options)).phase === "owned",
  );
  const second = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async () => assert.fail("must not launch"),
  });
  assert.equal(second.state, "already_running");
  assert.equal(f.configs.length, 1);
  end.resolve({ state: "retained_unknown" });
  await first;
});

test("unknown startup or active prior native never causes a second launch", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async () => {
      throw Error("uncertain create");
    },
  });
  let inspected = false;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => {
      inspected = true;
      return { state: "exited" };
    },
    runService: async () => assert.fail("unknown creation must never replay"),
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
  assert.equal(inspected, false);
  assert.equal(f.configs.length, 1);
});

test("only an exact exited native permits one new generation; mismatches fail closed", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      onOwner(f.owner);
      return { state: "retired", nativeState: "unknown" };
    },
  });
  const stale = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () =>
      exited({ ...f.owner, generation: randomUUID() }),
    runService: async () => assert.fail("wrong generation must not start"),
  });
  assert.equal(stale.state, "blocked");
  assert.equal(f.configs.length, 1);
  const valid = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => exited(f.owner),
    runService: async (_config, { onOwner }) => {
      onOwner({ ...f.owner, generation: randomUUID() });
      return { state: "native_exited", nativeState: "exited" };
    },
  });
  assert.equal(valid.state, "native_exited");
  assert.equal(f.configs.length, 2);
  assert.notEqual(f.configs[0], f.configs[1]);
});

test("existing, corrupt, or replaced deployment state never gets silently initialized", async (t) => {
  const f = await fixture(t);
  await assert.rejects(initializeDesktopSupervisor(f.options), {
    code: "DESKTOP_SUPERVISOR_EXISTS",
  });
  await writeFile(join(f.options.stateDirectory, "state.json"), "{}\n");
  await assert.rejects(
    runDesktopSupervisor(f.options, {
      createConfig: f.createConfig,
      runService: async () => assert.fail("invalid state must fail closed"),
    }),
    { code: "DESKTOP_SUPERVISOR_STATE_UNAVAILABLE" },
  );
  assert.equal(f.configs.length, 0);
});

test("the original CLI awaits the private owner record before its public published event", async (t) => {
  const f = await fixture(t);
  const abort = new AbortController();
  const events = [];
  let closeCalls = 0;
  const owner = {
    ...f.owner,
    nativeExited: new Promise(() => {}),
    async close() {
      closeCalls++;
    },
  };
  const createConfig = async ({ attemptId }) => {
    const root = join(f.dir, attemptId);
    await mkdir(root, { mode: 0o700 });
    const options = {
      imageDigest: "sha256:" + "d".repeat(64),
      sourceRoot: join(root, "source"),
      runtimeRoot: join(root, "runtime"),
      bridgeRoot: join(root, "bridge"),
      cpuId: 1,
      macAsarPath: join(root, "mac.asar"),
      macAsarSha256: "e".repeat(64),
      profileFile: join(root, "profile.json"),
      controlSocketPath: join(root, "control.sock"),
      dockerPath: "/usr/bin/docker",
      dockerSha256: "c".repeat(64),
      pythonPath,
      pythonSha256,
      nodePath: process.execPath,
      nodeSha256: "f".repeat(64),
    };
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify({ version: 1, options }) + "\n", {
      mode: 0o600,
    });
    return readDesktopServiceConfig(path);
  };
  const run = runDesktopSupervisor(
    { ...f.options, signal: abort.signal },
    {
      createConfig,
      runService: (config, callbacks) =>
        runDesktopService(config, {
          ...callbacks,
          startService: async () => owner,
          onEvent: (value) => {
            events.push(value);
            callbacks.onEvent(value);
          },
        }),
    },
  );
  await waitFor(() => events.some((event) => event.state === "published"));
  assert.equal((await readDesktopSupervisorStatus(f.options)).phase, "owned");
  assert.ok(!JSON.stringify(events).includes(f.owner.containerId));
  abort.abort();
  assert.equal((await run).state, "blocked");
  assert.equal(closeCalls, 1);
});

test("a premature service published event cannot bypass owner and alias persistence", async (t) => {
  const f = await fixture(t);
  const order = [];
  const gate = deferred();
  const run = runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectAlias: fixtureAlias,
    captureProfile: fixtureCapture,
    publishProfile: async () => {
      order.push("alias-start");
      await gate.promise;
      order.push("alias-ready");
    },
    runService: async (_config, { onOwner, onEvent }) => {
      onEvent({ state: "published" });
      const owner = onOwner(f.owner);
      await waitFor(() => order.includes("alias-start"));
      onEvent({ state: "published" });
      gate.resolve();
      await owner;
      onEvent({ state: "published" });
      return { state: "native_exited", nativeState: "exited" };
    },
    onEvent: ({ state }) => {
      if (state === "published") order.push("published");
    },
  });
  assert.equal((await run).state, "native_exited");
  assert.deepEqual(order, ["alias-start", "alias-ready", "published"]);
});

test("a change in the previous container after initial proof prevents the new service start", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      await onOwner(f.owner);
      return { state: "retired" };
    },
  });
  let reads = 0;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () =>
      ++reads === 1 ? exited(f.owner) : { state: "running" },
    runService: async () => assert.fail("must not start after proof changed"),
  });
  assert.equal(result.state, "blocked");
  assert.equal(reads, 2);
  assert.equal(
    (await readDesktopSupervisorStatus(f.options)).phase,
    "retained",
  );
});

test("a previous boot alone is not proof of exit; recovery still requires exact inspection", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      await onOwner(f.owner);
      return { state: "retired" };
    },
  });
  const path = join(f.options.stateDirectory, "state.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  record.phase = "owned";
  record.bootId = randomUUID();
  await writeFile(path, JSON.stringify(record) + "\n");
  const blocked = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => ({ state: "unknown" }),
    runService: async () => assert.fail("boot change alone must not start"),
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(f.configs.length, 1);
  const recovered = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => exited(f.owner),
    runService: async (_config, { onOwner }) => {
      await onOwner({
        ...f.owner,
        containerId: "f".repeat(64),
        generation: randomUUID(),
      });
      return { state: "native_exited", nativeState: "exited" };
    },
  });
  assert.equal(recovered.state, "native_exited");
  assert.equal(f.configs.length, 2);
});

test("cancellation while rechecking the previous container never issues a new start", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner }) => {
      await onOwner(f.owner);
      return { state: "retired" };
    },
  });
  const abort = new AbortController();
  let reads = 0;
  const result = await runDesktopSupervisor(
    { ...f.options, signal: abort.signal },
    {
      createConfig: f.createConfig,
      inspectPrevious: async () => {
        if (++reads === 2) abort.abort();
        return exited(f.owner);
      },
      runService: async () => assert.fail("cancelled start"),
    },
  );
  assert.equal(result.state, "cancelled");
  assert.equal(
    (await readDesktopSupervisorStatus(f.options)).phase,
    "retained",
  );
});

test("replacing the private record while recording an owner leaves native outcome unknown", async (t) => {
  const f = await fixture(t);
  const path = join(f.options.stateDirectory, "state.json");
  let publicEvents = 0;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async (_config, { onOwner, onEvent }) => {
      const original = await readFile(path);
      await rename(path, join(f.options.stateDirectory, "displaced.json"));
      await writeFile(path, original, { mode: 0o600 });
      await onOwner(f.owner);
      onEvent({ state: "published" });
      return { state: "native_exited", nativeState: "exited" };
    },
    onEvent: () => publicEvents++,
  });
  assert.equal(result.state, "blocked");
  assert.equal(publicEvents, 0);
  assert.equal(
    (await readDesktopSupervisorStatus(f.options)).phase,
    "starting",
  );
  assert.equal(
    (
      await runDesktopSupervisor(f.options, {
        createConfig: f.createConfig,
        runService: async () => assert.fail("unknown must not replay"),
      })
    ).state,
    "blocked",
  );
});

test("profile publication runs after durable owner record and receives the previous exact identity", async (t) => {
  const f = await fixture(t);
  const publications = [];
  let published = 0;
  const first = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectAlias: fixtureAlias,
    captureProfile: fixtureCapture,
    publishProfile: async (context) => {
      assert.equal(await context.verifyLease(), true);
      assert.equal(
        (await readDesktopSupervisorStatus(f.options)).phase,
        "owned",
      );
      publications.push(context);
    },
    runService: async (_config, { onOwner, onEvent }) => {
      await onOwner(f.owner);
      onEvent({ state: "published" });
      return { state: "retired" };
    },
    onEvent: ({ state }) => {
      if (state === "published") published++;
    },
  });
  assert.equal(first.state, "blocked");
  assert.equal(published, 1);
  assert.equal(publications[0].previous.phase, "ready");
  assert.deepEqual(publications[0].identity, f.owner);
  const oldProfile = publications[0].config.options.profileFile;
  let reads = 0;
  const second = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectAlias: fixtureAlias,
    captureProfile: fixtureCapture,
    inspectPrevious: async () => {
      reads++;
      return exited(f.owner);
    },
    publishProfile: async (context) => {
      assert.equal(context.previous.recovery.profileFile, oldProfile);
      assert.deepEqual(context.previous.native, f.owner);
      assert.equal(await context.verifyLease(), true);
      throw Error("publication outcome unknown");
    },
    runService: async (_config, { onOwner, onEvent }) => {
      await onOwner({
        ...f.owner,
        containerId: "f".repeat(64),
        generation: randomUUID(),
      });
      onEvent({ state: "published" });
      return { state: "retired" };
    },
    onEvent: ({ state }) => {
      if (state === "published") published++;
    },
  });
  assert.equal(reads, 3);
  assert.equal(second.state, "blocked");
  assert.equal(published, 1);
  assert.equal((await readDesktopSupervisorStatus(f.options)).phase, "owned");
});

test("previous native becoming active during startup prevents the gateway alias changing", async (t) => {
  const f = await fixture(t);
  await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectAlias: fixtureAlias,
    captureProfile: fixtureCapture,
    publishProfile: async () => {},
    runService: async (_config, { onOwner }) => {
      await onOwner(f.owner);
      return { state: "retired" };
    },
  });
  let inspections = 0,
    publications = 0;
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectAlias: fixtureAlias,
    captureProfile: fixtureCapture,
    inspectPrevious: async () =>
      ++inspections < 3 ? exited(f.owner) : { state: "running" },
    publishProfile: async () => {
      publications++;
    },
    runService: async (_config, { onOwner }) => {
      await onOwner({
        ...f.owner,
        containerId: "f".repeat(64),
        generation: randomUUID(),
      });
      return { state: "retired" };
    },
  });
  assert.equal(inspections, 3);
  assert.equal(publications, 0);
  assert.equal(result.state, "blocked");
  assert.equal((await readDesktopSupervisorStatus(f.options)).phase, "owned");
});

test("read-only Docker inspection requires the exact ID, image, generation, stopped state and disabled restart", async (t) => {
  const f = await fixture(t);
  const dockerPath = join(f.dir, "docker");
  const recovery = {
    dockerPath,
    dockerSha256: "",
    imageDigest: "sha256:" + "d".repeat(64),
    bridgeRoot: join(f.dir, "already-gone-after-boot"),
    profileFile: join(f.dir, "old-profile.json"),
  };
  const observation = {
    id: f.owner.containerId,
    image: recovery.imageDigest,
    generation: f.owner.generation,
    status: "exited",
    running: false,
    pid: 0,
    restart: "no",
  };
  const inspect = async (value) => {
    const body = `#!/usr/bin/python3\nimport json,sys\nassert sys.argv[1] == 'inspect' and sys.argv[-1] == ${JSON.stringify(f.owner.containerId)}\nprint(${JSON.stringify(JSON.stringify(value))})\n`;
    await writeFile(dockerPath, body, { mode: 0o700 });
    await chmod(dockerPath, 0o700);
    recovery.dockerSha256 = createHash("sha256")
      .update(await readFile(dockerPath))
      .digest("hex");
    return inspectExitedDesktopContainer({
      native: f.owner,
      recovery,
      dockerConfigDirectory: join(f.options.stateDirectory, "docker-config"),
    });
  };
  assert.deepEqual(await inspect(observation), exited(f.owner));
  for (const value of [
    { ...observation, id: "a".repeat(64) },
    { ...observation, image: "sha256:" + "a".repeat(64) },
    { ...observation, generation: randomUUID() },
    { ...observation, status: "running", running: true, pid: 123 },
    { ...observation, status: "created" },
    { ...observation, restart: "always" },
    { ...observation, pid: 1 },
  ])
    assert.deepEqual(await inspect(value), { state: "unknown" });
});

test("a pending direct predecessor remains protected even when the alias belongs to an older owner", async (t) => {
  const f = await fixture(t);
  const owner = (letter) => ({
    containerId: letter.repeat(64),
    generation: randomUUID(),
    profileId: randomUUID(),
  });
  const candidate = async (letter) => {
    const attemptId = randomUUID();
    const dir = join(f.dir, `g${attemptId.replaceAll("-", "")}`);
    await mkdir(dir, { mode: 0o700 });
    const profileFile = join(dir, "p.json");
    await writeFile(profileFile, "fixture\n", { mode: 0o600 });
    const info = await lstat(profileFile, { bigint: true });
    return {
      attemptId,
      native: owner(letter),
      recovery: {
        dockerPath: "/usr/bin/docker",
        dockerSha256: "d".repeat(64),
        imageDigest: "sha256:" + "e".repeat(64),
        bridgeRoot: join(dir, "bridge"),
        profileFile,
      },
      anchor: { dev: info.dev.toString(), ino: info.ino.toString() },
    };
  };
  const a = await candidate("a"),
    b = await candidate("b"),
    c = await candidate("c");
  await link(a.recovery.profileFile, join(f.dir, "current.profile.json"));
  const bootId = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim();
  const record = {
    version: 1,
    deploymentId: f.options.deploymentId,
    phase: "owned",
    attemptId: c.attemptId,
    bootId,
    managerPid: 1073741824,
    managerStartTicks: "1",
    configSha256: "f".repeat(64),
    recovery: c.recovery,
    aliasState: { mayBeAbsent: false, candidates: [a, c] },
    predecessor: b,
    native: c.native,
  };
  await writeFile(
    join(f.options.stateDirectory, "state.json"),
    JSON.stringify(record) + "\n",
  );
  const seen = [];
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async ({ native }) => {
      seen.push(native.generation);
      return native.generation === b.native.generation
        ? { state: "unknown" }
        : exited(native);
    },
    publishProfile: async () =>
      assert.fail("unknown predecessor must not be published"),
    runService: async () => assert.fail("unknown predecessor must not start"),
  });
  assert.equal(result.state, "blocked");
  assert.ok(seen.includes(c.native.generation));
  assert.ok(seen.includes(b.native.generation));
  assert.equal(f.configs.length, 0);
  assert.equal(
    (await lstat(join(f.dir, "current.profile.json"), { bigint: true })).ino,
    (await lstat(a.recovery.profileFile, { bigint: true })).ino,
  );
});

test("a jointly replaced candidate and alias is blocked before a new generation", async (t) => {
  const f = await fixture(t),
    attemptId = randomUUID();
  const dir = join(f.dir, `g${attemptId.replaceAll("-", "")}`);
  await mkdir(dir, { mode: 0o700 });
  const profileFile = join(dir, "p.json"),
    alias = join(f.dir, "current.profile.json");
  await writeFile(profileFile, "original profile\n", { mode: 0o600 });
  await link(profileFile, alias);
  const held = await open(profileFile, "r");
  t.after(() => held.close());
  const info = await held.stat({ bigint: true });
  const recovery = {
    dockerPath: "/usr/bin/docker",
    dockerSha256: "d".repeat(64),
    imageDigest: "sha256:" + "e".repeat(64),
    bridgeRoot: join(dir, "bridge"),
    profileFile,
  };
  const original = {
    attemptId,
    native: f.owner,
    recovery,
    anchor: { dev: info.dev.toString(), ino: info.ino.toString() },
  };
  const bootId = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim();
  const record = {
    version: 1,
    deploymentId: f.options.deploymentId,
    phase: "ended",
    attemptId,
    bootId,
    managerPid: process.pid,
    managerStartTicks: "1",
    configSha256: "a".repeat(64),
    recovery,
    native: f.owner,
    aliasState: { mayBeAbsent: false, candidates: [original] },
  };
  await writeFile(
    join(f.options.stateDirectory, "state.json"),
    JSON.stringify(record) + "\n",
  );
  await rm(alias);
  await rm(profileFile);
  await writeFile(profileFile, "unrelated replacement\n", { mode: 0o600 });
  await link(profileFile, alias);
  const result = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => exited(f.owner),
    publishProfile: async () =>
      assert.fail("replacement must never be published"),
    runService: async () => assert.fail("replacement must never start"),
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
  assert.equal(f.configs.length, 0);
  assert.equal(await readFile(alias, "utf8"), "unrelated replacement\n");
});

test("legacy records without a persisted inode anchor always fail closed", async (t) => {
  for (const match of [true, false]) {
    const f = await fixture(t),
      attemptId = randomUUID();
    const dir = join(f.dir, `g${attemptId.replaceAll("-", "")}`);
    await mkdir(dir, { mode: 0o700 });
    const profileFile = join(dir, "p.json"),
      alias = join(f.dir, "current.profile.json");
    await writeFile(profileFile, "old profile\n", { mode: 0o600 });
    if (match) await link(profileFile, alias);
    else await writeFile(alias, "other profile\n", { mode: 0o600 });
    const bootId = (
      await readFile("/proc/sys/kernel/random/boot_id", "utf8")
    ).trim();
    const record = {
      version: 1,
      deploymentId: f.options.deploymentId,
      phase: "ended",
      attemptId,
      bootId,
      managerPid: process.pid,
      managerStartTicks: "1",
      configSha256: "a".repeat(64),
      recovery: {
        dockerPath: "/usr/bin/docker",
        dockerSha256: "d".repeat(64),
        imageDigest: "sha256:" + "e".repeat(64),
        bridgeRoot: join(dir, "bridge"),
        profileFile,
      },
      native: f.owner,
    };
    await writeFile(
      join(f.options.stateDirectory, "state.json"),
      JSON.stringify(record) + "\n",
    );
    let started = 0;
    const result = await runDesktopSupervisor(f.options, {
      createConfig: f.createConfig,
      inspectPrevious: async () => exited(f.owner),
      publishProfile: async () =>
        assert.fail("no owner is supplied in this fixture"),
      runService: async () => {
        started++;
        return { state: "unknown" };
      },
    });
    assert.equal(result.state, "blocked");
    assert.equal(started, 0);
    assert.equal(result.reasonCode, "DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
    if (!match) assert.equal(await readFile(alias, "utf8"), "other profile\n");
  }
});

test("kernel lease survives helper exit and is released on a real private manager crash", async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL("../src/supervisor-service.mjs", import.meta.url)
    .href;
  const script = `
    import { runDesktopSupervisor } from ${JSON.stringify(moduleUrl)};
    const [stateDirectory,deploymentId,pythonPath,pythonSha256,bridgeRoot,containerId,generation,profileId] = process.argv.slice(1);
    const signal = new AbortController().signal;
    await runDesktopSupervisor({stateDirectory,deploymentId,pythonPath,pythonSha256,signal}, {
      createConfig: async () => ({fingerprint: 'a'.repeat(64), options:{dockerPath:'/usr/bin/docker',dockerSha256:'c'.repeat(64),imageDigest:'sha256:'+'d'.repeat(64),bridgeRoot,profileFile:bridgeRoot+'/profile.json'}}),
      runService: async (_config,{onOwner}) => { await onOwner({containerId,generation,profileId}); process.stdout.write('owned\\n'); setInterval(()=>{},1000); return new Promise(()=>{}); }
    });
  `;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      f.options.stateDirectory,
      f.options.deploymentId,
      pythonPath,
      pythonSha256,
      join(f.dir, "old-bridge"),
      f.owner.containerId,
      f.owner.generation,
      f.owner.profileId,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const output = await waitForChildOutput(child);
  assert.match(output, /owned/);
  const busy = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    runService: async () => assert.fail("live owner"),
  });
  assert.equal(busy.state, "already_running");
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
  let inspections = 0;
  const blocked = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => {
      inspections++;
      return { state: "running" };
    },
    runService: async () => assert.fail("live native must remain alone"),
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(inspections, 1);
  assert.equal(f.configs.length, 0);
  const restarted = await runDesktopSupervisor(f.options, {
    createConfig: f.createConfig,
    inspectPrevious: async () => exited(f.owner),
    runService: async (_config, { onOwner }) => {
      await onOwner({ ...f.owner, generation: randomUUID() });
      return { state: "native_exited", nativeState: "exited" };
    },
  });
  assert.equal(restarted.state, "native_exited");
  assert.equal(f.configs.length, 1);
});

// These exercise the actual alias file/inode and kill only a test-owned Node
// manager. The fake owners never start Docker, native processes, or tasks.
for (const initial of [false, true])
  for (const interruption of ["before", "after"]) {
    test(`recover a ${initial ? "first publication" : "replacement"} crash ${interruption} the actual alias change`, async (t) => {
      const f = await fixture(t);
      const ownerA = {
        containerId: "a".repeat(64),
        generation: randomUUID(),
        profileId: randomUUID(),
      };
      const ownerB = {
        containerId: "b".repeat(64),
        generation: randomUUID(),
        profileId: randomUUID(),
      };
      const ownerC = {
        containerId: "c".repeat(64),
        generation: randomUUID(),
        profileId: randomUUID(),
      };
      const makeConfig = async ({ attemptId }) => {
        const generationDir = join(f.dir, `g${attemptId.replaceAll("-", "")}`);
        await mkdir(generationDir, { mode: 0o700 });
        return {
          fingerprint: createHash("sha256").update(attemptId).digest("hex"),
          options: {
            dockerPath: "/usr/bin/docker",
            dockerSha256: "d".repeat(64),
            imageDigest: "sha256:" + "e".repeat(64),
            bridgeRoot: join(generationDir, "bridge"),
            profileFile: join(generationDir, "p.json"),
          },
        };
      };
      const writeOwnedProfile = async (config, owner) => {
        const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
        const ticks = stat
          .slice(stat.lastIndexOf(") ") + 2)
          .trim()
          .split(/\s+/)[19];
        await writeFile(
          config.options.profileFile,
          JSON.stringify({
            version: 1,
            id: owner.profileId,
            generation: owner.generation,
            pid: process.pid,
            startTicks: ticks,
            uid: process.getuid(),
            macAsarPath: "/fixture/mac.asar",
            macAsarSha256: "1".repeat(64),
            linuxAsarPath: "/fixture/linux.asar",
            linuxAsarSha256: "2".repeat(64),
            controlSocketPath: "/fixture/control.sock",
          }) + "\n",
          { mode: 0o600 },
        );
      };
      let previousForC, configA;
      const publish = async ({
        config,
        identity,
        previous,
        attemptId,
        verifyLease,
      }) => {
        previousForC = previous;
        return publishStableProfileAlias({
          deploymentRoot: f.dir,
          current: {
            attemptId,
            file: config.options.profileFile,
            profileId: identity.profileId,
            generation: identity.generation,
          },
          previousAttemptId:
            previous.phase === "ready" ? undefined : previous.attemptId,
          verifyLease,
        });
      };
      if (!initial) {
        const first = await runDesktopSupervisor(f.options, {
          createConfig: makeConfig,
          publishProfile: publish,
          runService: async (config, { onOwner }) => {
            configA = config;
            await writeOwnedProfile(config, ownerA);
            await onOwner(ownerA);
            return { state: "native_exited", nativeState: "exited" };
          },
        });
        assert.equal(first.state, "native_exited");
      }
      const moduleUrl = new URL(
        "../src/supervisor-service.mjs",
        import.meta.url,
      ).href;
      const aliasUrl = new URL(
        "../src/stable-profile-alias.mjs",
        import.meta.url,
      ).href;
      const script = `
      import { runDesktopSupervisor } from ${JSON.stringify(moduleUrl)};
      import { publishStableProfileAlias } from ${JSON.stringify(aliasUrl)};
      import { mkdir,writeFile,readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { createHash } from 'node:crypto';
      const [stateDirectory,deploymentId,pythonPath,pythonSha256,root,when,containerId,generation,profileId] = process.argv.slice(1);
      const identity = {containerId,generation,profileId};
      await runDesktopSupervisor({stateDirectory,deploymentId,pythonPath,pythonSha256,signal:new AbortController().signal}, {
        createConfig: async ({attemptId}) => { const dir=join(root,'g'+attemptId.replaceAll('-','')); await mkdir(dir,{mode:0o700}); return {fingerprint:createHash('sha256').update(attemptId).digest('hex'),options:{dockerPath:'/usr/bin/docker',dockerSha256:'d'.repeat(64),imageDigest:'sha256:'+'e'.repeat(64),bridgeRoot:join(dir,'bridge'),profileFile:join(dir,'p.json')}}; },
        inspectPrevious: async ({native}) => ({state:'exited',...native}),
        publishProfile: async ({config,identity,previous,attemptId,verifyLease}) => {
          if (when === 'after') await publishStableProfileAlias({deploymentRoot:root,current:{attemptId,file:config.options.profileFile,profileId:identity.profileId,generation:identity.generation},previousAttemptId:previous.phase==='ready'?undefined:previous.attemptId,verifyLease});
          process.stdout.write('INTERRUPT\\n'); setInterval(()=>{},1000); await new Promise(()=>{});
        },
        runService: async (config,{onOwner}) => {
          const stat=await readFile('/proc/self/stat','utf8'); const ticks=stat.slice(stat.lastIndexOf(') ')+2).trim().split(/\\s+/)[19];
          await writeFile(config.options.profileFile,JSON.stringify({version:1,id:identity.profileId,generation:identity.generation,pid:process.pid,startTicks:ticks,uid:process.getuid(),macAsarPath:'/fixture/mac.asar',macAsarSha256:'1'.repeat(64),linuxAsarPath:'/fixture/linux.asar',linuxAsarSha256:'2'.repeat(64),controlSocketPath:'/fixture/control.sock'})+'\\n',{mode:0o600});
          await onOwner(identity); return {state:'native_exited',nativeState:'exited'};
        }
      });
    `;
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          f.options.stateDirectory,
          f.options.deploymentId,
          pythonPath,
          pythonSha256,
          f.dir,
          interruption,
          ownerB.containerId,
          ownerB.generation,
          ownerB.profileId,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      });
      const output = await waitForChildOutput(child);
      assert.match(output, /INTERRUPT/);
      const ended = once(child, "exit");
      child.kill("SIGKILL");
      await ended;
      const recorded = JSON.parse(
        await readFile(join(f.options.stateDirectory, "state.json"), "utf8"),
      );
      assert.equal(recorded.native.generation, ownerB.generation);
      const alias = join(f.dir, "current.profile.json");
      if (initial && interruption === "before")
        await assert.rejects(lstat(alias), { code: "ENOENT" });
      else {
        const source =
          interruption === "before"
            ? configA.options.profileFile
            : recorded.recovery.profileFile;
        assert.equal(
          (await lstat(alias, { bigint: true })).ino,
          (await lstat(source, { bigint: true })).ino,
        );
      }
      let started = 0,
        seen = [];
      const blocked = await runDesktopSupervisor(f.options, {
        createConfig: async (...args) => {
          started++;
          return makeConfig(...args);
        },
        inspectPrevious: async ({ native }) => {
          seen.push(native.generation);
          return native.generation ===
            (initial ? ownerB.generation : ownerA.generation)
            ? { state: "running" }
            : exited(native);
        },
        publishProfile: publish,
        runService: async () =>
          assert.fail("an unknown candidate must not start a new owner"),
      });
      assert.equal(blocked.state, "blocked");
      assert.equal(started, 0);
      if (!initial) {
        const newOwnerBlocked = await runDesktopSupervisor(f.options, {
          createConfig: async (...args) => {
            started++;
            return makeConfig(...args);
          },
          inspectPrevious: async ({ native }) =>
            native.generation === ownerB.generation
              ? { state: "running" }
              : exited(native),
          publishProfile: publish,
          runService: async () =>
            assert.fail("active new owner must not start another"),
        });
        assert.equal(newOwnerBlocked.state, "blocked");
        assert.equal(started, 0);
      }
      seen = [];
      let configC;
      const recovered = await runDesktopSupervisor(f.options, {
        createConfig: makeConfig,
        inspectPrevious: async ({ native }) => {
          seen.push(native.generation);
          return exited(native);
        },
        publishProfile: publish,
        runService: async (config, { onOwner }) => {
          configC = config;
          await writeOwnedProfile(config, ownerC);
          await onOwner(ownerC);
          return { state: "native_exited", nativeState: "exited" };
        },
      });
      assert.equal(recovered.state, "native_exited");
      if (!initial) assert.ok(seen.includes(ownerA.generation));
      assert.ok(seen.includes(ownerB.generation));
      if (initial && interruption === "before")
        assert.equal(previousForC.phase, "ready");
      else
        assert.equal(
          previousForC.native.generation,
          interruption === "before" ? ownerA.generation : ownerB.generation,
        );
      assert.equal(
        (await lstat(alias, { bigint: true })).ino,
        (await lstat(configC.options.profileFile, { bigint: true })).ino,
      );
    });
  }
