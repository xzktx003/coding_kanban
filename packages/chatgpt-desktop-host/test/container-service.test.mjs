import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  statfs,
  symlink,
  writeFile,
  readdir,
  readlink,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startContainerDesktopUpstream } from "../src/container-service.mjs";
import * as containerService from "../src/container-service.mjs";
import { parseJsonLines } from "../src/json-lines.mjs";

test("rejects incomplete or arbitrary command container configuration before starting anything", async () => {
  for (const options of [
    {},
    { image: "latest" },
    { command: "/bin/sh" },
    { network: "host" },
    { privileged: true },
    { args: ["--pid=host"] },
    { env: { NODE_OPTIONS: "--require=x" } },
  ]) {
    await assert.rejects(startContainerDesktopUpstream(options), {
      code: "CONTAINER_INVALID_CONFIG",
    });
  }
});

test("fixed peer helper reports kernel peer credentials and relays bounded JSONL", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "container-peer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "sock");
  const server = createServer((socket) =>
    socket.on("data", (chunk) => socket.write(chunk)),
  );
  await new Promise((resolve) => server.listen(path, resolve));
  await chmod(path, 0o600);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const helper = spawn(
    "/usr/bin/python3",
    [
      "-I",
      "-u",
      "-B",
      fileURLToPath(
        new URL("../src/container-peer-helper.py", import.meta.url),
      ),
      path,
    ],
    {
      env: {},
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  t.after(() => {
    if (helper.exitCode === null && helper.signalCode === null)
      helper.kill("SIGTERM");
  });
  const lines = parseJsonLines(helper.stdout, {
    maxLineBytes: 8 * 1024 * 1024,
  });
  const peer = JSON.parse((await lines.next()).value);
  assert.deepEqual(peer, {
    type: "peer",
    pid: process.pid,
    uid: process.getuid(),
    gid: process.getgid(),
  });
  helper.stdin.write('{"type":"fixture","value":"ok"}\n');
  assert.equal((await lines.next()).value, '{"type":"fixture","value":"ok"}');
  const exited = once(helper, "exit");
  helper.stdin.end();
  assert.deepEqual(await exited, [0, null]);
});

test("helper stdin EPIPE reports unavailable without an uncaught manager error or a replay", async () => {
  const moduleUrl = new URL("../src/container-service.mjs", import.meta.url)
    .href;
  const guardUrl = new URL("../src/container-write-guard.mjs", import.meta.url)
    .href;
  const program = `
    import { spawn } from 'node:child_process';
    import { setTimeout as delay } from 'node:timers/promises';
    import * as service from ${JSON.stringify(moduleUrl)};
    import { createInitialGrantAttempt } from ${JSON.stringify(guardUrl)};
    const helper = spawn('/bin/sh', ['-c', 'exec 0<&-; printf ready; sleep 0.3'], { stdio: ['pipe','pipe','ignore'] });
    const exited = new Promise(resolve => helper.once('exit', resolve));
    await new Promise(resolve => helper.stdout.once('data', resolve));
    let unavailable = 0, attempts = 0, callbackCode, retryCode;
    // On the original implementation this fallback accurately leaves stdin
    // without an error listener; EPIPE terminates this isolated manager.
    (service.observeContainerHelperInput ?? (() => {}))(helper.stdin, () => unavailable++);
    const closed = new Promise(resolve => helper.stdin.once('close', resolve));
    const grant = createInitialGrantAttempt();
    const write = () => {
      attempts++;
      return new Promise((resolve, reject) => helper.stdin.write('fixture\\n', error => error ? reject(error) : resolve()));
    };
    try { await grant.send(write); } catch (error) { callbackCode = error.code; }
    await closed;
    await delay(20);
    try { await grant.send(write); } catch (error) { retryCode = error.code; }
    if (callbackCode !== 'EPIPE' || unavailable !== 1 || attempts !== 1 ||
        grant.outcome !== 'unknown' || retryCode !== 'CONTAINER_GRANT_ALREADY_ATTEMPTED' || helper.stdin.listenerCount('error') !== 0)
      process.exitCode = 2;
    await exited;
  `;
  const manager = spawn(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      env: {},
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let errors = "";
  manager.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });
  const [code] = await once(manager, "exit");
  assert.equal(code, 0, `manager must survive EPIPE: ${errors.slice(0, 1000)}`);
});

