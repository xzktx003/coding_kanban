import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexSessionLocator } from "./codex-session-locator.js";

function writeSession(
  sessionsRoot: string,
  name: string,
  id: string,
  source: unknown,
  cwd = "/workspace/shared",
): string {
  const path = join(sessionsRoot, `${name}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp: "2026-08-19T00:00:00.000Z",
      type: "session_meta",
      payload: { id, cwd, source },
    })}\n`,
  );
  return path;
}

function exposeOpenFile(
  procRoot: string,
  processId: number,
  path: string,
): void {
  const processRoot = join(procRoot, String(processId));
  mkdirSync(join(processRoot, "task", String(processId)), { recursive: true });
  mkdirSync(join(processRoot, "fd"), { recursive: true });
  writeFileSync(join(processRoot, "task", String(processId), "children"), "");
  symlinkSync(path, join(processRoot, "fd", "7"));
}

function exposeCodexCommand(procRoot: string, processId: number): void {
  writeFileSync(
    join(procRoot, String(processId), "cmdline"),
    "/usr/local/bin/codex\0--yolo\0resume\0",
  );
}

function exposeProcessWorkingDirectory(
  procRoot: string,
  processId: number,
  workingDirectory: string,
): void {
  symlinkSync(workingDirectory, join(procRoot, String(processId), "cwd"));
}

