import { randomUUID } from "node:crypto";
import { containerServerSshOption } from "./container-server-ssh.mjs";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openWebviewArchive } from "./assets.mjs";
import { createDesktopControlService } from "./control-service.mjs";
import {
  isAccountSnapshotErrorCode,
  normalizeContainerAccountSnapshot,
  normalizeContainerMemoryLimitMiB,
  normalizeContainerPidsLimit,
  reattachContainerDesktopUpstream,
  startContainerDesktopUpstream,
} from "./container-service.mjs";
import { captureContainerRecoveryIdentity } from "./container-recovery-identity.mjs";
import { createProfilePublisher } from "./profile-publisher.mjs";
import { PINNED_LINUX_RUNTIME } from "./private-runtime.mjs";
import { decodeWireValue } from "./wire-value.mjs";
import {
  assertContainerWriteAuthority,
  snapshotContainerWriteBatch,
} from "./container-write-guard.mjs";
import { normalizeDesktopConnection } from "./connection-policy.mjs";
import { normalizeContainerSharedAuthority } from "./container-shared-authority.mjs";
import * as ownedSharedDesktop from "./owned-shared-desktop-source.mjs";
import {
  normalizeProjectRoots,
  prepareFixedProjectMounts,
} from "./fixed-project-mounts.mjs";
import { normalizePersistentHistoryRoot } from "./persistent-history.mjs";

const failure = (code) =>
  Object.assign(new Error("Private container host unavailable"), { code });
function detachFailure(error) {
  let code;
  try {
    code = Object.getOwnPropertyDescriptor(error, "code")?.value;
  } catch {}
  return failure(
    code === "CONTAINER_BUSY"
      ? "CONTAINER_HOST_DETACH_BUSY"
      : code === "CONTAINER_TIMEOUT"
        ? "CONTAINER_HOST_DETACH_TIMEOUT"
        : "CONTAINER_HOST_DETACH_FAILED",
  );
}
const pathOK = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const same = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid", "size", "mtimeNs", "ctimeNs"].every(
    (key) => a[key] === b[key],
  );
const contains = (parent, child) => {
  const part = relative(parent, child);
  return (
    !part || (part !== ".." && !part.startsWith("../") && !isAbsolute(part))
  );
};

