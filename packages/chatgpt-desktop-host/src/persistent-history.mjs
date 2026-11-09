import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  readlinkSync,
  statSync,
  statfsSync,
  writeFileSync,
  fsyncSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { desktopAccountIdentityDigest } from "./account-sync.mjs";
import { captureContainerRecoveryIdentity } from "./container-recovery-identity.mjs";

export const HISTORY_CONTROL_PATH = "/kanban-codex-history";
const DATA = Object.freeze(["sessions", "archived_sessions"]);
const LEGACY_NAMES = Object.freeze([
  ".lease",
  "archived_sessions",
  "manifest.json",
  "owner.json",
  "sessions",
]);
const NAMES = Object.freeze([...LEGACY_NAMES, "project-state"].sort());
const MAX_AUTH = 256 * 1024;
const TMPFS = 0x01021994n;
const fail = (code) =>
  Object.assign(new Error("Private desktop history unavailable"), { code });
const invalid = () => fail("CONTAINER_HISTORY_INVALID_CONFIG");
const unsafe = () => fail("CONTAINER_HISTORY_UNSAFE_PATH");
const changed = () => fail("CONTAINER_IDENTITY_CHANGED");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pathOK = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  Buffer.byteLength(value) <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[,\x00-\x1f\x7f]/.test(value);
const contains = (a, b) => {
  const p = relative(a, b);
  return !p || (p !== ".." && !p.startsWith("../") && !isAbsolute(p));
};
const overlaps = (a, b) => contains(a, b) || contains(b, a);
const sameDir = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);
const sameFile = (a, b) =>
  sameDir(a, b) &&
  ["size", "mtimeNs", "ctimeNs", "nlink"].every((key) => a[key] === b[key]);
const plain = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

/** Optional server-only root; filesystem authority is acquired separately. */
export function normalizePersistentHistoryRoot(value) {
  if (value === undefined) return undefined;
  if (!pathOK(value)) throw invalid();
  return value;
}

