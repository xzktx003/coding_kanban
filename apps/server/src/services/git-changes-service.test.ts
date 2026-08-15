import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitChangesService } from "./git-changes-service.js";

test("GitChangesService returns tracked modifications and untracked file diffs", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "before\n");
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    execFileSync("git", ["add", "tracked.txt", ".gitignore"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    writeFileSync(join(root, "tracked.txt"), "after\nsecond\n");
    writeFileSync(join(root, "new.txt"), "new file\n");
    writeFileSync(join(root, "ignored.txt"), "generated output\n");

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.equal(result.scope, "checkout");
    assert.equal(result.changedFiles, 2);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [
        ["new.txt", "untracked"],
        ["tracked.txt", "modified"],
      ],
    );
    assert.match(result.files[0]!.patch, /\+new file/);
    assert.equal(result.files[0]!.addedLines, 1);
    assert.match(result.files[1]!.patch, /-before/);
    assert.match(result.files[1]!.patch, /\+after/);
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

test("GitChangesService expands untracked directories into individual file diffs", async () => {
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
    assert.equal(result.changedFiles, 1);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [["new-folder/nested/new.txt", "untracked"]],
    );
    assert.match(result.files[0]!.patch, /\+new/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService includes empty and non-empty untracked files", async () => {
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
    assert.equal(result.changedFiles, 2);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [
        ["empty.done", "untracked"],
        ["meaningful.txt", "untracked"],
      ],
    );
    assert.match(result.files[0]!.patch, /new file mode 100644/);
    assert.match(result.files[1]!.patch, /\+content/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService keeps untracked outputs visible after tracked changes are committed", async () => {
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
    assert.equal(result.changedFiles, 1);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [["results/runtime.json", "untracked"]],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService returns staged additions and tracked deletions with full diffs", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-changes-statuses-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "removed.txt"), "first\nsecond\n");
    execFileSync("git", ["add", "removed.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    rmSync(join(root, "removed.txt"));
    writeFileSync(join(root, "staged.txt"), "brand new\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: root });

    const result = await new GitChangesService().read(root);

    assert.equal(result.available, true);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [
        ["removed.txt", "deleted"],
        ["staged.txt", "added"],
      ],
    );
    assert.match(result.files[0]!.patch, /-first/);
    assert.equal(result.files[0]!.deletedLines, 2);
    assert.match(result.files[1]!.patch, /\+brand new/);
    assert.equal(result.files[1]!.addedLines, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
