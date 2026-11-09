import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reattachContainerDesktopService, startContainerDesktopService } from "../src/container-host-service.mjs";
import { encodeWireValue } from "../src/wire-value.mjs";
import { randomUUID } from "node:crypto";
import { runAuthorizedContainerBatch } from "../src/container-write-guard.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "container-manager-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceRoot = join(dir, "source"),
    bridgeRoot = join(dir, "bridge"),
    runtimeRoot = join(dir, "runtime"),
    state = join(dir, "state");
  await mkdir(join(sourceRoot, "resources"), { recursive: true, mode: 0o700 });
  await mkdir(bridgeRoot, { mode: 0o700 });
  await mkdir(state, { mode: 0o700 });
  const macAsarPath = join(dir, "mac.asar");
  await writeFile(macAsarPath, "fixture", { mode: 0o600 });
  const events = [],
    listeners = new Set(),
    sent = [];
  let published = false,
    profile,
    beforeLink,
    detached = false,
    brokerOptions,
    upstreamOptions,
    verifyGate,
    unavailable;
  const upstream = {
    send: async (encoded, control) => {
      if (control.signal.aborted || performance.now() >= control.deadline)
        throw Error("cancelled");
      control.onDispatch();
      sent.push(encoded);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const container = {
    upstream,
    verifyIdentity: async () => true,
    disconnectTransport: async () => {
      events.push("detach");
      detached = true;
    },
    nativeExited: new Promise(() => {}),
    onUnavailable: (fn) => {
      unavailable = fn;
      return () => {
        unavailable = undefined;
      };
    },
  };
  Object.defineProperty(container, "containerId", { value: "a".repeat(64) });
  const deps = {
    openArchive: async () => {
      events.push("mac-open");
      return { close: async () => events.push("mac-close") };
    },
    startUpstream: async (options) => {
      events.push("upstream");
      upstreamOptions = options;
      return container;
    },
    createBroker: async (options) => {
      events.push("broker");
      brokerOptions = options;
      assert.equal(await options.verifyIdentity(), true);
      return { close: async () => events.push("broker-close") };
    },
    makePublisher: (options, checks) => {
      events.push("publisher");
      profile = options.profile;
      beforeLink = checks.beforeLink;
      return {
        get published() {
          return published;
        },
        get mayHavePublished() {
          return published;
        },
        async publish() {
          events.push("publish");
          assert.equal(await beforeLink(), true);
          published = true;
        },
        async verify() {
          events.push("verify");
          if (verifyGate) {
            verifyGate.reached();
            await verifyGate.wait;
          }
          return published;
        },
        async revoke() {
          events.push("revoke");
          published = false;
        },
      };
    },
  };
  const options = {
    imageDigest: "sha256:" + "0".repeat(64),
    sourceRoot,
    runtimeRoot,
    bridgeRoot,
    cpuId: 0,
    macAsarPath,
    macAsarSha256: "1".repeat(64),
    profileFile: join(state, "profile"),
    controlSocketPath: join(state, "socket"),
    dockerPath: "/usr/bin/docker",
    dockerSha256: "2".repeat(64),
    pythonPath: "/usr/bin/python3.12",
    pythonSha256: "3".repeat(64),
    nodePath: process.execPath,
    nodeSha256: "4".repeat(64),
  };
  return {
    options,
    deps,
    events,
    sent,
    get profile() {
      return profile;
    },
    get upstreamOptions() {
      return upstreamOptions;
    },
    get detached() {
      return detached;
    },
    setVerifyGate(value) {
      verifyGate = value;
    },
    setContainerVerify(verify) {
      container.verifyIdentity = verify;
    },
    checkIdentity() {
      return brokerOptions.verifyIdentity();
    },
    dispatch(
      frame,
      control = {
        signal: new AbortController().signal,
        deadline: performance.now() + 5000,
        onDispatch: () => {},
      },
    ) {
      return brokerOptions.upstream.send(encodeWireValue(frame), control);
    },
    triggerUnavailable() {
      unavailable();
    },
    enableBatch(verify = async () => true) {
      upstream.sendBatch = (entries) =>
        runAuthorizedContainerBatch(entries, verify, (batch) =>
          batch.map((entry) => () => {
            sent.push(entry.encoded);
            return Promise.resolve();
          }),
        );
    },
    dispatchBatch(frames, controls) {
      return brokerOptions.upstream.sendBatch(
        frames.map((frame, index) => ({
          encoded: encodeWireValue(frame),
          signal: controls?.[index]?.signal ?? new AbortController().signal,
          deadline: controls?.[index]?.deadline ?? performance.now() + 5000,
          onDispatch: controls?.[index]?.onDispatch ?? (() => {}),
        })),
      );
    },
    get batchAvailable() {
      return typeof brokerOptions.upstream.sendBatch === "function";
    },
  };
}

test("reattaching publishes a new broker for the exact existing native identity", async (t) => {
  const f = await fixture(t), containerId = "a".repeat(64), profileId = randomUUID(), generation = randomUUID();
  const proc = (pid, ppid, ns) => ({ pid, ppid, uid: 1000, ticks: String(pid), nspids: [pid, ns], cpus: "1", noNewPrivs: "1", seccomp: "2", capEff: "0000000000000000", cgroup: `0::/system.slice/docker-${containerId}.scope`, pidns: "pid:[42]", mntns: "mnt:[43]" });
  const identity = { version: 1, containerId, profileId, generation, bootId: randomUUID(),
    configSha256: "b".repeat(64), filesSha256: "c".repeat(64), account: { kind: "anonymous", binding: null }, projects: [],
    processes: { init: proc(101, 1, 1), bridge: proc(102, 101, 2), node: proc(103, 102, 3), native: proc(104, 103, 4) } };
  const original = f.deps.startUpstream;
  let supplied;
  f.deps.startUpstream = async (options, context) => { supplied = context; return original(options); };
  const service = await reattachContainerDesktopService(f.options, { identity, configSha256: identity.configSha256 }, f.deps);
  assert.equal(f.profile.id, profileId);
  assert.equal(f.profile.generation, generation);
  assert.equal(service.containerId, containerId);
  assert.equal(supplied.identity.containerId, containerId);
  await service.close();
});

test("batch capability is exposed only for a supporting native, with one host verification and immutable downstream membership", async (t) => {
  const legacy = await fixture(t),
    old = await startContainerDesktopService(legacy.options, legacy.deps);
  assert.equal(legacy.batchAvailable, false);
  await old.close();
  const f = await fixture(t);
  let downstreamChecks = 0;
  f.enableBatch(async () => {
    downstreamChecks++;
    return true;
  });
  const service = await startContainerDesktopService(f.options, f.deps);
  const count = f.events.filter((event) => event === "verify").length;
  const viewId = randomUUID(),
    frames = Array.from({ length: 8 }, (_, index) => ({
      v: 1,
      type: "portPost",
      scope: {
        profileId: f.profile.id,
        generation: f.profile.generation,
        viewId,
      },
      seq: index + 1,
      id: index + 1,
      portId: "app-host-1",
      data: index,
    }));
  await f.dispatchBatch(frames);
  assert.equal(f.batchAvailable, true);
  assert.equal(downstreamChecks, 1);
  assert.equal(
    f.events.filter((event) => event === "verify").length - count,
    1,
  );
  assert.equal(f.sent.length, 8);
  await service.close();
});

test("each host batch leaves the full native identity check at the final downstream write boundary", async (t) => {
  const f = await fixture(t);
  let earlyChecks = 0,
    finalChecks = 0,
    nativeValid = true;
  const verify = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return nativeValid;
  };
  f.setContainerVerify(async () => {
    earlyChecks++;
    return verify();
  });
  f.enableBatch(async () => {
    finalChecks++;
    return verify();
  });
  const service = await startContainerDesktopService(f.options, f.deps);
  earlyChecks = 0;
  assert.equal(await f.checkIdentity(), true);
  assert.equal(earlyChecks, 1, "broker checks still verify native identity");
  earlyChecks = 0;
  const viewId = randomUUID(),
    frame = (seq) => ({
      v: 1,
      type: "portPost",
      scope: {
        profileId: f.profile.id,
        generation: f.profile.generation,
        viewId,
      },
      seq,
      id: seq,
      portId: "fixture",
      data: null,
    }),
    start = performance.now();
  for (let index = 0; index < 32; index += 8)
    await f.dispatchBatch(
      Array.from({ length: 8 }, (_, offset) => frame(index + offset + 1)),
    );
  t.diagnostic(
    `32 frames in four batches, ${earlyChecks} early native checks, ${finalChecks} final native checks, ${Math.round(performance.now() - start)}ms at 20ms per check`,
  );
  assert.equal(earlyChecks, 0, "no duplicate native check before final guard");
  assert.equal(finalChecks, 4, "every fixed batch gets a fresh final guard");
  assert.equal(f.sent.length, 32);
  nativeValid = false;
  await assert.rejects(f.dispatchBatch([frame(33)]), {
    code: "CONTAINER_IDENTITY_CHANGED",
  });
  assert.equal(f.sent.length, 32, "failed final verification never writes");
  await service.close();
});

