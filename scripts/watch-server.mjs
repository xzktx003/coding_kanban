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

export function createDependencyPreparation({ root, run = command }) {
  const manifests = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/server/package.json",
    "apps/web/package.json",
    "packages/shared/package.json",
  ];
  let installed;
  const fingerprintNow = () =>
    manifests
      .map((path) => readFileSync(resolve(root, path), "utf8"))
      .join("\n");
  return async () => {
    while (true) {
      const fingerprint = fingerprintNow();
      const serverRequire = createRequire(
        resolve(root, "apps/server/package.json"),
      );
      const { dependencies } = JSON.parse(
        readFileSync(resolve(root, "apps/server/package.json"), "utf8"),
      );
      let missing = false;
      for (const name of Object.keys(dependencies)) {
        try {
          if (!existsSync(serverRequire.resolve(name))) missing = true;
        } catch {
          missing = true;
        }
      }
      if (installed !== fingerprint || missing) {
        console.log(
          "[server-watch] Preparing locked dependencies before gateway replacement…",
        );
        await run("pnpm", ["install", "--frozen-lockfile"], {
          cwd: root,
          env: process.env,
        });
        if (fingerprintNow() !== fingerprint) continue;
        for (const name of Object.keys(dependencies)) {
          if (!existsSync(serverRequire.resolve(name)))
            throw new Error(`Missing dependency: ${name}`);
        }
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
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const current = child;
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
      await stopChild();
      if (stopping) return;
      // Run tsx in this process rather than through a shell/CLI child tree.
      child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: serverRoot,
        env: process.env,
        stdio: "inherit",
      });
      child.on("error", (error) => console.error("[server-watch]", error));
      child.on("exit", (code, signal) => {
        if (code && !stopping)
          console.error(
            `[server-watch] Gateway exited (${code ?? signal}); waiting for the next source change.`,
          );
      });
    },
    onError: (error) =>
      console.error(
        "[server-watch] Preparation failed; current gateway retained. Fix dependencies and save a watched file to retry.",
        error.message,
      ),
  });
  const changed = () => {
    clearTimeout(timer);
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
