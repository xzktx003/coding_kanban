import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { runDesktopService } from "./service-cli.mjs";
import {
  captureStableProfileCandidate,
  inspectStableProfileAlias,
} from "./stable-profile-alias.mjs";
import { captureContainerRecoveryIdentity, matchesContainerRecoveryIdentity } from "./container-recovery-identity.mjs";
import { matchesContainerProcessIdentitySync } from "./container-service.mjs";

// All callbacks are trusted, server-only dependencies. They are never accepted
// from HTTP or decoded configuration. A config factory may prepare only fresh
// private files; it must not start a native process or contact a daemon.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;
const INODE_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_STATE = 16384;
const LOCK_SCRIPT =
  "import fcntl,sys\ntry: fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(75)\n";
const exec = promisify(execFile);
const fail = (code) =>
  Object.assign(new Error("Desktop supervisor unavailable"), { code });
const canonical = (p) =>
  typeof p === "string" &&
  p.length > 1 &&
  p.length <= 4096 &&
  isAbsolute(p) &&
  resolve(p) === p &&
  !/[\x00-\x1f\x7f]/.test(p);
const sameInode = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid"].every((k) => a[k] === b[k]);
const sameFile = (a, b) =>
  sameInode(a, b) && ["size", "mtimeNs", "ctimeNs"].every((k) => a[k] === b[k]);
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const identityOK = (value) =>
  exact(value, ["containerId", "generation", "profileId"]) &&
  SHA.test(value.containerId ?? "") &&
  UUID.test(value.generation ?? "") &&
  UUID.test(value.profileId ?? "");
const recoveryOK = (value) =>
  exact(value, [
    "dockerPath",
    "dockerSha256",
    "imageDigest",
    "bridgeRoot",
    "profileFile",
  ]) &&
  canonical(value.dockerPath) &&
  SHA.test(value.dockerSha256 ?? "") &&
  IMAGE.test(value.imageDigest ?? "") &&
  canonical(value.bridgeRoot) &&
  canonical(value.profileFile);
const anchorOK = (value) =>
  exact(value, ["dev", "ino"]) &&
  typeof value.dev === "string" &&
  typeof value.ino === "string" &&
  INODE_INTEGER.test(value.dev ?? "") &&
  INODE_INTEGER.test(value.ino ?? "") &&
  BigInt(value.dev) <= 0xffffffffffffffffn &&
  BigInt(value.ino) <= 0xffffffffffffffffn;
const aliasCandidateOK = (value) =>
  exact(value, ["attemptId", "native", "recovery", "anchor"]) &&
  UUID.test(value.attemptId ?? "") &&
  identityOK(value.native) &&
  recoveryOK(value.recovery) &&
  anchorOK(value.anchor);
const aliasStateOK = (value, recoveryFrom) =>
  exact(value, ["mayBeAbsent", "candidates"]) &&
  typeof value.mayBeAbsent === "boolean" &&
  Array.isArray(value.candidates) &&
  value.candidates.length <= 2 &&
  (value.candidates.length > 0 || value.mayBeAbsent) &&
  value.candidates.every(aliasCandidateOK) &&
  new Set(value.candidates.map((candidate) => candidate.attemptId)).size ===
    value.candidates.length &&
  (new Set(value.candidates.map((candidate) => candidate.native.containerId))
    .size === value.candidates.length ||
    (recoveryFrom && value.candidates.every((candidate) =>
      JSON.stringify(candidate.native) === JSON.stringify(recoveryFrom.native))));
