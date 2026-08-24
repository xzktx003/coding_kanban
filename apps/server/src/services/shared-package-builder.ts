import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHARED_BUILD_TIMEOUT_MS = 120_000;
const SHARED_BUILD_MAX_BUFFER = 256 * 1024;

export type SharedPackageBuildRunner = (
  command: string,
  args: string[],
  repositoryRoot: string,
) => Promise<void>;

export type SharedPackageBuildRequirementChecker = (
  repositoryRoot: string,
) => Promise<boolean>;

async function listSharedSourceFiles(
  sourceDirectory: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(sourceDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(sourceDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSharedSourceFiles(entryPath)));
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

async function fileModifiedAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function isSharedPackageBuildRequired(
  repositoryRoot: string,
): Promise<boolean> {
  const sharedRoot = join(repositoryRoot, "packages", "shared");
  const sourceRoot = join(sharedRoot, "src");
  const sourceFiles = await listSharedSourceFiles(sourceRoot);
  if (sourceFiles.length === 0) return true;

  const outputModifiedTimes: number[] = [];
  for (const sourcePath of sourceFiles) {
    const relativeSourcePath = relative(sourceRoot, sourcePath);
    const outputPath = join(
      sharedRoot,
      "dist",
      relativeSourcePath.replace(/\.ts$/, ".js"),
    );
    const [sourceModifiedAt, outputModifiedAt] = await Promise.all([
      fileModifiedAt(sourcePath),
      fileModifiedAt(outputPath),
    ]);
    if (
      sourceModifiedAt === null ||
      outputModifiedAt === null ||
      sourceModifiedAt > outputModifiedAt
    ) {
      return true;
    }
    outputModifiedTimes.push(outputModifiedAt);
  }

  const oldestOutputModifiedAt = Math.min(...outputModifiedTimes);
  const configPaths = [
    join(sharedRoot, "package.json"),
    join(sharedRoot, "tsconfig.json"),
    join(repositoryRoot, "tsconfig.base.json"),
  ];
  for (const configPath of configPaths) {
    const configModifiedAt = await fileModifiedAt(configPath);
    if (
      configModifiedAt !== null &&
      configModifiedAt > oldestOutputModifiedAt
    ) {
      return true;
    }
  }

  return false;
}

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
  isBuildRequired: SharedPackageBuildRequirementChecker = isSharedPackageBuildRequired,
): Promise<void> {
  if (!(await isBuildRequired(repositoryRoot))) return;

  await runner(
    "pnpm",
    ["--filter", "@agent-orchestrator/shared", "build"],
    repositoryRoot,
  );
}
