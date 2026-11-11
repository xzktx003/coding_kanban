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
  timestamp = "2026-08-19T00:00:00.000Z",
  metadataTimestamp?: string,
): string {
  const path = join(sessionsRoot, `${name}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp,
      type: "session_meta",
      payload: {
        id,
        cwd,
        source,
        ...(metadataTimestamp ? { timestamp: metadataTimestamp } : {}),
      },
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

function exposeLinuxProcessStartTime(
  procRoot: string,
  processId: number,
  processStartMs: number,
): void {
  const bootTimeSeconds = Math.floor(processStartMs / 1_000) - 3_600;
  writeFileSync(
    join(procRoot, "stat"),
    `cpu 0 0 0 0\nbtime ${bootTimeSeconds}\n`,
  );
  const fields = Array.from({ length: 52 }, () => "0");
  fields[0] = String(processId);
  fields[1] = "(codex)";
  fields[2] = "S";
  fields[21] = String(
    Math.round((processStartMs / 1_000 - bootTimeSeconds) * 100),
  );
  writeFileSync(
    join(procRoot, String(processId), "stat"),
    `${fields.join(" ")}\n`,
  );
}

test("CodexSessionLocator trusts a Codex-owned rollout after cwd rename or deletion, but not an unrelated reader", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-renamed-cwd-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  try {
    const main = writeSession(sessionsRoot, "main", "session-main-123", "cli");
    const child = writeSession(sessionsRoot, "child", "session-child-123", {
      subagent: {},
    });
    exposeOpenFile(procRoot, 100, main);
    symlinkSync(child, join(procRoot, "100", "fd", "8"));
    exposeProcessWorkingDirectory(
      procRoot,
      100,
      "/workspace/shared.backup (deleted)",
    );
    const locator = new CodexSessionLocator({
      sessionsRoot,
      procRoot,
      resolveTmuxPanePid: async () => 100,
      resolveTmuxActivePanePid: async () => 100,
    });
    const input = {
      tmuxTarget: "test",
      tmuxSession: "test",
      workingDirectory: "/workspace/shared",
    };
    assert.equal(await locator.resolve(input), undefined);
    exposeCodexCommand(procRoot, 100);
    assert.equal(await locator.resolve(input), "session-main-123");
    writeFileSync(
      join(procRoot, "100", "cmdline"),
      "/usr/local/bin/codex\0resume\0session-main-123\0",
    );
    assert.equal(await locator.resolve(input), "session-main-123");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("CodexSessionLocator enumerates every Codex thread in one tmux session", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-panes-"));
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
      "/workspace/a",
    );
    const sessionB = writeSession(
      sessionsRoot,
      "session-b",
      "codex-session-b",
      "cli",
      "/workspace/b",
    );
    exposeOpenFile(procRoot, 101, sessionA);
    exposeOpenFile(procRoot, 201, sessionB);

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      listTmuxPanes: async (sessionName) => {
        assert.equal(sessionName, "shared");
        return [
          { paneId: "%1", processId: 101, workingDirectory: "/workspace/a" },
          { paneId: "%2", processId: 201, workingDirectory: "/workspace/b" },
        ];
      },
    });

    assert.deepEqual(await locator.resolveTmuxPanes("shared"), [
      {
        paneId: "%1",
        sessionId: "codex-session-a",
        workingDirectory: "/workspace/a",
      },
      {
        paneId: "%2",
        sessionId: "codex-session-b",
        workingDirectory: "/workspace/b",
      },
    ]);
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

test("CodexSessionLocator uses proc stat start ticks when the proc directory mtime drifts", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-proc-start-"));
  const sessionsRoot = join(root, "sessions");
  const shellSnapshotsRoot = join(root, "shell-snapshots");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(shellSnapshotsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    writeSession(sessionsRoot, "selected", "codex-selected", "cli");
    writeSession(sessionsRoot, "newer", "codex-newer", "cli");

    const paneRoot = join(procRoot, "901");
    mkdirSync(join(paneRoot, "task", "901"), { recursive: true });
    writeFileSync(join(paneRoot, "task", "901", "children"), "902\n");
    const codexRoot = join(procRoot, "902");
    mkdirSync(join(codexRoot, "task", "902"), { recursive: true });
    writeFileSync(join(codexRoot, "task", "902", "children"), "");
    exposeCodexCommand(procRoot, 902);
    exposeProcessWorkingDirectory(procRoot, 902, "/workspace/shared");

    const processStartMs = Date.now() - 30_000;
    exposeLinuxProcessStartTime(procRoot, 902, processStartMs);
    const driftedProcMtimeMs = processStartMs + 10 * 60 * 1_000;
    utimesSync(
      codexRoot,
      driftedProcMtimeMs / 1_000,
      driftedProcMtimeMs / 1_000,
    );
    writeFileSync(
      join(
        shellSnapshotsRoot,
        `codex-selected.${BigInt(Math.round((processStartMs + 5_000) * 1_000_000))}.sh`,
      ),
      "",
    );

    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot,
      resolveTmuxPanePid: async () => 901,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-drifted-proc-mtime",
        workingDirectory: "/workspace/shared",
      }),
      "codex-selected",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator uses the explicit resume session id before same-directory recency", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-resume-binding-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    writeSession(sessionsRoot, "selected", "codex-selected", "cli");
    writeSession(sessionsRoot, "newer", "codex-newer", "cli");

    const paneRoot = join(procRoot, "801");
    mkdirSync(join(paneRoot, "task", "801"), { recursive: true });
    writeFileSync(join(paneRoot, "task", "801", "children"), "802\n");
    const codexRoot = join(procRoot, "802");
    mkdirSync(join(codexRoot, "task", "802"), { recursive: true });
    writeFileSync(join(codexRoot, "task", "802", "children"), "");
    writeFileSync(
      join(codexRoot, "cmdline"),
      "/usr/local/bin/codex\0--yolo\0resume\0codex-selected\0",
    );
    exposeProcessWorkingDirectory(procRoot, 802, "/workspace/shared");

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 801,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-resumed-codex",
        workingDirectory: "/workspace/shared",
      }),
      "codex-selected",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator follows an explicit resumed ID when its original cwd differs from the active pane", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-resume-cwd-change-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const selectedId = "codex-resumed-thread";
    writeSession(
      sessionsRoot,
      `rollout-${selectedId}`,
      selectedId,
      "cli",
      "/workspace/project",
    );
    writeSession(
      sessionsRoot,
      "stale-pane-thread",
      "codex-stale-pane-thread",
      "cli",
      "/workspace/project/docs",
    );

    const paneRoot = join(procRoot, "851");
    mkdirSync(join(paneRoot, "task", "851"), { recursive: true });
    writeFileSync(join(paneRoot, "task", "851", "children"), "852\n");
    const codexRoot = join(procRoot, "852");
    mkdirSync(join(codexRoot, "task", "852"), { recursive: true });
    writeFileSync(join(codexRoot, "task", "852", "children"), "");
    writeFileSync(
      join(codexRoot, "cmdline"),
      `/usr/local/bin/codex\0resume\0${selectedId}\0`,
    );
    exposeProcessWorkingDirectory(procRoot, 852, "/workspace/project/docs");

    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 851,
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-resumed-codex-different-cwd",
        workingDirectory: "/workspace/project/docs",
      }),
      selectedId,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexSessionLocator reads only the explicitly resumed rollout among unrelated history", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-session-targeted-resume-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const selectedId = "codex-target-session";
    const selectedPath = writeSession(
      sessionsRoot,
      `rollout-${selectedId}`,
      selectedId,
      "cli",
    );
    const unrelatedPaths = Array.from({ length: 200 }, (_, index) =>
      writeSession(
        sessionsRoot,
        `rollout-unrelated-${index}`,
        `unrelated-session-${index}`,
        "cli",
      ),
    );

    const paneRoot = join(procRoot, "901");
    mkdirSync(join(paneRoot, "task", "901"), { recursive: true });
    writeFileSync(join(paneRoot, "task", "901", "children"), "902\n");
    const codexRoot = join(procRoot, "902");
    mkdirSync(join(codexRoot, "task", "902"), { recursive: true });
    writeFileSync(join(codexRoot, "task", "902", "children"), "");
    writeFileSync(
      join(codexRoot, "cmdline"),
      `/usr/local/bin/codex\0resume\0${selectedId}\0`,
    );
    exposeProcessWorkingDirectory(procRoot, 902, "/workspace/shared");

    const readPaths: string[] = [];
    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot,
      resolveTmuxPanePid: async () => 901,
      readSessionCandidate: (path) => {
        readPaths.push(path);
        if (path === selectedPath) {
          return {
            id: selectedId,
            cwd: "/workspace/shared",
            mtimeMs: 1,
            path,
            subagent: false,
          };
        }
        return {
          id: "unrelated",
          cwd: "/workspace/shared",
          mtimeMs: 1,
          path,
          subagent: false,
        };
      },
    });

    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-targeted-resume",
        workingDirectory: "/workspace/shared",
      }),
      selectedId,
    );
    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-targeted-resume",
        workingDirectory: "/workspace/shared",
      }),
      selectedId,
    );
    assert.deepEqual(readPaths, [selectedPath]);
    writeFileSync(selectedPath, "\n", { flag: "a" });
    assert.equal(
      await locator.resolve({
        tmuxTarget: "tmux-targeted-resume",
        workingDirectory: "/workspace/shared",
      }),
      selectedId,
    );
    assert.deepEqual(readPaths, [selectedPath, selectedPath]);
    assert.ok(unrelatedPaths.every((path) => !readPaths.includes(path)));
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

test("CodexSessionLocator reads an exact registered history ID after a Codex restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-registered-old-history-"));
  const sessionsRoot = join(root, "sessions");
  const shellSnapshotsRoot = join(root, "snapshots");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(shellSnapshotsRoot, { recursive: true });
  mkdirSync(procRoot, { recursive: true });

  try {
    const selectedId = "codex-registered-old";
    const processStart = Date.parse("2026-10-08T13:26:42.000Z");
    const oldCreationTime = "2026-08-19T00:00:00.000Z";
    writeSession(
      sessionsRoot,
      "registered-old",
      selectedId,
      "cli",
      "/workspace/shared",
      oldCreationTime,
      oldCreationTime,
    );
    writeSession(
      sessionsRoot,
      "same-directory-newer",
      "codex-same-directory-newer",
      "cli",
      "/workspace/shared",
      "2026-10-08T13:26:42.000Z",
    );
    writeSession(
      sessionsRoot,
      "other-directory",
      "codex-other-directory",
      "cli",
      "/workspace/other",
      oldCreationTime,
      oldCreationTime,
    );
    writeSession(
      sessionsRoot,
      "subagent",
      "codex-registered-subagent",
      { subagent: {} },
      "/workspace/shared",
      oldCreationTime,
      oldCreationTime,
    );

    mkdirSync(join(procRoot, "1201", "task", "1201"), { recursive: true });
    writeFileSync(join(procRoot, "1201", "task", "1201", "children"), "");
    exposeCodexCommand(procRoot, 1201);
    exposeLinuxProcessStartTime(procRoot, 1201, processStart);
    exposeProcessWorkingDirectory(procRoot, 1201, "/workspace/shared");

    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot,
      resolveTmuxPanePid: async () => 1201,
      resolveTmuxActivePanePid: async () => 1201,
    });
    const input = {
      tmuxTarget: "%1",
      tmuxSession: "existing-codex-session",
      workingDirectory: "/workspace/stale",
    };

    assert.equal(await locator.resolve(input), undefined);
    assert.equal(
      await locator.resolve({ ...input, historySessionId: selectedId }),
      selectedId,
    );
    assert.equal(
      await locator.resolve({
        ...input,
        historySessionId: "codex-other-directory",
      }),
      undefined,
    );
    assert.equal(
      await locator.resolve({
        ...input,
        historySessionId: "codex-registered-subagent",
      }),
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read-only history keeps the registered thread when the live Codex did not create a new one", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-registered-no-launch-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(join(procRoot, "1201", "task", "1201"), { recursive: true });
  mkdirSync(sessionsRoot, { recursive: true });
  try {
    const processStart = Date.parse("2026-10-08T13:26:42.000Z");
    writeSession(
      sessionsRoot,
      "registered-old",
      "codex-registered-old",
      "cli",
      "/workspace/shared",
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T00:00:00.000Z",
    );
    writeFileSync(join(procRoot, "1201", "task", "1201", "children"), "");
    exposeCodexCommand(procRoot, 1201);
    exposeLinuxProcessStartTime(procRoot, 1201, processStart);
    exposeProcessWorkingDirectory(procRoot, 1201, "/workspace/shared");
    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot: join(root, "snapshots"),
      resolveTmuxPanePid: async () => 1201,
    });
    assert.equal(
      await locator.resolve({
        tmuxTarget: "%1",
        workingDirectory: "/workspace/shared",
        historySessionId: "codex-registered-old",
        readOnlyCompletion: true,
      }),
      "codex-registered-old",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh Codex launch binds the thread it created, not an older open or registered record", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-fresh-launch-record-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(join(procRoot, "1201", "task", "1201"), { recursive: true });
  try {
    const processStart = Date.parse("2026-10-08T13:26:42.000Z");
    const oldPath = writeSession(
      sessionsRoot,
      "registered-old",
      "codex-registered-old",
      "cli",
      "/workspace/shared",
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T00:00:00.000Z",
    );
    writeSession(
      sessionsRoot,
      "launch-born",
      "codex-launch-born",
      "cli",
      "/workspace/shared",
      "2026-10-08T13:26:42.500Z",
      "2026-10-08T13:26:42.500Z",
    );
    writeFileSync(join(procRoot, "1201", "task", "1201", "children"), "");
    writeFileSync(
      join(procRoot, "1201", "cmdline"),
      "/usr/local/bin/codex\0--yolo\0",
    );
    exposeLinuxProcessStartTime(procRoot, 1201, processStart);
    exposeProcessWorkingDirectory(procRoot, 1201, "/workspace/shared");
    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot: join(root, "snapshots"),
      resolveTmuxPanePid: async () => 1201,
    });
    const input = {
      tmuxTarget: "%446",
      workingDirectory: "/workspace/shared",
      historySessionId: "codex-registered-old",
    };
    assert.equal(
      await locator.resolve(input),
      "codex-registered-old",
      "ordinary history lookup still does not guess a new thread",
    );
    assert.equal(
      await locator.resolve({ ...input, readOnlyCompletion: true }),
      "codex-launch-born",
    );

    mkdirSync(join(procRoot, "1201", "fd"), { recursive: true });
    symlinkSync(oldPath, join(procRoot, "1201", "fd", "7"));
    assert.equal(
      await locator.resolve({ ...input, readOnlyCompletion: true }),
      "codex-launch-born",
      "an older rollout left open must not hide the new instance",
    );
    assert.equal(
      await locator.resolve(input),
      "codex-registered-old",
      "input routing still follows the rollout the process is holding",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh Codex with no new thread does not display the card's older record", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-fresh-no-thread-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(join(procRoot, "1201", "task", "1201"), { recursive: true });
  try {
    const processStart = Date.parse("2026-10-08T13:26:42.000Z");
    writeSession(
      sessionsRoot,
      "registered-old",
      "codex-registered-old",
      "cli",
      "/workspace/shared",
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T00:00:00.000Z",
    );
    writeFileSync(join(procRoot, "1201", "task", "1201", "children"), "");
    writeFileSync(
      join(procRoot, "1201", "cmdline"),
      "/usr/local/bin/codex\0--yolo\0",
    );
    exposeLinuxProcessStartTime(procRoot, 1201, processStart);
    exposeProcessWorkingDirectory(procRoot, 1201, "/workspace/shared");
    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot: join(root, "snapshots"),
      resolveTmuxPanePid: async () => 1201,
    });
    assert.equal(
      await locator.resolve({
        tmuxTarget: "%446",
        workingDirectory: "/workspace/shared",
        historySessionId: "codex-registered-old",
        readOnlyCompletion: true,
      }),
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh Codex without a new thread ignores startup snapshots and open old rollouts", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-fresh-stale-clues-"));
  const sessionsRoot = join(root, "sessions");
  const snapshots = join(root, "snapshots");
  const procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(snapshots, { recursive: true });
  mkdirSync(join(procRoot, "1201", "fd"), { recursive: true });
  mkdirSync(join(procRoot, "1201", "task", "1201"), { recursive: true });
  try {
    const processStart = Date.parse("2026-10-08T13:26:42.000Z");
    const oldPath = writeSession(
      sessionsRoot,
      "registered-old",
      "codex-registered-old",
      "cli",
      "/workspace/shared",
      "2026-08-19T00:00:00.000Z",
      "2026-08-19T00:00:00.000Z",
    );
    writeFileSync(join(procRoot, "1201", "task", "1201", "children"), "");
    writeFileSync(
      join(procRoot, "1201", "cmdline"),
      "/usr/local/bin/codex\0--yolo\0",
    );
    symlinkSync(oldPath, join(procRoot, "1201", "fd", "7"));
    exposeLinuxProcessStartTime(procRoot, 1201, processStart);
    exposeProcessWorkingDirectory(procRoot, 1201, "/workspace/shared");
    writeFileSync(
      join(
        snapshots,
        `codex-registered-old.${BigInt(Math.round((processStart + 5_000) * 1_000_000))}.sh`,
      ),
      "",
    );
    const locator = new CodexSessionLocator({
      clockTicksPerSecond: 100,
      procRoot,
      sessionsRoot,
      shellSnapshotsRoot: snapshots,
      resolveTmuxPanePid: async () => 1201,
    });
    const input = {
      tmuxTarget: "%446",
      workingDirectory: "/workspace/shared",
      historySessionId: "codex-registered-old",
      readOnlyCompletion: true,
    };
    assert.equal(await locator.resolve(input), undefined);
    assert.equal(
      await locator.resolve({ ...input, readOnlyCompletion: false }),
      "codex-registered-old",
      "input routing still follows the rollout the process is holding",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an ambiguous new Codex launch does not fall back to the card's old history", async () => {
  const f = startupCompletionFixture();
  try {
    f.candidate("first", f.started + 1000);
    f.candidate("second", f.started + 2000);
    f.candidate("registered", f.started - 60 * 60 * 1000);
    assert.equal(
      await f.locator.resolve({
        tmuxTarget: "%291",
        workingDirectory: "/workspace/shared",
        historySessionId: "codex-registered",
        readOnlyCompletion: true,
      }),
      undefined,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

function startupCompletionFixture() {
  const root = mkdtempSync(join(tmpdir(), "codex-completion-startup-"));
  const sessionsRoot = join(root, "sessions"),
    procRoot = join(root, "proc");
  mkdirSync(sessionsRoot, { recursive: true });
  for (const pid of [601, 602]) {
    const process = join(procRoot, String(pid));
    mkdirSync(join(process, "task", String(pid)), { recursive: true });
    writeFileSync(
      join(process, "task", String(pid), "children"),
      pid === 601 ? "602" : "",
    );
  }
  writeFileSync(
    join(procRoot, "602", "cmdline"),
    "/usr/local/bin/codex\0--yolo\0",
  );
  exposeProcessWorkingDirectory(procRoot, 602, "/workspace/shared");
  const started = Date.now() - 24 * 60 * 60 * 1000;
  utimesSync(join(procRoot, "602"), started / 1000, started / 1000);
  const locator = new CodexSessionLocator({
    procRoot,
    sessionsRoot,
    shellSnapshotsRoot: join(root, "no-snapshots"),
    resolveTmuxPanePid: async () => 601,
    listTmuxPanes: async () => [
      { paneId: "%291", processId: 601, workingDirectory: "/workspace/shared" },
    ],
  });
  const candidate = (
    name: string,
    created: number,
    source: unknown = "cli",
    cwd = "/workspace/shared",
  ) =>
    writeSession(
      sessionsRoot,
      name,
      `codex-${name}`,
      source,
      cwd,
      new Date().toISOString(),
      new Date(created).toISOString(),
    );
  return { root, procRoot, sessionsRoot, locator, started, candidate };
}
test("completion-only startup matching finds an unambiguous launch-born thread without snapshots or held files", async () => {
  const f = startupCompletionFixture();
  try {
    f.candidate("selected", f.started + 2000, "vscode");
    f.candidate("other-history", f.started - 60 * 60 * 1000);
    f.candidate("later-parallel", f.started + 60 * 60 * 1000);
    f.candidate("subagent", f.started + 1000, { subagent: {} });
    f.candidate("other-directory", f.started + 500, "cli", "/workspace/other");
    assert.deepEqual(await f.locator.resolveTmuxPanes("terminal"), []);
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [
        {
          paneId: "%291",
          sessionId: "codex-selected",
          workingDirectory: "/workspace/shared",
        },
      ],
    );
    assert.equal(
      await f.locator.resolve({
        tmuxTarget: "%291",
        workingDirectory: "/workspace/shared",
      }),
      undefined,
      "completion matching must not change input routing",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("completion startup matching refuses ambiguous, resumed and non-Codex processes", async () => {
  const f = startupCompletionFixture();
  try {
    f.candidate("first", f.started + 1000);
    f.candidate("second", f.started + 2000);
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [],
    );
    rmSync(join(f.sessionsRoot, "second.jsonl"));
    f.candidate("unrelated", f.started + 60 * 60 * 1000);
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0resume\0",
    );
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [],
    );
    writeFileSync(join(f.procRoot, "602", "cmdline"), "/bin/bash\0");
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [],
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("completion matching recovers the only rollout written after a bare resume", async () => {
  const f = startupCompletionFixture();
  try {
    const selected = f.candidate("selected", f.started - 60 * 60 * 1000);
    const stale = f.candidate("stale", f.started - 3 * 60 * 60 * 1000);
    const staleAt = (f.started - 60 * 60 * 1000) / 1000;
    utimesSync(stale, staleAt, staleAt);
    f.candidate("subagent", f.started - 60 * 60 * 1000, { subagent: {} });
    f.candidate("other-directory", Date.now(), "cli", "/workspace/other");
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0--resume\0",
    );
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
    };
    assert.equal(await f.locator.resolve(input), undefined);
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: true }),
      "codex-selected",
    );
    assert.equal(selected.endsWith("selected.jsonl"), true);
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0fork\0",
    );
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: true }),
      undefined,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("completion matching leaves two bare-resume writes unresolved", async () => {
  const f = startupCompletionFixture();
  try {
    f.candidate("one", f.started - 2 * 60 * 60 * 1000);
    f.candidate("two", f.started - 3 * 60 * 60 * 1000);
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0resume\0",
    );
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
      readOnlyCompletion: true,
    };
    assert.equal(await f.locator.resolve(input), undefined);
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: false }),
      undefined,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("completion matching excludes sibling launches and threads owned by other live Codex processes", async () => {
  const f = startupCompletionFixture();
  try {
    f.candidate("selected", f.started - 2 * 60 * 60 * 1000);
    const born = f.candidate("born", Date.now() - 1000);
    const siblingStart = Date.now() - 5_000;
    const sibling = join(f.procRoot, "700");
    mkdirSync(join(sibling, "task", "700"), { recursive: true });
    writeFileSync(join(sibling, "task", "700", "children"), "");
    writeFileSync(join(sibling, "cmdline"), "/usr/local/bin/codex\0--yolo\0");
    exposeProcessWorkingDirectory(f.procRoot, 700, "/workspace/shared");
    utimesSync(sibling, siblingStart / 1000, siblingStart / 1000);
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0resume\0",
    );
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
      readOnlyCompletion: true as const,
    };
    assert.equal(await f.locator.resolve(input), "codex-selected");
    assert.equal(born.endsWith("born.jsonl"), true);

    const held = f.candidate("held", f.started - 4 * 60 * 60 * 1000);
    const holder = join(f.procRoot, "703");
    mkdirSync(join(holder, "task", "703"), { recursive: true });
    writeFileSync(join(holder, "task", "703", "children"), "");
    writeFileSync(join(holder, "cmdline"), "/usr/local/bin/codex\0--yolo\0");
    exposeProcessWorkingDirectory(f.procRoot, 703, "/workspace/shared");
    exposeOpenFile(f.procRoot, 703, held);
    assert.equal(await f.locator.resolve(input), "codex-selected");

    writeFileSync(
      join(holder, "cmdline"),
      "/usr/local/bin/codex\0resume\0codex-selected\0",
    );
    assert.equal(await f.locator.resolve(input), undefined);
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: false }),
      undefined,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("completion matching ignores rollout handles held only by Codex app-server", async () => {
  const f = startupCompletionFixture();
  try {
    const selected = f.candidate("selected", f.started - 2 * 60 * 60 * 1000);
    const stale = f.candidate("stale", f.started - 5 * 60 * 60 * 1000);
    const staleAt = (f.started - 60 * 60 * 1000) / 1000;
    utimesSync(stale, staleAt, staleAt);
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0resume\0",
    );
    const daemon = join(f.procRoot, "710");
    mkdirSync(join(daemon, "task", "710"), { recursive: true });
    writeFileSync(join(daemon, "task", "710", "children"), "");
    writeFileSync(
      join(daemon, "cmdline"),
      "/usr/local/bin/codex\0app-server\0--listen\0unix://\0",
    );
    exposeOpenFile(f.procRoot, 710, selected);
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
      readOnlyCompletion: true as const,
    };
    assert.equal(await f.locator.resolve(input), "codex-selected");
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: false }),
      undefined,
    );

    writeFileSync(join(daemon, "cmdline"), "/usr/local/bin/codex\0--yolo\0");
    assert.equal(await f.locator.resolve(input), undefined);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("completion matching gives concurrent bare resumes non-overlapping write windows", async () => {
  const f = startupCompletionFixture();
  try {
    const now = Date.now();
    const earlyStart = now - 10 * 60 * 1000;
    const lateStart = now - 2 * 60 * 1000;
    utimesSync(join(f.procRoot, "602"), earlyStart / 1000, earlyStart / 1000);
    const early = f.candidate("early", earlyStart - 60 * 60 * 1000);
    const late = f.candidate("late", earlyStart - 2 * 60 * 60 * 1000);
    const ancient = f.candidate("ancient", earlyStart - 24 * 60 * 60 * 1000);
    utimesSync(
      early,
      (now - 5 * 60 * 1000) / 1000,
      (now - 5 * 60 * 1000) / 1000,
    );
    utimesSync(late, (now - 30 * 1000) / 1000, (now - 30 * 1000) / 1000);
    utimesSync(
      ancient,
      (earlyStart - 60 * 60 * 1000) / 1000,
      (earlyStart - 60 * 60 * 1000) / 1000,
    );
    writeFileSync(
      join(f.procRoot, "602", "cmdline"),
      "/usr/local/bin/codex\0resume\0",
    );
    const later = join(f.procRoot, "800");
    mkdirSync(join(later, "task", "800"), { recursive: true });
    writeFileSync(join(later, "task", "800", "children"), "");
    writeFileSync(join(later, "cmdline"), "/usr/local/bin/codex\0--resume\0");
    exposeProcessWorkingDirectory(f.procRoot, 800, "/workspace/shared");
    utimesSync(later, lateStart / 1000, lateStart / 1000);
    const earlyInput = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
    };
    const lateInput = {
      tmuxTarget: "%292",
      tmuxPaneProcessId: 800,
      workingDirectory: "/workspace/shared",
    };
    assert.equal(await f.locator.resolve(earlyInput), undefined);
    assert.equal(
      await f.locator.resolve({ ...earlyInput, readOnlyCompletion: true }),
      "codex-early",
    );
    assert.equal(
      await f.locator.resolve({ ...lateInput, readOnlyCompletion: true }),
      "codex-late",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("completion startup matching never uses outer rewritten timestamps or mtimes as thread birth", async () => {
  const f = startupCompletionFixture();
  try {
    writeSession(
      f.sessionsRoot,
      "old",
      "codex-old",
      "cli",
      "/workspace/shared",
      new Date(f.started + 1000).toISOString(),
      new Date(f.started - 60 * 60 * 1000).toISOString(),
    );
    writeSession(
      f.sessionsRoot,
      "missing",
      "codex-missing",
      "cli",
      "/workspace/shared",
      new Date(f.started + 1000).toISOString(),
    );
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [],
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("read-only completion ignores codex-relay sharing a pane with a later Codex", async () => {
  const f = startupCompletionFixture();
  try {
    const relayStarted = f.started;
    const codexStarted = f.started + 3 * 60 * 60 * 1000;
    const current = f.candidate("current", codexStarted + 1_500);
    f.candidate("relay-era", relayStarted + 1_500);
    f.candidate("card-history", f.started - 60 * 60 * 1000);
    const relay = join(f.procRoot, "700");
    mkdirSync(join(relay, "task", "700"), { recursive: true });
    writeFileSync(join(relay, "task", "700", "children"), "");
    writeFileSync(
      join(relay, "cmdline"),
      "/usr/local/bin/codex-relay\x00--upstream\x00http://10.30.0.30:8000/v1\x00--port\x004446\x00",
    );
    exposeProcessWorkingDirectory(f.procRoot, 700, "/workspace/shared");
    utimesSync(relay, relayStarted / 1000, relayStarted / 1000);
    writeFileSync(
      join(f.procRoot, "601", "task", "601", "children"),
      "602 700",
    );
    exposeOpenFile(f.procRoot, 602, current);
    utimesSync(
      join(f.procRoot, "602"),
      codexStarted / 1000,
      codexStarted / 1000,
    );
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
      historySessionId: "codex-card-history",
      readOnlyCompletion: true as const,
    };
    assert.equal(await f.locator.resolve(input), "codex-current");
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [
        {
          paneId: "%291",
          sessionId: "codex-current",
          workingDirectory: "/workspace/shared",
        },
      ],
    );
    assert.equal(
      await f.locator.resolve({ ...input, readOnlyCompletion: false }),
      "codex-current",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("read-only completion uses the only Codex-held rollout when launch birth is ambiguous", async () => {
  const f = startupCompletionFixture();
  try {
    const laterStarted = f.started + 3 * 60 * 60 * 1000;
    const early = f.candidate("early", f.started + 1_500);
    const current = f.candidate("current", laterStarted + 1_500);
    f.candidate("card-history", f.started - 60 * 60 * 1000);
    const later = join(f.procRoot, "800");
    mkdirSync(join(later, "task", "800"), { recursive: true });
    writeFileSync(join(later, "task", "800", "children"), "");
    writeFileSync(join(later, "cmdline"), "/usr/local/bin/codex\0--yolo\0");
    exposeProcessWorkingDirectory(f.procRoot, 800, "/workspace/shared");
    exposeOpenFile(f.procRoot, 800, current);
    utimesSync(later, laterStarted / 1000, laterStarted / 1000);
    writeFileSync(
      join(f.procRoot, "601", "task", "601", "children"),
      "602 800",
    );
    const input = {
      tmuxTarget: "%291",
      workingDirectory: "/workspace/shared",
      historySessionId: "codex-card-history",
      readOnlyCompletion: true as const,
    };
    assert.equal(await f.locator.resolve(input), "codex-current");
    assert.deepEqual(
      await f.locator.resolveTmuxPanes("terminal", {
        readOnlyCompletion: true,
      }),
      [
        {
          paneId: "%291",
          sessionId: "codex-current",
          workingDirectory: "/workspace/shared",
        },
      ],
    );
    exposeOpenFile(f.procRoot, 602, early);
    utimesSync(join(f.procRoot, "602"), f.started / 1000, f.started / 1000);
    assert.equal(await f.locator.resolve(input), undefined);
    rmSync(join(f.procRoot, "602", "fd"), { recursive: true, force: true });
    rmSync(join(f.procRoot, "800", "fd"), { recursive: true, force: true });
    utimesSync(join(f.procRoot, "602"), f.started / 1000, f.started / 1000);
    utimesSync(later, laterStarted / 1000, laterStarted / 1000);
    assert.equal(await f.locator.resolve(input), undefined);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("input pane proof identifies the actual Codex process before its first thread", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-input-pane-"));
  const procRoot = join(root, "proc");
  try {
    exposeOpenFile(procRoot, 100, "/unused");
    exposeCodexCommand(procRoot, 100);
    exposeLinuxProcessStartTime(procRoot, 100, Date.now());
    const locator = new CodexSessionLocator({
      procRoot,
      sessionsRoot: join(root, "sessions"),
      resolveTmuxActivePanePid: async () => 100,
      listTmuxPanes: async () => [{ paneId: "%8", processId: 100 }],
    });
    const pane = await locator.resolveInputPane("work");
    assert.equal(pane?.paneId, "%8");
    assert.equal(pane?.codexProcessId, 100);
    assert.ok(pane?.codexStartTime);
    for (const command of [
      "/bin/bash\0",
      "/usr/bin/codex\0app-server\0",
      "/usr/bin/codex-relay\0",
    ]) {
      writeFileSync(join(procRoot, "100", "cmdline"), command);
      assert.equal(await locator.resolveInputPane("work"), undefined);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
