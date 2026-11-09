import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn as spawnFixture } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { startPrivateDesktopService } from "../src/host-service.mjs";
import { connectDesktopControl } from "../src/control-client.mjs";
import { decodeWireValue, encodeWireValue } from "../src/wire-value.mjs";
import { PINNED_LINUX_RUNTIME } from "../src/private-runtime.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function makeArchive() {
  const body = Buffer.from("<main>fixture</main>"),
    digest = hash(body);
  const header = Buffer.from(
    JSON.stringify({
      files: {
        webview: {
          files: {
            "index.html": {
              size: body.length,
              offset: "0",
              integrity: { algorithm: "SHA256", hash: digest },
            },
          },
        },
      },
    }),
  );
  const padded = Math.ceil(header.length / 4) * 4,
    prefix = Buffer.alloc(16 + padded);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + padded, 4);
  prefix.writeUInt32LE(4 + padded, 8);
  prefix.writeUInt32LE(header.length, 12);
  header.copy(prefix, 16);
  return Buffer.concat([prefix, body]);
}
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 61001;
    this.connected = true;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.sent = [];
    this.signals = [];
  }
  send(encoded, callback) {
    const message = decodeWireValue(encoded);
    this.sent.push(message);
    queueMicrotask(() => {
      callback?.(null);
      if (message.type === "createView")
        this.emit(
          "message",
          encodeWireValue({
            v: 1,
            type: "bootstrap",
            scope: {
              profileId: this.profileId,
              generation: this.generation,
              viewId: message.viewId,
            },
            bootstrap: {
              windowType: "electron",
              getters: {},
              sharedObjects: {},
            },
          }),
        );
      if (message.type === "destroyView")
        this.emit(
          "message",
          encodeWireValue({
            v: 1,
            type: "viewClosed",
            scope: {
              profileId: this.profileId,
              generation: this.generation,
              viewId: message.viewId,
            },
          }),
        );
    });
    return true;
  }
  kill(signal) {
    this.signals.push(signal);
    this.exit(null, signal);
    return true;
  }
  exit(code = 0, signal = null) {
    if (!this.connected) return;
    this.connected = false;
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit("exit", code, signal);
      this.emit("disconnect");
    });
  }
}
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "desktop-host-"));
  const sourceRoot = join(dir, "source"),
    runtimeRoot = join(dir, "runtime"),
    controlDir = join(dir, "control"),
    profileDir = join(dir, "profile");
  await mkdir(join(sourceRoot, "resources"), { recursive: true, mode: 0o700 });
  await mkdir(controlDir, { mode: 0o700 });
  await mkdir(profileDir, { mode: 0o700 });
  await writeFile(join(sourceRoot, "ChatGPT"), "fixture executable", {
    mode: 0o700,
  });
  await writeFile(
    join(sourceRoot, "resources", "app.asar"),
    "fixture linux asar",
    { mode: 0o600 },
  );
  const mac = makeArchive(),
    macAsarPath = join(dir, "mac.asar");
  await writeFile(macAsarPath, mac, { mode: 0o600 });
  const controlSocketPath = join(controlDir, "control.sock"),
    profileFile = join(profileDir, "current.json");
  const child = new FakeChild(),
    spawned = [];
  let service,
    nativeTicks = "222",
    prepared = 0,
    ready = true,
    readyPid;
  const inspectProcess = async (pid) => {
    if (pid === process.pid)
      return { uid: process.getuid(), startTicks: "111", state: "S" };
    if (pid === child.pid && child.connected)
      return { uid: process.getuid(), startTicks: nativeTicks, state: "S" };
    throw Error("not an owned process");
  };
  const prepare = async ({ profileId, generation }) => {
    prepared++;
    await mkdir(join(runtimeRoot, "resources"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(runtimeRoot, "home"), { mode: 0o700 });
    await writeFile(join(runtimeRoot, "ChatGPT"), "fixture copy", {
      mode: 0o700,
    });
    await writeFile(join(runtimeRoot, "resources", "app.asar"), "wrapper", {
      mode: 0o600,
    });
    await writeFile(
      join(runtimeRoot, "resources", "private-preload.js"),
      "preload",
      { mode: 0o600 },
    );
    await writeFile(
      join(runtimeRoot, "resources", "private-config.json"),
      "config",
      { mode: 0o600 },
    );
    const home = join(runtimeRoot, "home");
    child.profileId = profileId;
    child.generation = generation;
    return {
      executable: join(runtimeRoot, "ChatGPT"),
      home,
      configPath: join(runtimeRoot, "resources", "private-config.json"),
      profileId,
      generation,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_CACHE_HOME: join(home, ".cache"),
      },
      args: ["--user-data-dir=" + join(home, "user-data")],
    };
  };
  const spawn = (executable, args, options) => {
    spawned.push({ executable, args, options });
    if (ready)
      queueMicrotask(() =>
        child.emit(
          "message",
          encodeWireValue({
            v: 1,
            type: "ready",
            profileId: child.profileId,
            generation: child.generation,
            pid: readyPid ?? child.pid,
          }),
        ),
      );
    return child;
  };
  const options = {
    sourceRoot,
    macAsarPath,
    macAsarSha256: hash(mac),
    runtimeRoot,
    controlSocketPath,
    profileFile,
    prepare,
    spawn,
    inspectProcess,
    startupTimeoutMs: 1000,
    ...overrides,
  };
  t.after(async () => {
    await service?.close().catch(() => {});
    child.exit();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    sourceRoot,
    runtimeRoot,
    controlSocketPath,
    profileFile,
    child,
    spawned,
    options,
    start: async () => (service = await startPrivateDesktopService(options)),
    setNativeTicks: (value) => {
      nativeTicks = value;
    },
    setReady: (value) => {
      ready = value;
    },
    setReadyPid: (value) => {
      readyPid = value;
    },
    get prepared() {
      return prepared;
    },
  };
}