for (const signal of [undefined, "SIGTERM"]) {
  test(`helper exit is retained before detach after ${signal ?? "normal EOF"}`, async (t) => {
    const helper = spawn(
      process.execPath,
      ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); process.stdout.write('ready');"],
      { env: {}, stdio: ["pipe", "pipe", "ignore"] },
    );
    const actualExit = once(helper, "exit");
    t.after(() => {
      if (helper.exitCode === null && helper.signalCode === null)
        helper.kill("SIGTERM");
    });
    // Capture the production observer at spawn, before any asynchronous revoke
    // or view cleanup. The fallback reproduces the previous late listener.
    const observedExit = containerService.observeContainerHelperExit?.(helper);
    await once(helper.stdout, "data");
    if (signal) helper.kill(signal);
    else helper.stdin.end();
    const expected = await actualExit;
    assert.deepEqual(expected, signal ? [null, signal] : [0, null]);
    // Enter detach only after the exit event has already been delivered.
    helper.stdin.end();
    let timer;
    try {
      await Promise.race([
        observedExit ?? once(helper, "exit"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("detach missed an earlier helper exit")), 150);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}

test("native container bridge refuses direct host launch without a verified container grant", async () => {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../src/container-native.mjs", import.meta.url)),
      randomUUID(),
      randomUUID(),
      "/tmp",
    ],
    {
      env: {},
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  const lines = parseJsonLines(child.stdout, { maxLineBytes: 4096 });
  const result = JSON.parse((await lines.next()).value);
  assert.deepEqual(result, {
    type: "fatal",
    code: "CONTAINER_NATIVE_UNAVAILABLE",
  });
  const exited = once(child, "exit");
  child.stdin.end();
  assert.equal((await exited)[0], 1);
});

test("a pre-existing runtime is rejected before any container or native launch", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "container-runtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceRoot = join(dir, "source"),
    runtimeRoot = join(dir, "runtime"),
    bridgeRoot = join(dir, "bridge");
  await mkdir(join(sourceRoot, "resources"), { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(bridgeRoot, { mode: 0o700 });
  const pythonPath = await realpath("/usr/bin/python3"),
    nodePath = await realpath(process.execPath);
  await assert.rejects(
    startContainerDesktopUpstream({
      imageDigest: "sha256:" + "0".repeat(64),
      profileId: randomUUID(),
      generation: randomUUID(),
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      dockerPath: "/usr/bin/docker",
      dockerSha256: "0".repeat(64),
      pythonPath,
      pythonSha256: "0".repeat(64),
      nodePath,
      nodeSha256: "0".repeat(64),
      cpuId: 0,
    }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
});

test("explicit bridge networking and a private tmpfs account home are accepted only as server configuration", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "container-options-"));
  const tmpfsHome = await mkdtemp("/dev/shm/chatgpt-account-home-");
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(tmpfsHome, { recursive: true, force: true });
  });
  const sourceRoot = join(dir, "source"),
    runtimeRoot = join(dir, "runtime"),
    bridgeRoot = join(dir, "bridge");
  await mkdir(join(sourceRoot, "resources"), { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(bridgeRoot, { mode: 0o700 });
  const sourceFile = join(dir, "auth.json");
  const options = {
    imageDigest: "sha256:" + "0".repeat(64),
    profileId: randomUUID(),
    generation: randomUUID(),
    sourceRoot,
    runtimeRoot,
    bridgeRoot,
    dockerPath: "/usr/bin/docker",
    dockerSha256: "0".repeat(64),
    pythonPath: await realpath("/usr/bin/python3"),
    pythonSha256: "0".repeat(64),
    nodePath: await realpath(process.execPath),
    nodeSha256: "0".repeat(64),
    cpuId: 0,
  };
  const fixedProject = join(dir, "scratch-project");
  await mkdir(fixedProject, { mode: 0o775 });
  await chmod(fixedProject, 0o775);
  await assert.rejects(
    startContainerDesktopUpstream({ ...options, projectRoots: [fixedProject] }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  const projectFds = await Promise.all(
    (await readdir("/proc/self/fd")).map(async (fd) => {
      try {
        return await readlink("/proc/self/fd/" + fd);
      } catch {
        return null;
      }
    }),
  );
  assert.equal(
    projectFds.includes(fixedProject),
    false,
    "a rejected startup releases its held project directory",
  );
  for (const projectRoots of [
    ["relative"],
    ["/tmp"],
    [fixedProject, fixedProject],
  ]) {
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, projectRoots }),
    );
  }
  // A pre-existing runtime proves admission passed without creating Docker or reading credentials.
  await assert.rejects(
    startContainerDesktopUpstream({ ...options, networkMode: "bridge" }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({ ...options, initialMode: "codex" }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  for (const memoryLimitMiB of [2048, 4096, 8192])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, memoryLimitMiB }),
      { code: "CONTAINER_RUNTIME_EXISTS" },
    );
  for (const memoryLimitMiB of [
    null,
    0,
    1024,
    3072,
    16384,
    "4096",
    false,
    {},
    Infinity,
  ])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, memoryLimitMiB }),
      { code: "CONTAINER_INVALID_CONFIG" },
    );
  let memoryRead = false;
  const memoryAccessor = { ...options };
  Object.defineProperty(memoryAccessor, "memoryLimitMiB", {
    enumerable: true,
    get() {
      memoryRead = true;
      return 4096;
    },
  });
  await assert.rejects(startContainerDesktopUpstream(memoryAccessor), {
    code: "CONTAINER_INVALID_CONFIG",
  });
  assert.equal(memoryRead, false);
  for (const pidsLimit of [256, 512])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, pidsLimit }),
      { code: "CONTAINER_RUNTIME_EXISTS" },
    );
  for (const pidsLimit of [null, 0, 128, 257, 1024, "512", false, {}, Infinity])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, pidsLimit }),
      { code: "CONTAINER_INVALID_CONFIG" },
    );
  let pidsRead = false;
  const pidsAccessor = { ...options };
  Object.defineProperty(pidsAccessor, "pidsLimit", {
    enumerable: true,
    get() {
      pidsRead = true;
      return 512;
    },
  });
  await assert.rejects(startContainerDesktopUpstream(pidsAccessor), {
    code: "CONTAINER_INVALID_CONFIG",
  });
  assert.equal(pidsRead, false);
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      historyRoot: join(dir, "history"),
    }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  for (const historyRoot of [null, "relative", "/tmp/bad,root", false, {}])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, historyRoot }),
      { code: "CONTAINER_HISTORY_INVALID_CONFIG" },
    );
  let historyRead = false;
  const historyAccessor = { ...options };
  Object.defineProperty(historyAccessor, "historyRoot", {
    enumerable: true,
    get() {
      historyRead = true;
      return join(dir, "history");
    },
  });
  await assert.rejects(startContainerDesktopUpstream(historyAccessor), {
    code: "CONTAINER_HISTORY_INVALID_CONFIG",
  });
  assert.equal(historyRead, false);
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "bridge",
      connection: { httpsProxy: "http://proxy.test:8123" },
    }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      connection: { httpsProxy: "http://proxy.test:8123" },
    }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  for (const initialMode of [null, false, "work", "", {}, ["codex"]])
    await assert.rejects(
      startContainerDesktopUpstream({ ...options, initialMode }),
      { code: "CONTAINER_INVALID_CONFIG" },
    );
  let modeRead = false;
  const modeAccessor = { ...options };
  Object.defineProperty(modeAccessor, "initialMode", {
    enumerable: true,
    get() {
      modeRead = true;
      return "codex";
    },
  });
  await assert.rejects(startContainerDesktopUpstream(modeAccessor), {
    code: "CONTAINER_INVALID_CONFIG",
  });
  assert.equal(modeRead, false);
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "bridge",
      accountSnapshot: { sourceFile, homeRoot: tmpfsHome },
    }),
    { code: "CONTAINER_RUNTIME_EXISTS" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({ ...options, networkMode: "host" }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "none",
      accountSnapshot: { sourceFile, homeRoot: tmpfsHome },
    }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "bridge",
      accountSnapshot: { sourceFile, homeRoot: bridgeRoot },
    }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "bridge",
      accountSnapshot: { sourceFile, homeRoot: tmpfsHome + ",readonly" },
    }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  let getterRead = false;
  const malicious = {
    get sourceFile() {
      getterRead = true;
      return sourceFile;
    },
    homeRoot: tmpfsHome,
  };
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      networkMode: "bridge",
      accountSnapshot: malicious,
    }),
    { code: "CONTAINER_INVALID_CONFIG" },
  );
  assert.equal(getterRead, false);
});

