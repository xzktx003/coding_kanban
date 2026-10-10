#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HEAD_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const HEAD_WAIT_TIMEOUT_MS = 5 * 60_000;
const HEAD_POLL_INTERVAL_MS = 250;
const COMMAND_TIMEOUT_MS = 60 * 60_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readGitHead(sourceRoot) {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function runCommand(command, args, { cwd, env }) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`,
    );
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function finalizeOnlineUpdate({
  repositoryRoot,
  sourceRoot,
  targetHead,
  readHead = readGitHead,
  runCommand: run = runCommand,
  sleep = delay,
  timeoutMs = HEAD_WAIT_TIMEOUT_MS,
  pollIntervalMs = HEAD_POLL_INTERVAL_MS,
  env = process.env,
  logger = console,
}) {
  if (!TARGET_HEAD_PATTERN.test(targetHead ?? "")) {
    throw new Error("online update has an invalid target revision");
  }

  const deadline = Date.now() + timeoutMs;
  let currentHead = null;
  while (true) {
    currentHead = await readHead(sourceRoot);
    if (currentHead === targetHead) break;
    if (Date.now() >= deadline) {
      throw new Error("confirmed revision was not applied before timeout");
    }
    await sleep(pollIntervalMs);
  }

  try {
    await run("pnpm", ["install", "--frozen-lockfile"], {
      cwd: sourceRoot,
      env,
    });
  } catch (error) {
    logger.error(
      "[online-update] frozen dependency installation failed; restart skipped",
      error,
    );
    throw new Error("dependency installation failed", { cause: error });
  }

  await run("pnpm", ["dev:restart"], {
    cwd: repositoryRoot,
    env: { ...env, APP_SOURCE_ROOT: sourceRoot },
  });

  logger.log(
    `[online-update] dependencies installed and application restarted at ${targetHead}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [targetHead, sourceRootArgument] = process.argv.slice(2);
  try {
    if (!targetHead || !sourceRootArgument) {
      throw new Error("expected target revision and source root");
    }
    await finalizeOnlineUpdate({
      repositoryRoot,
      sourceRoot: resolve(sourceRootArgument),
      targetHead,
    });
  } catch (error) {
    console.error(
      "[online-update] finalization failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  }
}
