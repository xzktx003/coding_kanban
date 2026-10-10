import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  scheduleOnlineUpdateFinalizer,
  type OnlineUpdateFinalizerOptions,
} from "./online-update-finalizer.js";

class FakeChild extends EventEmitter {
  readonly pid = 1234;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  unrefCalled = false;
  killedWith: NodeJS.Signals | undefined;

  unref(): this {
    this.unrefCalled = true;
    return this;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    return true;
  }
}

test("starts a detached finalizer before the Git fast-forward and can cancel it", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "online-update-root-"));
  const child = new FakeChild();
  let captured:
    | {
        command: string;
        args: string[];
        options: Parameters<
          NonNullable<OnlineUpdateFinalizerOptions["spawnChild"]>
        >[2];
      }
    | undefined;

  try {
    await mkdir(join(repositoryRoot, "scripts"));
    await writeFile(
      join(repositoryRoot, "scripts/finalize-online-update.mjs"),
      "export const fixture = true;\n",
    );
    const cancel = await scheduleOnlineUpdateFinalizer({
      repositoryRoot,
      sourceRoot: join(repositoryRoot, "source"),
      targetHead: "a".repeat(40),
      spawnChild: (command, args, options) => {
        captured = { command, args, options };
        queueMicrotask(() => child.emit("spawn"));
        return child as never;
      },
    });

    assert.ok(captured);
    assert.equal(captured.command, process.execPath);
    assert.deepEqual(captured.args, [
      join(repositoryRoot, ".dev-runtime/online-update-finalizer.mjs"),
      "a".repeat(40),
      join(repositoryRoot, "source"),
    ]);
    assert.equal(
      await readFile(captured.args[0], "utf8"),
      "export const fixture = true;\n",
    );
    assert.equal(captured.options.cwd, repositoryRoot);
    assert.equal(captured.options.detached, true);
    assert.equal(
      captured.options.env?.APP_SOURCE_ROOT,
      join(repositoryRoot, "source"),
    );
    assert.equal(child.unrefCalled, true);

    cancel();
    assert.equal(child.killedWith, "SIGTERM");
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("rejects an unsafe target revision without spawning a process", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "online-update-root-"));
  let spawned = false;

  try {
    await assert.rejects(
      scheduleOnlineUpdateFinalizer({
        repositoryRoot,
        sourceRoot: repositoryRoot,
        targetHead: "not-a-revision",
        spawnChild: () => {
          spawned = true;
          return new FakeChild() as never;
        },
      }),
      /revision 无效/,
    );
    assert.equal(spawned, false);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
