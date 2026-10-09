import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./app.js";
import {
  quoteForPosixShell,
  resolveTmuxBinary,
} from "./services/runtime-compat.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("shutdown releases owned PTYs before waiting for connection draining", async (t) => {
  const { app } = buildServer();
  let releaseDrain!: () => void;
  let startedDrain!: () => void;
  const drain = new Promise<void>((resolve) => {
    releaseDrain = resolve;
  });
  const started = new Promise<void>((resolve) => {
    startedDrain = resolve;
  });
  t.after(async () => {
    releaseDrain();
    await app.close();
  });
  app.addHook("preClose", async () => {
    startedDrain();
    await drain;
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/agent-launch/pty",
    payload: {
      workspaceId: "default",
      displayName: "shutdown-drain-test",
      agentKind: "shell",
      command: "exec cat",
    },
  });
  assert.equal(response.statusCode, 201);
  const pid = response.json().transportRef.processId as number;
  assert.ok(isAlive(pid));
  const closing = app.close();
  try {
    await started;
    for (let i = 0; i < 30 && isAlive(pid); i++) await sleep(10);
    assert.equal(
      isAlive(pid),
      false,
      "PTY survives until onClose and can be orphaned by a forced reload",
    );
  } finally {
    releaseDrain();
    await closing;
  }
});

test("repeated server shutdowns detach tmux clients while retaining the same pane and process", async () => {
  const originalBinary = process.env.TMUX_BINARY;
  const tmux = resolveTmuxBinary();
  const dir = mkdtempSync(join(tmpdir(), "kanban-tmux-shutdown-"));
  const wrapper = join(dir, "tmux");
  const socket = join(dir, "socket");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${quoteForPosixShell(tmux)} -S ${quoteForPosixShell(socket)} "$@"\n`,
    { mode: 0o700 },
  );
  const command = (args: string[]) =>
    execFileSync(wrapper, args, { encoding: "utf8", timeout: 2000 });
  process.env.TMUX_BINARY = wrapper;
  try {
    command(["new-session", "-d", "-s", "keep", "exec sleep 60"]);
    const identity = command([
      "list-panes",
      "-t",
      "keep",
      "-F",
      "#{pane_id}:#{pane_pid}",
    ]);
    const panePid = Number(identity.trim().split(":")[1]);
    for (let i = 0; i < 3; i++) {
      const { app } = buildServer();
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/agent-launch/pty",
          payload: {
            workspaceId: "default",
            displayName: "tmux-shutdown-test",
            agentKind: "shell",
            command: `${quoteForPosixShell(wrapper)} attach -t keep`,
            tmuxSessionName: "keep",
          },
        });
        assert.equal(response.statusCode, 201);
        for (
          let n = 0;
          n < 100 && !command(["list-clients", "-F", "#{client_pid}"]).trim();
          n++
        )
          await sleep(10);
        assert.equal(
          command(["list-clients", "-F", "#{client_pid}"])
            .trim()
            .split("\n")
            .filter(Boolean).length,
          1,
        );
      } finally {
        await app.close();
      }
      for (
        let n = 0;
        n < 100 && command(["list-clients", "-F", "#{client_pid}"]).trim();
        n++
      )
        await sleep(10);
      assert.equal(
        command(["list-clients", "-F", "#{client_pid}"]).trim(),
        "",
        "closing the gateway leaked an attached tmux client",
      );
      assert.equal(
        command(["list-panes", "-t", "keep", "-F", "#{pane_id}:#{pane_pid}"]),
        identity,
      );
      assert.ok(
        isAlive(panePid),
        "the tmux pane process must survive gateway shutdown",
      );
    }
  } finally {
    try {
      command(["kill-server"]);
    } catch {}
    if (originalBinary === undefined) delete process.env.TMUX_BINARY;
    else process.env.TMUX_BINARY = originalBinary;
    rmSync(dir, { recursive: true, force: true });
  }
});