test("publishes the manager identity only after native readiness and revokes without killing native", async (t) => {
  const poison = {
    NODE_OPTIONS: "--require=/tmp/forbidden-node-options",
    LD_PRELOAD: "/tmp/forbidden-library",
    LD_LIBRARY_PATH: "/tmp/forbidden-libraries",
    ELECTRON_RENDERER_URL: "https://invalid.example",
    CODEX_HOME: "/tmp/forbidden-codex-home",
    SSH_AUTH_SOCK: "/tmp/forbidden-ssh-socket",
  };
  const prior = Object.fromEntries(
    Object.keys(poison).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, poison);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const f = await fixture(t, {
    display: ":99",
    lang: "C.UTF-8",
    nodeUseEnvProxy: "0",
  });
  const service = await f.start();
  const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
  assert.equal(profile.pid, process.pid);
  assert.equal(profile.startTicks, "111");
  assert.equal(profile.id, service.profileId);
  assert.equal(profile.generation, service.generation);
  assert.equal(profile.linuxAsarSha256, PINNED_LINUX_RUNTIME.asarSha256);
  assert.equal((await lstat(f.profileFile)).mode & 0o7777, 0o600);
  const launch = f.spawned[0];
  assert.equal(launch.executable, join(f.runtimeRoot, "ChatGPT"));
  assert.equal(launch.options.cwd, f.runtimeRoot);
  assert.equal(launch.options.shell, false);
  assert.equal(launch.options.stdio[3], "ipc");
  assert.equal(launch.options.env.DISPLAY, ":99");
  assert.equal(launch.options.env.NODE_USE_ENV_PROXY, "0");
  for (const secret of [
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "ELECTRON_RENDERER_URL",
    "CODEX_HOME",
    "SSH_AUTH_SOCK",
  ])
    assert.equal(Object.hasOwn(launch.options.env, secret), false);
  const connection = await connectDesktopControl({
    profile,
    viewId: randomUUID(),
    verifyProfile: async () => true,
  });
  await service.close();
  assert.equal(
    JSON.parse(await readFile(f.profileFile, "utf8")).state,
    "revoked",
  );
  assert.deepEqual(f.child.signals, []);
  assert.equal(f.child.connected, true);
  assert.equal(f.child.sent.filter((x) => x.type === "destroyView").length, 1);
  connection.close();
});

