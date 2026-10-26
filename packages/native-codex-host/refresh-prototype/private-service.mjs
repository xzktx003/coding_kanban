// Opt-in isolated service. No launcher imports this module by default.
import {
  lstat,
  realpath,
  readFile,
  open,
  mkdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, resolve, dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  validateBridgeMetadata,
  verifyBridgeConfig,
  verifyNativeArtifacts,
  verifyControlSocket,
} from "./cli-bridge.mjs";
import { createNativeClient } from "./native-client.mjs";
import { validateNativeScope } from "./native-scope.mjs";
import { createNativeAuthorizationTracker } from "./authorization-boundary.mjs";
import {
  connectNativeAuthority,
  readNativeAuthority,
  validateAuthorityIdentity,
} from "./native-authority.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const recordPath = (metadata) => join(metadata.runtimeRoot, "service.json");
async function privateDirectory(path) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\x00-\x1f\x7f]/.test(path)
  )
    throw Error("owned canonical private directory required");
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await realpath(path)) !== path
  )
    throw Error("owned canonical private directory required");
}
async function validateScope({
  metadata,
  domain,
  processHome,
  codexHome,
  cwd,
}) {
  validateBridgeMetadata(metadata);
  if (!UUID.test(domain))
    throw Error("exact authorization domain UUID required");
  await privateDirectory(metadata.runtimeRoot);
  if (dirname(metadata.socketPath) !== metadata.runtimeRoot)
    throw Error("native socket outside private service directory");
  const base = dirname(metadata.runtimeRoot);
  await privateDirectory(base);
  for (const path of [processHome, codexHome]) {
    await privateDirectory(path);
    const part = relative(base, path);
    if (
      !part ||
      part === ".." ||
      part.startsWith(".." + sep) ||
      isAbsolute(part)
    )
      throw Error("private directory outside service scope");
  }
  if (
    processHome === codexHome ||
    processHome === metadata.runtimeRoot ||
    codexHome === metadata.runtimeRoot
  )
    throw Error("private service directories must be distinct");
  if (
    typeof cwd !== "string" ||
    !isAbsolute(cwd) ||
    resolve(cwd) !== cwd ||
    /[\x00-\x1f\x7f]/.test(cwd) ||
    (await realpath(cwd)) !== cwd ||
    !(await lstat(cwd)).isDirectory()
  )
    throw Error("canonical project cwd required");
}
async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw Error("invalid native service pid");
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
  if (fields[0] === "Z") throw Error("native service exited");
  return fields[19];
}
async function readRecord(metadata) {
  const path = recordPath(metadata),
    info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > 4096 ||
    (await realpath(path)) !== path
  )
    throw Error("private native service record invalid");
  return JSON.parse(await readFile(path, "utf8"));
}
async function verifyProcess(record, metadata, domain) {
  if (
    record.version !== 1 ||
    record.state !== "ready" ||
    record.domain !== domain ||
    !UUID.test(record.generation) ||
    record.socketPath !== metadata.socketPath ||
    record.cliSha256 !== metadata.cliSha256 ||
    record.startTicks !== (await processIdentity(record.pid))
  )
    throw Error("native service generation unavailable");
  await verifyPrivateNativeEndpoint({
    metadata,
    scope: validateNativeScope({
      domain: record.domain,
      generation: record.generation,
      pid: record.pid,
      startTicks: record.startTicks,
    }),
  });
}
/** Startup observer checks the exact native endpoint before a ready record exists. */
export async function verifyPrivateNativeEndpoint({ metadata, scope }) {
  validateBridgeMetadata(metadata);
  scope = validateNativeScope(scope);
  await privateDirectory(metadata.runtimeRoot);
  if (
    dirname(metadata.socketPath) !== metadata.runtimeRoot ||
    (await processIdentity(scope.pid)) !== scope.startTicks ||
    (await lstat(`/proc/${scope.pid}`)).uid !== process.getuid?.()
  )
    throw Error("native service generation unavailable");
  const args = (await readFile(`/proc/${scope.pid}/cmdline`))
    .toString()
    .split("\0")
    .filter(Boolean);
  if (
    args[0] !== metadata.cliPath ||
    !args.includes(`unix://${metadata.socketPath}`)
  )
    throw Error("native service process ownership mismatch");
  await verifyControlSocket(metadata.socketPath);
}
function descriptor(record, metadata) {
  const scope = validateNativeScope({
    domain: record.domain,
    generation: record.generation,
    pid: record.pid,
    startTicks: record.startTicks,
  });
  const authority = validateAuthorityIdentity(record.authority);
  const connectAnchor = () =>
    connectNativeAuthority({
      runtimeRoot: metadata.runtimeRoot,
      scope,
      authority,
    });
  return {
    record: Object.freeze({ ...record, authority }),
    async confirmAuthorization(binding) {
      await verifyPrivateServiceIdentity({ metadata, scope });
      const anchor = await connectAnchor();
      try {
        anchor.assertBinding(binding);
      } finally {
        await anchor.close();
      }
    },
    async readRss() {
      await verifyPrivateServiceIdentity({ metadata, scope });
      const rss = (await readFile(`/proc/${record.pid}/status`, "utf8")).match(
        /^VmRSS:\s+(\d+) kB$/m,
      );
      if (!rss) throw Error("native service RSS unavailable");
      return Number(rss[1]) * 1024;
    },
    async connect(options = {}) {
      await verifyPrivateServiceIdentity({ metadata, scope });
      const anchor = await connectAnchor();
      let client,
        observing = false;
      const tracker = createNativeAuthorizationTracker({
        ...scope,
        onInvalidated() {
          if (observing) anchor.revoke();
          void client?.close().catch(() => {});
        },
      });
      try {
        client = createNativeClient({
          ...options,
          socketPath: metadata.socketPath,
          async beforeReady() {
            await verifyPrivateServiceIdentity({ metadata, scope });
            anchor.assertCurrent();
          },
          beforeSend() {
            anchor.assertCurrent();
            tracker.assertValid();
            return options.beforeSend?.();
          },
          onLifecycle(event) {
            observing = true;
            try {
              tracker.observe(event);
            } finally {
              observing = false;
            }
            options.onLifecycle?.(event);
          },
        });
        anchor.closed.then(() => client.close()).catch(() => {});
        client.closed
          .then(
            () => anchor.close(),
            () => anchor.close(),
          )
          .catch(() => {});
        await client.ready;
        const binding = await tracker.bind(client, {
          timeoutMs: options.timeoutMs ?? 15000,
        });
        try {
          anchor.assertBinding(binding);
        } catch (error) {
          anchor.revoke();
          throw error;
        }
        await verifyPrivateServiceIdentity({ metadata, scope });
        anchor.assertCurrent();
        tracker.assertValid();
        client.assertAuthorizationCurrent = () => {
          anchor.assertCurrent();
          tracker.binding();
        };
        return client;
      } catch (error) {
        await client?.close().catch(() => {});
        await anchor.close();
        throw error;
      }
    },
  };
}

