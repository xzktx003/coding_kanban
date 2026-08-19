import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

test("GitChangesService reverts only the selected hunk and preserves another hunk in the same file", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-hunk-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    const originalLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
    writeFileSync(join(root, "tracked.txt"), `${originalLines.join("\n")}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    const changedLines = [...originalLines];
    changedLines[1] = "changed near start";
    changedLines[21] = "changed near end";
    writeFileSync(join(root, "tracked.txt"), `${changedLines.join("\n")}\n`);

    const service = new GitChangesService();
    const before = await service.read(root);
    const headers = before.files[0]!.patch.match(/^@@.*@@.*$/gm) ?? [];
    assert.equal(headers.length, 2);

    await service.revertHunk(root, "tracked.txt", 0, headers[0]!);

    const content = readFileSync(join(root, "tracked.txt"), "utf8");
    assert.match(content, /line 2/);
    assert.doesNotMatch(content, /changed near start/);
    assert.match(content, /changed near end/);
    const afterHeaders =
      (await service.read(root)).files[0]!.patch.match(/^@@.*@@.*$/gm) ?? [];
    assert.equal(afterHeaders.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService reverts a staged hunk from both index and worktree", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-staged-hunk-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    const originalLines = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
    writeFileSync(join(root, "tracked.txt"), `${originalLines.join("\n")}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    const changedLines = [...originalLines];
    changedLines[1] = "staged near start";
    changedLines[21] = "staged near end";
    writeFileSync(join(root, "tracked.txt"), `${changedLines.join("\n")}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });

    const service = new GitChangesService();
    const file = (await service.read(root)).files[0]!;
    const headers = file.patch.match(/^@@.*@@.*$/gm) ?? [];
    await service.revertHunk(root, file.path, 0, headers[0]!);

    const stagedPatch = execFileSync(
      "git",
      ["diff", "--cached", "HEAD", "--", "tracked.txt"],
      { cwd: root, encoding: "utf8" },
    );
    assert.doesNotMatch(stagedPatch, /staged near start/);
    assert.match(stagedPatch, /staged near end/);
    assert.doesNotMatch(
      readFileSync(join(root, "tracked.txt"), "utf8"),
      /staged near start/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService reverts a hunk containing both staged and unstaged edits", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-mixed-hunk-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    const originalLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    writeFileSync(join(root, "tracked.txt"), `${originalLines.join("\n")}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    const stagedLines = [...originalLines];
    stagedLines[5] = "staged edit";
    writeFileSync(join(root, "tracked.txt"), `${stagedLines.join("\n")}\n`);
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    const mixedLines = [...stagedLines];
    mixedLines[6] = "unstaged edit";
    writeFileSync(join(root, "tracked.txt"), `${mixedLines.join("\n")}\n`);

    const service = new GitChangesService();
    const file = (await service.read(root)).files[0]!;
    const header = file.patch.match(/^@@.*@@.*$/m)?.[0];
    assert.ok(header);

    await service.revertHunk(root, file.path, 0, header);

    assert.equal(
      readFileSync(join(root, "tracked.txt"), "utf8"),
      `${originalLines.join("\n")}\n`,
    );
    assert.equal(
      execFileSync("git", ["status", "--short"], {
        cwd: root,
        encoding: "utf8",
      }),
      "",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService removes an untracked file when reverting its only hunk", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-untracked-hunk-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "original\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    writeFileSync(join(root, "new.txt"), "new file\n");

    const service = new GitChangesService();
    const file = (await service.read(root)).files[0]!;
    const header = file.patch.match(/^@@.*@@.*$/m)?.[0];
    assert.ok(header);

    await service.revertHunk(root, file.path, 0, header);

    assert.equal(existsSync(join(root, "new.txt")), false);
    assert.equal((await service.read(root)).changedFiles, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService reverts text inside a rename without undoing the rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-renamed-hunk-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    const originalLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    writeFileSync(join(root, "before.txt"), `${originalLines.join("\n")}\n`);
    execFileSync("git", ["add", "before.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });

    execFileSync("git", ["mv", "before.txt", "after.txt"], { cwd: root });
    const changedLines = [...originalLines];
    changedLines[5] = "changed inside rename";
    writeFileSync(join(root, "after.txt"), `${changedLines.join("\n")}\n`);

    const service = new GitChangesService();
    const file = (await service.read(root)).files[0]!;
    const header = file.patch.match(/^@@.*@@.*$/m)?.[0];
    assert.equal(file.status, "renamed");
    assert.ok(header);

    await service.revertHunk(root, file.path, 0, header);

    assert.equal(existsSync(join(root, "before.txt")), false);
    assert.equal(existsSync(join(root, "after.txt")), true);
    assert.doesNotMatch(
      readFileSync(join(root, "after.txt"), "utf8"),
      /changed inside rename/,
    );
    assert.equal((await service.read(root)).files[0]!.status, "renamed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitChangesService rejects stale hunk identities and paths outside the checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-revert-hunk-boundary-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "initial\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "initial"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "changed\n");

    const service = new GitChangesService();
    const header = (await service.read(root)).files[0]!.patch.match(/^@@.*@@.*$/m)?.[0];
    assert.ok(header);

    await assert.rejects(
      service.revertHunk(root, "tracked.txt", 0, "@@ -999 +999 @@"),
      /改动块已发生变化/,
    );

    await assert.rejects(
      service.revertHunk(root, "../outside.txt", 0, header),
      /Git 文件路径越界/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
