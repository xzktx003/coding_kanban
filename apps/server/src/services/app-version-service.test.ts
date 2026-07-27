import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  AppVersionService,
  readBoundedFilePrefix,
} from "./app-version-service.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createGitRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-version-"));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.name", "Coding Kanban Test"]);
  git(directory, ["config", "user.email", "coding-kanban@example.invalid"]);
  writeFileSync(join(directory, "app.ts"), "export const value = 1;\n");
  git(directory, ["add", "app.ts"]);
  git(directory, ["commit", "-qm", "initial"]);
  return directory;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`process ${pid} was still running after ${timeoutMs}ms`);
}

test("source revision changes for tracked edits, untracked files, and commits", async () => {
  const sourceRoot = createGitRepository();

  try {
    const service = new AppVersionService({
      sourceRoot,
      cacheTtlMs: 0,
      runtimeId: "runtime-test",
      startedAt: "2026-07-27T00:00:00.000Z",
    });
    const initial = await service.getVersion();

    writeFileSync(join(sourceRoot, "app.ts"), "export const value = 2;\n");
    const trackedEdit = await service.getVersion();
    assert.notEqual(trackedEdit.sourceRevision, initial.sourceRevision);

    writeFileSync(
      join(sourceRoot, "new-file.ts"),
      "export const added = true;\n",
    );
    const untrackedEdit = await service.getVersion();
    assert.notEqual(untrackedEdit.sourceRevision, trackedEdit.sourceRevision);

    git(sourceRoot, ["add", "."]);
    git(sourceRoot, ["commit", "-qm", "update"]);
    const committed = await service.getVersion();
    assert.notEqual(committed.sourceRevision, untrackedEdit.sourceRevision);
    assert.equal(committed.gitHead, git(sourceRoot, ["rev-parse", "HEAD"]));
    assert.equal(committed.gitAvailable, true);
    assert.equal(committed.runtimeId, "runtime-test");
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("source revision includes branch identity even when tree content matches", async () => {
  const sourceRoot = createGitRepository();

  try {
    const service = new AppVersionService({
      sourceRoot,
      cacheTtlMs: 0,
    });
    const initial = await service.getVersion();

    git(sourceRoot, ["checkout", "-qb", "feature/hot-update"]);
    const switched = await service.getVersion();

    assert.notEqual(switched.sourceRevision, initial.sourceRevision);
    assert.equal(switched.gitBranch, "feature/hot-update");
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("returns a stable degraded response when the source root is not a git repository", async () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "coding-kanban-no-git-"));

  try {
    const service = new AppVersionService({
      sourceRoot,
      cacheTtlMs: 0,
      runtimeId: "runtime-degraded",
    });
    const first = await service.getVersion();
    const second = await service.getVersion();

    assert.equal(first.gitAvailable, false);
    assert.equal(first.gitHead, null);
    assert.equal(first.gitBranch, null);
    assert.equal(first.sourceRevision, second.sourceRevision);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("coalesces concurrent fingerprint reads and serves the completed value from cache", async () => {
  let sourceStateReads = 0;
  let releaseSourceState: (() => void) | undefined;
  const sourceStateGate = new Promise<void>((resolve) => {
    releaseSourceState = resolve;
  });
  const service = new AppVersionService({
    sourceRoot: "/unused",
    cacheTtlMs: 1_000,
    runtimeId: "runtime-single-flight",
    sourceStateLoader: async () => {
      sourceStateReads += 1;
      await sourceStateGate;
      return {
        sourceRevision: "revision-single-flight",
        gitAvailable: true,
        gitHead: "0123456789abcdef",
        gitBranch: "feature/single-flight",
      };
    },
  });

  const first = service.getVersion();
  const second = service.getVersion();

  assert.equal(sourceStateReads, 1);
  releaseSourceState?.();
  assert.deepEqual(await first, await second);
  assert.equal(
    (await service.getVersion()).sourceRevision,
    "revision-single-flight",
  );
  assert.equal(sourceStateReads, 1);
});

test("reads only the requested prefix of an untracked file", async () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "coding-kanban-bounded-read-"));
  const filePath = join(sourceRoot, "large-untracked.bin");

  try {
    writeFileSync(filePath, Buffer.alloc(1024, 0x61));
    assert.deepEqual(
      await readBoundedFilePrefix(filePath, 16),
      Buffer.alloc(16, 0x61),
    );
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("continues bounded prefix reads after short reads until EOF", async (t) => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "coding-kanban-short-read-"));
  const filePath = join(sourceRoot, "short-reads.bin");

  try {
    writeFileSync(filePath, "abcdefgh");
    const fileHandle = await open(filePath, "r");
    type ReadableFileHandle = {
      read(
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ): Promise<{ bytesRead: number; buffer: Buffer }>;
    };
    const prototype = Object.getPrototypeOf(fileHandle) as ReadableFileHandle;
    const originalRead = prototype.read;
    const readPositions: Array<number | null> = [];
    await fileHandle.close();

    t.mock.method(
      prototype,
      "read",
      async function (
        this: ReadableFileHandle,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number | null,
      ) {
        readPositions.push(position);
        return originalRead.call(
          this,
          buffer,
          offset,
          Math.min(length, 3),
          position,
        );
      },
    );

    assert.deepEqual(
      await readBoundedFilePrefix(filePath, 10),
      Buffer.from("abcdefgh"),
    );
    assert.deepEqual(readPositions, [0, 3, 6, 8]);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("keeps Git fingerprinting available when a tracked binary diff exceeds the old buffer limit", async () => {
  const sourceRoot = createGitRepository();
  const binaryPath = join(sourceRoot, "large.bin");

  try {
    writeFileSync(binaryPath, randomBytes(17 * 1024 * 1024));
    git(sourceRoot, ["add", "large.bin"]);
    git(sourceRoot, ["commit", "-qm", "add large binary"]);

    const service = new AppVersionService({
      sourceRoot,
      cacheTtlMs: 0,
    });
    const initial = await service.getVersion();

    writeFileSync(binaryPath, randomBytes(17 * 1024 * 1024));
    const changed = await service.getVersion();

    assert.equal(changed.gitAvailable, true);
    assert.notEqual(changed.sourceRevision, initial.sourceRevision);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test("force-kills a timed-out Git diff before returning degraded state", async () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "coding-kanban-git-timeout-"));
  const fakeGitDirectory = mkdtempSync(
    join(tmpdir(), "coding-kanban-fake-git-"),
  );
  const fakeGitPath = join(fakeGitDirectory, "git");
  const pidPath = join(sourceRoot, ".git-diff-pid");
  const originalPath = process.env.PATH;
  let diffPid: number | undefined;

  try {
    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
case "$1" in
  rev-parse)
    printf '%s\\n' '0123456789abcdef0123456789abcdef01234567'
    ;;
  branch)
    printf '%s\\n' 'main'
    ;;
  ls-files)
    exit 0
    ;;
  diff)
    printf '%s\\n' "$$" > .git-diff-pid
    trap '' TERM
    while true; do
      sleep 1
    done
    ;;
  *)
    exit 2
    ;;
esac
`,
    );
    chmodSync(fakeGitPath, 0o755);
    process.env.PATH = originalPath
      ? `${fakeGitDirectory}${delimiter}${originalPath}`
      : fakeGitDirectory;

    const service = new AppVersionService({
      sourceRoot,
      cacheTtlMs: 0,
    });
    const result = await service.getVersion();

    assert.equal(result.gitAvailable, false);
    diffPid = Number.parseInt(readFileSync(pidPath, "utf8"), 10);
    await waitForProcessExit(diffPid, 1_000);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (diffPid !== undefined && isProcessRunning(diffPid)) {
      process.kill(diffPid, "SIGKILL");
    }
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(fakeGitDirectory, { recursive: true, force: true });
  }
});
