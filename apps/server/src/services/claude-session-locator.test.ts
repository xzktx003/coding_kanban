import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClaudeSessionLocator } from "./claude-session-locator.js";

const SESSION_ID = "ca0048f4-ef6d-4a5b-9c8c-0477a9b9b1be";

function writeTranscript(
  projectsRoot: string,
  cwd: string,
  sessionId: string,
  content = "hello",
): void {
  const directory = join(projectsRoot, cwd.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${sessionId}.jsonl`),
    `${JSON.stringify({ type: "user", cwd, sessionId, message: { role: "user", content } })}\n`,
  );
}

test("resolves the Claude session a tmux pane resumed explicitly", async () => {
  const procRoot = mkdtempSync(join(tmpdir(), "claude-locator-proc-"));
  mkdirSync(join(procRoot, "42"), { recursive: true });
  writeFileSync(
    join(procRoot, "42", "cmdline"),
    ["claude", "--resume", SESSION_ID].join("\0"),
  );
  const locator = new ClaudeSessionLocator({
    procRoot,
    resolveTmuxPanePid: async () => 42,
  });

  assert.equal(
    await locator.resolve({
      tmuxTarget: "%3",
      workingDirectory: "/workspace/project",
    }),
    SESSION_ID,
  );
});

test("matches the single transcript whose cwd equals the working directory", async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), "claude-locator-projects-"));
  writeTranscript(projectsRoot, "/workspace/project", SESSION_ID);
  writeTranscript(
    projectsRoot,
    "/workspace/other",
    "11111111-2222-3333-4444-555555555555",
  );
  const locator = new ClaudeSessionLocator({ projectsRoot });

  assert.equal(
    await locator.resolve({ workingDirectory: "/workspace/project" }),
    SESSION_ID,
  );
});

test("refuses to guess when several transcripts share the working directory", async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), "claude-locator-ambiguous-"));
  writeTranscript(projectsRoot, "/workspace/project", SESSION_ID);
  writeTranscript(
    projectsRoot,
    "/workspace/project",
    "99999999-8888-7777-6666-555555555555",
  );
  const locator = new ClaudeSessionLocator({ projectsRoot });

  assert.equal(
    await locator.resolve({ workingDirectory: "/workspace/project" }),
    undefined,
  );
});

test("reads a remote Claude session id without a local shell", async () => {
  const commands: string[] = [];
  const locator = new ClaudeSessionLocator({
    runRemoteCommand: async (command) => {
      commands.push(command);
      if (!command.includes(`"cwd":"${"/remote/project"}"`)) {
        throw new Error(`remote lookup did not name the session: ${command}`);
      }
      return `${SESSION_ID}\n`;
    },
  });

  assert.equal(
    await locator.resolve({
      workingDirectory: "/remote/project",
      sshTarget: { host: "dev-host" },
    }),
    SESSION_ID,
  );
  assert.equal(commands.length, 1);
  assert.match(commands[0], /claude/);
  assert.match(commands[0], /cwd/);
  assert.doesNotMatch(commands[0], /`/);
});
