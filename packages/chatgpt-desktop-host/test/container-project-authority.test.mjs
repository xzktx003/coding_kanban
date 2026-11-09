import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  mkdtemp,
  mkdir,
  chmod,
  rm,
  writeFile,
  readdir,
  readlink,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareFixedProjectMounts } from "../src/fixed-project-mounts.mjs";
import {
  assertContainerInspection,
  readContainerProcessIdentitySync,
  matchesContainerProcessIdentitySync,
  createContainerProjectGuard,
  startContainerDesktopUpstream,
} from "../src/container-service.mjs";
import { runAuthorizedContainerWrite } from "../src/container-write-guard.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "container-project-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "scratch");
  await mkdir(project, { mode: 0o775 });
  await chmod(project, 0o775);
  const p = join(root, "private");
  const expected = {
    containerId: "a".repeat(64),
    imageDigest: "sha256:" + "b".repeat(64),
    uid: process.getuid(),
    gid: process.getgid(),
    cpuId: 0,
    networkMode: "none",
    sourceRoot: join(p, "source"),
    runtimeRoot: join(p, "runtime"),
    home: join(p, "runtime/home"),
    homeSource: join(p, "runtime/home"),
    bridgeRoot: join(p, "bridge"),
    bundleRoot: join(p, "runtime/bundle"),
    nodePath: join(p, "node"),
  };
  const owner = await prepareFixedProjectMounts({
    projectRoots: [project],
    protectedPaths: {
      homes: [expected.home],
      auth: [],
      runtime: [expected.runtimeRoot],
      control: [],
      bridge: [expected.bridgeRoot],
      source: [expected.sourceRoot],
      tools: [expected.nodePath],
    },
  });
  t.after(() => owner.close());
  const base = [
    {
      source: expected.sourceRoot,
      destination: expected.sourceRoot,
      readOnly: true,
    },
    {
      source: expected.runtimeRoot,
      destination: expected.runtimeRoot,
      readOnly: true,
    },
    {
      source: expected.homeSource,
      destination: expected.home,
      readOnly: false,
    },
    { source: expected.bridgeRoot, destination: "/bridge", readOnly: false },
    { source: expected.bundleRoot, destination: "/package", readOnly: true },
    {
      source: expected.nodePath,
      destination: "/opt/private-node",
      readOnly: true,
    },
  ];
  const value = {
    id: expected.containerId,
    image: expected.imageDigest,
    pid: process.pid,
    user: expected.uid + ":" + expected.gid,
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
    env: [
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
    ].map((x) => x + "="),
    host: {
      NetworkMode: "none",
      PidMode: "private",
      IpcMode: "private",
      ReadonlyRootfs: true,
      Privileged: false,
      Init: true,
      CpusetCpus: "0",
      CgroupnsMode: "private",
      PidsLimit: 256,
      Memory: 2147483648,
      ShmSize: 268435456,
      PublishAllPorts: false,
      PortBindings: {},
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Binds: null,
      VolumesFrom: null,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=268435456" },
      Mounts: base.map((v) => ({
        Type: "bind",
        Source: v.source,
        Target: v.destination,
        ReadOnly: v.readOnly,
      })),
    },
    mounts: base.map((v) => ({
      Type: "bind",
      Source: v.source,
      Destination: v.destination,
      RW: !v.readOnly,
      Propagation: "rprivate",
    })),
  };
  return { root, project, expected, owner, value };
}