const recoveryFromOK = (value) => {
  try {
    if (!exact(value, ["attemptId", "native", "recovery", "anchor", "configSha256", "liveAnchor"]) ||
        !aliasCandidateOK({ attemptId: value.attemptId, native: value.native, recovery: value.recovery, anchor: value.anchor }) ||
        !SHA.test(value.configSha256 ?? "")) return false;
    const live = captureContainerRecoveryIdentity(value.liveAnchor);
    return live.configSha256 === value.configSha256 &&
      ["containerId", "profileId", "generation"].every((key) => live[key] === value.native[key]);
  } catch { return false; }
};
function validateRecord(record, deploymentId) {
  if (!record || record.version !== 1 || record.deploymentId !== deploymentId)
    return false;
  if (record.phase === "ready")
    return exact(record, ["version", "deploymentId", "phase"]);
  const keys = [
    "version",
    "deploymentId",
    "phase",
    "attemptId",
    "bootId",
    "managerPid",
    "managerStartTicks",
    "configSha256",
    "recovery",
  ];
  if (["owned", "retained", "ended"].includes(record.phase))
    keys.push("native");
  if (Object.hasOwn(record, "liveAnchor")) keys.push("liveAnchor");
  if (Object.hasOwn(record, "aliasState")) keys.push("aliasState");
  if (Object.hasOwn(record, "predecessor")) keys.push("predecessor");
  if (Object.hasOwn(record, "recoveryFrom")) keys.push("recoveryFrom");
  return (
    exact(record, keys) &&
    ["starting", "owned", "retained", "ended"].includes(record.phase) &&
    UUID.test(record.attemptId ?? "") &&
    UUID.test(record.bootId ?? "") &&
    Number.isSafeInteger(record.managerPid) &&
    record.managerPid > 1 &&
    TICKS.test(record.managerStartTicks ?? "") &&
    SHA.test(record.configSha256 ?? "") &&
    recoveryOK(record.recovery) &&
    (!keys.includes("recoveryFrom") ||
      (recoveryFromOK(record.recoveryFrom) && ["starting", "owned"].includes(record.phase) &&
        keys.includes("aliasState") && Array.isArray(record.aliasState?.candidates) && !keys.includes("predecessor") &&
        record.recoveryFrom.liveAnchor.bootId === record.bootId && record.recoveryFrom.attemptId !== record.attemptId &&
        record.aliasState.candidates.every((candidate) =>
          [record.attemptId, record.recoveryFrom.attemptId].includes(candidate.attemptId) &&
          JSON.stringify(candidate.native) === JSON.stringify(record.recoveryFrom.native)) &&
        (!record.native || JSON.stringify(record.native) === JSON.stringify(record.recoveryFrom.native)))) &&
    (!keys.includes("native") || identityOK(record.native)) &&
    (!keys.includes("liveAnchor") || (() => {
      try {
        if (!keys.includes("native")) return false;
        const anchor = captureContainerRecoveryIdentity(record.liveAnchor);
        return anchor.containerId === record.native.containerId &&
          anchor.profileId === record.native.profileId &&
          anchor.generation === record.native.generation &&
          anchor.bootId === record.bootId && anchor.configSha256 === record.configSha256;
      } catch { return false; }
    })()) &&
    (!keys.includes("predecessor") ||
      (aliasCandidateOK(record.predecessor) &&
        record.predecessor.attemptId !== record.attemptId &&
        (!record.native ||
          record.predecessor.native.containerId !==
            record.native.containerId))) &&
    (!keys.includes("aliasState") ||
      (aliasStateOK(record.aliasState, record.recoveryFrom) &&
        (!keys.includes("native") ||
          record.aliasState.candidates.some(
            (candidate) =>
              candidate.attemptId === record.attemptId &&
              JSON.stringify(candidate.native) ===
                JSON.stringify(record.native) &&
              JSON.stringify(candidate.recovery) ===
                JSON.stringify(record.recovery),
          ))))
  );
}
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
async function syncDirectory(path) {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function readRecord(path, deploymentId) {
  const parent = await directory(path),
    statePath = join(path, "state.json");
  const fd = await open(
    statePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await fd.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX_STATE)
    )
      throw Error();
    const buffer = Buffer.alloc(MAX_STATE + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await fd.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (
      offset > MAX_STATE ||
      !sameFile(before, await fd.stat({ bigint: true })) ||
      !sameFile(before, await lstat(statePath, { bigint: true })) ||
      !sameInode(parent, await directory(path))
    )
      throw Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, offset),
    );
    const record = JSON.parse(text);
    // Canonical single-line JSON also rejects duplicate keys and truncation.
    if (
      JSON.stringify(record) + "\n" !== text ||
      !validateRecord(record, deploymentId)
    )
      throw Error();
    return { record, info: before, parent };
  } finally {
    await fd.close();
  }
}
async function writeRecord(path, old, record, verifyLease) {
  const statePath = join(path, "state.json"),
    temp = join(path, `.state-${randomUUID()}.tmp`);
  let fd,
    tempIdentity,
    committed = false;
  try {
    if (
      !(await verifyLease()) ||
      !sameFile(old.info, await lstat(statePath, { bigint: true })) ||
      !sameInode(old.parent, await directory(path))
    )
      throw Error();
    fd = await open(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    tempIdentity = await fd.stat({ bigint: true });
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    if (bytes.length > MAX_STATE) throw Error();
    await fd.writeFile(bytes);
    await fd.sync();
    tempIdentity = await fd.stat({ bigint: true });
    if (
      !(await verifyLease()) ||
      !sameFile(tempIdentity, await lstat(temp, { bigint: true })) ||
      !sameFile(old.info, await lstat(statePath, { bigint: true })) ||
      !sameInode(old.parent, await directory(path))
    )
      throw Error();
    await rename(temp, statePath);
    committed = true;
    await syncDirectory(path);
    return await readRecord(path, record.deploymentId);
  } catch {
    throw fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
  } finally {
    await fd?.close().catch(() => {});
    // Do not unlink a replacement if our temporary inode has been swapped.
    if (!committed && tempIdentity) {
      try {
        if (sameInode(tempIdentity, await lstat(temp, { bigint: true })))
          await unlink(temp);
      } catch {}
    }
  }
}
async function verifyExecutable(path, digest) {
  if (
    !canonical(path) ||
    !SHA.test(digest ?? "") ||
    (await realpath(path)) !== path
  )
    throw Error();
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    (before.uid !== 0n && before.uid !== BigInt(process.getuid())) ||
    before.mode & 0o022n ||
    !(before.mode & 0o111n) ||
    before.size > 268435456n
  )
    throw Error();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    flags: constants.O_RDONLY | constants.O_NOFOLLOW,
  }))
    hash.update(chunk);
  if (
    hash.digest("hex") !== digest ||
    !sameFile(before, await lstat(path, { bigint: true }))
  )
    throw Error();
}
async function acquireLease(path, pythonPath, pythonSha256) {
  await verifyExecutable(pythonPath, pythonSha256);
  const parent = await directory(path),
    lockPath = join(path, "supervisor.lock");
  const fd = await open(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const identity = await fd.stat({ bigint: true });
    if (
      !identity.isFile() ||
      identity.uid !== BigInt(process.getuid()) ||
      (identity.mode & 0o7777n) !== 0o600n ||
      identity.nlink !== 1n ||
      !sameInode(identity, await lstat(lockPath, { bigint: true })) ||
      !sameInode(parent, await directory(path))
    )
      throw Error();
    // flock attaches to the shared open-file description, held by Node's fd;
    // the short-lived Python helper does not own the lock's lifetime.
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(pythonPath, ["-I", "-S", "-c", LOCK_SCRIPT], {
        stdio: ["ignore", "ignore", "ignore", fd.fd],
        env: {},
        cwd: "/",
        shell: false,
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error());
      }, 5000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolveExit(exitCode);
      });
    });
    if (code === 75) {
      await fd.close();
      return null;
    }
    if (code !== 0) throw Error();
    return {
      async verify() {
        try {
          return (
            sameInode(identity, await fd.stat({ bigint: true })) &&
            sameInode(identity, await lstat(lockPath, { bigint: true })) &&
            sameInode(parent, await directory(path))
          );
        } catch {
          return false;
        }
      },
      close: () => fd.close(),
    };
  } catch {
    await fd.close().catch(() => {});
    throw fail("DESKTOP_SUPERVISOR_LOCK_UNAVAILABLE");
  }
}
async function currentIdentity() {
  const bootId = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim();
  const stat = await readFile("/proc/self/stat", "utf8");
  const end = stat.lastIndexOf(") ");
  const managerStartTicks =
    end < 0
      ? ""
      : stat
          .slice(end + 2)
          .trim()
          .split(/\s+/)[19];
  if (!UUID.test(bootId) || !TICKS.test(managerStartTicks ?? "")) throw Error();
  return { bootId, managerPid: process.pid, managerStartTicks };
}
async function previousManagerGone(record, now) {
  if (record.bootId !== now.bootId) return true;
  try {
    const path = `/proc/${record.managerPid}`;
    const [info, stat] = await Promise.all([
      lstat(path, { bigint: true }),
      readFile(join(path, "stat"), "utf8"),
    ]);
    const end = stat.lastIndexOf(") "),
      fields =
        end < 0
          ? []
          : stat
              .slice(end + 2)
              .trim()
              .split(/\s+/);
    if (
      !info.isDirectory() ||
      info.uid !== BigInt(process.getuid()) ||
      !TICKS.test(fields[19] ?? "")
    )
      return false;
    return (
      fields[19] !== record.managerStartTicks ||
      ["Z", "X", "x"].includes(fields[0])
    );
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

/** Explicitly initialize one previously nonexistent, owned private deployment. */
export async function initializeDesktopSupervisor({
  stateDirectory,
  deploymentId,
}) {
  if (!canonical(stateDirectory) || !UUID.test(deploymentId ?? ""))
    throw fail("DESKTOP_SUPERVISOR_INVALID_CONFIG");
  try {
    const parent = await directory(dirname(stateDirectory));
    await mkdir(stateDirectory, { mode: 0o700 });
    if (!sameInode(parent, await directory(dirname(stateDirectory))))
      throw Error();
  } catch (error) {
    throw fail(
      error?.code === "EEXIST"
        ? "DESKTOP_SUPERVISOR_EXISTS"
        : "DESKTOP_SUPERVISOR_STATE_UNAVAILABLE",
    );
  }
  try {
    await syncDirectory(dirname(stateDirectory));
    // Empty Docker config reproduces the default daemon selection without
    // relying on the previous generation's temporary bridge directory.
    await mkdir(join(stateDirectory, "docker-config"), { mode: 0o700 });
    const fd = await open(
      join(stateDirectory, "state.json"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await fd.writeFile(
        JSON.stringify({ version: 1, deploymentId, phase: "ready" }) + "\n",
      );
      await fd.sync();
    } finally {
      await fd.close();
    }
    await syncDirectory(stateDirectory);
  } catch {
    throw fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
  }
}

/** Snapshot of the durable record only; it does not claim that native is live. */
export async function readDesktopSupervisorStatus({
  stateDirectory,
  deploymentId,
}) {
  try {
    const { record } = await readRecord(stateDirectory, deploymentId);
    return Object.freeze({ phase: record.phase, nativeState: "unknown" });
  } catch {
    throw fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
  }
}

/** Default read-only recovery proof. It never creates, stops or attaches a container. */
export async function inspectExitedDesktopContainer({
  native,
  recovery,
  dockerConfigDirectory,
}) {
  try {
    if (
      !identityOK(native) ||
      !recoveryOK(recovery) ||
      !canonical(dockerConfigDirectory)
    )
      throw Error();
    await verifyExecutable(recovery.dockerPath, recovery.dockerSha256);
    const parentPath = dirname(dockerConfigDirectory),
      parent = await directory(parentPath),
      configPath = dockerConfigDirectory,
      config = await directory(configPath);
    if ((await readdir(configPath)).length) throw Error();
    const format =
      '{"id":{{json .Id}},"image":{{json .Image}},"generation":{{json (index .Config.Labels "agent.chatgpt.generation")}},"status":{{json .State.Status}},"running":{{json .State.Running}},"pid":{{json .State.Pid}},"restart":{{json .HostConfig.RestartPolicy.Name}}}';
    const { stdout } = await exec(
      recovery.dockerPath,
      ["inspect", "--format", format, native.containerId],
      {
        env: {
          HOME: parentPath,
          PATH: "/usr/bin:/bin",
          DOCKER_CONFIG: configPath,
        },
        cwd: parentPath,
        timeout: 20000,
        maxBuffer: 65536,
        shell: false,
      },
    );
    const value = JSON.parse(stdout);
    if (
      !exact(value, [
        "id",
        "image",
        "generation",
        "status",
        "running",
        "pid",
        "restart",
      ]) ||
      !sameInode(parent, await directory(parentPath)) ||
      !sameInode(config, await directory(configPath)) ||
      (await readdir(configPath)).length ||
      value.id !== native.containerId ||
      value.image !== recovery.imageDigest ||
      value.generation !== native.generation ||
      value.status !== "exited" ||
      value.running !== false ||
      value.pid !== 0 ||
      !["", "no"].includes(value.restart)
    )
      throw Error();
    await verifyExecutable(recovery.dockerPath, recovery.dockerSha256);
    return Object.freeze({ state: "exited", ...native });
  } catch {
    return Object.freeze({ state: "unknown" });
  }
}

/**
 * Own one foreground service attempt. A service manager may rerun this after a
 * crash or boot. Unrecorded creates and live/unknown native instances block;
 * only an exact exited-container proof permits a new private generation.
 */
export async function runDesktopSupervisor(options, dependencies = {}) {
  const { stateDirectory, deploymentId, pythonPath, pythonSha256, signal } =
    options ?? {};
  const {
    createConfig,
    inspectPrevious = inspectExitedDesktopContainer,
    inspectAlias = inspectStableProfileAlias,
    captureProfile = captureStableProfileCandidate,
    runService = runDesktopService,
    onEvent = () => {},
    publishProfile,
    recordRecoveryIdentity = false,
    createRecoveryConfig,
    inspectManagerGone = previousManagerGone,
    verifyRecoveryIdentity = async (identity) => matchesContainerRecoveryIdentity(identity, identity, matchesContainerProcessIdentitySync),
  } = dependencies;
  if (
    !canonical(stateDirectory) ||
    !UUID.test(deploymentId ?? "") ||
    !canonical(pythonPath) ||
    !SHA.test(pythonSha256 ?? "") ||
    !(signal instanceof AbortSignal) ||
    typeof createConfig !== "function" ||
    typeof inspectPrevious !== "function" ||
    typeof inspectAlias !== "function" ||
    typeof captureProfile !== "function" ||
    typeof runService !== "function" ||
    typeof onEvent !== "function" ||
    typeof recordRecoveryIdentity !== "boolean" ||
    typeof inspectManagerGone !== "function" ||
    typeof verifyRecoveryIdentity !== "function" ||
    (createRecoveryConfig !== undefined && typeof createRecoveryConfig !== "function") ||
    (publishProfile !== undefined && typeof publishProfile !== "function")
  )
    throw fail("DESKTOP_SUPERVISOR_INVALID_CONFIG");
  let lease;
  try {
    lease = await acquireLease(stateDirectory, pythonPath, pythonSha256);
  } catch {
    throw fail("DESKTOP_SUPERVISOR_LOCK_UNAVAILABLE");
  }
  if (!lease) return Object.freeze({ state: "already_running" });
  const emit = (value) => {
    try {
      onEvent(Object.freeze(value));
    } catch {}
  };
  const blocked = (reasonCode) =>
    Object.freeze({ state: "blocked", reasonCode, nativeState: "unknown" });
  try {
    let current;
    try {
      current = await readRecord(stateDirectory, deploymentId);
    } catch {
      throw fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
    }
    if (!(await lease.verify()))
      throw fail("DESKTOP_SUPERVISOR_LOCK_UNAVAILABLE");
    if (signal.aborted) return Object.freeze({ state: "cancelled" });
    const previous = current.record;
    let now;
    try {
      now = await currentIdentity();
    } catch {
      throw fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
    }
    if (previous.phase === "starting")
      return blocked("DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
    // An interrupted alias publication must not trigger a second attachment.
    // Its journal preserves both identities for explicit reconciliation.
    if (previous.recoveryFrom)
      return blocked("DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
    if (previous.aliasState && !publishProfile)
      return blocked("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
    if (publishProfile && previous.phase !== "ready" && !previous.aliasState)
      return blocked("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
    const asCandidate = (record) =>
      record.aliasState
        ? record.aliasState.candidates.find(
            (candidate) => candidate.attemptId === record.attemptId,
          )
        : {
            attemptId: record.attemptId,
            native: record.native,
            recovery: record.recovery,
          };
    const tracked = [];
    if (previous.phase !== "ready") {
      for (const candidate of [
        asCandidate(previous),
        ...(previous.predecessor ? [previous.predecessor] : []),
        ...(previous.aliasState?.candidates ?? []),
      ]) {
        const same = tracked.find(
          (other) =>
            other.attemptId === candidate.attemptId ||
            other.native.containerId === candidate.native.containerId,
        );
        if (same && JSON.stringify(same) !== JSON.stringify(candidate))
          return blocked("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
        if (!same) tracked.push(candidate);
      }
    }
    const exitedProof = async () => {
      for (const candidate of tracked) {
        let proof;
        try {
          proof = await inspectPrevious(
            Object.freeze({
              native: Object.freeze({ ...candidate.native }),
              recovery: Object.freeze({ ...candidate.recovery }),
              dockerConfigDirectory: join(stateDirectory, "docker-config"),
            }),
          );
        } catch {
          return false;
        }
        if (
          !exact(proof, ["state", "containerId", "generation", "profileId"]) ||
          proof.state !== "exited" ||
          !identityOK({
            containerId: proof.containerId,
            generation: proof.generation,
            profileId: proof.profileId,
          }) ||
          !Object.keys(candidate.native).every(
            (key) => candidate.native[key] === proof[key],
          )
        )
          return false;
      }
      return true;
    };
    let reattach = false;
    if (previous.phase !== "ready") {
      if (
        previous.phase === "owned" &&
        !(await inspectManagerGone(previous, now))
      )
        return blocked("DESKTOP_SUPERVISOR_MANAGER_UNKNOWN");
      if (!(await exitedProof())) {
        if (!publishProfile || !createRecoveryConfig || !previous.liveAnchor || previous.liveAnchor.bootId !== now.bootId || tracked.length !== 1 ||
            !(await inspectManagerGone(previous, now)) ||
            !(await verifyRecoveryIdentity(previous.liveAnchor)))
          return blocked("DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
        reattach = true;
      }
    }
    let aliasOwner;
    const deploymentRoot = dirname(stateDirectory);
    if (publishProfile) {
      const aliasState =
        previous.aliasState ??
        (previous.phase === "ready"
          ? { mayBeAbsent: true, candidates: [] }
          : { mayBeAbsent: false, candidates: [asCandidate(previous)] });
      const verifyCurrent = async () => {
        try {
          if (!(await lease.verify())) return false;
          return sameFile(
            current.info,
            (await readRecord(stateDirectory, deploymentId)).info,
          );
        } catch {
          return false;
        }
      };
      let selection;
      try {
        selection = await inspectAlias({
          deploymentRoot,
          candidates: aliasState.candidates.map((candidate) => ({
            attemptId: candidate.attemptId,
            file: candidate.recovery.profileFile,
            anchor: candidate.anchor,
          })),
          mayBeAbsent: aliasState.mayBeAbsent,
          verifyLease: verifyCurrent,
        });
      } catch {
        return blocked("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
      }
      if (
        exact(selection, ["state"]) &&
        selection.state === "absent" &&
        aliasState.mayBeAbsent
      ) {
        aliasOwner = undefined;
      } else if (
        exact(selection, ["state", "attemptId"]) &&
        selection.state === "matched"
      ) {
        aliasOwner = aliasState.candidates.find(
          (candidate) => candidate.attemptId === selection.attemptId,
        );
        if (!aliasOwner) return blocked("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
      } else return blocked("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
    }
    if (signal.aborted) return Object.freeze({ state: "cancelled" });
    if (!(await lease.verify()))
      throw fail("DESKTOP_SUPERVISOR_LOCK_UNAVAILABLE");
    const attemptId = randomUUID();
    let config;
    try {
      config = reattach
        ? await createRecoveryConfig(Object.freeze({ attemptId, previous: Object.freeze(previous) }))
        : await createConfig(Object.freeze({ attemptId }));
    } catch {
      throw fail("DESKTOP_SUPERVISOR_CONFIG_UNAVAILABLE");
    }
    const recovery = {
      dockerPath: config?.options?.dockerPath,
      dockerSha256: config?.options?.dockerSha256,
      imageDigest: config?.options?.imageDigest,
      bridgeRoot: config?.options?.bridgeRoot,
      profileFile: config?.options?.profileFile,
    };
    if (
      !recoveryOK(recovery) ||
      !SHA.test(config?.fingerprint ?? "") ||
      (reattach && ["dockerPath", "dockerSha256", "imageDigest", "bridgeRoot"].some(
        (key) => recovery[key] !== previous.recovery[key],
      )) ||
      (publishProfile &&
        recovery.profileFile !==
          join(
            deploymentRoot,
            `g${attemptId.replaceAll("-", "")}`,
            "p.json",
          )) ||
      (previous.phase !== "ready" &&
        (config.fingerprint === previous.configSha256 ||
          (reattach ? recovery.bridgeRoot !== previous.recovery.bridgeRoot : recovery.bridgeRoot === previous.recovery.bridgeRoot) ||
          recovery.profileFile === previous.recovery.profileFile))
    )
      throw fail("DESKTOP_SUPERVISOR_CONFIG_UNAVAILABLE");
    if (signal.aborted) return Object.freeze({ state: "cancelled" });
    if (previous.phase !== "ready" &&
        !(reattach ? await verifyRecoveryIdentity(previous.liveAnchor) : await exitedProof()))
      return blocked("DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
    if (signal.aborted) return Object.freeze({ state: "cancelled" });
    const starting = {
      version: 1,
      deploymentId,
      phase: "starting",
      attemptId,
      ...now,
      configSha256: config.fingerprint,
      recovery,
      ...(publishProfile
        ? {
            aliasState: {
              mayBeAbsent: !aliasOwner,
              candidates: aliasOwner ? [aliasOwner] : [],
            },
          }
        : {}),
      ...(publishProfile && previous.phase !== "ready" && !reattach
        ? { predecessor: asCandidate(previous) }
        : {}),
      ...(reattach ? { recoveryFrom: {
        ...asCandidate(previous), configSha256: previous.configSha256,
        liveAnchor: previous.liveAnchor,
      } } : {}),
    };
    current = await writeRecord(
      stateDirectory,
      current,
      starting,
      lease.verify,
    );
    let pending = Promise.resolve(),
      journalFailed = false,
      ownerReady = false;
    const handleOwner = (value) => {
      ownerReady = false;
      const hasAnchor = exact(value, ["containerId", "generation", "profileId", "recoveryIdentity"]);
      const native = hasAnchor
        ? { containerId: value.containerId, generation: value.generation, profileId: value.profileId }
        : value;
      if (!identityOK(native))
        return Promise.reject(fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE"));
      let liveAnchor;
      try {
        if (hasAnchor) {
          liveAnchor = captureContainerRecoveryIdentity(value.recoveryIdentity);
          if (liveAnchor.containerId !== native.containerId || liveAnchor.profileId !== native.profileId ||
              liveAnchor.generation !== native.generation || liveAnchor.bootId !== now.bootId ||
              liveAnchor.configSha256 !== config.fingerprint) throw Error();
        }
        if (reattach && (!liveAnchor ||
            JSON.stringify(native) !== JSON.stringify(previous.native) ||
            JSON.stringify(liveAnchor) !== JSON.stringify({ ...previous.liveAnchor, configSha256: config.fingerprint }))) throw Error();
      } catch {
        return Promise.reject(fail("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE"));
      }
      const fixedNative = { ...native };
      pending = pending.then(async () => {
        if (current.record.phase !== "starting") throw Error();
        let candidate;
        if (publishProfile) {
          const anchor = await captureProfile({
            deploymentRoot,
            current: {
              attemptId,
              file: recovery.profileFile,
              profileId: fixedNative.profileId,
              generation: fixedNative.generation,
            },
            verifyLease: lease.verify,
          });
          if (!anchorOK(anchor)) throw fail("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
          candidate = { attemptId, native: fixedNative, recovery, anchor: { ...anchor } };
        }
        const owned = {
          ...starting,
          phase: "owned",
          native: fixedNative,
          ...(liveAnchor ? { liveAnchor } : {}),
          ...(publishProfile
            ? {
                aliasState: {
                  mayBeAbsent: starting.aliasState.mayBeAbsent,
                  candidates: [...starting.aliasState.candidates, candidate],
                },
              }
            : {}),
        };
        current = await writeRecord(
          stateDirectory,
          current,
          owned,
          lease.verify,
        );
        if (publishProfile) {
          // A new native startup can take a long time. Recheck the precise
          // previous container before changing which profile the gateway sees.
          if (previous.phase !== "ready" &&
              !(reattach ? await verifyRecoveryIdentity(previous.liveAnchor) : await exitedProof()))
            throw fail("DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
          const previousSnapshot = aliasOwner
            ? Object.freeze({
                version: 1,
                deploymentId,
                phase: "retained",
                attemptId: aliasOwner.attemptId,
                recovery: Object.freeze({ ...aliasOwner.recovery }),
                native: Object.freeze({ ...aliasOwner.native }),
                anchor: Object.freeze({ ...aliasOwner.anchor }),
              })
            : Object.freeze({ version: 1, deploymentId, phase: "ready" });
          const verifyCore = async () => {
            try {
              if (!(await lease.verify())) return false;
              if (reattach && !(await verifyRecoveryIdentity(previous.liveAnchor))) return false;
              const observed = await readRecord(stateDirectory, deploymentId);
              return (
                sameFile(current.info, observed.info) &&
                observed.record.phase === "owned" &&
                observed.record.attemptId === attemptId &&
                Object.keys(fixedNative).every(
                  (key) => observed.record.native[key] === fixedNative[key],
                )
              );
            } catch {
              return false;
            }
          };
          const verifyLease = async () => {
            if (!(await verifyCore())) return false;
            try {
              const allowed = current.record.aliasState;
              const observed = await inspectAlias({
                deploymentRoot,
                candidates: allowed.candidates.map((item) => ({
                  attemptId: item.attemptId,
                  file: item.recovery.profileFile,
                  anchor: item.anchor,
                })),
                mayBeAbsent: allowed.mayBeAbsent,
                verifyLease: verifyCore,
              });
              return (
                (exact(observed, ["state"]) &&
                  observed.state === "absent" &&
                  allowed.mayBeAbsent) ||
                (exact(observed, ["state", "attemptId"]) &&
                  observed.state === "matched" &&
                  allowed.candidates.some(
                    (item) => item.attemptId === observed.attemptId,
                  ))
              );
            } catch {
              return false;
            }
          };
          await publishProfile(
            Object.freeze({
              config,
              identity: Object.freeze({ ...fixedNative }),
              previous: previousSnapshot,
              attemptId,
              verifyLease,
            }),
          );
          if (tracked.length &&
              !(reattach ? await verifyRecoveryIdentity(previous.liveAnchor) : await exitedProof()))
            throw fail("DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
          const selection = await inspectAlias({
            deploymentRoot,
            candidates: [
              {
                attemptId,
                file: recovery.profileFile,
                anchor: candidate.anchor,
              },
            ],
            mayBeAbsent: false,
            verifyLease,
          });
          if (
            !exact(selection, ["state", "attemptId"]) ||
            selection.state !== "matched" ||
            selection.attemptId !== attemptId
          )
            throw fail("DESKTOP_SUPERVISOR_ALIAS_UNKNOWN");
          // Once publication is verified, the previous alias and predecessor
          // are no longer possible gateway targets. A crash before this write
          // leaves the bounded old/new candidates intact for reconciliation.
          const { predecessor: _retired, recoveryFrom: _recovered, ...retained } = current.record;
          current = await writeRecord(
            stateDirectory,
            current,
            {
              ...retained,
              aliasState: { mayBeAbsent: false, candidates: [candidate] },
            },
            verifyLease,
          );
        }
        ownerReady = true;
      });
      pending.catch(() => {
        journalFailed = true;
      });
      return pending;
    };
    const handleEvent = (event) => {
      if (event?.state === "published" && (!ownerReady || journalFailed))
        return;
      emit({
        state: event?.state === "published" ? "published" : "service_event",
      });
    };
    let result;
    try {
      result = await runService(config, {
        signal,
        onEvent: handleEvent,
        onOwner: handleOwner,
        recordRecoveryIdentity: recordRecoveryIdentity || reattach,
        ...(reattach ? { recovery: Object.freeze({ identity: previous.liveAnchor, configSha256: previous.configSha256 }) } : {}),
      });
    } catch {
      result = undefined;
    }
    await pending.catch(() => {});
    if (journalFailed || current.record.phase !== "owned")
      return blocked("DESKTOP_SUPERVISOR_ATTEMPT_UNKNOWN");
    const ended =
      result?.state === "native_exited" && result?.nativeState === "exited";
    current = await writeRecord(
      stateDirectory,
      current,
      { ...current.record, phase: ended ? "ended" : "retained" },
      lease.verify,
    );
    return ended
      ? Object.freeze({ state: "native_exited", nativeState: "exited" })
      : blocked("DESKTOP_SUPERVISOR_NATIVE_UNKNOWN");
  } finally {
    await lease.close().catch(() => {});
  }
}
