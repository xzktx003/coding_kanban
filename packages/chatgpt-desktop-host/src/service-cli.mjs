#!/usr/bin/env node
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startContainerDesktopService, reattachContainerDesktopService } from "./container-host-service.mjs";
import { captureContainerRecoveryIdentity } from "./container-recovery-identity.mjs";
import { PINNED_LINUX_RUNTIME } from "./private-runtime.mjs";
import { parseJsonLines } from "./json-lines.mjs";
import { decodeWireValue, encodeWireValue } from "./wire-value.mjs";
import { normalizeDesktopConnection } from "./connection-policy.mjs";
import { normalizeProjectRoots } from "./fixed-project-mounts.mjs";
import { normalizePersistentHistoryRoot } from "./persistent-history.mjs";
import { createDesktopAccountSynchronizer, startDesktopAccountSyncLoop } from "./account-sync.mjs";
import {
  normalizeContainerMemoryLimitMiB,
  normalizeContainerPidsLimit,
  startContainerDesktopUpstream,
  reattachContainerDesktopUpstream,
} from "./container-service.mjs";

const MAX = 16 * 1024,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  SHA = /^[a-f0-9]{64}$/,
  TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const REQUIRED = [
  "imageDigest",
  "sourceRoot",
  "runtimeRoot",
  "bridgeRoot",
  "cpuId",
  "macAsarPath",
  "macAsarSha256",
  "profileFile",
  "controlSocketPath",
  "dockerPath",
  "dockerSha256",
  "pythonPath",
  "pythonSha256",
  "nodePath",
  "nodeSha256",
];
const OPTIONAL = [
  "memoryLimitMiB",
  "pidsLimit",
  "startupTimeoutMs",
  "networkMode",
  "accountSnapshot",
  "accountSync",
  "serverSsh",
  "initialMode",
  "connection",
  "projectRoots",
  "historyRoot",
];
const PATHS = [
  "sourceRoot",
  "runtimeRoot",
  "bridgeRoot",
  "macAsarPath",
  "profileFile",
  "controlSocketPath",
  "dockerPath",
  "pythonPath",
  "nodePath",
];
const PROFILE_KEYS = [
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
const PHASES = [
  "starting",
  "published",
  "retired",
  "start_failed",
  "retained_unknown",
  "native_exited",
  "cancelled",
];
const failure = (code) =>
  Object.assign(new Error("Desktop service unavailable"), { code });
const canonical = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const same = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid", "size", "mtimeNs", "ctimeNs"].every(
    (key) => a[key] === b[key],
  );
const sameDirectory = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid"].every((key) => a[key] === b[key]);
const safeCode = (error) =>
  typeof error?.code === "string" &&
  error.code.length <= 128 &&
  /^(?:CONTAINER|PROFILE|ACCOUNT_SNAPSHOT|ACCOUNT_SYNC|DESKTOP_CLI|DESKTOP_SUPERVISOR|DESKTOP_ALIAS)_[A-Z_]+$/.test(
    error.code,
  )
    ? error.code
    : "DESKTOP_CLI_START_FAILED";

// JSON.parse validates the grammar; this second pass rejects duplicate decoded
// object keys (including escaped aliases) instead of silently taking the last.
function parseUnique(text) {
  const value = JSON.parse(text),
    stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],]/g)) {
    const token = match[0],
      top = stack.at(-1);
    if (token === "{" || token === "[")
      stack.push({
        object: token === "{",
        key: token === "{",
        keys: new Set(),
      });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ",") {
      if (top?.object) top.key = true;
    } else if (top?.object && top.key) {
      const key = JSON.parse(token);
      if (top.keys.has(key)) throw new SyntaxError("Duplicate object key");
      top.keys.add(key);
      top.key = false;
    }
  }
  return value;
}

async function privateParent(path) {
  if (!canonical(path)) throw Error();
  const parent = dirname(path);
  if ((await realpath(parent)) !== parent) throw Error();
  const info = await lstat(parent, { bigint: true });
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(process.getuid()) ||
    (info.mode & 0o7777n) !== 0o700n
  )
    throw Error();
  return info;
}