test("retiring during an in-flight publication check preserves exact view cleanup and blocks the queued ordinary call", async (t) => {
  const f = await fixture(t),
    service = await f.start();
  const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
  const connection = await connectDesktopControl({
    profile,
    viewId: randomUUID(),
    verifyProfile: async () => true,
  });
  let release,
    entered = false,
    finished = false,
    destroyed;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    originalStat = fs.promises.lstat,
    originalSend = f.child.send.bind(f.child);
  fs.promises.lstat = async (path, ...args) => {
    if (path === f.profileFile && !entered) {
      entered = true;
      await gate;
      try {
        return await originalStat(path, ...args);
      } finally {
        finished = true;
      }
    }
    return originalStat(path, ...args);
  };
  syncBuiltinESMExports();
  f.child.send = (encoded, callback) => {
    const frame = decodeWireValue(encoded);
    if (frame.type !== "destroyView") return originalSend(encoded, callback);
    f.child.sent.push(frame);
    destroyed = frame;
    queueMicrotask(() => callback?.(null));
    return true;
  };
  let closing;
  try {
    await connection.sendFrame(
      encodeWireValue({
        v: 1,
        type: "call",
        scope: connection.scope,
        seq: 1,
        id: 1,
        method: "getFastModeRolloutMetrics",
        args: [],
      }),
    );
    await waitUntil(() => entered);
    closing = service.close();
    void closing.catch(() => {});
    await waitUntil(() => !!destroyed);
    assert.equal(
      JSON.parse(await readFile(f.profileFile, "utf8")).state,
      "revoked",
    );
    release();
    await waitUntil(() => finished);
    await new Promise((resolve) => setImmediate(resolve));
    f.child.emit(
      "message",
      encodeWireValue({ v: 1, type: "viewClosed", scope: connection.scope }),
    );
    await closing;
    assert.equal(destroyed.viewId, connection.scope.viewId);
    assert.equal(f.child.sent.filter((x) => x.type === "destroyView").length, 1);
    assert.equal(f.child.sent.filter((x) => x.type === "call").length, 0);
    assert.deepEqual(f.child.signals, []);
    assert.equal(f.child.connected, true);
  } finally {
    release();
    fs.promises.lstat = originalStat;
    syncBuiltinESMExports();
    connection.close();
    await closing?.catch(() => {});
  }
});

