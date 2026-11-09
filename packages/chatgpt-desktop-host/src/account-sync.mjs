import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, open, realpath, rename, statfs, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

// This grant contains no credential. Removing it revokes future checks; a new
// grant requires a newly enrolled synchronizer. Never accept this path from a client.
const GRANT = Buffer.from("chatgpt-desktop-account-sync-v1\n");
const MAX = 256 * 1024;
const TMPFS_MAGIC = 0x01021994n;
const FLOCK = "/usr/bin/flock";
const enrolledSynchronizers = new WeakSet();
const loopSynchronizers = new WeakSet();
const SYNC_INTERVAL_MS = 30_000;
const failure = (code) => Object.assign(new Error("Desktop account synchronization unavailable"), { code });
const pathOK = (p) => typeof p === "string" && p.length > 1 && p.length <= 4096 && isAbsolute(p) && resolve(p) === p && !/[\x00-\x1f\x7f]/.test(p);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stable = (a, b) => ["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs", "ctimeNs"].every((k) => a[k] === b[k]);
const sameDir = (a, b) => ["dev", "ino", "uid", "gid", "mode"].every((k) => a[k] === b[k]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 65536 && !/[\x00-\x20\x7f]/.test(v);

async function privateDir(path, uid, code) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o7777n) !== 0o700n || await realpath(path) !== path || !sameDir(info, await lstat(path, { bigint: true }))) throw failure(code);
    return { handle, info, path, fd: `/proc/self/fd/${handle.fd}` };
  } catch (e) { await handle.close(); throw e; }
}

async function verifyDir(dir, code) {
  if (await realpath(dir.path) !== dir.path || !sameDir(dir.info, await lstat(dir.path, { bigint: true })) || !sameDir(dir.info, await dir.handle.stat({ bigint: true }))) throw failure(code);
}

async function readPrivateFile(dir, name, uid, code, limit = MAX) {
  let file, buffer;
  try {
    const path = join(dir.fd, name);
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(limit) || !stable(info, await lstat(path, { bigint: true }))) throw failure(code);
    buffer = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) throw failure(code);
    }
    if (!stable(info, await file.stat({ bigint: true })) || !stable(info, await lstat(path, { bigint: true }))) throw failure(code);
    return { bytes: Buffer.from(buffer.subarray(0, length)), info };
  } catch (e) {
    if (e?.code?.startsWith("ACCOUNT_SYNC_")) throw e;
    throw failure(code);
  } finally { buffer?.fill(0); await file?.close(); }
}

// Claims are compared only as identity metadata from the explicitly trusted,
// private auth source. This does not verify JWT signatures or server validity.
function claims(jwt) {
  if (!text(jwt)) throw failure("ACCOUNT_SYNC_INVALID_SOURCE");
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts.every((s) => /^[A-Za-z0-9_-]+$/.test(s))) throw failure("ACCOUNT_SYNC_INVALID_SOURCE");
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(parts[1], "base64url"))); } catch { throw failure("ACCOUNT_SYNC_INVALID_SOURCE"); }
  const nested = value?.["https://api.openai.com/auth"];
  if (!object(value) || !text(value.iss) || !text(value.sub) || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.iat <= 0 || value.exp <= value.iat || !object(nested) || !text(nested.chatgpt_account_id) || nested.chatgpt_account_id.length > 256) throw failure("ACCOUNT_SYNC_INVALID_SOURCE");
  return { iss: value.iss, sub: value.sub, account: nested.chatgpt_account_id, issued: value.iat, expires: value.exp };
}

function parseAuth(bytes, source) {
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw failure("ACCOUNT_SYNC_INVALID_SOURCE"); }
  const tokens = value?.tokens;
  if (!object(value) || value.auth_mode !== "chatgpt" || !object(tokens) || !text(tokens.account_id) || tokens.account_id.length > 256 || !text(tokens.id_token) || !text(tokens.access_token) || (!source && tokens.refresh_token !== "") || (value.last_refresh !== undefined && (typeof value.last_refresh !== "string" || value.last_refresh.length > 64 || !Number.isFinite(Date.parse(value.last_refresh))))) throw failure("ACCOUNT_SYNC_INVALID_SOURCE");
  const id = claims(tokens.id_token), access = claims(tokens.access_token);
  if (id.iss !== access.iss || id.sub !== access.sub || id.account !== access.account || id.account !== tokens.account_id) throw failure("ACCOUNT_SYNC_IDENTITY_CHANGED");
  const snapshot = { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: tokens.id_token, access_token: tokens.access_token, refresh_token: "", account_id: tokens.account_id }, ...(value.last_refresh !== undefined ? { last_refresh: value.last_refresh } : {}) };
  return { identity: { iss: id.iss, sub: id.sub, account: id.account }, id, access, snapshot };
}
const sameIdentity = (a, b) => a.iss === b.iss && a.sub === b.sub && a.account === b.account;