test("account home must be an empty canonical owned private tmpfs directory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "container-options-"));
  const tmpfsHome = await mkdtemp("/dev/shm/chatgpt-account-home-");
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(tmpfsHome, { recursive: true, force: true });
  });
  const sourceRoot = join(dir, "source"),
    runtimeRoot = join(dir, "runtime"),
    bridgeRoot = join(dir, "bridge"),
    diskHome = join(dir, "disk-home");
  await mkdir(join(sourceRoot, "resources"), { recursive: true, mode: 0o700 });
  await mkdir(runtimeRoot, { mode: 0o700 });
  await mkdir(bridgeRoot, { mode: 0o700 });
  await mkdir(diskHome, { mode: 0o700 });
  const options = {
    imageDigest: "sha256:" + "0".repeat(64),
    profileId: randomUUID(),
    generation: randomUUID(),
    sourceRoot,
    runtimeRoot,
    bridgeRoot,
    dockerPath: "/usr/bin/docker",
    dockerSha256: "0".repeat(64),
    pythonPath: await realpath("/usr/bin/python3"),
    pythonSha256: "0".repeat(64),
    nodePath: await realpath(process.execPath),
    nodeSha256: "0".repeat(64),
    cpuId: 0,
    networkMode: "bridge",
  };
  const sourceFile = join(dir, "auth.json");
  if (Number((await statfs(diskHome)).type) !== 0x01021994)
    await assert.rejects(
      startContainerDesktopUpstream({
        ...options,
        accountSnapshot: { sourceFile, homeRoot: diskHome },
      }),
      { code: "CONTAINER_UNSAFE_PATH" },
    );
  await chmod(tmpfsHome, 0o755);
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      accountSnapshot: { sourceFile, homeRoot: tmpfsHome },
    }),
    { code: "CONTAINER_UNSAFE_PATH" },
  );
  await chmod(tmpfsHome, 0o700);
  await writeFile(join(tmpfsHome, "unexpected"), "fixture", { mode: 0o600 });
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      accountSnapshot: { sourceFile, homeRoot: tmpfsHome },
    }),
    { code: "CONTAINER_UNSAFE_PATH" },
  );
  await rm(join(tmpfsHome, "unexpected"));
  const alias = join(dir, "home-alias");
  await symlink(tmpfsHome, alias);
  await assert.rejects(
    startContainerDesktopUpstream({
      ...options,
      accountSnapshot: { sourceFile, homeRoot: alias },
    }),
    { code: "CONTAINER_UNSAFE_PATH" },
  );
});

