import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
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
const fail = (code) =>
  Object.assign(new Error("Desktop profile alias unavailable"), { code });
const canonical = (p) =>
  typeof p === "string" &&
  p.length > 1 &&
  p.length <= 4096 &&
  isAbsolute(p) &&
  resolve(p) === p &&
  !/[\x00-\x1f\x7f]/.test(p);
const inode = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);
const sameContents = (a, b) =>
  inode(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs;
const pathFor = (root, attemptId) =>
  join(root, `g${attemptId.replaceAll("-", "")}`, "p.json");
const INTEGER = /^(?:0|[1-9][0-9]{0,19})$/;
const validAnchor = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  Object.hasOwn(value, "dev") &&
  Object.hasOwn(value, "ino") &&
  typeof value.dev === "string" &&
  typeof value.ino === "string" &&
  INTEGER.test(value.dev ?? "") &&
  INTEGER.test(value.ino ?? "") &&
  BigInt(value.dev) <= 0xffffffffffffffffn &&
  BigInt(value.ino) <= 0xffffffffffffffffn;
const anchorFor = (info) => ({
  dev: info.dev.toString(),
  ino: info.ino.toString(),
});
const matchesAnchor = (info, anchor) =>
  info.dev.toString() === anchor.dev && info.ino.toString() === anchor.ino;

async function directory(path) {
  if (!canonical(path) || (await realpath(path)) !== path) throw Error();
  const info = await lstat(path, { bigint: true });
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(process.getuid()) ||
    (info.mode & 0o7777n) !== 0o700n
  )
    throw Error();
  return info;
}
async function profileFile(path) {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await fd.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.size > 16384n ||
      !sameContents(before, await lstat(path, { bigint: true }))
    )
      throw Error();
    const bytes = Buffer.alloc(16385);
    let length = 0;
    while (length < bytes.length) {
      const part = await fd.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (
      length > 16384 ||
      !sameContents(before, await fd.stat({ bigint: true })) ||
      !sameContents(before, await lstat(path, { bigint: true }))
    )
      throw Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    const profile = JSON.parse(text);
    if (
      !profile ||
      typeof profile !== "object" ||
      Array.isArray(profile) ||
      Object.keys(profile).length !== KEYS.length ||
      !KEYS.every((key) => Object.hasOwn(profile, key)) ||
      JSON.stringify(profile) + "\n" !== text
    )
      throw Error();
    return { info: before, profile, text };
  } finally {
    await fd.close();
  }
}
async function selfTicks() {
  const text = await readFile(`/proc/${process.pid}/stat`, "utf8"),
    end = text.lastIndexOf(") ");
  if (end < 0 || text.slice(0, text.indexOf(" (")) !== String(process.pid))
    throw Error();
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (
    !/^[RSDTtWPKI]$/.test(fields[0]) ||
    !/^(?:0|[1-9][0-9]{0,29})$/.test(fields[19] ?? "")
  )
    throw Error();
  return fields[19];
}
function currentProfile(profile, current, ticks) {
  return (
    profile.version === 1 &&
    profile.id === current.profileId &&
    profile.generation === current.generation &&
    profile.pid === process.pid &&
    profile.startTicks === ticks &&
    profile.uid === process.getuid() &&
    canonical(profile.macAsarPath) &&
    SHA.test(profile.macAsarSha256 ?? "") &&
    canonical(profile.linuxAsarPath) &&
    SHA.test(profile.linuxAsarSha256 ?? "") &&
    canonical(profile.controlSocketPath)
  );
}

