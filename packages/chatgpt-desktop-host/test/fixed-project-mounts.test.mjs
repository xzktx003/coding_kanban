import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as projectMounts from "../src/fixed-project-mounts.mjs";
const { prepareFixedProjectMounts } = projectMounts;

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "fixed-project-mounts-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const first = join(base, "project-a"),
    second = join(base, "project-b");
  await mkdir(first, { mode: 0o775 });
  await chmod(first, 0o775);
  await mkdir(second, { mode: 0o700 });
  const p = join(base, "private");
  return {
    base,
    first,
    second,
    protectedPaths: {
      homes: [join(p, "home")],
      auth: [join(p, "auth.json")],
      runtime: [join(p, "runtime")],
      control: [join(p, "profile"), join(p, "control.sock")],
      bridge: [join(p, "bridge")],
      source: [join(p, "source"), join(p, "mac.asar")],
      tools: [join(p, "docker"), join(p, "python"), join(p, "node")],
    },
  };
}
const args = (f, projectRoots) => ({
  projectRoots,
  protectedPaths: f.protectedPaths,
});
async function pathsForOpenFds(root) {
  const result = [];
  for (const fd of await readdir("/proc/self/fd")) {
    try {
      const p = await readlink(`/proc/self/fd/${fd}`);
      if (p === root || p.startsWith(root + "/")) result.push(p);
    } catch {}
  }
  return result;
}
async function heldProcDirectories(pid) {
  const result = [];
  for (const fd of await readdir("/proc/self/fd")) {
    try {
      if ((await readlink(`/proc/self/fd/${fd}`)) === `/proc/${pid}`)
        result.push(fd);
    } catch {}
  }
  return result;
}

test("pure root normalization freezes a copy and rejects malformed or overlapping roots", async (t) => {
  const f = await fixture(t);
  assert.equal(typeof projectMounts.normalizeProjectRoots, "function");
  const { normalizeProjectRoots } = projectMounts;
  assert.deepEqual(normalizeProjectRoots(undefined), []);
  assert.equal(Object.isFrozen(normalizeProjectRoots(undefined)), true);
  const roots = [f.first, f.second];
  const normalized = normalizeProjectRoots(roots);
  assert.deepEqual(normalized, roots);
  assert.notEqual(normalized, roots);
  assert.equal(Object.isFrozen(normalized), true);
  roots.pop();
  assert.equal(normalized.length, 2);
  for (const bad of [
    [f.first, f.first],
    [f.first, join(f.first, "nested")],
    Array(9).fill(f.first),
    ["relative"],
    ["/"],
    ["/tmp"],
    ["/usr"],
    [f.first + "/../project-b"],
    [f.first + ",dst=/tmp"],
    [f.first + '"'],
    [f.first + "\n"],
  ])
    assert.throws(
      () => normalizeProjectRoots(bad),
      (error) =>
        [
          "CONTAINER_PROJECT_INVALID_CONFIG",
          "CONTAINER_PROJECT_UNSAFE_PATH",
        ].includes(error.code),
    );
  let getterRead = false;
  const withGetter = [f.first];
  Object.defineProperty(withGetter, "0", {
    get() {
      getterRead = true;
      return f.first;
    },
  });
  assert.throws(() => normalizeProjectRoots(withGetter), {
    code: "CONTAINER_PROJECT_INVALID_CONFIG",
  });
  assert.equal(getterRead, false);
});

