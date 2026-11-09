import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { desktopAccountIdentityDigest } from "./account-sync.mjs";

// Project metadata only. This is a projection, not the native global-state
// file, app-server SQLite database, task queue or a directory authorization.
const PROJECT_LIMIT = 256;
const ROOTS_PER_PROJECT = 16;
const fail = () => Object.assign(new Error("Project state unavailable"), { code: "PROJECT_STATE_INVALID" });
const unsupported = () => Object.assign(new Error("Project state contains unsupported metadata"), { code: "PROJECT_STATE_UNSUPPORTED" });
const uncertain = () => Object.assign(new Error("Project state update was not confirmed"), { code: "PROJECT_STATE_UNCERTAIN" });
const safeError = (error) => error?.code === "PROJECT_STATE_UNSUPPORTED" ? unsupported() : error?.code === "PROJECT_STATE_UNCERTAIN" ? uncertain() : fail();
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const field = (value, name) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value")) throw fail();
  return descriptor.value;
};
const safeText = (value, max) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);
const safePath = (value) => safeText(value, 4096) && value !== "/" && isAbsolute(value) && resolve(value) === value;
const contains = (parent, child) => {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith("../") && !isAbsolute(part));
};

function authorize(options) {
  if (!plain(options) || Reflect.ownKeys(options).length !== 1) throw fail();
  const roots = field(options, "allowedRoots");
  if (!Array.isArray(roots) || roots.length > 8 || roots.some((root) => !safePath(root)) || new Set(roots).size !== roots.length) throw fail();
  return roots;
}

function sanitizeProject(value, key, roots) {
  if (!plain(value)) throw fail();
  if (Reflect.ownKeys(value).some((name) => typeof name !== "string" || !["id", "name", "rootPaths", "createdAt", "updatedAt"].includes(name))) throw unsupported();
  const id = field(value, "id"), name = field(value, "name"), paths = field(value, "rootPaths"),
    createdAt = field(value, "createdAt"), updatedAt = field(value, "updatedAt");
  if (!safeText(id, 256) || id !== key || !safeText(name, 512) || !Array.isArray(paths) || paths.length < 1 || paths.length > ROOTS_PER_PROJECT ||
      paths.some((path) => !safePath(path) || !roots.some((root) => contains(root, path))) ||
      new Set(paths).size !== paths.length || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || createdAt < 0 || updatedAt < 0) throw fail();
  return { id, name, rootPaths: [...paths], createdAt, updatedAt };
}

/**
 * Project the pinned native global state. Filesystem identity must be checked
 * by the owning mount authority both before persistence and before restore.
 */
export function projectStateProjection(state, options) {
  const roots = authorize(options);
  if (!plain(state)) throw fail();
  for (const key of ["remote-projects", "project-appearances", "pinned-project-ids", "project-files", "project-writable-roots"]) {
    const value = field(state, key);
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) ? value.length > 0 : plain(value) ? Reflect.ownKeys(value).length > 0 : true) throw unsupported();
  }
  const raw = field(state, "local-projects") ?? {};
  if (!plain(raw) || Reflect.ownKeys(raw).length > PROJECT_LIMIT) throw fail();
  const projects = new Map();
  for (const id of Reflect.ownKeys(raw)) {
    if (typeof id !== "string") throw fail();
    projects.set(id, sanitizeProject(field(raw, id), id, roots));
  }
  const order = field(state, "project-order");
  if (order !== undefined && order !== null && (!Array.isArray(order) || order.length > 1024 || order.some((item) => !safeText(item, 256)))) throw fail();
  const ordered = [];
  for (const id of order ?? []) {
    if (!projects.has(id)) throw unsupported();
    if (ordered.includes(id)) throw fail();
    ordered.push(id);
  }
  for (const id of projects.keys()) if (!ordered.includes(id)) ordered.push(id);
  const selected = field(state, "selected-project");
  let selectedProjectId = null;
  if (selected !== undefined && selected !== null) {
    if (!plain(selected)) throw fail();
    if (Reflect.ownKeys(selected).some((key) => typeof key !== "string" || !["type", "projectId"].includes(key))) throw unsupported();
    const type = field(selected, "type"), id = field(selected, "projectId");
    if (!["local", "remote"].includes(type) || !safeText(id, 256)) throw fail();
    if (type === "remote") throw unsupported();
    if (!projects.has(id)) throw fail();
    selectedProjectId = id;
  }
  return { version: 1, projects: ordered.map((id) => projects.get(id)), selectedProjectId };
}

/** Return only keys understood by the pinned native global-state loader. */
export function nativeProjectState(projection, options) {
  const roots = authorize(options);
  if (!plain(projection) || Reflect.ownKeys(projection).length !== 3 || field(projection, "version") !== 1) throw fail();
  const values = field(projection, "projects"), selected = field(projection, "selectedProjectId");
  if (!Array.isArray(values) || values.length > PROJECT_LIMIT) throw fail();
  const projects = new Map();
  for (const value of values) {
    if (!plain(value)) throw fail();
    const id = field(value, "id");
    if (projects.has(id)) throw fail();
    projects.set(id, sanitizeProject(value, id, roots));
  }
  if (selected !== null && (typeof selected !== "string" || !projects.has(selected))) throw fail();
  return {
    "local-projects": Object.fromEntries(projects),
    ...(selected === null ? {} : { "selected-project": { type: "local", projectId: selected } }),
    "project-order": [...projects.keys()],
  };
}