test("default inspection remains exactly six mounts; owned projects require the full non-recursive inspection contract", async (t) => {
  const f = await fixture(t);
  assert.equal(assertContainerInspection(f.value, f.expected), process.pid);
  const withProject = structuredClone(f.value);
  withProject.mounts.push({
    Type: "bind",
    Source: f.project,
    Destination: f.project,
    RW: true,
    Propagation: "rprivate",
  });
  withProject.host.Mounts.push({
    Type: "bind",
    Source: f.project,
    Target: f.project,
    BindOptions: { NonRecursive: true },
  });
  assert.throws(() => assertContainerInspection(withProject, f.expected), {
    code: "CONTAINER_IDENTITY_CHANGED",
  });
  assert.equal(
    assertContainerInspection(withProject, {
      ...f.expected,
      projectMounts: f.owner,
    }),
    process.pid,
  );
  for (const change of [
    (v) => (v.host.Mounts.at(-1).BindOptions.NonRecursive = false),
    (v) => (v.mounts.at(-1).RW = false),
    (v) => v.mounts.push(v.mounts[0]),
    (v) => (v.host.Binds = ["/unexpected:/unexpected"]),
    (v) => (v.host.Mounts[1] = structuredClone(v.host.Mounts[0])),
  ]) {
    const bad = structuredClone(withProject);
    change(bad);
    assert.throws(
      () =>
        assertContainerInspection(bad, {
          ...f.expected,
          projectMounts: f.owner,
        }),
      { code: "CONTAINER_IDENTITY_CHANGED" },
    );
  }
});

test("synchronous process matching pins complete captured identity instead of trusting a numeric PID", () => {
  const identity = readContainerProcessIdentitySync(process.pid);
  assert.equal(matchesContainerProcessIdentitySync(identity), true);
  for (const change of [
    (v) => (v.ticks += "0"),
    (v) => v.uid++,
    (v) => v.ppid++,
    (v) => (v.pidns += "changed"),
    (v) => (v.mntns += "changed"),
    (v) => (v.cgroup += "changed"),
    (v) => (v.nspids = [...v.nspids, 999999]),
    (v) => (v.pid = 2147483647),
  ]) {
    const bad = structuredClone(identity);
    change(bad);
    assert.equal(matchesContainerProcessIdentitySync(bad), false);
  }
  assert.equal(matchesContainerProcessIdentitySync(null), false);
});

test("a reparent during the held synchronous process read cannot authorize the old identity", () => {
  const expected = readContainerProcessIdentitySync(process.pid),
    original = fs.readFileSync;
  let reads = 0;
  try {
    fs.readFileSync = (path, ...args) => {
      const value = original(path, ...args);
      if (path === "/proc/" + process.pid + "/stat" && ++reads === 2) {
        const end = value.lastIndexOf(") "),
          fields = value
            .slice(end + 2)
            .trim()
            .split(/\s+/);
        fields[1] = String(Number(fields[1]) + 1);
        return value.slice(0, end + 2) + fields.join(" ") + "\n";
      }
      return value;
    };
    syncBuiltinESMExports();
    assert.equal(matchesContainerProcessIdentitySync(expected), false);
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  }
});

test("project guards retain a fixed process snapshot and refuse changed roots at the actual write boundary", async (t) => {
  const f = await fixture(t),
    identity = readContainerProcessIdentitySync(process.pid),
    guard = createContainerProjectGuard(f.owner, identity);
  identity.ticks += "0";
  assert.equal(guard(), true);
  await writeFile(join(f.project, "accepted.txt"), "scratch only", {
    mode: 0o600,
  });
  assert.equal(guard(), true);
  let writes = 0;
  await assert.rejects(
    runAuthorizedContainerWrite(
      {
        signal: new AbortController().signal,
        deadline: performance.now() + 5000,
        onDispatch: () => fs.chmodSync(f.project, 0o777),
      },
      async () => true,
      () => () => {
        if (!guard())
          throw Object.assign(Error("changed"), {
            code: "CONTAINER_IDENTITY_CHANGED",
          });
        writes++;
      },
    ),
    { code: "CONTAINER_IDENTITY_CHANGED" },
  );
  assert.equal(writes, 0);
  assert.equal(guard(), false);
  assert.equal(createContainerProjectGuard(f.owner, {})(), false);
  await f.owner.close();
  assert.equal(guard(), false);
});