function privateDirectory(path, uid) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = fstatSync(fd, { bigint: true });
    if (
      !info.isDirectory() ||
      info.uid !== uid ||
      (info.mode & 0o7777n) !== 0o700n ||
      realpathSync(path) !== path ||
      !sameDir(info, lstatSync(path, { bigint: true }))
    )
      throw unsafe();
    return { fd, path, info, directory: true };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function privateFile(path, uid, writable = false) {
  const fd = openSync(
    path,
    (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW,
  );
  try {
    const info = fstatSync(fd, { bigint: true });
    if (
      !info.isFile() ||
      info.uid !== uid ||
      (info.mode & 0o7777n) !== 0o600n ||
      info.nlink !== 1n ||
      realpathSync(path) !== path ||
      !sameFile(info, lstatSync(path, { bigint: true }))
    )
      throw unsafe();
    return { fd, path, info, directory: false };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function readFixedFile(entry, maximum) {
  const before = fstatSync(entry.fd, { bigint: true });
  if (before.size > BigInt(maximum) || !sameFile(entry.info, before))
    throw changed();
  // The open FD was just checked against its immutable identity. Allocate
  // only its current size plus one byte so growth is detected immediately;
  // the absolute maximum and both post-read identity checks still apply.
  const expectedSize = Number(before.size);
  const buffer = Buffer.alloc(expectedSize + 1);
  try {
    let length = 0;
    for (;;) {
      const n = readSync(
        entry.fd,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!n) break;
      length += n;
      if (length > expectedSize) throw changed();
    }
    if (
      !sameFile(before, fstatSync(entry.fd, { bigint: true })) ||
      !sameFile(before, lstatSync(entry.path, { bigint: true }))
    )
      throw changed();
    return Buffer.from(buffer.subarray(0, length));
  } finally {
    buffer.fill(0);
  }
}
function accountBinding(codex, uid, accountSeeded, sourceFile) {
  const path = join(codex.path, "auth.json");
  if (!accountSeeded) {
    try {
      lstatSync(path);
      throw changed();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return sha("kanban-codex-history-v1\0anonymous");
  }
  const entry = privateFile(path, uid);
  let source, bytes, sourceBytes;
  try {
    source = privateFile(sourceFile, uid);
    bytes = readFixedFile(entry, MAX_AUTH);
    sourceBytes = readFixedFile(source, MAX_AUTH);
    const digest = desktopAccountIdentityDigest(bytes);
    if (desktopAccountIdentityDigest(sourceBytes) !== digest) throw changed();
    return digest;
  } finally {
    bytes?.fill(0);
    sourceBytes?.fill(0);
    closeSync(entry.fd);
    if (source) closeSync(source.fd);
  }
}

function ownerRecord(bytes) {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!plain(value) || value.version !== 1) throw unsafe();
  if (
    value.state === "unbound" &&
    Object.keys(value).sort().join(",") === "state,version"
  )
    return value;
  if (
    Object.keys(value).sort().join(",") !==
      "containerId,pid,pidns,startTicks,state,uid,version" ||
    value.state !== "bound" ||
    !/^[a-f0-9]{64}$/.test(value.containerId ?? "") ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    !Number.isSafeInteger(value.uid) ||
    value.uid < 0 ||
    !/^[0-9]{1,30}$/.test(value.startTicks ?? "") ||
    !/^pid:\[[0-9]+\]$/.test(value.pidns ?? "")
  )
    throw unsafe();
  return value;
}
function previousInitExists(value) {
  if (value.state === "unbound") return false;
  try {
    const raw = readFileSync("/proc/" + value.pid + "/stat", "utf8"),
      end = raw.lastIndexOf(") ");
    if (raw.slice(0, raw.indexOf(" (")) !== String(value.pid) || end < 1)
      throw unsafe();
    const fields = raw
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    // A matching init remains protected even while zombie/exiting. A missing
    // or demonstrably reused PID proves the original PID namespace is gone.
    if (!/^[0-9]{1,30}$/.test(fields[19] ?? "")) throw unsafe();
    return fields[19] === value.startTicks;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw unsafe();
  }
}

// The kernel reports a flock against the open file description and its
// acquiring PID. A busy lock alone is insufficient: an unrelated process may
// own it. Verify the original bridge's exact process identity on both sides
// of the fd/lock inspection and require its fd to reference the held inode.
function sameLiveProcess(expected, includeMountNamespace = false) {
  try {
    const root = `/proc/${expected.pid}`;
    const stat = readFileSync(join(root, "stat"), "utf8");
    const end = stat.lastIndexOf(") ");
    const fields = end < 0 ? [] : stat.slice(end + 2).trim().split(/\s+/);
    return (
      stat.slice(0, stat.indexOf(" (")) === String(expected.pid) &&
      fields[19] === expected.startTicks &&
      /^[RSDTtWPKI]$/.test(fields[0] ?? "") &&
      Number(lstatSync(root, { bigint: true }).uid) === expected.uid &&
      readlinkSync(join(root, "ns/pid")) === expected.pidns &&
      (!includeMountNamespace ||
        readlinkSync(join(root, "ns/mnt")) === expected.mntns)
    );
  } catch {
    return false;
  }
}
function bridgeHoldsLease(lease, bridge, verifyOwnedProcess) {
  try {
    const verify = () =>
      verifyOwnedProcess() === true && sameLiveProcess(bridge, true);
    if (!verify() || !sameFile(lease.info, fstatSync(lease.fd, { bigint: true })))
      return false;
    const root = `/proc/${bridge.pid}`;
    const fds = readdirSync(join(root, "fd"));
    if (fds.length > 4096) return false;
    let held = false;
    for (const fd of fds) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(fd)) return false;
      try {
        const info = statSync(join(root, "fd", fd), { bigint: true });
        if (info.dev !== lease.info.dev || info.ino !== lease.info.ino) continue;
        const lines = readFileSync(join(root, "fdinfo", fd), "utf8").split("\n");
        held = lines.some((line) => {
          const match = /^lock:\s*\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/i.exec(line);
          return !!match && Number(match[1]) === bridge.pid && BigInt(match[2]) === lease.info.ino;
        });
        if (held) break;
      } catch (error) {
        if (error?.code !== "ENOENT") return false;
      }
    }
    return held && verify() && sameFile(lease.info, fstatSync(lease.fd, { bigint: true }));
  } catch {
    return false;
  }
}

// Acquire only the already-owned legacy lease. The descriptor is inherited by
// flock, so the parent holds the same open-file-description lock until unlock.
function migrateProjectDirectory(root, writer, previous, lease) {
  const binary = "/usr/bin/flock", info = lstatSync(binary, { bigint: true });
  if (!info.isFile() || (info.uid !== 0n && info.uid !== BigInt(process.getuid())) || (info.mode & 0o022n) !== 0n || realpathSync(binary) !== binary) throw unsafe();
  const invoke = (args) => spawnSync(binary, [...args, "3"], { shell: false, timeout: 1000, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "ignore", "ignore", lease.fd] });
  const lock = invoke(["-x", "-n"]);
  if (lock.status === 1) throw fail("CONTAINER_HISTORY_BUSY");
  if (lock.status !== 0 || lock.error || lock.signal) throw unsafe();
  try {
    if (previousInitExists(previous)) throw fail("CONTAINER_HISTORY_BUSY");
    if (!sameFile(writer.info, fstatSync(writer.fd, { bigint: true })) || !sameFile(writer.info, lstatSync(writer.path, { bigint: true })) ||
        !sameDir(root.info, lstatSync(root.path, { bigint: true })) || !sameDir(root.info, fstatSync(root.fd, { bigint: true }))) throw changed();
    mkdirSync(join(`/proc/self/fd/${root.fd}`, "project-state"), { mode: 0o700 });
    fsyncSync(root.fd);
    if (!sameFile(writer.info, lstatSync(writer.path, { bigint: true })) || previousInitExists(previous)) throw changed();
  } finally {
    const unlock = invoke(["-u"]);
    if (unlock.status !== 0 || unlock.error || unlock.signal) throw unsafe();
  }
}