const MAX_STORE = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sameDir = (a, b) => ["dev", "ino", "uid", "gid", "mode"].every((name) => a[name] === b[name]);
const sameFile = (a, b) => sameDir(a, b) && ["size", "mtimeNs", "ctimeNs", "nlink"].every((name) => a[name] === b[name]);
const identityNames = ["dev", "ino", "uid", "gid", "mode"];
const identityRecord = (info) => Object.fromEntries(identityNames.map((name) => [name, String(info[name])]));
const sameRecordedIdentity = (info, expected) => plain(expected) && Reflect.ownKeys(expected).length === identityNames.length && identityNames.every((name) => typeof expected[name] === "string" && /^[0-9]+$/.test(expected[name]) && String(info[name]) === expected[name]);
const fileIdentityNames = [...identityNames, "size", "mtimeNs", "ctimeNs", "nlink"];
const fileIdentityRecord = (info) => Object.fromEntries(fileIdentityNames.map((name) => [name, String(info[name])]));
const sameRecordedFile = (info, expected) => plain(expected) && Reflect.ownKeys(expected).length === fileIdentityNames.length && fileIdentityNames.every((name) => typeof expected[name] === "string" && /^[0-9]+$/.test(expected[name]) && String(info[name]) === expected[name]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ANONYMOUS = digest("kanban-codex-history-v1\0anonymous");
const MAX_MARKER = 64 * 1024;

function uniqueJson(text) {
  const parsed = JSON.parse(text), stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],]/g)) {
    const token = match[0], top = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ object: token === "{", key: token === "{", keys: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ",") { if (top?.object) top.key = true; }
    else if (top?.object && top.key) { const key = JSON.parse(token); if (top.keys.has(key)) throw fail(); top.keys.add(key); top.key = false; }
  }
  return parsed;
}

function writerInfo(value) {
  if (!plain(value) || Reflect.ownKeys(value).length !== 3) throw fail();
  const containerId = field(value, "containerId"), profileId = field(value, "profileId"), generation = field(value, "generation");
  if (!HASH.test(containerId ?? "") || !UUID.test(profileId ?? "") || !UUID.test(generation ?? "")) throw fail();
  return { containerId, profileId, generation };
}

function nativeInfo(value) {
  if (!plain(value) || Reflect.ownKeys(value).length !== 4 || !Number.isSafeInteger(value.pid) || value.pid <= 1 ||
      !/^[0-9]{1,30}$/.test(value.startTicks ?? "") || !/^pid:\[[0-9]+\]$/.test(value.pidns ?? "") || value.uid !== process.getuid()) throw fail();
  return { pid: value.pid, startTicks: value.startTicks, pidns: value.pidns, uid: value.uid };
}
function nativeIsAlive(value) {
  const fixed = nativeInfo(value), path = `/proc/${fixed.pid}`;
  try {
    const raw = readFileSync(join(path, "stat"), "utf8"), begin = raw.indexOf(" ("), end = raw.lastIndexOf(") ");
    if (begin < 1 || end < begin || raw.slice(0, begin) !== String(fixed.pid)) throw fail();
    const fields = raw.slice(end + 2).trim().split(/\s+/);
    if (!/^[0-9]{1,30}$/.test(fields[19] ?? "")) throw fail();
    if (fields[19] !== fixed.startTicks) return false;
    if (Number(lstatSync(path, { bigint: true }).uid) !== fixed.uid || readlinkSync(join(path, "ns", "pid")) !== fixed.pidns) throw fail();
    return true;
  } catch (error) { if (error?.code === "ENOENT") return false; throw safeError(error); }
}
function rootInfo(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o002n) !== 0n ||
        !sameDir(info, lstatSync(path, { bigint: true })) || realpathSync(path) !== path) throw fail();
    return info;
  } finally { closeSync(fd); }
}

/** Capture only the identity of the fresh, server-selected HOME and project roots. */
export function createProjectRecoverySource(options) {
  let home, codex;
  try {
    if (!plain(options) || Reflect.ownKeys(options).length !== 3) throw fail();
    const homeRoot = field(options, "homeRoot"), accountSeeded = field(options, "accountSeeded"), allowedRoots = authorize({ allowedRoots: field(options, "allowedRoots") });
    if (!safePath(homeRoot) || typeof accountSeeded !== "boolean" || allowedRoots.some((root) => contains(root, homeRoot) || contains(homeRoot, root))) throw fail();
    home = privateDirectory(homeRoot); codex = privateDirectory(join(homeRoot, ".codex"));
    const roots = allowedRoots.map((path) => ({ path, identity: identityRecord(rootInfo(path)) }));
    if (!directoryCurrent(home) || !directoryCurrent(codex)) throw fail();
    return Object.freeze({ version: 1, homeRoot, homeIdentity: identityRecord(home.info), codexIdentity: identityRecord(codex.info), accountSeeded, roots });
  } catch (error) { throw safeError(error); }
  finally { if (codex) closeSync(codex.fd); if (home) closeSync(home.fd); }
}

