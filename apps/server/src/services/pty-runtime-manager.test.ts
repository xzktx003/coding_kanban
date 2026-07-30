import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import {
  appendPtyScrollback,
  buildLocalSpawnPlan,
  buildRemoteTmuxCaptureCommand,
  PtyRuntimeManager,
  sanitizeReplayForTerminal,
  stripAlternateScreenSwitches,
} from "./pty-runtime-manager.js";
import { resolveCopilotBinary } from "./copilot-binary.js";
import { resolveTmuxBinary } from "./runtime-compat.js";

const TMUX_BINARY = resolveTmuxBinary();

function killTmuxSession(sessionName: string): void {
  try {
    execFileSync(TMUX_BINARY, ["kill-session", "-t", sessionName], {
      stdio: "ignore",
    });
  } catch {
    // ignore cleanup failures
  }
}

async function waitForTmuxCaptureMatch(
  sessionName: string,
  pattern: RegExp,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const output = execFileSync(
      TMUX_BINARY,
      ["capture-pane", "-p", "-t", sessionName, "-S", "-200"],
      {
        encoding: "utf8",
      },
    );

    if (pattern.test(output)) {
      return output;
    }

    await sleep(50);
  }

  throw new Error(
    `tmux session did not output ${pattern} within ${timeoutMs}ms`,
  );
}

async function waitForExit(
  registry: AgentSessionRegistry,
  sessionId: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (registry.get(sessionId).interactionState === "exited") {
      return;
    }

    await sleep(50);
  }

  throw new Error(`PTY session did not exit within ${timeoutMs}ms`);
}

async function waitForOutputMatch(
  registry: AgentSessionRegistry,
  sessionId: string,
  pattern: RegExp,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const outputText = registry
      .getDetail(sessionId)
      .outputEntries.map((entry) => entry.text)
      .join("\n");

    if (pattern.test(outputText)) {
      return outputText;
    }

    await sleep(50);
  }

  throw new Error(
    `PTY session did not output ${pattern} within ${timeoutMs}ms`,
  );
}

test("launch does not leak npm config env vars into local PTY sessions", async () => {
  const originalRecursive = process.env.npm_config_recursive;
  const originalVerifyDeps = process.env.npm_config_verify_deps_before_run;
  const originalJsrRegistry = process.env.npm_config__jsr_registry;

  process.env.npm_config_recursive = "1";
  process.env.npm_config_verify_deps_before_run = "true";
  process.env.npm_config__jsr_registry = "https://registry.example.test";

  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);

  try {
    const session = runtimeManager.launch({
      workspaceId: "default",
      displayName: "env-leak-test",
      agentKind: "shell",
      workingDirectory: process.cwd(),
      command: "env | grep '^npm_config_' || true; printf '__DONE__\\n'; exit",
    });

    await waitForExit(registry, session.id);

    const detail = registry.getDetail(session.id);
    const outputText = detail.outputEntries
      .map((entry) => entry.text)
      .join("\n");

    assert.doesNotMatch(outputText, /npm_config_recursive=/);
    assert.doesNotMatch(outputText, /npm_config_verify_deps_before_run=/);
    assert.doesNotMatch(outputText, /npm_config__jsr_registry=/);
    assert.match(outputText, /__DONE__/);
  } finally {
    process.env.npm_config_recursive = originalRecursive;
    process.env.npm_config_verify_deps_before_run = originalVerifyDeps;
    process.env.npm_config__jsr_registry = originalJsrRegistry;
  }
});

test("launch stores the resolved local working directory when input is omitted", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: "default-cwd-test",
    agentKind: "shell",
    command: "pwd; printf '__DONE__\\n'; exit",
  });

  await waitForExit(registry, session.id);

  const detail = registry.getDetail(session.id);
  const outputText = detail.outputEntries.map((entry) => entry.text).join("\n");

  assert.equal(registry.get(session.id).workingDirectory, process.cwd());
  assert.match(
    outputText,
    new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("a replaced PTY exit cannot mark the current runtime offline", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const launchInput = {
    workspaceId: "default",
    displayName: "stale-exit-test",
    agentKind: "shell" as const,
    workingDirectory: process.cwd(),
    command: "sleep 30",
  };
  const session = runtimeManager.launch(launchInput);

  try {
    const replacement = runtimeManager.reconnectLocal(session.id, launchInput);

    assert.notEqual(
      replacement.transportRef?.runtimeId,
      session.transportRef?.runtimeId,
    );

    await sleep(250);

    const current = registry.get(session.id);
    assert.equal(
      current.transportRef?.runtimeId,
      replacement.transportRef?.runtimeId,
    );
    assert.equal(current.connectionState, "online");
    assert.notEqual(current.interactionState, "exited");
    assert.equal(runtimeManager.has(session.id), true);
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
  }
});