/** Capture the original owned profile inode before any alias mutation. */
export async function captureStableProfileCandidate({
  deploymentRoot,
  current,
  verifyLease,
} = {}) {
  if (
    !canonical(deploymentRoot) ||
    !current ||
    typeof current !== "object" ||
    !UUID.test(current.attemptId ?? "") ||
    !UUID.test(current.profileId ?? "") ||
    !UUID.test(current.generation ?? "") ||
    current.file !== pathFor(deploymentRoot, current.attemptId) ||
    typeof verifyLease !== "function"
  )
    throw fail("DESKTOP_ALIAS_INVALID_CONFIG");
  try {
    const root = await directory(deploymentRoot),
      generationDir = await directory(
        join(deploymentRoot, `g${current.attemptId.replaceAll("-", "")}`),
      );
    if ((await verifyLease()) !== true) throw Error();
    const ticks = await selfTicks(),
      before = await profileFile(current.file);
    if (!currentProfile(before.profile, current, ticks)) throw Error();
    const after = await profileFile(current.file);
    if (
      !sameContents(before.info, after.info) ||
      before.text !== after.text ||
      !inode(root, await directory(deploymentRoot)) ||
      !inode(
        generationDir,
        await directory(
          join(deploymentRoot, `g${current.attemptId.replaceAll("-", "")}`),
        ),
      ) ||
      (await verifyLease()) !== true
    )
      throw Error();
    const anchor = anchorFor(after.info);
    if (!validAnchor(anchor)) throw Error();
    return Object.freeze(anchor);
  } catch {
    throw fail("DESKTOP_ALIAS_IDENTITY_CHANGED");
  }
}

