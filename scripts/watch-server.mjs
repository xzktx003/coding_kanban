import { loadStartupEnv } from "./startup-env.mjs";
import { spawn } from "node:child_process";
import { watch, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  let recoveryTimer;
  let request;
  let crashAttempts = 0;
  const expectedExits = new WeakSet();
  const recoveryScheduled = new WeakSet();
  const gatewayStartedAt = new WeakMap();
  const watchers = [];
  const prepareDependencies = createDependencyPreparation({ root });
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child;
    expectedExits.add(current);
    await new Promise((resolveStop) => {
      const timeout = setTimeout(() => current.kill("SIGKILL"), 5000);
      current.once("exit", () => {
        clearTimeout(timeout);
        resolveStop();
      });
      current.kill("SIGTERM");
    });
  }
  function scheduleRetry(reason) {
    if (stopping) return;
    const delayMs = Math.min(1_000 * 2 ** crashAttempts, 30_000);
    crashAttempts += 1;
    console.error(
      `[server-watch] ${reason}; restarting in ${delayMs}ms (attempt ${crashAttempts}).`,
    );
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!stopping) void request();
    }, delayMs);
    recoveryTimer.unref?.();
  }
  function scheduleRecovery(current, reason) {
    if (
      stopping ||
      current !== child ||
      expectedExits.has(current) ||
      recoveryScheduled.has(current)
    )
      return;
    recoveryScheduled.add(current);
    const startedAt = gatewayStartedAt.get(current);
    if (startedAt && Date.now() - startedAt >= 60_000) crashAttempts = 0;
    scheduleRetry(`Gateway exited unexpectedly (${reason})`);
  }
  const restartQueue = createRestartQueue({
    prepare: async () => {
      await prepareDependencies();
      // Static gateway imports can cache shared before index.ts checks its
      // build. Emit it in a separate process before loading any gateway code.
      // This watcher observes source only, so dist writes cannot restart it.
      console.log("[server-watch] Building shared before gateway replacement…");
      await command(
        "pnpm",
        ["--filter", "@agent-orchestrator/shared", "build"],
        { cwd: root, env: process.env },
      );
    },
    restart: async () => {
      if (stopping) return;
      // A source rebuild may finish before a crash-recovery timer fires.
      // Its successful replacement satisfies that recovery request too.
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      await stopChild();
      if (stopping) return;
      // Run tsx in this process rather than through a shell/CLI child tree.
      child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: serverRoot,
        env: process.env,
        stdio: "inherit",
      });
      const gateway = child;
      gatewayStartedAt.set(gateway, Date.now());
      gateway.on("error", (error) => {
        console.error(`[server-watch] Gateway spawn error: ${error.message}`);
        scheduleRecovery(gateway, `spawn error: ${error.message}`);
      });
      gateway.on("exit", (code, signal) => {
        const reason = signal
          ? `signal ${signal}`
          : `code ${code ?? "unknown"}`;
        scheduleRecovery(gateway, reason);
      });
    },
    onError: (error) => {
      const live =
        child?.pid && child.exitCode === null && child.signalCode === null;
      console.error(
        live
          ? "[server-watch] Preparation failed; current gateway retained. Fix dependencies or the shared build and save a watched file to retry."
          : "[server-watch] Preparation failed; gateway is unavailable. Recovery will retry automatically.",
        error.message,
      );
      if (!live) scheduleRetry("Gateway recovery preparation failed");
    },
  });
  request = () => {
    clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    return restartQueue();
  };
  const changed = () => {
    clearTimeout(timer);
    crashAttempts = 0;
    timer = setTimeout(() => {
      if (!stopping) void request();
    }, 500);
  };
  for (const path of ["apps/server/src", "packages/shared/src"]) {
    watchers.push(
      watch(resolve(root, path), { recursive: true }, (_event, name) => {
        if (name && /\.(?:ts|tsx|js|mjs|json)$/.test(String(name))) changed();
      }),
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
      watch(resolve(root, path), (_event, name) => {
        if (names.includes(String(name))) changed();
      }),
    );
  }
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      stopping = true;
      clearTimeout(timer);
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
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