/** Recheck live identity after the caller has verified the original artifact pair. */
export async function verifyPrivateServiceIdentity({ metadata, scope }) {
  validateBridgeMetadata(metadata);
  scope = validateNativeScope(scope);
  await privateDirectory(metadata.runtimeRoot);
  const record = await readRecord(metadata);
  if (
    record.domain !== scope.domain ||
    record.generation !== scope.generation ||
    record.pid !== scope.pid ||
    record.startTicks !== scope.startTicks
  )
    throw Error("native service scope or generation mismatch");
  await verifyProcess(record, metadata, scope.domain);
  return record;
}

/** Reuse never kills/restarts a process, even when a stale record is found. */
export async function attachPrivateService({ metadata, domain }) {
  validateBridgeMetadata(metadata);
  if (!UUID.test(domain))
    throw Error("exact authorization domain UUID required");
  await privateDirectory(metadata.runtimeRoot);
  await verifyNativeArtifacts(metadata);
  const record = await readRecord(metadata);
  await verifyProcess(record, metadata, domain);
  return descriptor(record, metadata);
}

/** One fresh config verification and attachment, never a cross-startup cache. */
export async function attachPrivateServiceFromConfig({ configPath, scope }) {
  scope = validateNativeScope(scope);
  const metadata = await verifyBridgeConfig(configPath);
  // Reject a changed record before consulting any PID supplied by that record.
  // This private path is reached only after this call's full config/hash check;
  // there is no public "verified" flag or retained verification proof.
  const record = await verifyPrivateServiceIdentity({ metadata, scope });
  const service = descriptor(record, metadata);
  return { metadata, service };
}

