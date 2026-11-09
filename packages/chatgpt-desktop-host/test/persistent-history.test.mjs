import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  rename,
  symlink,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import {
  normalizePersistentHistoryRoot,
  preparePersistentHistory,
  reopenPersistentHistoryForReattach,
  reopenContainerHistoryForRecovery,
  HISTORY_CONTROL_PATH,
} from "../src/persistent-history.mjs";
import {
  matchesContainerProcessIdentitySync,
  createContainerProjectGuard,
  prepareInitialCodexMode,
  readContainerProcessIdentitySync,
} from "../src/container-service.mjs";

const exec = promisify(execFile);
function auth(account = "account-a", sub = "subject-a", issued = 100) {
  const payload = {
    iss: "https://issuer.test",
    sub,
    iat: issued,
    exp: issued + 10000,
    "https://api.openai.com/auth": { chatgpt_account_id: account },
  };
  const jwt =
    "e30." +
    Buffer.from(JSON.stringify(payload)).toString("base64url") +
    ".c2ln";
  return {
    auth_mode: "chatgpt",
    tokens: {
      id_token: jwt,
      access_token: jwt,
      account_id: account,
      refresh_token: "",
    },
  };
}
async function fixture(t, accountSeeded = false) {
  const root = await mkdtemp(join(tmpdir(), "desktop-history-"));
  await chmod(root, 0o700);
  const historyRoot = join(root, "history"),
    source = join(root, "source");
  await mkdir(historyRoot, { mode: 0o700 });
  await mkdir(source, { mode: 0o700 });
  const homeRoot = accountSeeded
    ? await mkdtemp("/dev/shm/desktop-history-home-")
    : join(root, "home");
  if (!accountSeeded) await mkdir(homeRoot, { mode: 0o700 });
  else await chmod(homeRoot, 0o700);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    if (accountSeeded) await rm(homeRoot, { recursive: true, force: true });
  });
  const options = {
    historyRoot,
    homeRoot,
    containerHome: join(root, "container-home"),
    protectedPaths: [join(root, "protected")],
    accountSeeded,
  };
  if (accountSeeded) {
    await mkdir(join(homeRoot, ".codex"), { mode: 0o700 });
    options.accountSourceFile = join(source, "auth.json");
    await writeFile(options.accountSourceFile, JSON.stringify(auth()), {
      mode: 0o600,
    });
    await writeFile(
      join(homeRoot, ".codex", "auth.json"),
      JSON.stringify(auth()),
      { mode: 0o600 },
    );
  }
  return { root, options };
}
function prepare(t, options) {
  const owner = preparePersistentHistory(options);
  t.after(() => owner.close());
  return owner;
}