test("container inspection binds the selected network, tmpfs home and unpublished ports", () => {
  const inspect = containerService.assertContainerInspection;
  assert.equal(typeof inspect, "function");
  const expected = {
    containerId: "a".repeat(64),
    imageDigest: "sha256:" + "b".repeat(64),
    uid: 1000,
    gid: 1000,
    cpuId: 3,
    networkMode: "bridge",
    sourceRoot: "/source",
    runtimeRoot: "/runtime",
    home: "/runtime/home",
    homeSource: "/dev/shm/private-home",
    bridgeRoot: "/bridge-root",
    bundleRoot: "/bundle",
    nodePath: "/node",
  };
  const env = [
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "LD_DEBUG",
    "LD_ORIGIN_PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RENDERER_URL",
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_EXTRA_LAUNCH_ARGS",
    "CODEX_HOME",
    "SSH_AUTH_SOCK",
    "PYTHONPATH",
    "PYTHONHOME",
    "CODEX_TPP_LOCAL_EXECUTOR_ENABLED",
  ].map((key) => key + "=");
  const value = {
    id: expected.containerId,
    image: expected.imageDigest,
    pid: 1234,
    user: "1000:1000",
    host: {
      NetworkMode: "bridge",
      PidMode: "private",
      IpcMode: "private",
      ReadonlyRootfs: true,
      Privileged: false,
      Init: true,
      CpusetCpus: "3",
      CgroupnsMode: "private",
      PidsLimit: 256,
      Memory: 2147483648,
      ShmSize: 268435456,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      PublishAllPorts: false,
      PortBindings: null,
    },
    entry: ["/usr/bin/env"],
    cmd: [
      "-i",
      "PATH=/usr/bin:/bin",
      "HOME=/tmp",
      "/usr/bin/python3",
      "-I",
      "-u",
      "-B",
      "/package/container-bridge.py",
    ],
    env,
    mounts: [
      { Source: "/source", Destination: "/source", RW: false, Type: "bind" },
      { Source: "/runtime", Destination: "/runtime", RW: false, Type: "bind" },
      {
        Source: "/dev/shm/private-home",
        Destination: "/runtime/home",
        RW: true,
        Type: "bind",
      },
      {
        Source: "/bridge-root",
        Destination: "/bridge",
        RW: true,
        Type: "bind",
      },
      { Source: "/bundle", Destination: "/package", RW: false, Type: "bind" },
      {
        Source: "/node",
        Destination: "/opt/private-node",
        RW: false,
        Type: "bind",
      },
    ],
  };
  assert.equal(inspect(value, expected), 1234);
  for (const pidsLimit of [256, 512]) {
    const configured = { ...expected, pidsLimit },
      selected = structuredClone(value);
    selected.host.PidsLimit = pidsLimit;
    assert.equal(inspect(selected, configured), 1234);
    for (const otherLimit of [256, 512, 1024, "512"].filter(
      (limit) => limit !== pidsLimit,
    )) {
      const mismatched = structuredClone(selected);
      mismatched.host.PidsLimit = otherLimit;
      assert.throws(() => inspect(mismatched, configured), {
        code: "CONTAINER_IDENTITY_CHANGED",
      });
    }
  }
  for (const pidsLimit of [null, 0, 128, 257, 1024, "512"])
    assert.throws(() => inspect(value, { ...expected, pidsLimit }), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  for (const memoryLimitMiB of [2048, 4096, 8192]) {
    const configured = { ...expected, memoryLimitMiB };
    const selected = structuredClone(value);
    selected.host.Memory = memoryLimitMiB * 1024 * 1024;
    assert.equal(inspect(selected, configured), 1234);
    for (const otherLimit of [2048, 4096, 8192].filter(
      (limit) => limit !== memoryLimitMiB,
    )) {
      const mismatched = structuredClone(selected);
      mismatched.host.Memory = otherLimit * 1024 * 1024;
      assert.throws(() => inspect(mismatched, configured), {
        code: "CONTAINER_IDENTITY_CHANGED",
      });
    }
    selected.host.PidsLimit = 512;
    assert.throws(() => inspect(selected, configured), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  }
  for (const memoryLimitMiB of [null, 1024, 3072, 16384, "4096"])
    assert.throws(() => inspect(value, { ...expected, memoryLimitMiB }), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  for (const change of [
    (v) => {
      v.host.NetworkMode = "host";
    },
    (v) => {
      v.host.NetworkMode = "none";
    },
    (v) => {
      v.host.PublishAllPorts = true;
    },
    (v) => {
      v.host.PortBindings = { "80/tcp": [{ HostPort: "80" }] };
    },
    (v) => {
      v.host.PortBindings = [];
    },
    (v) => {
      v.mounts[2].Source = "/runtime/home";
    },
    (v) => {
      v.mounts[2].RW = false;
    },
    (v) => {
      v.mounts.push({
        Source: "/var/run/docker.sock",
        Destination: "/docker.sock",
        RW: true,
        Type: "bind",
      });
    },
  ]) {
    const mutated = structuredClone(value);
    change(mutated);
    assert.throws(() => inspect(mutated, expected), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  }
});