test("a host batch still rejects replaced Mac authority before native dispatch", async (t) => {
  const f = await fixture(t);
  let finalChecks = 0;
  f.enableBatch(async () => {
    finalChecks++;
    return true;
  });
  const service = await startContainerDesktopService(f.options, f.deps);
  await writeFile(f.options.macAsarPath, "changed Mac fixture");
  await assert.rejects(
    f.dispatchBatch([
      {
        v: 1,
        type: "portPost",
        scope: {
          profileId: f.profile.id,
          generation: f.profile.generation,
          viewId: randomUUID(),
        },
        seq: 1,
        id: 1,
        portId: "fixture",
        data: null,
      },
    ]),
    { code: "CONTAINER_HOST_IDENTITY_CHANGED" },
  );
  assert.equal(finalChecks, 0);
  assert.equal(f.sent.length, 0);
  await service.close();
});

test("host batch retirement during final native verification cannot dispatch even its first frame", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    reached = new Promise((resolve) => {
      entered = resolve;
    });
  f.enableBatch(async () => {
    entered();
    await gate;
    return true;
  });
  const service = await startContainerDesktopService(f.options, f.deps);
  const viewId = randomUUID(),
    frames = [1, 2].map((seq) => ({
      v: 1,
      type: "portPost",
      scope: {
        profileId: f.profile.id,
        generation: f.profile.generation,
        viewId,
      },
      seq,
      id: seq,
      portId: "app-host-1",
      data: seq,
    }));
  const operation = f.dispatchBatch(frames);
  const rejected = assert.rejects(operation, {
    code: "CONTAINER_HOST_IDENTITY_CHANGED",
  });
  await reached;
  await service.close();
  release();
  await rejected;
  assert.equal(f.sent.length, 0);
});

