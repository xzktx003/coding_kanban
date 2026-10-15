import { loadStartupEnv } from "./startup-env.mjs";
import { spawn } from "node:child_process";
import { watch, readFileSync, existsSync } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Quota exhaustion must not prevent startup or stop the existing gateway.
// Metadata polling is bounded and never reads source or credential contents.
export async function watchWithQuotaFallback(
  path,
  options,
  onChange,
  {
    nativeWatch = watch,
    pollMs = 1000,
    forcePolling = false,
    onQuota = () => {},
    onError = (error) =>
      console.error("[server-watch] Watch failed:", error.message),
  } = {},
) {
  if (!Number.isInteger(pollMs) || pollMs < 25 || pollMs > 60000)
    throw new Error("Invalid watch polling interval");
  const quota = (error) => ["EMFILE", "ENOSPC"].includes(error?.code);
  let native,
    timer,
    closed = false,
    polling = false,
    busy = false;
  async function snapshot() {
    const entries = new Map();
    const dirs = [path];
    for (let index = 0; index < dirs.length; index++) {
      for (const entry of await readdir(dirs[index], { withFileTypes: true })) {
        if (entries.size >= 4096)
          throw new Error("Watch polling snapshot exceeds 4096 entries");
        if (entry.isSymbolicLink()) continue;
        const full = join(dirs[index], entry.name);
        let stat;
        try {
          stat = await lstat(full);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        if (stat.isSymbolicLink()) continue;
        entries.set(
          relative(path, full),
          `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`,
        );
        if (options.recursive && stat.isDirectory()) dirs.push(full);
      }
    }
    return entries;
  }
  async function poll() {
    if (polling || closed) return;
    polling = true;
    native?.close();
    let before = await snapshot();
    if (closed) return;
    timer = setInterval(async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const after = await snapshot();
        if (closed) return;
        for (const name of new Set([...before.keys(), ...after.keys()]))
          if (before.get(name) !== after.get(name)) onChange("change", name);
        before = after;
      } catch (error) {
        if (!closed) onError(error);
      } finally {
        busy = false;
      }
    }, pollMs);
  }
  try {
    if (forcePolling) {
      await poll();
      return { close, poll };
    }
    native = nativeWatch(path, options, onChange);
    native.on("error", (error) => {
      if (closed) return;
      if (quota(error))
        void Promise.resolve()
          .then(() => onQuota(error))
          .then(poll)
          .catch(onError);
      else onError(error);
    });
  } catch (error) {
    if (!quota(error)) throw error;
    await onQuota(error);
    await poll();
  }
  return { close, poll };
  function close() {
    closed = true;
    clearInterval(timer);
    native?.close();
  }
}

// One owner serializes installs and replacements; failed preparation never stops
// the live gateway. A change arriving during preparation gets another pass.
export function createRestartQueue({ prepare, restart, onError }) {
  let pending = false;
  let running;
  return function request() {
    pending = true;
    if (!running) {
      running = (async () => {
        while (pending) {
          pending = false;
          try {
            await prepare();
            // Recheck the newest manifests before replacing the live process.
            if (pending) continue;
            await restart();
          } catch (error) {
            onError(error);
          }
        }
      })().finally(() => {
        running = undefined;
      });
    }
    return running;
  };
}

export function createGatewayCrashRecovery({
  restart,
  onRetry = () => {},
  onExhausted = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const delays = [1000, 2000, 4000];
  let attempts = 0;
  let timer;
  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  return {
    cancel,
    reset() {
      cancel();
      attempts = 0;
    },
    exited(startedAt) {
      cancel();
      if (now() - startedAt >= 60000) attempts = 0;
      if (attempts >= delays.length) {
        onExhausted();
        return;
      }
      const delay = delays[attempts++];
      onRetry(attempts, delay);
      timer = setTimer(() => {
        timer = undefined;
        void restart();
      }, delay);
    },
  };
}

function command(command, args, options) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveCommand();
      else reject(new Error(`${command} failed (${code ?? signal})`));
    });
  });
}

