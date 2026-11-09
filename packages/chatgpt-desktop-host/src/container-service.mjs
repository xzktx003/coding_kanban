import { createHash, randomBytes, randomUUID } from "node:crypto";
import { containerServerSshOption } from "./container-server-ssh.mjs";
import { spawn, execFile } from "node:child_process";
import {
  constants,
  createReadStream,
  fstatSync,
  lstatSync,
  readSync,
  readdirSync,
  realpathSync,
  readFileSync,
  readlinkSync,
  statfsSync,
} from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseJsonLines, readBoundedChunks } from "./json-lines.mjs";
import { decodeWireValue, encodeWireValue } from "./wire-value.mjs";
import {
  PINNED_LINUX_RUNTIME,
  preparePrivateRuntime,
} from "./private-runtime.mjs";
import {
  createInitialGrantAttempt,
  runAuthorizedContainerWrite,
  assertContainerWriteAuthority,
  snapshotContainerWriteBatch,
  runAuthorizedContainerBatch,
} from "./container-write-guard.mjs";
import { seedDesktopAccountSnapshot } from "./account-snapshot.mjs";
import { normalizeDesktopConnection } from "./connection-policy.mjs";
import { normalizeContainerSharedAuthority } from "./container-shared-authority.mjs";
import * as ownedSharedDesktop from "./owned-shared-desktop-source.mjs";
import {
  normalizeProjectRoots,
  prepareFixedProjectMounts,
  hasSelfVerifyingProjectMount,
} from "./fixed-project-mounts.mjs";
import {
  normalizePersistentHistoryRoot,
  preparePersistentHistory,
  reopenContainerHistoryForRecovery,
  hasSelfVerifyingHistoryMount,
} from "./persistent-history.mjs";
import {
  createProjectRecoverySource,
  prepareLiveProjectPersistence,
  prepareNativeProjectSeed,
  projectStateProjection,
  startNativeProjectMonitor,
} from "./persistent-projects.mjs";
import { captureContainerRecoveryIdentity, matchesContainerRecoveryIdentity } from "./container-recovery-identity.mjs";
import { requireIdleContainerRecoveryReply } from "./container-recovery-wire.mjs";

const exec = promisify(execFile);
const MAX = 8 * 1024 * 1024;
const TMPFS_MAGIC = 0x01021994n;
const ACCOUNT_ERRORS = new Set([
  "ACCOUNT_SNAPSHOT_INVALID_CONFIG",
  "ACCOUNT_SNAPSHOT_UNSAFE_HOME",
  "ACCOUNT_SNAPSHOT_UNSAFE_SOURCE",
  "ACCOUNT_SNAPSHOT_INVALID_SOURCE",
  "ACCOUNT_SNAPSHOT_SOURCE_CHANGED",
  "ACCOUNT_SNAPSHOT_UNAVAILABLE",
]);
export function isAccountSnapshotErrorCode(code) {
  return typeof code === "string" && ACCOUNT_ERRORS.has(code);
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const ORDINARY_TYPES = new Set(["call", "openPort", "portPost", "closePort"]);
const CLEARED_ENV = Object.freeze([
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
]);
const FIXED = Object.freeze({
  "fixed-project-mounts.mjs":
    "e8806bfd340fb8618a5b652fdccce77113986bf73c31b8c3f76fc1653ae38930",
  "connection-policy.mjs":
    "8f3cd19aa67af326997b3d51af2f6c64057cb7aae48e68a291588f5e149f526a",
  "container-peer-helper.py":
    "41ef0f530e87d4c6d7933eb0cc55c711640341a795d3b859a8120f9a91b49d82",
  "container-bridge.py":
    "b8748ad8596ecd6f67d98029d0605d09da6165af35f13354803b72a27b4a2074",
  "container-native.mjs":
    "94a73df2005e83a347b7f26c22fb997c38394422b6b29e0cba0f3745787c0fde",
  "container-recovery-wire.mjs":
    "3bbc253486fbed8443b0e7127eab6dde16ad7b909732bf57db2633f05e9fb9c2",
  "native-shared-desktop-transport.cjs":
    "e3429b0f6866b9e1205ce3cc3aae3b1836e6dd46492a2111c3793155f0dcafb3",
  "shared-thread-authority-wire.cjs":
    "518595d0ac21dca65cdfa2d369b7c894776272651b66789d661f3c54fbd36525",
  "shared-directory-ipc.cjs":
    "d9ac1a270f10f841ec39effbaf6869b28931f58cf9f4cc1329b0f81c3e7fdda7",
  "shared-catalog-ipc.cjs":
    "b4a17f9cd2eade774be3b2e01928d074033c3e2430a4549ddb194d36173eeabd",
  "wire-value.mjs":
    "6f613a72245c0279fb49f78850b15415a240acc1c852104b82d431105b3644dd",
  "json-lines.mjs":
    "036663426b2de08b2cd1855e79779e39cf7ad4cde3730883f12b5c33d58a3ea2",
  "shared-mcp-wire.cjs":
    "1c097d2e6aa1517251322a540566d0260f3a2a5e95ba4836dac1ae00d15f7eaf",
  "shared-thread-creation-ipc.cjs":
    "cb02dea4dc8c0f406b56c21f13e8466c4b56337728abffd48157755bb27167ee",
  "shared-thread-send-ipc.cjs":
    "b4866bc3b54a704df13178bed8c193d2680acab98c106be0a806f13d884c2408",
  "shared-thread-send-schema.cjs":
    "f86271aea7836fff8e71596e7d5ebb63860456b13ba24713eda711fc18040f8e",
  "shared-permissions-schema.cjs":
    "c1a816ef35b196b7cf127d28a86d994f084dba5e3274d1d10e72712699eba049",
  "shared-rpc-trace-schema.cjs":
    "c27084ab9513f9dfcc485e01d30bed8ad6f62631a070fa4049be1d560b8a2b34",
});
const failure = (code) =>
  Object.assign(new Error("Private container unavailable"), { code });
const pathOK = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const contains = (parent, child) => {
  const part = relative(parent, child);
  return (
    !part || (part !== ".." && !part.startsWith("../") && !isAbsolute(part))
  );
};
const sameFile = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs", "ctimeNs"].every(
    (key) => a[key] === b[key],
  );
const sameDir = (a, b) =>
  ["dev", "ino", "uid", "gid", "mode"].every((key) => a[key] === b[key]);
const sameProcess = (a, b) =>
  a.pid === b.pid &&
  a.ppid === b.ppid &&
  a.uid === b.uid &&
  a.ticks === b.ticks &&
  a.cgroup === b.cgroup &&
  a.pidns === b.pidns &&
  a.mntns === b.mntns &&
  a.cpus === b.cpus &&
  a.noNewPrivs === b.noNewPrivs &&
  a.seccomp === b.seccomp &&
  a.capEff === b.capEff &&
  a.nspids.join(",") === b.nspids.join(",");
const pkg = dirname(fileURLToPath(import.meta.url));

async function directory(path, uid, privateMode = false) {
  if (!pathOK(path) || (await realpath(path)) !== path)
    throw failure("CONTAINER_UNSAFE_PATH");
  const info = await lstat(path, { bigint: true });
  if (
    !info.isDirectory() ||
    (info.uid !== BigInt(uid) && info.uid !== 0n) ||
    (privateMode
      ? info.uid !== BigInt(uid) || (info.mode & 0o7777n) !== 0o700n
      : Boolean(info.mode & 0o022n))
  )
    throw failure("CONTAINER_UNSAFE_PATH");
  return info;
}
async function tmpfsHome(path, uid, requireEmpty = false) {
  try {
    const info = await directory(path, uid, true);
    if (
      (await statfs(path, { bigint: true })).type !== TMPFS_MAGIC ||
      (requireEmpty && (await readdir(path)).length)
    )
      throw Error();
    return info;
  } catch {
    throw failure("CONTAINER_UNSAFE_PATH");
  }
}

// Hot-path check of the same private tmpfs identity. Startup's empty-directory
// checks stay on tmpfsHome; this function never caches a successful result.
export function readOwnedTmpfsHomeIdentitySync(path, uid) {
  try {
    if (!pathOK(path) || realpathSync(path) !== path) throw Error();
    const info = lstatSync(path, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(uid) ||
        (info.mode & 0o7777n) !== 0o700n ||
        statfsSync(path, { bigint: true }).type !== TMPFS_MAGIC) throw Error();
    return info;
  } catch { throw failure("CONTAINER_UNSAFE_PATH"); }
}

const INITIAL_CODEX_CONFIG = Buffer.from(
  '[desktop]\nconversationDetailMode = "STEPS_COMMANDS"\n',
);

/**
 * Install a single version-pinned initial preference into an already verified,
 * freshly owned home. The held descriptors are checked again immediately
 * before the initial container grant and closed after the grant write.
 * This function never reads or changes the account snapshot.
 */