async function reattachFixture(t, accountSeeded = false) {
  const f = await fixture(t, accountSeeded);
  const initial = prepare(t, f.options);
  const init = readContainerProcessIdentitySync(process.pid);
  initial.bindProcess({
    containerId: "a".repeat(64),
    identity: init,
    verifyProcess: () => matchesContainerProcessIdentitySync(init),
  });
  initial.close();
  const owner = JSON.parse(await readFile(join(f.options.historyRoot, "owner.json"), "utf8"));
  const holder = spawn("/usr/bin/python3", ["-I", "-u", "-c", [
    "import fcntl,sys",
    "f=open(sys.argv[1], 'r+')",
    "fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)",
    "print('ready',flush=True)",
    "sys.stdin.read()",
  ].join("\n"), join(f.options.historyRoot, ".lease")], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  await Promise.race([
    once(holder.stdout, "data"),
    once(holder, "exit").then(() => { throw Error("fixture lock holder exited"); }),
  ]);
  t.after(async () => {
    if (holder.exitCode === null) {
      const exited = once(holder, "exit");
      holder.stdin.end();
      await exited;
    }
  });
  const bridge = readContainerProcessIdentitySync(holder.pid);
  const verifyOwnedProcess = () =>
    matchesContainerProcessIdentitySync(init) &&
    matchesContainerProcessIdentitySync(bridge);
  return { ...f, owner, bridge, holder, verifyOwnedProcess };
}

test("reattach reopens only the exact live history owner and its bridge-held lease", async (t) => {
  const f = await reattachFixture(t);
  const ownerPath = join(f.options.historyRoot, "owner.json");
  const before = await readFile(ownerPath, "utf8");
  const reopened = reopenPersistentHistoryForReattach(f.options, {
    owner: f.owner, bridge: f.bridge, verifyOwnedProcess: f.verifyOwnedProcess,
  });
  t.after(() => reopened.close());
  assert.equal(reopened.verifySync(), true);
  assert.equal(await readFile(ownerPath, "utf8"), before);
  assert.throws(() => reopened.bindProcess({}), { code: "CONTAINER_IDENTITY_CHANGED" });
  assert.throws(() => reopened.withPreviousOwnerLease(() => {}), { code: "CONTAINER_IDENTITY_CHANGED" });
  const exited = once(f.holder, "exit");
  f.holder.stdin.end();
  await exited;
  assert.equal(reopened.verifySync(), false);
  assert.equal(await readFile(ownerPath, "utf8"), before);
});

test("reattach rejects a different owner or lock holder and never creates missing history", async (t) => {
  const f = await reattachFixture(t);
  const context = { owner: f.owner, bridge: f.bridge, verifyOwnedProcess: f.verifyOwnedProcess };
  assert.throws(() => reopenPersistentHistoryForReattach(f.options, {
    ...context, owner: { ...f.owner, containerId: "b".repeat(64) },
  }), { code: "CONTAINER_HISTORY_REATTACH_DENIED" });
  assert.throws(() => reopenPersistentHistoryForReattach(f.options, {
    ...context, bridge: readContainerProcessIdentitySync(process.pid),
  }), { code: "CONTAINER_HISTORY_REATTACH_DENIED" });
  assert.throws(() => reopenPersistentHistoryForReattach(f.options, {
    ...context, verifyOwnedProcess: () => false,
  }), { code: "CONTAINER_HISTORY_REATTACH_DENIED" });
  const missing = join(f.root, "missing-history");
  assert.throws(() => reopenPersistentHistoryForReattach({ ...f.options, historyRoot: missing }, context), {
    code: "CONTAINER_HISTORY_REATTACH_DENIED",
  });
  await assert.rejects(lstat(missing), { code: "ENOENT" });
});

test("reattach withdraws history authority when the real account changes", async (t) => {
  const f = await reattachFixture(t, true);
  const reopened = reopenPersistentHistoryForReattach(f.options, {
    owner: f.owner, bridge: f.bridge, verifyOwnedProcess: f.verifyOwnedProcess,
  });
  t.after(() => reopened.close());
  assert.equal(reopened.verifySync(), true);
  await writeFile(f.options.accountSourceFile, JSON.stringify(auth("other-account")), { mode: 0o600 });
  assert.equal(reopened.verifySync(), false);
});

test("container history recovery binds the original account and exact owner without reseeding", async (t) => {
  const f = await reattachFixture(t, true);
  const manifest = JSON.parse(await readFile(join(f.options.historyRoot, "manifest.json"), "utf8"));
  const beforeOwner = await readFile(join(f.options.historyRoot, "owner.json"), "utf8");
  const beforeAuth = await readFile(join(f.options.homeRoot, ".codex", "auth.json"));
  const init = readContainerProcessIdentitySync(process.pid), baseCgroup = `0::/system.slice/docker-${f.owner.containerId}.scope`;
  const p = (actual, pid, ppid, nsid) => ({
    ...actual, pid, ppid, nspids: [pid, nsid], cgroup: baseCgroup,
  });
  const nodePid = Math.max(init.pid, f.bridge.pid) + 100,
    nativePid = nodePid + 1,
    witness = {
      version: 1, containerId: f.owner.containerId,
      profileId: "11111111-1111-4111-8111-111111111111",
      generation: "22222222-2222-4222-8222-222222222222",
      bootId: "33333333-3333-4333-8333-333333333333",
      configSha256: "b".repeat(64), filesSha256: "c".repeat(64),
      account: { kind: "chatgpt", binding: manifest.accountBinding }, projects: [],
      processes: {
        init: p(init, init.pid, init.ppid, 1),
        bridge: p(f.bridge, f.bridge.pid, init.pid, 2),
        node: p(init, nodePid, f.bridge.pid, 3),
        native: p(init, nativePid, nodePid, 4),
      },
    };
  const recovered = reopenContainerHistoryForRecovery(f.options, witness, f.verifyOwnedProcess);
  t.after(() => recovered.close());
  assert.equal(recovered.verifySync(), true);
  assert.equal(await readFile(join(f.options.historyRoot, "owner.json"), "utf8"), beforeOwner);
  assert.deepEqual(await readFile(join(f.options.homeRoot, ".codex", "auth.json")), beforeAuth);
  assert.throws(() => reopenContainerHistoryForRecovery(f.options, {
    ...witness, account: { kind: "chatgpt", binding: "d".repeat(64) },
  }, f.verifyOwnedProcess), { code: "CONTAINER_HISTORY_REATTACH_DENIED" });
  assert.throws(() => reopenContainerHistoryForRecovery(f.options, witness, () => false), { code: "CONTAINER_HISTORY_REATTACH_DENIED" });
});

test("history normalization and descriptor-backed configuration reject malformed paths before filesystem writes", async (t) => {
  assert.equal(normalizePersistentHistoryRoot(undefined), undefined);
  assert.equal(
    normalizePersistentHistoryRoot("/private/history"),
    "/private/history",
  );
  for (const value of [
    null,
    {},
    false,
    "relative",
    "/tmp/a,b",
    "/tmp/../a",
    "/tmp/a\n",
  ])
    assert.throws(() => normalizePersistentHistoryRoot(value), {
      code: "CONTAINER_HISTORY_INVALID_CONFIG",
    });
  const f = await fixture(t);
  let read = false;
  const options = { ...f.options };
  Object.defineProperty(options, "historyRoot", {
    get() {
      read = true;
      return f.options.historyRoot;
    },
  });
  assert.throws(() => preparePersistentHistory(options), {
    code: "CONTAINER_HISTORY_INVALID_CONFIG",
  });
  assert.equal(read, false);
  assert.deepEqual(await readdir(f.options.historyRoot), []);
});

test("a dedicated history root persists native rollout directories and a private project-state directory", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options);
  assert.equal(owner.verifySync(), true);
  assert.deepEqual((await readdir(f.options.historyRoot)).sort(), [
    ".lease",
    "archived_sessions",
    "manifest.json",
    "owner.json",
    "project-state",
    "sessions",
  ]);
  assert.deepEqual(
    owner.bindings.map((x) => [x.destination, x.readOnly]),
    [
      [HISTORY_CONTROL_PATH, true],
      [HISTORY_CONTROL_PATH + "/.lease", false],
      [join(f.options.containerHome, ".codex/sessions"), false],
      [join(f.options.containerHome, ".codex/archived_sessions"), false],
    ],
  );
  const rollout = join(f.options.historyRoot, "sessions", "synthetic.jsonl");
  await writeFile(rollout, '{"type":"fixture-rollout"}\n', { mode: 0o600 });
  owner.close();
  assert.equal(owner.verifySync(), false);
  const fresh = join(f.root, "fresh-home");
  await mkdir(fresh, { mode: 0o700 });
  const second = prepare(t, {
    ...f.options,
    homeRoot: fresh,
    containerHome: join(f.root, "fresh-container"),
  });
  assert.equal(second.verifySync(), true);
  assert.equal(await readFile(rollout, "utf8"), '{"type":"fixture-rollout"}\n');
  assert.equal(
    (await readdir(f.options.historyRoot)).some((name) =>
      /auth|sqlite|queue|config/.test(name),
    ),
    false,
  );
});