test("appendPtyScrollback tracks truncation when replay buffer is exceeded", () => {
  const state = {
    droppedScrollbackBytes: 0,
    droppedScrollbackChunks: 0,
    scrollback: [],
    scrollbackBytes: 0,
  };

  appendPtyScrollback(state, "TRUNC_A\n", 16);
  appendPtyScrollback(state, "TRUNC_B\n", 16);
  appendPtyScrollback(state, "TRUNC_C\n", 16);

  assert.deepEqual(state.scrollback, ["TRUNC_B\n", "TRUNC_C\n"]);
  assert.equal(state.scrollbackBytes, 16);
  assert.equal(state.droppedScrollbackBytes, 8);
  assert.equal(state.droppedScrollbackChunks, 1);
});

test("buildRemoteTmuxCaptureCommand sets history limit before capturing pane history", () => {
  const command = buildRemoteTmuxCaptureCommand("dev's", "%5", 20000);

  assert.match(command, /tmux set-option -t 'dev'\\''s' history-limit 20000/);
  assert.match(command, /tmux capture-pane -p -t '%5' -S -20000/);
});

test("stripAlternateScreenSwitches keeps tmux attach output in the normal scrollback buffer", () => {
  const output =
    "before\u001b[?1049hfullscreen\u001b[?1048hcursor\u001b[?1047lafter";

  assert.equal(
    stripAlternateScreenSwitches(output),
    "beforefullscreencursorafter",
  );
});

test("managed tmux commands bypass interactive user shell startup files", () => {
  const plan = buildLocalSpawnPlan("/bin/zsh", {
    workspaceId: "default",
    displayName: "isolated tmux",
    agentKind: "shell",
    command: "tmux attach -t 'isolated-tmux'",
    workingDirectory: process.cwd(),
    tmuxSessionName: "isolated-tmux",
  });

  assert.equal(plan.file, "/bin/sh");
  assert.deepEqual(plan.args, ["-c", "exec tmux attach -t 'isolated-tmux'"]);
  assert.equal(plan.sendInitialCommand, false);
});

test("explicit direct commands bypass interactive user shell startup files", () => {
  const plan = buildLocalSpawnPlan("/bin/zsh", {
    workspaceId: "default",
    displayName: "direct command",
    agentKind: "shell",
    command: "printf '__DIRECT_COMMAND__\\n'; exit",
    workingDirectory: process.cwd(),
  });

  assert.equal(plan.file, "/bin/sh");
  assert.deepEqual(plan.args, ["-c", "printf '__DIRECT_COMMAND__\\n'; exit"]);
  assert.equal(plan.sendInitialCommand, false);
});

test("launch prefers the resolved copilot binary on PATH for shell sessions", async () => {
  const preferredCopilotBinary = resolveCopilotBinary();
  assert.ok(preferredCopilotBinary, "expected a resolvable copilot binary");

  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: "copilot-path-preference-test",
    agentKind: "shell",
    workingDirectory: process.cwd(),
    command: "command -v copilot; printf '__DONE__\\n'; exit",
  });

  await waitForExit(registry, session.id);

  const outputText = registry
    .getDetail(session.id)
    .outputEntries.map((entry) => entry.text)
    .join("\n");

  const escapedBinaryPath = preferredCopilotBinary.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  assert.match(outputText, new RegExp(escapedBinaryPath));
  assert.match(outputText, /__DONE__/);
});

test("launch does not surface npm config warnings before local Copilot starts", async () => {
  const originalPath = process.env.PATH;
  const originalPlaywrightTest = process.env.PLAYWRIGHT_TEST;
  const playwrightBin = resolve(process.cwd(), "..", "..", ".playwright-bin");
  process.env.PATH = [playwrightBin, originalPath]
    .filter(Boolean)
    .join(delimiter);
  process.env.PLAYWRIGHT_TEST = "1";

  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: "copilot-warning-test",
    agentKind: "copilot",
    command: "cd '.' && copilot",
  });

  try {
    const outputText = await waitForOutputMatch(
      registry,
      session.id,
      /GitHub Copilot|fake-copilot-start|Unknown env config/,
      10000,
    );

    assert.doesNotMatch(outputText, /Unknown env config/);
    assert.match(outputText, /GitHub Copilot|fake-copilot-start/);
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
    process.env.PATH = originalPath;
    process.env.PLAYWRIGHT_TEST = originalPlaywrightTest;
  }
});