function verifyRecoverySource(source, allowedRoots, accountBinding) {
  let home, codex, fd, bytes;
  try {
    if (!plain(source) || Reflect.ownKeys(source).length !== 6 || source.version !== 1 || !safePath(source.homeRoot) ||
        typeof source.accountSeeded !== "boolean" || !Array.isArray(source.roots) || source.roots.length !== allowedRoots.length) throw fail();
    home = privateDirectory(source.homeRoot); codex = privateDirectory(join(source.homeRoot, ".codex"));
    if (!sameRecordedIdentity(home.info, source.homeIdentity) || !sameRecordedIdentity(codex.info, source.codexIdentity)) throw fail();
    source.roots.forEach((root, index) => {
      if (!plain(root) || Reflect.ownKeys(root).length !== 2 || root.path !== allowedRoots[index] || !sameRecordedIdentity(rootInfo(root.path), root.identity)) throw fail();
    });
    const auth = join(`/proc/self/fd/${codex.fd}`, "auth.json");
    if (!source.accountSeeded) {
      try { lstatSync(auth); throw fail(); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (accountBinding !== ANONYMOUS) throw fail();
    } else {
      if (statfsSync(source.homeRoot, { bigint: true }).type !== 0x01021994n) throw fail();
      fd = openSync(auth, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = fstatSync(fd, { bigint: true });
      if (!info.isFile() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > 256n * 1024n) throw fail();
      bytes = Buffer.alloc(Number(info.size) + 1); let size = 0;
      while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
      if (size !== Number(info.size) || !sameFile(info, fstatSync(fd, { bigint: true })) || !sameFile(info, lstatSync(auth, { bigint: true })) || desktopAccountIdentityDigest(bytes.subarray(0, size)) !== accountBinding) throw fail();
    }
    if (!directoryCurrent(home) || !directoryCurrent(codex)) throw fail();
    return true;
  } finally { bytes?.fill(0); if (fd !== undefined) closeSync(fd); if (codex) closeSync(codex.fd); if (home) closeSync(home.fd); }
}

function verifyFinalSourceFile(source, expected) {
  let home, codex, fd;
  try {
    home = privateDirectory(source.homeRoot); codex = privateDirectory(join(source.homeRoot, ".codex"));
    if (!sameRecordedIdentity(home.info, source.homeIdentity) || !sameRecordedIdentity(codex.info, source.codexIdentity)) throw fail();
    const path = join(`/proc/self/fd/${codex.fd}`, ".codex-global-state.json");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd, { bigint: true });
    return info.isFile() && info.uid === BigInt(process.getuid()) && (info.mode & 0o7777n) === 0o600n && info.nlink === 1n &&
      sameRecordedFile(info, expected) && sameFile(info, lstatSync(path, { bigint: true })) && directoryCurrent(home) && directoryCurrent(codex);
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); if (codex) closeSync(codex.fd); if (home) closeSync(home.fd); }
}

function verifySnapshotReference(rootPath, reference) {
  let fd, bytes;
  try {
    if (!plain(reference) || Reflect.ownKeys(reference).length !== 2 || !/^sealed-[a-f0-9]{32}\.json$/.test(reference.name ?? "") || !HASH.test(reference.sha256 ?? "")) throw fail();
    const path = join(rootPath, reference.name);
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd, { bigint: true });
    if (!info.isFile() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(MAX_STORE)) throw fail();
    bytes = Buffer.alloc(Number(info.size) + 1); let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
    return size === Number(info.size) && sameFile(info, fstatSync(fd, { bigint: true })) && sameFile(info, lstatSync(path, { bigint: true })) && digest(bytes.subarray(0, size)) === reference.sha256;
  } catch { return false; }
  finally { bytes?.fill(0); if (fd !== undefined) closeSync(fd); }
}

function verifiedPaths(projection) {
  const paths = [...new Set(projection.projects.flatMap((item) => item.rootPaths))];
  return paths.map((path) => {
    const info = lstatSync(path, { bigint: true });
    if (!info.isDirectory() || realpathSync(path) !== path) throw fail();
    return { path, info };
  });
}
function pathsStillMatch(entries) {
  return entries.every(({ path, info }) => {
    const next = lstatSync(path, { bigint: true });
    return next.isDirectory() && sameDir(info, next) && realpathSync(path) === path;
  });
}

/**
 * Hold the private project projection for one externally verified history
 * owner. The caller must hold the history lease, verify account/owner before
 * each operation and provide the previous exact container on restore.
 */
