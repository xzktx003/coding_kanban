import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scanAgentDirectory } from "./agent-scanner.js";
import { resolveTmuxBinary } from "./runtime-compat.js";

const TMUX_BINARY = resolveTmuxBinary();

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // ignore missing sessions during cleanup
  }
}

test("scanAgentDirectory includes agent indicators from descendant directories", () => {
  const rootDir = makeTempDir("agent-scan-tree-");
  const claudeDir = path.join(rootDir, "project-a");
  const copilotDir = path.join(rootDir, "nested", "project-b");

  mkdirSync(path.join(claudeDir, ".claude"), { recursive: true });
  mkdirSync(path.join(copilotDir, ".copilot"), { recursive: true });

  try {
    const response = scanAgentDirectory({ path: rootDir });
    const discoveredPairs = new Set(
      response.results
        .filter((result) => result.workingDirectory.startsWith(rootDir))
        .map((result) => `${result.agentKind}:${result.workingDirectory}`),
    );

    assert.ok(discoveredPairs.has(`claude:${claudeDir}`));
    assert.ok(discoveredPairs.has(`copilot:${copilotDir}`));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("scanAgentDirectory excludes copilot sessions outside the scanned subtree", () => {
  const originalHome = process.env.HOME;
  const tempHome = makeTempDir("agent-scan-home-");
  const workspaceRoot = makeTempDir("agent-scan-workspace-");
  const parentDir = path.join(workspaceRoot, "parent");
  const childDir = path.join(parentDir, "child");
  const sessionRoot = path.join(tempHome, ".copilot", "session-state");

  mkdirSync(childDir, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });

  const parentSessionDir = path.join(sessionRoot, "parent-session");
  const childSessionDir = path.join(sessionRoot, "child-session");

  mkdirSync(parentSessionDir, { recursive: true });
  mkdirSync(childSessionDir, { recursive: true });

  writeFileSync(
    path.join(parentSessionDir, "workspace.yaml"),
    [
      "id: parent-session",
      `cwd: ${parentDir}`,
      "name: Parent session",
      `updated_at: ${new Date().toISOString()}`,
    ].join("\n"),
  );
  writeFileSync(
    path.join(childSessionDir, "workspace.yaml"),
    [
      "id: child-session",
      `cwd: ${childDir}`,
      "name: Child session",
      `updated_at: ${new Date().toISOString()}`,
    ].join("\n"),
  );

  process.env.HOME = tempHome;

  try {
    const response = scanAgentDirectory({ path: childDir });
    const sessionIds = response.results
      .map((result) => result.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId));

    assert.deepEqual(sessionIds, ["child-session"]);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("scanAgentDirectory excludes tmux panes whose cwd is outside the scanned subtree", () => {
  const rootDir = makeTempDir("agent-scan-tmux-");
  const parentDir = path.join(rootDir, "project");
  const childDir = path.join(parentDir, "nested");
  const sessionName = `scan-scope-${Date.now()}`;

  mkdirSync(childDir, { recursive: true });
  killTmuxSession(sessionName);

  execFileSync(
    TMUX_BINARY,
    [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      parentDir,
      "sh",
      "-lc",
      "sleep 30",
    ],
    {
      stdio: "ignore",
    },
  );

  try {
    const response = scanAgentDirectory({ path: childDir });
    const matchedTmux = response.results.find(
      (result) => result.tmuxSession === sessionName,
    );

    assert.equal(matchedTmux, undefined);
  } finally {
    killTmuxSession(sessionName);
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("scanAgentDirectory uses the real tmux session name as its title", () => {
  const scanDir = makeTempDir("agent-scan-tmux-name-");
  const sessionName = `scan-title-${Date.now()}`;

  killTmuxSession(sessionName);
  execFileSync(
    TMUX_BINARY,
    ["new-session", "-d", "-s", sessionName, "-c", scanDir, "sleep", "30"],
    {
      stdio: "ignore",
    },
  );

  try {
    const response = scanAgentDirectory({ path: scanDir });
    const tmuxResult = response.results.find(
      (result) => result.tmuxSession === sessionName,
    );

    assert.ok(tmuxResult);
    assert.equal(tmuxResult.displayName, sessionName);
    assert.equal(tmuxResult.agentKind, "shell");
    assert.equal(tmuxResult.workingDirectory, scanDir);
  } finally {
    killTmuxSession(sessionName);
    rmSync(scanDir, { recursive: true, force: true });
  }
});

test(
  "scanAgentDirectory merges tmux state when tmux reports the real local cwd alias",
  { skip: process.platform !== "darwin" },
  () => {
    const originalHome = process.env.HOME;
    const tempHome = makeTempDir("agent-scan-home-");
    const sessionRoot = path.join(tempHome, ".copilot", "session-state");
    const sessionId = `alias-session-${Date.now()}`;
    const sessionName = `alias-tmux-${Date.now()}`;
    const scanDir = makeTempDir("agent-scan-alias-");
    const realScanDir = realpathSync(scanDir);
    const sessionDir = path.join(sessionRoot, sessionId);

    assert.notEqual(realScanDir, scanDir);

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, "workspace.yaml"),
      [
        `id: ${sessionId}`,
        `cwd: ${scanDir}`,
        `name: ${sessionName}`,
        `updated_at: ${new Date().toISOString()}`,
      ].join("\n"),
    );
    writeFileSync(path.join(sessionDir, `inuse.${process.pid}.lock`), "");

    process.env.HOME = tempHome;
    killTmuxSession(sessionName);

    execFileSync(
      TMUX_BINARY,
      ["new-session", "-d", "-s", sessionName, "-c", scanDir, "sleep", "30"],
      {
        stdio: "ignore",
      },
    );

    try {
      const response = scanAgentDirectory({ path: scanDir });
      const mergedResult = response.results.find(
        (result) => result.sessionId === sessionId,
      );

      assert.equal(mergedResult?.displayName, sessionName);
      assert.equal(mergedResult?.tmuxSession, sessionName);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      killTmuxSession(sessionName);
      rmSync(tempHome, { recursive: true, force: true });
      rmSync(scanDir, { recursive: true, force: true });
    }
  },
);