async function privateJson(path, { missing = false } = {}) {
  const parent = await privateParent(path);
  let fd;
  try {
    fd = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (missing && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const before = await fd.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.size > BigInt(MAX)
    )
      throw Error();
    const bytes = Buffer.alloc(MAX + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await fd.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX) throw Error();
    if (
      !same(before, await fd.stat({ bigint: true })) ||
      !same(before, await lstat(path, { bigint: true })) ||
      !sameDirectory(parent, await privateParent(path))
    )
      throw Error();
    const body = bytes.subarray(0, size),
      value = parseUnique(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
    return {
      value,
      info: before,
      fingerprint: createHash("sha256").update(body).digest("hex"),
    };
  } finally {
    await fd.close();
  }
}

function optionsFor(value) {
  if (
    !object(value) ||
    REQUIRED.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !REQUIRED.includes(key) && !OPTIONAL.includes(key),
    ) ||
    PATHS.some((key) => !canonical(value[key])) ||
    !/^sha256:[a-f0-9]{64}$/.test(value.imageDigest) ||
    ["macAsarSha256", "dockerSha256", "pythonSha256", "nodeSha256"].some(
      (key) => !SHA.test(value[key] ?? ""),
    ) ||
    !Number.isSafeInteger(value.cpuId) ||
    value.cpuId < 0 ||
    value.cpuId > 65535 ||
    (value.startupTimeoutMs !== undefined &&
      (!Number.isSafeInteger(value.startupTimeoutMs) ||
        value.startupTimeoutMs < 100 ||
        value.startupTimeoutMs > 180000)) ||
    (value.networkMode !== undefined &&
      !["none", "bridge"].includes(value.networkMode)) ||
    (value.initialMode !== undefined && value.initialMode !== "codex")
  )
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  const serverSsh = Object.getOwnPropertyDescriptor(value, "serverSsh");
  if (
    serverSsh &&
    (!Object.hasOwn(serverSsh, "value") ||
      (serverSsh.value !== undefined && typeof serverSsh.value !== "boolean"))
  )
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  try {
    normalizeContainerMemoryLimitMiB(value.memoryLimitMiB);
    normalizeContainerPidsLimit(value.pidsLimit);
    normalizePersistentHistoryRoot(value.historyRoot);
  } catch {
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  }
  const options = { ...value };
  if (value.projectRoots !== undefined) {
    try {
      options.projectRoots = normalizeProjectRoots(value.projectRoots);
    } catch {
      throw failure("DESKTOP_CLI_INVALID_CONFIG");
    }
  }
  if (value.connection !== undefined) {
    try {
      if (value.networkMode !== "bridge") throw Error();
      options.connection = normalizeDesktopConnection(value.connection);
    } catch {
      throw failure("DESKTOP_CLI_INVALID_CONFIG");
    }
  }
  if (value.accountSnapshot !== undefined) {
    const account = value.accountSnapshot;
    if (
      value.networkMode !== "bridge" ||
      !exact(account, ["sourceFile", "homeRoot"]) ||
      !canonical(account.sourceFile) ||
      !canonical(account.homeRoot)
    )
      throw failure("DESKTOP_CLI_INVALID_CONFIG");
    options.accountSnapshot = Object.freeze({ ...account });
  }
  if (value.accountSync !== undefined) {
    const sync = value.accountSync;
    if (
      !exact(sync, ["grantFile"]) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(sync, "grantFile") ?? {}, "value") ||
      !canonical(sync.grantFile) ||
      !options.accountSnapshot ||
      !options.historyRoot ||
      value.networkMode !== "bridge"
    )
      throw failure("DESKTOP_CLI_INVALID_CONFIG");
    const grantParent = dirname(sync.grantFile);
    const overlaps = (a, b) => {
      const contains = (parent, child) => { const part = relative(parent, child); return !part || (part !== ".." && !part.startsWith("../") && !isAbsolute(part)); };
      return contains(a, b) || contains(b, a);
    };
    const protectedPaths = [value.sourceRoot, value.runtimeRoot, value.bridgeRoot, value.macAsarPath, dirname(value.profileFile), dirname(value.controlSocketPath), value.dockerPath, value.pythonPath, value.nodePath, options.accountSnapshot.homeRoot, dirname(options.accountSnapshot.sourceFile), options.historyRoot, ...(options.projectRoots ?? [])];
    if (protectedPaths.some((path) => overlaps(grantParent, path)))
      throw failure("DESKTOP_CLI_INVALID_CONFIG");
    options.accountSync = Object.freeze({ grantFile: sync.grantFile });
  }
  return Object.freeze(options);
}

