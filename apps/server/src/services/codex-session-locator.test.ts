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
): string {
  const path = join(sessionsRoot, `${name}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp: "2026-08-19T00:00:00.000Z",
      type: "session_meta",
      payload: { id, cwd: "/workspace/shared", source },
    })}\n`,
  );
  return path;
}

function exposeOpenFile(procRoot: string, processId: number, path: string): void {
  const processRoot = join(procRoot, String(processId));
  mkdirSync(join(processRoot, "task", String(processId)), { recursive: true });
  mkdirSync(join(processRoot, "fd"), { recursive: true });
  writeFileSync(join(processRoot, "task", String(processId), "children"), "");
  symlinkSync(path, join(processRoot, "fd", "7"));
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
    const child = writeSession(
      sessionsRoot,
      "child",
      "codex-child-session",
      {
        subagent: {
          thread_spawn: { parent_thread_id: "codex-parent-session" },
        },
      },
    );
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