export function openPersistentProjectStore(options) {
  let rootFd, closed = false, broken = false;
  try {
    if (!plain(options) || ![5, 6].includes(Reflect.ownKeys(options).length) || typeof process.getuid !== "function") throw fail();
    const storeRoot = field(options, "storeRoot"), accountBinding = field(options, "accountBinding"),
      previousContainerId = field(options, "previousContainerId"), allowedRoots = authorize({ allowedRoots: field(options, "allowedRoots") }),
      verifyAuthority = field(options, "verifyAuthority"), recoverySource = field(options, "recoverySource");
    if (Reflect.ownKeys(options).some((key) => !["storeRoot", "accountBinding", "previousContainerId", "allowedRoots", "verifyAuthority", "recoverySource"].includes(key))) throw fail();
    if (!safePath(storeRoot) || !HASH.test(accountBinding ?? "") || !(previousContainerId === null || HASH.test(previousContainerId ?? "")) ||
        typeof verifyAuthority !== "function" || allowedRoots.some((root) => contains(root, storeRoot) || contains(storeRoot, root))) throw fail();
    const uid = BigInt(process.getuid());
    rootFd = openSync(storeRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootInfo = fstatSync(rootFd, { bigint: true });
    const rootPath = `/proc/self/fd/${rootFd}`, target = join(rootPath, "projects.json"), marker = join(rootPath, "pending.json");
    const guard = (writer = null) => {
      if (closed || broken || verifyAuthority(writer) !== true) throw fail();
      const now = lstatSync(storeRoot, { bigint: true });
      if (!now.isDirectory() || now.uid !== uid || (now.mode & 0o7777n) !== 0o700n || !sameDir(rootInfo, now) ||
          !sameDir(rootInfo, fstatSync(rootFd, { bigint: true })) || realpathSync(storeRoot) !== storeRoot) throw fail();
    };
    if (!rootInfo.isDirectory() || rootInfo.uid !== uid || (rootInfo.mode & 0o7777n) !== 0o700n) throw fail();
    guard();
    if (recoverySource !== undefined) verifyRecoverySource(recoverySource, allowedRoots, accountBinding);
    // A failed or interrupted prior update must not make the last good snapshot
    // look current. This marker never contains project contents or credentials.
    let markerFd, markerBaseline = null, markerWriter = null, markerNative = null, prior = null, restoredSealed = null, sealedProof = null;
    try {
      try { markerFd = openSync(marker, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (markerFd !== undefined) {
        const info = fstatSync(markerFd, { bigint: true });
        if (!info.isFile() || info.uid !== uid || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(MAX_MARKER)) throw fail();
        const buffer = Buffer.alloc(MAX_MARKER + 1);
        try {
          let size = 0;
          while (size < buffer.length) { const n = readSync(markerFd, buffer, size, buffer.length - size, size); if (!n) break; size += n; }
          if (size > MAX_MARKER || !sameFile(info, fstatSync(markerFd, { bigint: true })) || !sameFile(info, lstatSync(marker, { bigint: true }))) throw fail();
          const record = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
          if (!plain(record) || field(record, "accountBinding") !== accountBinding) throw fail();
          const writer = writerInfo(field(record, "writer")), state = field(record, "state");
          if (writer.containerId !== previousContainerId) throw fail();
          if (record.version === 2 && state === "sealed") {
            if (Reflect.ownKeys(record).length !== 9 || !plain(record.snapshot) || Reflect.ownKeys(record.snapshot).length !== 2 ||
                !/^sealed-[a-f0-9]{32}\.json$/.test(record.snapshot.name ?? "") || !HASH.test(record.snapshot.sha256 ?? "")) throw fail();
            if (record.prior !== null && !verifySnapshotReference(rootPath, record.prior)) throw fail();
            verifyRecoverySource(record.source, allowedRoots, accountBinding);
            if (nativeIsAlive(record.native) || !verifyFinalSourceFile(record.source, record.sourceState)) throw uncertain();
            let snapshotFd, snapshotBytes;
            try {
              const snapshotPath = join(rootPath, record.snapshot.name);
              snapshotFd = openSync(snapshotPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              const snapshotInfo = fstatSync(snapshotFd, { bigint: true });
              if (!snapshotInfo.isFile() || snapshotInfo.uid !== uid || (snapshotInfo.mode & 0o7777n) !== 0o600n || snapshotInfo.nlink !== 1n || snapshotInfo.size > BigInt(MAX_STORE)) throw fail();
              snapshotBytes = Buffer.alloc(Number(snapshotInfo.size) + 1); let length = 0;
              while (length < snapshotBytes.length) { const n = readSync(snapshotFd, snapshotBytes, length, snapshotBytes.length - length, length); if (!n) break; length += n; }
              if (length !== Number(snapshotInfo.size) || !sameFile(snapshotInfo, fstatSync(snapshotFd, { bigint: true })) || !sameFile(snapshotInfo, lstatSync(snapshotPath, { bigint: true })) || digest(snapshotBytes.subarray(0, length)) !== record.snapshot.sha256) throw fail();
              const snapshot = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes.subarray(0, length)));
              if (!plain(snapshot) || Reflect.ownKeys(snapshot).length !== 4 || snapshot.version !== 1 || snapshot.accountBinding !== accountBinding || JSON.stringify(writerInfo(snapshot.writer)) !== JSON.stringify(writer)) throw fail();
              nativeProjectState(snapshot.state, { allowedRoots });
              if (!pathsStillMatch(verifiedPaths(snapshot.state))) throw fail();
              restoredSealed = snapshot.state; prior = record.snapshot; markerBaseline = info;
              sealedProof = { source: record.source, sourceState: record.sourceState, native: record.native, path: snapshotPath, info: snapshotInfo };
            } finally { snapshotBytes?.fill(0); if (snapshotFd !== undefined) closeSync(snapshotFd); }
          } else {
            if (record.version !== 1 && record.version !== 2) throw fail();
            if (!["pending", "unsupported", "error"].includes(state)) throw fail();
            if (state === "unsupported") throw unsupported();
            throw uncertain();
          }
        } finally { buffer.fill(0); }
      }
    } finally { if (markerFd !== undefined) closeSync(markerFd); }
    let saved = null, baseline = null;
    let sourceFd;
    try {
      try { sourceFd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (sourceFd !== undefined) {
        const info = fstatSync(sourceFd, { bigint: true });
        if (!info.isFile() || info.uid !== uid || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(MAX_STORE)) throw fail();
        const buffer = Buffer.alloc(MAX_STORE + 1); let offset = 0;
        try {
          while (offset < buffer.length) { const n = readSync(sourceFd, buffer, offset, buffer.length - offset, offset); if (!n) break; offset += n; }
          if (offset > MAX_STORE || !sameFile(info, fstatSync(sourceFd, { bigint: true })) || !sameFile(info, lstatSync(target, { bigint: true }))) throw fail();
          const record = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)));
          if (!plain(record) || Reflect.ownKeys(record).length !== 4 || field(record, "version") !== 1 || field(record, "accountBinding") !== accountBinding) throw fail();
          const writer = writerInfo(field(record, "writer"));
          if (previousContainerId === null || (!restoredSealed && writer.containerId !== previousContainerId)) throw fail();
          const state = field(record, "state");
          nativeProjectState(state, { allowedRoots });
          if (!pathsStillMatch(verifiedPaths(state))) throw fail();
          saved = { version: 1, accountBinding, writer, state }; baseline = info;
        } finally { buffer.fill(0); }
      }
    } finally { if (sourceFd !== undefined) closeSync(sourceFd); }
    guard();
    const ensureTarget = () => {
      try {
        const info = lstatSync(target, { bigint: true });
        if (!baseline || !info.isFile() || !sameFile(info, baseline)) throw fail();
      } catch (error) { if (error?.code !== "ENOENT" || baseline) throw fail(); }
    };
    const ensureMarker = () => {
      try {
        const info = lstatSync(marker, { bigint: true });
        if (!markerBaseline || !info.isFile() || !sameFile(info, markerBaseline)) throw fail();
      } catch (error) { if (error?.code !== "ENOENT" || markerBaseline) throw fail(); }
    };
    const writeMarker = (writer, state) => {
      const fixedWriter = writerInfo(writer);
      if (!["pending", "unsupported", "error"].includes(state)) throw fail();
      if (markerWriter && JSON.stringify(markerWriter) !== JSON.stringify(fixedWriter)) throw fail();
      const record = recoverySource === undefined
        ? { version: 1, accountBinding, writer: fixedWriter, state }
        : { version: 2, accountBinding, writer: fixedWriter, state, source: recoverySource, native: markerNative, prior };
      const body = Buffer.from(JSON.stringify(record) + "\n");
      if (body.length > MAX_MARKER) throw fail();
      let temp, fd;
      try {
        guard(fixedWriter); ensureMarker(); if (recoverySource !== undefined) verifyRecoverySource(recoverySource, allowedRoots, accountBinding);
        temp = join(rootPath, `.marker-${randomBytes(16).toString("hex")}.tmp`);
        fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(fd, body); fsyncSync(fd); closeSync(fd); fd = undefined;
        guard(fixedWriter); ensureMarker();
        if (markerBaseline) renameSync(temp, marker);
        else { linkSync(temp, marker); unlinkSync(temp); }
        temp = undefined; fsyncSync(rootFd);
        markerBaseline = lstatSync(marker, { bigint: true }); markerWriter = fixedWriter; restoredSealed = null;
        guard(fixedWriter); ensureMarker();
      } finally { body.fill(0); if (fd !== undefined) closeSync(fd); if (temp) try { unlinkSync(temp); } catch {} }
    };
    const begin = (writer) => {
      if (!markerBaseline || !markerWriter) writeMarker(writer, "pending");
      else { guard(writer); ensureMarker(); if (JSON.stringify(markerWriter) !== JSON.stringify(writerInfo(writer))) throw fail(); }
    };
    const commit = (projection, writer) => {
      const fixedWriter = writerInfo(writer), fixed = projectStateProjection(nativeProjectState(projection, { allowedRoots }), { allowedRoots });
      const record = { version: 1, accountBinding, writer: fixedWriter, state: fixed };
      if (saved && JSON.stringify(saved) === JSON.stringify(record)) { guard(fixedWriter); ensureTarget(); return false; }
      const body = Buffer.from(JSON.stringify(record) + "\n");
      if (body.length > MAX_STORE) throw fail();
      let temp, tempFd;
      try {
        guard(fixedWriter); ensureTarget(); const paths = verifiedPaths(fixed);
        temp = join(rootPath, `.project-${randomBytes(16).toString("hex")}.tmp`);
        tempFd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        writeFileSync(tempFd, body); fsyncSync(tempFd); closeSync(tempFd); tempFd = undefined;
        guard(fixedWriter); ensureTarget(); if (!pathsStillMatch(paths)) throw fail();
        if (baseline) renameSync(temp, target);
        else { linkSync(temp, target); unlinkSync(temp); }
        temp = undefined; fsyncSync(rootFd); guard(fixedWriter);
        const info = lstatSync(target, { bigint: true });
        if (!info.isFile() || info.uid !== uid || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n) throw fail();
        baseline = info; saved = record; return true;
      } catch (error) { throw safeError(error); }
      finally { body.fill(0); if (tempFd !== undefined) closeSync(tempFd); if (temp) try { unlinkSync(temp); } catch {} }
    };
    return Object.freeze({
      restore() { try { guard(); ensureTarget(); ensureMarker(); return restoredSealed ? nativeProjectState(restoredSealed, { allowedRoots }) : saved ? nativeProjectState(saved.state, { allowedRoots }) : null; } catch (error) { broken = true; throw safeError(error); } },
      isSealed() { return restoredSealed !== null; },
      verifyRestored() {
        try {
          guard(); ensureMarker();
          return !!sealedProof && sameFile(sealedProof.info, lstatSync(sealedProof.path, { bigint: true })) &&
            !nativeIsAlive(sealedProof.native) && verifyRecoverySource(sealedProof.source, allowedRoots, accountBinding) &&
            verifyFinalSourceFile(sealedProof.source, sealedProof.sourceState);
        } catch { return false; }
      },
      verifyCurrent(writer) { guard(writer); ensureTarget(); ensureMarker(); return true; },
      capture(state, writer) {
        try {
          guard(writer); if (!plain(state)) throw fail();
          if (!Object.hasOwn(state, "local-projects")) return false;
          begin(writer);
          const changed = commit(projectStateProjection(state, { allowedRoots }), writer);
          // The native process can outlive this manager or change state between
          // polls. Keep the durable unconfirmed marker for its entire lifetime.
          return changed;
        } catch (error) {
          try { if (markerBaseline) writeMarker(writer, error?.code === "PROJECT_STATE_UNSUPPORTED" ? "unsupported" : "error"); } catch {}
          broken = true; throw safeError(error);
        }
      },
      adopt(writer) { try { guard(writer); begin(writer); return !!saved; } catch (error) { broken = true; throw safeError(error); } },
      bindNative(writer, native, verifyNative) {
        try {
          guard(writer); begin(writer);
          if (recoverySource === undefined || typeof verifyNative !== "function" || verifyNative() !== true || !nativeIsAlive(native)) throw fail();
          markerNative = nativeInfo(native); writeMarker(writer, "pending");
          if (verifyNative() !== true || !nativeIsAlive(native)) throw fail();
        } catch (error) { broken = true; throw safeError(error); }
      },
      markFailure(writer, code) {
        try { guard(writer); begin(writer); writeMarker(writer, code === "PROJECT_STATE_UNSUPPORTED" ? "unsupported" : "error"); }
        finally { broken = true; }
      },
      close() { if (!closed) { closed = true; closeSync(rootFd); } },
    });
  } catch (error) { if (rootFd !== undefined) try { closeSync(rootFd); } catch {} throw safeError(error); }
}