/** Read only explicitly selected owned 0600 config; no implicit account import. */
export async function readDesktopServiceConfig(configFile) {
  let parsed;
  try {
    parsed = await privateJson(configFile);
  } catch (error) {
    throw failure(
      error instanceof SyntaxError || error instanceof TypeError
        ? "DESKTOP_CLI_INVALID_CONFIG"
        : "DESKTOP_CLI_CONFIG_UNAVAILABLE",
    );
  }
  if (
    !exact(parsed.value, ["version", "options"]) ||
    parsed.value.version !== 1
  )
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  return Object.freeze({
    options: optionsFor(parsed.value.options),
    fingerprint: parsed.fingerprint,
  });
}

function binding(config) {
  if (
    !exact(config, ["options", "fingerprint"]) ||
    !SHA.test(config.fingerprint ?? "")
  )
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  return optionsFor(config.options);
}

async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw Error();
  const root = `/proc/${pid}`,
    parse = (text) => {
      const end = text.lastIndexOf(") ");
      if (end < 0 || text.slice(0, text.indexOf(" (")) !== String(pid))
        throw Error();
      const fields = text
        .slice(end + 2)
        .trim()
        .split(/\s+/);
      if (!/^[RSDTtWPKI]$/.test(fields[0]) || !TICKS.test(fields[19] ?? ""))
        throw Error();
      return fields[19];
    };
  const first = parse(await readFile(join(root, "stat"), "utf8")),
    info = await lstat(root, { bigint: true }),
    second = parse(await readFile(join(root, "stat"), "utf8"));
  if (info.uid !== BigInt(process.getuid()) || first !== second) throw Error();
  return second;
}

async function launchRecord(config) {
  const path = config.options.profileFile + ".launch",
    parent = await privateParent(path);
  let fd;
  try {
    fd = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    throw failure(
      error.code === "EEXIST"
        ? "DESKTOP_CLI_ALREADY_ATTEMPTED"
        : "DESKTOP_CLI_LAUNCH_RECORD_UNAVAILABLE",
    );
  }
  let identity, startTicks;
  const pid = process.pid;
  try {
    identity = await fd.stat({ bigint: true });
    startTicks = await processIdentity(pid);
  } catch {
    await fd.close().catch(() => {});
    throw failure("DESKTOP_CLI_LAUNCH_RECORD_UNAVAILABLE");
  }
  const base = {
    version: 1,
    configSha256: config.fingerprint,
    pid,
    startTicks,
  };
  return {
    async write(phase, owner) {
      if (
        !sameDirectory(parent, await privateParent(path)) ||
        !sameDirectory(identity, await lstat(path, { bigint: true }))
      )
        throw failure("DESKTOP_CLI_LAUNCH_RECORD_CHANGED");
      const record = { ...base, phase };
      if (
        UUID.test(owner?.profileId ?? "") &&
        UUID.test(owner?.generation ?? "")
      ) {
        record.profileId = owner.profileId;
        record.generation = owner.generation;
      }
      if (SHA.test(owner?.containerId ?? ""))
        record.containerId = owner.containerId;
      const bytes = Buffer.from(JSON.stringify(record) + "\n");
      await fd.truncate(0);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await fd.write(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!result.bytesWritten) throw Error();
        offset += result.bytesWritten;
      }
      await fd.sync();
    },
    close: () => fd.close(),
  };
}