/** Digest only the consistency-checked identity; never return claims or tokens. */
export function desktopAccountIdentityDigest(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX) throw failure("ACCOUNT_SYNC_INVALID_SOURCE");
  const { identity } = parseAuth(bytes, true);
  return createHash("sha256").update("chatgpt-desktop-account-identity-v1\0").update(JSON.stringify([identity.iss, identity.sub, identity.account])).digest("hex");
}

async function tryLock(fd, shared = false) {
  // std::fs::File::lock in the pinned upstream CLI currently uses flock(2).
  // Passing this already-open description to flock keeps the lock on our fd.
  const executable = await lstat(FLOCK, { bigint: true });
  if (!executable.isFile() || (executable.uid !== 0n && executable.uid !== BigInt(process.getuid())) || (executable.mode & 0o022n) !== 0n || await realpath(FLOCK) !== FLOCK) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
  const code = await new Promise((resolvePromise, reject) => {
    const child = spawn(FLOCK, [shared ? "-s" : "-x", "-n", "3"], { shell: false, stdio: ["ignore", "ignore", "ignore", fd], env: { PATH: "/usr/bin:/bin" } });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE")); }, 1000);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", (exitCode, signal) => { clearTimeout(timer); signal ? reject(failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE")) : resolvePromise(exitCode); });
  });
  if (code === 1) return false;
  if (code !== 0) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
  return true;
}

/**
 * Enrollment is explicit and local to the owner. syncNow copies only new
 * access/id tokens, under the pinned CLI's advisory lock; close is a fence.
 * The caller decides when to schedule checks and must expose revocation.
 */
export async function createDesktopAccountSynchronizer(options) {
  try {
    if (!object(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || process.platform !== "linux" || !process.getuid) throw Error();
    const names = Reflect.ownKeys(options), fields = Object.getOwnPropertyDescriptors(options);
    if (names.length !== 3 || !["grantFile", "homeRoot", "sourceFile"].every((name) => names.includes(name) && Object.hasOwn(fields[name] ?? {}, "value") && pathOK(fields[name].value))) throw Error();
    options = Object.freeze({ sourceFile: fields.sourceFile.value, homeRoot: fields.homeRoot.value, grantFile: fields.grantFile.value });
    if (new Set([options.sourceFile, options.grantFile, join(options.homeRoot, ".codex/auth.json")]).size !== 3) throw Error();
  } catch { throw failure("ACCOUNT_SYNC_INVALID_CONFIG"); }
  const uid = BigInt(process.getuid());
  let home, codex, source, grant, baseline, grantInfo, identity, running, closed = false, handlesClosed = false;
  const grantName = basename(options.grantFile), sourceName = basename(options.sourceFile);
  async function verifyGrant() {
    if (closed) throw failure("ACCOUNT_SYNC_REVOKED");
    try {
      await verifyDir(grant, "ACCOUNT_SYNC_REVOKED");
      const item = await readPrivateFile(grant, grantName, uid, "ACCOUNT_SYNC_REVOKED", GRANT.length);
      try { if (!stable(grantInfo, item.info) || !item.bytes.equals(GRANT)) throw failure("ACCOUNT_SYNC_REVOKED"); } finally { item.bytes.fill(0); }
    } catch { closed = true; throw failure("ACCOUNT_SYNC_REVOKED"); }
  }
  async function verifyHome() {
    try { await verifyDir(home, "ACCOUNT_SYNC_UNSAFE_HOME"); await verifyDir(codex, "ACCOUNT_SYNC_UNSAFE_HOME"); if ((await statfs(home.fd, { bigint: true })).type !== TMPFS_MAGIC) throw failure("ACCOUNT_SYNC_UNSAFE_HOME"); } catch { throw failure("ACCOUNT_SYNC_UNSAFE_HOME"); }
  }
  async function sourceAuth() {
    try {
      await verifyDir(source, "ACCOUNT_SYNC_UNSAFE_SOURCE");
      const item = await readPrivateFile(source, sourceName, uid, "ACCOUNT_SYNC_UNSAFE_SOURCE");
      try { return { auth: parseAuth(item.bytes, true), info: item.info }; } finally { item.bytes.fill(0); }
    } catch (e) { if (["ACCOUNT_SYNC_INVALID_SOURCE", "ACCOUNT_SYNC_IDENTITY_CHANGED"].includes(e?.code)) throw e; throw failure("ACCOUNT_SYNC_UNSAFE_SOURCE"); }
  }
  async function targetAuth() {
    try {
      const item = await readPrivateFile(codex, "auth.json", uid, "ACCOUNT_SYNC_TARGET_CHANGED");
      try { return { auth: parseAuth(item.bytes, false), info: item.info, hash: digest(item.bytes) }; } finally { item.bytes.fill(0); }
    } catch { throw failure("ACCOUNT_SYNC_TARGET_CHANGED"); }
  }
  async function cycle() {
    let lock, sourceLock, temp, out;
    try {
      await verifyGrant(); await verifyHome();
      await verifyDir(source, "ACCOUNT_SYNC_UNSAFE_SOURCE");
      const sourceLockPath = join(source.fd, "auth.lock");
      // Never create or change the user's source lock; skip when the pinned
      // native writer holds it. The source parent is already strictly 0700.
      try { sourceLock = await open(sourceLockPath, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE"); }
      const sourceLockInfo = await sourceLock.stat({ bigint: true });
      if (!sourceLockInfo.isFile() || sourceLockInfo.uid !== uid || sourceLockInfo.nlink !== 1n || !sameDir(sourceLockInfo, await lstat(sourceLockPath, { bigint: true }))) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
      if (!await tryLock(sourceLock.fd, true)) return Object.freeze({ state: "busy" });
      const lockPath = join(codex.fd, "auth.lock");
      lock = await open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      const lockInfo = await lock.stat({ bigint: true });
      if (!lockInfo.isFile() || lockInfo.uid !== uid || lockInfo.nlink !== 1n || (lockInfo.mode & 0o022n) !== 0n || !sameDir(lockInfo, await lstat(lockPath, { bigint: true }))) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
      if (!await tryLock(lock.fd)) return Object.freeze({ state: "busy" });
      await verifyGrant(); await verifyHome();
      const current = await targetAuth();
      if (!stable(current.info, baseline.info) || current.hash !== baseline.hash || !sameIdentity(current.auth.identity, identity)) throw failure("ACCOUNT_SYNC_TARGET_CHANGED");
      const candidate = await sourceAuth();
      if (!sameIdentity(candidate.auth.identity, identity)) throw failure("ACCOUNT_SYNC_IDENTITY_CHANGED");
      if (candidate.auth.id.issued < current.auth.id.issued || candidate.auth.access.issued < current.auth.access.issued || candidate.auth.id.expires < current.auth.id.expires || candidate.auth.access.expires < current.auth.access.expires) throw failure("ACCOUNT_SYNC_STALE_SOURCE");
      const encoded = Buffer.from(JSON.stringify(candidate.auth.snapshot) + "\n");
      try {
        if (digest(encoded) === current.hash) return Object.freeze({ state: "unchanged" });
        temp = join(codex.fd, `.auth-sync-${randomBytes(16).toString("hex")}`);
        out = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await out.writeFile(encoded); await out.sync(); await out.close(); out = undefined;
        await verifyGrant(); await verifyHome(); await verifyDir(source, "ACCOUNT_SYNC_UNSAFE_SOURCE");
        if (!stable(candidate.info, await lstat(join(source.fd, sourceName), { bigint: true }))) throw failure("ACCOUNT_SYNC_UNSAFE_SOURCE");
        if (!sameDir(sourceLockInfo, await lstat(sourceLockPath, { bigint: true }))) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
        if (!stable(current.info, await lstat(join(codex.fd, "auth.json"), { bigint: true }))) throw failure("ACCOUNT_SYNC_TARGET_CHANGED");
        if (!sameDir(lockInfo, await lstat(lockPath, { bigint: true }))) throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
        if (closed) throw failure("ACCOUNT_SYNC_REVOKED");
        await rename(temp, join(codex.fd, "auth.json")); temp = undefined;
        baseline = await targetAuth();
        return Object.freeze({ state: "updated" });
      } finally { encoded.fill(0); }
    } catch (e) {
      const code = typeof e?.code === "string" && /^ACCOUNT_SYNC_[A-Z_]+$/.test(e.code) ? e.code : "ACCOUNT_SYNC_UNAVAILABLE";
      if (["ACCOUNT_SYNC_REVOKED", "ACCOUNT_SYNC_TARGET_CHANGED", "ACCOUNT_SYNC_IDENTITY_CHANGED"].includes(code)) closed = true;
      throw failure(code);
    } finally { await out?.close().catch(() => {}); if (temp) await unlink(temp).catch(() => {}); await lock?.close().catch(() => {}); await sourceLock?.close().catch(() => {}); }
  }
  async function close() {
    closed = true;
    await running?.catch(() => {});
    if (handlesClosed) return;
    handlesClosed = true;
    await Promise.allSettled([home?.handle.close(), codex?.handle.close(), source?.handle.close(), grant?.handle.close()]);
  }
  try {
    home = await privateDir(options.homeRoot, uid, "ACCOUNT_SYNC_UNSAFE_HOME");
    if ((await statfs(home.fd, { bigint: true })).type !== TMPFS_MAGIC) throw failure("ACCOUNT_SYNC_UNSAFE_HOME");
    codex = await privateDir(join(options.homeRoot, ".codex"), uid, "ACCOUNT_SYNC_UNSAFE_HOME");
    source = await privateDir(dirname(options.sourceFile), uid, "ACCOUNT_SYNC_UNSAFE_SOURCE");
    grant = await privateDir(dirname(options.grantFile), uid, "ACCOUNT_SYNC_REVOKED");
    const g = await readPrivateFile(grant, grantName, uid, "ACCOUNT_SYNC_REVOKED", GRANT.length);
    try { if (!g.bytes.equals(GRANT)) throw failure("ACCOUNT_SYNC_REVOKED"); grantInfo = g.info; } finally { g.bytes.fill(0); }
    const current = await targetAuth(), initial = await sourceAuth();
    if (!sameIdentity(current.auth.identity, initial.auth.identity)) throw failure("ACCOUNT_SYNC_IDENTITY_CHANGED");
    baseline = current; identity = current.auth.identity;
    const synchronizer = Object.freeze({
      syncNow() {
        if (closed) return Promise.reject(failure("ACCOUNT_SYNC_REVOKED"));
        if (running) return running;
        running = cycle().finally(() => { running = undefined; });
        return running;
      },
      close,
    });
    enrolledSynchronizers.add(synchronizer);
    return synchronizer;
  } catch (e) {
    await close();
    throw failure(typeof e?.code === "string" && /^ACCOUNT_SYNC_[A-Z_]+$/.test(e.code) ? e.code : "ACCOUNT_SYNC_UNAVAILABLE");
  }
}

/** A server-owned loop; only an explicitly granted synchronizer can be used. */
export function startDesktopAccountSyncLoop(synchronizer) {
  if (arguments.length !== 1 || !enrolledSynchronizers.has(synchronizer) || loopSynchronizers.has(synchronizer)) throw failure("ACCOUNT_SYNC_INVALID_CONFIG");
  loopSynchronizers.add(synchronizer);
  let stopped = false, timer, running, closePromise;
  let state = Object.freeze({ state: "running", lastCheck: "pending" });
  const run = () => {
    if (stopped || running) return;
    running = (async () => {
      try {
        const result = await synchronizer.syncNow();
        if (!stopped) state = Object.freeze({ state: "running", lastCheck: result.state });
      } catch (error) {
        if (!stopped) {
          stopped = true;
          const code = typeof error?.code === "string" && /^ACCOUNT_SYNC_[A-Z_]+$/.test(error.code) ? error.code : "ACCOUNT_SYNC_UNAVAILABLE";
          state = Object.freeze({ state: "stopped", code });
          await synchronizer.close();
        }
      } finally {
        running = undefined;
        if (!stopped) { timer = setTimeout(run, SYNC_INTERVAL_MS); timer.unref(); }
      }
    })();
  };
  run();
  return Object.freeze({
    status() { return state; },
    close() {
      if (closePromise) return closePromise;
      stopped = true;
      if (timer) { clearTimeout(timer); timer = undefined; }
      closePromise = (async () => {
        await synchronizer.close();
        await running?.catch(() => {});
        if (state.state !== "stopped") state = Object.freeze({ state: "closed" });
      })();
      return closePromise;
    },
  });
}