/** Explicitly create a private native process which survives browser/manager exit. */
export async function startPrivateService(options) {
  const {
    metadata,
    domain,
    processHome,
    codexHome,
    cwd,
    unloadDelaySeconds = 1,
    environment = {},
  } = options;
  await validateScope(options);
  if (
    !Number.isSafeInteger(unloadDelaySeconds) ||
    unloadDelaySeconds < 1 ||
    unloadDelaySeconds > 60
  )
    throw Error("invalid native unload delay");
  const generation = randomUUID();
  let file;
  try {
    file = await open(recordPath(metadata), "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        "existing service record requires explicit recovery; no process changed",
      );
    throw error;
  }
  let child,
    exited,
    spawnError,
    authorityChild,
    authorityExited,
    authorityError;
  try {
    await file.writeFile(
      JSON.stringify({ version: 1, domain, generation, state: "starting" }),
    );
    await file.sync();
    try {
      await lstat(metadata.socketPath);
      throw Error("existing private endpoint requires explicit recovery");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const name of [
      "authority-config.json",
      "authority.json",
      "authority.sock",
      "authority-revoked",
    ]) {
      try {
        await lstat(join(metadata.runtimeRoot, name));
        throw Error("existing native authority requires explicit recovery");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await verifyNativeArtifacts(metadata);
    const paths = {
      tmp: join(processHome, "tmp"),
      config: join(processHome, ".config"),
      data: join(processHome, ".local-share"),
      cache: join(processHome, ".cache"),
    };
    for (const path of Object.values(paths)) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      await privateDirectory(path);
    }
    const env = {};
    for (const key of [
      "PATH",
      "LANG",
      "LC_ALL",
      "TZ",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "no_proxy",
    ]) {
      const value = environment[key] ?? process.env[key];
      if (typeof value === "string") env[key] = value;
    }
    Object.assign(env, {
      HOME: processHome,
      CODEX_HOME: codexHome,
      TMPDIR: paths.tmp,
      TMP: paths.tmp,
      TEMP: paths.tmp,
      XDG_CONFIG_HOME: paths.config,
      XDG_DATA_HOME: paths.data,
      XDG_CACHE_HOME: paths.cache,
      DO_NOT_TRACK: "1",
      OTEL_SDK_DISABLED: "true",
    });
    child = spawn(
      metadata.cliPath,
      [
        "-c",
        "features.code_mode_host=true",
        "-c",
        `thread_unload_delay_secs=${unloadDelaySeconds}`,
        "app-server",
        "--listen",
        `unix://${metadata.socketPath}`,
      ],
      { cwd, env, stdio: "ignore", detached: true },
    );
    child.once("error", (error) => {
      spawnError = error;
    });
    exited = new Promise((done) => child.once("exit", done));
    const deadline = performance.now() + 10000;
    while (true) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw Error("private native service failed before readiness");
      try {
        await verifyControlSocket(metadata.socketPath);
        break;
      } catch {
        if (performance.now() >= deadline)
          throw Error("private native service listener timed out");
        await delay(25);
      }
    }
    const scope = validateNativeScope({
      domain,
      generation,
      pid: child.pid,
      startTicks: await processIdentity(child.pid),
    });
    const authorityConfig = join(metadata.runtimeRoot, "authority-config.json");
    const config = await open(authorityConfig, "wx", 0o600);
    try {
      await config.writeFile(JSON.stringify({ version: 1, metadata, scope }));
      await config.sync();
    } finally {
      await config.close();
    }
    authorityChild = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./authority-worker.mjs", import.meta.url)),
        "--config",
        authorityConfig,
      ],
      { cwd, env, stdio: "ignore", detached: true },
    );
    authorityChild.once("error", (error) => {
      authorityError = error;
    });
    authorityExited = new Promise((done) => authorityChild.once("exit", done));
    const authorityDeadline = performance.now() + 20000;
    let originalAuthority;
    while (true) {
      if (
        authorityError ||
        authorityChild.exitCode !== null ||
        authorityChild.signalCode !== null
      )
        throw Error("private native authority failed before readiness");
      try {
        originalAuthority = await readNativeAuthority({
          runtimeRoot: metadata.runtimeRoot,
          scope,
        });
        break;
      } catch {
        if (performance.now() >= authorityDeadline)
          throw Error("private native authority readiness timed out");
        await delay(25);
      }
    }
    if (originalAuthority.pid !== authorityChild.pid)
      throw Error("private native authority ownership mismatch");
    const authority = validateAuthorityIdentity({
      generation: originalAuthority.generation,
      pid: originalAuthority.pid,
      startTicks: originalAuthority.startTicks,
    });
    const anchor = await connectNativeAuthority({
      runtimeRoot: metadata.runtimeRoot,
      scope,
      authority,
    });
    await anchor.close();
    const record = {
      version: 1,
      state: "ready",
      domain,
      generation,
      pid: child.pid,
      startTicks: await processIdentity(child.pid),
      socketPath: metadata.socketPath,
      cliSha256: metadata.cliSha256,
      authority,
    };
    await file.truncate(0);
    await file.write(JSON.stringify(record), 0, "utf8");
    await file.sync();
    await file.close();
    file = null;
    child.unref();
    authorityChild.unref();
    return descriptor(record, metadata);
  } catch (error) {
    // Startup has not published a ready service; only our newly spawned child is eligible.
    if (
      authorityChild?.pid &&
      authorityChild.exitCode === null &&
      authorityChild.signalCode === null
    ) {
      authorityChild.kill("SIGTERM");
      await Promise.race([authorityExited, delay(1000)]);
      if (
        authorityChild.exitCode === null &&
        authorityChild.signalCode === null
      ) {
        authorityChild.kill("SIGKILL");
        await authorityExited;
      }
    }
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([exited, delay(1000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    await file?.close();
    await unlink(recordPath(metadata)).catch(() => {});
    throw error;
  }
}
