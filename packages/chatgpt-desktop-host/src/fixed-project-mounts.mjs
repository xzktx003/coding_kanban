import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const LIMIT = 8;
const PROTECTED_LIMIT = 64;
// Only immutable owners from this module can establish the mounted check's
// before/after contract. The brand carries no cached verification result.
const mountedProjectOwners = new WeakSet();
export function hasSelfVerifyingProjectMount(value) {
  return mountedProjectOwners.has(value);
}
const groups = Object.freeze([
  "homes",
  "auth",
  "runtime",
  "control",
  "bridge",
  "source",
  "tools",
]);
// These paths are part of the container runtime, not project destinations.
const reserved = Object.freeze([
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/usr",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/run",
  "/bridge",
  "/package",
  "/opt/private-node",
]);
const failure = (code) =>
  Object.assign(new Error("Fixed project mounts unavailable"), { code });
const invalid = () => failure("CONTAINER_PROJECT_INVALID_CONFIG");
const unsafe = () => failure("CONTAINER_PROJECT_UNSAFE_PATH");
const changed = () => failure("CONTAINER_IDENTITY_CHANGED");
const own = (object, key) => Object.hasOwn(object, key);
const validPath = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  Buffer.byteLength(value) <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const contains = (parent, child) => {
  const part = relative(parent, child);
  return (
    !part || (part !== ".." && !part.startsWith("../") && !isAbsolute(part))
  );
};
const overlaps = (a, b) => contains(a, b) || contains(b, a);
const sameDirectory = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);

// The caller is server-only, but malformed/accessor-backed inputs still fail
// closed before any path is opened or any getter executes.
function fields(value, allowed, required) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      required.some((key) => !own(descriptors, key)) ||
      keys.some((key) => !own(descriptors[key], "value"))
    )
      throw invalid();
    return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
  } catch {
    throw invalid();
  }
}
function values(value, maximum) {
  try {
    if (!Array.isArray(value)) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = descriptors.length?.value;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum ||
      keys.length !== length + 1 ||
      Array.from({ length }, (_, index) => String(index)).some(
        (key) => !own(descriptors, key) || !own(descriptors[key], "value"),
      )
    )
      throw invalid();
    return Array.from({ length }, (_, index) => descriptors[index].value);
  } catch {
    throw invalid();
  }
}