/**
 * Own only this deployment's rollout directories. No auth, config, SQLite,
 * queue, plugin or user-data tree is copied into the persistent directory.
 * The container's fixed coordinator holds .lease with flock for its lifetime.
 */
// The brand identifies only immutable owners created below. It holds no
// account data or verification result, and grants no authority by itself.
const mountedHistoryOwners = new WeakSet();
export function hasSelfVerifyingHistoryMount(value) {
  return mountedHistoryOwners.has(value);
}

export function preparePersistentHistory(options) {
  return prepareHistory(options, null);
}

/**
 * Reopen only the already-bound live owner's history, without creating or
 * migrating anything. The caller supplies the supervisor's trusted startup
 * anchors and a synchronous guard for all original owned processes.
 */
export function reopenPersistentHistoryForReattach(options, context) {
  try {
    if (!plain(context) || Reflect.ownKeys(context).length !== 3) throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(context);
    for (const key of ["owner", "bridge", "verifyOwnedProcess"])
      if (!Object.hasOwn(descriptors[key] ?? {}, "value")) throw Error();
    const originalOwner = descriptors.owner.value;
    const originalBridge = descriptors.bridge.value;
    const callback = descriptors.verifyOwnedProcess.value;
    if (!plain(originalOwner) || !plain(originalBridge) || typeof callback !== "function") throw Error();
    const ownerFields = ["version", "state", "containerId", "pid", "startTicks", "pidns", "uid"];
    const ownerDescriptors = Object.getOwnPropertyDescriptors(originalOwner);
    if (Reflect.ownKeys(ownerDescriptors).length !== ownerFields.length ||
        ownerFields.some((key) => !Object.hasOwn(ownerDescriptors[key] ?? {}, "value"))) throw Error();
    const rawOwner = Object.fromEntries(ownerFields.map((key) => [key, ownerDescriptors[key].value]));
    if (rawOwner.version !== 1 || rawOwner.state !== "bound" ||
        typeof rawOwner.containerId !== "string" || typeof rawOwner.pid !== "number" ||
        typeof rawOwner.startTicks !== "string" || typeof rawOwner.pidns !== "string" ||
        typeof rawOwner.uid !== "number") throw Error();
    const owner = ownerRecord(Buffer.from(JSON.stringify(rawOwner)));
    if (owner.state !== "bound") throw Error();
    const bridgeDescriptors = Object.getOwnPropertyDescriptors(originalBridge);
    for (const key of ["pid", "ticks", "uid", "pidns", "mntns"])
      if (!Object.hasOwn(bridgeDescriptors[key] ?? {}, "value")) throw Error();
    const bridge = {
      pid: bridgeDescriptors.pid.value,
      startTicks: bridgeDescriptors.ticks.value,
      uid: bridgeDescriptors.uid.value,
      pidns: bridgeDescriptors.pidns.value,
      mntns: bridgeDescriptors.mntns.value,
    };
    if (!Number.isSafeInteger(bridge.pid) || bridge.pid <= 1 ||
        !Number.isSafeInteger(bridge.uid) || bridge.uid !== owner.uid ||
        !/^[0-9]{1,30}$/.test(bridge.startTicks ?? "") ||
        !/^pid:\[[0-9]+\]$/.test(bridge.pidns ?? "") ||
        !/^mnt:\[[0-9]+\]$/.test(bridge.mntns ?? "") ||
        bridge.pidns !== owner.pidns) throw Error();
    const verifyOwnedProcess = () => {
      const result = callback();
      if (result instanceof Promise) void result.catch(() => {});
      return result === true;
    };
    return prepareHistory(options, { owner, bridge, verifyOwnedProcess });
  } catch {
    throw fail("CONTAINER_HISTORY_REATTACH_DENIED");
  }
}