/** Seal only a final state read after the old owner and native have exited. */
export function sealPendingProjectState(options) {
  if (!plain(options) || Reflect.ownKeys(options).length !== 6) throw fail();
  const storeRoot = field(options, "storeRoot"), accountBinding = field(options, "accountBinding"), previousContainerId = field(options, "previousContainerId"),
    allowedRoots = authorize({ allowedRoots: field(options, "allowedRoots") }), verifyAuthority = field(options, "verifyAuthority"),
    withPreviousOwnerLease = field(options, "withPreviousOwnerLease");
  if (!safePath(storeRoot) || !HASH.test(accountBinding ?? "") || !HASH.test(previousContainerId ?? "") || typeof verifyAuthority !== "function" || typeof withPreviousOwnerLease !== "function") throw fail();
  return withPreviousOwnerLease(() => {
    let root, home, codex, markerFd, sourceFd, snapshotFd, markerTempFd, sourceBytes, snapshotBody, markerBody, markerTemp;
    try {
      if (verifyAuthority(null) !== true) throw fail();
      root = privateDirectory(storeRoot);
      const rootPath = `/proc/self/fd/${root.fd}`, markerPath = join(rootPath, "pending.json");
      markerFd = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const markerInfo = fstatSync(markerFd, { bigint: true });
      if (!markerInfo.isFile() || markerInfo.uid !== BigInt(process.getuid()) || (markerInfo.mode & 0o7777n) !== 0o600n || markerInfo.nlink !== 1n || markerInfo.size > BigInt(MAX_MARKER)) throw fail();
      const markerBytes = Buffer.alloc(Number(markerInfo.size) + 1); let markerLength = 0, pending;
      try {
        while (markerLength < markerBytes.length) { const n = readSync(markerFd, markerBytes, markerLength, markerBytes.length - markerLength, markerLength); if (!n) break; markerLength += n; }
        if (markerLength !== Number(markerInfo.size) || !sameFile(markerInfo, fstatSync(markerFd, { bigint: true })) || !sameFile(markerInfo, lstatSync(markerPath, { bigint: true }))) throw fail();
        pending = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(markerBytes.subarray(0, markerLength)));
      } finally { markerBytes.fill(0); }
      if (!plain(pending) || Reflect.ownKeys(pending).length !== 7 || pending.version !== 2 || pending.accountBinding !== accountBinding) throw uncertain();
      const writer = writerInfo(pending.writer);
      if (writer.containerId !== previousContainerId) throw fail();
      if (pending.state === "unsupported") throw unsupported();
      if (pending.state !== "pending" || pending.native === null) throw uncertain();
      const native = nativeInfo(pending.native);
      if (nativeIsAlive(native)) throw uncertain();
      if (pending.prior !== null && !verifySnapshotReference(rootPath, pending.prior)) throw fail();
      verifyRecoverySource(pending.source, allowedRoots, accountBinding);
      home = privateDirectory(pending.source.homeRoot); codex = privateDirectory(join(pending.source.homeRoot, ".codex"));
      if (!sameRecordedIdentity(home.info, pending.source.homeIdentity) || !sameRecordedIdentity(codex.info, pending.source.codexIdentity)) throw fail();
      const sourcePath = join(`/proc/self/fd/${codex.fd}`, ".codex-global-state.json");
      sourceFd = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const sourceInfo = fstatSync(sourceFd, { bigint: true });
      if (!sourceInfo.isFile() || sourceInfo.uid !== BigInt(process.getuid()) || (sourceInfo.mode & 0o7777n) !== 0o600n || sourceInfo.nlink !== 1n || sourceInfo.size > BigInt(MAX_STORE)) throw fail();
      sourceBytes = Buffer.alloc(Number(sourceInfo.size) + 1); let sourceLength = 0;
      while (sourceLength < sourceBytes.length) { const n = readSync(sourceFd, sourceBytes, sourceLength, sourceBytes.length - sourceLength, sourceLength); if (!n) break; sourceLength += n; }
      if (sourceLength !== Number(sourceInfo.size) || !sameFile(sourceInfo, fstatSync(sourceFd, { bigint: true })) || !sameFile(sourceInfo, lstatSync(sourcePath, { bigint: true }))) throw fail();
      const original = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes.subarray(0, sourceLength)));
      if (!plain(original) || !Object.hasOwn(original, "local-projects")) throw uncertain();
      const state = projectStateProjection(original, { allowedRoots }), paths = verifiedPaths(state);
      snapshotBody = Buffer.from(JSON.stringify({ version: 1, accountBinding, writer, state }) + "\n");
      if (snapshotBody.length > MAX_STORE || readdirSync(rootPath).filter((name) => /^sealed-[a-f0-9]{32}\.json$/.test(name)).length >= 128) throw fail();
      const snapshotName = `sealed-${randomBytes(16).toString("hex")}.json`, snapshotPath = join(rootPath, snapshotName);
      snapshotFd = openSync(snapshotPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(snapshotFd, snapshotBody); fsyncSync(snapshotFd);
      const snapshotInfo = fstatSync(snapshotFd, { bigint: true });
      const snapshot = { name: snapshotName, sha256: digest(snapshotBody) };
      const sealed = { version: 2, accountBinding, writer, state: "sealed", source: pending.source, sourceState: fileIdentityRecord(sourceInfo), native, prior: pending.prior, snapshot };
      markerBody = Buffer.from(JSON.stringify(sealed) + "\n");
      if (markerBody.length > MAX_MARKER) throw fail();
      markerTemp = join(rootPath, `.marker-${randomBytes(16).toString("hex")}.tmp`);
      markerTempFd = openSync(markerTemp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(markerTempFd, markerBody); fsyncSync(markerTempFd); closeSync(markerTempFd); markerTempFd = undefined;
      const finalCheck = () => verifyAuthority(null) === true && directoryCurrent(root) && directoryCurrent(home) && directoryCurrent(codex) &&
        sameFile(markerInfo, fstatSync(markerFd, { bigint: true })) && sameFile(markerInfo, lstatSync(markerPath, { bigint: true })) &&
        sameFile(sourceInfo, fstatSync(sourceFd, { bigint: true })) && sameFile(sourceInfo, lstatSync(sourcePath, { bigint: true })) &&
        sameFile(snapshotInfo, fstatSync(snapshotFd, { bigint: true })) && sameFile(snapshotInfo, lstatSync(snapshotPath, { bigint: true })) &&
        pathsStillMatch(paths) && !nativeIsAlive(native) && verifyRecoverySource(pending.source, allowedRoots, accountBinding) &&
        (pending.prior === null || verifySnapshotReference(rootPath, pending.prior));
      if (!finalCheck()) throw fail();
      renameSync(markerTemp, markerPath); markerTemp = undefined; fsyncSync(root.fd);
      if (verifyAuthority(null) !== true || !directoryCurrent(root) || nativeIsAlive(native) || !verifyRecoverySource(pending.source, allowedRoots, accountBinding) ||
          !sameFile(sourceInfo, fstatSync(sourceFd, { bigint: true })) || !sameFile(sourceInfo, lstatSync(sourcePath, { bigint: true }))) throw uncertain();
      return true;
    } catch (error) { throw safeError(error); }
    finally {
      sourceBytes?.fill(0); snapshotBody?.fill(0); markerBody?.fill(0);
      if (markerTempFd !== undefined) closeSync(markerTempFd);
      if (markerTemp) try { unlinkSync(markerTemp); } catch {}
      if (snapshotFd !== undefined) closeSync(snapshotFd);
      if (sourceFd !== undefined) closeSync(sourceFd);
      if (markerFd !== undefined) closeSync(markerFd);
      if (codex) closeSync(codex.fd); if (home) closeSync(home.fd); if (root) closeSync(root.fd);
    }
  });
}