async function absent(path, code) {
  try {
    await lstat(path);
    throw failure(code);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** One explicit launch attempt. No retry, native stop, adoption or process signal. */
export async function runDesktopService(
  config,
  {
    signal,
    startService = startContainerDesktopService,
    startUpstream = startContainerDesktopUpstream,
    reattachService = reattachContainerDesktopService,
    reattachUpstream = reattachContainerDesktopUpstream,
    createAccountSynchronizer = createDesktopAccountSynchronizer,
    startAccountSyncLoop = startDesktopAccountSyncLoop,
    onEvent = () => {},
    onOwner,
    recordRecoveryIdentity = false,
    recovery,
  } = {},
) {
  const options = binding(config);
  if (
    !(signal instanceof AbortSignal) ||
    typeof startService !== "function" ||
    typeof startUpstream !== "function" ||
    typeof reattachService !== "function" ||
    typeof reattachUpstream !== "function" ||
    typeof createAccountSynchronizer !== "function" ||
    typeof startAccountSyncLoop !== "function" ||
    typeof onEvent !== "function" ||
    typeof recordRecoveryIdentity !== "boolean" ||
    (onOwner !== undefined && typeof onOwner !== "function")
  )
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  if (recovery !== undefined) {
    try {
      if (!exact(recovery, ["identity", "configSha256"])) throw Error();
      const identity = captureContainerRecoveryIdentity(recovery.identity);
      if (!SHA.test(recovery.configSha256 ?? "") || identity.configSha256 !== recovery.configSha256) throw Error();
      recovery = Object.freeze({ identity, configSha256: recovery.configSha256 });
    } catch { throw failure("DESKTOP_CLI_INVALID_CONFIG"); }
  }
  const emit = (value) => {
    try {
      onEvent(Object.freeze(value));
    } catch {}
  };
  if (signal.aborted)
    return { code: 0, state: "cancelled", nativeState: "not_observed" };
  await absent(options.profileFile, "DESKTOP_CLI_PROFILE_EXISTS");
  await absent(options.controlSocketPath, "DESKTOP_CLI_CONTROL_EXISTS");
  const record = await launchRecord(config);
  let owner,
    accountSynchronizer,
    accountLoop,
    syncMonitor,
    startupSyncError,
    starting = true,
    retiring = false,
    stop,
    closeAttempted = false;
  let resolveSyncFailure;
  const syncFailure = new Promise((resolveFailure) => { resolveSyncFailure = resolveFailure; });
  const syncStatus = () => {
    try {
      const state = accountLoop?.status();
      return state?.state === "running" ? undefined : failure(
        typeof state?.code === "string" && /^ACCOUNT_SYNC_[A-Z_]+$/.test(state.code)
          ? state.code
          : "ACCOUNT_SYNC_UNAVAILABLE",
      );
    } catch { return failure("ACCOUNT_SYNC_UNAVAILABLE"); }
  };
  const closeSync = async () => {
    if (syncMonitor) { clearInterval(syncMonitor); syncMonitor = undefined; }
    if (accountLoop) await accountLoop.close();
    else if (accountSynchronizer) await accountSynchronizer.close();
  };
  const startAuthorizedUpstream = async (upstreamOptions) => {
    const container = recovery
      ? await reattachUpstream(upstreamOptions, recovery)
      : await startUpstream(upstreamOptions);
    try {
      accountSynchronizer = await createAccountSynchronizer({
        sourceFile: options.accountSnapshot.sourceFile,
        homeRoot: options.accountSnapshot.homeRoot,
        grantFile: options.accountSync.grantFile,
      });
      const first = await accountSynchronizer.syncNow();
      if (!["updated", "unchanged"].includes(first?.state))
        throw failure("ACCOUNT_SYNC_LOCK_UNAVAILABLE");
      accountLoop = startAccountSyncLoop(accountSynchronizer);
      const problem = syncStatus();
      if (problem) throw problem;
      syncMonitor = setInterval(() => {
        const error = syncStatus();
        if (error) resolveSyncFailure({ state: "sync_failed", reasonCode: safeCode(error) });
      }, 1000);
      syncMonitor.unref();
      const wrappedUpstream = {
        async send(encoded, control) {
          const error = syncStatus();
          if (error || retiring) {
            let teardown = false;
            try { teardown = decodeWireValue(encoded)?.type === "destroyView"; } catch {}
            if (!teardown) throw retiring ? failure("ACCOUNT_SYNC_REVOKED") : error;
          }
          return container.upstream.send(encoded, control);
        },
        subscribe(fn) { return container.upstream.subscribe(fn); },
      };
      if (typeof container.upstream.sendBatch === "function")
        wrappedUpstream.sendBatch = (entries) => {
          const error = syncStatus();
          if (error || retiring) throw retiring ? failure("ACCOUNT_SYNC_REVOKED") : error;
          return container.upstream.sendBatch(entries);
        };
      const wrapped = {
        profileId: container.profileId,
        generation: container.generation,
        upstream: Object.freeze(wrappedUpstream),
        async verifyIdentity() {
          if (retiring) return container.verifyIdentity();
          return !syncStatus() && await container.verifyIdentity() && !syncStatus();
        },
        disconnectTransport: (...args) => container.disconnectTransport(...args),
        reconnectTransport: (...args) => container.reconnectTransport(...args),
        nativeExited: container.nativeExited,
        projectPersistenceStatus: () => container.projectPersistenceStatus?.() ?? "unknown",
        onUnavailable: (fn) => container.onUnavailable(fn),
      };
      Object.defineProperty(wrapped, "containerId", { value: container.containerId });
      if (typeof container.captureRecoveryIdentity === "function") {
        Object.defineProperty(wrapped, "captureRecoveryIdentity", {
          value: async (args) => {
            const before = syncStatus();
            if (before || retiring) throw before ?? failure("ACCOUNT_SYNC_REVOKED");
            const value = await container.captureRecoveryIdentity(args);
            const after = syncStatus();
            if (after || retiring) throw after ?? failure("ACCOUNT_SYNC_REVOKED");
            return value;
          },
        });
      }
      return Object.freeze(wrapped);
    } catch (error) {
      await closeSync().catch(() => {});
      await container.disconnectTransport?.().catch(() => {});
      const wrapped = failure(safeCode(error));
      startupSyncError = wrapped;
      Object.defineProperty(wrapped, "retainedOwner", {
        value: Object.freeze({
          profileId: upstreamOptions.profileId,
          generation: upstreamOptions.generation,
          containerId: container.containerId,
          nativeExited: container.nativeExited,
        }),
      });
      throw wrapped;
    }
  };
  const cancelled = new Promise((resolveStop) => {
    stop = () => {
      if (starting)
        emit({ state: "cancelling_startup", nativeState: "unknown" });
      resolveStop({ state: "cancelled" });
    };
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    await record.write("starting");
    if (signal.aborted) {
      await record.write("cancelled");
      return { code: 0, state: "cancelled", nativeState: "not_observed" };
    }
    if (options.accountSync) {
      const { accountSync: _accountSync, ...hostOptions } = options;
      owner = recovery
        ? await reattachService(hostOptions, recovery, { startUpstream: startAuthorizedUpstream })
        : await startService(hostOptions, { startUpstream: startAuthorizedUpstream });
    } else owner = recovery ? await reattachService(options, recovery) : await startService(options);
    starting = false;
    if (
      !owner ||
      typeof owner.close !== "function" ||
      typeof owner.nativeExited?.then !== "function" ||
      !UUID.test(owner.profileId ?? "") ||
      !UUID.test(owner.generation ?? "")
    )
      throw failure("DESKTOP_CLI_START_FAILED");
    if (options.accountSync) {
      if (!accountSynchronizer || !accountLoop) throw failure("ACCOUNT_SYNC_UNAVAILABLE");
      const error = syncStatus();
      if (error) throw error;
    }
    // The supervisor records this identity before the CLI reports published.
    // The lower-level service may already have published its profile. This
    // identity is never added to CLI events or standard output.
    if (onOwner !== undefined) {
      if (!SHA.test(owner.containerId ?? ""))
        throw failure("DESKTOP_CLI_START_FAILED");
      if (recordRecoveryIdentity && typeof owner.captureRecoveryIdentity !== "function")
        throw failure("DESKTOP_CLI_RECOVERY_UNAVAILABLE");
      const recoveryIdentity = recordRecoveryIdentity
        ? await owner.captureRecoveryIdentity({ configSha256: config.fingerprint })
        : undefined;
      await onOwner(Object.freeze({
        containerId: owner.containerId,
        profileId: owner.profileId,
        generation: owner.generation,
        ...(recoveryIdentity === undefined ? {} : { recoveryIdentity }),
      }));
    }
    if (options.accountSync) {
      const error = syncStatus();
      if (error) throw error;
    }
    let nativeOutcome;
    const exited = Promise.resolve(owner.nativeExited).then(
      (value) =>
        (nativeOutcome = {
          state: value?.state === "exited" ? "native_exited" : "unknown",
        }),
      () => (nativeOutcome = { state: "unknown" }),
    );
    if (!signal.aborted && !nativeOutcome) {
      await record.write("published", owner);
      if (options.accountSync) {
        const error = syncStatus();
        if (error) throw error;
      }
      // Cancellation or a native exit can arrive during the durable write.
      // Re-check before announcing readiness, without a retry or native probe.
      if (!signal.aborted && !nativeOutcome)
        emit({
          state: "published",
          profileId: owner.profileId,
          generation: owner.generation,
          nativeState: "not_observed",
        });
    }
    const outcome = signal.aborted
      ? { state: "cancelled" }
      : (nativeOutcome ?? (await Promise.race([cancelled, exited, syncFailure])));
    closeAttempted = true;
    retiring = true;
    const syncClosing = closeSync();
    void syncClosing.catch(() => {});
    try { await owner.close(); } finally { await syncClosing; }
    const state =
      outcome.state === "cancelled"
        ? "retired"
        : outcome.state === "native_exited"
          ? "native_exited"
          : "retained_unknown";
    await record.write(state, owner);
    const result = {
      code: state === "retired" ? 0 : 1,
      state,
      nativeState: state === "native_exited" ? "exited" : "unknown",
      ...(outcome.state === "sync_failed" ? { reasonCode: outcome.reasonCode } : {}),
    };
    emit(result);
    return result;
  } catch (error) {
    const retained = owner ?? error?.retainedOwner;
    retiring = true;
    await closeSync().catch(() => {});
    // A failed start already owns its cleanup. A failed close can be unknown;
    // neither case grants permission to repeat a native teardown request.
    if (owner && !closeAttempted) {
      closeAttempted = true;
      try {
        await owner.close();
      } catch {}
    }
    const state = retained ? "retained_unknown" : "start_failed";
    await record.write(state, retained).catch(() => {});
    const result = {
      code: 1,
      state,
      nativeState: retained ? "unknown" : "not_observed",
      reasonCode: safeCode(startupSyncError ?? error),
    };
    emit(result);
    return result;
  } finally {
    starting = false;
    if (syncMonitor) clearInterval(syncMonitor);
    signal.removeEventListener("abort", stop);
    await record.close();
  }
}

function profileFor(value, options) {
  const serverSsh = options.serverSsh === true;
  if (
    !exact(value, serverSsh ? [...PROFILE_KEYS, "serverSshSocketPath"] : PROFILE_KEYS) ||
    value.version !== 1 ||
    !UUID.test(value.id ?? "") ||
    !UUID.test(value.generation ?? "") ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    value.uid !== process.getuid() ||
    !TICKS.test(value.startTicks ?? "") ||
    value.macAsarPath !== options.macAsarPath ||
    value.macAsarSha256 !== options.macAsarSha256 ||
    value.linuxAsarPath !== join(options.sourceRoot, "resources", "app.asar") ||
    value.linuxAsarSha256 !== PINNED_LINUX_RUNTIME.asarSha256 ||
    value.controlSocketPath !== options.controlSocketPath ||
    (serverSsh && value.serverSshSocketPath !== join(options.bridgeRoot, "server-ssh.sock"))
  )
    throw Error();
  return value;
}

async function brokerHello(profile, timeoutMs) {
  const socket = createConnection({ path: profile.controlSocketPath });
  socket.on("error", () => {});
  let timer;
  try {
    const input = parseJsonLines(socket, { maxLineBytes: 4096 });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        socket.destroy();
        reject(Error());
      }, timeoutMs);
    });
    await Promise.race([
      new Promise((resolveWrite, reject) =>
        socket.write(
          encodeWireValue({
            v: 1,
            type: "hello",
            profileId: profile.id,
            generation: profile.generation,
          }) + "\n",
          (error) => (error ? reject(Error()) : resolveWrite()),
        ),
      ),
      timeout,
    ]);
    const next = await Promise.race([input.next(), timeout]);
    if (next.done) throw Error();
    const value = decodeWireValue(next.value);
    if (
      !exact(value, [
        "v",
        "type",
        "profileId",
        "generation",
        "pid",
        "startTicks",
      ]) ||
      value.v !== 1 ||
      value.type !== "hello" ||
      value.profileId !== profile.id ||
      value.generation !== profile.generation ||
      value.pid !== profile.pid ||
      value.startTicks !== profile.startTicks
    )
      throw Error();
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}