// Paths such as a not-yet-created runtime/profile are legitimate. Their nearest
// existing ancestor must still be canonical; a later symlink substitution must
// not silently change what a protected lexical path denotes.
function hasCanonicalExistingAncestor(path) {
  let current = path;
  for (let depth = 0; depth < 512; depth++) {
    try {
      const stat = lstatSync(current, { bigint: true });
      return !stat.isSymbolicLink() && realpathSync(current) === current;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
  return false;
}
function noLegacyMounts(value) {
  return value == null || (Array.isArray(value) && value.length === 0);
}

// Pure, server-only normalization shared by the host and mount authority.
// Filesystem identity and overlap with private caller paths are checked later
// by prepareFixedProjectMounts(), not by this lexical validation.
export function normalizeProjectRoots(value) {
  const roots = values(value === undefined ? [] : value, LIMIT);
  if (roots.some((path) => !validPath(path) || /[,\"]/.test(path)))
    throw invalid();
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index];
    if (
      root === "/tmp" ||
      reserved.some((path) => overlaps(path, root)) ||
      roots.slice(0, index).some((other) => overlaps(other, root))
    )
      throw unsafe();
  }
  return Object.freeze(roots);
}

/**
 * Prepare explicitly configured, same-path writable bind mounts. This helper
 * neither starts a container nor accepts destinations or commands from HTTP.
 * `protectedPaths` must enumerate the caller's complete private path set.
 * Project directory descriptors remain held until close(), and the caller must
 * recheck verifySync() immediately before an actual privileged write.
 * The mounted-root check also requires a synchronous, server-owned process
 * guard for this exact init PID and its immutable identity (including start
 * ticks); an inspect result and this check remain separate requirements.
 */
export async function prepareFixedProjectMounts(options) {
  const config = fields(
    options,
    ["projectRoots", "protectedPaths"],
    ["protectedPaths"],
  );
  const roots = normalizeProjectRoots(config.projectRoots);
  const protectedConfig = fields(config.protectedPaths, groups, groups);
  const protectedPaths = [],
    counts = new Map();
  for (const group of groups) {
    const items = values(protectedConfig[group], PROTECTED_LIMIT);
    if (items.some((path) => !validPath(path))) throw invalid();
    counts.set(group, items.length);
    protectedPaths.push(...items);
    if (protectedPaths.length > PROTECTED_LIMIT) throw invalid();
  }
  if (
    ["homes", "runtime", "bridge", "source", "tools"].some(
      (group) => counts.get(group) === 0,
    )
  )
    throw invalid();
  if (process.platform !== "linux" || !process.getuid) throw invalid();
  if (roots.some((root) => protectedPaths.some((path) => overlaps(path, root))))
    throw unsafe();
  if (protectedPaths.some((path) => !hasCanonicalExistingAncestor(path)))
    throw unsafe();
  const uid = BigInt(process.getuid());
  const entries = [];
  let closed = false,
    closePromise;
  async function close() {
    if (!closePromise) {
      closed = true;
      closePromise = Promise.allSettled(
        entries.map(({ handle }) => handle.close()),
      );
    }
    await closePromise;
  }
  function verifySync() {
    if (closed) return false;
    try {
      if (protectedPaths.some((path) => !hasCanonicalExistingAncestor(path)))
        return false;
      for (const { path, handle, info } of entries) {
        const current = lstatSync(path, { bigint: true });
        const held = fstatSync(handle.fd, { bigint: true });
        if (
          !current.isDirectory() ||
          !held.isDirectory() ||
          current.uid !== uid ||
          (current.mode & 0o002n) !== 0n ||
          realpathSync(path) !== path ||
          !sameDirectory(info, current) ||
          !sameDirectory(info, held)
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  function verifyMountedSync(options) {
    let procFd;
    try {
      const { pid, verifyProcess } = fields(
        options,
        ["pid", "verifyProcess"],
        ["pid", "verifyProcess"],
      );
      if (
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        pid > 0x7fffffff ||
        typeof verifyProcess !== "function"
      )
        return false;
      const verified = () => {
        const result = verifyProcess(pid);
        // A caller mistake must not leave an unhandled rejected Promise in the
        // manager; async guards cannot authorize a synchronous write boundary.
        if (result instanceof Promise) void result.catch(() => {});
        return result === true;
      };
      if (!verifySync() || !verified()) return false;
      // Pin the proc directory rather than re-resolving a potentially reused
      // numeric PID while walking the container's root.
      procFd = openSync(
        `/proc/${pid}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (!verified()) return false;
      for (const { path, handle, info } of entries) {
        const actual = statSync(`/proc/self/fd/${procFd}/root${path}`, {
          bigint: true,
        });
        const held = fstatSync(handle.fd, { bigint: true });
        if (
          !actual.isDirectory() ||
          !held.isDirectory() ||
          !sameDirectory(info, held) ||
          !sameDirectory(info, actual)
        )
          return false;
      }
      return verifySync() && verified();
    } catch {
      return false;
    } finally {
      if (procFd !== undefined) {
        try {
          closeSync(procFd);
        } catch {}
      }
    }
  }
  function assertInspection({ mounts, host, baseBindings } = {}) {
    try {
      if (
        !verifySync() ||
        !Array.isArray(mounts) ||
        !host ||
        typeof host !== "object" ||
        !Array.isArray(host.Mounts) ||
        !noLegacyMounts(host.Binds) ||
        !noLegacyMounts(host.VolumesFrom) ||
        !host.Tmpfs ||
        typeof host.Tmpfs !== "object" ||
        Array.isArray(host.Tmpfs) ||
        Object.keys(host.Tmpfs).length !== 1 ||
        host.Tmpfs["/tmp"] !== "rw,nosuid,nodev,noexec,size=268435456"
      )
        throw changed();
      const base = values(baseBindings, 32).map((item) => {
        const row = fields(
          item,
          ["source", "destination", "readOnly"],
          ["source", "destination", "readOnly"],
        );
        if (
          !validPath(row.source) ||
          !validPath(row.destination) ||
          typeof row.readOnly !== "boolean"
        )
          throw changed();
        return { ...row, project: false };
      });
      const expected = [
        ...base,
        ...roots.map((root) => ({
          source: root,
          destination: root,
          readOnly: false,
          project: true,
        })),
      ];
      const byDestination = new Map(
        expected.map((item) => [item.destination, item]),
      );
      if (
        byDestination.size !== expected.length ||
        mounts.length !== expected.length ||
        host.Mounts.length !== expected.length ||
        roots.some((root) =>
          base.some(
            (item) =>
              overlaps(root, item.source) || overlaps(root, item.destination),
          ),
        )
      )
        throw changed();
      const seenMounts = new Set();
      for (const entry of mounts) {
        const item = byDestination.get(entry?.Destination);
        if (
          !item ||
          seenMounts.has(entry.Destination) ||
          entry.Type !== "bind" ||
          entry.Source !== item.source ||
          entry.RW !== !item.readOnly ||
          (item.project && entry.Propagation !== "rprivate")
        )
          throw changed();
        seenMounts.add(entry.Destination);
      }
      const seenHost = new Set();
      for (const entry of host.Mounts) {
        const item = byDestination.get(entry?.Target);
        if (
          !item ||
          seenHost.has(entry.Target) ||
          entry.Type !== "bind" ||
          entry.Source !== item.source ||
          ![undefined, true, false].includes(entry.ReadOnly) ||
          (entry.ReadOnly === true) !== item.readOnly ||
          (item.project &&
            (entry.BindOptions?.NonRecursive !== true ||
              entry.BindOptions?.CreateMountpoint === true ||
              entry.BindOptions?.ReadOnlyNonRecursive === true ||
              entry.BindOptions?.ReadOnlyForceRecursive === true ||
              (entry.BindOptions?.Propagation != null &&
                entry.BindOptions.Propagation !== "rprivate")))
        )
          throw changed();
        seenHost.add(entry.Target);
      }
      return true;
    } catch {
      throw changed();
    }
  }
  try {
    for (const path of roots) {
      let handle;
      try {
        if ((await realpath(path)) !== path) throw unsafe();
        handle = await open(
          path,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        const info = await handle.stat({ bigint: true });
        const current = lstatSync(path, { bigint: true });
        if (
          !info.isDirectory() ||
          info.uid !== uid ||
          (info.mode & 0o002n) !== 0n ||
          !sameDirectory(info, current)
        )
          throw unsafe();
        entries.push({ path, handle, info });
      } catch {
        await handle?.close().catch(() => {});
        throw unsafe();
      }
    }
    if (!verifySync()) throw unsafe();
    const owner = Object.freeze({
      roots: Object.freeze([...roots]),
      mountArgs: Object.freeze(
        roots.flatMap((path) => [
          "--mount",
          `type=bind,src=${path},dst=${path},bind-recursive=disabled`,
        ]),
      ),
      verifySync,
      verify: async () => verifySync(),
      verifyMountedSync,
      assertInspection,
      close,
    });
    mountedProjectOwners.add(owner);
    return owner;
  } catch (error) {
    await close();
    throw failure(
      error?.code === "CONTAINER_PROJECT_UNSAFE_PATH"
        ? error.code
        : "CONTAINER_PROJECT_UNAVAILABLE",
    );
  }
}
