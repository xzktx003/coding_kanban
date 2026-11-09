import { randomUUID } from "node:crypto";
import { constants, fstatSync, lstatSync, readSync, realpathSync } from "node:fs";
import { link, lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const MAX_PROFILE_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEYS = [
  "version",
  "id",
  "generation",
  "pid",
  "startTicks",
  "uid",
  "macAsarPath",
  "macAsarSha256",
  "linuxAsarPath",
  "linuxAsarSha256",
  "controlSocketPath",
];
const CODES = new Set([
  "PROFILE_INVALID_CONFIG",
  "PROFILE_UNSAFE_PATH",
  "PROFILE_PATH_EXISTS",
  "PROFILE_IDENTITY_CHANGED",
  "PROFILE_RETIRED",
  "PROFILE_PUBLICATION_OUTCOME_UNKNOWN",
  "PROFILE_REVOCATION_FAILED",
  "PROFILE_UNAVAILABLE",
]);
const failure = (code) =>
  Object.assign(new Error("Profile publication unavailable"), { code });
const canonical = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const sameInode = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid"].every((key) => a[key] === b[key]);
const sameFile = (a, b) =>
  sameInode(a, b) &&
  ["size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
const defaultFs = {
  open: (...args) => open(...args),
  link: (...args) => link(...args),
  lstat: (...args) => lstat(...args),
  realpath: (...args) => realpath(...args),
};

function safeProfile(value, uid) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw failure("PROFILE_INVALID_CONFIG");
  const keys = Reflect.ownKeys(value);
  const expectedKeys = Object.hasOwn(value,"serverSshSocketPath") ? [...KEYS,"serverSshSocketPath"] : KEYS;
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  )
    throw failure("PROFILE_INVALID_CONFIG");
  const profile = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    )
      throw failure("PROFILE_INVALID_CONFIG");
    profile[key] = descriptor.value;
  }
  if (
    profile.version !== 1 ||
    typeof profile.id !== "string" ||
    !UUID.test(profile.id) ||
    typeof profile.generation !== "string" ||
    !UUID.test(profile.generation) ||
    !Number.isSafeInteger(profile.pid) ||
    profile.pid <= 1 ||
    profile.uid !== uid ||
    typeof profile.startTicks !== "string" ||
    !TICKS.test(profile.startTicks) ||
    !canonical(profile.macAsarPath) ||
    !canonical(profile.linuxAsarPath) ||
    !canonical(profile.controlSocketPath) ||
    typeof profile.macAsarSha256 !== "string" ||
    !SHA256.test(profile.macAsarSha256) ||
    typeof profile.linuxAsarSha256 !== "string" ||
    !SHA256.test(profile.linuxAsarSha256)
  )
    throw failure("PROFILE_INVALID_CONFIG");
  if (Object.hasOwn(profile,"serverSshSocketPath") &&
      (!canonical(profile.serverSshSocketPath) || basename(profile.serverSshSocketPath) !== "server-ssh.sock" ||
       profile.controlSocketPath.startsWith(dirname(profile.serverSshSocketPath) + "/")))
    throw failure("PROFILE_INVALID_CONFIG");
  const bytes = Buffer.from(JSON.stringify(profile) + "\n");
  if (bytes.length > MAX_PROFILE_BYTES) throw failure("PROFILE_INVALID_CONFIG");
  return bytes;
}

/**
 * Server-side publisher for one immutable v1 profile. The optional dependencies
 * are constructed by trusted server code only; they are never HTTP inputs.
 * The public path is never unlinked. Revocation writes only the held inode.
 */