test("a client arriving after the profile link waits until publication is verified", async (t) => {
  const f = await fixture(t),
    originalLink = fs.promises.link;
  let linked, release;
  const didLink = new Promise((resolve) => {
    linked = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  fs.promises.link = async (source, target) => {
    const result = await originalLink(source, target);
    if (target === f.profileFile) {
      linked();
      await hold;
    }
    return result;
  };
  syncBuiltinESMExports();
  let started, connection;
  try {
    started = f.start();
    await didLink;
    const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
    let settled = false;
    const connecting = connectDesktopControl({
      profile,
      viewId: randomUUID(),
      verifyProfile: async () => true,
      timeoutMs: 1500,
    });
    void connecting.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await delay(120);
    assert.equal(
      settled,
      false,
      "the client must wait for validated publication",
    );
    assert.deepEqual(
      f.child.sent,
      [],
      "nothing reaches native before validation",
    );
    release();
    const service = await started;
    connection = await connecting;
    assert.equal(
      f.child.sent.filter((frame) => frame.type === "createView").length,
      1,
    );
    connection.close();
    await service.close();
    assert.deepEqual(f.child.signals, []);
  } finally {
    release();
    connection?.close();
    await started?.catch(() => {});
    fs.promises.link = originalLink;
    syncBuiltinESMExports();
  }
});

test("native exit releases clients waiting for profile publication without dispatch", async (t) => {
  const f = await fixture(t),
    originalLink = fs.promises.link;
  let linked, release;
  const didLink = new Promise((resolve) => {
    linked = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  fs.promises.link = async (source, target) => {
    const result = await originalLink(source, target);
    if (target === f.profileFile) {
      linked();
      await hold;
    }
    return result;
  };
  syncBuiltinESMExports();
  let started;
  try {
    started = f.start();
    void started.catch(() => {});
    await didLink;
    const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
    const pending = connectDesktopControl({
      profile,
      viewId: randomUUID(),
      verifyProfile: async () => true,
      timeoutMs: 1500,
    });
    void pending.catch(() => {});
    await delay(80);
    f.child.exit();
    await assert.rejects(pending);
    assert.deepEqual(f.child.sent, []);
    release();
    await assert.rejects(started);
    assert.equal(
      JSON.parse(await readFile(f.profileFile, "utf8")).state,
      "revoked",
    );
    assert.deepEqual(f.child.signals, []);
  } finally {
    release();
    await started?.catch(() => {});
    fs.promises.link = originalLink;
    syncBuiltinESMExports();
  }
});

test("invalid original Mac hash and occupied profile fail before preparing or spawning", async (t) => {
  const badHash = await fixture(t);
  badHash.options.macAsarSha256 = "0".repeat(64);
  await assert.rejects(badHash.start(), { code: "HOST_UNAVAILABLE" });
  assert.equal(badHash.prepared, 0);
  assert.deepEqual(badHash.spawned, []);
  const occupied = await fixture(t);
  await writeFile(occupied.profileFile, "foreign", { mode: 0o600 });
  await assert.rejects(occupied.start(), { code: "HOST_PATH_EXISTS" });
  assert.equal(await readFile(occupied.profileFile, "utf8"), "foreign");
  assert.equal(occupied.prepared, 0);
  assert.deepEqual(occupied.spawned, []);
});

test("rejects environment or executable injection instead of accepting extra launch options", async (t) => {
  for (const extra of [
    { env: { CODEX_HOME: "/tmp/foreign" } },
    { NODE_OPTIONS: "--require /tmp/x" },
    { command: "/bin/sh" },
    { args: ["--inspect"] },
    { nodeUseEnvProxy: "true" },
  ]) {
    const f = await fixture(t, extra);
    await assert.rejects(f.start(), { code: "HOST_INVALID_CONFIG" });
    assert.equal(f.prepared, 0);
    assert.deepEqual(f.spawned, []);
  }
});

test("external failure details and unknown error codes are never propagated", async (t) => {
  const f = await fixture(t, {
    prepare: async () => {
      throw Object.assign(new Error("sensitive /private/path"), {
        code: "HOST_/private/path",
      });
    },
  });
  let caught;
  try {
    await f.start();
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, "HOST_UNAVAILABLE");
  assert.equal(caught?.message, "Private desktop host unavailable");
  assert.equal(JSON.stringify(caught).includes("/private/path"), false);
});

test("stdout and stderr errors revoke safely without forwarding native output", async (t) => {
  const f = await fixture(t),
    service = await f.start();
  f.child.stdout.write(Buffer.alloc(1024 * 1024, 0x61));
  f.child.stderr.write(Buffer.alloc(1024 * 1024, 0x62));
  f.child.stderr.emit("error", new Error("private diagnostic text"));
  await waitUntil(async () => {
    try {
      return (
        JSON.parse(await readFile(f.profileFile, "utf8")).state === "revoked"
      );
    } catch {
      return false;
    }
  });
  assert.deepEqual(f.child.signals, []);
  assert.equal(f.child.connected, true);
  await service.close().catch(() => {});
});

test("invalid ready and startup timeout only signal their exact unpublished owned child", async (t) => {
  const wrong = await fixture(t);
  wrong.setReadyPid(wrong.child.pid + 1);
  await assert.rejects(wrong.start(), { code: "HOST_IDENTITY_CHANGED" });
  assert.deepEqual(wrong.child.signals, ["SIGTERM"]);
  assert.equal(
    wrong.child.sent.some((x) => x.type === "createView"),
    false,
  );
  await assert.rejects(lstat(wrong.profileFile), { code: "ENOENT" });
  const slow = await fixture(t, { startupTimeoutMs: 80 });
  slow.setReady(false);
  await assert.rejects(slow.start(), { code: "HOST_READY_TIMEOUT" });
  assert.deepEqual(slow.child.signals, ["SIGTERM"]);
  assert.equal(
    slow.child.sent.some((x) => x.type === "createView"),
    false,
  );
  await assert.rejects(lstat(slow.profileFile), { code: "ENOENT" });
});

test("an exec failure emitting an asynchronous child error fails closed without an uncaught error", async (t) => {
  const f = await fixture(t);
  f.options.spawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() =>
      child.emit("error", new Error("sensitive exec detail")),
    );
    return child;
  };
  await assert.rejects(f.start(), { code: "HOST_LAUNCH_FAILED" });
  await delay(0);
  await assert.rejects(lstat(f.profileFile), { code: "ENOENT" });
});

async function waitUntil(predicate) {
  const until = Date.now() + 2500;
  while (!(await predicate())) {
    if (Date.now() > until) throw Error("condition timeout");
    await delay(10);
  }
}

test("a changed prepared artifact revokes publication before a view can be created", async (t) => {
  const f = await fixture(t),
    service = await f.start();
  const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
  await writeFile(
    join(f.runtimeRoot, "resources", "private-config.json"),
    "changed fixture config",
  );
  await assert.rejects(
    connectDesktopControl({
      profile,
      viewId: randomUUID(),
      verifyProfile: async () => true,
      timeoutMs: 500,
    }),
  );
  await waitUntil(async () => {
    try {
      return (
        JSON.parse(await readFile(f.profileFile, "utf8")).state === "revoked"
      );
    } catch {
      return false;
    }
  });
  assert.equal(
    f.child.sent.some((x) => x.type === "createView"),
    false,
  );
  assert.deepEqual(f.child.signals, []);
  await service.close().catch(() => {});
});

test("close revokes only the originally held profile inode when the public path is replaced", async (t) => {
  const f = await fixture(t),
    service = await f.start();
  const original = join(dirname(f.profileFile), "original.json");
  await rename(f.profileFile, original);
  await writeFile(f.profileFile, "foreign", { mode: 0o600 });
  await service.close();
  assert.equal(await readFile(f.profileFile, "utf8"), "foreign");
  assert.equal(JSON.parse(await readFile(original, "utf8")).state, "revoked");
  assert.deepEqual(f.child.signals, []);
  assert.equal(f.child.connected, true);
});

test("a failed profile revoke is reported and can be retried through the held FD", async (t) => {
  const f = await fixture(t),
    originalOpen = fs.promises.open;
  let failRevoke = true;
  fs.promises.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (typeof args[0] === "string" && args[0].includes(".chatgpt-profile-")) {
      const truncate = handle.truncate.bind(handle);
      handle.truncate = async (...truncateArgs) => {
        if (failRevoke)
          throw Object.assign(new Error("private detail"), { code: "EIO" });
        return truncate(...truncateArgs);
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    const service = await f.start();
    await assert.rejects(service.close(), { code: "HOST_REVOCATION_FAILED" });
    assert.deepEqual(f.child.signals, []);
    assert.equal(f.child.connected, true);
    failRevoke = false;
    await service.close();
    assert.equal(
      JSON.parse(await readFile(f.profileFile, "utf8")).state,
      "revoked",
    );
  } finally {
    fs.promises.open = originalOpen;
    syncBuiltinESMExports();
  }
});

test("native exit revokes the publication and never initiates a restart or signal", async (t) => {
  const f = await fixture(t),
    service = await f.start();
  f.child.exit(42);
  assert.deepEqual(await service.nativeExited, { state: "exited" });
  await waitUntil(async () => {
    try {
      return (
        JSON.parse(await readFile(f.profileFile, "utf8")).state === "revoked"
      );
    } catch {
      return false;
    }
  });
  assert.equal(f.spawned.length, 1);
  assert.deepEqual(f.child.signals, []);
});

test("native exit while the profile hard link is publishing still revokes the published inode", async (t) => {
  const f = await fixture(t),
    originalLink = fs.promises.link;
  let publicationEntered = false;
  fs.promises.link = async (source, target) => {
    const result = await originalLink(source, target);
    if (target === f.profileFile) {
      publicationEntered = true;
      f.child.exit(42);
      await delay(30);
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.start(), { code: "HOST_IDENTITY_CHANGED" });
    assert.equal(publicationEntered, true);
    assert.equal(
      JSON.parse(await readFile(f.profileFile, "utf8")).state,
      "revoked",
    );
    assert.deepEqual(f.child.signals, []);
  } finally {
    fs.promises.link = originalLink;
    syncBuiltinESMExports();
  }
});

test("an unknown profile link outcome revokes the held inode and never signals a possibly published child", async (t) => {
  const f = await fixture(t),
    originalLink = fs.promises.link;
  fs.promises.link = async (source, target) => {
    const result = await originalLink(source, target);
    if (target === f.profileFile)
      throw Object.assign(new Error("simulated lost result"), { code: "EIO" });
    return result;
  };
  syncBuiltinESMExports();
  try {
    let caught;
    try {
      await f.start();
    } catch (error) {
      caught = error;
    }
    assert.equal(caught?.code, "HOST_PUBLICATION_OUTCOME_UNKNOWN");
    assert.ok(caught.retainedOwner);
    assert.equal(
      JSON.parse(await readFile(f.profileFile, "utf8")).state,
      "revoked",
    );
    assert.deepEqual(f.child.signals, []);
    assert.equal(f.child.connected, true);
    f.child.exit(0);
    assert.deepEqual(await caught.retainedOwner.nativeExited, {
      state: "exited",
    });
  } finally {
    fs.promises.link = originalLink;
    syncBuiltinESMExports();
  }
});

test("an unpublished child with changed process identity is never signalled", async (t) => {
  const f = await fixture(t, { startupTimeoutMs: 150 });
  f.setReady(false);
  const started = f.start();
  await waitUntil(() => f.spawned.length === 1);
  await delay(15);
  f.setNativeTicks("333");
  await assert.rejects(started, { code: "HOST_READY_TIMEOUT" });
  assert.deepEqual(f.child.signals, []);
  await assert.rejects(lstat(f.profileFile), { code: "ENOENT" });
});

test("real isolated IPC fixture uses /proc identities and remains alive after service close", async (t) => {
  const f = await fixture(t, { startupTimeoutMs: 5000 });
  delete f.options.inspectProcess;
  let ownedChild;
  const wireUrl = new URL("../src/wire-value.mjs", import.meta.url).href;
  const script = `
    import { encodeWireValue, decodeWireValue } from ${JSON.stringify(wireUrl)};
    const [profileId, generation] = process.argv.slice(1);
    const scope = viewId => ({ profileId, generation, viewId });
    process.on("message", encoded => {
      const frame = decodeWireValue(encoded);
      if (frame.type === "createView") process.send(encodeWireValue({v:1,type:"bootstrap",scope:scope(frame.viewId),
        bootstrap:{windowType:"electron",getters:{},sharedObjects:{}}}));
      if (frame.type === "destroyView") process.send(encodeWireValue({v:1,type:"viewClosed",scope:scope(frame.viewId)}));
    });
    process.send(encodeWireValue({v:1,type:"ready",profileId,generation,pid:process.pid}));
  `;
  f.options.spawn = (_executable, _args, options) => {
    ownedChild = spawnFixture(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script,
        f.child.profileId,
        f.child.generation,
      ],
      options,
    );
    return ownedChild;
  };
  t.after(async () => {
    if (
      ownedChild &&
      ownedChild.exitCode === null &&
      ownedChild.signalCode === null
    ) {
      const finished = new Promise((resolve) =>
        ownedChild.once("exit", resolve),
      );
      ownedChild.kill("SIGTERM");
      await finished;
    }
  });
  const service = await f.start();
  const profile = JSON.parse(await readFile(f.profileFile, "utf8"));
  const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
  assert.equal(profile.pid, process.pid);
  assert.equal(
    profile.startTicks,
    stat
      .slice(stat.lastIndexOf(") ") + 2)
      .trim()
      .split(/\s+/)[19],
  );
  const connection = await connectDesktopControl({
    profile,
    viewId: randomUUID(),
    verifyProfile: async () => true,
  });
  await service.close();
  assert.equal(ownedChild.connected, true);
  assert.equal(ownedChild.exitCode, null);
  assert.equal(ownedChild.signalCode, null);
  assert.equal(
    JSON.parse(await readFile(f.profileFile, "utf8")).state,
    "revoked",
  );
  connection.close();
});