async function managerTicks() {
  const text = await readFile(`/proc/${process.pid}/stat`, "utf8"),
    start = text.indexOf(" ("),
    end = text.lastIndexOf(") ");
  const fields = text
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  if (
    start < 1 ||
    end < start ||
    text.slice(0, start) !== String(process.pid) ||
    !TICKS.test(fields[19] ?? "")
  )
    throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
  return fields[19];
}
async function privateParent(path, uid) {
  const parent = dirname(path);
  if ((await realpath(parent)) !== parent)
    throw failure("CONTAINER_HOST_UNSAFE_PATH");
  const info = await lstat(parent, { bigint: true });
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(uid) ||
    (info.mode & 0o7777n) !== 0o700n
  )
    throw failure("CONTAINER_HOST_UNSAFE_PATH");
  try {
    await lstat(path);
    throw failure("CONTAINER_HOST_PATH_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/** Explicit server-only container/profile composition; never started by pnpm dev. */
export async function startContainerDesktopService(
  options = {},
  dependencies = {},
) {
  return containerDesktopService(options, dependencies, null);
}

/** Trusted server-only entry: publish a fresh broker for one exact retained native. */
export async function reattachContainerDesktopService(options = {}, context, dependencies = {}) {
  let recovery;
  try {
    if (!context || typeof context !== "object" || Array.isArray(context) ||
        Reflect.ownKeys(context).sort().join(",") !== "configSha256,identity") throw Error();
    const descriptors = Object.getOwnPropertyDescriptors(context);
    if (!["identity", "configSha256"].every((key) => Object.hasOwn(descriptors[key] ?? {}, "value"))) throw Error();
    const identity = captureContainerRecoveryIdentity(descriptors.identity.value);
    const configSha256 = descriptors.configSha256.value;
    if (!SHA.test(configSha256 ?? "") || identity.configSha256 !== configSha256) throw Error();
    recovery = Object.freeze({ identity, configSha256 });
  } catch { throw failure("CONTAINER_HOST_RECOVERY_INVALID"); }
  return containerDesktopService(options, dependencies, recovery);
}

async function containerDesktopService(options, dependencies, recovery) {
  const allowed = new Set([
    "imageDigest",
    "sourceRoot",
    "runtimeRoot",
    "bridgeRoot",
    "cpuId",
    "memoryLimitMiB",
    "pidsLimit",
    "historyRoot",
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
  const depAllowed = new Set([
    "openArchive",
    "startUpstream",
    "createBroker",
    "makePublisher",
  ]);
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !dependencies ||
    typeof dependencies !== "object" ||
    Array.isArray(dependencies) ||
    Object.keys(dependencies).some(
      (key) => !depAllowed.has(key) || typeof dependencies[key] !== "function",
    )
  )
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  const sharedProperty = Object.getOwnPropertyDescriptor(
    options,
    "sharedThread",
  );
  if (sharedProperty && !Object.hasOwn(sharedProperty, "value"))
    throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  const sharedThread = normalizeContainerSharedAuthority(sharedProperty?.value);
  if (sharedThread) throw failure("CONTAINER_SHARED_NOT_READY");
  const sourceProperty=Object.getOwnPropertyDescriptor(options,"sharedDesktopSource");
  if(sourceProperty&&!Object.hasOwn(sourceProperty,"value"))throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  const sharedDesktopSource=sourceProperty?.value;
  if(sharedDesktopSource!==undefined&&(typeof ownedSharedDesktop.isOwnedSharedDesktopSourceFactory!=="function"||ownedSharedDesktop.isOwnedSharedDesktopSourceFactory(sharedDesktopSource)!==true))
    throw failure("CONTAINER_SHARED_INVALID_CONFIG");
  if(recovery&&sharedDesktopSource!==undefined)throw failure("CONTAINER_SHARED_RECOVERY_UNAVAILABLE");
  const serverSsh = containerServerSshOption(options);
  if (serverSsh && recovery)
    throw failure("CONTAINER_HOST_INVALID_CONFIG");

  const memoryProperty = Object.getOwnPropertyDescriptor(
    options,
    "memoryLimitMiB",
  );
  const pidsProperty = Object.getOwnPropertyDescriptor(options, "pidsLimit");
  const historyProperty = Object.getOwnPropertyDescriptor(
    options,
    "historyRoot",
  );
  let historyRoot;
  let memoryLimitMiB, pidsLimit;
  try {
    if (memoryProperty && !Object.hasOwn(memoryProperty, "value"))
      throw Error();
    memoryLimitMiB = normalizeContainerMemoryLimitMiB(memoryProperty?.value);
    if (pidsProperty && !Object.hasOwn(pidsProperty, "value")) throw Error();
    pidsLimit = normalizeContainerPidsLimit(pidsProperty?.value);
    if (historyProperty && !Object.hasOwn(historyProperty, "value"))
      throw Error();
    historyRoot = normalizePersistentHistoryRoot(historyProperty?.value);
  } catch {
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  }
  const {
    imageDigest,
    sourceRoot,
    runtimeRoot,
    bridgeRoot,
    cpuId,
    macAsarPath,
    macAsarSha256,
    profileFile,
    controlSocketPath,
    dockerPath,
    dockerSha256,
    pythonPath,
    pythonSha256,
    nodePath,
    nodeSha256,
    startupTimeoutMs,
    networkMode = "none",
  } = options;
  let accountSnapshot;
  try {
    accountSnapshot = normalizeContainerAccountSnapshot(
      options.accountSnapshot,
    );
  } catch {
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  }
  if(sharedDesktopSource&&accountSnapshot&&historyRoot===undefined)throw failure("CONTAINER_SHARED_IDENTITY_UNAVAILABLE");
  const rootsProperty = Object.getOwnPropertyDescriptor(
    options,
    "projectRoots",
  );
  let projectRoots;
  try {
    if (rootsProperty && !Object.hasOwn(rootsProperty, "value")) throw Error();
    projectRoots = normalizeProjectRoots(rootsProperty?.value);
  } catch {
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  }
  const modeProperty = Object.getOwnPropertyDescriptor(options, "initialMode");
  if (
    modeProperty &&
    (!Object.hasOwn(modeProperty, "value") ||
      (modeProperty.value !== undefined && modeProperty.value !== "codex"))
  )
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  const initialMode = modeProperty?.value;
  const connectionProperty = Object.getOwnPropertyDescriptor(
    options,
    "connection",
  );
  let connection;
  try {
    if (connectionProperty && !Object.hasOwn(connectionProperty, "value"))
      throw Error();
    connection = normalizeDesktopConnection(connectionProperty?.value);
  } catch {
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  }
  const openArchive = dependencies.openArchive ?? openWebviewArchive,
    startUpstream = dependencies.startUpstream ?? (recovery ? reattachContainerDesktopUpstream : startContainerDesktopUpstream),
    createBroker = dependencies.createBroker ?? createDesktopControlService,
    makePublisher = dependencies.makePublisher ?? createProfilePublisher;
  const uid = process.getuid?.(),
    paths = [
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      macAsarPath,
      profileFile,
      controlSocketPath,
      ...(accountSnapshot
        ? [accountSnapshot.sourceFile, accountSnapshot.homeRoot]
        : []),
    ];
  if (
    uid === undefined ||
    !["none", "bridge"].includes(networkMode) ||
    (accountSnapshot !== undefined && networkMode !== "bridge") ||
    (connection !== undefined && networkMode !== "bridge") ||
    paths.some((value) => !pathOK(value)) ||
    !SHA.test(macAsarSha256 ?? "")
  )
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (contains(paths[i], paths[j]) || contains(paths[j], paths[i]))
        throw failure("CONTAINER_HOST_UNSAFE_PATH");
  const ownSource = dirname(fileURLToPath(import.meta.url));
  const projectProtected = [
    ...paths,
    dockerPath,
    pythonPath,
    nodePath,
    ownSource,
    ...(accountSnapshot ? [dirname(accountSnapshot.sourceFile)] : []),
  ];
  if (
    historyRoot !== undefined &&
    [...projectProtected, ...projectRoots].some(
      (path) => contains(historyRoot, path) || contains(path, historyRoot),
    )
  )
    throw failure("CONTAINER_HOST_UNSAFE_PATH");
  if (historyRoot !== undefined) projectProtected.push(historyRoot);
  if (projectRoots.length && projectProtected.some((path) => !pathOK(path)))
    throw failure("CONTAINER_HOST_INVALID_CONFIG");
  if (
    projectRoots.some((root) =>
      projectProtected.some(
        (path) => contains(root, path) || contains(path, root),
      ),
    )
  )
    throw failure("CONTAINER_HOST_UNSAFE_PATH");
  const profileId = recovery?.identity.profileId ?? randomUUID(),
    generation = recovery?.identity.generation ?? randomUUID();
  let container,
    broker,
    publisher,
    macIdentity,
    projectAuthority,
    unsubscribe = () => {},
    phase = "preparing",
    compromised = false,
    retirePromise;
  const activationWaiters = new Set();
  function settleActivation(error) {
    for (const complete of activationWaiters) complete(error);
  }
  function waitForActivation(control) {
    assertContainerWriteAuthority(control);
    if (phase === "active") return Promise.resolve();
    if (phase !== "preparing")
      return Promise.reject(failure("CONTAINER_HOST_IDENTITY_CHANGED"));
    return new Promise((resolveWait, rejectWait) => {
      let timer,
        settled = false;
      const onAbort = () => complete(failure("CONTAINER_WRITE_ABORTED"));
      const complete = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        control.signal.removeEventListener("abort", onAbort);
        activationWaiters.delete(complete);
        if (error) return rejectWait(error);
        try {
          assertContainerWriteAuthority(control);
          resolveWait();
        } catch (cause) {
          rejectWait(cause);
        }
      };
      const left = control.deadline - performance.now();
      if (left <= 0) return onAbort();
      timer = setTimeout(onAbort, Math.min(Math.ceil(left), 0x7fffffff));
      activationWaiters.add(complete);
      control.signal.addEventListener("abort", onAbort, { once: true });
      if (control.signal.aborted) return onAbort();
    });
  }
  const verifyHostAuthority = async () => {
    try {
      if (compromised || !container || !macIdentity) return false;
      if (projectAuthority && !projectAuthority.verifySync()) return false;
      const currentMac = lstatSync(macAsarPath, { bigint: true });
      if (
        !currentMac.isFile() ||
        !same(macIdentity, currentMac) ||
        realpathSync(macAsarPath) !== macAsarPath
      )
        return false;
      if (phase === "active") {
        const verified = publisher?.published && (await publisher.verify());
        if (!verified && phase !== "retiring") return false;
      }
      return !compromised;
    } catch {
      return false;
    }
  };
  const guard = async () => {
    try {
      if (compromised || !container || !(await container.verifyIdentity()))
        return false;
      return verifyHostAuthority();
    } catch {
      return false;
    }
  };
  const brokerVerify = async () => {
    const valid = await guard();
    if (!valid) invalidate();
    return valid;
  };
  function retire() {
    if (retirePromise) return retirePromise;
    phase = "retiring";
    settleActivation(failure("CONTAINER_HOST_IDENTITY_CHANGED"));
    retirePromise = (async () => {
      let revokeError, brokerError, detachError;
      try {
        await publisher?.revoke();
      } catch {
        revokeError = failure("CONTAINER_HOST_REVOCATION_FAILED");
      }
      try {
        await broker?.close();
      } catch {
        brokerError = failure("CONTAINER_HOST_BROKER_CLOSE_FAILED");
      }
      try {
        await container?.disconnectTransport();
      } catch (error) {
        detachError = detachFailure(error);
      }
      await projectAuthority?.close();
      if (revokeError) throw revokeError;
      if (brokerError) throw brokerError;
      if (detachError) throw detachError;
      unsubscribe();
    })();
    void retirePromise.catch(() => {
      retirePromise = undefined;
    });
    return retirePromise;
  }
  function invalidate() {
    compromised = true;
    void retire().catch(() => {});
  }
  async function sendBatch(entries) {
    const fixed = snapshotContainerWriteBatch(entries);
    let viewId, firstSequence;
    const total = fixed.reduce(
      (bytes, entry) => bytes + Buffer.byteLength(entry.encoded) + 1,
      0,
    );
    if (total > 8 * 1024 * 1024 + 1) throw failure("CONTAINER_HOST_QUEUE_FULL");
    for (let index = 0; index < fixed.length; index++) {
      const frame = decodeWireValue(fixed[index].encoded);
      if (index === 0) {
        viewId = frame?.scope?.viewId;
        firstSequence = frame?.seq;
      }
      if (
        !frame ||
        frame.v !== 1 ||
        !["call", "openPort", "portPost", "closePort"].includes(frame.type) ||
        !frame.scope ||
        Object.keys(frame.scope).length !== 3 ||
        frame.scope.profileId !== profileId ||
        frame.scope.generation !== generation ||
        !UUID.test(viewId ?? "") ||
        frame.scope.viewId !== viewId ||
        !Number.isSafeInteger(firstSequence) ||
        firstSequence < 1 ||
        frame.seq !== firstSequence + index
      )
        throw failure("CONTAINER_HOST_INVALID_FRAME");
    }
    if (phase === "preparing")
      await waitForActivation(
        fixed.reduce((earliest, entry) =>
          entry.deadline < earliest.deadline ? entry : earliest,
        ),
      );
    for (const entry of fixed) assertContainerWriteAuthority(entry);
    // The supporting native batch performs its own fresh, complete identity
    // check immediately before its actual writes. Check host-only authority
    // here instead of performing that native check twice in serial.
    if (phase !== "active" || !(await verifyHostAuthority())) {
      invalidate();
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    }
    for (const entry of fixed) assertContainerWriteAuthority(entry);
    if (compromised || phase !== "active")
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    await container.upstream.sendBatch(
      fixed.map((entry) => ({
        ...entry,
        onDispatch() {
          assertContainerWriteAuthority(entry);
          if (compromised || phase !== "active")
            throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
          entry.onDispatch();
          assertContainerWriteAuthority(entry);
          if (
            compromised ||
            phase !== "active" ||
            (projectAuthority && !projectAuthority.verifySync())
          )
            throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
        },
      })),
    );
  }
  const upstream = {
    explicitDispatch: true,
    async send(encoded, control) {
      assertContainerWriteAuthority(control);
      const frame = decodeWireValue(encoded);
      if (phase === "preparing") await waitForActivation(control);
      assertContainerWriteAuthority(control);
      if (
        (phase !== "active" &&
          !(phase === "retiring" && frame?.type === "destroyView")) ||
        !(await brokerVerify())
      )
        throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
      assertContainerWriteAuthority(control);
      if (
        compromised ||
        (phase !== "active" &&
          !(phase === "retiring" && frame?.type === "destroyView"))
      )
        throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
      await container.upstream.send(encoded, control);
    },
    subscribe(fn) {
      return container.upstream.subscribe(fn);
    },
  };
  try {
    if (projectRoots.length)
      projectAuthority = await prepareFixedProjectMounts({
        projectRoots,
        protectedPaths: {
          homes: [
            ...new Set([
              join(runtimeRoot, "home"),
              ...(accountSnapshot
                ? [
                    accountSnapshot.homeRoot,
                    dirname(accountSnapshot.sourceFile),
                  ]
                : []),
            ]),
          ],
          auth: accountSnapshot ? [accountSnapshot.sourceFile] : [],
          runtime: [runtimeRoot],
          control: [profileFile, controlSocketPath],
          bridge: [bridgeRoot],
          source: [sourceRoot, macAsarPath, ownSource],
          tools: [dockerPath, pythonPath, nodePath],
        },
      });
    await Promise.all([
      privateParent(profileFile, uid),
      privateParent(controlSocketPath, uid),
    ]);
    if ((await realpath(macAsarPath)) !== macAsarPath)
      throw failure("CONTAINER_HOST_UNSAFE_PATH");
    const before = await lstat(macAsarPath, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(uid) || before.mode & 0o022n)
      throw failure("CONTAINER_HOST_UNSAFE_PATH");
    const archive = await openArchive({
      asarPath: macAsarPath,
      sha256: macAsarSha256,
    });
    await archive.close();
    if (!same(before, await lstat(macAsarPath, { bigint: true })))
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    macIdentity = before;
    const startTicks = await managerTicks();
    container = await startUpstream({
      imageDigest,
      sourceRoot,
      runtimeRoot,
      bridgeRoot,
      profileId,
      generation,
      cpuId,
      memoryLimitMiB,
      pidsLimit,
      ...(historyRoot === undefined ? {} : { historyRoot }),
      dockerPath,
      dockerSha256,
      pythonPath,
      pythonSha256,
      nodePath,
      nodeSha256,
      networkMode,
      ...(accountSnapshot ? { accountSnapshot } : {}),
      ...(initialMode === undefined ? {} : { initialMode }),
      ...(connection === undefined ? {} : { connection }),
      ...(projectRoots.length ? { projectRoots } : {}),
      ...(sharedDesktopSource===undefined?{}:{sharedDesktopSource}),
      ...(serverSsh?{serverSsh:true}:{}),
      ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
    }, ...(recovery ? [recovery] : []));
    if (recovery && container.containerId !== recovery.identity.containerId)
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    if (typeof container.upstream.sendBatch === "function")
      Object.defineProperty(upstream, "sendBatch", {
        value: sendBatch,
        enumerable: true,
      });
    unsubscribe = container.onUnavailable(invalidate);
    if (phase !== "preparing" || !(await guard()))
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    broker = await createBroker({
      socketPath: controlSocketPath,
      profileId,
      generation,
      pid: process.pid,
      startTicks,
      upstream,
      verifyIdentity: brokerVerify,
      getProjectPersistenceStatus: () => container.projectPersistenceStatus?.() ?? "unknown",
    });
    if (phase !== "preparing" || !(await guard()))
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    const profile = {
      version: 1,
      id: profileId,
      generation,
      pid: process.pid,
      startTicks,
      uid,
      macAsarPath,
      macAsarSha256,
      linuxAsarPath: join(sourceRoot, "resources", "app.asar"),
      linuxAsarSha256: PINNED_LINUX_RUNTIME.asarSha256,
      controlSocketPath,
      ...(serverSsh ? {serverSshSocketPath:join(bridgeRoot,"server-ssh.sock")} : {}),
    };
    const fixedSshProfile = () => {
      const field = Object.getOwnPropertyDescriptor(profile,"serverSshSocketPath");
      return serverSsh ? !!field && Object.hasOwn(field,"value") && field.value === join(bridgeRoot,"server-ssh.sock") : field === undefined;
    };
    publisher = makePublisher(
      { profileFile, profile },
      { beforeLink: async () => fixedSshProfile() && phase === "preparing" && (await guard()) },
    );
    await publisher.publish();
    if (
      phase !== "preparing" ||
      !fixedSshProfile() ||
      !(await publisher.verify()) ||
      !(await guard())
    )
      throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
    phase = "active";
    settleActivation();
    const result = {
      profileId,
      generation,
      nativeExited: container.nativeExited,
      close: retire,
    };
    Object.defineProperty(result, "containerId", {
      value: container.containerId,
    });
    if (typeof container.captureRecoveryIdentity === "function") {
      Object.defineProperty(result, "captureRecoveryIdentity", {
        value: async (options) => {
          if (!(await guard())) throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
          const witness = await container.captureRecoveryIdentity(options);
          if (!(await guard()) || witness.containerId !== container.containerId ||
              witness.profileId !== profileId || witness.generation !== generation)
            throw failure("CONTAINER_HOST_IDENTITY_CHANGED");
          return witness;
        },
      });
    }
    return Object.freeze(result);
  } catch (error) {
    await retire().catch(() => {});
    // An unavailable event may have retired before broker/publisher assignment.
    let revokeFailed = false;
    try {
      await publisher?.revoke();
    } catch {
      revokeFailed = true;
    }
    try {
      await broker?.close();
    } catch {}
    const result = failure(
      revokeFailed
        ? "CONTAINER_HOST_REVOCATION_FAILED"
        : typeof error?.code === "string" &&
            (/^(?:CONTAINER|PROFILE)_[A-Z_]+$/.test(error.code) ||
              isAccountSnapshotErrorCode(error.code))
          ? error.code
          : "CONTAINER_HOST_UNAVAILABLE",
    );
    Object.defineProperty(result, "cause", {
      value: error,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    const retained = container
      ? {
          profileId,
          generation,
          containerId: container.containerId,
          nativeExited: container.nativeExited,
          close: retire,
        }
      : error?.retainedOwner;
    if (retained)
      Object.defineProperty(result, "retainedOwner", {
        value: Object.freeze(retained),
      });
    throw result;
  }
}
