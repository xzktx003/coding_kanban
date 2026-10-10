import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexHostWorkspaceService } from "./codex-host-workspace.js";
const execute = promisify(execFile);
test("plain project Git state is unavailable without blocking independent project instructions", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-plain-project-"));
  try {
    const service = new CodexHostWorkspaceService(home);
    const state = await service.gitState(home);
    assert.equal(state.git.available, false);
    assert.equal(state.git.repoRoot, null);
    assert.equal(state.git.mutationAllowed, false);
    assert.equal(state.branch, null);
    assert.equal(state.dirty, null);
    assert.match(state.git.reason!, /Git/);
    const before = await service.instructions(home);
    const saved = await service.saveInstructions(
      home,
      "plain instructions",
      before.revision,
    );
    assert.equal(saved.text, "plain instructions");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("nested project displays its canonical ancestor repo but cannot mutate that repository", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-git-scope-"));
  try {
    await execute("git", ["init", "-q", home]);
    await writeFile(join(home, "file.txt"), "one");
    await execute("git", ["-C", home, "add", "--", "file.txt"]);
    await execute("git", [
      "-C",
      home,
      "-c",
      "user.name=isolated",
      "-c",
      "user.email=isolated@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);
    const nested = join(home, "nested");
    await mkdir(nested);
    const service = new CodexHostWorkspaceService(join(home, "app-data"));
    const state = await service.gitState(nested);
    assert.equal(state.git.repoRoot, await realpath(home));
    assert.equal(state.git.available, true);
    assert.equal(state.git.mutationAllowed, false);
    assert.match(state.git.reason!, /项目外/);
    await assert.rejects(
      service.createBranch(nested, "forbidden-branch"),
      /项目外/,
    );
    await assert.rejects(service.checkout(nested, state.branch!), /项目外/);
    await assert.rejects(
      service.createWorktree(nested, state.branch!),
      /项目外/,
    );
    const after = await service.gitState(home);
    assert.equal(after.branch, state.branch);
    assert.equal(after.branches.includes("forbidden-branch"), false);
    assert.equal(
      (
        await execute("git", ["-C", home, "worktree", "list", "--porcelain"])
      ).stdout.split("worktree ").length - 1,
      1,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("AGENTS writes use captured file revision and cannot overwrite an external edit", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-host-workspace-"));
  try {
    const service = new CodexHostWorkspaceService(home),
      before = await service.instructions(home);
    await service.saveInstructions(home, "first", before.revision);
    await writeFile(join(home, "AGENTS.md"), "external edit");
    await assert.rejects(
      service.saveInstructions(home, "new", before.revision),
      /改变/,
    );
    assert.equal(
      await readFile(join(home, "AGENTS.md"), "utf8"),
      "external edit",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("branch creation preserves current branch; checkout rejects dirty files and invalid arguments", async () => {
  const home = await mkdtemp(join(tmpdir(), "kanban-host-workspace-"));
  try {
    await execute("git", ["init", "-q", home]);
    await writeFile(join(home, "file.txt"), "one");
    await execute("git", ["-C", home, "add", "--", "file.txt"]);
    await execute("git", [
      "-C",
      home,
      "-c",
      "user.name=isolated",
      "-c",
      "user.email=isolated@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);
    const service = new CodexHostWorkspaceService(home),
      old = (await service.gitState(home)).branch!;
    await service.createBranch(home, "feature-a");
    assert.equal((await service.gitState(home)).branch, old);
    await service.checkout(home, "feature-a");
    assert.equal((await service.gitState(home)).branch, "feature-a");
    await writeFile(join(home, "file.txt"), "dirty");
    await assert.rejects(service.checkout(home, old), /未提交/);
    await assert.rejects(
      service.createBranch(home, "--upload-pack=bad"),
      /分支/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