test("host batch forbids lifecycle, changed scope, mixed views and expired controls before native writes", async (t) => {
  const f = await fixture(t);
  f.enableBatch();
  const service = await startContainerDesktopService(f.options, f.deps);
  const frame = {
    v: 1,
    type: "portPost",
    scope: {
      profileId: f.profile.id,
      generation: f.profile.generation,
      viewId: randomUUID(),
    },
    seq: 1,
    id: 1,
    portId: "app-host-1",
    data: null,
  };
  for (const frames of [
    [{ ...frame, type: "destroyView" }],
    [{ ...frame, scope: { ...frame.scope, generation: randomUUID() } }],
    [
      frame,
      { ...frame, seq: 2, scope: { ...frame.scope, viewId: randomUUID() } },
    ],
  ])
    await assert.rejects(f.dispatchBatch(frames));
  await assert.rejects(
    f.dispatchBatch(
      [frame],
      [
        {
          signal: new AbortController().signal,
          deadline: performance.now() - 1,
          onDispatch() {},
        },
      ],
    ),
  );
  assert.equal(f.sent.length, 0);
  await service.close();
});

test("explicit account and bridge options stay server-side and reach the isolated upstream", async (t) => {
  const f = await fixture(t);
  const homeRoot = await mkdtemp("/dev/shm/chatgpt-host-home-");
  t.after(() => rm(homeRoot, { recursive: true, force: true }));
  const sourceFile = join(f.options.bridgeRoot, "..", "auth.json");
  f.options.networkMode = "bridge";
  f.options.accountSnapshot = { sourceFile, homeRoot };
  const service = await startContainerDesktopService(f.options, f.deps);
  try {
    assert.equal(f.upstreamOptions.networkMode, "bridge");
    assert.deepEqual(f.upstreamOptions.accountSnapshot, {
      sourceFile,
      homeRoot,
    });
    assert.equal(JSON.stringify(f.profile).includes(sourceFile), false);
    assert.equal(JSON.stringify(f.profile).includes(homeRoot), false);
  } finally {
    await service.close();
  }
});

test("finite server memory selection defaults to 2048 and reaches the exact upstream without entering the public profile", async (t) => {
  for (const memoryLimitMiB of [undefined, 2048, 4096, 8192]) {
    const f = await fixture(t);
    if (memoryLimitMiB !== undefined) f.options.memoryLimitMiB = memoryLimitMiB;
    const service = await startContainerDesktopService(f.options, f.deps);
    try {
      assert.equal(f.upstreamOptions.memoryLimitMiB, memoryLimitMiB ?? 2048);
      assert.equal(Object.hasOwn(f.profile, "memoryLimitMiB"), false);
    } finally {
      await service.close();
    }
  }
});

test("finite server process selection defaults to 256 and stays private while reaching the upstream", async (t) => {
  for (const pidsLimit of [undefined, 256, 512]) {
    const f = await fixture(t);
    if (pidsLimit !== undefined) f.options.pidsLimit = pidsLimit;
    const service = await startContainerDesktopService(f.options, f.deps);
    try {
      assert.equal(f.upstreamOptions.pidsLimit, pidsLimit ?? 256);
      assert.equal(Object.hasOwn(f.profile, "pidsLimit"), false);
    } finally {
      await service.close();
    }
  }
});

