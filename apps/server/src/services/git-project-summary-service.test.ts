import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitProjectSummaryService } from "./git-project-summary-service.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("reads project, branch, worktree and diff statistics", async () => {
  const root = mkdtempSync(join(tmpdir(), "kanban-git-summary-"));
  const repository = join(root, "sample-project");
  const worktree = join(root, "sample-worktree");
  mkdirSync(repository);

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["config", "user.email", "test@example.com"]);
    git(repository, ["config", "user.name", "Test User"]);
    writeFileSync(join(repository, "tracked.txt"), "one\ntwo\n");
    git(repository, ["add", "tracked.txt"]);
    git(repository, ["commit", "-m", "initial"]);
    git(repository, ["worktree", "add", "-b", "feature/summary", worktree]);

    writeFileSync(join(worktree, "tracked.txt"), "one\nchanged\nthree\n");
    writeFileSync(join(worktree, "new.txt"), "untracked\n");

    const summary = await new GitProjectSummaryService().read(worktree);

    assert.equal(summary.available, true);
    assert.equal(summary.projectName, "sample-project");
    assert.equal(summary.branch, "feature/summary");
    assert.equal(summary.isWorktree, true);
    assert.equal(summary.changedFiles, 2);
    assert.equal(summary.addedLines, 2);
    assert.equal(summary.deletedLines, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("returns the directory name for a non-Git project", async () => {
  const root = mkdtempSync(join(tmpdir(), "kanban-non-git-summary-"));
  const project = join(root, "plain-project");
  mkdirSync(project);

  try {
    const summary = await new GitProjectSummaryService().read(project);
    assert.deepEqual(summary, {
      available: true,
      projectName: "plain-project",
      isGitRepository: false,
      updatedAt: summary.updatedAt,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});