test("legacy history adds a private project-state directory only after the old lease is free", async (t) => {
  const f = await fixture(t), first = prepare(t, f.options);
  const rollout = join(f.options.historyRoot, "sessions", "fixture.jsonl");
  await writeFile(rollout, '{"fixture":true}\n', { mode: 0o600 });
  first.close();
  await rm(join(f.options.historyRoot, "project-state"), { recursive: true, force: true });
  const lease = join(f.options.historyRoot, ".lease");
  const holder = spawn("/usr/bin/flock", ["-x", lease, "/bin/sh", "-c", "printf ready; read ignored"], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => holder.stdin.end("\n"));
  await new Promise((resolve, reject) => { holder.stdout.once("data", resolve); holder.once("error", reject); });
  const busyHome = join(f.root, "busy-home"); await mkdir(busyHome, { mode: 0o700 });
  assert.throws(() => preparePersistentHistory({ ...f.options, homeRoot: busyHome }), { code: "CONTAINER_HISTORY_BUSY" });
  await assert.rejects(lstat(join(f.options.historyRoot, "project-state")), { code: "ENOENT" });
  holder.stdin.end("\n"); await once(holder, "exit");
  const nextHome = join(f.root, "next-home"); await mkdir(nextHome, { mode: 0o700 });
  const next = prepare(t, { ...f.options, homeRoot: nextHome });
  assert.equal(next.projectStateRoot, join(f.options.historyRoot, "project-state"));
  assert.equal((await lstat(next.projectStateRoot)).mode & 0o7777, 0o700);
  assert.equal(await readFile(rollout, "utf8"), '{"fixture":true}\n');
  assert.equal(next.verifySync(), true);
});

