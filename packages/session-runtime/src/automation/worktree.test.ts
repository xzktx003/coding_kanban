import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitService } from "../git/index.js";
import { automationWorktree, worktreeKey } from "./worktree.js";
const exec = promisify(execFile);
test("automation worktrees preserve unreviewed content and differences from current project HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "auto-wt-"));
  const project = join(root, "repo");
  const git = async (...args: string[]) => exec("git", args, { cwd: project });
  try {
    await exec("git", ["init", project]);
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(project, "file"), "one");
    await git("add", "file");
    await git("commit", "-m", "initial");
    const prepare = automationWorktree(
      new GitService({ dataHome: join(root, "data") }),
    );
    const first = await prepare("task", project);
    await writeFile(join(first, "unreviewed"), "keep");
    assert.equal(await prepare("task", project), first);
    assert.equal(await readFile(join(first, "unreviewed"), "utf8"), "keep");
    await rm(join(first, "unreviewed"));
    await writeFile(join(project, "file"), "two");
    await git("add", "file");
    await git("commit", "-m", "new");
    const refreshed = await prepare("task", project);
    assert.equal(await readFile(join(refreshed, "file"), "utf8"), "one");
    assert.notEqual(
      worktreeKey("task", "/a/app"),
      worktreeKey("task", "/b/app"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
