import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { openWebviewArchive } from "./assets.mjs";
import { createDesktopControlService } from "./control-service.mjs";
import { createProfilePublisher } from "./profile-publisher.mjs";
import {
  PINNED_LINUX_RUNTIME,
  preparePrivateRuntime,
} from "./private-runtime.mjs";
import { decodeWireValue } from "./wire-value.mjs";

const SHA = /^[a-f0-9]{64}$/;
const TICKS = /^(?:0|[1-9][0-9]{0,29})$/;
const LIVE = /^[RSDTtWPKI]$/;
const ERROR_CODES = new Set([
  "HOST_INVALID_CONFIG",
  "HOST_UNSAFE_PATH",
  "HOST_PATH_EXISTS",
  "HOST_INVALID_ENV",
  "HOST_IDENTITY_CHANGED",
  "HOST_REVOCATION_FAILED",
  "HOST_BROKER_CLOSE_FAILED",
  "HOST_INVALID_RUNTIME",
  "HOST_LAUNCH_FAILED",
  "HOST_READY_TIMEOUT",
  "HOST_PUBLICATION_OUTCOME_UNKNOWN",
  "HOST_IPC_UNAVAILABLE",
]);
const PROFILE_ERROR_CODES = new Map([
  ["PROFILE_INVALID_CONFIG", "HOST_INVALID_CONFIG"],
  ["PROFILE_UNSAFE_PATH", "HOST_UNSAFE_PATH"],
  ["PROFILE_PATH_EXISTS", "HOST_PATH_EXISTS"],
  ["PROFILE_IDENTITY_CHANGED", "HOST_IDENTITY_CHANGED"],
  ["PROFILE_RETIRED", "HOST_IDENTITY_CHANGED"],
  ["PROFILE_PUBLICATION_OUTCOME_UNKNOWN", "HOST_PUBLICATION_OUTCOME_UNKNOWN"],
  ["PROFILE_REVOCATION_FAILED", "HOST_REVOCATION_FAILED"],
]);
const failure = (code) =>
  Object.assign(new Error("Private desktop host unavailable"), { code });
