import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  statfs,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { normalizeProjectRoots } from "./fixed-project-mounts.mjs";
import { normalizePersistentHistoryRoot } from "./persistent-history.mjs";
import { normalizeDesktopConnection } from "./connection-policy.mjs";
import {
  normalizeContainerMemoryLimitMiB,
  normalizeContainerPidsLimit,
} from "./container-service.mjs";

const MAX = 16 * 1024;
const TMPFS = 0x01021994n;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const REQUIRED = [
  "imageDigest",
  "sourceRoot",
  "cpuId",
  "macAsarPath",
  "macAsarSha256",
  "dockerPath",
  "dockerSha256",
  "pythonPath",
  "pythonSha256",
  "nodePath",
  "nodeSha256",
  "networkMode",
  "projectRoots",
  "historyRoot",
  "accountSourceFile",
];
const OPTIONAL = [
  "memoryLimitMiB",
  "pidsLimit",
  "startupTimeoutMs",
  "initialMode",
  "connection",
  "accountSyncGrantFile",
];
const PATHS = [
  "sourceRoot",
  "macAsarPath",
  "dockerPath",
  "pythonPath",
  "nodePath",
  "historyRoot",
  "accountSourceFile",
];
const invalid = () =>
  Object.assign(new Error("Desktop supervisor configuration invalid"), {
    code: "DESKTOP_SUPERVISOR_INVALID_CONFIG",
  });
const unavailable = () =>
  Object.assign(new Error("Desktop supervisor configuration unavailable"), {
    code: "DESKTOP_SUPERVISOR_CONFIG_UNAVAILABLE",
  });
const canonical = (value) =>
  typeof value === "string" &&
  value.length > 1 &&
  Buffer.byteLength(value) <= 4096 &&
  isAbsolute(value) &&
  resolve(value) === value &&
  !/[,\x00-\x1f\x7f]/.test(value);
const object = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) =>
  object(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const sameDir = (a, b) =>
  ["dev", "ino", "mode", "uid", "gid"].every((key) => a[key] === b[key]);
const sameFile = (a, b) =>
  sameDir(a, b) &&
  ["size", "mtimeNs", "ctimeNs", "nlink"].every((key) => a[key] === b[key]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contains = (parent, child) => {
  const part = relative(parent, child);
  return (
    !part || (part !== ".." && !part.startsWith("../") && !isAbsolute(part))
  );
};
const overlaps = (a, b) => contains(a, b) || contains(b, a);

/** Validate all fixed Unix sockets before allocating any generation resources. */
export function validateDesktopSupervisorSocketPaths(input) {
  const keys = ["runtimeRoot", "bridgeRoot", "controlSocketPath"];
  if (
    !exact(input, keys) ||
    keys.some(
      (key) =>
        !Object.hasOwn(
          Object.getOwnPropertyDescriptor(input, key) ?? {},
          "value",
        ),
    ) ||
    keys.some((key) => !canonical(input[key]))
  )
    throw invalid();
  const { runtimeRoot, bridgeRoot, controlSocketPath } = input;
  const paths = [
    join(runtimeRoot, "home", ".codex", "ipc", "ipc.sock"),
    join(dirname(controlSocketPath), ".desktop-control-XXXXXX", "s"),
    join(bridgeRoot, "socket"),
    controlSocketPath,
  ];
  if (paths.some((path) => Buffer.byteLength(path, "utf8") > 107))
    throw invalid();
}

// Reject decoded duplicate keys, including escaped aliases, with ordinary
// whitespace allowed; JSON.parse still validates the grammar itself.
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
      if (top.keys.has(key)) throw invalid();
      top.keys.add(key);
      top.key = false;
    }
  }
  return value;
}

