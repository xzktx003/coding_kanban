import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { resolve } from "node:path";

type SpawnChild = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface OnlineUpdateFinalizerOptions {
  repositoryRoot: string;
  sourceRoot: string;
  targetHead: string;
  spawnChild?: SpawnChild;
}

export async function scheduleOnlineUpdateFinalizer({
  repositoryRoot,
  sourceRoot,
  targetHead,
  spawnChild = spawn,
}: OnlineUpdateFinalizerOptions): Promise<() => void> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(targetHead)) {
    throw new Error("远程更新 revision 无效，未修改工作区。");
  }

  const runtimeDirectory = resolve(repositoryRoot, ".dev-runtime");
  mkdirSync(runtimeDirectory, { recursive: true });
  const finalizerPath = resolve(
    runtimeDirectory,
    "online-update-finalizer.mjs",
  );
  copyFileSync(
    resolve(repositoryRoot, "scripts/finalize-online-update.mjs"),
    finalizerPath,
  );
  const logPath = resolve(runtimeDirectory, "online-update.log");
  const logFd = openSync(logPath, "a");
  writeSync(
    logFd,
    `\n[${new Date().toISOString()}] Waiting to finalize online update ${targetHead}.\n`,
  );

  let child: ChildProcess;
  try {
    child = spawnChild(
      process.execPath,
      [finalizerPath, targetHead, sourceRoot],
      {
        cwd: repositoryRoot,
        env: { ...process.env, APP_SOURCE_ROOT: sourceRoot },
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );
  } finally {
    closeSync(logFd);
  }

  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    child.once("spawn", () => resolveSpawn());
    child.once("error", rejectSpawn);
  });
  child.unref();

  return () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  };
}