/** No createView, AppHost, native RPC, model/account read or process mutation. */
export async function readDesktopServiceStatus(
  config,
  { timeoutMs = 3000 } = {},
) {
  const options = binding(config);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw failure("DESKTOP_CLI_INVALID_CONFIG");
  const unknown = { nativeState: "not_observed", resourcesVerified: false };
  try {
    const record = await privateJson(options.profileFile + ".launch", {
      missing: true,
    });
    if (
      record &&
      (!object(record.value) ||
        record.value.version !== 1 ||
        record.value.configSha256 !== config.fingerprint ||
        !PHASES.includes(record.value.phase))
    )
      return {
        state: "unavailable",
        reasonCode: "launch_record_mismatch",
        ...unknown,
      };
    const current = await privateJson(options.profileFile, { missing: true });
    if (!current)
      return {
        state: record ? "launch_record_only" : "not_started",
        ...(record ? { phase: record.value.phase } : {}),
        ...unknown,
      };
    if (
      exact(current.value, ["version", "state"]) &&
      current.value.version === 0 &&
      current.value.state === "revoked"
    )
      return { state: "revoked", ...unknown };
    const profile = profileFor(current.value, options);
    if (
      record &&
      (record.value.pid !== profile.pid ||
        record.value.startTicks !== profile.startTicks ||
        record.value.profileId !== profile.id ||
        record.value.generation !== profile.generation)
    )
      return {
        state: "unavailable",
        reasonCode: "launch_record_mismatch",
        ...unknown,
      };
    if ((await processIdentity(profile.pid)) !== profile.startTicks)
      throw Error();
    const parent = await privateParent(options.controlSocketPath),
      socket = await lstat(options.controlSocketPath, { bigint: true });
    if (
      !socket.isSocket() ||
      socket.uid !== BigInt(process.getuid()) ||
      socket.mode & 0o022n
    )
      throw Error();
    await brokerHello(profile, timeoutMs);
    const after = await privateJson(options.profileFile);
    if (
      !same(current.info, after.info) ||
      current.fingerprint !== after.fingerprint ||
      !sameDirectory(
        socket,
        await lstat(options.controlSocketPath, { bigint: true }),
      ) ||
      !sameDirectory(parent, await privateParent(options.controlSocketPath)) ||
      (await processIdentity(profile.pid)) !== profile.startTicks
    )
      throw Error();
    return {
      state: "broker_ready",
      profileId: profile.id,
      generation: profile.generation,
      ...unknown,
    };
  } catch {
    return {
      state: "unavailable",
      reasonCode: "identity_or_broker_unavailable",
      ...unknown,
    };
  }
}

