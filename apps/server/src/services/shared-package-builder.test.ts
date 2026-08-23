import assert from "node:assert/strict";
import test from "node:test";

import { ensureSharedPackageBuilt } from "./shared-package-builder.js";

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
  );

  assert.deepEqual(invocation, {
    command: "pnpm",
    args: ["--filter", "@agent-orchestrator/shared", "build"],
    repositoryRoot: "/workspace/coding-kanban",
  });
});

test("surfaces a shared package build failure", async () => {
  await assert.rejects(
    ensureSharedPackageBuilt("/workspace/coding-kanban", async () => {
      throw new Error("shared build failed");
    }),
    /shared build failed/,
  );
});