/** Older unsealed snapshots remain unavailable until final ownership is proven. */
export function prepareLiveProjectPersistence(options) {
  let store;
  try {
    if (!plain(options) || Reflect.ownKeys(options).some((key) => !["storeRoot", "accountBinding", "previousContainerId", "allowedRoots", "verifyAuthority", "recoverySource", "withPreviousOwnerLease"].includes(key))) throw fail();
    const storeOptions = {
      storeRoot: field(options, "storeRoot"), accountBinding: field(options, "accountBinding"), previousContainerId: field(options, "previousContainerId"),
      allowedRoots: field(options, "allowedRoots"), verifyAuthority: field(options, "verifyAuthority"),
      ...(field(options, "recoverySource") === undefined ? {} : { recoverySource: field(options, "recoverySource") }),
    };
    try { store = openPersistentProjectStore(storeOptions); }
    catch (error) {
      const withPreviousOwnerLease = field(options, "withPreviousOwnerLease");
      if (error?.code !== "PROJECT_STATE_UNCERTAIN" || typeof withPreviousOwnerLease !== "function" || !HASH.test(storeOptions.previousContainerId ?? "")) throw error;
      const { recoverySource: _source, ...sealOptions } = storeOptions;
      sealPendingProjectState({ ...sealOptions, withPreviousOwnerLease });
      store = openPersistentProjectStore(storeOptions);
    }
    const restored = store.restore();
    if (restored !== null && !store.isSealed()) { store.close(); return Object.freeze({ state: "error" }); }
    return Object.freeze({ state: "waiting", store, restored });
  } catch (error) {
    store?.close();
    return Object.freeze({ state: error?.code === "PROJECT_STATE_UNSUPPORTED" ? "unsupported" : "error" });
  }
}