test("account refresh preserves its history identity while source logout, switch or target switch immediately blocks writes", async (t) => {
  for (const mutation of [
    "refresh",
    "logout",
    "source-switch",
    "target-switch",
  ]) {
    const f = await fixture(t, true),
      owner = prepare(t, f.options);
    const snapshot = join(f.options.homeRoot, ".codex/auth.json");
    if (mutation === "refresh") {
      await writeFile(
        f.options.accountSourceFile,
        JSON.stringify(auth("account-a", "subject-a", 200)),
        { mode: 0o600 },
      );
      await writeFile(
        snapshot,
        JSON.stringify(auth("account-a", "subject-a", 200)),
        { mode: 0o600 },
      );
    } else if (mutation === "logout") await rm(f.options.accountSourceFile);
    else
      await writeFile(
        mutation === "source-switch" ? f.options.accountSourceFile : snapshot,
        JSON.stringify(auth("account-b", "subject-b")),
        { mode: 0o600 },
      );
    assert.equal(owner.verifySync(), mutation === "refresh", mutation);
    const manifest = await readFile(
      join(f.options.historyRoot, "manifest.json"),
      "utf8",
    );
    assert.equal(
      /account-a|subject-a|id_token|access_token|refresh_token|issuer.test/.test(
        manifest,
      ),
      false,
    );
  }
});

test("a root cannot be silently adopted for another account or anonymous login", async (t) => {
  const f = await fixture(t, true),
    owner = prepare(t, f.options);
  owner.close();
  const fresh = await mkdtemp("/dev/shm/desktop-history-home-");
  t.after(() => rm(fresh, { recursive: true, force: true }));
  await chmod(fresh, 0o700);
  await mkdir(join(fresh, ".codex"), { mode: 0o700 });
  await writeFile(
    join(fresh, ".codex/auth.json"),
    JSON.stringify(auth("account-b", "subject-b")),
    { mode: 0o600 },
  );
  await writeFile(
    f.options.accountSourceFile,
    JSON.stringify(auth("account-b", "subject-b")),
    { mode: 0o600 },
  );
  assert.throws(
    () => preparePersistentHistory({ ...f.options, homeRoot: fresh }),
    { code: "CONTAINER_HISTORY_ACCOUNT_CHANGED" },
  );
  const anonymous = await fixture(t),
    plain = prepare(t, anonymous.options);
  await writeFile(
    join(anonymous.options.homeRoot, ".codex/auth.json"),
    JSON.stringify(auth()),
    { mode: 0o600 },
  );
  assert.equal(plain.verifySync(), false);
});