test("CodexSessionLocator keeps same-directory tmux panes bound to their own top-level Codex sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-locator-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const sessionA = writeSession(
      sessionsRoot,
      "session-a",
      "codex-session-a",
      "cli",
    );
    const sessionB = writeSession(
      sessionsRoot,
      "session-b",
      "codex-session-b",
      "cli",
    );
    exposeOpenFile(procRoot, 101, sessionA);
    exposeOpenFile(procRoot, 201, sessionB);

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async (target) =>
        target === "tmux-a" ? 101 : target === "tmux-b" ? 201 : null,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-a",
        workingDirectory: "/workspace/shared",
      }),
      "codex-session-a",
    );
    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-b",
        workingDirectory: "/workspace/shared",
      }),
      "codex-session-b",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator follows the active pane of the attached Kanban tmux client", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-active-pane-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const fixedPaneSession = writeSession(
      sessionsRoot,
      "fixed-pane",
      "codex-fixed-pane",
      "cli",
      "/workspace/fixed",
    );
    const activePaneSession = writeSession(
      sessionsRoot,
      "active-pane",
      "codex-active-pane",
      "cli",
      "/workspace/active",
    );
    exposeOpenFile(procRoot, 401, fixedPaneSession);
    exposeOpenFile(procRoot, 402, activePaneSession);
    exposeProcessWorkingDirectory(procRoot, 402, "/workspace/active");

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 401,
      resolveTmuxActivePanePid: async (sessionName, clientProcessId) => {
        assert.equal(sessionName, "tmux-session");
        assert.equal(clientProcessId, 9876);
        return 402;
      },
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "%fixed",
        tmuxSession: "tmux-session",
        tmuxClientProcessId: 9876,
        workingDirectory: "/workspace/fixed",
      }),
      "codex-active-pane",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator follows the active pane when Kanban is reattaching", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-reload-pane-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const activePaneSession = writeSession(
      sessionsRoot,
      "active-reload-pane",
      "codex-reload-active",
      "cli",
      "/workspace/reloaded",
    );
    exposeOpenFile(procRoot, 701, activePaneSession);
    exposeProcessWorkingDirectory(procRoot, 701, "/workspace/reloaded");

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 401,
      resolveTmuxActivePanePid: async (sessionName, clientProcessId) => {
        assert.equal(sessionName, "tmux-session");
        assert.equal(clientProcessId, undefined);
        return 701;
      },
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "%stale",
        tmuxSession: "tmux-session",
        workingDirectory: "/workspace/old",
      }),
      "codex-reload-active",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator uses the active pane directory for closed rollout fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-active-directory-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const staleSession = writeSession(
      sessionsRoot,
      "stale",
      "codex-stale-session",
      "cli",
      "/workspace/stale",
    );
    const activeSession = writeSession(
      sessionsRoot,
      "active",
      "codex-active-session",
      "cli",
      "/workspace/active",
    );
    const now = Date.now() / 1000;
    utimesSync(staleSession, now, now);
    utimesSync(activeSession, now - 10, now - 10);

    const processRoot = join(procRoot, "601");
    mkdirSync(join(processRoot, "task", "601"), { recursive: true });
    writeFileSync(join(processRoot, "task", "601", "children"), "");
    exposeCodexCommand(procRoot, 601);
    exposeProcessWorkingDirectory(procRoot, 601, "/workspace/active");

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 601,
      resolveTmuxActivePanePid: async () => 601,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "%active",
        tmuxSession: "tmux-session",
        tmuxClientProcessId: 9876,
        workingDirectory: "/workspace/stale",
      }),
      "codex-active-session",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator supports Codex builds that close rollout files between writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-closed-rollout-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    writeSession(sessionsRoot, "closed-rollout", "codex-closed-rollout", "cli");
    const processRoot = join(procRoot, "501");
    mkdirSync(join(processRoot, "task", "501"), { recursive: true });
    writeFileSync(join(processRoot, "task", "501", "children"), "");
    exposeCodexCommand(procRoot, 501);

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 501,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-closed-rollout",
        workingDirectory: "/workspace/shared",
      }),
      "codex-closed-rollout",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator uses the pane process snapshot when multiple Codex sessions share a cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-snapshot-binding-"));
  const sessionsRoot = join(root, "sessions");
  const shellSnapshotsRoot = join(root, "shell-snapshots");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(shellSnapshotsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    writeSession(sessionsRoot, "selected", "codex-selected", "cli");
    writeSession(sessionsRoot, "newer", "codex-newer", "cli");
    writeSession(
      sessionsRoot,
      "other-directory",
      "codex-other-directory",
      "cli",
      "/workspace/other",
    );

    const paneRoot = join(procRoot, "601");
    mkdirSync(join(paneRoot, "task", "601"), { recursive: true });
    writeFileSync(join(paneRoot, "task", "601", "children"), "602\n");
    const codexRoot = join(procRoot, "602");
    mkdirSync(codexRoot, { recursive: true });
    exposeCodexCommand(procRoot, 602);
    exposeProcessWorkingDirectory(procRoot, 602, "/workspace/shared");
    mkdirSync(join(codexRoot, "task", "602"), { recursive: true });
    writeFileSync(join(codexRoot, "task", "602", "children"), "");

    const processStartMs = Date.now() - 30_000;
    utimesSync(codexRoot, processStartMs / 1_000, processStartMs / 1_000);
    writeFileSync(
      join(
        shellSnapshotsRoot,
        `codex-selected.${BigInt(Math.round((processStartMs + 5_000) * 1_000_000))}.sh`,
      ),
      "",
    );
    writeFileSync(
      join(
        shellSnapshotsRoot,
        `codex-other-directory.${BigInt(Math.round((processStartMs + 1_000) * 1_000_000))}.sh`,
      ),
      "",
    );

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot,
      resolveTmuxPanePid: async () => 601,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-shared-cwd",
        workingDirectory: "/workspace/shared",
      }),
      "codex-selected",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator ignores newer subagent JSONL files held by the same Codex process", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-subagent-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const parent = writeSession(
      sessionsRoot,
      "parent",
      "codex-parent-session",
      "cli",
    );
    const child = writeSession(sessionsRoot, "child", "codex-child-session", {
      subagent: {
        thread_spawn: { parent_thread_id: "codex-parent-session" },
      },
    });
    exposeOpenFile(procRoot, 301, parent);
    symlinkSync(child, join(procRoot, "301", "fd", "8"));

    const now = Date.now() / 1000;
    utimesSync(parent, now - 10, now - 10);
    utimesSync(child, now, now);

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 301,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-parent",
        workingDirectory: "/workspace/shared",
      }),
      "codex-parent-session",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
