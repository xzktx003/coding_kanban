import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHARED_BUILD_TIMEOUT_MS = 120_000;
const SHARED_BUILD_MAX_BUFFER = 256 * 1024;

export type SharedPackageBuildRunner = (
  command: string,
  args: string[],
  repositoryRoot: string,
) => Promise<void>;

async function runSharedPackageBuild(
  command: string,
  args: string[],
  repositoryRoot: string,
): Promise<void> {
  await execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
    },
    maxBuffer: SHARED_BUILD_MAX_BUFFER,
    timeout: SHARED_BUILD_TIMEOUT_MS,
  });
}

export async function ensureSharedPackageBuilt(
  repositoryRoot: string,
  runner: SharedPackageBuildRunner = runSharedPackageBuild,
): Promise<void> {
  await runner(
    "pnpm",
    ["--filter", "@agent-orchestrator/shared", "build"],
    repositoryRoot,
  );
}