async function privateDirectory(path) {
  if (!canonical(path)) throw unavailable();
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat({ bigint: true });
    if (
      !info.isDirectory() ||
      info.uid !== BigInt(process.getuid()) ||
      (info.mode & 0o7777n) !== 0o700n ||
      (await realpath(path)) !== path ||
      !sameDir(info, await lstat(path, { bigint: true }))
    )
      throw unavailable();
    return { path, handle, info, fdPath: `/proc/self/fd/${handle.fd}` };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function verifyDirectory(entry) {
  return (
    (await realpath(entry.path)) === entry.path &&
    sameDir(entry.info, await entry.handle.stat({ bigint: true })) &&
    sameDir(entry.info, await lstat(entry.path, { bigint: true }))
  );
}
async function readTemplate(path) {
  if (!canonical(path)) throw invalid();
  const parent = await privateDirectory(dirname(path));
  let file;
  try {
    file = await open(
      join(parent.fdPath, basename(path)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      (before.mode & 0o7777n) !== 0o600n ||
      before.nlink !== 1n ||
      before.size > BigInt(MAX) ||
      (await realpath(path)) !== path ||
      !sameFile(before, await lstat(path, { bigint: true }))
    )
      throw unavailable();
    const buffer = Buffer.alloc(MAX + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (
      length > MAX ||
      !sameFile(before, await file.stat({ bigint: true })) ||
      !sameFile(before, await lstat(path, { bigint: true })) ||
      !(await verifyDirectory(parent))
    )
      throw unavailable();
    const bytes = buffer.subarray(0, length);
    let value;
    try {
      value = parseUnique(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw invalid();
    }
    return {
      value,
      fingerprint: digest(bytes),
      info: before,
      parentInfo: parent.info,
    };
  } finally {
    await file?.close();
    await parent.handle.close();
  }
}
async function accountSource(path) {
  const parent = await privateDirectory(dirname(path));
  let file;
  try {
    file = await open(
      join(parent.fdPath, basename(path)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await file.stat({ bigint: true });
    if (
      !info.isFile() ||
      info.uid !== BigInt(process.getuid()) ||
      (info.mode & 0o7777n) !== 0o600n ||
      info.nlink !== 1n ||
      info.size > 256n * 1024n ||
      (await realpath(path)) !== path ||
      !sameFile(info, await lstat(path, { bigint: true })) ||
      !(await verifyDirectory(parent))
    )
      throw unavailable();
    // Metadata only. The existing account-snapshot owner performs the only
    // credential read and remains responsible for its own authorization checks.
    return info;
  } finally {
    await file?.close();
    await parent.handle.close();
  }
}
async function accountSyncGrant(path) {
  const parent = await privateDirectory(dirname(path));
  const expected = Buffer.from("chatgpt-desktop-account-sync-v1\n");
  let file;
  try {
    file = await open(join(parent.fdPath, basename(path)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o600n || info.nlink !== 1n || info.size !== BigInt(expected.length) || (await realpath(path)) !== path || !sameFile(info, await lstat(path, { bigint: true }))) throw unavailable();
    const bytes = Buffer.alloc(expected.length + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== expected.length || !bytes.subarray(0, bytesRead).equals(expected) || !sameFile(info, await file.stat({ bigint: true })) || !sameFile(info, await lstat(path, { bigint: true })) || !(await verifyDirectory(parent))) throw unavailable();
    return { info, parentInfo: parent.info };
  } finally {
    await file?.close();
    await parent.handle.close();
  }
}
async function absent(path) {
  try {
    await lstat(path);
    throw unavailable();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
function validate(value) {
  if (
    !exact(value, ["version", "deploymentId", "deploymentRoot", "options"]) ||
    value.version !== 1 ||
    typeof value.deploymentId !== "string" ||
    !UUID.test(value.deploymentId) ||
    !canonical(value.deploymentRoot) ||
    !object(value.options)
  )
    throw invalid();
  const options = value.options;
  if (
    REQUIRED.some((key) => !Object.hasOwn(options, key)) ||
    Object.keys(options).some(
      (key) => !REQUIRED.includes(key) && !OPTIONAL.includes(key),
    ) ||
    PATHS.some((key) => !canonical(options[key])) ||
    !/^sha256:[a-f0-9]{64}$/.test(options.imageDigest ?? "") ||
    ["macAsarSha256", "dockerSha256", "pythonSha256", "nodeSha256"].some(
      (key) => !SHA.test(options[key] ?? ""),
    ) ||
    !Number.isSafeInteger(options.cpuId) ||
    options.cpuId < 0 ||
    options.cpuId > 65535 ||
    options.networkMode !== "bridge" ||
    (options.accountSyncGrantFile !== undefined && !canonical(options.accountSyncGrantFile)) ||
    (options.startupTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.startupTimeoutMs) ||
        options.startupTimeoutMs < 100 ||
        options.startupTimeoutMs > 180000)) ||
    (options.initialMode !== undefined && options.initialMode !== "codex")
  )
    throw invalid();
  try {
    normalizeContainerMemoryLimitMiB(options.memoryLimitMiB);
    normalizeContainerPidsLimit(options.pidsLimit);
    normalizePersistentHistoryRoot(options.historyRoot);
    normalizeProjectRoots(options.projectRoots);
    normalizeDesktopConnection(options.connection);
  } catch {
    throw invalid();
  }
  const independent = [
    options.sourceRoot,
    options.macAsarPath,
    options.dockerPath,
    options.pythonPath,
    options.nodePath,
    dirname(options.accountSourceFile),
    ...options.projectRoots,
  ];
  if (
    independent.some(
      (path) =>
        overlaps(value.deploymentRoot, path) ||
        overlaps(options.historyRoot, path),
    ) ||
    overlaps(value.deploymentRoot, options.historyRoot) ||
    overlaps(value.deploymentRoot, "/dev/shm") ||
    overlaps(options.historyRoot, "/dev/shm")
  )
    throw invalid();
  if (options.accountSyncGrantFile !== undefined) {
    const parent = dirname(options.accountSyncGrantFile);
    if ([...independent, value.deploymentRoot, options.historyRoot, "/dev/shm"].some((path) => overlaps(parent, path))) throw invalid();
  }
  return value;
}

/**
 * Enroll a fixed local template; this never starts or stops a native process.
 * The returned createConfig is the server-only supervisor config factory.
 */
export async function createDesktopSupervisorConfigFactory(input = {}) {
  if (
    !exact(input, ["templateFile"]) ||
    !Object.hasOwn(
      Object.getOwnPropertyDescriptor(input, "templateFile") ?? {},
      "value",
    )
  )
    throw invalid();
  const { templateFile } = input;
  if (
    process.platform !== "linux" ||
    typeof process.getuid !== "function" ||
    !canonical(templateFile)
  )
    throw invalid();
  let enrolled, root, history, syncGrant;
  try {
    enrolled = await readTemplate(templateFile);
    validate(enrolled.value);
    root = await privateDirectory(enrolled.value.deploymentRoot);
    history = await privateDirectory(enrolled.value.options.historyRoot);
    if ((await statfs(history.fdPath, { bigint: true })).type === TMPFS)
      throw unavailable();
    await accountSource(enrolled.value.options.accountSourceFile);
    if (enrolled.value.options.accountSyncGrantFile !== undefined)
      syncGrant = await accountSyncGrant(enrolled.value.options.accountSyncGrantFile);
    if (!(await verifyDirectory(root)) || !(await verifyDirectory(history)))
      throw unavailable();
  } catch (error) {
    throw error?.code === "DESKTOP_SUPERVISOR_INVALID_CONFIG"
      ? error
      : unavailable();
  } finally {
    await root?.handle.close();
    await history?.handle.close();
  }
  const { deploymentId, deploymentRoot, options } = enrolled.value;
  const rootInfo = root.info,
    historyInfo = history.info;
  const currentProfileFile = join(deploymentRoot, "current.profile.json");
  const stateDirectory = join(deploymentRoot, "supervisor");

  async function createConfig(input) {
    if (
      !exact(input, ["attemptId"]) ||
      !Object.hasOwn(
        Object.getOwnPropertyDescriptor(input, "attemptId") ?? {},
        "value",
      ) ||
      typeof input.attemptId !== "string" ||
      !UUID.test(input.attemptId)
    )
      throw invalid();
    const suffix = input.attemptId.replaceAll("-", "");
    const generation = join(deploymentRoot, `g${suffix}`),
      runtimeRoot = join(generation, "r"),
      bridgeRoot = join(generation, "b"),
      profileFile = join(generation, "p.json"),
      controlSocketPath = join(generation, "c.sock"),
      configFile = join(generation, "config.json"),
      homeRoot = join("/dev/shm", `chatgpt-${suffix}`);
    validateDesktopSupervisorSocketPaths({
      runtimeRoot,
      bridgeRoot,
      controlSocketPath,
    });
    let deploy, persistent, shm, gen, bridge, home, configHandle;
    try {
      const now = await readTemplate(templateFile);
      if (
        now.fingerprint !== enrolled.fingerprint ||
        !sameFile(now.info, enrolled.info) ||
        !sameDir(now.parentInfo, enrolled.parentInfo)
      )
        throw unavailable();
      deploy = await privateDirectory(deploymentRoot);
      persistent = await privateDirectory(options.historyRoot);
      if (
        !sameDir(deploy.info, rootInfo) ||
        !sameDir(persistent.info, historyInfo) ||
        (await statfs(persistent.fdPath, { bigint: true })).type === TMPFS
      )
        throw unavailable();
      const sourceBefore = await accountSource(options.accountSourceFile);
      if (syncGrant) {
        const current = await accountSyncGrant(options.accountSyncGrantFile);
        if (!sameFile(current.info, syncGrant.info) || !sameDir(current.parentInfo, syncGrant.parentInfo)) throw unavailable();
      }
      shm = await open(
        "/dev/shm",
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const shmInfo = await shm.stat({ bigint: true });
      if (
        !shmInfo.isDirectory() ||
        (await realpath("/dev/shm")) !== "/dev/shm" ||
        !sameDir(shmInfo, await lstat("/dev/shm", { bigint: true })) ||
        (await statfs(`/proc/self/fd/${shm.fd}`, { bigint: true })).type !==
          TMPFS
      )
        throw unavailable();
      await mkdir(join(deploy.fdPath, `g${suffix}`), { mode: 0o700 });
      gen = await privateDirectory(generation);
      if (
        !(await verifyDirectory(deploy)) ||
        gen.info.dev !== deploy.info.dev ||
        (await readdir(gen.fdPath)).length
      )
        throw unavailable();
      await mkdir(join(gen.fdPath, "b"), { mode: 0o700 });
      bridge = await privateDirectory(bridgeRoot);
      await mkdir(join(`/proc/self/fd/${shm.fd}`, `chatgpt-${suffix}`), {
        mode: 0o700,
      });
      home = await privateDirectory(homeRoot);
      if (
        (await statfs(home.fdPath, { bigint: true })).type !== TMPFS ||
        (await readdir(home.fdPath)).length ||
        (await readdir(bridge.fdPath)).length
      )
        throw unavailable();
      await Promise.all([
        absent(runtimeRoot),
        absent(profileFile),
        absent(controlSocketPath),
      ]);
      const { accountSourceFile, accountSyncGrantFile, ...fixed } = options;
      const serviceOptions = {
        ...fixed,
        runtimeRoot,
        bridgeRoot,
        profileFile,
        controlSocketPath,
        accountSnapshot: { sourceFile: accountSourceFile, homeRoot },
        ...(accountSyncGrantFile === undefined ? {} : { accountSync: { grantFile: accountSyncGrantFile } }),
      };
      const bytes = Buffer.from(
        JSON.stringify({ version: 1, options: serviceOptions }) + "\n",
      );
      if (bytes.length > MAX) throw invalid();
      configHandle = await open(
        join(gen.fdPath, "config.json"),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await configHandle.writeFile(bytes);
      await configHandle.sync();
      const configInfo = await configHandle.stat({ bigint: true });
      if (
        !configInfo.isFile() ||
        configInfo.uid !== BigInt(process.getuid()) ||
        (configInfo.mode & 0o7777n) !== 0o600n ||
        configInfo.nlink !== 1n ||
        !sameFile(configInfo, await lstat(configFile, { bigint: true }))
      )
        throw unavailable();
      const { readDesktopServiceConfig } = await import("./service-cli.mjs");
      const config = await readDesktopServiceConfig(configFile);
      const after = await readTemplate(templateFile);
      if (syncGrant) {
        const current = await accountSyncGrant(accountSyncGrantFile);
        if (!sameFile(current.info, syncGrant.info) || !sameDir(current.parentInfo, syncGrant.parentInfo)) throw unavailable();
      }
      if (
        after.fingerprint !== enrolled.fingerprint ||
        !sameFile(after.info, enrolled.info) ||
        !sameDir(after.parentInfo, enrolled.parentInfo) ||
        !sameFile(sourceBefore, await accountSource(accountSourceFile)) ||
        !(await verifyDirectory(deploy)) ||
        !(await verifyDirectory(persistent)) ||
        !(await verifyDirectory(gen)) ||
        gen.info.dev !== deploy.info.dev ||
        !(await verifyDirectory(bridge)) ||
        !(await verifyDirectory(home)) ||
        !sameDir(shmInfo, await shm.stat({ bigint: true })) ||
        !sameDir(shmInfo, await lstat("/dev/shm", { bigint: true })) ||
        !sameFile(configInfo, await lstat(configFile, { bigint: true })) ||
        (await readdir(bridge.fdPath)).length ||
        (await readdir(home.fdPath)).length ||
        (await readdir(gen.fdPath)).sort().join(",") !== "b,config.json"
      )
        throw unavailable();
      await Promise.all([
        absent(runtimeRoot),
        absent(profileFile),
        absent(controlSocketPath),
      ]);
      return config;
    } catch (error) {
      throw error?.code === "DESKTOP_SUPERVISOR_INVALID_CONFIG"
        ? error
        : unavailable();
    } finally {
      await Promise.allSettled([
        configHandle?.close(),
        home?.handle.close(),
        bridge?.handle.close(),
        gen?.handle.close(),
        shm?.close(),
        persistent?.handle.close(),
        deploy?.handle.close(),
      ]);
    }
  }
  async function createRecoveryConfig(input) {
    if (!exact(input, ["attemptId", "previous"]) ||
        !["attemptId", "previous"].every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(input, key) ?? {}, "value")) ||
        typeof input.attemptId !== "string" || !UUID.test(input.attemptId) ||
        !input.previous || typeof input.previous !== "object" || Array.isArray(input.previous)) throw invalid();
    const previous = input.previous;
    for (const key of ["attemptId", "configSha256", "recovery"])
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(previous, key) ?? {}, "value")) throw invalid();
    if (!UUID.test(previous.attemptId ?? "") || previous.attemptId === input.attemptId ||
        !SHA.test(previous.configSha256 ?? "") || !previous.recovery || typeof previous.recovery !== "object") throw invalid();
    const oldSuffix = previous.attemptId.replaceAll("-", ""), suffix = input.attemptId.replaceAll("-", ""),
      oldGeneration = join(deploymentRoot, `g${oldSuffix}`), generation = join(deploymentRoot, `g${suffix}`),
      oldConfigFile = join(oldGeneration, "config.json"), configFile = join(generation, "config.json"),
      profileFile = join(generation, "p.json"), controlSocketPath = join(generation, "c.sock");
    let deploy, persistent, oldDir, gen, home, configHandle;
    try {
      const now = await readTemplate(templateFile);
      if (now.fingerprint !== enrolled.fingerprint || !sameFile(now.info, enrolled.info) ||
          !sameDir(now.parentInfo, enrolled.parentInfo)) throw unavailable();
      deploy = await privateDirectory(deploymentRoot);
      persistent = await privateDirectory(options.historyRoot);
      oldDir = await privateDirectory(oldGeneration);
      if (!sameDir(deploy.info, rootInfo) || !sameDir(persistent.info, historyInfo) ||
          oldDir.info.dev !== deploy.info.dev || (await statfs(persistent.fdPath, { bigint: true })).type === TMPFS) throw unavailable();
      const sourceBefore = await accountSource(options.accountSourceFile), oldInfo = await lstat(oldConfigFile, { bigint: true });
      if (!oldInfo.isFile() || oldInfo.uid !== BigInt(process.getuid()) || (oldInfo.mode & 0o7777n) !== 0o600n || oldInfo.nlink !== 1n) throw unavailable();
      const { readDesktopServiceConfig } = await import("./service-cli.mjs");
      const old = await readDesktopServiceConfig(oldConfigFile);
      const { accountSourceFile, accountSyncGrantFile, ...fixed } = options;
      const runtimeGeneration = dirname(previous.recovery.bridgeRoot ?? ""), runtimeName = basename(runtimeGeneration);
      if (!/^g[a-f0-9]{32}$/.test(runtimeName) || runtimeGeneration !== join(deploymentRoot, runtimeName) ||
          previous.recovery.bridgeRoot !== join(runtimeGeneration, "b")) throw unavailable();
      const runtimeSuffix = runtimeName.slice(1);
      const expected = {
        ...fixed, runtimeRoot: join(runtimeGeneration, "r"), bridgeRoot: join(runtimeGeneration, "b"),
        profileFile: join(oldGeneration, "p.json"), controlSocketPath: join(oldGeneration, "c.sock"),
        accountSnapshot: { sourceFile: accountSourceFile, homeRoot: join("/dev/shm", `chatgpt-${runtimeSuffix}`) },
        ...(accountSyncGrantFile === undefined ? {} : { accountSync: { grantFile: accountSyncGrantFile } }),
      };
      if (old.fingerprint !== previous.configSha256 || !isDeepStrictEqual(old.options, expected) ||
          previous.recovery.bridgeRoot !== expected.bridgeRoot || previous.recovery.profileFile !== expected.profileFile ||
          ["dockerPath", "dockerSha256", "imageDigest"].some((key) => previous.recovery[key] !== expected[key]) ||
          !sameFile(oldInfo, await lstat(oldConfigFile, { bigint: true }))) throw unavailable();
      home = await privateDirectory(expected.accountSnapshot.homeRoot);
      if ((await statfs(home.fdPath, { bigint: true })).type !== TMPFS) throw unavailable();
      if (syncGrant) {
        const current = await accountSyncGrant(accountSyncGrantFile);
        if (!sameFile(current.info, syncGrant.info) || !sameDir(current.parentInfo, syncGrant.parentInfo)) throw unavailable();
      }
      validateDesktopSupervisorSocketPaths({ runtimeRoot: expected.runtimeRoot, bridgeRoot: expected.bridgeRoot, controlSocketPath });
      await mkdir(join(deploy.fdPath, `g${suffix}`), { mode: 0o700 });
      gen = await privateDirectory(generation);
      if (gen.info.dev !== deploy.info.dev || (await readdir(gen.fdPath)).length) throw unavailable();
      await Promise.all([absent(profileFile), absent(controlSocketPath)]);
      const bytes = Buffer.from(JSON.stringify({ version: 1, options: { ...old.options, profileFile, controlSocketPath } }) + "\n");
      if (bytes.length > MAX) throw invalid();
      configHandle = await open(join(gen.fdPath, "config.json"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await configHandle.writeFile(bytes); await configHandle.sync();
      const configInfo = await configHandle.stat({ bigint: true });
      const config = await readDesktopServiceConfig(configFile), after = await readTemplate(templateFile);
      if (after.fingerprint !== enrolled.fingerprint || !sameFile(after.info, enrolled.info) ||
          !sameDir(after.parentInfo, enrolled.parentInfo) || !sameFile(sourceBefore, await accountSource(accountSourceFile)) ||
          !sameFile(oldInfo, await lstat(oldConfigFile, { bigint: true })) || !sameFile(configInfo, await lstat(configFile, { bigint: true })) ||
          !(await verifyDirectory(deploy)) || !(await verifyDirectory(persistent)) || !(await verifyDirectory(oldDir)) ||
          !(await verifyDirectory(gen)) || !(await verifyDirectory(home)) || (await readdir(gen.fdPath)).join(",") !== "config.json") throw unavailable();
      await Promise.all([absent(profileFile), absent(controlSocketPath)]);
      return config;
    } catch (error) {
      throw error?.code === "DESKTOP_SUPERVISOR_INVALID_CONFIG" ? error : unavailable();
    } finally {
      await Promise.allSettled([configHandle?.close(), home?.handle.close(), gen?.handle.close(), oldDir?.handle.close(), persistent?.handle.close(), deploy?.handle.close()]);
    }
  }
  return Object.freeze({
    createConfig,
    createRecoveryConfig,
    templateFingerprint: enrolled.fingerprint,
    deploymentId,
    deploymentRoot,
    stateDirectory,
    currentProfileFile,
    pythonPath: options.pythonPath,
    pythonSha256: options.pythonSha256,
  });
}