test("history is server-selected, private, and cannot overlap protected host paths", async (t) => {
  const f = await fixture(t),
    historyRoot = resolve(f.options.bridgeRoot, "..", "history");
  f.options.historyRoot = historyRoot;
  const service = await startContainerDesktopService(f.options, f.deps);
  assert.equal(f.upstreamOptions.historyRoot, historyRoot);
  assert.equal(Object.hasOwn(f.profile, "historyRoot"), false);
  await service.close();
  for (const select of [
    (o) => o.bridgeRoot,
    (o) => o.macAsarPath,
    (o) => resolve(o.profileFile, ".."),
    () => "/tmp/bad,root",
    () => "relative",
  ]) {
    const bad = await fixture(t);
    bad.options.historyRoot = select(bad.options);
    await assert.rejects(startContainerDesktopService(bad.options, bad.deps));
  }
  const getter = await fixture(t);
  let read = false;
  Object.defineProperty(getter.options, "historyRoot", {
    enumerable: true,
    get() {
      read = true;
      return historyRoot;
    },
  });
  await assert.rejects(
    startContainerDesktopService(getter.options, getter.deps),
    { code: "CONTAINER_HOST_INVALID_CONFIG" },
  );
  assert.equal(read, false);
});

test("unsupported process budgets and getters fail before archive or container startup", async (t) => {
  for (const pidsLimit of [null, 0, 128, 257, 1024, "512", false, {}]) {
    const f = await fixture(t);
    f.options.pidsLimit = pidsLimit;
    await assert.rejects(startContainerDesktopService(f.options, f.deps), {
      code: "CONTAINER_HOST_INVALID_CONFIG",
    });
    assert.deepEqual(f.events, []);
  }
  const f = await fixture(t);
  let called = false;
  Object.defineProperty(f.options, "pidsLimit", {
    enumerable: true,
    get() {
      called = true;
      return 512;
    },
  });
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  assert.equal(called, false);
  assert.deepEqual(f.events, []);
});

test("unsupported memory budgets and getters fail before archive or container startup", async (t) => {
  for (const memoryLimitMiB of [
    null,
    0,
    1024,
    3072,
    16384,
    "4096",
    false,
    {},
  ]) {
    const f = await fixture(t);
    f.options.memoryLimitMiB = memoryLimitMiB;
    await assert.rejects(startContainerDesktopService(f.options, f.deps), {
      code: "CONTAINER_HOST_INVALID_CONFIG",
    });
    assert.deepEqual(f.events, []);
  }
  const f = await fixture(t);
  let called = false;
  Object.defineProperty(f.options, "memoryLimitMiB", {
    enumerable: true,
    get() {
      called = true;
      return 4096;
    },
  });
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  assert.equal(called, false);
  assert.deepEqual(f.events, []);
});

test("account source and tmpfs home cannot overlap public control or other protected paths", async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge";
  f.options.accountSnapshot = {
    sourceFile: f.options.profileFile,
    homeRoot: "/dev/shm",
  };
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_UNSAFE_PATH",
  });
  assert.equal(f.events.includes("upstream"), false);
  f.options.accountSnapshot = {
    sourceFile: join(f.options.bridgeRoot, "..", "auth.json"),
    homeRoot: f.options.bridgeRoot,
  };
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_UNSAFE_PATH",
  });
  assert.equal(f.events.includes("upstream"), false);
});

test("account snapshot fixed failures reach the caller without private details", async (t) => {
  const f = await fixture(t);
  const homeRoot = await mkdtemp("/dev/shm/chatgpt-host-home-");
  t.after(() => rm(homeRoot, { recursive: true, force: true }));
  f.options.networkMode = "bridge";
  f.options.accountSnapshot = {
    sourceFile: join(f.options.bridgeRoot, "..", "auth.json"),
    homeRoot,
  };
  f.deps.startUpstream = async () => {
    throw Object.assign(new Error("private payload"), {
      code: "ACCOUNT_SNAPSHOT_UNSAFE_SOURCE",
    });
  };
  await assert.rejects(
    startContainerDesktopService(f.options, f.deps),
    (error) => {
      assert.equal(error.code, "ACCOUNT_SNAPSHOT_UNSAFE_SOURCE");
      assert.equal(error.message.includes("private payload"), false);
      assert.equal(error.message.includes(homeRoot), false);
      return true;
    },
  );
});