export async function prepareInitialCodexMode({
  homeRoot,
  homeIdentity,
  accountSeeded,
  historyDirectories = false,
  projectStateSeeded = false,
} = {}) {
  let homeHandle, codexHandle, configHandle, projectStateHandle;
  const historyHandles = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([
      configHandle?.close(),
      projectStateHandle?.close(),
      codexHandle?.close(),
      homeHandle?.close(),
      ...historyHandles.map((entry) => entry.handle.close()),
    ]);
  };
  try {
    const uid = process.getuid?.();
    if (
      process.platform !== "linux" ||
      uid === undefined ||
      !pathOK(homeRoot) ||
      !homeIdentity ||
      typeof accountSeeded !== "boolean" ||
      typeof historyDirectories !== "boolean" ||
      typeof projectStateSeeded !== "boolean" ||
      (projectStateSeeded && !historyDirectories)
    )
      throw Error();
    const homeInfo = await directory(homeRoot, uid, true);
    if (!sameDir(homeIdentity, homeInfo)) throw Error();
    homeHandle = await open(
      homeRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (!sameDir(homeInfo, await homeHandle.stat({ bigint: true })))
      throw Error();
    const homeFdPath = `/proc/self/fd/${homeHandle.fd}`;
    const entries = await readdir(homeFdPath);
    if (
      accountSeeded || historyDirectories
        ? entries.length !== 1 || entries[0] !== ".codex"
        : entries.length !== 0
    )
      throw Error();
    const codexPath = join(homeRoot, ".codex");
    const codexFdPath = join(homeFdPath, ".codex");
    if (!accountSeeded && !historyDirectories)
      await mkdir(codexFdPath, { mode: 0o700 });
    codexHandle = await open(
      codexFdPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const codexInfo = await codexHandle.stat({ bigint: true });
    if (
      !codexInfo.isDirectory() ||
      codexInfo.uid !== BigInt(uid) ||
      (codexInfo.mode & 0o7777n) !== 0o700n ||
      (await realpath(codexPath)) !== codexPath ||
      !sameDir(codexInfo, await lstat(codexPath, { bigint: true }))
    )
      throw Error();
    const codexDirFdPath = `/proc/self/fd/${codexHandle.fd}`;
    const codexEntries = await readdir(codexDirFdPath);
    const initialNames = [
      ...(accountSeeded ? ["auth.json"] : []),
      ...(historyDirectories ? ["sessions", "archived_sessions"] : []),
      ...(projectStateSeeded ? [".codex-global-state.json"] : []),
    ].sort();
    if (
      codexEntries.sort().length !== initialNames.length ||
      codexEntries.some((name, index) => name !== initialNames[index])
    )
      throw Error();
    if (historyDirectories)
      for (const name of ["sessions", "archived_sessions"]) {
        const path = join(codexPath, name),
          handle = await open(
            join(codexDirFdPath, name),
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
        const entry = {
          path,
          handle,
          info: await handle.stat({ bigint: true }),
        };
        historyHandles.push(entry);
        if (
          !entry.info.isDirectory() ||
          entry.info.uid !== BigInt(uid) ||
          (entry.info.mode & 0o7777n) !== 0o700n ||
          !sameDir(entry.info, await lstat(path, { bigint: true })) ||
          (await readdir("/proc/self/fd/" + handle.fd)).length
        )
          throw Error();
      }
    let authInfo;
    if (accountSeeded) {
      authInfo = await lstat(join(codexDirFdPath, "auth.json"), {
        bigint: true,
      });
      if (
        !authInfo.isFile() ||
        authInfo.uid !== BigInt(uid) ||
        (authInfo.mode & 0o7777n) !== 0o600n ||
        authInfo.nlink !== 1n
      )
        throw Error();
    }
    let projectStateInfo;
    if (projectStateSeeded) {
      const path = join(codexPath, ".codex-global-state.json");
      projectStateHandle = await open(join(codexDirFdPath, ".codex-global-state.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
      projectStateInfo = await projectStateHandle.stat({ bigint: true });
      if (!projectStateInfo.isFile() || projectStateInfo.uid !== BigInt(uid) || (projectStateInfo.mode & 0o7777n) !== 0o600n ||
          projectStateInfo.nlink !== 1n || projectStateInfo.size > 2n * 1024n * 1024n || !sameFile(projectStateInfo, await lstat(path, { bigint: true }))) throw Error();
    }
    configHandle = await open(
      join(codexDirFdPath, "config.toml"),
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await configHandle.chmod(0o600);
    await configHandle.writeFile(INITIAL_CODEX_CONFIG);
    await configHandle.sync();
    const configInfo = await configHandle.stat({ bigint: true });
    if (
      !configInfo.isFile() ||
      configInfo.uid !== BigInt(uid) ||
      (configInfo.mode & 0o7777n) !== 0o600n ||
      configInfo.nlink !== 1n ||
      configInfo.size !== BigInt(INITIAL_CODEX_CONFIG.length)
    )
      throw Error();
    function verifyBeforeGrant() {
      if (closed) return false;
      try {
        const currentHome = lstatSync(homeRoot, { bigint: true });
        const currentCodex = lstatSync(codexPath, { bigint: true });
        const currentConfig = lstatSync(join(codexPath, "config.toml"), {
          bigint: true,
        });
        if (
          realpathSync(homeRoot) !== homeRoot ||
          realpathSync(codexPath) !== codexPath ||
          !sameDir(homeInfo, currentHome) ||
          !sameDir(homeInfo, fstatSync(homeHandle.fd, { bigint: true })) ||
          !sameDir(codexInfo, currentCodex) ||
          !sameDir(codexInfo, fstatSync(codexHandle.fd, { bigint: true })) ||
          !sameFile(configInfo, currentConfig) ||
          !sameFile(configInfo, fstatSync(configHandle.fd, { bigint: true })) ||
          currentConfig.nlink !== 1n
        )
          return false;
        const homeNames = readdirSync(homeFdPath);
        if (homeNames.length !== 1 || homeNames[0] !== ".codex") return false;
        const names = readdirSync(codexDirFdPath).sort();
        const expected = [...initialNames, "config.toml"].sort();
        if (
          names.length !== expected.length ||
          names.some((name, index) => name !== expected[index])
        )
          return false;
        if (
          historyHandles.some(
            (entry) =>
              !sameDir(entry.info, lstatSync(entry.path, { bigint: true })) ||
              !sameDir(
                entry.info,
                fstatSync(entry.handle.fd, { bigint: true }),
              ) ||
              realpathSync(entry.path) !== entry.path,
          )
        )
          return false;
        if (accountSeeded) {
          const currentAuth = lstatSync(join(codexPath, "auth.json"), {
            bigint: true,
          });
          if (!sameFile(authInfo, currentAuth) || currentAuth.nlink !== 1n)
            return false;
        }
        if (projectStateSeeded &&
            (!sameFile(projectStateInfo, fstatSync(projectStateHandle.fd, { bigint: true })) ||
             !sameFile(projectStateInfo, lstatSync(join(codexPath, ".codex-global-state.json"), { bigint: true })))) return false;
        const buffer = Buffer.alloc(INITIAL_CODEX_CONFIG.length + 1);
        const size = readSync(configHandle.fd, buffer, 0, buffer.length, 0);
        return (
          size === INITIAL_CODEX_CONFIG.length &&
          buffer.subarray(0, size).equals(INITIAL_CODEX_CONFIG)
        );
      } catch {
        return false;
      }
    }
    if (!verifyBeforeGrant()) throw Error();
    return Object.freeze({ verifyBeforeGrant, close });
  } catch {
    await close();
    throw failure("CONTAINER_INITIAL_MODE_UNSAFE");
  }
}
async function file(path, uid, digest, allowGroupWrite = false) {
  if (!pathOK(path) || (await realpath(path)) !== path)
    throw failure("CONTAINER_UNSAFE_PATH");
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    (before.uid !== BigInt(uid) && before.uid !== 0n) ||
    before.mode & (allowGroupWrite ? 0o002n : 0o022n)
  )
    throw failure("CONTAINER_UNSAFE_PATH");
  const hash = createHash("sha256");
  for await (const part of createReadStream(path, {
    flags: constants.O_RDONLY | constants.O_NOFOLLOW,
  }))
    hash.update(part);
  if (
    hash.digest("hex") !== digest ||
    !sameFile(before, await lstat(path, { bigint: true }))
  )
    throw failure("CONTAINER_ARTIFACT_CHANGED");
  return before;
}
async function proc(pid) {
  // The owned local /proc metadata is small. Avoid a libuv round trip per
  // field, retaining every field and the final PID/start-ticks sample.
  return readContainerProcessIdentitySync(pid);
}
export { proc as readContainerProcessIdentity };

// container-native writes this exact private control marker; every other line
// must pass the complete bounded wire decoder. Avoid parsing a wire graph just
// to rule out the marker, since decodeWireValue already parses it once.
export function decodeContainerOutput(encoded) {
  if (encoded === '{"type":"nativeExit"}') return null;
  const frame = decodeWireValue(encoded);
  if (!frame || frame.v !== 1 || frame.type === "ready") throw Error();
  return frame;
}

/** Pull at most eight messages whose downstream writes are still unfinished. */
export async function consumeContainerOutput(source, receive) {
  const iterator = source?.[Symbol.asyncIterator]?.() ?? source?.[Symbol.iterator]?.();
  if (!iterator || typeof iterator.next !== "function")
    throw new TypeError("Container output is not iterable");
  const pending = new Set();
  let failed = false, failure, sourceDone = false, wakeFailure;
  // Only one source read or final drain is waiting at a time. Removing its
  // wakeup on completion avoids accumulating a listener per native frame.
  const waitOrFail = (operation) => new Promise((resolve, reject) => {
    let settled = false;
    const clear = () => { if (wakeFailure === onFailure) wakeFailure = undefined; };
    const onFailure = () => {
      if (settled) return;
      settled = true; clear(); reject(failure);
    };
    wakeFailure = onFailure;
    Promise.resolve(operation).then(
      (value) => { if (!settled) { settled = true; clear(); resolve(value); } },
      (reason) => { if (!settled) { settled = true; clear(); reject(reason); } },
    );
    if (failed) onFailure();
  });
  try {
    for (;;) {
      // Completed receipts release their own slot. Never read a ninth native
      // message while eight downstream writes are still unfinished.
      while (pending.size >= 8 && !failed) await Promise.race(pending);
      if (failed) throw failure;
      // A downstream failure must also wake a pending native read; it cannot
      // wait indefinitely for the source to produce its next frame.
      const next = await waitOrFail(Promise.resolve().then(() => iterator.next()));
      if (failed) throw failure;
      if (next.done) { sourceDone = true; break; }
      const completion = receive(next.value);
      if (completion === false) {
        if (typeof iterator.return === "function") await iterator.return();
        sourceDone = true;
        break;
      }
      let receipt;
      receipt = Promise.resolve(completion).then(
        () => { pending.delete(receipt); },
        (reason) => {
          pending.delete(receipt);
          if (!failed) { failed = true; failure = reason; wakeFailure?.(); }
        },
      );
      pending.add(receipt);
    }
    if (pending.size) await waitOrFail(Promise.all(pending));
    if (failed) throw failure;
  } finally {
    if (!sourceDone && typeof iterator.return === "function") {
      try {
        // An iterator can already have an unresolved next(). Request cleanup
        // without holding failure propagation hostage to that source.
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch { /* The original failure remains authoritative. */ }
    }
  }
}

/** Server-only lifecycle and bounded startup handoff; no HTTP data is authority. */
export function createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync,writeNative}={}) {
  if(!UUID.test(profileId??'')||!UUID.test(generation??'')||typeof verifyCurrentSync!=="function"||typeof writeNative!=="function")
    throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  let closed=false,source=null,pendingBytes=0;
  const pending=[],records=new Map(),used=new Set();
  const current=()=>{try{return !closed&&verifyCurrentSync()===true;}catch{return false;}};
  function close(){
    if(closed)return;closed=true;pending.length=0;pendingBytes=0;records.clear();
    try{source?.close();}catch{}
  }
  function requireCurrent(){if(!current()){close();throw failure("CONTAINER_IDENTITY_CHANGED");}}
  function getOwnedView(viewId){return current()?records.get(viewId)??null:null;}
  function retireView(viewId){
    if(!records.delete(viewId))return;
    try{source?.retireView(viewId);}catch{close();throw failure("CONTAINER_SHARED_SOURCE_FAILED");}
  }
  const context=Object.freeze({profileId,generation,getOwnedView,verifyOwnedViewSync:viewId=>getOwnedView(viewId)!==null,
    verifyContainerSync:current,
    writeNative(encoded,verifyRequestSync=()=>true){
      requireCurrent();
      if(typeof verifyRequestSync!=="function")throw failure("CONTAINER_SHARED_PROTOCOL_ERROR");
      const originalSource=source;
      let revision;try{revision=source?.accountRevision();}catch{close();throw failure("CONTAINER_SHARED_SOURCE_FAILED");}
      // The outer async identity check may yield. This condition is checked
      // again by the actual stdin writer, after that await and before write.
      const finalVerifySync=()=>{
        try{return current()&&source===originalSource&&source?.accountRevision()===revision&&verifyRequestSync()===true&&
          current()&&source===originalSource&&source?.accountRevision()===revision;}catch{return false;}
      };
      return writeNative(encoded,finalVerifySync);
    }});
  function receiveNative(frame,encoded){
    requireCurrent();
    if(!frame||typeof frame.type!=="string"||!frame.type.startsWith("shared-")||frame.profileId!==profileId||frame.generation!==generation)
      {close();throw failure("CONTAINER_SHARED_PROTOCOL_ERROR");}
    if(source){
      try{if(source.receiveNative(frame)!==true)throw Error();return true;}
      catch{close();throw failure("CONTAINER_SHARED_SOURCE_FAILED");}
    }
    const bytes=Buffer.byteLength(encoded??encodeWireValue(frame));
    if(pending.length>=64||bytes>MAX||pendingBytes+bytes>MAX){close();throw failure("CONTAINER_QUEUE_FULL");}
    pending.push(frame);pendingBytes+=bytes;return true;
  }
  function activate(value){
    try{requireCurrent();}catch(error){try{value?.close?.();}catch{}throw error;}
    if(source||!value||["receiveNative","retireView","close","accountRevision"].some(name=>typeof value[name]!=="function")){
      try{value?.close?.();}catch{}close();throw failure("CONTAINER_SHARED_SOURCE_FAILED");
    }
    source=value;
    try{
      while(pending.length){const frame=pending.shift();if(source.receiveNative(frame)!==true)throw Error();requireCurrent();}
      pendingBytes=0;
    }catch{close();throw failure("CONTAINER_SHARED_SOURCE_FAILED");}
  }
  return Object.freeze({context,receiveNative,activate,retireView,close,
    viewCreated(viewId){
      requireCurrent();
      if(!UUID.test(viewId??'')||used.has(viewId)||used.size>=8192){close();throw failure("CONTAINER_SHARED_PROTOCOL_ERROR");}
      const record=Object.freeze({profileId,generation,viewId});used.add(viewId);records.set(viewId,record);return record;
    }});
}

/** One request's fixed file/directory/socket identity reads; no result cache. */
export function verifyContainerFileIdentitiesSync({
  snapshots,
  directories,
  socketPath,
  socketInfo,
}) {
  try {
    // These are the startup's fixed local identities, not arbitrary paths.
    // Read the complete set afresh without dispatching one libuv task per stat.
    const values = [...snapshots, ...directories, { path: socketPath }].map(
      (entry) => lstatSync(entry.path, { bigint: true }),
    );
    if (snapshots.some((entry, index) => !sameFile(entry.info, values[index])))
      return false;
    if (
      directories.some(
        (entry, index) =>
          !sameDir(entry.info, values[snapshots.length + index]),
      )
    )
      return false;
    const current = values[values.length - 1];
    return !!socketInfo && current.isSocket() && sameDir(socketInfo, current);
  } catch {
    return false;
  }
}
export async function verifyContainerFileIdentities(options) {
  return verifyContainerFileIdentitiesSync(options);
}
function parseProcessIdentity(pid, stat, status, cgroup, pidns, info, mntns) {
  const begin = stat.indexOf(" ("),
    end = stat.lastIndexOf(") ");
  if (begin < 1 || end < begin || stat.slice(0, begin) !== String(pid))
    throw failure("CONTAINER_IDENTITY_CHANGED");
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const values = Object.fromEntries(
    status
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => {
        const index = line.indexOf(":");
        return [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
  const nspids = (values.NSpid ?? "").split(/\s+/).map(Number);
  const uids = (values.Uid ?? "").split(/\s+/).map(Number),
    uid = uids[0];
  if (
    !/^[RSDTtWPKI]$/.test(fields[0] ?? "") ||
    !TICKS.test(fields[19] ?? "") ||
    !info.isDirectory() ||
    Number(info.uid) !== uid ||
    uids.length !== 4 ||
    uids.some((value) => value !== uid) ||
    !nspids.length ||
    nspids.some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw failure("CONTAINER_IDENTITY_CHANGED");
  return {
    pid,
    ppid: Number(values.PPid),
    uid,
    ticks: fields[19],
    nspids,
    cpus: values.Cpus_allowed_list,
    noNewPrivs: values.NoNewPrivs,
    seccomp: values.Seccomp,
    capEff: values.CapEff,
    cgroup: cgroup.trim(),
    pidns,
    mntns,
  };
}

/** A process snapshot is identity data, not independent ownership evidence. */
export function readContainerProcessIdentitySync(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw failure("CONTAINER_IDENTITY_CHANGED");
  const root = `/proc/${pid}`;
  const value = parseProcessIdentity(
    pid,
    readFileSync(join(root, "stat"), "utf8"),
    readFileSync(join(root, "status"), "utf8"),
    readFileSync(join(root, "cgroup"), "utf8"),
    readlinkSync(join(root, "ns", "pid")),
    lstatSync(root, { bigint: true }),
    readlinkSync(join(root, "ns", "mnt")),
  );
  const after = readFileSync(join(root, "stat"), "utf8"),
    end = after.lastIndexOf(") ");
  const fields = after
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (
    after.slice(0, after.indexOf(" (")) !== String(pid) ||
    fields[19] !== value.ticks ||
    Number(fields[1]) !== value.ppid ||
    !["R", "S", "D", "T", "t", "W", "P", "K", "I"].includes(fields[0])
  )
    throw failure("CONTAINER_IDENTITY_CHANGED");
  return value;
}
export function matchesContainerProcessIdentitySync(expected) {
  try {
    return sameProcess(
      expected,
      readContainerProcessIdentitySync(expected.pid),
    );
  } catch {
    return false;
  }
}
/** expectedInit must come from the separately verified owned Docker init. */
export function createContainerProjectGuard(owner, expectedInit) {
  if (owner === undefined) return () => true;
  let fixed;
  try {
    fixed = Object.freeze({
      ...expectedInit,
      nspids: Object.freeze([...expectedInit.nspids]),
    });
  } catch {
    return () => false;
  }
  return () => {
    try {
      return (
        // These immutable owners each check their complete account/directory
        // identity before and after their mounted walk.
        // Unknown owners retain the original independent preliminary check.
        (hasSelfVerifyingHistoryMount(owner) || hasSelfVerifyingProjectMount(owner) || owner.verifySync() === true) &&
        owner.verifyMountedSync({
          pid: fixed.pid,
          verifyProcess: (pid) =>
            pid === fixed.pid && matchesContainerProcessIdentitySync(fixed),
        }) === true
      );
    } catch {
      return false;
    }
  };
}
function affinityIncludes(list, cpuId) {
  if (typeof list !== "string" || !/^[0-9,-]+$/.test(list)) return false;
  return list.split(",").some((part) => {
    const values = part.split("-").map(Number);
    return (
      values.length <= 2 &&
      values.every(Number.isSafeInteger) &&
      cpuId >= values[0] &&
      cpuId <= (values[1] ?? values[0])
    );
  });
}
async function childByNamespace(parent, expected, uid, cgroup, pidns) {
  const raw = await readFile(`/proc/${parent}/task/${parent}/children`, "utf8");
  const ids = raw.trim() ? raw.trim().split(/\s+/).map(Number) : [];
  if (ids.length > 256) throw failure("CONTAINER_IDENTITY_CHANGED");
  const values = await Promise.all(
    ids.map((pid) => proc(pid).catch(() => null)),
  );
  const hits = values.filter(
    (value) =>
      value &&
      value.ppid === parent &&
      value.uid === uid &&
      value.cgroup === cgroup &&
      value.pidns === pidns &&
      value.nspids.at(-1) === expected,
  );
  if (hits.length !== 1) throw failure("CONTAINER_IDENTITY_CHANGED");
  return hits[0];
}
function timeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure("CONTAINER_TIMEOUT")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Internal transport lifecycle hook; stream failures never expose peer data. */
export function observeContainerHelperInput(input, onUnavailable) {
  const onError = () => onUnavailable();
  input.on("error", onError);
  input.once("close", () => input.removeListener("error", onError));
}

/** Install at spawn: revoke/view cleanup can outlive this exact helper. */
export function observeContainerHelperExit(helper) {
  return new Promise((done) => helper.once("exit", done));
}

/** Trusted server-only snapshot selection. Values never enter Docker arguments. */
export function normalizeContainerAccountSnapshot(value) {
  if (value === undefined) return undefined;
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw Error();
    const keys = Reflect.ownKeys(value),
      descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      keys.length !== 2 ||
      !keys.includes("sourceFile") ||
      !keys.includes("homeRoot") ||
      !Object.hasOwn(descriptors.sourceFile ?? {}, "value") ||
      !Object.hasOwn(descriptors.homeRoot ?? {}, "value") ||
      !pathOK(descriptors.sourceFile.value) ||
      !pathOK(descriptors.homeRoot.value)
    )
      throw Error();
    return Object.freeze({
      sourceFile: descriptors.sourceFile.value,
      homeRoot: descriptors.homeRoot.value,
    });
  } catch {
    throw failure("CONTAINER_INVALID_CONFIG");
  }
}

/** Finite server-only container budget; no HTTP or Docker unit strings. */
export function normalizeContainerMemoryLimitMiB(value) {
  if (value === undefined) return 2048;
  if (![2048, 4096, 8192].includes(value))
    throw failure("CONTAINER_INVALID_CONFIG");
  return value;
}

/** Finite server-only process/thread budget; default remains 256. */
export function normalizeContainerPidsLimit(value) {
  if (value === undefined) return 256;
  if (![256, 512].includes(value)) throw failure("CONTAINER_INVALID_CONFIG");
  return value;
}

function assertOrdinaryContainerFrame(frame, state, expectedSequence) {
  if (
    !frame ||
    frame.v !== 1 ||
    !ORDINARY_TYPES.has(frame.type) ||
    !frame.scope ||
    Object.keys(frame.scope).length !== 3 ||
    frame.scope.profileId !== state.profileId ||
    frame.scope.generation !== state.generation ||
    !state.views.has(frame.scope.viewId) ||
    state.closingViews.has(frame.scope.viewId) ||
    !Number.isSafeInteger(frame.seq) ||
    frame.seq !== expectedSequence
  )
    throw failure("CONTAINER_PROTOCOL_ERROR");
}

/** Internal ordinary-frame admission. Lifecycle messages always use single send. */
export function inspectContainerOrdinaryBatch(entries, state) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8)
    throw failure("CONTAINER_PROTOCOL_ERROR");
  let viewId;
  return Object.freeze(
    entries.map((entry, index) => {
      const frame = decodeWireValue(entry.encoded);
      if (index === 0) viewId = frame?.scope?.viewId;
      if (frame?.scope?.viewId !== viewId)
        throw failure("CONTAINER_PROTOCOL_ERROR");
      assertOrdinaryContainerFrame(
        frame,
        state,
        (state.sequences.get(viewId) ?? 0) + index + 1,
      );
      return frame;
    }),
  );
}

/** Internal inspection contract for the exact Docker generation and mounts. */
export function assertContainerInspection(value, expected) {
  let memoryLimitMiB, pidsLimit;
  try {
    memoryLimitMiB = normalizeContainerMemoryLimitMiB(expected.memoryLimitMiB);
    pidsLimit = normalizeContainerPidsLimit(expected.pidsLimit);
  } catch {
    throw failure("CONTAINER_IDENTITY_CHANGED");
  }
  const {
    containerId,
    imageDigest,
    uid,
    gid,
    cpuId,
    networkMode,
    sourceRoot,
    runtimeRoot,
    home,
    homeSource,
    bridgeRoot,
    bundleRoot,
    nodePath,
  } = expected;
  const h = value?.host,
    mounts = value?.mounts;
  if (
    value?.id !== containerId ||
    value?.image !== imageDigest ||
    !Number.isSafeInteger(value?.pid) ||
    value.pid <= 1 ||
    value.user !== `${uid}:${gid}` ||
    !h ||
    !["none", "bridge"].includes(networkMode) ||
    h.NetworkMode !== networkMode ||
    !["", "private"].includes(h.PidMode) ||
    h.IpcMode !== "private" ||
    h.ReadonlyRootfs !== true ||
    h.Privileged !== false ||
    h.Init !== true ||
    h.CpusetCpus !== String(cpuId) ||
    h.CgroupnsMode !== "private" ||
    h.PidsLimit !== pidsLimit ||
    h.Memory !== memoryLimitMiB * 1024 * 1024 ||
    h.ShmSize !== 268435456 ||
    h.PublishAllPorts !== false ||
    (h.PortBindings != null &&
      (typeof h.PortBindings !== "object" ||
        Array.isArray(h.PortBindings) ||
        Object.keys(h.PortBindings).length !== 0)) ||
    !h.CapDrop?.includes("ALL") ||
    !h.SecurityOpt?.some(
      (entry) =>
        entry === "no-new-privileges" || entry === "no-new-privileges:true",
    ) ||
    h.SecurityOpt.some((entry) => entry.includes("unconfined")) ||
    !Array.isArray(mounts) ||
    mounts.some(
      (entry) =>
        String(entry.Source).includes("docker.sock") ||
        String(entry.Destination).includes("docker.sock"),
    )
  )
    throw failure("CONTAINER_IDENTITY_CHANGED");
  const expectedCmd = [
    "-i",
    "PATH=/usr/bin:/bin",
    "HOME=/tmp",
    "/usr/bin/python3",
    "-I",
    "-u",
    "-B",
    "/package/container-bridge.py",
  ];
  if (
    JSON.stringify(value.entry) !== JSON.stringify(["/usr/bin/env"]) ||
    JSON.stringify(value.cmd) !== JSON.stringify(expectedCmd) ||
    !Array.isArray(value.env) ||
    CLEARED_ENV.some((name) => !value.env.includes(name + "="))
  )
    throw failure("CONTAINER_IDENTITY_CHANGED");
  const bindings = new Map([
    [sourceRoot, [sourceRoot, false]],
    [runtimeRoot, [runtimeRoot, false]],
    [home, [homeSource, true]],
    ["/bridge", [bridgeRoot, true]],
    ["/package", [bundleRoot, false]],
    ["/opt/private-node", [nodePath, false]],
  ]);
  if (expected.historyMounts) {
    expected.historyMounts.assertInspection({ mounts, host: h });
    for (const binding of expected.historyMounts.bindings) {
      if (bindings.has(binding.destination))
        throw failure("CONTAINER_IDENTITY_CHANGED");
      bindings.set(binding.destination, [binding.source, !binding.readOnly]);
    }
  }
  if (expected.projectMounts) {
    expected.projectMounts.assertInspection({
      mounts,
      host: h,
      baseBindings: [...bindings].map(([destination, [source, rw]]) => ({
        source,
        destination,
        readOnly: !rw,
      })),
    });
  } else if (
    mounts.length !== bindings.size ||
    mounts.some((entry) => {
      const item = bindings.get(entry.Destination);
      return (
        !item ||
        entry.Source !== item[0] ||
        entry.RW !== item[1] ||
        entry.Type !== "bind"
      );
    })
  )
    throw failure("CONTAINER_IDENTITY_CHANGED");
  return value.pid;
}

/** Explicit, isolated Docker upstream. No default launcher, login or host fallback. */
export async function startContainerDesktopUpstream(options = {}) {
  return containerDesktopUpstream(options, null);
}

/** Internal recovery; never starts a container or retries an unknown write. */
export async function reattachContainerDesktopUpstream(options = {}, context) {
  let identity;
  try {
    if (!context || typeof context !== "object" || Array.isArray(context) ||
        Reflect.ownKeys(context).sort().join(",") !== "configSha256,identity") throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(context);
    if (!["configSha256", "identity"].every((key) => Object.hasOwn(descriptors[key] ?? {}, "value"))) throw Error();
    identity = captureContainerRecoveryIdentity(descriptors.identity.value);
    if (!SHA.test(descriptors.configSha256.value ?? "") || identity.configSha256 !== descriptors.configSha256.value) throw Error();
  } catch { throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE"); }
  return containerDesktopUpstream(options, identity);
}

async function containerDesktopUpstream(options = {}, recoveryIdentity) {
  const allowed = new Set([
    "imageDigest",
    "sourceRoot",
    "runtimeRoot",
    "bridgeRoot",
    "profileId",
    "generation",
    "dockerPath",
    "dockerSha256",
    "pythonPath",
    "pythonSha256",
    "nodePath",
    "nodeSha256",
    "cpuId",
    "memoryLimitMiB",
    "pidsLimit",
    "historyRoot",
    "startupTimeoutMs",
    "networkMode",
    "accountSnapshot",
    "initialMode",
    "connection",
    "projectRoots",
    "sharedThread",
    "sharedDesktopSource",
    "serverSsh",
  ]);
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw failure("CONTAINER_INVALID_CONFIG");
  const sharedProperty = Object.getOwnPropertyDescriptor(
    options,
    "sharedThread",
  );
  if (sharedProperty && !Object.hasOwn(sharedProperty, "value"))
    throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  const sharedThread = normalizeContainerSharedAuthority(sharedProperty?.value);
  // Full original initialization, notifications and write operations remain
  // unverified; an opt-in callback set alone must not publish a broken mode.
  if (sharedThread) throw failure("CONTAINER_SHARED_NOT_READY");
  const sourceProperty=Object.getOwnPropertyDescriptor(options,"sharedDesktopSource");
  if(sourceProperty&&!Object.hasOwn(sourceProperty,"value"))throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  const sharedDesktopSource=sourceProperty?.value;
  if(sharedDesktopSource!==undefined&&(typeof ownedSharedDesktop.isOwnedSharedDesktopSourceFactory!=="function"||ownedSharedDesktop.isOwnedSharedDesktopSourceFactory(sharedDesktopSource)!==true))
    throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  if(recoveryIdentity&&sharedDesktopSource!==undefined)throw failure("CONTAINER_SHARED_RECOVERY_UNAVAILABLE");
  const serverSsh = containerServerSshOption(options);
  if (recoveryIdentity && serverSsh) throw failure("CONTAINER_SSH_RECOVERY_UNAVAILABLE");

  const memoryProperty = Object.getOwnPropertyDescriptor(
    options,
    "memoryLimitMiB",
  );
  if (memoryProperty && !Object.hasOwn(memoryProperty, "value"))
    throw failure("CONTAINER_INVALID_CONFIG");
  const memoryLimitMiB = normalizeContainerMemoryLimitMiB(
    memoryProperty?.value,
  );
  const pidsProperty = Object.getOwnPropertyDescriptor(options, "pidsLimit");
  if (pidsProperty && !Object.hasOwn(pidsProperty, "value"))
    throw failure("CONTAINER_INVALID_CONFIG");
  const pidsLimit = normalizeContainerPidsLimit(pidsProperty?.value);
  const historyProperty = Object.getOwnPropertyDescriptor(
    options,
    "historyRoot",
  );
  if (historyProperty && !Object.hasOwn(historyProperty, "value"))
    throw failure("CONTAINER_HISTORY_INVALID_CONFIG");
  const historyRoot = normalizePersistentHistoryRoot(historyProperty?.value);
  const {
    imageDigest,
    sourceRoot,
    runtimeRoot,
    bridgeRoot,
    profileId,
    generation,
    dockerPath,
    dockerSha256,
    pythonPath,
    pythonSha256,
    nodePath,
    nodeSha256,
    cpuId,
    startupTimeoutMs = 90000,
    networkMode = "none",
  } = options;
  const accountSnapshot = normalizeContainerAccountSnapshot(
    options.accountSnapshot,
  );
  if(sharedDesktopSource&&accountSnapshot&&historyRoot===undefined)throw failure("CONTAINER_SHARED_IDENTITY_UNAVAILABLE");
  const modeProperty = Object.getOwnPropertyDescriptor(options, "initialMode");
  if (
    modeProperty &&
    (!Object.hasOwn(modeProperty, "value") ||
      (modeProperty.value !== undefined && modeProperty.value !== "codex"))
  )
    throw failure("CONTAINER_INVALID_CONFIG");
  const initialMode = modeProperty?.value;
  const connectionProperty = Object.getOwnPropertyDescriptor(
    options,
    "connection",
  );
  if (connectionProperty && !Object.hasOwn(connectionProperty, "value"))
    throw failure("CONTAINER_INVALID_CONFIG");
  const connection = normalizeDesktopConnection(connectionProperty?.value);
  const rootsProperty = Object.getOwnPropertyDescriptor(
    options,
    "projectRoots",
  );
  if (rootsProperty && !Object.hasOwn(rootsProperty, "value"))
    throw failure("CONTAINER_PROJECT_INVALID_CONFIG");
  const projectRoots = normalizeProjectRoots(rootsProperty?.value);
  // Reattachment may only reuse the original account-backed history authority.
  // An account without its bound persistent history remains unverifiable.
  if (recoveryIdentity && (
    (accountSnapshot !== undefined) !== (recoveryIdentity.account.kind === "chatgpt") ||
    (accountSnapshot !== undefined && historyRoot === undefined)
  ))
    throw failure("CONTAINER_RECOVERY_ACCOUNT_UNAVAILABLE");
  const uid = process.getuid?.(),
    gid = process.getgid?.();
  if (
    uid === undefined ||
    gid === undefined ||
    !["none", "bridge"].includes(networkMode) ||
    (accountSnapshot !== undefined && networkMode !== "bridge") ||
    (connection !== undefined && networkMode !== "bridge") ||
    !IMAGE.test(imageDigest ?? "") ||
    !UUID.test(profileId ?? "") ||
    !UUID.test(generation ?? "") ||
    [
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      dockerPath,
      pythonPath,
      nodePath,
    ].some((x) => !pathOK(x)) ||
    [
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      nodePath,
      accountSnapshot?.homeRoot,
    ].some((path) => path !== undefined && path.includes(",")) ||
    !Number.isSafeInteger(cpuId) ||
    cpuId < 0 ||
    cpuId > 65535 ||
    [dockerSha256, pythonSha256, nodeSha256].some(
      (x) =>
        !SHA.test(x ?? "") ||
        !Number.isSafeInteger(startupTimeoutMs) ||
        startupTimeoutMs < 100 ||
        startupTimeoutMs > 180000,
    ) ||
    Buffer.byteLength(join(bridgeRoot, "socket")) > 107 ||
    contains(sourceRoot, runtimeRoot) ||
    contains(runtimeRoot, sourceRoot) ||
    contains(sourceRoot, bridgeRoot) ||
    contains(bridgeRoot, sourceRoot) ||
    contains(runtimeRoot, bridgeRoot) ||
    contains(bridgeRoot, runtimeRoot) ||
    (accountSnapshot &&
      [
        sourceRoot,
        runtimeRoot,
        bridgeRoot,
        dockerPath,
        pythonPath,
        nodePath,
        accountSnapshot.sourceFile,
      ].some(
        (path) =>
          contains(path, accountSnapshot.homeRoot) ||
          contains(accountSnapshot.homeRoot, path),
      )) ||
    (accountSnapshot &&
      [
        sourceRoot,
        runtimeRoot,
        bridgeRoot,
        dockerPath,
        pythonPath,
        nodePath,
      ].some(
        (path) =>
          contains(path, accountSnapshot.sourceFile) ||
          contains(accountSnapshot.sourceFile, path),
      ))
  )
    throw failure("CONTAINER_INVALID_CONFIG");
  const socketPath = join(bridgeRoot, "socket"),
    grantPath = join(bridgeRoot, "grant.json"),
    configDir = join(bridgeRoot, "docker-config"),
    home = join(runtimeRoot, "home"),
    homeSource = accountSnapshot?.homeRoot ?? home,
    bundleRoot = join(runtimeRoot, "container-bundle"),
    sourceAsar = join(sourceRoot, "resources", "app.asar"),
    executable = join(runtimeRoot, "ChatGPT");
  if (recoveryIdentity && (recoveryIdentity.profileId !== profileId || recoveryIdentity.generation !== generation ||
      recoveryIdentity.bootId !== (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() ||
      !matchesContainerRecoveryIdentity(recoveryIdentity, recoveryIdentity, matchesContainerProcessIdentitySync)))
    throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE");
  let containerId = recoveryIdentity?.containerId,
    helper,
    helperExited,
    inbox,
    reader,
    intentionalDisconnect = false,
    disconnected = true,
    broken = false,
    queuedBytes = 0,
    managerInfo,
    initInfo,
    serverInfo,
    nodeInfo,
    nativeInfo,
    socketInfo,
    helperInfo,
    credentialHomeInfo,
    initialPreference,
    projectMounts,
    projectGuard,
    historyMounts,
    historyGuard,
    projectStore,
    projectSeed,
    projectMonitor,
    sharedBridge,
    sharedIdentityReady=false;
  // A recovered manager cannot safely adopt the original live writer's
  // pending snapshot yet.  Expose the unavailable state instead of implying
  // that a monitor will eventually save it.
  let projectPersistenceState = historyRoot === undefined ? "disabled" : recoveryIdentity ? "error" : "waiting";
  const projectAuthority = (writer) => {
    try {
      if (!historyMounts?.verifySync() || (projectMounts && !projectMounts.verifySync())) return false;
      if (historyGuard && !historyGuard()) return false;
      if (projectGuard && !projectGuard()) return false;
      if (writer !== null && (!historyGuard || (projectMounts && !projectGuard) ||
          writer.containerId !== containerId || writer.profileId !== profileId || writer.generation !== generation)) return false;
      return true;
    } catch { return false; }
  };
  let resolveNativeExit,
    nativeExitSettled = false,
    nativeMonitor;
  const nativeExited = new Promise((done) => {
    resolveNativeExit = done;
  });
  const subscribers = new Set(),
    unavailable = new Set(),
    views = new Set(),
    closingViews = new Set(),
    viewSequences = new Map(),
    usedViews = new Set();
  const ordinaryState = {
    profileId,
    generation,
    views,
    closingViews,
    sequences: viewSequences,
  };
  let token = recoveryIdentity ? undefined : randomBytes(32).toString("hex");
  const sharedHandles=[];
  const snapshots = [],
    directories = [],
    initialGrant = createInitialGrantAttempt();
  if (recoveryIdentity) {
    initInfo = recoveryIdentity.processes.init;
    serverInfo = recoveryIdentity.processes.bridge;
    nodeInfo = recoveryIdentity.processes.node;
    nativeInfo = recoveryIdentity.processes.native;
  }
  const dockerEnv = {
    HOME: bridgeRoot,
    PATH: "/usr/bin:/bin",
    DOCKER_CONFIG: configDir,
  };
  const docker = async (...args) => {
    try {
      return (
        await exec(dockerPath, args, {
          env: dockerEnv,
          cwd: bridgeRoot,
          timeout: 20000,
          maxBuffer: 1024 * 1024,
          shell: false,
        })
      ).stdout.trim();
    } catch {
      throw failure("CONTAINER_DOCKER_FAILED");
    }
  };
  function signalUnavailable() {
    if (broken) return;
    broken = true;
    closeSharedSource();
    for (const fn of unavailable) {
      try {
        Promise.resolve(fn()).catch(() => {});
      } catch {}
    }
  }
  function reportNativeExit() {
    if (nativeExitSettled) return;
    nativeExitSettled = true;
    closeSharedSource();
    clearInterval(nativeMonitor);
    projectMonitor?.close();
    projectStore?.close();
    void projectMounts?.close().catch(() => {});
    historyMounts?.close();
    resolveNativeExit(Object.freeze({ state: "exited" }));
  }
  function monitorNative() {
    if (nativeMonitor || !nativeInfo) return;
    let running = false;
    nativeMonitor = setInterval(async () => {
      if (running || nativeExitSettled) return;
      running = true;
      try {
        const stat = await readFile(`/proc/${nativeInfo.pid}/stat`, "utf8");
        const start = stat.indexOf(" ("),
          end = stat.lastIndexOf(") ");
        if (
          start < 1 ||
          end < start ||
          stat.slice(0, start) !== String(nativeInfo.pid)
        )
          return signalUnavailable();
        const fields = stat
          .slice(end + 2)
          .trim()
          .split(/\s+/);
        if (!TICKS.test(fields[19] ?? "")) return signalUnavailable();
        if (
          fields[19] !== nativeInfo.ticks ||
          ["Z", "X", "x"].includes(fields[0])
        )
          reportNativeExit();
      } catch (error) {
        if (error?.code === "ENOENT") reportNativeExit();
        else signalUnavailable();
      } finally {
        running = false;
      }
    }, 1000);
  }
  async function fixedFiles(existing = false) {
    const info = await lstat(pkg, { bigint: true });
    if (
      (await realpath(pkg)) !== pkg ||
      !info.isDirectory() ||
      info.uid !== BigInt(uid) ||
      info.mode & 0o002n
    )
      throw failure("CONTAINER_UNSAFE_PATH");
    if (!existing) await mkdir(bundleRoot, { mode: 0o700 });
    else await directory(bundleRoot, uid, true);
    for (const [name, digest] of Object.entries(FIXED)) {
      const source = join(pkg, name),
        target = join(bundleRoot, name),
        original = await file(source, uid, digest, true);
      if (!existing) {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        await chmod(target, 0o600);
      }
      if (!sameFile(original, await lstat(source, { bigint: true })))
        throw failure("CONTAINER_ARTIFACT_CHANGED");
      snapshots.push(
        { path: source, info: original },
        { path: target, info: await file(target, uid, digest) },
      );
    }
  }
  async function inspectContainer() {
    const format =
      '{"id":{{json .Id}},"image":{{json .Image}},"pid":{{json .State.Pid}},"host":{{json .HostConfig}},"mounts":{{json .Mounts}},"user":{{json .Config.User}},"entry":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"env":{{json .Config.Env}}}';
    let value;
    try {
      value = JSON.parse(
        await docker("inspect", "--format", format, containerId),
      );
    } catch {
      throw failure("CONTAINER_IDENTITY_CHANGED");
    }
    return assertContainerInspection(value, {
      containerId,
      imageDigest,
      uid,
      gid,
      cpuId,
      memoryLimitMiB,
      pidsLimit,
      networkMode,
      sourceRoot,
      runtimeRoot,
      home,
      homeSource,
      bridgeRoot,
      bundleRoot,
      nodePath,
      ...(projectMounts ? { projectMounts } : {}),
      ...(historyMounts ? { historyMounts } : {}),
    });
  }
  async function currentIdentity(includeHelper = true) {
    try {
      if (
        broken ||
        !managerInfo ||
        !initInfo ||
        !serverInfo ||
        !nodeInfo ||
        !nativeInfo ||
        (includeHelper && (!helper || disconnected))
      )
        return false;
      if (projectMounts && !projectGuard?.()) return false;
      if (historyMounts && !historyGuard?.()) return false;
      const roots = [
        managerInfo,
        initInfo,
        serverInfo,
        nodeInfo,
        nativeInfo,
        ...(includeHelper ? [helperInfo] : []),
      ];
      const actual = await Promise.all(roots.map((entry) => proc(entry.pid)));
      if (actual.some((entry, index) => !sameProcess(entry, roots[index])))
        return false;
      if (
        accountSnapshot &&
        !sameDir(credentialHomeInfo, readOwnedTmpfsHomeIdentitySync(homeSource, uid))
      )
        return false;
      return verifyContainerFileIdentities({
        snapshots,
        directories,
        socketPath,
        socketInfo,
      });
    } catch {
      return false;
    }
  }
  async function preparationIdentity() {
    try {
      if (projectMounts && !projectGuard?.()) return false;
      if (historyMounts && !historyGuard?.()) return false;
      if (initialPreference && !initialPreference.verifyBeforeGrant())
        return false;
      if (
        !sameProcess(managerInfo, await proc(process.pid)) ||
        !sameProcess(helperInfo, await proc(helper.pid))
      )
        return false;
      if (
        accountSnapshot &&
        !sameDir(credentialHomeInfo, await tmpfsHome(homeSource, uid))
      )
        return false;
      for (const entry of snapshots)
        if (!sameFile(entry.info, await lstat(entry.path, { bigint: true })))
          return false;
      for (const entry of directories)
        if (!sameDir(entry.info, await lstat(entry.path, { bigint: true })))
          return false;
      const current = await lstat(socketPath, { bigint: true });
      return current.isSocket() && sameDir(socketInfo, current);
    } catch {
      return false;
    }
  }
  function closeSharedSource(){
    sharedIdentityReady=false;sharedWriteAbort.abort();sharedBridge?.close();
    for(const {handle} of sharedHandles.splice(0))void handle.close().catch(()=>{});
  }
  async function captureSharedHandles(){
    if(!sharedDesktopSource)return;
    if(sharedIdentityReady||sharedHandles.length)throw failure("CONTAINER_SHARED_IDENTITY_UNAVAILABLE");
    // The existing history owner carries the authenticated source/live-HOME
    // anchor. A HOME inode alone cannot substitute for that account identity.
    if(accountSnapshot&&!historyMounts)throw failure("CONTAINER_SHARED_IDENTITY_UNAVAILABLE");
    try{
      for(const entry of [...snapshots.map(entry=>({...entry,directory:false})),...directories.map(entry=>({...entry,directory:true}))]){
        const handle=await open(entry.path,constants.O_RDONLY|constants.O_NOFOLLOW|(entry.directory?constants.O_DIRECTORY:0));
        const held={...entry,handle};sharedHandles.push(held);
        if(!(entry.directory?sameDir:sameFile)(entry.info,await handle.stat({bigint:true})))throw Error();
      }
      sharedIdentityReady=true;
      if(!verifySharedIdentitySync())throw Error();
    }catch{closeSharedSource();throw failure("CONTAINER_SHARED_IDENTITY_UNAVAILABLE");}
  }
  function verifySharedIdentitySync(){
    try{
      if(!sharedIdentityReady||broken||disconnected||!helper?.stdin?.writable||nativeExitSettled||
         [managerInfo,initInfo,serverInfo,nodeInfo,nativeInfo,helperInfo].some(entry=>!entry||!matchesContainerProcessIdentitySync(entry))||
         (projectMounts&&!projectGuard?.())||(historyMounts&&!historyGuard?.())||
         (accountSnapshot&&(!historyMounts||!sameDir(credentialHomeInfo,readOwnedTmpfsHomeIdentitySync(homeSource,uid))))||
         !verifyContainerFileIdentitiesSync({snapshots,directories,socketPath,socketInfo})||
         sharedHandles.length!==snapshots.length+directories.length)return false;
      return sharedHandles.every(entry=>(entry.directory?sameDir:sameFile)(entry.info,fstatSync(entry.handle.fd,{bigint:true})));
    }catch{return false;}
  }
  async function writeSharedNative(encoded,finalVerifySync){
    if(typeof encoded!=="string"||typeof finalVerifySync!=="function")throw failure("CONTAINER_SHARED_PROTOCOL_ERROR");
    const frame=decodeWireValue(encoded);
    if(!frame||frame.v!==1||typeof frame.type!=="string"||!frame.type.startsWith("shared-")||frame.profileId!==profileId||frame.generation!==generation)
      throw failure("CONTAINER_SHARED_PROTOCOL_ERROR");
    const control={signal:sharedWriteAbort.signal,deadline:performance.now()+startupTimeoutMs,onDispatch(){}};
    try{return await runAuthorizedContainerWrite(control,verifyIdentity,()=>prepareWriteFrame(encoded,()=>{
      if(!verifySharedIdentitySync()||finalVerifySync()!==true)throw failure("CONTAINER_IDENTITY_CHANGED");
    },control));}catch(error){signalUnavailable();throw error;}
  }
  const sharedWriteAbort=new AbortController();
  if(sharedDesktopSource)sharedBridge=createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync:verifySharedIdentitySync,writeNative:writeSharedNative});
  async function initializeSharedSource(){
    if(!sharedDesktopSource)return;
    let accepting=true;
    const pending=Promise.resolve().then(()=>sharedDesktopSource.create(sharedBridge.context));
    pending.then(source=>{if(!accepting)try{source?.close?.();}catch{}},()=>{});
    try{
      const source=await timeout(pending,startupTimeoutMs);
      if(!verifySharedIdentitySync()){try{source?.close?.();}catch{}throw failure("CONTAINER_IDENTITY_CHANGED");}
      sharedBridge.activate(source);
    }catch(error){closeSharedSource();throw error;}
    finally{accepting=false;}
  }
  async function verifyIdentity() {
    const valid = await currentIdentity();
    if (!valid) signalUnavailable();
    return valid;
  }
  async function captureRecoveryIdentity({ configSha256 } = {}) {
    if (!SHA.test(configSha256 ?? "") || !(await currentIdentity()))
      throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE");
    // The existing persistent-history authority already checks the source and
    // live HOME account before every write. Without it no durable account
    // binding exists, so an account-bearing recovery witness is not issued.
    if (accountSnapshot && !historyMounts)
      throw failure("CONTAINER_RECOVERY_ACCOUNT_UNAVAILABLE");
    const fields = (info, keys) => keys.map((key) => String(info[key]));
    const fileKeys = ["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs", "ctimeNs"];
    const directoryKeys = ["dev", "ino", "uid", "gid", "mode"];
    const digest = createHash("sha256").update(JSON.stringify({
      files: snapshots.map(({ path, info }) => [path, ...fields(info, fileKeys)]),
      directories: directories.map(({ path, info }) => [path, ...fields(info, directoryKeys)]),
      socket: [socketPath, ...fields(socketInfo, directoryKeys)],
    })).digest("hex");
    const projects = [];
    for (const path of projectRoots) {
      const info = await lstat(path, { bigint: true });
      projects.push(Object.fromEntries([
        ["path", path], ...directoryKeys.map((key) => [key, String(info[key])]),
      ]));
    }
    const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    if (!(await currentIdentity())) throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE");
    return captureContainerRecoveryIdentity({
      version: 1, containerId, profileId, generation, bootId, configSha256,
      filesSha256: digest,
      account: accountSnapshot
        ? { kind: "chatgpt", binding: historyMounts.accountBinding }
        : { kind: "anonymous", binding: null },
      projects,
      processes: { init: initInfo, bridge: serverInfo, node: nodeInfo, native: nativeInfo },
    });
  }
  function prepareWriteFrame(value, onWrite = () => {}, control) {
    if (!helper?.stdin?.writable || disconnected || broken)
      throw failure("CONTAINER_TRANSPORT_CLOSED");
    const bytes = Buffer.byteLength(value);
    if (bytes > MAX || queuedBytes + bytes + 1 > MAX + 1)
      throw failure("CONTAINER_QUEUE_FULL");
    const stdin = helper.stdin;
    return () => {
      // This closure runs after onDispatch and immediately before stdin.write.
      // It must not authorize a replaced host root or a reused container PID.
      if (projectMounts && !projectGuard?.())
        throw failure("CONTAINER_IDENTITY_CHANGED");
      if (historyMounts && !historyGuard?.())
        throw failure("CONTAINER_IDENTITY_CHANGED");
      if (control) assertContainerWriteAuthority(control);
      if (helper?.stdin !== stdin || !stdin.writable || disconnected || broken)
        throw failure("CONTAINER_TRANSPORT_CLOSED");
      onWrite();
      queuedBytes += bytes + 1;
      return new Promise((resolveWrite, rejectWrite) =>
        stdin.write(value + "\n", (error) =>
          error ? rejectWrite(error) : resolveWrite(),
        ),
      )
        .catch(() => {
          signalUnavailable();
          throw failure("CONTAINER_TRANSPORT_CLOSED");
        })
        .finally(() => {
          queuedBytes -= bytes + 1;
        });
    };
  }
  async function writeFrame(value) {
    return prepareWriteFrame(value)();
  }
  async function nextLine() {
    const item = await timeout(inbox.next(), startupTimeoutMs);
    if (item.done || typeof item.value !== "string")
      throw failure("CONTAINER_TRANSPORT_CLOSED");
    return item.value;
  }
  async function openTransport(existing) {
    if (helper && !disconnected) throw failure("CONTAINER_BUSY");
    intentionalDisconnect = false;
    helper = spawn(
      pythonPath,
      [
        "-I",
        "-u",
        "-B",
        join(bundleRoot, "container-peer-helper.py"),
        socketPath,
      ],
      {
        cwd: bridgeRoot,
        env: {},
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    helperExited = observeContainerHelperExit(helper);
    helper.on("error", () => signalUnavailable());
    observeContainerHelperInput(helper.stdin, signalUnavailable);
    if (!Number.isSafeInteger(helper.pid) || helper.pid <= 1)
      throw failure("CONTAINER_TRANSPORT_CLOSED");
    helperInfo = await proc(helper.pid);
    if (helperInfo.uid !== uid || helperInfo.ppid !== process.pid)
      throw failure("CONTAINER_IDENTITY_CHANGED");
    inbox = parseJsonLines(readBoundedChunks(helper.stdout, 65536), {
      maxLineBytes: MAX,
      maxChunkBytes: 65536,
    })[Symbol.asyncIterator]();
    const peer = JSON.parse(await nextLine());
    const hello = JSON.parse(await nextLine());
    if (recoveryIdentity && peer?.type === "peer" && peer.uid === uid && peer.gid === gid &&
        Number.isSafeInteger(peer.pid) && hello?.type === "server" &&
        hello.profileId === profileId && hello.generation === generation &&
        hello.existing === true && hello.dirty === true)
      throw failure("CONTAINER_RECOVERY_STREAM_DIRTY");
    if (
      !peer ||
      peer.type !== "peer" ||
      peer.uid !== uid ||
      peer.gid !== gid ||
      !Number.isSafeInteger(peer.pid) ||
      !hello ||
      hello.type !== "server" ||
      hello.profileId !== profileId ||
      hello.generation !== generation ||
      hello.existing !== existing ||
      hello.dirty !== false ||
      !/^[a-f0-9]{64}$/.test(hello.challenge ?? "")
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    const initPid = await inspectContainer();
    const nowInit = await proc(initPid),
      nowServer = await proc(peer.pid),
      hostPidns = await readlink("/proc/self/ns/pid");
    if (
      nowInit.uid !== uid ||
      nowServer.uid !== uid ||
      nowInit.cpus !== String(cpuId) ||
      nowServer.cpus !== String(cpuId) ||
      nowServer.noNewPrivs !== "1" ||
      nowServer.seccomp !== "2" ||
      !/^0+$/.test(nowServer.capEff ?? "") ||
      nowServer.ppid !== nowInit.pid ||
      nowServer.nspids.at(-1) !== hello.bridgePid ||
      nowInit.nspids.at(-1) !== 1 ||
      nowInit.pidns === hostPidns ||
      nowServer.pidns !== nowInit.pidns ||
      nowServer.cgroup !== nowInit.cgroup ||
      ![`/docker-${containerId}.scope`, `/docker/${containerId}`].some(
        (suffix) => nowInit.cgroup.endsWith(suffix),
      )
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    if (
      existing &&
      (!sameProcess(initInfo, nowInit) || !sameProcess(serverInfo, nowServer))
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    initInfo = nowInit;
    serverInfo = nowServer;
    if (projectMounts) {
      projectGuard = createContainerProjectGuard(projectMounts, nowInit);
      if (!projectGuard()) throw failure("CONTAINER_IDENTITY_CHANGED");
    }
    if (historyMounts) {
      if (!existing)
        historyMounts.bindProcess({
          containerId,
          identity: nowInit,
          verifyProcess: (pid) =>
            pid === nowInit.pid && matchesContainerProcessIdentitySync(nowInit),
        });
      historyGuard = createContainerProjectGuard(historyMounts, nowInit);
      if (!historyGuard()) throw failure("CONTAINER_IDENTITY_CHANGED");
      if (!existing && projectStore) {
        try { projectStore.adopt({ containerId, profileId, generation }); }
        catch { throw failure("CONTAINER_HISTORY_UNAVAILABLE"); }
      }
    }
    socketInfo = await lstat(socketPath, { bigint: true });
    if (
      !socketInfo.isSocket() ||
      socketInfo.uid !== BigInt(uid) ||
      (socketInfo.mode & 0o7777n) !== 0o600n
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    if (!(await preparationIdentity()))
      throw failure("CONTAINER_IDENTITY_CHANGED");
    disconnected = false;
    if (recoveryIdentity) {
      const observed = await captureRecoveryIdentity({ configSha256: recoveryIdentity.configSha256 });
      if (!matchesContainerRecoveryIdentity(recoveryIdentity, observed, matchesContainerProcessIdentitySync))
        throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE");
    }
    const sendGrant = () =>
      writeFrame(
        JSON.stringify({ type: "grant", token, challenge: hello.challenge }),
      );
    if (existing) await sendGrant();
    else {
      // No await may separate this final check from the first grant attempt.
      if (initialPreference && !initialPreference.verifyBeforeGrant())
        throw failure("CONTAINER_IDENTITY_CHANGED");
      if (projectSeed && !projectSeed.verifyBeforeGrant())
        throw failure("CONTAINER_IDENTITY_CHANGED");
      await initialGrant.send(sendGrant);
      await initialPreference?.close();
      initialPreference = undefined;
      projectSeed?.close(); projectSeed = undefined;
    }
    const node = JSON.parse(await nextLine());
    const rawReady = await nextLine(),
      ready = decodeWireValue(rawReady);
    if (
      !node ||
      node.type !== "node" ||
      !Number.isSafeInteger(node.pid) ||
      !ready ||
      ready.v !== 1 ||
      ready.type !== "ready" ||
      ready.profileId !== profileId ||
      ready.generation !== generation ||
      !Number.isSafeInteger(ready.pid)
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    const nowNode = await childByNamespace(
      serverInfo.pid,
      node.pid,
      uid,
      initInfo.cgroup,
      initInfo.pidns,
    );
    const nowNative = await childByNamespace(
      nowNode.pid,
      ready.pid,
      uid,
      initInfo.cgroup,
      initInfo.pidns,
    );
    if (
      existing &&
      (!sameProcess(nodeInfo, nowNode) || !sameProcess(nativeInfo, nowNative))
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    nodeInfo = nowNode;
    nativeInfo = nowNative;
    if (!(await currentIdentity())) throw failure("CONTAINER_IDENTITY_CHANGED");
    if (recoveryIdentity) {
      const nonce = randomUUID();
      await writeFrame(encodeWireValue({ v: 1, type: "recoveryStatus", nonce }));
      const reply = decodeWireValue(await nextLine());
      requireIdleContainerRecoveryReply(reply, { nonce, profileId, generation });
      const observed = await captureRecoveryIdentity({ configSha256: recoveryIdentity.configSha256 });
      if (!matchesContainerRecoveryIdentity(recoveryIdentity, observed, matchesContainerProcessIdentitySync))
        throw failure("CONTAINER_RECOVERY_IDENTITY_UNAVAILABLE");
    }
    if (!existing && projectStore) {
      try {
        projectStore.bindNative({ containerId, profileId, generation },
          { pid: nowNative.pid, startTicks: nowNative.ticks, pidns: nowNative.pidns, uid: nowNative.uid },
          () => matchesContainerProcessIdentitySync(nowNative));
      } catch {
        projectPersistenceState = "error";
        projectStore.close(); projectStore = undefined;
      }
    }
    if(sharedDesktopSource)await captureSharedHandles();
    reader = (async () => {
      try {
        await consumeContainerOutput(inbox, (encoded) => {
          const frame = decodeContainerOutput(encoded);
          if (frame === null) {
            reportNativeExit();
            return false;
          }
          if(typeof frame.type==="string"&&frame.type.startsWith("shared-")){
            if(!sharedBridge)throw failure("CONTAINER_SHARED_NOT_READY");
            sharedBridge.receiveNative(frame,encoded);return;
          }
          if (frame.type === "viewClosed") {
            const scope = frame.scope;
            if (
              !scope ||
              scope.profileId !== profileId ||
              scope.generation !== generation ||
              !closingViews.has(scope.viewId)
            )
              throw Error();
            sharedBridge?.retireView(scope.viewId);
            views.delete(scope.viewId);
            closingViews.delete(scope.viewId);
            viewSequences.delete(scope.viewId);
          }
          return Promise.all(
            [...subscribers].map((subscriber) => subscriber(encoded)),
          );
        });
      } catch {}
      if (!intentionalDisconnect) signalUnavailable();
    })();
  }
  const upstream = Object.freeze({
    explicitDispatch: true,
    async send(encoded, control) {
      if (typeof encoded !== "string")
        throw failure("CONTAINER_PROTOCOL_ERROR");
      const frame = decodeWireValue(encoded);
      if (
        !frame ||
        frame.v !== 1 ||
        ![
          "createView",
          "destroyView",
          "call",
          "openPort",
          "portPost",
          "closePort",
        ].includes(frame.type)
      )
        throw failure("CONTAINER_PROTOCOL_ERROR");
      await runAuthorizedContainerWrite(control, verifyIdentity, () => {
        let onWrite = () => {};
        if (frame.type === "createView") {
          if (
            !UUID.test(frame.viewId ?? "") ||
            usedViews.has(frame.viewId) ||
            usedViews.size >= 8192
          )
            throw failure("CONTAINER_PROTOCOL_ERROR");
          onWrite = () => {
            sharedBridge?.viewCreated(frame.viewId);
            views.add(frame.viewId);
            usedViews.add(frame.viewId);
            viewSequences.set(frame.viewId, 0);
          };
        } else if (frame.type === "destroyView") {
          if (
            !UUID.test(frame.viewId ?? "") ||
            !views.has(frame.viewId) ||
            closingViews.has(frame.viewId)
          )
            throw failure("CONTAINER_PROTOCOL_ERROR");
          onWrite = () => {
            sharedBridge?.retireView(frame.viewId);
            closingViews.add(frame.viewId);
          };
        } else {
          assertOrdinaryContainerFrame(
            frame,
            ordinaryState,
            (viewSequences.get(frame.scope?.viewId) ?? 0) + 1,
          );
          onWrite = () => {
            assertOrdinaryContainerFrame(
              frame,
              ordinaryState,
              (viewSequences.get(frame.scope?.viewId) ?? 0) + 1,
            );
            viewSequences.set(frame.scope.viewId, frame.seq);
          };
        }
        return prepareWriteFrame(encoded, onWrite, control);
      });
    },
    async sendBatch(entries) {
      const fixed = snapshotContainerWriteBatch(entries);
      let attempted = 0;
      try {
        await runAuthorizedContainerBatch(fixed, verifyIdentity, (batch) => {
          const total = batch.reduce(
            (sum, entry) => sum + Buffer.byteLength(entry.encoded) + 1,
            0,
          );
          if (queuedBytes + total > MAX + 1)
            throw failure("CONTAINER_QUEUE_FULL");
          const frames = inspectContainerOrdinaryBatch(batch, ordinaryState);
          return batch.map((entry, index) =>
            prepareWriteFrame(
              entry.encoded,
              () => {
                const frame = frames[index];
                assertOrdinaryContainerFrame(
                  frame,
                  ordinaryState,
                  (viewSequences.get(frame.scope.viewId) ?? 0) + 1,
                );
                viewSequences.set(frame.scope.viewId, frame.seq);
                attempted++;
              },
              entry,
            ),
          );
        });
      } catch (error) {
        if (attempted) signalUnavailable();
        throw error;
      }
    },
    subscribe(fn) {
      if (typeof fn !== "function") throw failure("CONTAINER_INVALID_CONFIG");
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  });
  async function disconnectTransport() {
    if (views.size || queuedBytes) throw failure("CONTAINER_BUSY");
    if (disconnected) return;
    closeSharedSource();
    intentionalDisconnect = true;
    disconnected = true;
    helper.stdin.end();
    await timeout(helperExited, 5000);
    await reader;
  }
  async function reconnectTransport() {
    if(serverSsh)throw failure("CONTAINER_SSH_RECOVERY_UNAVAILABLE");
    if(sharedDesktopSource)throw failure("CONTAINER_SHARED_RECOVERY_UNAVAILABLE");
    if (!disconnected || broken || views.size || queuedBytes)
      throw failure("CONTAINER_BUSY");
    await openTransport(true);
  }
  try {
    if (projectRoots.length)
      projectMounts = await prepareFixedProjectMounts({
        projectRoots,
        protectedPaths: {
          homes: [
            ...new Set([
              home,
              homeSource,
              ...(accountSnapshot ? [dirname(accountSnapshot.sourceFile)] : []),
            ]),
          ],
          auth: accountSnapshot ? [accountSnapshot.sourceFile] : [],
          runtime: [runtimeRoot, bundleRoot],
          control: [],
          bridge: [bridgeRoot],
          source: [sourceRoot, sourceAsar],
          tools: [dockerPath, pythonPath, nodePath, pkg],
        },
      });
    await Promise.all([
      directory(sourceRoot, uid),
      directory(join(sourceRoot, "resources"), uid),
      directory(dirname(runtimeRoot), uid, true),
      directory(bridgeRoot, uid, true),
    ]);
    if (accountSnapshot)
      credentialHomeInfo = await tmpfsHome(homeSource, uid, !recoveryIdentity);
    if (!recoveryIdentity) {
      if ((await readdir(bridgeRoot)).length)
        throw failure("CONTAINER_UNSAFE_PATH");
      try {
        await lstat(runtimeRoot);
        throw failure("CONTAINER_RUNTIME_EXISTS");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await preparePrivateRuntime({
        sourceRoot,
        runtimeRoot,
        profileId,
        generation,
        projectRoots,
        ...(sharedDesktopSource?{sharedThread:true,sharedAppTools:sharedDesktopSource.requiresAppTools===true}:{}),
        ...(serverSsh?{serverSsh:true}:{}),
      });
    }
    const [, homeInfo] = await Promise.all([
      directory(runtimeRoot, uid, true),
      directory(home, uid, true),
    ]);
    if (!recoveryIdentity && (await readdir(home)).length) throw failure("CONTAINER_UNSAFE_PATH");
    if (accountSnapshot && !recoveryIdentity) {
      if (!sameDir(credentialHomeInfo, await tmpfsHome(homeSource, uid, true)))
        throw failure("CONTAINER_IDENTITY_CHANGED");
      await seedDesktopAccountSnapshot(accountSnapshot);
      if (!sameDir(credentialHomeInfo, await tmpfsHome(homeSource, uid)))
        throw failure("CONTAINER_IDENTITY_CHANGED");
    }
    if (historyRoot !== undefined) {
      const historyOptions = {
        historyRoot,
        homeRoot: homeSource,
        containerHome: home,
        accountSeeded: accountSnapshot !== undefined,
        ...(accountSnapshot
          ? { accountSourceFile: accountSnapshot.sourceFile }
          : {}),
        protectedPaths: [
          sourceRoot,
          runtimeRoot,
          bridgeRoot,
          nodePath,
          pythonPath,
          dockerPath,
          pkg,
          ...projectRoots,
          ...(accountSnapshot ? [accountSnapshot.sourceFile] : []),
        ],
      };
      historyMounts = recoveryIdentity
        ? reopenContainerHistoryForRecovery(historyOptions, recoveryIdentity, () =>
            matchesContainerRecoveryIdentity(recoveryIdentity, recoveryIdentity, matchesContainerProcessIdentitySync))
        : preparePersistentHistory(historyOptions);
    }
    // Existing native HOME/project data stay owned by that native process. The
    // pending project snapshot must not be sealed, seeded, or adopted while
    // its original writer is still alive.
    if (historyMounts && !recoveryIdentity) {
      let prepared;
      try {
        const recoverySource = createProjectRecoverySource({ homeRoot: homeSource, accountSeeded: accountSnapshot !== undefined, allowedRoots: projectRoots });
        prepared = prepareLiveProjectPersistence({
          storeRoot: historyMounts.projectStateRoot,
          accountBinding: historyMounts.accountBinding,
          previousContainerId: historyMounts.previousContainerId,
          allowedRoots: projectRoots,
          verifyAuthority: projectAuthority,
          recoverySource,
          withPreviousOwnerLease: historyMounts.withPreviousOwnerLease,
        });
        projectStore = prepared.store;
        projectPersistenceState = prepared.state;
      } catch { projectPersistenceState = "error"; }
      if (prepared?.restored && projectStore) projectSeed = prepareNativeProjectSeed({
        homeRoot: homeSource,
        projection: projectStateProjection(prepared.restored, { allowedRoots: projectRoots }),
        allowedRoots: projectRoots,
        verifyAuthority: () => projectAuthority(null) && projectStore?.verifyRestored() === true,
      });
    }
    if (!recoveryIdentity && initialMode === "codex")
      initialPreference = await prepareInitialCodexMode({
        homeRoot: homeSource,
        homeIdentity: accountSnapshot ? credentialHomeInfo : homeInfo,
        accountSeeded: accountSnapshot !== undefined,
        historyDirectories: historyMounts !== undefined,
        projectStateSeeded: projectSeed !== undefined,
      });
    await fixedFiles(!!recoveryIdentity);
    for (const [path, digest] of [
      [dockerPath, dockerSha256],
      [pythonPath, pythonSha256],
      [nodePath, nodeSha256],
      [sourceAsar, PINNED_LINUX_RUNTIME.asarSha256],
      [join(sourceRoot, "ChatGPT"), PINNED_LINUX_RUNTIME.binarySha256],
      [executable, PINNED_LINUX_RUNTIME.binarySha256],
    ])
      snapshots.push({ path, info: await file(path, uid, digest) });
    const configPath = join(runtimeRoot, "resources", "private-config.json"),
      configInfo = await lstat(configPath, { bigint: true });
    if (
      !configInfo.isFile() ||
      configInfo.uid !== BigInt(uid) ||
      (configInfo.mode & 0o7777n) !== 0o600n ||
      configInfo.size > 16384n
    )
      throw failure("CONTAINER_UNSAFE_PATH");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (
      config.version !== 1 ||
      config.profileId !== profileId ||
      config.generation !== generation ||
      config.runtimeRoot !== runtimeRoot ||
      config.home !== home ||
      config.originalAsar !== sourceAsar ||
      config.binarySha256 !== PINNED_LINUX_RUNTIME.binarySha256 ||
      config.asarSha256 !== PINNED_LINUX_RUNTIME.asarSha256 ||
      JSON.stringify(config.projectRoots) !== JSON.stringify(projectRoots)
      || (serverSsh ? !config.serverSsh || Object.keys(config.serverSsh).join(",") !== "version" || config.serverSsh.version !== 1 : Object.hasOwn(config,"serverSsh"))
    )
      throw failure("CONTAINER_INVALID_CONFIG");
    snapshots.push({ path: configPath, info: configInfo });
    for (const path of [
      join(runtimeRoot, "resources", "app.asar"),
      join(runtimeRoot, "resources", "private-preload.js"),
    ]) {
      const info = await lstat(path, { bigint: true });
      if (
        !info.isFile() ||
        info.uid !== BigInt(uid) ||
        (info.mode & 0o7777n) !== 0o600n ||
        (await realpath(path)) !== path
      )
        throw failure("CONTAINER_UNSAFE_PATH");
      snapshots.push({ path, info });
    }
    if (!recoveryIdentity) await mkdir(configDir, { mode: 0o700 });
    else await directory(configDir, uid, true);
    const grantBody =
      JSON.stringify({
        version: 1,
        profileId,
        generation,
        runtimeRoot,
        token,
        ...(connection === undefined ? {} : { connection }),
        ...(historyMounts
          ? {
              history: {
                version: 1,
                accountBinding: historyMounts.accountBinding,
              },
            }
          : {}),
      }) + "\n";
    if (Buffer.byteLength(grantBody) > 4096)
      throw failure("CONTAINER_INVALID_CONNECTION");
    if (!recoveryIdentity) await writeFile(grantPath, grantBody, { flag: "wx", mode: 0o600 });
    const grantInfo = await lstat(grantPath, { bigint: true });
    if (
      !grantInfo.isFile() ||
      grantInfo.uid !== BigInt(uid) ||
      (grantInfo.mode & 0o7777n) !== 0o600n || grantInfo.nlink !== 1n ||
      grantInfo.size > 4096n || (await realpath(grantPath)) !== grantPath
    )
      throw failure("CONTAINER_UNSAFE_PATH");
    if (recoveryIdentity) {
      const grantFd = await open(grantPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const body = Buffer.alloc(4097);
      try {
        if (!sameFile(grantInfo, await grantFd.stat({ bigint: true }))) throw Error();
        let length = 0;
        while (length < body.length) {
          const { bytesRead } = await grantFd.read(body, length, body.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > 4096 || BigInt(length) !== grantInfo.size) throw Error();
        const existing = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, length)));
        const keys = ["version", "profileId", "generation", "runtimeRoot", "token", ...(connection === undefined ? [] : ["connection"]), ...(historyMounts ? ["history"] : [])];
        if (!existing || Object.keys(existing).sort().join(",") !== keys.sort().join(",") ||
            existing.version !== 1 || existing.profileId !== profileId || existing.generation !== generation ||
            existing.runtimeRoot !== runtimeRoot || !SHA.test(existing.token ?? "") ||
            JSON.stringify(existing.connection) !== JSON.stringify(connection) ||
            (historyMounts && (!existing.history || Object.keys(existing.history).sort().join(",") !== "accountBinding,version" ||
              existing.history.version !== 1 || existing.history.accountBinding !== historyMounts.accountBinding)) ||
            !sameFile(grantInfo, await grantFd.stat({ bigint: true })) ||
            !sameFile(grantInfo, await lstat(grantPath, { bigint: true }))) throw Error();
        token = existing.token;
      } finally { body.fill(0); await grantFd.close(); }
    }
    snapshots.push({ path: grantPath, info: grantInfo });
    for (const path of [
      ...new Set([
        sourceRoot,
        join(sourceRoot, "resources"),
        dirname(runtimeRoot),
        runtimeRoot,
        home,
        homeSource,
        bundleRoot,
        bridgeRoot,
        configDir,
      ]),
    ])
      directories.push({ path, info: await lstat(path, { bigint: true }) });
    if (
      (await docker("image", "inspect", "--format", "{{.Id}}", imageDigest)) !==
      imageDigest
    )
      throw failure("CONTAINER_IDENTITY_CHANGED");
    const imageEnv = JSON.parse(
      await docker(
        "image",
        "inspect",
        "--format",
        "{{json .Config.Env}}",
        imageDigest,
      ),
    );
    if (
      !Array.isArray(imageEnv) ||
      imageEnv.some((item) => {
        const key = typeof item === "string" ? item.split("=", 1)[0] : "";
        return key.startsWith("LD_") && !CLEARED_ENV.includes(key);
      })
    )
      throw failure("CONTAINER_INVALID_CONFIG");
    managerInfo = await proc(process.pid);
    if (!affinityIncludes(managerInfo.cpus, cpuId))
      throw failure("CONTAINER_INVALID_CONFIG");
    if (!recoveryIdentity) {
    const mounts = [
      [sourceRoot, sourceRoot, true],
      [runtimeRoot, runtimeRoot, true],
      [homeSource, home, false],
      [bridgeRoot, "/bridge", false],
      [bundleRoot, "/package", true],
      [nodePath, "/opt/private-node", true],
    ];
    const args = [
      "create",
      "--pull=never",
      "--init",
      "--network",
      networkMode,
      "--ipc",
      "private",
      "--cgroupns",
      "private",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      `${uid}:${gid}`,
      "--pids-limit",
      String(pidsLimit),
      "--memory",
      String(memoryLimitMiB * 1024 * 1024),
      "--shm-size",
      "268435456",
      "--cpuset-cpus",
      String(cpuId),
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,size=268435456",
      "--label",
      `agent.chatgpt.generation=${generation}`,
    ];
    for (const name of CLEARED_ENV) args.push("--env", name + "=");
    for (const [src, dst, ro] of mounts)
      args.push(
        "--mount",
        `type=bind,src=${src},dst=${dst}${ro ? ",readonly" : ""}`,
      );
    if (projectMounts) args.push(...projectMounts.mountArgs);
    if (historyMounts) args.push(...historyMounts.mountArgs);
    args.push(
      "--entrypoint",
      "/usr/bin/env",
      imageDigest,
      "-i",
      "PATH=/usr/bin:/bin",
      "HOME=/tmp",
      "/usr/bin/python3",
      "-I",
      "-u",
      "-B",
      "/package/container-bridge.py",
    );
    containerId = await docker(...args);
    if (!/^[a-f0-9]{64}$/.test(containerId))
      throw failure("CONTAINER_DOCKER_FAILED");
    await docker("start", containerId);
    const deadline = Date.now() + startupTimeoutMs;
    for (;;) {
      if (historyMounts) {
        try {
          const path = join(bridgeRoot, "first-cause.json"),
            info = await lstat(path, { bigint: true });
          if (
            info.isFile() &&
            info.uid === BigInt(uid) &&
            (info.mode & 0o7777n) === 0o600n &&
            info.nlink === 1n &&
            info.size <= 256n
          ) {
            const cause = JSON.parse(await readFile(path, "utf8"));
            if (
              cause?.v === 1 &&
              ["container_history_busy", "container_history_invalid"].includes(
                cause.phase,
              )
            )
              throw failure(
                cause.phase === "container_history_busy"
                  ? "CONTAINER_HISTORY_BUSY"
                  : "CONTAINER_HISTORY_UNAVAILABLE",
              );
          }
        } catch (error) {
          if (error?.code?.startsWith("CONTAINER_HISTORY_")) throw error;
          if (error?.code !== "ENOENT")
            throw failure("CONTAINER_HISTORY_UNAVAILABLE");
        }
      }
      try {
        const info = await lstat(socketPath);
        if (info.isSocket()) break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (Date.now() >= deadline) throw failure("CONTAINER_TIMEOUT");
      await new Promise((done) => setTimeout(done, 50));
    }
    await openTransport(false);
    } else {
      await openTransport(true);
    }
    await initializeSharedSource();
    if (projectStore) {
      try {
        projectMonitor = startNativeProjectMonitor({
          homeRoot: homeSource,
          store: projectStore,
          writer: { containerId, profileId, generation },
          verifyAuthority: projectAuthority,
          onFailure: (code) => { projectPersistenceState = code === "PROJECT_STATE_UNSUPPORTED" ? "unsupported" : "error"; },
        });
        projectMonitor.pollNow();
      } catch {
        projectPersistenceState = "error";
        try { projectStore.markFailure({ containerId, profileId, generation }, "PROJECT_STATE_INVALID"); } catch {}
      }
    }
    monitorNative();
    const result = {
      profileId,
      generation,
      upstream,
      verifyIdentity,
      disconnectTransport,
      reconnectTransport,
      nativeExited,
      projectPersistenceStatus() { return projectMonitor?.status().state ?? projectPersistenceState; },
      onUnavailable(fn) {
        if (typeof fn !== "function") throw failure("CONTAINER_INVALID_CONFIG");
        unavailable.add(fn);
        return () => unavailable.delete(fn);
      },
    };
    Object.defineProperty(result, "captureRecoveryIdentity", { value: captureRecoveryIdentity });
    Object.defineProperty(result, "containerId", { value: containerId });
    return Object.freeze(result);
  } catch (error) {
    closeSharedSource();
    await initialPreference?.close();
    projectSeed?.close();
    projectMonitor?.close();
    projectStore?.close();
    await projectMounts?.close();
    historyMounts?.close();
    if (helper?.stdin?.writable) helper.stdin.end();
    const safe = failure(
      typeof error?.code === "string" &&
        (/^CONTAINER_[A-Z_]+$/.test(error.code) ||
          isAccountSnapshotErrorCode(error.code))
        ? error.code
        : "CONTAINER_UNAVAILABLE",
    );
    if (containerId)
      Object.defineProperty(safe, "retainedOwner", {
        value: Object.freeze({
          containerId,
          grantSent: initialGrant.outcome !== "not_attempted",
          grantOutcome: initialGrant.outcome,
          nativeExited,
        }),
      });
    throw safe;
  }
}
