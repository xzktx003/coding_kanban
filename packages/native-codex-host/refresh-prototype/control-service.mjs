// Explicit owner API. Starting control never starts, migrates or stops native tasks.
import {
  open,
  readFile,
  lstat,
  realpath,
  link,
  unlink,
} from "node:fs/promises";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateBridgeMetadata } from "./cli-bridge.mjs";
import { validateNativeScope } from "./native-scope.mjs";
import {
  attachPrivateService,
  verifyPrivateServiceIdentity,
} from "./private-service.mjs";
import {
  createRefreshResourceMonitor,
  captureProcessIdentity,
} from "./resources.mjs";
import { createRefreshManager } from "./lifecycle-manager.mjs";
import {
  controlDirectory,
  listenRefreshControl,
  connectRefreshControl,
  validateControlRecord,
} from "./control-channel.mjs";
import { exact, uuid } from "./control-peer.mjs";

const configFile = (root) => join(root, "control-config.json"),
  recordFile = (root) => join(root, "control-service.json");
const sameScope = (a, b) =>
  ["domain", "generation", "pid", "startTicks"].every(
    (key) => a[key] === b[key],
  );
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export function validateControlStartupDiagnostic(value) {
  if (
    !exact(value, "category,code,stage,state") ||
    value.state !== "failed" ||
    ![
      "configuration",
      "attach",
      "identity",
      "resources",
      "manager",
      "listener",
      "publish",
    ].includes(value.stage) ||
    ![
      "UNAVAILABLE",
      "ENOENT",
      "EACCES",
      "EEXIST",
      "REFRESH_RESOURCES_UNAVAILABLE",
      "NATIVE_CONNECTION_LOST",
      "NATIVE_TIMEOUT",
      "NATIVE_NOT_SENT",
    ].includes(value.code) ||
    ![
      "authorization",
      "resources",
      "native",
      "configuration",
      "unknown",
    ].includes(value.category)
  )
    return null;
  return Object.freeze({
    state: "failed",
    stage: value.stage,
    code: value.code,
    category: value.category,
  });
}
async function privateFile(path, limit) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > limit ||
    (await realpath(path)) !== path
  )
    throw Error("bounded owned private control file required");
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > limit)
    throw Error("private control file budget exceeded");
  return JSON.parse(text);
}
function validateConfiguration(config) {
  if (
    !exact(
      config,
      "idleLimit,leaseGraceMs,memoryBudgetBytes,metadata,nativeScope,profiles,roots,runtimeRoot,version",
    ) ||
    config.version !== 1
  )
    throw Error("exact private control configuration required");
  validateBridgeMetadata(config.metadata);
  validateNativeScope(config.nativeScope);
  if (
    config.runtimeRoot === config.metadata.runtimeRoot ||
    !Array.isArray(config.profiles) ||
    !config.profiles.length ||
    config.profiles.length > 32 ||
    config.profiles.some((id) => !uuid(id)) ||
    new Set(config.profiles).size !== config.profiles.length ||
    !Number.isSafeInteger(config.idleLimit) ||
    config.idleLimit < 0 ||
    config.idleLimit > 10 ||
    !Number.isSafeInteger(config.memoryBudgetBytes) ||
    config.memoryBudgetBytes < 1 ||
    !Number.isSafeInteger(config.leaseGraceMs) ||
    config.leaseGraceMs < 1 ||
    config.leaseGraceMs > 300000 ||
    !Array.isArray(config.roots) ||
    config.roots.length > 31
  )
    throw Error("bounded private control configuration required");
  const ids = new Set();
  for (const root of config.roots) {
    if (
      !exact(root, "id,kind,pid,startTicks") ||
      !uuid(root.id) ||
      ids.has(root.id) ||
      !["host", "gateway", "manager"].includes(root.kind) ||
      !Number.isSafeInteger(root.pid) ||
      root.pid <= 1 ||
      typeof root.startTicks !== "string" ||
      !/^[1-9][0-9]{0,29}$/.test(root.startTicks)
    )
      throw Error("explicit owned control resource root required");
    ids.add(root.id);
  }
  return config;
}
async function readService(root) {
  await controlDirectory(root);
  return validateControlRecord(await privateFile(recordFile(root), 8192));
}
function descriptor(root, record) {
  record = Object.freeze({
    ...record,
    nativeScope: validateNativeScope(record.nativeScope),
  });
  return {
    record,
    connect: () => connectRefreshControl({ runtimeRoot: root, record }),
  };
}