test("publishes manager identity only after native and broker, then revokes before detach", async (t) => {
  const f = await fixture(t),
    service = await startContainerDesktopService(f.options, f.deps);
  assert.equal(Object.hasOwn(f.upstreamOptions, "initialMode"), false);
  assert.equal(f.profile.pid, process.pid);
  assert.equal(f.profile.uid, process.getuid());
  assert.equal(f.profile.id, service.profileId);
  assert.equal(f.profile.generation, service.generation);
  assert.deepEqual(f.events.slice(0, 5), [
    "mac-open",
    "mac-close",
    "upstream",
    "broker",
    "publisher",
  ]);
  assert.ok(f.events.indexOf("publish") > f.events.indexOf("broker"));
  await service.close();
  assert.ok(f.events.indexOf("revoke") < f.events.indexOf("broker-close"));
  assert.ok(f.events.indexOf("broker-close") < f.events.indexOf("detach"));
  assert.equal(f.detached, true);
});

function failFixtureDetach(f, error) {
  const start = f.deps.startUpstream;
  f.deps.startUpstream = async (options) => {
    const container = await start(options),
      detach = container.disconnectTransport;
    container.disconnectTransport = async () => {
      await detach();
      throw error;
    };
    return container;
  };
}

for (const [code, expected] of [
  ["CONTAINER_BUSY", "CONTAINER_HOST_DETACH_BUSY"],
  ["CONTAINER_TIMEOUT", "CONTAINER_HOST_DETACH_TIMEOUT"],
]) {
  test(`detach reports sanitized ${code} without repeating close`, async (t) => {
    const f = await fixture(t);
    failFixtureDetach(f, Object.assign(Error("private payload"), { code }));
    const service = await startContainerDesktopService(f.options, f.deps);
    await assert.rejects(service.close(), (error) => {
      assert.equal(error.code, expected);
      assert.equal(error.message, "Private container host unavailable");
      assert.equal(Object.hasOwn(error, "cause"), false);
      return true;
    });
    assert.equal(f.events.filter((event) => event === "detach").length, 1);
    assert.ok(f.events.indexOf("revoke") < f.events.indexOf("broker-close"));
    assert.ok(f.events.indexOf("broker-close") < f.events.indexOf("detach"));
  });
}

test("unknown detach errors remain generic and code accessors are not evaluated", async (t) => {
  let reads = 0;
  const accessor = Object.defineProperty(Error("private payload"), "code", {
    get() {
      reads++;
      return "CONTAINER_TIMEOUT";
    },
  });
  for (const original of [
    Object.assign(Error("private payload"), { code: "CONTAINER_PRIVATE_PAYLOAD" }),
    accessor,
  ]) {
    const f = await fixture(t);
    failFixtureDetach(f, original);
    const service = await startContainerDesktopService(f.options, f.deps);
    await assert.rejects(service.close(), {
      code: "CONTAINER_HOST_DETACH_FAILED",
      message: "Private container host unavailable",
    });
    assert.equal(f.events.filter((event) => event === "detach").length, 1);
  }
  assert.equal(reads, 0);
});

test("detach reason preserves revocation and broker error priority", async (t) => {
  for (const revokeFails of [true, false]) {
    const f = await fixture(t),
      makePublisher = f.deps.makePublisher,
      createBroker = f.deps.createBroker;
    f.deps.makePublisher = (...args) => {
      const publisher = makePublisher(...args),
        revoke = publisher.revoke;
      publisher.revoke = async () => {
        await revoke();
        if (revokeFails) throw Error("private revoke failure");
      };
      return publisher;
    };
    f.deps.createBroker = async (...args) => {
      const broker = await createBroker(...args);
      return {
        close: async () => {
          await broker.close();
          throw Error("private broker failure");
        },
      };
    };
    failFixtureDetach(f, Object.assign(Error("private payload"), {
      code: "CONTAINER_TIMEOUT",
    }));
    const service = await startContainerDesktopService(f.options, f.deps);
    await assert.rejects(service.close(), {
      code: revokeFails
        ? "CONTAINER_HOST_REVOCATION_FAILED"
        : "CONTAINER_HOST_BROKER_CLOSE_FAILED",
    });
    assert.equal(f.events.filter((event) => event === "detach").length, 1);
  }
});

test("a verification already in flight can finish while explicit close revokes the profile", async (t) => {
  const f = await fixture(t),
    service = await startContainerDesktopService(f.options, f.deps);
  let reach, release;
  const reached = new Promise((done) => {
      reach = done;
    }),
    wait = new Promise((done) => {
      release = done;
    });
  f.setVerifyGate({ reached: reach, wait });
  const checking = f.checkIdentity();
  await reached;
  const closing = service.close();
  await Promise.resolve();
  release();
  assert.equal(await checking, true);
  await closing;
});

