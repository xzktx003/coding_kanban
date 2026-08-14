import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitChangesService } from "./git-changes-service.js";

test("GitChangesService returns tracked modifications and ignores untracked files", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    writeFileSync(join(root, "tracked.txt"), "after\nsecond\n");
    writeFileSync(join(root, "new.txt"), "new file\n");

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.equal(result.scope, "checkout");
    assert.equal(result.changedFiles, 1);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [["tracked.txt", "modified"]],
    );
    assert.match(result.files[0]!.patch, /-before/);
    assert.match(result.files[0]!.patch, /\+after/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService rejects a missing working directory without running Git", async () => {
  const result = await new GitChangesService().read(undefined);
  assert.equal(result.available, false);
  assert.equal(result.changedFiles, 0);
  assert.equal(result.unavailableReason, "没有工作目录");
});

test("GitChangesService excludes untracked directories and their files", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-directory-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "initial\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    mkdirSync(join(root, "new-folder", "nested"), { recursive: true });
    writeFileSync(join(root, "new-folder", "nested", "new.txt"), "new\n");

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.equal(result.changedFiles, 0);
    assert.deepEqual(result.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService excludes empty untracked marker files", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-empty-file-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "initial\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    writeFileSync(join(root, "empty.done"), "");
    writeFileSync(join(root, "meaningful.txt"), "content\n");

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.equal(result.changedFiles, 0);
    assert.deepEqual(result.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService is empty after tracked changes are committed even when untracked outputs remain", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-after-commit-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "initial\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    writeFileSync(join(root, "tracked.txt"), "uploaded\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "uploaded change"], { cwd: root });
    mkdirSync(join(root, "results"), { recursive: true });
    writeFileSync(join(root, "results", "runtime.json"), "{}\n");

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.equal(result.changedFiles, 0);
    assert.deepEqual(result.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});