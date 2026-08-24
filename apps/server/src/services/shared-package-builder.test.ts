import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureSharedPackageBuilt,
  isSharedPackageBuildRequired,
} from "./shared-package-builder.js";

test("builds the workspace shared package before server startup", async () => {
  let invocation:
    | {
        command: string;
        args: string[];
        repositoryRoot: string;
      }
    | undefined;

  await ensureSharedPackageBuilt(
    "/workspace/coding-kanban",
    async (command, args, repositoryRoot) => {
      invocation = { command, args: [...args], repositoryRoot };
    },
    async () => true,
  );

  assert.deepEqual(invocation, {
    command: "pnpm",
    args: ["--filter", "@agent-orchestrator/shared", "build"],
    repositoryRoot: "/workspace/coding-kanban",
  });
});

test("surfaces a shared package build failure", async () => {
  await assert.rejects(
    ensureSharedPackageBuilt(
      "/workspace/coding-kanban",
      async () => {
        throw new Error("shared build failed");
      },
      async () => true,
    ),
    /shared build failed/,
  );
});

test("skips rebuilding when every shared output is newer than its source", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "kanban-shared-build-"));
  const sharedRoot = join(repositoryRoot, "packages", "shared");
  const sourcePath = join(sharedRoot, "src", "index.ts");
  const outputPath = join(sharedRoot, "dist", "index.js");

  try {
    await mkdir(join(sharedRoot, "src"), { recursive: true });
    await mkdir(join(sharedRoot, "dist"), { recursive: true });
    await writeFile(sourcePath, "export const value = 1;\n");
    await writeFile(outputPath, "export const value = 1;\n");
    await writeFile(join(sharedRoot, "package.json"), "{}\n");
    await writeFile(join(sharedRoot, "tsconfig.json"), "{}\n");

    const oldTime = new Date("2026-08-23T00:00:00.000Z");
    const newTime = new Date("2026-08-24T00:00:00.000Z");
    await Promise.all([
      utimes(sourcePath, oldTime, oldTime),
      utimes(join(sharedRoot, "package.json"), oldTime, oldTime),
      utimes(join(sharedRoot, "tsconfig.json"), oldTime, oldTime),
      utimes(outputPath, newTime, newTime),
    ]);

    assert.equal(await isSharedPackageBuildRequired(repositoryRoot), false);

    let buildCount = 0;
    await ensureSharedPackageBuilt(repositoryRoot, async () => {
      buildCount += 1;
    });
    assert.equal(buildCount, 0);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("rebuilds when a shared source is newer than its emitted module", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "kanban-shared-build-"));
  const sharedRoot = join(repositoryRoot, "packages", "shared");
  const sourcePath = join(sharedRoot, "src", "index.ts");
  const outputPath = join(sharedRoot, "dist", "index.js");

  try {
    await mkdir(join(sharedRoot, "src"), { recursive: true });
    await mkdir(join(sharedRoot, "dist"), { recursive: true });
    await writeFile(sourcePath, "export const value = 2;\n");
    await writeFile(outputPath, "export const value = 1;\n");
    await writeFile(join(sharedRoot, "package.json"), "{}\n");
    await writeFile(join(sharedRoot, "tsconfig.json"), "{}\n");

    const oldTime = new Date("2026-08-23T00:00:00.000Z");
    const newTime = new Date("2026-08-24T00:00:00.000Z");
    await Promise.all([
      utimes(sourcePath, newTime, newTime),
      utimes(join(sharedRoot, "package.json"), oldTime, oldTime),
      utimes(join(sharedRoot, "tsconfig.json"), oldTime, oldTime),
      utimes(outputPath, oldTime, oldTime),
    ]);

    assert.equal(await isSharedPackageBuildRequired(repositoryRoot), true);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