test("unknown publication outcome retains native owner and does not stop the container", async (t) => {
  const f = await fixture(t);
  f.deps.makePublisher = () => ({
    published: false,
    mayHavePublished: true,
    async publish() {
      throw Object.assign(Error("private"), {
        code: "PROFILE_PUBLICATION_OUTCOME_UNKNOWN",
      });
    },
    async verify() {
      return false;
    },
    async revoke() {
      f.events.push("revoke-unknown");
    },
  });
  let caught;
  try {
    await startContainerDesktopService(f.options, f.deps);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, "PROFILE_PUBLICATION_OUTCOME_UNKNOWN");
  assert.ok(caught.retainedOwner);
  assert.equal(caught.retainedOwner.containerId, "a".repeat(64));
  assert.ok(f.events.includes("broker-close"));
  assert.ok(f.events.includes("detach"));
});

test("startup preserves the original error chain as a non-enumerable cause without changing its public failure or retained owner", async (t) => {
  const f = await fixture(t), inner = Object.assign(new Error("private inner detail"), { code: "INNER_FIXTURE_FAILURE" });
  const original = Object.assign(new Error("private broker detail", { cause: inner }), { code: "UNLISTED_FIXTURE_FAILURE" });
  f.deps.createBroker = async () => { throw original; };
  await assert.rejects(startContainerDesktopService(f.options, f.deps), error => {
    assert.equal(error.code, "CONTAINER_HOST_UNAVAILABLE");
    assert.equal(error.message, "Private container host unavailable");
    assert.equal(error.cause, original);
    assert.equal(error.cause.cause, inner);
    assert.equal(Object.getOwnPropertyDescriptor(error, "cause").enumerable, false);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), { code: "CONTAINER_HOST_UNAVAILABLE" });
    assert.equal(error.retainedOwner.containerId, "a".repeat(64));
    assert.equal(Object.getOwnPropertyDescriptor(error, "retainedOwner").enumerable, false);
    return true;
  });
  assert.equal(f.events.filter(event => event === "detach").length, 1);
});

test("startup reports a failed revocation even if publication already failed", async (t) => {
  const f = await fixture(t);
  f.deps.makePublisher = () => ({
    published: false,
    mayHavePublished: true,
    async publish() {
      throw Object.assign(Error("private"), {
        code: "PROFILE_PUBLICATION_OUTCOME_UNKNOWN",
      });
    },
    async verify() {
      return false;
    },
    async revoke() {
      throw Object.assign(Error("private"), {
        code: "PROFILE_REVOCATION_FAILED",
      });
    },
  });
  let caught;
  try {
    await startContainerDesktopService(f.options, f.deps);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, "CONTAINER_HOST_REVOCATION_FAILED");
  assert.ok(caught.retainedOwner);
});

test("replacing the pinned Mac archive revokes the session before another native write", async (t) => {
  const f = await fixture(t),
    service = await startContainerDesktopService(f.options, f.deps);
  await writeFile(f.options.macAsarPath, "changed mac fixture");
  assert.equal(await f.checkIdentity(), false);
  await service.close().catch(() => {});
  assert.ok(f.events.includes("revoke"));
  assert.ok(f.events.includes("broker-close"));
});