/** Read-only reconciliation of at most two journaled profile inodes. */
export async function inspectStableProfileAlias({
  deploymentRoot,
  candidates,
  mayBeAbsent,
  verifyLease,
} = {}) {
  if (
    !canonical(deploymentRoot) ||
    !Array.isArray(candidates) ||
    candidates.length > 2 ||
    typeof mayBeAbsent !== "boolean" ||
    typeof verifyLease !== "function"
  )
    throw fail("DESKTOP_ALIAS_INVALID_CONFIG");
  const names = new Set();
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.keys(candidate).length !== 3 ||
      !Object.hasOwn(candidate, "attemptId") ||
      !Object.hasOwn(candidate, "file") ||
      !Object.hasOwn(candidate, "anchor") ||
      !validAnchor(candidate.anchor) ||
      !UUID.test(candidate.attemptId ?? "") ||
      names.has(candidate.attemptId) ||
      candidate.file !== pathFor(deploymentRoot, candidate.attemptId)
    )
      throw fail("DESKTOP_ALIAS_INVALID_CONFIG");
    names.add(candidate.attemptId);
  }
  try {
    const root = await directory(deploymentRoot),
      aliasPath = join(deploymentRoot, "current.profile.json"),
      sources = [];
    if ((await verifyLease()) !== true) throw Error();
    for (const candidate of candidates) {
      const dir = await directory(
        join(deploymentRoot, `g${candidate.attemptId.replaceAll("-", "")}`),
      );
      const info = await lstat(candidate.file, { bigint: true });
      if (
        !info.isFile() ||
        info.uid !== BigInt(process.getuid()) ||
        (info.mode & 0o7777n) !== 0o600n ||
        !matchesAnchor(info, candidate.anchor) ||
        sources.some((entry) => inode(entry.info, info))
      )
        throw Error();
      sources.push({ candidate, info, dir });
    }
    let alias;
    try {
      alias = await lstat(aliasPath, { bigint: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (alias === undefined && !mayBeAbsent) throw Error();
    const matches =
      alias === undefined
        ? []
        : sources.filter((entry) => inode(entry.info, alias));
    if (alias !== undefined && (!alias.isFile() || matches.length !== 1))
      throw Error();
    if (
      (await verifyLease()) !== true ||
      !inode(root, await directory(deploymentRoot))
    )
      throw Error();
    for (const entry of sources) {
      if (
        !inode(
          entry.info,
          await lstat(entry.candidate.file, { bigint: true }),
        ) ||
        !matchesAnchor(
          await lstat(entry.candidate.file, { bigint: true }),
          entry.candidate.anchor,
        ) ||
        !inode(
          entry.dir,
          await directory(
            join(
              deploymentRoot,
              `g${entry.candidate.attemptId.replaceAll("-", "")}`,
            ),
          ),
        )
      )
        throw Error();
    }
    if (alias === undefined) {
      try {
        await lstat(aliasPath);
        throw Error();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return Object.freeze({ state: "absent" });
    }
    if (!inode(alias, await lstat(aliasPath, { bigint: true }))) throw Error();
    return Object.freeze({
      state: "matched",
      attemptId: matches[0].candidate.attemptId,
    });
  } catch {
    throw fail("DESKTOP_ALIAS_IDENTITY_CHANGED");
  }
}

/** Publish only within the private deployment held by the supervisor lease.
 * The caller proves any previous native instance has exited immediately before
 * calling this function. An alias and its per-generation profile share an inode,
 * so the existing publisher's revocation is reflected without a copied profile.
 */
export async function publishStableProfileAlias({
  deploymentRoot,
  current,
  previousAttemptId,
  verifyLease,
} = {}) {
  if (
    !canonical(deploymentRoot) ||
    !current ||
    typeof current !== "object" ||
    !UUID.test(current.attemptId ?? "") ||
    !UUID.test(current.profileId ?? "") ||
    !UUID.test(current.generation ?? "") ||
    current.file !== pathFor(deploymentRoot, current.attemptId) ||
    (previousAttemptId !== undefined &&
      (!UUID.test(previousAttemptId) ||
        previousAttemptId === current.attemptId)) ||
    typeof verifyLease !== "function"
  )
    throw fail("DESKTOP_ALIAS_INVALID_CONFIG");
  const alias = join(deploymentRoot, "current.profile.json"),
    temp = join(deploymentRoot, `.profile-link-${randomUUID()}`);
  let tempMayExist = false,
    mayHavePublished = false,
    source;
  try {
    const root = await directory(deploymentRoot),
      currentDir = await directory(
        join(deploymentRoot, `g${current.attemptId.replaceAll("-", "")}`),
      );
    const ticks = await selfTicks();
    source = await profileFile(current.file);
    if (
      !currentProfile(source.profile, current, ticks) ||
      (await verifyLease()) !== true
    )
      throw Error();
    let previous;
    if (previousAttemptId === undefined) {
      try {
        await lstat(alias);
        throw Error();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    } else {
      const previousFile = pathFor(deploymentRoot, previousAttemptId);
      await directory(
        join(deploymentRoot, `g${previousAttemptId.replaceAll("-", "")}`),
      );
      previous = await lstat(previousFile, { bigint: true });
      const oldAlias = await lstat(alias, { bigint: true });
      if (
        !previous.isFile() ||
        previous.uid !== BigInt(process.getuid()) ||
        (previous.mode & 0o7777n) !== 0o600n ||
        !inode(previous, oldAlias)
      )
        throw Error();
    }
    if (
      !inode(root, await directory(deploymentRoot)) ||
      !inode(
        currentDir,
        await directory(
          join(deploymentRoot, `g${current.attemptId.replaceAll("-", "")}`),
        ),
      ) ||
      (await verifyLease()) !== true
    )
      throw Error();
    if (previous === undefined) {
      // A syscall can complete even when its reply is lost; do not retry an
      // attempted publication whose outcome is uncertain.
      mayHavePublished = true;
      await link(current.file, alias);
    } else {
      tempMayExist = true;
      await link(current.file, temp);
      const tempInfo = await lstat(temp, { bigint: true });
      if (
        !inode(source.info, tempInfo) ||
        !inode(previous, await lstat(alias, { bigint: true })) ||
        (await verifyLease()) !== true ||
        !inode(previous, await lstat(alias, { bigint: true }))
      )
        throw Error();
      mayHavePublished = true;
      await rename(temp, alias);
      tempMayExist = false;
    }
    const after = await profileFile(current.file),
      aliasInfo = await lstat(alias, { bigint: true });
    if (
      !inode(source.info, after.info) ||
      source.text !== after.text ||
      !inode(after.info, aliasInfo) ||
      !inode(root, await directory(deploymentRoot)) ||
      (await verifyLease()) !== true
    )
      throw Error();
    const dir = await open(
      deploymentRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (!inode(root, await dir.stat({ bigint: true }))) throw Error();
      await dir.sync();
    } finally {
      await dir.close();
    }
    return Object.freeze({ state: "published" });
  } catch {
    throw fail(
      mayHavePublished
        ? "DESKTOP_ALIAS_OUTCOME_UNKNOWN"
        : "DESKTOP_ALIAS_IDENTITY_CHANGED",
    );
  } finally {
    if (tempMayExist && source) {
      try {
        if (inode(source.info, await lstat(temp, { bigint: true })))
          await unlink(temp);
      } catch {
        /* retain anything not proven ours */
      }
    }
  }
}