test(
  "real pinned preparation persists only the fixed project list before any Docker call",
  { skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "project-native-prep-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, "scratch"),
      runtimeRoot = join(root, "r"),
      bridgeRoot = join(root, "bridge");
    await mkdir(project, { mode: 0o775 });
    await chmod(project, 0o775);
    await mkdir(bridgeRoot, { mode: 0o700 });
    const marker = join(project, "keep.txt");
    await writeFile(marker, "unchanged", { mode: 0o600 });
    const { randomUUID } = await import("node:crypto");
    await assert.rejects(
      startContainerDesktopUpstream({
        sourceRoot: process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT,
        runtimeRoot,
        bridgeRoot,
        profileId: randomUUID(),
        generation: randomUUID(),
        imageDigest: "sha256:" + "0".repeat(64),
        dockerPath: await realpath("/usr/bin/false"),
        dockerSha256: "0".repeat(64),
        pythonPath: await realpath("/usr/bin/python3"),
        pythonSha256: "0".repeat(64),
        nodePath: await realpath(process.execPath),
        nodeSha256: "0".repeat(64),
        cpuId: 0,
        projectRoots: [project],
      }),
      { code: "CONTAINER_ARTIFACT_CHANGED" },
    );
    const config = JSON.parse(
      await readFile(
        join(runtimeRoot, "resources/private-config.json"),
        "utf8",
      ),
    );
    assert.deepEqual(config.projectRoots, [project]);
    assert.equal(await readFile(marker, "utf8"), "unchanged");
    const handles = await Promise.all(
      (await readdir("/proc/self/fd")).map(async (fd) => {
        try {
          return await readlink("/proc/self/fd/" + fd);
        } catch {
          return null;
        }
      }),
    );
    assert.equal(handles.includes(project), false);
  },
);

test("trusted project guard retains the two mounted boundary checks without an extra root scan", async (t) => {
  const f = await fixture(t);
  const identity = readContainerProcessIdentitySync(process.pid);
  const guard = createContainerProjectGuard(f.owner, identity);
  const original = fs.lstatSync;
  let roots = 0;
  fs.lstatSync = (path, ...args) => {
    if (String(path) === f.project) roots++;
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const start = performance.now();
    for (let n = 0; n < 32; n++) assert.equal(guard(), true);
    const elapsedMs = performance.now() - start;
    console.log(JSON.stringify({guardRuns:32,projectRootReads:roots,elapsedMs}));
    assert.equal(roots, 64, "the real mounted guard must read the root before and after each mount walk");
    const impostor = Object.freeze({ ...f.owner, verifySync: () => false });
    assert.equal(createContainerProjectGuard(impostor, identity)(), false);
    await chmod(f.project, 0o777);
    assert.equal(guard(), false, "a changed project root must revoke the next write");
  } finally {
    fs.lstatSync = original;
    syncBuiltinESMExports();
  }
});

test('private tmpfs identity is reread synchronously and rejects replaced or unsafe homes', async (t) => {
  const mod = await import('../src/container-service.mjs');
  assert.equal(typeof mod.readOwnedTmpfsHomeIdentitySync, 'function');
  const home = await mkdtemp('/dev/shm/cg-home-identity-');
  t.after(() => rm(home, { recursive:true, force:true }));
  await chmod(home, 0o700);
  const first = mod.readOwnedTmpfsHomeIdentitySync(home, process.getuid());
  const again = mod.readOwnedTmpfsHomeIdentitySync(home, process.getuid());
  assert.equal(first.dev, again.dev);
  assert.equal(first.ino, again.ino);
  const originalStatfs = fs.statfsSync;
  fs.statfsSync = () => ({type: 0n});
  syncBuiltinESMExports();
  try {
    assert.throws(() => mod.readOwnedTmpfsHomeIdentitySync(home, process.getuid()), {code:'CONTAINER_UNSAFE_PATH'});
  } finally { fs.statfsSync = originalStatfs; syncBuiltinESMExports(); }
  const alias = home + '-alias';
  fs.symlinkSync(home, alias);
  t.after(() => rm(alias, { force:true }));
  assert.throws(() => mod.readOwnedTmpfsHomeIdentitySync(alias, process.getuid()), {code:'CONTAINER_UNSAFE_PATH'});
  await chmod(home, 0o777);
  assert.throws(() => mod.readOwnedTmpfsHomeIdentitySync(home, process.getuid()), {code:'CONTAINER_UNSAFE_PATH'});
});