export function createProfilePublisher(options, dependencies = {}) {
  const uid = process.getuid?.();
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).length !== 2 ||
    !Object.hasOwn(options, "profileFile") ||
    !Object.hasOwn(options, "profile") ||
    !canonical(options.profileFile) ||
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    !dependencies ||
    typeof dependencies !== "object" ||
    Array.isArray(dependencies) ||
    Object.keys(dependencies).some(
      (key) => !["fs", "beforeLink"].includes(key),
    ) ||
    (dependencies.beforeLink !== undefined &&
      typeof dependencies.beforeLink !== "function")
  )
    throw failure("PROFILE_INVALID_CONFIG");
  const overrides = dependencies.fs ?? {};
  if (
    !overrides ||
    typeof overrides !== "object" ||
    Array.isArray(overrides) ||
    Object.keys(overrides).some(
      (key) =>
        !Object.hasOwn(defaultFs, key) || typeof overrides[key] !== "function",
    )
  )
    throw failure("PROFILE_INVALID_CONFIG");
  const fs = { ...defaultFs, ...overrides };
  const useDefaultReadPath = Object.keys(overrides).length === 0;
  const beforeLink = dependencies.beforeLink ?? (() => true);
  const profileFile = options.profileFile,
    directory = dirname(profileFile),
    bytes = safeProfile(options.profile, uid);
  const sshPath = JSON.parse(bytes.toString("utf8")).serverSshSocketPath;
  let sshParent;
  if (sshPath !== undefined) {
    const path = dirname(sshPath), info = lstatSync(path,{bigint:true});
    if (!info.isDirectory() || info.uid !== BigInt(uid) || (info.mode & 0o7777n) !== 0o700n ||
        realpathSync(path) !== path || profileFile.startsWith(path + "/")) throw failure("PROFILE_UNSAFE_PATH");
    sshParent = {path,info};
  }
  const sshParentCurrent = () => {
    try { return !sshParent || (realpathSync(sshParent.path) === sshParent.path && sameInode(sshParent.info,lstatSync(sshParent.path,{bigint:true}))); }
    catch { return false; }
  };
  const temporary = join(directory, `.chatgpt-profile-${randomUUID()}.tmp`);
  let handle, identity, directoryIdentity, publishPromise, revokePromise;
  let committed = false,
    linkInFlight = false,
    mayHavePublished = false;
  let retireRequested = false,
    revoked = false,
    closed = false;

  const checkRetired = () => {
    if (retireRequested) throw failure("PROFILE_RETIRED");
  };
  async function directoryInfo() {
    if (!sshParentCurrent()) throw failure("PROFILE_IDENTITY_CHANGED");
    if ((await fs.realpath(directory)) !== directory)
      throw failure("PROFILE_UNSAFE_PATH");
    const info = await fs.lstat(directory, { bigint: true });
    if (
      !info.isDirectory() ||
      info.uid !== BigInt(uid) ||
      (info.mode & 0o7777n) !== 0o700n
    )
      throw failure("PROFILE_UNSAFE_PATH");
    return info;
  }
  async function release() {
    if (!handle || closed) return;
    try {
      await handle.close();
      closed = true;
    } catch {
      throw failure("PROFILE_REVOCATION_FAILED");
    }
  }
  async function verifyFile() {
    try {
      if (!handle || !identity || !directoryIdentity || closed) return false;
      const currentDirectory = await directoryInfo();
      if (!sameInode(directoryIdentity, currentDirectory)) return false;
      const before = await handle.stat({ bigint: true });
      const pathBefore = await fs.lstat(profileFile, { bigint: true });
      if (
        !before.isFile() ||
        !pathBefore.isFile() ||
        !sameInode(identity, before) ||
        !sameFile(before, pathBefore) ||
        before.size !== BigInt(bytes.length)
      )
        return false;
      const actual = Buffer.alloc(bytes.length);
      let offset = 0;
      while (offset < actual.length) {
        const result = await handle.read(
          actual,
          offset,
          actual.length - offset,
          offset,
        );
        if (!result.bytesRead) return false;
        offset += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      const pathAfter = await fs.lstat(profileFile, { bigint: true });
      return (
        actual.equals(bytes) &&
        sameFile(before, after) &&
        sameFile(after, pathAfter) &&
        sameInode(directoryIdentity, await directoryInfo())
      );
    } catch {
      return false;
    }
  }
  // The published profile is a small fixed local file held by this owner.
  // Keep all pre/post directory, held-FD, pathname and byte checks. No result
  // is cached; injected fs implementations continue through verifyFile().
  function verifyFileSync() {
    try {
      if (!sshParentCurrent()) return false;
      if (!handle || !identity || !directoryIdentity || closed) return false;
      const directoryInfoSync = () => {
        if (realpathSync(directory) !== directory) return null;
        const info = lstatSync(directory, { bigint: true });
        return info.isDirectory() && info.uid === BigInt(uid) &&
          (info.mode & 0o7777n) === 0o700n ? info : null;
      };
      const currentDirectory = directoryInfoSync();
      if (!currentDirectory || !sameInode(directoryIdentity, currentDirectory)) return false;
      const fd = handle.fd;
      if (!Number.isInteger(fd) || fd < 0) return false;
      const before = fstatSync(fd, { bigint: true });
      const pathBefore = lstatSync(profileFile, { bigint: true });
      if (!before.isFile() || !pathBefore.isFile() || !sameInode(identity, before) ||
          !sameFile(before, pathBefore) || before.size !== BigInt(bytes.length)) return false;
      const actual = Buffer.alloc(bytes.length);
      let offset = 0;
      while (offset < actual.length) {
        const count = readSync(fd, actual, offset, actual.length - offset, offset);
        if (!count) return false;
        offset += count;
      }
      const after = fstatSync(fd, { bigint: true });
      const pathAfter = lstatSync(profileFile, { bigint: true });
      if (!actual.equals(bytes) || !sameFile(before, after) || !sameFile(after, pathAfter)) return false;
      const finalDirectory = directoryInfoSync();
      return !!finalDirectory && sameInode(directoryIdentity, finalDirectory);
    } catch { return false; }
  }
  async function runPublish() {
    checkRetired();
    try {
      directoryIdentity = await directoryInfo();
      checkRetired();
      try {
        await fs.lstat(profileFile);
        throw failure("PROFILE_PATH_EXISTS");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      checkRetired();
      handle = await fs.open(
        temporary,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600,
      );
      checkRetired();
      identity = await handle.stat({ bigint: true });
      if (
        !identity.isFile() ||
        identity.uid !== BigInt(uid) ||
        (identity.mode & 0o7777n) !== 0o600n
      )
        throw failure("PROFILE_UNSAFE_PATH");
      await handle.writeFile(bytes);
      await handle.sync();
      checkRetired();
      if (
        !sameInode(directoryIdentity, await directoryInfo()) ||
        !sameInode(identity, await handle.stat({ bigint: true }))
      )
        throw failure("PROFILE_IDENTITY_CHANGED");
      let authorized = false;
      try {
        authorized = (await beforeLink()) === true;
      } catch {}
      if (!authorized) throw failure("PROFILE_IDENTITY_CHANGED");
      checkRetired();
      linkInFlight = true;
      try {
        await fs.link(temporary, profileFile);
      } catch (error) {
        linkInFlight = false;
        if (error?.code === "EEXIST") throw failure("PROFILE_PATH_EXISTS");
        mayHavePublished = true;
        throw failure("PROFILE_PUBLICATION_OUTCOME_UNKNOWN");
      }
      linkInFlight = false;
      mayHavePublished = true;
      checkRetired();
      if (!(await verifyFile())) throw failure("PROFILE_IDENTITY_CHANGED");
      checkRetired();
      committed = true;
    } catch (error) {
      if (!mayHavePublished && !linkInFlight) await release();
      throw failure(
        CODES.has(error?.code) ? error.code : "PROFILE_UNAVAILABLE",
      );
    }
  }
  function publish() {
    if (retireRequested) return Promise.reject(failure("PROFILE_RETIRED"));
    if (!publishPromise) publishPromise = runPublish();
    return publishPromise;
  }
  async function verify() {
    if (!committed || retireRequested || revoked || closed) return false;
    // Preserve the asynchronous publication/revocation boundary even when
    // this default local verification performs synchronous syscalls.
    const result = useDefaultReadPath ? await Promise.resolve().then(verifyFileSync) : await verifyFile();
    return result && committed && !retireRequested && !revoked && !closed;
  }
  function revoke() {
    if (revokePromise) return revokePromise;
    retireRequested = true;
    const task = (async () => {
      if (publishPromise) await publishPromise.catch(() => {});
      if (handle && mayHavePublished && !revoked) {
        const tombstone = Buffer.from('{"version":0,"state":"revoked"}\n');
        try {
          await handle.truncate(0);
          let offset = 0;
          while (offset < tombstone.length) {
            const result = await handle.write(
              tombstone,
              offset,
              tombstone.length - offset,
              offset,
            );
            if (!result.bytesWritten) throw Error();
            offset += result.bytesWritten;
          }
          await handle.sync();
          revoked = true;
        } catch {
          throw failure("PROFILE_REVOCATION_FAILED");
        }
      }
      await release();
    })();
    revokePromise = task;
    void task.catch(() => {
      if (revokePromise === task) revokePromise = undefined;
    });
    return task;
  }
  return Object.freeze({
    publish,
    verify,
    revoke,
    get published() {
      return committed && !retireRequested && !revoked && !closed;
    },
    get mayHavePublished() {
      return linkInFlight || mayHavePublished;
    },
  });
}