test("a view arriving after link but before final publication waits and dispatches exactly once", async (t) => {
  const f = await fixture(t);
  let linked,
    release,
    committed = false;
  const linkedPromise = new Promise((done) => {
      linked = done;
    }),
    gate = new Promise((done) => {
      release = done;
    });
  f.deps.makePublisher = (_options, checks) => ({
    get published() {
      return committed;
    },
    get mayHavePublished() {
      return true;
    },
    async publish() {
      assert.equal(await checks.beforeLink(), true);
      linked();
      await gate;
      committed = true;
    },
    async verify() {
      return committed;
    },
    async revoke() {
      committed = false;
    },
  });
  const starting = startContainerDesktopService(f.options, f.deps);
  await linkedPromise;
  const pending = f.dispatch({
    v: 1,
    type: "createView",
    viewId: randomUUID(),
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(f.sent.length, 0);
  release();
  const service = await starting;
  await pending;
  assert.equal(f.sent.length, 1);
  await service.close();
});

test("a pending publication barrier rejects on identity loss without sending native input", async (t) => {
  const f = await fixture(t);
  let linked, release;
  const linkedPromise = new Promise((done) => {
      linked = done;
    }),
    gate = new Promise((done) => {
      release = done;
    });
  f.deps.makePublisher = (_options, checks) => ({
    published: false,
    mayHavePublished: true,
    async publish() {
      assert.equal(await checks.beforeLink(), true);
      linked();
      await gate;
      throw Object.assign(Error("lost"), { code: "PROFILE_IDENTITY_CHANGED" });
    },
    async verify() {
      return false;
    },
    async revoke() {},
  });
  const starting = startContainerDesktopService(f.options, f.deps);
  await linkedPromise;
  const pending = f.dispatch({
    v: 1,
    type: "createView",
    viewId: randomUUID(),
  });
  const rejected = assert.rejects(pending, {
    code: "CONTAINER_HOST_IDENTITY_CHANGED",
  });
  f.triggerUnavailable();
  release();
  await rejected;
  await assert.rejects(starting);
  assert.equal(f.sent.length, 0);
});

for (const cancellation of ["abort", "deadline"])
  test(`the broker ${cancellation} cancels publication waiting without a late dispatch`, async (t) => {
    const f = await fixture(t);
    let linked,
      release,
      committed = false,
      dispatches = 0;
    const linkedPromise = new Promise((done) => {
        linked = done;
      }),
      gate = new Promise((done) => {
        release = done;
      });
    f.deps.makePublisher = (_options, checks) => ({
      get published() {
        return committed;
      },
      get mayHavePublished() {
        return true;
      },
      async publish() {
        assert.equal(await checks.beforeLink(), true);
        linked();
        await gate;
        committed = true;
      },
      async verify() {
        return committed;
      },
      async revoke() {
        committed = false;
      },
    });
    const starting = startContainerDesktopService(f.options, f.deps);
    await linkedPromise;
    const controller = new AbortController();
    const pending = f.dispatch(
      { v: 1, type: "createView", viewId: randomUUID() },
      {
        signal: controller.signal,
        deadline: performance.now() + (cancellation === "deadline" ? 40 : 5000),
        onDispatch: () => {
          dispatches++;
        },
      },
    );
    const rejected = assert.rejects(pending, {
      code: "CONTAINER_WRITE_ABORTED",
    });
    if (cancellation === "abort") controller.abort();
    await rejected;
    release();
    const service = await starting;
    await new Promise((done) => setImmediate(done));
    assert.equal(dispatches, 0);
    assert.equal(f.sent.length, 0);
    await service.close();
  });

test("broker cancellation during profile verification cannot dispatch after verification completes", async (t) => {
  const f = await fixture(t),
    service = await startContainerDesktopService(f.options, f.deps);
  let reach,
    release,
    dispatches = 0;
  const reached = new Promise((done) => {
      reach = done;
    }),
    wait = new Promise((done) => {
      release = done;
    });
  f.setVerifyGate({ reached: reach, wait });
  const controller = new AbortController();
  const pending = f.dispatch(
    { v: 1, type: "createView", viewId: randomUUID() },
    {
      signal: controller.signal,
      deadline: performance.now() + 5000,
      onDispatch: () => {
        dispatches++;
      },
    },
  );
  const rejected = assert.rejects(pending, { code: "CONTAINER_WRITE_ABORTED" });
  await reached;
  controller.abort();
  release();
  await rejected;
  assert.equal(dispatches, 0);
  assert.equal(f.sent.length, 0);
  await service.close();
});

test("closing during verification prevents a still-pending browser frame from dispatching", async (t) => {
  const f = await fixture(t),
    service = await startContainerDesktopService(f.options, f.deps);
  let reach,
    release,
    dispatches = 0;
  const reached = new Promise((done) => {
      reach = done;
    }),
    wait = new Promise((done) => {
      release = done;
    });
  f.setVerifyGate({ reached: reach, wait });
  const pending = f.dispatch(
    { v: 1, type: "createView", viewId: randomUUID() },
    {
      signal: new AbortController().signal,
      deadline: performance.now() + 5000,
      onDispatch: () => {
        dispatches++;
      },
    },
  );
  const rejected = assert.rejects(pending, {
    code: "CONTAINER_HOST_IDENTITY_CHANGED",
  });
  await reached;
  const closing = service.close();
  release();
  await rejected;
  await closing;
  assert.equal(dispatches, 0);
  assert.equal(f.sent.length, 0);
});

test("explicit initial Codex preference is forwarded privately to the new container", async (t) => {
  const f = await fixture(t);
  f.options.initialMode = "codex";
  const service = await startContainerDesktopService(f.options, f.deps);
  try {
    assert.equal(f.upstreamOptions.initialMode, "codex");
    assert.equal(Object.hasOwn(f.profile, "initialMode"), false);
  } finally {
    await service.close();
  }
});

test("initial preference rejects other values and accessors before opening a host", async (t) => {
  for (const value of [null, false, "work", "", {}, ["codex"]]) {
    const f = await fixture(t);
    f.options.initialMode = value;
    await assert.rejects(startContainerDesktopService(f.options, f.deps), {
      code: "CONTAINER_HOST_INVALID_CONFIG",
    });
    assert.equal(f.events.includes("upstream"), false);
  }
  const f = await fixture(t);
  let read = false;
  Object.defineProperty(f.options, "initialMode", {
    enumerable: true,
    get() {
      read = true;
      return "codex";
    },
  });
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  assert.equal(read, false);
});

test("a fixed bridge connection is copied privately and never published in the profile", async (t) => {
  const f = await fixture(t);
  f.options.networkMode = "bridge";
  const input = {
    httpProxy: "http://proxy.test:8123",
    httpsProxy: "http://proxy.test:8123",
    noProxy: "localhost,127.0.0.1",
  };
  f.options.connection = input;
  const service = await startContainerDesktopService(f.options, f.deps);
  try {
    assert.deepEqual(f.upstreamOptions.connection, input);
    assert.notEqual(f.upstreamOptions.connection, input);
    assert.ok(Object.isFrozen(f.upstreamOptions.connection));
    input.httpProxy = "http://other.test:1";
    assert.equal(
      f.upstreamOptions.connection.httpProxy,
      "http://proxy.test:8123",
    );
    assert.equal(Object.hasOwn(f.profile, "connection"), false);
  } finally {
    await service.close();
  }
});

test("fixed connection rejects network none, unknown fields and accessors before opening any host", async (t) => {
  const f = await fixture(t);
  f.options.connection = { httpsProxy: "http://proxy.test:8123" };
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  assert.equal(f.events.length, 0);
  f.options.networkMode = "bridge";
  f.options.connection = {
    httpsProxy: "http://proxy.test:8123",
    feature: "bypass",
  };
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  let read = false;
  Object.defineProperty(f.options, "connection", {
    enumerable: true,
    get() {
      read = true;
      return { httpsProxy: "http://proxy.test:8123" };
    },
  });
  await assert.rejects(startContainerDesktopService(f.options, f.deps), {
    code: "CONTAINER_HOST_INVALID_CONFIG",
  });
  assert.equal(read, false);
  assert.equal(f.events.length, 0);
});

test("fixed owned project roots reach the upstream privately and retain an independent frozen copy", async (t) => {
  const f = await fixture(t),
    root = resolve(f.options.bridgeRoot, "..", "scratch-project");
  await mkdir(root, { mode: 0o775 });
  f.options.projectRoots = [root];
  const service = await startContainerDesktopService(f.options, f.deps);
  try {
    assert.deepEqual(f.upstreamOptions.projectRoots, [root]);
    assert.ok(Object.isFrozen(f.upstreamOptions.projectRoots));
    assert.notEqual(f.upstreamOptions.projectRoots, f.options.projectRoots);
    f.options.projectRoots.length = 0;
    assert.deepEqual(f.upstreamOptions.projectRoots, [root]);
    assert.equal(Object.hasOwn(f.profile, "projectRoots"), false);
  } finally {
    await service.close();
  }
});

test("project roots cannot overlap host-only private paths or evaluate an accessor", async (t) => {
  const f = await fixture(t);
  for (const root of [
    f.options.sourceRoot,
    join(f.options.macAsarPath, ".."),
    join(f.options.profileFile, ".."),
    f.options.bridgeRoot,
  ]) {
    f.options.projectRoots = [resolve(root)];
    await assert.rejects(startContainerDesktopService(f.options, f.deps));
    assert.equal(f.events.length, 0);
  }
  let read = false;
  Object.defineProperty(f.options, "projectRoots", {
    enumerable: true,
    get() {
      read = true;
      return [];
    },
  });
  await assert.rejects(startContainerDesktopService(f.options, f.deps));
  assert.equal(read, false);
});


test("host authority checks the current Mac file synchronously on every verification", async (t) => {
  const f = await fixture(t);
  const service = await startContainerDesktopService(f.options, f.deps);
  t.after(() => service.close());
  const original = fs.lstatSync; let macChecks = 0;
  fs.lstatSync = (path, ...args) => { if (String(path) === f.options.macAsarPath) macChecks++; return original(path, ...args); };
  syncBuiltinESMExports();
  try {
    const start = performance.now();
    for (let n = 0; n < 32; n++) assert.equal(await f.checkIdentity(), true);
    console.log(JSON.stringify({hostChecks:32,macChecks,elapsedMs:performance.now()-start}));
    assert.equal(macChecks, 32);
    await writeFile(f.options.macAsarPath, "changed", {mode:0o600});
    assert.equal(await f.checkIdentity(), false);
  } finally { fs.lstatSync = original; syncBuiltinESMExports(); }
});

test('explicit SSH client publishes its fixed bridge endpoint while control remains outside the bridge',async t=>{
 const f=await fixture(t);f.options.serverSsh=true;
 const service=await startContainerDesktopService(f.options,f.deps);
 try{
  assert.equal(f.upstreamOptions.serverSsh,true);
  assert.equal(f.profile.serverSshSocketPath,join(f.options.bridgeRoot,'server-ssh.sock'));
  assert.equal(f.profile.controlSocketPath,f.options.controlSocketPath);
  assert.equal(f.profile.controlSocketPath.startsWith(f.options.bridgeRoot+'/'),false);
 }finally{await service.close();}
});
