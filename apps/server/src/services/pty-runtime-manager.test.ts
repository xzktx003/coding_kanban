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
  readPtyScrollback,
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

  assert.equal(readPtyScrollback(state), "TRUNC_B\nTRUNC_C\n");
  assert.equal(state.scrollbackBytes, 16);
  assert.equal(state.droppedScrollbackBytes, 8);
  assert.equal(state.droppedScrollbackChunks, 1);
});

test("appendPtyScrollback compacts many small PTY fragments without changing replay", () => {
  const state = {
    droppedScrollbackBytes: 0,
    droppedScrollbackChunks: 0,
    scrollback: [],
    scrollbackBytes: 0,
  };

  for (let index = 0; index < 1_024; index += 1) {
    appendPtyScrollback(state, String(index % 10), 8_192);
  }

  assert.equal(
    readPtyScrollback(state),
    Array.from({ length: 1_024 }, (_, index) => String(index % 10)).join(""),
  );
  assert.ok(
    state.scrollback.length <= 128,
    `expected bounded chunks, received ${state.scrollback.length}`,
  );
});

test("appendPtyScrollback keeps a UTF-8-safe suffix within the byte limit", () => {
  const state = {
    droppedScrollbackBytes: 0,
    droppedScrollbackChunks: 0,
    scrollback: [],
    scrollbackBytes: 0,
  };

  appendPtyScrollback(state, "甲乙丙", 5);

  assert.equal(readPtyScrollback(state), "丙");
  assert.equal(state.scrollbackBytes, 3);
  assert.equal(state.droppedScrollbackBytes, 6);
  assert.equal(state.droppedScrollbackChunks, 1);
});

test("appendPtyScrollback keeps the newest byte window across repeated compaction", () => {
  const state = {
    droppedScrollbackBytes: 0,
    droppedScrollbackChunks: 0,
    scrollback: [],
    scrollbackBytes: 0,
  };
  const output = Array.from({ length: 2_000 }, (_, index) =>
    String(index % 10),
  ).join("");

  for (const fragment of output) {
    appendPtyScrollback(state, fragment, 137);
  }

  assert.equal(readPtyScrollback(state), output.slice(-137));
  assert.equal(state.scrollbackBytes, 137);
  assert.equal(state.droppedScrollbackBytes, output.length - 137);
  assert.ok(state.scrollback.length <= 128);

  appendPtyScrollback(state, "tail", 137);
  assert.equal(readPtyScrollback(state), `${output}tail`.slice(-137));
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
    assert.equal(await runtimeManager.waitForTmuxClientReady(session.id), true);

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

test("launch keeps English input working when tmux normalizes periods in the requested name", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const requestedSessionName = `pty.tmux-input-${Date.now()}`;
  const actualSessionName = requestedSessionName.replaceAll(".", "_");
  const marker = `TMUX_DOTTED_INPUT_${Date.now()}`;

  killTmuxSession(requestedSessionName);
  killTmuxSession(actualSessionName);

  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: requestedSessionName,
    agentKind: "shell",
    command: `tmux new-session -s '${requestedSessionName}' -c '${process.cwd()}'`,
    workingDirectory: process.cwd(),
    tmuxSessionName: requestedSessionName,
  });

  try {
    assert.equal(session.displayName, requestedSessionName);
    assert.equal(session.transportRef?.tmuxSession, actualSessionName);
    assert.equal(await runtimeManager.waitForTmuxClientReady(session.id), true);

    await runtimeManager.write(session.id, `printf '${marker}\\n'\r`);
    const output = await waitForTmuxCaptureMatch(
      actualSessionName,
      new RegExp(marker),
    );
    assert.match(output, new RegExp(marker));
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
    killTmuxSession(actualSessionName);
  }
});

test("dispose kills every active PTY so backend reloads cannot orphan tmux clients", () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const first = runtimeManager.launch({
    workspaceId: "default",
    displayName: "dispose-first",
    agentKind: "shell",
    command: "sleep 30",
  });
  const second = runtimeManager.launch({
    workspaceId: "default",
    displayName: "dispose-second",
    agentKind: "shell",
    command: "sleep 30",
  });

  assert.equal(runtimeManager.has(first.id), true);
  assert.equal(runtimeManager.has(second.id), true);

  runtimeManager.dispose();

  assert.equal(runtimeManager.has(first.id), false);
  assert.equal(runtimeManager.has(second.id), false);
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

test("holds ordinary input until all terminal capability replies have reached the PTY", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: "terminal-protocol-ordering",
    agentKind: "shell",
    workingDirectory: process.cwd(),
    command:
      "stty raw -echo; printf '\\033['; sleep 0.05; printf '6n'; head -c 8 | od -An -t x1; stty sane; IFS= read -r command; printf '__COMMAND__%s\\n' \"$command\"; exit",
  });

  try {
    await waitForOutputMatch(registry, session.id, /6n/);

    let ordinaryInputCompleted = false;
    const ordinaryInput = runtimeManager
      .write(session.id, "node\n")
      .then(() => {
        ordinaryInputCompleted = true;
      });

    await sleep(25);
    assert.equal(ordinaryInputCompleted, false);

    await runtimeManager.write(session.id, "\u001b[?1;2c");
    await sleep(25);
    assert.equal(ordinaryInputCompleted, false);

    await runtimeManager.write(session.id, "\u001b[12;34R");
    await ordinaryInput;

    const outputText = await waitForOutputMatch(
      registry,
      session.id,
      /__COMMAND__node/,
    );

    assert.match(outputText, /1b 5b 31 32 3b 33 34 52/);
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
  }
});

test("falls back to conservative terminal replies when no browser has mounted yet", async () => {
  const registry = new AgentSessionRegistry();
  const runtimeManager = new PtyRuntimeManager(registry);
  const session = runtimeManager.launch({
    workspaceId: "default",
    displayName: "terminal-protocol-fallback",
    agentKind: "shell",
    workingDirectory: process.cwd(),
    command:
      "stty raw -echo; printf '\\033[c\\033[6n'; head -c 13 | od -An -t x1; stty sane; printf '__FALLBACK__\\n'; exit",
  });

  try {
    const outputText = await waitForOutputMatch(
      registry,
      session.id,
      /__FALLBACK__/,
    );

    assert.match(outputText, /1b 5b 3f 31 3b 32 63/);
    assert.match(outputText, /1b 5b 31 3b 31 52/);
  } finally {
    runtimeManager.kill(session.id);
    registry.remove(session.id);
  }
});