/** Reopen the history already owned by the exact container in a startup witness. */
export function reopenContainerHistoryForRecovery(options, identity, verifyOwnedProcess) {
  let reopened;
  try {
    const witness = captureContainerRecoveryIdentity(identity);
    const seeded = Object.getOwnPropertyDescriptor(options ?? {}, "accountSeeded");
    if (!Object.hasOwn(seeded ?? {}, "value") || typeof seeded.value !== "boolean" ||
        seeded.value !== (witness.account.kind === "chatgpt") ||
        typeof verifyOwnedProcess !== "function" || verifyOwnedProcess() !== true)
      throw Error();
    const { init, bridge } = witness.processes;
    const owner = {
      version: 1, state: "bound", containerId: witness.containerId,
      pid: init.pid, startTicks: init.ticks, pidns: init.pidns, uid: init.uid,
    };
    reopened = reopenPersistentHistoryForReattach(options, { owner, bridge, verifyOwnedProcess });
    if ((seeded.value && reopened.accountBinding !== witness.account.binding) ||
        !reopened.verifySync() || verifyOwnedProcess() !== true) throw Error();
    return reopened;
  } catch {
    reopened?.close();
    throw fail("CONTAINER_HISTORY_REATTACH_DENIED");
  }
}

function prepareHistory(options, reattach) {
  const uid = BigInt(process.getuid()),
    handles = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const h of handles.reverse())
      try {
        closeSync(h.fd);
      } catch {}
  };
  try {
    if (process.platform !== "linux" || !plain(options)) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(options),
      keys = Object.keys(descriptors);
    if (
      keys.some(
        (k) =>
          ![
            "historyRoot",
            "homeRoot",
            "containerHome",
            "protectedPaths",
            "accountSeeded",
            "accountSourceFile",
          ].includes(k),
      ) ||
      keys.some((k) => !Object.hasOwn(descriptors[k], "value"))
    )
      throw invalid();
    const {
      historyRoot,
      homeRoot,
      containerHome,
      protectedPaths,
      accountSeeded,
      accountSourceFile,
    } = Object.fromEntries(keys.map((k) => [k, descriptors[k].value]));
    if (
      normalizePersistentHistoryRoot(historyRoot) === undefined ||
      !pathOK(homeRoot) ||
      !pathOK(containerHome) ||
      typeof accountSeeded !== "boolean" ||
      (accountSeeded
        ? !pathOK(accountSourceFile)
        : accountSourceFile !== undefined) ||
      !Array.isArray(protectedPaths) ||
      protectedPaths.length > 64 ||
      protectedPaths.some((p) => !pathOK(p)) ||
      [homeRoot, containerHome, ...protectedPaths].some((p) =>
        overlaps(historyRoot, p),
      ) ||
      [
        "/proc",
        "/sys",
        "/dev",
        "/run",
        "/bridge",
        "/package",
        "/opt/private-node",
        HISTORY_CONTROL_PATH,
      ].some((p) => overlaps(historyRoot, p))
    )
      throw invalid();
    const home = privateDirectory(homeRoot, uid);
    handles.push(home);
    if (accountSeeded && statfsSync(homeRoot, { bigint: true }).type !== TMPFS)
      throw unsafe();
    const codexPath = join(homeRoot, ".codex");
    try {
      lstatSync(codexPath);
    } catch (error) {
      if (error.code !== "ENOENT" || accountSeeded || reattach) throw error;
      mkdirSync(join("/proc/self/fd/" + home.fd, ".codex"), { mode: 0o700 });
    }
    const codex = privateDirectory(codexPath, uid);
    handles.push(codex);
    if (accountSeeded) {
      const source = privateDirectory(dirname(accountSourceFile), uid);
      handles.push(source);
      if (overlaps(historyRoot, source.path)) throw invalid();
    }
    const binding = accountBinding(
        codex,
        uid,
        accountSeeded,
        accountSourceFile,
      ),
      root = privateDirectory(historyRoot, uid);
    handles.push(root);
    if (statfsSync(historyRoot, { bigint: true }).type === TMPFS)
      throw unsafe();
    const fdRoot = "/proc/self/fd/" + root.fd,
      names = readdirSync(fdRoot).sort();
    const legacy = names.length === LEGACY_NAMES.length && names.every((name, index) => name === LEGACY_NAMES[index]);
    if (!names.length) {
      if (reattach) throw changed();
      for (const name of DATA) mkdirSync(join(fdRoot, name), { mode: 0o700 });
      mkdirSync(join(fdRoot, "project-state"), { mode: 0o700 });
      for (const [name, body] of [
        [".lease", ""],
        ["owner.json", JSON.stringify({ version: 1, state: "unbound" }) + "\n"],
        [
          "manifest.json",
          JSON.stringify({
            version: 1,
            kind: "codex-rollouts",
            accountBinding: binding,
          }) + "\n",
        ],
      ]) {
        const fd = openSync(
          join(fdRoot, name),
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFileSync(fd, body);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      fsyncSync(root.fd);
    } else if (!legacy && (
      names.length !== NAMES.length ||
      names.some((n, i) => n !== NAMES[i])
    ))
      throw unsafe();
    const manifest = privateFile(join(historyRoot, "manifest.json"), uid);
    handles.push(manifest);
    const body = readFixedFile(manifest, 1024),
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
    body.fill(0);
    if (
      !plain(value) ||
      Object.keys(value).sort().join(",") !== "accountBinding,kind,version" ||
      value.version !== 1 ||
      value.kind !== "codex-rollouts" ||
      value.accountBinding !== binding
    )
      throw fail("CONTAINER_HISTORY_ACCOUNT_CHANGED");
    let bound = !!reattach,
      writer = privateFile(join(historyRoot, "owner.json"), uid);
    handles.push(writer);
    const previous = ownerRecord(readFixedFile(writer, 1024));
    if (previous.uid !== undefined && previous.uid !== Number(uid))
      throw unsafe();
    if (reattach) {
      if (legacy || JSON.stringify(previous) !== JSON.stringify(reattach.owner)) throw changed();
    } else if (previousInitExists(previous)) throw fail("CONTAINER_HISTORY_BUSY");
    const lease = privateFile(join(historyRoot, ".lease"), uid, true);
    handles.push(lease);
    if (lease.info.size !== 0n) throw unsafe();
    if (legacy) migrateProjectDirectory(root, writer, previous, lease);
    const verifyReattach = () => !reattach || (
      sameLiveProcess(reattach.owner) &&
      bridgeHoldsLease(lease, reattach.bridge, reattach.verifyOwnedProcess)
    );
    if (!verifyReattach()) throw changed();
    const projectState = privateDirectory(join(historyRoot, "project-state"), uid);
    handles.push(projectState);
    const data = DATA.map((name) => {
      const entry = privateDirectory(join(historyRoot, name), uid);
      handles.push(entry);
      return entry;
    });
    const targets = DATA.map((name) => {
      const path = join(codexPath, name);
      if (!reattach) {
        try {
          mkdirSync(join("/proc/self/fd/" + codex.fd, name), { mode: 0o700 });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      const entry = privateDirectory(path, uid);
      handles.push(entry);
      if (readdirSync("/proc/self/fd/" + entry.fd).length) throw unsafe();
      return entry;
    });
    const bindings = Object.freeze(
      [
        {
          source: historyRoot,
          destination: HISTORY_CONTROL_PATH,
          readOnly: true,
          entry: root,
        },
        {
          source: lease.path,
          destination: join(HISTORY_CONTROL_PATH, ".lease"),
          readOnly: false,
          entry: lease,
        },
        ...data.map((entry, i) => ({
          source: entry.path,
          destination: join(containerHome, ".codex", DATA[i]),
          readOnly: false,
          entry,
        })),
      ].map(Object.freeze),
    );
    function verifySync() {
      if (closed) return false;
      try {
        if (!verifyReattach() ||
          accountBinding(codex, uid, accountSeeded, accountSourceFile) !==
          binding
        )
          return false;
        const current = readdirSync(fdRoot).sort();
        if (
          current.length !== NAMES.length ||
          current.some((n, i) => n !== NAMES[i])
        )
          return false;
        return handles.every((entry) => {
          const a = lstatSync(entry.path, { bigint: true }),
            b = fstatSync(entry.fd, { bigint: true });
          return (
            realpathSync(entry.path) === entry.path &&
            (entry.directory
              ? sameDir(entry.info, a) && sameDir(entry.info, b)
              : sameFile(entry.info, a) && sameFile(entry.info, b))
          );
        }) && verifyReattach();
      } catch {
        return false;
      }
    }
    function verifyMountedSync({ pid, verifyProcess }) {
      if (
        !bound ||
        !Number.isSafeInteger(pid) ||
        pid <= 1 ||
        typeof verifyProcess !== "function"
      )
        return false;
      try {
        if (!verifySync() || verifyProcess(pid) !== true) return false;
        for (const mount of bindings) {
          const actual = lstatSync(
            "/proc/" + pid + "/root" + mount.destination,
            { bigint: true },
          );
          if (
            !(mount.entry.directory
              ? sameDir(mount.entry.info, actual)
              : sameFile(mount.entry.info, actual))
          )
            return false;
        }
        return verifyProcess(pid) === true && verifySync();
      } catch {
        return false;
      }
    }
    function withPreviousOwnerLease(fn) {
      if (typeof fn !== "function" || previous.state !== "bound" || bound) throw changed();
      const binary = "/usr/bin/flock", info = lstatSync(binary, { bigint: true });
      if (!info.isFile() || (info.uid !== 0n && info.uid !== uid) || (info.mode & 0o022n) !== 0n || realpathSync(binary) !== binary) throw unsafe();
      const invoke = (args) => spawnSync(binary, [...args, "3"], { shell: false, timeout: 1000, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "ignore", "ignore", lease.fd] });
      const lock = invoke(["-x", "-n"]);
      if (lock.status === 1) throw fail("CONTAINER_HISTORY_BUSY");
      if (lock.status !== 0 || lock.error || lock.signal) throw unsafe();
      try {
        if (!verifySync() || previousInitExists(previous)) throw changed();
        const value = fn();
        if (value && typeof value.then === "function") throw changed();
        if (!verifySync() || previousInitExists(previous)) throw changed();
        return value;
      } finally {
        const unlock = invoke(["-u"]);
        if (unlock.status !== 0 || unlock.error || unlock.signal) throw unsafe();
      }
    }
    function bindProcess({ containerId, identity, verifyProcess }) {
      if (
        bound ||
        !verifySync() ||
        typeof verifyProcess !== "function" ||
        verifyProcess(identity?.pid) !== true
      )
        throw changed();
      const record = {
        version: 1,
        state: "bound",
        containerId,
        pid: identity.pid,
        startTicks: identity.ticks,
        pidns: identity.pidns,
        uid: identity.uid,
      };
      ownerRecord(Buffer.from(JSON.stringify(record)));
      if (record.uid !== Number(uid)) throw changed();
      const temporary = join(
        fdRoot,
        ".owner-" + randomBytes(16).toString("hex"),
      );
      let fd, info;
      try {
        fd = openSync(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(fd, JSON.stringify(record) + "\n");
        fsyncSync(fd);
        info = fstatSync(fd, { bigint: true });
        if (
          verifyProcess(identity.pid) !== true ||
          !sameFile(writer.info, lstatSync(writer.path, { bigint: true })) ||
          !sameDir(root.info, lstatSync(root.path, { bigint: true }))
        )
          throw changed();
        renameSync(temporary, join(fdRoot, "owner.json"));
        fsyncSync(root.fd);
        const next = privateFile(writer.path, uid),
          index = handles.indexOf(writer);
        handles[index] = next;
        closeSync(writer.fd);
        writer = next;
        bound = true;
        if (!verifySync() || verifyProcess(identity.pid) !== true)
          throw changed();
      } finally {
        if (fd !== undefined) closeSync(fd);
        try {
          if (info && sameFile(info, lstatSync(temporary, { bigint: true })))
            unlinkSync(temporary);
        } catch {}
      }
    }
    function assertInspection({ mounts, host }) {
      if (
        !verifySync() ||
        !Array.isArray(mounts) ||
        !Array.isArray(host?.Mounts) ||
        (host.Binds != null &&
          (!Array.isArray(host.Binds) || host.Binds.length)) ||
        (host.VolumesFrom != null &&
          (!Array.isArray(host.VolumesFrom) || host.VolumesFrom.length)) ||
        !host.Tmpfs ||
        Object.keys(host.Tmpfs).length !== 1 ||
        host.Tmpfs["/tmp"] !== "rw,nosuid,nodev,noexec,size=268435456"
      )
        throw changed();
      for (const binding of bindings) {
        const rows = mounts.filter(
            (m) => m.Destination === binding.destination,
          ),
          settings = host.Mounts.filter(
            (m) => m.Target === binding.destination,
          );
        const row = rows[0],
          setting = settings[0],
          options = setting?.BindOptions;
        if (
          rows.length !== 1 ||
          settings.length !== 1 ||
          row.Type !== "bind" ||
          row.Source !== binding.source ||
          row.RW !== !binding.readOnly ||
          setting.Type !== "bind" ||
          setting.Source !== binding.source ||
          (setting.ReadOnly === true) !== binding.readOnly ||
          (binding.entry.directory && options?.NonRecursive !== true) ||
          options?.CreateMountpoint === true ||
          options?.ReadOnlyForceRecursive === true ||
          options?.ReadOnlyNonRecursive === true ||
          (row.Propagation != null && row.Propagation !== "rprivate") ||
          (options?.Propagation != null && options.Propagation !== "rprivate")
        )
          throw changed();
      }
      return true;
    }
    const mountArgs = Object.freeze(
      bindings.flatMap((m) => [
        "--mount",
        "type=bind,src=" +
          m.source +
          ",dst=" +
          m.destination +
          (m.readOnly ? ",readonly" : "") +
          (m.entry.directory ? ",bind-recursive=disabled" : ""),
      ]),
    );
    if (!verifySync()) throw changed();
    const owner = Object.freeze({
      accountBinding: binding,
      projectStateRoot: projectState.path,
      previousContainerId: previous.state === "bound" ? previous.containerId : null,
      bindings: Object.freeze(
        bindings.map(({ entry, ...mount }) => Object.freeze(mount)),
      ),
      mountArgs,
      verifySync,
      verifyMountedSync,
      withPreviousOwnerLease,
      bindProcess,
      assertInspection,
      close,
    });
    mountedHistoryOwners.add(owner);
    return owner;
  } catch (error) {
    close();
    throw fail(
      typeof error?.code === "string" &&
        /^CONTAINER_(?:HISTORY_[A-Z_]+|IDENTITY_CHANGED)$/.test(error.code)
        ? error.code
        : "CONTAINER_HISTORY_UNAVAILABLE",
    );
  }
}