test("launch keeps tmux attach sessions alive when the card is labeled as copilot", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const sessionName = `pty-tmux-attach-${Date.now()}`;
  const marker = `TMUX_ATTACH_OK_${Date.now()}`;
  const originalRecursive = process.env.npm_config_recursive;
  const originalVerifyDeps = process.env.npm_config_verify_deps_before_run;
  const originalJsrRegistry = process.env.npm_config__jsr_registry;

  killTmuxSession(sessionName);
  process.env.npm_config_recursive = "1";
  process.env.npm_config_verify_deps_before_run = "true";
  process.env.npm_config__jsr_registry = "https://registry.example.test";
  execFileSync(
    TMUX_BINARY,
    [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      `sh -lc 'printf "${marker}\\n"; sleep 30'`,
    ],
    {
      stdio: "ignore",
    },
  );

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: sessionName,
    agentKind: "copilot",
    command: `tmux attach -t '${sessionName}'`,
    workingDirectory: process.cwd(),
    tmuxSessionName: sessionName,
  });

  try {
    const outputText = await waitForOutputMatch(
      registry,
      session.id,
      new RegExp(
        `${marker}|double-loading config|Exit prior to config file resolving|Unknown env config`,
      ),
      10000,
    );

    assert.match(outputText, new RegExp(marker));
    assert.doesNotMatch(outputText, /double-loading config/);
    assert.doesNotMatch(outputText, /Exit prior to config file resolving/);
    assert.doesNotMatch(outputText, /Unknown env config/);
    assert.notEqual(registry.get(session.id).interactionState, "exited");
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
    killTmuxSession(sessionName);
    process.env.npm_config_recursive = originalRecursive;
    process.env.npm_config_verify_deps_before_run = originalVerifyDeps;
    process.env.npm_config__jsr_registry = originalJsrRegistry;
  }
});

test("launch seeds tmux attach replay with pane history outside the visible screen", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry, {
    tmuxCaptureLines: 120,
  });
  const sessionName = `pty-tmux-history-${Date.now()}`;
  const marker = `H${Date.now().toString(36)}`;

  killTmuxSession(sessionName);
  execFileSync(
    TMUX_BINARY,
    [
      "new-session",
      "-d",
      "-s",
      sessionName,
      "-c",
      process.cwd(),
      `sh -lc 'i=1; while [ "$i" -le 80 ]; do if [ "$i" -lt 10 ]; then pad="00$i"; else pad="0$i"; fi; echo "${marker}_$pad"; i=$((i + 1)); done; sleep 30'`,
    ],
    {
      stdio: "ignore",
    },
  );

  await waitForTmuxCaptureMatch(sessionName, new RegExp(`${marker}_080`));

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: sessionName,
    agentKind: "shell",
    command: `tmux attach -t '${sessionName}'`,
    workingDirectory: process.cwd(),
    tmuxSessionName: sessionName,
  });

  try {
    const replay = runtimeManager.getScrollback(session.id);
    const historyLimit = execFileSync(
      TMUX_BINARY,
      ["show-options", "-v", "-t", sessionName, "history-limit"],
      {
        encoding: "utf8",
      },
    ).trim();

    assert.match(replay, new RegExp(`${marker}_001`));
    assert.match(replay, new RegExp(`${marker}_080`));
    assert.equal(historyLimit, "120");
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
    killTmuxSession(sessionName);
  }
});

test("strip replayed device attribute and status queries", () => {
  const replay = "prompt> \u001b[>cprompt redraw\u001b[6n\u001b[18tstill here";

  const sanitized = sanitizeReplayForTerminal(replay);

  assert.equal(sanitized, "prompt> prompt redrawstill here");
});

test("keep normal styling escapes in replay", () => {
  const replay = "\u001b[31mred\u001b[0m text";

  const sanitized = sanitizeReplayForTerminal(replay);

  assert.equal(sanitized, replay);
});