test("only explicit owned roots produce immutable non-recursive same-path writable binds", async (t) => {
  const f = await fixture(t),
    owner = await prepareFixedProjectMounts(args(f, [f.first, f.second]));
  try {
    assert.deepEqual(owner.roots, [f.first, f.second]);
    assert.equal(Object.isFrozen(owner.roots), true);
    assert.deepEqual(owner.mountArgs, [
      "--mount",
      `type=bind,src=${f.first},dst=${f.first},bind-recursive=disabled`,
      "--mount",
      `type=bind,src=${f.second},dst=${f.second},bind-recursive=disabled`,
    ]);
    assert.equal(Object.isFrozen(owner.mountArgs), true);
    assert.equal(owner.verifySync(), true);
    assert.equal(await owner.verify(), true);
    assert.ok((await pathsForOpenFds(f.first)).length >= 1);
    await writeFile(join(f.first, "new-file"), "user project remains mutable");
    assert.equal(owner.verifySync(), true);
  } finally {
    await owner.close();
  }
  assert.equal(owner.verifySync(), false);
  assert.equal(await owner.verify(), false);
  assert.deepEqual(await pathsForOpenFds(f.first), []);
  await owner.close();
});

test("undefined or empty explicit roots preserves the no-project default", async (t) => {
  const f = await fixture(t);
  for (const projectRoots of [undefined, []]) {
    const owner = await prepareFixedProjectMounts(args(f, projectRoots));
    assert.deepEqual(owner.roots, []);
    assert.deepEqual(owner.mountArgs, []);
    assert.equal(owner.verifySync(), true);
    await owner.close();
  }
});

test("eight distinct roots are allowed, a ninth is rejected, and partial failures release earlier FDs", async (t) => {
  const f = await fixture(t),
    projects = [];
  for (let i = 0; i < 9; i++) {
    const path = join(f.base, `project-${i}`);
    await mkdir(path, { mode: 0o700 });
    projects.push(path);
  }
  const owner = await prepareFixedProjectMounts(args(f, projects.slice(0, 8)));
  assert.equal(owner.roots.length, 8);
  assert.equal(owner.verifySync(), true);
  await owner.close();
  await assert.rejects(prepareFixedProjectMounts(args(f, projects)), {
    code: "CONTAINER_PROJECT_INVALID_CONFIG",
  });
  await chmod(projects[1], 0o777);
  await assert.rejects(
    prepareFixedProjectMounts(args(f, projects.slice(0, 2))),
    { code: "CONTAINER_PROJECT_UNSAFE_PATH" },
  );
  assert.deepEqual(await pathsForOpenFds(projects[0]), []);
});

