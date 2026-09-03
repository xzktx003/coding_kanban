import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitAutoUpdateService } from "./git-auto-update-service.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createRemoteFixture() {
  const root = await mkdtemp(join(tmpdir(), "coding-kanban-auto-pull-"));
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  const peer = join(root, "peer");

  git(root, ["init", "--bare", "--initial-branch=main", remote]);
  git(root, ["clone", remote, local]);
  git(local, ["config", "user.email", "local@example.test"]);
  git(local, ["config", "user.name", "Local Test"]);
  await writeFile(join(local, "tracked.txt"), "initial\n");
  git(local, ["add", "tracked.txt"]);
  git(local, ["commit", "-m", "initial"]);
  git(local, ["push", "-u", "origin", "main"]);

  git(root, ["clone", remote, peer]);
  git(peer, ["config", "user.email", "peer@example.test"]);
  git(peer, ["config", "user.name", "Peer Test"]);

  return {
    local,
    peer,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("only reports an available update until the user confirms the pull", async () => {
  const fixture = await createRemoteFixture();
  try {
    await writeFile(join(fixture.peer, "tracked.txt"), "remote update\n");
    git(fixture.peer, ["add", "tracked.txt"]);
    git(fixture.peer, ["commit", "-m", "remote update"]);
    git(fixture.peer, ["push"]);
    const remoteHead = git(fixture.peer, ["rev-parse", "HEAD"]);

    const service = new GitAutoUpdateService({
      sourceRoot: fixture.local,
      intervalMinutes: 10,
    });
    const available = await service.checkNow();

    assert.equal(available.phase, "available");
    assert.equal(available.remoteHead, remoteHead);
    assert.notEqual(git(fixture.local, ["rev-parse", "HEAD"]), remoteHead);
    assert.equal(
      await readFile(join(fixture.local, "tracked.txt"), "utf8"),
      "initial\n",
    );

    const updated = await service.applyUpdate();

    assert.equal(updated.phase, "updated");
    assert.equal(updated.remoteHead, remoteHead);
    assert.equal(git(fixture.local, ["rev-parse", "HEAD"]), remoteHead);
    assert.equal(
      await readFile(join(fixture.local, "tracked.txt"), "utf8"),
      "remote update\n",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("reports local worktree conflicts only after the user confirms the pull", async () => {
  const fixture = await createRemoteFixture();
  try {
    const originalHead = git(fixture.local, ["rev-parse", "HEAD"]);
    await writeFile(join(fixture.local, "tracked.txt"), "local draft\n");
    await writeFile(join(fixture.peer, "tracked.txt"), "remote update\n");
    git(fixture.peer, ["add", "tracked.txt"]);
    git(fixture.peer, ["commit", "-m", "remote update"]);
    git(fixture.peer, ["push"]);

    const service = new GitAutoUpdateService({
      sourceRoot: fixture.local,
      intervalMinutes: 30,
    });
    const available = await service.checkNow();

    assert.equal(available.phase, "available");
    assert.equal(git(fixture.local, ["rev-parse", "HEAD"]), originalHead);
    assert.equal(
      await readFile(join(fixture.local, "tracked.txt"), "utf8"),
      "local draft\n",
    );

    const conflict = await service.applyUpdate();

    assert.equal(conflict.phase, "conflict");
    assert.equal(conflict.conflictReason, "local-changes");
    assert.equal(git(fixture.local, ["rev-parse", "HEAD"]), originalHead);
    assert.equal(git(fixture.local, ["diff", "--name-only"]), "tracked.txt");
    assert.throws(() =>
      git(fixture.local, ["rev-parse", "--verify", "MERGE_HEAD"]),
    );
  } finally {
    await fixture.cleanup();
  }
});

test("reports diverged history only after confirmation without creating a merge commit", async () => {
  const fixture = await createRemoteFixture();
  try {
    await writeFile(join(fixture.local, "local.txt"), "local commit\n");
    git(fixture.local, ["add", "local.txt"]);
    git(fixture.local, ["commit", "-m", "local commit"]);
    const localHead = git(fixture.local, ["rev-parse", "HEAD"]);

    await writeFile(join(fixture.peer, "remote.txt"), "remote commit\n");
    git(fixture.peer, ["add", "remote.txt"]);
    git(fixture.peer, ["commit", "-m", "remote commit"]);
    git(fixture.peer, ["push"]);

    const service = new GitAutoUpdateService({
      sourceRoot: fixture.local,
      intervalMinutes: 10,
    });
    const available = await service.checkNow();

    assert.equal(available.phase, "available");
    assert.equal(git(fixture.local, ["rev-parse", "HEAD"]), localHead);

    const conflict = await service.applyUpdate();

    assert.equal(conflict.phase, "conflict");
    assert.equal(conflict.conflictReason, "diverged");
    assert.equal(git(fixture.local, ["rev-parse", "HEAD"]), localHead);
    assert.equal(git(fixture.local, ["status", "--porcelain"]), "");
  } finally {
    await fixture.cleanup();
  }
});

test("coalesces concurrent checks into one Git operation", async () => {
  let runs = 0;
  let release: (() => void) | undefined;
  const operation = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new GitAutoUpdateService({
    sourceRoot: "/repo",
    intervalMinutes: 10,
    checkRunner: async () => {
      runs += 1;
      await operation;
      return {
        phase: "idle",
        branch: "main",
        remoteHead: "abc",
        conflictReason: null,
        message: null,
        updated: false,
      };
    },
  });

  const first = service.checkNow();
  const second = service.checkNow();
  release?.();

  assert.deepEqual(await first, await second);
  assert.equal(runs, 1);
});

test("queues a user-confirmed apply behind an in-progress background check", async () => {
  let checkRuns = 0;
  let applyRuns = 0;
  let releaseCheck: (() => void) | undefined;
  const checkOperation = new Promise<void>((resolve) => {
    releaseCheck = resolve;
  });
  const service = new GitAutoUpdateService({
    sourceRoot: "/repo",
    intervalMinutes: 10,
    checkRunner: async () => {
      checkRuns += 1;
      await checkOperation;
      return {
        phase: "available",
        branch: "main",
        remoteHead: "abc",
        conflictReason: null,
        message: "available",
        updated: false,
      };
    },
    applyRunner: async () => {
      applyRuns += 1;
      return {
        phase: "updated",
        branch: "main",
        remoteHead: "abc",
        conflictReason: null,
        message: "updated",
        updated: true,
      };
    },
  });

  const check = service.checkNow();
  const firstApply = service.applyUpdate();
  const secondApply = service.applyUpdate();

  assert.equal(applyRuns, 0);
  releaseCheck?.();

  assert.equal((await check).phase, "available");
  assert.equal((await firstApply).phase, "updated");
  assert.equal((await secondApply).phase, "updated");
  assert.equal(checkRuns, 1);
  assert.equal(applyRuns, 1);
});

test("returns a bounded generic error without exposing the source path", async () => {
  const sourceRoot = "/private/machine/path/that-does-not-exist";
  const service = new GitAutoUpdateService({
    sourceRoot,
    intervalMinutes: 10,
  });

  const status = await service.checkNow();

  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /Git 上游分支、网络或凭证配置/);
  assert.doesNotMatch(status.message ?? "", /private|machine|path/);
});

test("distinguishes a confirmed pull failure from a background check failure", async () => {
  const service = new GitAutoUpdateService({
    sourceRoot: "/repo",
    intervalMinutes: 10,
    applyRunner: async () => {
      throw new Error("sensitive machine details");
    },
  });

  const status = await service.applyUpdate();

  assert.equal(status.phase, "error");
  assert.match(status.message ?? "", /拉取远程版本失败/);
  assert.doesNotMatch(status.message ?? "", /sensitive|machine/);
});

test("starts an immediate check and an unref-ed interval at the configured cadence", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let scheduledDelay = 0;
  let unrefCalled = false;
  let cleared = false;
  const fakeTimer = {
    unref() {
      unrefCalled = true;
      return this;
    },
  } as unknown as NodeJS.Timeout;

  globalThis.setInterval = ((_callback: () => void, delay?: number) => {
    scheduledDelay = Number(delay ?? 0);
    return fakeTimer;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: NodeJS.Timeout) => {
    assert.equal(timer, fakeTimer);
    cleared = true;
  }) as typeof clearInterval;

  let checks = 0;
  let applies = 0;
  try {
    const service = new GitAutoUpdateService({
      sourceRoot: "/repo",
      intervalMinutes: 30,
      checkRunner: async () => {
        checks += 1;
        return {
          phase: "idle",
          branch: "main",
          remoteHead: "abc",
          conflictReason: null,
          message: null,
          updated: false,
        };
      },
      applyRunner: async () => {
        applies += 1;
        throw new Error("the background timer must never apply an update");
      },
    });

    service.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(checks, 1);
    assert.equal(applies, 0);
    assert.equal(scheduledDelay, 30 * 60_000);
    assert.equal(unrefCalled, true);
    service.stop();
    assert.equal(cleared, true);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