test("existing user data, symlinks, broad modes and protected overlaps are refused without migration", async (t) => {
  for (const kind of ["existing", "symlink", "permissions", "overlap"]) {
    const f = await fixture(t);
    if (kind === "existing")
      await writeFile(
        join(f.options.historyRoot, "auth.json"),
        "do not touch",
        { mode: 0o600 },
      );
    if (kind === "symlink") {
      await rm(f.options.historyRoot, { recursive: true });
      await symlink(f.options.homeRoot, f.options.historyRoot);
    }
    if (kind === "permissions") await chmod(f.options.historyRoot, 0o750);
    if (kind === "overlap") f.options.protectedPaths = [f.root];
    assert.throws(() => preparePersistentHistory(f.options));
    if (kind === "existing")
      assert.equal(
        await readFile(join(f.options.historyRoot, "auth.json"), "utf8"),
        "do not touch",
      );
  }
});

test("held root, directory, manifest and mounted inode replacements fail at the final synchronous guard", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options),
    original = fs.lstatSync;
  owner.bindProcess({
    containerId: "a".repeat(64),
    identity: readContainerProcessIdentitySync(process.pid),
    verifyProcess: (pid) => pid === process.pid,
  });
  const aliases = new Map(
    owner.bindings.map((binding) => [
      "/proc/" + process.pid + "/root" + binding.destination,
      binding.source,
    ]),
  );
  fs.lstatSync = (path, ...args) =>
    original(aliases.get(String(path)) ?? path, ...args);
  syncBuiltinESMExports();
  try {
    assert.equal(
      owner.verifyMountedSync({
        pid: process.pid,
        verifyProcess: (pid) => pid === process.pid,
      }),
      true,
    );
    assert.equal(
      owner.verifyMountedSync({ pid: process.pid, verifyProcess: () => false }),
      false,
    );
    aliases.set(
      "/proc/" + process.pid + "/root" + owner.bindings[2].destination,
      f.options.homeRoot,
    );
    assert.equal(
      owner.verifyMountedSync({ pid: process.pid, verifyProcess: () => true }),
      false,
    );
  } finally {
    fs.lstatSync = original;
    syncBuiltinESMExports();
  }
  await rename(
    join(f.options.historyRoot, "sessions"),
    join(f.options.historyRoot, "replaced"),
  );
  await mkdir(join(f.options.historyRoot, "sessions"), { mode: 0o700 });
  assert.equal(owner.verifySync(), false);
});

test("a durable namespace-init anchor prevents history reuse until the exact old process has exited", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options);
  const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
    env: {},
    stdio: ["pipe", "ignore", "ignore"],
  });
  const exited = once(child, "exit");
  t.after(() => child.stdin.end());
  const identity = readContainerProcessIdentitySync(child.pid);
  owner.bindProcess({
    containerId: "b".repeat(64),
    identity,
    verifyProcess: (pid) => pid === child.pid,
  });
  owner.close();
  const home = join(f.root, "next-home");
  await mkdir(home, { mode: 0o700 });
  assert.throws(
    () => preparePersistentHistory({ ...f.options, homeRoot: home }),
    { code: "CONTAINER_HISTORY_BUSY" },
  );
  child.stdin.end();
  await exited;
  const next = prepare(t, { ...f.options, homeRoot: home });
  assert.equal(next.verifySync(), true);
  const lease = join(f.options.historyRoot, ".lease");
  const holder = spawn("/usr/bin/flock", ["-x", lease, "/bin/sh", "-c", "printf ready; read ignored"], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => holder.stdin.end("\n"));
  await new Promise((resolve, reject) => { holder.stdout.once("data", resolve); holder.once("error", reject); });
  assert.throws(() => next.withPreviousOwnerLease(() => true), { code: "CONTAINER_HISTORY_BUSY" });
  const holderExit = once(holder, "exit"); holder.stdin.end("\n"); await holderExit;
  assert.equal(next.withPreviousOwnerLease(() => "sealed-under-lease"), "sealed-under-lease");
});