const canonical = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  value.length <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[\x00-\x1f\x7f]/.test(value);
const contains = (parent, child) => {
  const suffix = relative(parent, child);
  return (
    !suffix ||
    (suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix))
  );
};
const sameDir = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid"].every((key) => a[key] === b[key]);
const sameFile = (a, b) =>
  sameDir(a, b) &&
  ["size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
const sameInode = (a, b) =>
  a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
const exact = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
// Even if startup fails after a possible publication, keep tracking the owned
// native child until its real exit. Never infer that closing the broker ended it.
const retainedChildren = new Set();

async function inspectLinuxProcess(pid) {
  const dir = `/proc/${pid}`;
  const before = await lstat(dir, { bigint: true });
  const parse = (text) => {
    const start = text.indexOf(" ("),
      end = text.lastIndexOf(") ");
    if (start < 1 || end < start || text.slice(0, start) !== String(pid))
      throw failure("HOST_IDENTITY_CHANGED");
    const fields = text
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    if (!LIVE.test(fields[0] ?? "") || !TICKS.test(fields[19] ?? ""))
      throw failure("HOST_IDENTITY_CHANGED");
    return { state: fields[0], startTicks: fields[19] };
  };
  const first = parse(await readFile(join(dir, "stat"), "utf8"));
  const second = parse(await readFile(join(dir, "stat"), "utf8"));
  const after = await lstat(dir, { bigint: true });
  if (
    !before.isDirectory() ||
    !sameDir(before, after) ||
    first.startTicks !== second.startTicks
  )
    throw failure("HOST_IDENTITY_CHANGED");
  return {
    uid: Number(after.uid),
    startTicks: second.startTicks,
    state: second.state,
  };
}
async function ownedDirectory(path, uid, privateMode = false) {
  if ((await realpath(path)) !== path) throw failure("HOST_UNSAFE_PATH");
  const info = await lstat(path, { bigint: true });
  if (
    !info.isDirectory() ||
    info.uid !== BigInt(uid) ||
    (privateMode
      ? (info.mode & 0o7777n) !== 0o700n
      : Boolean(info.mode & 0o022n))
  )
    throw failure("HOST_UNSAFE_PATH");
  return info;
}
async function ownedFile(path, uid) {
  if ((await realpath(path)) !== path) throw failure("HOST_UNSAFE_PATH");
  const info = await lstat(path, { bigint: true });
  if (!info.isFile() || info.uid !== BigInt(uid) || info.mode & 0o022n)
    throw failure("HOST_UNSAFE_PATH");
  return info;
}
async function absent(path) {
  try {
    await lstat(path);
    throw failure("HOST_PATH_EXISTS");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
function validProcess(value, uid) {
  return (
    value &&
    value.uid === uid &&
    typeof value.startTicks === "string" &&
    TICKS.test(value.startTicks) &&
    LIVE.test(value.state ?? "")
  );
}
function safeText(value, max = 256) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}
function cleanPath() {
  const parts = (process.env.PATH ?? "")
    .split(":")
    .filter(
      (part) => part && isAbsolute(part) && !/[\x00-\x1f\x7f]/.test(part),
    );
  if (!parts.length) throw failure("HOST_INVALID_ENV");
  return parts.join(":");
}
function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure(code)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Start one explicitly configured private host. Never called by the default dev launcher. */
export async function startPrivateDesktopService(options = {}) {
  const allowed = new Set([
    "sourceRoot",
    "macAsarPath",
    "macAsarSha256",
    "runtimeRoot",
    "controlSocketPath",
    "profileFile",
    "display",
    "xauthority",
    "lang",
    "nodeUseEnvProxy",
    "prepare",
    "spawn",
    "inspectProcess",
    "startupTimeoutMs",
  ]);
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowed.has(key))
  )
    throw failure("HOST_INVALID_CONFIG");
  const {
    sourceRoot,
    macAsarPath,
    macAsarSha256,
    runtimeRoot,
    controlSocketPath,
    profileFile,
    display,
    xauthority,
    lang,
    nodeUseEnvProxy,
    prepare = preparePrivateRuntime,
    spawn = spawnChild,
    inspectProcess = inspectLinuxProcess,
    startupTimeoutMs = 30000,
  } = options;
  const uid = process.getuid?.();
  const paths = [
    sourceRoot,
    macAsarPath,
    runtimeRoot,
    controlSocketPath,
    profileFile,
  ];
  if (
    uid === undefined ||
    paths.some((path) => !canonical(path)) ||
    !SHA.test(macAsarSha256 ?? "") ||
    typeof prepare !== "function" ||
    typeof spawn !== "function" ||
    typeof inspectProcess !== "function" ||
    !Number.isSafeInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1 ||
    startupTimeoutMs > 120000 ||
    (display !== undefined && !safeText(display)) ||
    (xauthority !== undefined && !canonical(xauthority)) ||
    (lang !== undefined &&
      (!safeText(lang, 128) || !/^[A-Za-z0-9_.@-]+$/.test(lang))) ||
    (nodeUseEnvProxy !== undefined &&
      nodeUseEnvProxy !== "0" &&
      nodeUseEnvProxy !== "1")
  )
    throw failure("HOST_INVALID_CONFIG");
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++)
      if (contains(paths[i], paths[j]) || contains(paths[j], paths[i]))
        throw failure("HOST_UNSAFE_PATH");
  if (
    Buffer.byteLength(join(runtimeRoot, "home", ".codex", "ipc", "ipc.sock")) >
      107 ||
    Buffer.byteLength(
      join(dirname(controlSocketPath), ".desktop-control-XXXXXX", "s"),
    ) > 107
  )
    throw failure("HOST_INVALID_CONFIG");

  const profileId = randomUUID(),
    generation = randomUUID();
  let child,
    broker,
    publisher,
    retired = false,
    compromised = false;
  let nativeIdentity, managerIdentity, socketIdentity, snapshots;
  let readyResolve,
    readyReject,
    readySeen = false,
    childExited = false,
    exitResolve,
    retiredPromise,
    monitorAttached = false;
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  // A failure can arrive before the start routine begins awaiting it.
  ready.catch(() => {});
  const nativeExited = new Promise((resolveExit) => {
    exitResolve = resolveExit;
  });
  const listeners = new Set();
  let publicationStatus;
  const publicationWaiters = new Set();
  function settlePublication(ready) {
    if (publicationStatus !== undefined) return;
    publicationStatus = ready;
    for (const finish of publicationWaiters) finish(ready);
  }
  async function waitForPublication(signal, deadline) {
    if (signal.aborted || performance.now() >= deadline)
      throw failure("HOST_IDENTITY_CHANGED");
    const ready = await new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", abort);
        publicationWaiters.delete(finish);
        resolve(value);
      };
      const abort = () => finish(false);
      signal.addEventListener("abort", abort, { once: true });
      publicationWaiters.add(finish);
      if (publicationStatus !== undefined) finish(publicationStatus);
      if (signal.aborted || performance.now() >= deadline) abort();
    });
    if (!ready || signal.aborted || performance.now() >= deadline)
      throw failure("HOST_IDENTITY_CHANGED");
  }

  function retire() {
    if (retiredPromise) return retiredPromise;
    retired = true;
    settlePublication(false);
    retiredPromise = (async () => {
      let revokeError, closeError;
      try {
        await publisher?.revoke();
      } catch (error) {
        revokeError = failure("HOST_REVOCATION_FAILED");
      }
      try {
        await broker?.close();
      } catch {
        closeError = failure("HOST_BROKER_CLOSE_FAILED");
      }
      if (revokeError) throw revokeError;
      if (closeError) throw closeError;
    })();
    void retiredPromise.catch(() => {
      retiredPromise = undefined;
    });
    return retiredPromise;
  }
  function invalidate() {
    compromised = true;
    readyReject(failure("HOST_IDENTITY_CHANGED"));
    void retire().catch(() => {});
  }
  async function checkIdentity() {
    try {
      if (compromised || !child || childExited || !child.connected)
        return false;
      const [manager, native] = await Promise.all([
        inspectProcess(process.pid),
        inspectProcess(child.pid),
      ]);
      if (
        !validProcess(manager, uid) ||
        !validProcess(native, uid) ||
        manager.startTicks !== managerIdentity.startTicks ||
        native.startTicks !== nativeIdentity.startTicks ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        return false;
      if (snapshots) {
        for (const entry of snapshots) {
          const current = await lstat(entry.path, { bigint: true });
          if (
            !(entry.directory
              ? current.isDirectory() && sameDir(entry.info, current)
              : current.isFile() && sameFile(entry.info, current))
          )
            return false;
        }
      }
      if (socketIdentity) {
        const socket = await lstat(controlSocketPath, { bigint: true });
        if (!socket.isSocket() || !sameInode(socketIdentity, socket))
          return false;
      }
      if (publisher?.published && !retired) {
        const verified = await publisher.verify();
        // Explicit retirement revokes publication before draining owned views.
        // A verification already in flight must not mistake that revocation
        // for a changed native identity and reject the cleanup acknowledgement.
        if (!verified && !retired) return false;
      }
      return (
        !compromised &&
        !childExited &&
        child.connected &&
        child.exitCode === null &&
        child.signalCode === null
      );
    } catch {
      return false;
    }
  }
  async function verifyIdentity() {
    const valid = await checkIdentity();
    if (!valid) invalidate();
    return valid;
  }
  const upstream = {
    explicitDispatch: true,
    async send(encoded, { signal, deadline, onDispatch }) {
      const frame = decodeWireValue(encoded);
      if (frame.type !== "destroyView")
        await waitForPublication(signal, deadline);
      if (!(await verifyIdentity())) throw failure("HOST_IDENTITY_CHANGED");
      if (
        signal.aborted ||
        performance.now() >= deadline ||
        compromised ||
        !child.connected ||
        ((!publisher?.published || retired) && frame.type !== "destroyView")
      )
        throw failure("HOST_IDENTITY_CHANGED");
      await new Promise((resolveSend, rejectSend) => {
        try {
          // No asynchronous boundary between the final caller-owned deadline
          // check, dispatch receipt and the actual IPC write.
          onDispatch();
          child.send(encoded, (error) =>
            error ? rejectSend(failure("HOST_IPC_UNAVAILABLE")) : resolveSend(),
          );
        } catch {
          rejectSend(failure("HOST_IPC_UNAVAILABLE"));
        }
      });
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  };

  try {
    await Promise.all([
      ownedDirectory(sourceRoot, uid),
      ownedDirectory(join(sourceRoot, "resources"), uid),
      ownedDirectory(dirname(runtimeRoot), uid, true),
      ownedDirectory(dirname(controlSocketPath), uid, true),
      ownedDirectory(dirname(profileFile), uid, true),
      absent(runtimeRoot),
      absent(controlSocketPath),
      absent(profileFile),
    ]);
    if (xauthority !== undefined) await ownedFile(xauthority, uid);
    const sourceBinary = join(sourceRoot, "ChatGPT"),
      sourceAsar = join(sourceRoot, "resources", "app.asar");
    const [beforeMac, beforeBinary, beforeAsar] = await Promise.all([
      ownedFile(macAsarPath, uid),
      ownedFile(sourceBinary, uid),
      ownedFile(sourceAsar, uid),
    ]);
    const archive = await openWebviewArchive({
      asarPath: macAsarPath,
      sha256: macAsarSha256,
    });
    await archive.close();
    if (!sameFile(beforeMac, await ownedFile(macAsarPath, uid)))
      throw failure("HOST_IDENTITY_CHANGED");
    const prepared = await prepare({
      sourceRoot,
      runtimeRoot,
      profileId,
      generation,
    });
    const home = join(runtimeRoot, "home"),
      executable = join(runtimeRoot, "ChatGPT"),
      configPath = join(runtimeRoot, "resources", "private-config.json");
    if (
      !prepared ||
      prepared.executable !== executable ||
      prepared.home !== home ||
      prepared.configPath !== configPath ||
      prepared.profileId !== profileId ||
      prepared.generation !== generation ||
      !Array.isArray(prepared.args) ||
      prepared.args.length !== 1 ||
      prepared.args[0] !== "--user-data-dir=" + join(home, "user-data") ||
      !exact(prepared.env, ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) ||
      prepared.env.HOME !== home ||
      prepared.env.XDG_CONFIG_HOME !== join(home, ".config") ||
      prepared.env.XDG_CACHE_HOME !== join(home, ".cache")
    )
      throw failure("HOST_INVALID_RUNTIME");
    if (
      !sameFile(beforeBinary, await ownedFile(sourceBinary, uid)) ||
      !sameFile(beforeAsar, await ownedFile(sourceAsar, uid)) ||
      !sameFile(beforeMac, await ownedFile(macAsarPath, uid))
    )
      throw failure("HOST_IDENTITY_CHANGED");
    const directoryPaths = [
      sourceRoot,
      join(sourceRoot, "resources"),
      dirname(runtimeRoot),
      dirname(controlSocketPath),
      dirname(profileFile),
      runtimeRoot,
      join(runtimeRoot, "resources"),
      home,
    ];
    const filePaths = [
      macAsarPath,
      sourceBinary,
      sourceAsar,
      executable,
      join(runtimeRoot, "resources", "app.asar"),
      join(runtimeRoot, "resources", "private-preload.js"),
      configPath,
    ];
    snapshots = [];
    for (const path of [...new Set(directoryPaths)])
      snapshots.push({
        path,
        directory: true,
        info: await ownedDirectory(
          path,
          uid,
          [
            dirname(runtimeRoot),
            dirname(controlSocketPath),
            dirname(profileFile),
            runtimeRoot,
            join(runtimeRoot, "resources"),
            home,
          ].includes(path),
        ),
      });
    for (const path of filePaths)
      snapshots.push({
        path,
        directory: false,
        info: await ownedFile(path, uid),
      });
    managerIdentity = await inspectProcess(process.pid);
    if (!validProcess(managerIdentity, uid))
      throw failure("HOST_IDENTITY_CHANGED");
    const env = { ...prepared.env, PATH: cleanPath() };
    if (display !== undefined) env.DISPLAY = display;
    if (xauthority !== undefined) env.XAUTHORITY = xauthority;
    if (lang !== undefined) env.LANG = lang;
    if (nodeUseEnvProxy !== undefined) env.NODE_USE_ENV_PROXY = nodeUseEnvProxy;
    child = spawn(executable, [...prepared.args], {
      cwd: runtimeRoot,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    if (child && typeof child.on === "function") child.on("error", invalidate);
    if (
      !child ||
      !Number.isSafeInteger(child.pid) ||
      child.pid <= 1 ||
      child.pid === process.pid ||
      typeof child.on !== "function" ||
      typeof child.send !== "function" ||
      typeof child.kill !== "function"
    )
      throw failure("HOST_LAUNCH_FAILED");
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("error", invalidate);
      stream?.resume();
    }
    child.on("disconnect", () => {
      if (!childExited) invalidate();
    });
    child.on("exit", () => {
      childExited = true;
      exitResolve(Object.freeze({ state: "exited" }));
      invalidate();
    });
    monitorAttached = true;
    const owned = { child, nativeExited };
    retainedChildren.add(owned);
    void nativeExited.then(() => retainedChildren.delete(owned));
    child.on("message", (encoded, handle) => {
      try {
        if (
          handle ||
          typeof encoded !== "string" ||
          Buffer.byteLength(encoded) > 8 * 1024 * 1024
        )
          throw Error();
        const frame = decodeWireValue(encoded);
        if (!readySeen) {
          if (
            !exact(frame, ["v", "type", "profileId", "generation", "pid"]) ||
            frame.v !== 1 ||
            frame.type !== "ready" ||
            frame.profileId !== profileId ||
            frame.generation !== generation ||
            frame.pid !== child.pid
          )
            throw Error();
          readySeen = true;
          readyResolve();
          return;
        }
        if (
          !frame ||
          frame.v !== 1 ||
          frame.type === "ready" ||
          frame.type === "fatal" ||
          listeners.size === 0
        )
          throw Error();
        for (const listener of listeners) listener(encoded);
      } catch {
        invalidate();
      }
    });
    nativeIdentity = await inspectProcess(child.pid);
    if (!validProcess(nativeIdentity, uid))
      throw failure("HOST_IDENTITY_CHANGED");
    await withTimeout(ready, startupTimeoutMs, "HOST_READY_TIMEOUT");
    if (!(await verifyIdentity())) throw failure("HOST_IDENTITY_CHANGED");
    broker = await createDesktopControlService({
      socketPath: controlSocketPath,
      profileId,
      generation,
      pid: process.pid,
      startTicks: managerIdentity.startTicks,
      upstream,
      verifyIdentity,
    });
    socketIdentity = await lstat(controlSocketPath, { bigint: true });
    if (
      !socketIdentity.isSocket() ||
      socketIdentity.uid !== BigInt(uid) ||
      (socketIdentity.mode & 0o7777n) !== 0o600n ||
      !(await verifyIdentity())
    )
      throw failure("HOST_IDENTITY_CHANGED");
    const profile = {
      version: 1,
      id: profileId,
      generation,
      pid: process.pid,
      startTicks: managerIdentity.startTicks,
      uid,
      macAsarPath,
      macAsarSha256,
      linuxAsarPath: sourceAsar,
      linuxAsarSha256: PINNED_LINUX_RUNTIME.asarSha256,
      controlSocketPath,
    };
    if (retired || compromised) throw failure("HOST_IDENTITY_CHANGED");
    publisher = createProfilePublisher(
      { profileFile, profile },
      { beforeLink: verifyIdentity },
    );
    await publisher.publish();
    if (retired || compromised) throw failure("HOST_IDENTITY_CHANGED");
    if (!(await verifyIdentity())) throw failure("HOST_IDENTITY_CHANGED");
    if (retired || compromised) throw failure("HOST_IDENTITY_CHANGED");
    settlePublication(true);
    return Object.freeze({
      profileId,
      generation,
      nativeExited,
      close: retire,
    });
  } catch (error) {
    let retirementError;
    try {
      await retire();
    } catch (failureValue) {
      retirementError = failureValue;
    }
    // Before publication no createView can pass the upstream gate. Only this
    // newly spawned child, with its original OS identity, may be terminated.
    if (
      !publisher?.mayHavePublished &&
      child &&
      nativeIdentity &&
      !childExited &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        const current = await inspectProcess(child.pid);
        if (
          validProcess(current, uid) &&
          current.startTicks === nativeIdentity.startTicks &&
          !childExited
        )
          child.kill("SIGTERM");
      } catch {}
    }
    const code =
      (retirementError?.code === "HOST_REVOCATION_FAILED"
        ? retirementError.code
        : undefined) ??
      PROFILE_ERROR_CODES.get(error?.code) ??
      (ERROR_CODES.has(error?.code) ? error.code : "HOST_UNAVAILABLE");
    const result = failure(code);
    if (monitorAttached && !childExited)
      Object.defineProperty(result, "retainedOwner", {
        value: Object.freeze({
          profileId,
          generation,
          nativeExited,
          close: retire,
        }),
      });
    throw result;
  }
}