export function parseDesktopServiceArguments(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 3 ||
    !["start", "status", "supervisor-init", "supervisor-status", "supervise"].includes(args[0]) ||
    args[1] !== "--config" ||
    !canonical(args[2])
  )
    throw failure("DESKTOP_CLI_USAGE");
  return { command: args[0], configFile: args[2] };
}

async function main() {
  const abort = new AbortController(),
    stop = () => abort.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdout.on("error", () => {});
  let retiredManager = false;
  try {
    const { command, configFile } = parseDesktopServiceArguments(process.argv.slice(2));
    if (["supervisor-init", "supervisor-status", "supervise"].includes(command)) {
      const { createDesktopSupervisorConfigFactory } = await import("./supervisor-config.mjs");
      const { initializeDesktopSupervisor, readDesktopSupervisorStatus, runDesktopSupervisor } = await import("./supervisor-service.mjs");
      const factory = await createDesktopSupervisorConfigFactory({ templateFile: configFile });
      const scope = { stateDirectory: factory.stateDirectory, deploymentId: factory.deploymentId };
      if (command === "supervisor-init") {
        await initializeDesktopSupervisor(scope);
        process.stdout.write(JSON.stringify({ state: "initialized" }) + "\n");
      } else if (command === "supervisor-status") {
        const result = await readDesktopSupervisorStatus(scope);
        process.stdout.write(JSON.stringify(result) + "\n");
      } else {
        const { publishStableProfileAlias } = await import("./stable-profile-alias.mjs");
        const result = await runDesktopSupervisor({
          ...scope, pythonPath: factory.pythonPath, pythonSha256: factory.pythonSha256, signal: abort.signal,
        }, {
          createConfig: factory.createConfig,
          createRecoveryConfig: factory.createRecoveryConfig,
          recordRecoveryIdentity: true,
          publishProfile: async ({ config, identity, previous, attemptId, verifyLease }) => {
            const previousAttemptId = previous.phase === "ready" ? undefined : previous.attemptId;
            if (previousAttemptId !== undefined && previous.recovery?.profileFile !== join(factory.deploymentRoot, `g${previousAttemptId.replaceAll("-", "")}`, "p.json"))
              throw failure("DESKTOP_SUPERVISOR_STATE_UNAVAILABLE");
            await publishStableProfileAlias({
              deploymentRoot: factory.deploymentRoot,
              current: { attemptId, file: config.options.profileFile, profileId: identity.profileId, generation: identity.generation },
              previousAttemptId, verifyLease,
            });
          },
          onEvent: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
        });
        process.stdout.write(JSON.stringify(result) + "\n");
        // A service manager may restart after a confirmed native exit. Unknown
        // ownership is a distinct nonzero status that must not be retried.
        process.exitCode = result.state === "native_exited" ? 1 : result.state === "blocked" ? 2 : 0;
      }
    } else {
      const config = await readDesktopServiceConfig(configFile);
      if (command === "status") {
        const result = await readDesktopServiceStatus(config);
        process.stdout.write(JSON.stringify(result) + "\n");
        process.exitCode = result.state === "broker_ready" ? 0 : 1;
      } else {
        const result = await runDesktopService(config, {
          signal: abort.signal,
          onEvent: (event) => process.stdout.write(JSON.stringify(event) + "\n"),
        });
        process.exitCode = result.code;
        retiredManager = result.state === "retired" && result.code === 0;
      }
    }
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ state: "unavailable", reasonCode: safeCode(error) }) +
        "\n",
    );
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  if (retiredManager) {
    // close() has revoked the profile and settled its own views. The detached
    // native retains its liveness monitor, so finish only this CLI manager.
    // Unknown close results intentionally never enter this branch.
    await new Promise((done) => process.stdout.write("", done));
    process.exit(0);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Let this module finish evaluating before loading the supervisor, which
  // imports runDesktopService. Top-level await here would deadlock that cycle.
  void main().catch(() => {
    process.stderr.write(JSON.stringify({ state: "unavailable", reasonCode: "DESKTOP_CLI_START_FAILED" }) + "\n");
    process.exitCode = 1;
  });
}