function privateDirectory(path) {
  if (!safePath(path) || typeof process.getuid !== "function") throw fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o700n ||
        !sameDir(info, lstatSync(path, { bigint: true })) || realpathSync(path) !== path) throw fail();
    return { fd, path, info };
  } catch { closeSync(fd); throw fail(); }
}
function directoryCurrent(entry) {
  return sameDir(entry.info, fstatSync(entry.fd, { bigint: true })) && sameDir(entry.info, lstatSync(entry.path, { bigint: true })) && realpathSync(entry.path) === entry.path;
}

/** Seed the newly owned HOME only; never overwrite an existing native file. */
export function prepareNativeProjectSeed(options) {
  let home, codex, file, closed = false;
  try {
    if (!plain(options) || Reflect.ownKeys(options).length !== 4) throw fail();
    const homeRoot = field(options, "homeRoot"), projection = field(options, "projection"),
      allowedRoots = authorize({ allowedRoots: field(options, "allowedRoots") }), verifyAuthority = field(options, "verifyAuthority");
    if (typeof verifyAuthority !== "function" || verifyAuthority() !== true) throw fail();
    const body = Buffer.from(JSON.stringify(nativeProjectState(projection, { allowedRoots })) + "\n");
    if (body.length > MAX_STORE) throw fail();
    const paths = verifiedPaths(projection);
    home = privateDirectory(homeRoot); codex = privateDirectory(join(homeRoot, ".codex"));
    const target = join(`/proc/self/fd/${codex.fd}`, ".codex-global-state.json");
    file = openSync(target, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(file, body); fsyncSync(file);
    const info = fstatSync(file, { bigint: true });
    function verifyBeforeGrant() {
      try {
        if (closed || verifyAuthority() !== true || !directoryCurrent(home) || !directoryCurrent(codex) || !pathsStillMatch(paths) ||
            !sameFile(info, fstatSync(file, { bigint: true })) || !sameFile(info, lstatSync(target, { bigint: true })) || info.nlink !== 1n) return false;
        const current = Buffer.alloc(body.length + 1);
        try { const size = readSync(file, current, 0, current.length, 0); return size === body.length && current.subarray(0, size).equals(body); }
        finally { current.fill(0); }
      } catch { return false; }
    }
    if (!verifyBeforeGrant()) throw fail();
    return Object.freeze({ verifyBeforeGrant, close() { if (closed) return; closed = true; body.fill(0); closeSync(file); closeSync(codex.fd); closeSync(home.fd); } });
  } catch {
    if (file !== undefined) try { closeSync(file); } catch {}
    if (codex) try { closeSync(codex.fd); } catch {}
    if (home) try { closeSync(home.fd); } catch {}
    throw fail();
  }
}

/** Poll only the fixed native global-state file; no queued item is persisted. */
export function startNativeProjectMonitor(options) {
  let home, codex, closed = false, stopped = false, timer, lastInfo;
  let status = Object.freeze({ state: "waiting" });
  try {
    if (!plain(options) || Reflect.ownKeys(options).length !== 5) throw fail();
    const homeRoot = field(options, "homeRoot"), store = field(options, "store"), writer = writerInfo(field(options, "writer")),
      verifyAuthority = field(options, "verifyAuthority"), onFailure = field(options, "onFailure");
    if (typeof store?.capture !== "function" || typeof store?.verifyCurrent !== "function" || typeof verifyAuthority !== "function" || typeof onFailure !== "function" || verifyAuthority(writer) !== true) throw fail();
    home = privateDirectory(homeRoot); codex = privateDirectory(join(homeRoot, ".codex"));
    const target = join(`/proc/self/fd/${codex.fd}`, ".codex-global-state.json");
    function pollNow() {
      if (closed || stopped) return "stopped";
      let fd, bytes;
      try {
        if (verifyAuthority(writer) !== true || !directoryCurrent(home) || !directoryCurrent(codex)) throw fail();
        try { fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (error) { if (error?.code === "ENOENT") { status = Object.freeze({ state: "waiting" }); return "waiting"; } throw error; }
        const info = fstatSync(fd, { bigint: true });
        if (!info.isFile() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(MAX_STORE)) throw fail();
        if (lastInfo && sameFile(lastInfo, info) && sameFile(info, lstatSync(target, { bigint: true }))) {
          store.verifyCurrent(writer);
          status = Object.freeze({ state: "active" });
          return "unchanged";
        }
        // Allocate only this bounded file's current size. If it grows while
        // being read, the extra byte and identity check make this poll busy.
        bytes = Buffer.alloc(Number(info.size) + 1); let size = 0;
        while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, size); if (!count) break; size += count; }
        if (size > Number(info.size)) return "busy";
        let current; try { current = lstatSync(target, { bigint: true }); } catch (error) { if (error?.code === "ENOENT") return "busy"; throw error; }
        if (!sameFile(info, fstatSync(fd, { bigint: true })) || !sameFile(info, current)) return "busy";
        if (verifyAuthority(writer) !== true || !directoryCurrent(home) || !directoryCurrent(codex)) throw fail();
        const state = uniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
        if (!plain(state)) throw fail();
        const initialized = Object.hasOwn(state, "local-projects"), changed = store.capture(state, writer);
        if (verifyAuthority(writer) !== true) throw fail();
        if (initialized) lastInfo = info;
        // This confirms the live projection, not a sealed recovery point.
        // The native-lifetime pending marker and final-owner checks remain.
        status = Object.freeze({ state: initialized ? "active" : "waiting" });
        return !initialized ? "waiting" : changed ? "saved" : "unchanged";
      } catch (error) {
        stopped = true; if (timer) clearInterval(timer);
        const reasonCode = safeError(error).code;
        try { store.markFailure?.(writer, reasonCode); } catch {}
        status = Object.freeze({ state: reasonCode === "PROJECT_STATE_UNSUPPORTED" ? "unsupported" : "error", reasonCode });
        try { onFailure(reasonCode); } catch {}
        return "stopped";
      } finally { bytes?.fill(0); if (fd !== undefined) closeSync(fd); }
    }
    timer = setInterval(pollNow, 500); timer.unref();
    return Object.freeze({ pollNow, status() { return status; }, close() { if (closed) return; closed = true; clearInterval(timer); closeSync(codex.fd); closeSync(home.fd); } });
  } catch {
    if (codex) try { closeSync(codex.fd); } catch {}
    if (home) try { closeSync(home.fd); } catch {}
    throw fail();
  }
}