test("rejects arbitrary config, accessors, malformed paths, duplicates, overlaps and more than eight roots", async (t) => {
  const f = await fixture(t);
  const invalid = [
    args(f, [f.first, f.first]),
    args(f, [f.first, `${f.first}/child`]),
    args(f, Array(9).fill(f.first)),
    args(f, ["relative"]),
    args(f, ["/"]),
    args(f, ["/tmp"]),
    args(f, [f.first + "/../project-b"]),
    args(f, [f.first + ",dst=/tmp"]),
    args(f, [f.first + '"']),
    args(f, [f.first + "\n"]),
    args(f, ["/usr"]),
    { ...args(f, [f.first]), extra: true },
    { projectRoots: [f.first] },
  ];
  for (const input of invalid)
    await assert.rejects(prepareFixedProjectMounts(input), (e) =>
      [
        "CONTAINER_PROJECT_INVALID_CONFIG",
        "CONTAINER_PROJECT_UNSAFE_PATH",
      ].includes(e.code),
    );
  await assert.rejects(prepareFixedProjectMounts(args(f, [f.first + '"'])), {
    code: "CONTAINER_PROJECT_INVALID_CONFIG",
  });
  let read = false;
  const bad = args(f, [f.first]);
  Object.defineProperty(bad, "projectRoots", {
    enumerable: true,
    get() {
      read = true;
      return [f.first];
    },
  });
  await assert.rejects(prepareFixedProjectMounts(bad), {
    code: "CONTAINER_PROJECT_INVALID_CONFIG",
  });
  assert.equal(read, false);
  let itemRead = false;
  const list = [f.first];
  Object.defineProperty(list, "0", {
    enumerable: true,
    get() {
      itemRead = true;
      return f.first;
    },
  });
  await assert.rejects(prepareFixedProjectMounts(args(f, list)), {
    code: "CONTAINER_PROJECT_INVALID_CONFIG",
  });
  assert.equal(itemRead, false);
  const trap = new Proxy(
    {},
    {
      ownKeys() {
        throw Error("private-fixture-marker");
      },
    },
  );
  await assert.rejects(
    prepareFixedProjectMounts(trap),
    (error) =>
      error.code === "CONTAINER_PROJECT_INVALID_CONFIG" &&
      !error.message.includes("private-fixture-marker"),
  );
  let lengthRead = false;
  const arrayTrap = new Proxy([f.first], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthRead = true;
        throw Error("private-fixture-marker");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const trapOwner = await prepareFixedProjectMounts(args(f, arrayTrap));
  assert.equal(lengthRead, false);
  await trapOwner.close();
});

test("rejects both directions of overlap with each private path category", async (t) => {
  const f = await fixture(t);
  for (const category of Object.keys(f.protectedPaths)) {
    for (const path of [f.first, join(f.first, "nested"), f.base]) {
      const protectedPaths = { ...f.protectedPaths, [category]: [path] };
      await assert.rejects(
        prepareFixedProjectMounts({ projectRoots: [f.first], protectedPaths }),
        { code: "CONTAINER_PROJECT_UNSAFE_PATH" },
        category,
      );
    }
  }
});

test("rejects noncanonical, symlinked and world-writable projects but accepts group-writable 0775", async (t) => {
  const f = await fixture(t),
    alias = join(f.base, "alias");
  await symlink(f.first, alias);
  await assert.rejects(prepareFixedProjectMounts(args(f, [alias])), {
    code: "CONTAINER_PROJECT_UNSAFE_PATH",
  });
  const owner = await prepareFixedProjectMounts(args(f, [f.first]));
  assert.equal(owner.verifySync(), true);
  await owner.close();
  await chmod(f.first, 0o777);
  await assert.rejects(prepareFixedProjectMounts(args(f, [f.first])), {
    code: "CONTAINER_PROJECT_UNSAFE_PATH",
  });
});

test("changed mode, replaced path, replaced ancestor and nested symlink invalidate before another write", async (t) => {
  for (const change of ["chmod", "replace", "ancestor", "symlink"]) {
    const f = await fixture(t);
    const parent = join(f.base, "parent"),
      root = join(parent, "project");
    await mkdir(parent);
    await mkdir(root, { mode: 0o700 });
    const owner = await prepareFixedProjectMounts(args(f, [root]));
    if (change === "chmod") await chmod(root, 0o777);
    if (change === "replace") {
      await rename(root, join(parent, "old"));
      await mkdir(root, { mode: 0o700 });
    }
    if (change === "ancestor") {
      await rename(parent, join(f.base, "old-parent"));
      await mkdir(parent);
      await mkdir(root, { mode: 0o700 });
    }
    if (change === "symlink") {
      await rename(root, join(parent, "old"));
      await symlink(join(parent, "old"), root);
    }
    assert.equal(owner.verifySync(), false, change);
    assert.equal(await owner.verify(), false, change);
    await owner.close();
    assert.deepEqual(await pathsForOpenFds(root), [], change);
  }
});

test("a new symlink in a previously absent protected path invalidates authority", async (t) => {
  const f = await fixture(t),
    owner = await prepareFixedProjectMounts(args(f, [f.first]));
  await symlink(f.first, join(f.base, "private"));
  assert.equal(owner.verifySync(), false);
  await owner.close();
});

test("mounted project identity is checked through the actual guarded process root", async (t) => {
  const f = await fixture(t),
    owner = await prepareFixedProjectMounts(args(f, [f.first, f.second]));
  t.after(() => owner.close());
  const initialProcFds = (await heldProcDirectories(process.pid)).length;
  let checks = 0;
  assert.equal(
    owner.verifyMountedSync({
      pid: process.pid,
      verifyProcess: (pid) => {
        assert.equal(pid, process.pid);
        checks++;
        return true;
      },
    }),
    true,
  );
  assert.ok(checks >= 2, "the process identity is checked on both sides");

  for (const bad of [
    { pid: 0, verifyProcess: () => true },
    { pid: -1, verifyProcess: () => true },
    { pid: 1.5, verifyProcess: () => true },
    { pid: "123", verifyProcess: () => true },
    { pid: process.pid, verifyProcess: () => false },
    { pid: process.pid, verifyProcess: () => undefined },
    { pid: process.pid, verifyProcess: async () => true },
    {
      pid: process.pid,
      verifyProcess: async () => {
        throw Error("private");
      },
    },
    {
      pid: process.pid,
      verifyProcess: () => {
        throw Error("private");
      },
    },
    { pid: process.pid },
    { pid: process.pid, verifyProcess: () => true, extra: true },
  ]) {
    assert.equal(owner.verifyMountedSync(bad), false);
  }
  let changingChecks = 0;
  assert.equal(
    owner.verifyMountedSync({
      pid: process.pid,
      verifyProcess: () => ++changingChecks < 3,
    }),
    false,
    "identity lost after inspection must not grant authority",
  );
  assert.equal(
    owner.verifyMountedSync({ pid: 2147483647, verifyProcess: () => true }),
    false,
    "an absent process is never treated as a successful empty scan",
  );
  let getterRead = false;
  const withGetter = { pid: process.pid };
  Object.defineProperty(withGetter, "verifyProcess", {
    get() {
      getterRead = true;
      return () => true;
    },
  });
  assert.equal(owner.verifyMountedSync(withGetter), false);
  assert.equal(getterRead, false);
  assert.equal((await heldProcDirectories(process.pid)).length, initialProcFds);
  await owner.close();
  assert.equal(
    owner.verifyMountedSync({ pid: process.pid, verifyProcess: () => true }),
    false,
  );
});

test("a container root resolving to a different inode or an unreadable mount fails closed", async (t) => {
  const f = await fixture(t),
    owner = await prepareFixedProjectMounts(args(f, [f.first]));
  t.after(() => owner.close());
  const originalStat = fs.statSync;
  let checked = false;
  try {
    for (const scenario of ["different", "unreadable"]) {
      fs.statSync = (path, options) => {
        if (typeof path === "string" && path.startsWith("/proc/self/fd/")) {
          checked = true;
          if (scenario === "unreadable")
            throw Object.assign(Error("private"), { code: "EACCES" });
          return originalStat(f.second, options);
        }
        return originalStat(path, options);
      };
      syncBuiltinESMExports();
      checked = false;
      assert.equal(
        owner.verifyMountedSync({
          pid: process.pid,
          verifyProcess: () => true,
        }),
        false,
        scenario,
      );
      assert.equal(checked, true, "checks the project via the opened proc fd");
    }
  } finally {
    fs.statSync = originalStat;
    syncBuiltinESMExports();
  }
  assert.equal(owner.verifySync(), true, "the host path remained unchanged");
});

test("Docker inspection requires the exact mount list and non-recursive project BindOptions", async (t) => {
  const f = await fixture(t),
    owner = await prepareFixedProjectMounts(args(f, [f.first]));
  t.after(() => owner.close());
  const baseBindings = [
    { source: "/safe/source", destination: "/safe/source", readOnly: true },
    { source: "/safe/home", destination: "/safe/home", readOnly: false },
  ];
  const mounts = [
    {
      Type: "bind",
      Source: "/safe/source",
      Destination: "/safe/source",
      RW: false,
      Propagation: "rprivate",
    },
    {
      Type: "bind",
      Source: "/safe/home",
      Destination: "/safe/home",
      RW: true,
      Propagation: "rprivate",
    },
    {
      Type: "bind",
      Source: f.first,
      Destination: f.first,
      RW: true,
      Propagation: "rprivate",
    },
  ];
  const host = {
    Binds: null,
    VolumesFrom: null,
    Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=268435456" },
    Mounts: [
      {
        Type: "bind",
        Source: "/safe/source",
        Target: "/safe/source",
        ReadOnly: true,
      },
      { Type: "bind", Source: "/safe/home", Target: "/safe/home" },
      {
        Type: "bind",
        Source: f.first,
        Target: f.first,
        BindOptions: { NonRecursive: true },
      },
    ],
  };
  assert.equal(owner.assertInspection({ mounts, host, baseBindings }), true);
  for (const mutate of [
    (v) => {
      v.host.Mounts[2].BindOptions.NonRecursive = false;
    },
    (v) => {
      delete v.host.Mounts[2].BindOptions;
    },
    (v) => {
      v.host.Mounts[2].ReadOnly = true;
    },
    (v) => {
      v.mounts[2].RW = false;
    },
    (v) => {
      v.mounts[2].Source = "/other";
    },
    (v) => {
      v.mounts[2].Propagation = "rshared";
    },
    (v) => {
      v.mounts[1] = structuredClone(v.mounts[0]);
    },
    (v) => {
      v.host.Mounts[1] = structuredClone(v.host.Mounts[0]);
    },
    (v) => {
      v.host.Binds = ["/unexpected:/unexpected"];
    },
    (v) => {
      v.host.VolumesFrom = ["unexpected"];
    },
    (v) => {
      v.mounts.push({ Type: "bind" });
    },
    (v) => {
      v.host.Tmpfs["/unexpected"] = "rw";
    },
    (v) => {
      v.host.Tmpfs["/tmp"] = "rw";
    },
    (v) => {
      v.host.Mounts[2].BindOptions.ReadOnlyForceRecursive = true;
    },
  ]) {
    const value = structuredClone({ mounts, host, baseBindings });
    mutate(value);
    assert.throws(() => owner.assertInspection(value), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  }
});

const dockerImage = process.env.CHATGPT_PROJECT_MOUNTS_TEST_IMAGE;
const dockerBinary = process.env.CHATGPT_PROJECT_MOUNTS_TEST_DOCKER;
test(
  "real Docker create-only inspect matches the non-recursive exact mount contract",
  { skip: !dockerImage || !dockerBinary, timeout: 60000 },
  async (t) => {
    assert.match(dockerImage, /^sha256:[0-9a-f]{64}$/);
    assert.ok(dockerBinary.startsWith("/"));
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { readFile } = await import("node:fs/promises");
    const run = promisify(execFile),
      f = await fixture(t);
    const owner = await prepareFixedProjectMounts(args(f, [f.first]));
    const config = join(f.base, "docker-config"),
      cidfile = join(f.base, "container-id");
    await mkdir(config, { mode: 0o700 });
    const env = { HOME: f.base, PATH: "/usr/bin:/bin", DOCKER_CONFIG: config };
    let id;
    try {
      await run(
        dockerBinary,
        [
          "create",
          "--pull=never",
          "--network=none",
          "--tmpfs",
          "/tmp:rw,nosuid,nodev,noexec,size=268435456",
          "--cidfile",
          cidfile,
          ...owner.mountArgs,
          "--entrypoint",
          "/bin/true",
          dockerImage,
        ],
        { env, timeout: 30000 },
      );
      id = (await readFile(cidfile, "utf8")).trim();
      assert.match(id, /^[a-f0-9]{64}$/);
      const out = (
        await run(
          dockerBinary,
          ["inspect", "--format", "{{json .HostConfig}}|{{json .Mounts}}", id],
          { env, timeout: 20000 },
        )
      ).stdout;
      const [host, mounts] = out.trim().split("|").map(JSON.parse);
      assert.equal(
        owner.assertInspection({ host, mounts, baseBindings: [] }),
        true,
      );
    } finally {
      await owner.close();
      if (!id) {
        try {
          id = (await readFile(cidfile, "utf8")).trim();
        } catch {}
      }
      if (id && /^[a-f0-9]{64}$/.test(id))
        await run(dockerBinary, ["rm", id], { env, timeout: 20000 });
    }
  },
);