test("history inspection requires exact recursive restrictions and read/write permissions for every fixed bind", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options);
  const mounts = owner.bindings.map((m) => ({
      Type: "bind",
      Source: m.source,
      Destination: m.destination,
      RW: !m.readOnly,
      Propagation: "rprivate",
    })),
    host = {
      Mounts: owner.bindings.map((m, i) => ({
        Type: "bind",
        Source: m.source,
        Target: m.destination,
        ReadOnly: m.readOnly,
        ...(i !== 1 ? { BindOptions: { NonRecursive: true } } : {}),
      })),
      Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=268435456" },
      Binds: null,
      VolumesFrom: null,
    };
  assert.equal(owner.assertInspection({ mounts, host }), true);
  for (const change of [
    (v) => {
      v.mounts[0].RW = true;
    },
    (v) => {
      v.host.Mounts[2].BindOptions.NonRecursive = false;
    },
    (v) => {
      v.host.Mounts[1].ReadOnly = true;
    },
    (v) => {
      v.host.Tmpfs["/extra"] = "rw";
    },
    (v) => {
      v.mounts.pop();
    },
  ]) {
    const value = structuredClone({ mounts, host });
    change(value);
    assert.throws(() => owner.assertInspection(value), {
      code: "CONTAINER_IDENTITY_CHANGED",
    });
  }
});

test("the strict initial Codex preference includes only the two held empty history mountpoints", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options),
    preference = await prepareInitialCodexMode({
      homeRoot: f.options.homeRoot,
      homeIdentity: await lstat(f.options.homeRoot, { bigint: true }),
      accountSeeded: false,
      historyDirectories: true,
    });
  t.after(() => preference.close());
  assert.equal(preference.verifyBeforeGrant(), true);
  assert.equal(owner.verifySync(), true);
  await chmod(join(f.options.homeRoot, ".codex/sessions"), 0o750);
  assert.equal(preference.verifyBeforeGrant(), false);
  assert.equal(owner.verifySync(), false);
});

test("the coordinator kernel lease prevents another native writer and survives host descriptor closure", async (t) => {
  const f = await fixture(t),
    owner = prepare(t, f.options),
    coordinator = fileURLToPath(
      new URL("../src/container-bridge.py", import.meta.url),
    );
  const program = `import importlib.util,sys,os\ns=importlib.util.spec_from_file_location('coordinator',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.HISTORY_ROOT=sys.argv[2]\ntry: fd=m.acquire_history_lease(sys.argv[3])\nexcept BlockingIOError: raise SystemExit(75)\nprint('locked',flush=True)\nif len(sys.argv)>4: sys.stdin.read(1)\nos.close(fd)\n`;
  const args = [
    "-I",
    "-u",
    "-B",
    "-c",
    program,
    coordinator,
    f.options.historyRoot,
    owner.accountBinding,
  ];
  const held = spawn("/usr/bin/python3", [...args, "hold"], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => held.stdin.end());
  const exited = once(held, "exit");
  await Promise.race([
    once(held.stdout, "data"),
    exited.then(() => {
      throw Error("coordinator lease failed");
    }),
  ]);
  await assert.rejects(
    exec("/usr/bin/python3", args, { env: {}, timeout: 2000 }),
    { code: 75 },
  );
  owner.close();
  await assert.rejects(
    exec("/usr/bin/python3", args, { env: {}, timeout: 2000 }),
    { code: 75 },
  );
  held.stdin.end();
  assert.equal((await exited)[0], 0);
  assert.equal(
    (
      await exec("/usr/bin/python3", args, { env: {}, timeout: 2000 })
    ).stdout.trim(),
    "locked",
  );
});