/** Attach explicitly; stale state is never replaced and does not authorize a native restart. */
export async function attachRefreshControlService({
  runtimeRoot,
  metadata,
  scope,
}) {
  validateBridgeMetadata(metadata);
  scope = validateNativeScope(scope);
  const record = await readService(runtimeRoot);
  if (!sameScope(record.nativeScope, scope))
    throw Error("private control native generation mismatch");
  await verifyPrivateServiceIdentity({ metadata, scope });
  const probe = await connectRefreshControl({ runtimeRoot, record });
  await probe.close();
  await verifyPrivateServiceIdentity({ metadata, scope });
  return descriptor(runtimeRoot, record);
}

/** Reserve a fresh private root, launch a detached manager, then verify its exact live identity. */
export async function startRefreshControlService({
  runtimeRoot,
  metadata,
  scope,
  profiles,
  roots = [],
  idleLimit = 10,
  memoryBudgetBytes,
  leaseGraceMs = 60000,
  startupTimeoutMs = 30000,
}) {
  await controlDirectory(runtimeRoot);
  if (
    !Number.isSafeInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1 ||
    startupTimeoutMs > 60000
  )
    throw Error("bounded control startup timeout required");
  for (const path of [
    configFile(runtimeRoot),
    recordFile(runtimeRoot),
    join(runtimeRoot, "control.sock"),
    join(runtimeRoot, "control-launch.json"),
    join(runtimeRoot, "control-startup.json"),
  ]) {
    try {
      await lstat(path);
      throw Error(
        "existing control state requires explicit recovery; no process changed",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const config = JSON.parse(
    JSON.stringify(
      validateConfiguration({
        version: 1,
        runtimeRoot,
        metadata,
        nativeScope: scope,
        profiles,
        roots,
        idleLimit,
        memoryBudgetBytes,
        leaseGraceMs,
      }),
    ),
  );
  // The caller's local owner API supplies roots; no HTTP or browser PID is accepted.
  for (const root of config.roots) {
    const actual = await captureProcessIdentity(root.pid);
    if (actual.startTicks !== root.startTicks)
      throw Error("owned control resource root changed");
  }
  await verifyPrivateServiceIdentity({ metadata, scope: config.nativeScope });
  const reservation = await open(configFile(runtimeRoot), "wx", 0o600);
  try {
    await reservation.writeFile(JSON.stringify(config));
    await reservation.sync();
  } finally {
    await reservation.close();
  }
  const entry = fileURLToPath(new URL("./control-worker.mjs", import.meta.url));
  const env = {
    HOME: runtimeRoot,
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
  };
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ"])
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  const child = spawn(
    process.execPath,
    [entry, "--config", configFile(runtimeRoot)],
    { cwd: runtimeRoot, env, stdio: "ignore", detached: true },
  );
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.unref();
  if (!child.pid)
    throw Error("private control launch failed; reservation preserved");
  const identity = await captureProcessIdentity(child.pid),
    launch = await open(join(runtimeRoot, "control-launch.json"), "wx", 0o600);
  try {
    await launch.writeFile(JSON.stringify({ version: 1, ...identity }));
    await launch.sync();
  } finally {
    await launch.close();
  }
  const deadline = performance.now() + startupTimeoutMs;
  while (true) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      let diagnostic;
      try {
        diagnostic = await privateFile(
          join(runtimeRoot, "control-startup.json"),
          2048,
        );
      } catch {
        /* A terminated worker may not publish diagnostics. */
      }
      const safe = validateControlStartupDiagnostic(diagnostic);
      throw Object.assign(
        Error(
          "private control failed before readiness; owned launch record preserved",
        ),
        safe ? { controlStartup: safe } : {},
      );
    }
    let record;
    try {
      record = await readService(runtimeRoot);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (record) {
      if (
        record.pid !== identity.pid ||
        record.startTicks !== identity.startTicks
      )
        throw Error("private control launch identity mismatch");
      return attachRefreshControlService({
        runtimeRoot,
        metadata,
        scope: config.nativeScope,
      });
    }
    if (performance.now() >= deadline)
      throw Error(
        "private control readiness timeout; owned launch record preserved",
      );
    await pause(25);
  }
}

/** Worker entry: persistent lease/pool state, independent of gateway connections. */
export async function runRefreshControlService({ configPath }) {
  if (
    typeof configPath !== "string" ||
    !isAbsolute(configPath) ||
    resolve(configPath) !== configPath ||
    configPath !== configFile(dirname(configPath))
  )
    throw Error("exact private control config path required");
  const runtimeRoot = dirname(configPath);
  await controlDirectory(runtimeRoot);
  const config = validateConfiguration(await privateFile(configPath, 16384));
  if (config.runtimeRoot !== runtimeRoot)
    throw Error("private control config root mismatch");
  let manager,
    monitor,
    listener,
    closing,
    stage = "attach";
  const close = () =>
    (closing ??= (async () => {
      let cleanup, problem;
      try {
        cleanup = await listener?.close();
      } catch (error) {
        problem = error;
      }
      try {
        await manager?.close();
      } catch (error) {
        problem ??= error;
      }
      monitor?.invalidate();
      if (problem) throw problem;
      return cleanup ?? { unreleasedConsumers: 0 };
    })());
  try {
    const service = await attachPrivateService({
      metadata: config.metadata,
      domain: config.nativeScope.domain,
    });
    stage = "identity";
    await verifyPrivateServiceIdentity({
      metadata: config.metadata,
      scope: config.nativeScope,
    });
    stage = "resources";
    monitor = createRefreshResourceMonitor({
      service,
      roots: [
        ...config.roots,
        {
          id: randomUUID(),
          kind: "manager",
          ...(await captureProcessIdentity(process.pid)),
        },
      ],
    });
    stage = "manager";
    manager = await createRefreshManager({
      service,
      resourceMonitor: monitor,
      idleLimit: config.idleLimit,
      memoryBudgetBytes: config.memoryBudgetBytes,
    });
    stage = "listener";
    listener = await listenRefreshControl({
      manager,
      runtimeRoot,
      profiles: config.profiles,
      leaseGraceMs: config.leaseGraceMs,
    });
    await verifyPrivateServiceIdentity({
      metadata: config.metadata,
      scope: config.nativeScope,
    });
    stage = "publish";
    const staging = join(runtimeRoot, ".ready-" + randomUUID()),
      file = await open(staging, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(listener.record));
        await file.sync();
      } finally {
        await file.close();
      }
      // Publish a complete record without overwriting a foreign/stale record.
      await link(staging, recordFile(runtimeRoot));
    } finally {
      await unlink(staging);
    }
    return { record: listener.record, close };
  } catch (error) {
    await close().catch(() => {});
    const code = [
      "ENOENT",
      "EACCES",
      "EEXIST",
      "REFRESH_RESOURCES_UNAVAILABLE",
      "NATIVE_CONNECTION_LOST",
      "NATIVE_TIMEOUT",
      "NATIVE_NOT_SENT",
    ].includes(error?.code)
      ? error.code
      : "UNAVAILABLE";
    const message = typeof error?.message === "string" ? error.message : "";
    const category = /authorization|account/.test(message)
      ? "authorization"
      : /resource|task|ancestry/.test(message)
        ? "resources"
        : /native/.test(message)
          ? "native"
          : /private|existing/.test(message)
            ? "configuration"
            : "unknown";
    throw Object.assign(
      Error("private refresh control initialization failed"),
      { controlStartup: { state: "failed", stage, code, category } },
    );
  }
}