export function createDependencyPreparation({
  root,
  run = command,
  env = process.env,
}) {
  const manifests = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/server/package.json",
    "apps/web/package.json",
    "packages/shared/package.json",
    "packages/session-runtime/package.json",
  ];
  let installed;
  const fingerprintNow = () =>
    manifests
      .map((path) => readFileSync(resolve(root, path), "utf8"))
      .join("\n");
  return async () => {
    while (true) {
      const fingerprint = fingerprintNow();
      const runtimeEnv = loadStartupEnv(root, { ...env });
      const targets = ["apps/server"];
      if (
        runtimeEnv.SESSION_MODE_ENABLED !== "0" &&
        !runtimeEnv.SESSION_RUNTIME_BIN
      )
        targets.push("packages/session-runtime");
      const required = targets.flatMap((target) => {
        const path = resolve(root, target, "package.json");
        const resolver = createRequire(path);
        const { dependencies = {} } = JSON.parse(readFileSync(path, "utf8"));
        return Object.keys(dependencies).map((name) => ({
          name,
          resolver,
          target,
        }));
      });
      const missingDependencies = () =>
        required.filter(({ name, resolver }) => {
          try {
            return !existsSync(resolver.resolve(name));
          } catch {
            return true;
          }
        });
      const missing = missingDependencies().length > 0;
      if (installed !== fingerprint || missing) {
        console.log(
          "[server-watch] Preparing locked dependencies before gateway replacement…",
        );
        await run("pnpm", ["install", "--frozen-lockfile"], {
          cwd: root,
          env: runtimeEnv,
        });
        if (fingerprintNow() !== fingerprint) continue;
        const unresolved = missingDependencies();
        if (unresolved.length)
          throw new Error(
            `Missing dependencies: ${unresolved.map(({ name, target }) => `${target}: ${name}`).join(", ")}`,
          );
        installed = fingerprint;
      }
      return;
    }
  };
}

async function main() {
  const serverRoot = resolve(root, "apps/server");
  let child;
  let stopping = false;
  let timer;
  const watchers = [];
  let watchQuota = false;
  const watched = (path, options, onChange) =>
    watchWithQuotaFallback(path, options, onChange, {
      forcePolling: watchQuota,
      onQuota: async () => {
        // Recursive Node watchers can be partially registered when another watch
        // exposes quota exhaustion. Switch this gateway's whole group together.
        watchQuota = true;
        await Promise.all(watchers.map((watcher) => watcher.poll()));
      },
    });
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child;
    // Planned replacement/shutdown must not schedule crash recovery.
    child = undefined;
    await new Promise((resolveStop) => {
      const timeout = setTimeout(() => current.kill("SIGKILL"), 5000);
      current.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
      current.kill("SIGTERM");
    });
  }
  const request = createRestartQueue({
    prepare: createDependencyPreparation({ root }),
    restart: async () => {
      if (stopping) return;
      recovery.cancel();
      await stopChild();
      if (stopping) return;
      // Run tsx in this process rather than through a shell/CLI child tree.
      const startedAt = Date.now();
      const current = spawn(
        process.execPath,
        ["--import", "tsx", "src/index.ts"],
        {
          cwd: serverRoot,
          env: process.env,
          stdio: "inherit",
        },
      );
      child = current;
      current.on("error", (error) => console.error("[server-watch]", error));
      current.on("exit", (code, signal) => {
        if (stopping || child !== current) return;
        child = undefined;
        console.error(`[server-watch] Gateway exited (${signal ?? code}).`);
        recovery.exited(startedAt);
      });
    },
    onError: (error) =>
      console.error(
        "[server-watch] Preparation failed; current gateway retained. Fix dependencies and save a watched file to retry.",
        error.message,
      ),
  });
  const recovery = createGatewayCrashRecovery({
    restart: () => request(),
    onRetry: (attempt, delay) =>
      console.error(
        `[server-watch] Recovering gateway in ${delay}ms (attempt ${attempt}/3).`,
      ),
    onExhausted: () =>
      console.error(
        "[server-watch] Gateway recovery exhausted; fix the failure and save a watched file to retry.",
      ),
  });
  const changed = () => {
    recovery.reset();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stopping) void request();
    }, 500);
  };
  for (const path of ["apps/server/src", "packages/shared/src"]) {
    watchers.push(
      await watched(
        resolve(root, path),
        { recursive: true },
        (_event, name) => {
          if (name && /\.(?:ts|tsx|js|mjs|json)$/.test(String(name))) changed();
        },
      ),
    );
  }
  for (const [path, names] of [
    [".", ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]],
    ["apps/server", ["package.json"]],
    ["apps/web", ["package.json"]],
    ["packages/shared", ["package.json"]],
    ["packages/session-runtime", ["package.json"]],
  ]) {
    watchers.push(
      await watched(resolve(root, path), {}, (_event, name) => {
        if (names.includes(String(name))) changed();
      }),
    );
  }
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      stopping = true;
      clearTimeout(timer);
      recovery.cancel();
      watchers.forEach((watcher) => watcher.close());
      await stopChild();
      process.exit(0);
    });
  await request();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error("[server-watch]", error);
    process.exitCode = 1;
  });
}