test('an account guard verifies both account files exactly at mounted-check boundaries on every write', async (t) => {
  const f = await fixture(t, true), owner = prepare(t, f.options);
  const identity = readContainerProcessIdentitySync(process.pid);
  owner.bindProcess({containerId: 'a'.repeat(64), identity, verifyProcess: (pid) => pid === process.pid});
  const aliases = new Map(owner.bindings.map((binding) => ['/proc/' + process.pid + '/root' + binding.destination, binding.source]));
  const lstatOriginal = fs.lstatSync, openOriginal = fs.openSync;
  let localReads = 0, sourceReads = 0;
  fs.lstatSync = (path, ...args) => lstatOriginal(aliases.get(String(path)) ?? path, ...args);
  fs.openSync = (path, ...args) => {
    if (String(path) === join(f.options.homeRoot, '.codex', 'auth.json')) localReads++;
    if (String(path) === f.options.accountSourceFile) sourceReads++;
    return openOriginal(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const guard = createContainerProjectGuard(owner, identity);
    assert.equal(guard(), true);
    assert.deepEqual([localReads, sourceReads], [2, 2], 'the leading and final mounted checks each reread both account files');
    assert.equal(guard(), true);
    assert.deepEqual([localReads, sourceReads], [4, 4], 'each subsequent write repeats the full boundary checks');
    const impostor = Object.freeze({...owner, verifySync: () => false});
    assert.equal(createContainerProjectGuard(impostor, identity)(), false,
      'a copied or synthetic owner cannot bypass its independent initial check');
    await writeFile(f.options.accountSourceFile, JSON.stringify(auth('other-account')), { mode: 0o600 });
    assert.equal(guard(), false, 'an account change is rejected on the next write');
  } finally { fs.openSync = openOriginal; fs.lstatSync = lstatOriginal; syncBuiltinESMExports(); }
});


test('account replacement during the mounted walk is rejected by the final check', async (t) => {
  const f = await fixture(t, true), owner = prepare(t, f.options);
  const identity = readContainerProcessIdentitySync(process.pid);
  owner.bindProcess({containerId: 'a'.repeat(64), identity, verifyProcess: (pid) => pid === process.pid});
  const aliases = new Map(owner.bindings.map((binding) => ['/proc/' + process.pid + '/root' + binding.destination, binding.source]));
  const original = fs.lstatSync;
  let changed = false;
  fs.lstatSync = (path, ...args) => {
    if (!changed && aliases.has(String(path))) {
      changed = true;
      fs.writeFileSync(f.options.accountSourceFile, JSON.stringify(auth('other-account')), {mode: 0o600});
    }
    return original(aliases.get(String(path)) ?? path, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(createContainerProjectGuard(owner, identity)(), false);
    assert.equal(changed, true);
  } finally { fs.lstatSync = original; syncBuiltinESMExports(); }
});

test('account verification allocates only bounded actual file sizes and remains fresh', async (t) => {
  const f = await fixture(t, true), owner = prepare(t, f.options);
  const original = Buffer.alloc;
  let fullLimitAllocations = 0;
  Buffer.alloc = function(size, ...args) {
    if (size === 256 * 1024 + 1) fullLimitAllocations++;
    return original.call(Buffer, size, ...args);
  };
  try {
    const start = performance.now();
    for (let n = 0; n < 32; n++) assert.equal(owner.verifySync(), true);
    console.log(JSON.stringify({verifyRuns:32,fullLimitAllocations,elapsedMs:performance.now() - start}));
    assert.equal(fullLimitAllocations, 0);
    await writeFile(f.options.accountSourceFile, JSON.stringify(auth('changed-account')), { mode: 0o600 });
    assert.equal(owner.verifySync(), false);
  } finally { Buffer.alloc = original; }
});

test('account read rejects growth or pathname replacement during the held-FD read', async (t) => {
  for (const change of ['grow', 'replace']) {
    const f = await fixture(t, true), owner = prepare(t, f.options);
    const openOriginal = fs.openSync, readOriginal = fs.readSync;
    let sourceFd, changed = false;
    fs.openSync = (path, ...args) => {
      const fd = openOriginal(path, ...args);
      if (String(path) === f.options.accountSourceFile) sourceFd = fd;
      return fd;
    };
    fs.readSync = (fd, ...args) => {
      if (fd !== sourceFd || changed) return readOriginal(fd, ...args);
      changed = true;
      if (change === 'grow') {
        const writer = openOriginal(f.options.accountSourceFile, 'a');
        try { fs.writeSync(writer, Buffer.from(' ')); } finally { fs.closeSync(writer); }
        return readOriginal(fd, ...args);
      }
      const count = readOriginal(fd, ...args);
      fs.renameSync(f.options.accountSourceFile, f.options.accountSourceFile + '.old');
      fs.writeFileSync(f.options.accountSourceFile, JSON.stringify(auth()), { mode: 0o600 });
      return count;
    };
    syncBuiltinESMExports();
    try {
      assert.equal(owner.verifySync(), false, change);
      assert.equal(changed, true);
    } finally {
      fs.openSync = openOriginal; fs.readSync = readOriginal; syncBuiltinESMExports();
    }
  }
});
