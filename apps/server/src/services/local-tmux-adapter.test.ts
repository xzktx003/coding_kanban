import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTmuxCapturePaneArgs,
  buildTmuxSendKeyPlan,
  buildTmuxSendKeySteps,
  isNoTmuxServerError,
  parsePaneInfo,
  summarizeTmuxSessions,
} from "./local-tmux-adapter.js";

test("parsePaneInfo reads pane metadata including attach state", () => {
  const panes = parsePaneInfo(
    [
      "dev\t1\t1\t1\t%1\tcopilot\t/Users/hx/dev",
      "ops\t0\t1\t1\t%2\tshell\t/Users/hx/ops",
    ].join("\n"),
  );

  assert.equal(panes.length, 2);
  assert.equal(panes[0].sessionName, "dev");
  assert.equal(panes[0].attachedCount, 1);
  assert.equal(panes[0].paneActive, true);
  assert.equal(panes[1].currentCommand, "shell");
});

test("summarizeTmuxSessions groups panes by session and prefers active pane", () => {
  const sessions = summarizeTmuxSessions(
    parsePaneInfo(
      [
        "dev\t1\t0\t0\t%7\tshell\t/Users/hx/dev/a",
        "dev\t1\t1\t1\t%8\tcopilot\t/Users/hx/dev/b",
        "ops\t0\t1\t1\t%3\tshell\t/Users/hx/ops",
      ].join("\n"),
    ),
  );

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionName, "dev");
  assert.equal(sessions[0].paneId, "%8");
  assert.equal(sessions[0].interactionState, "running");
  assert.equal(sessions[1].sessionName, "ops");
  assert.equal(sessions[1].interactionState, "detached");
});

test("isNoTmuxServerError classifies missing server errors", () => {
  assert.equal(
    isNoTmuxServerError(
      new Error("no server running on /private/tmp/tmux-501/default\n"),
    ),
    true,
  );
  assert.equal(
    isNoTmuxServerError(new Error("failed to connect to server")),
    true,
  );
  assert.equal(
    isNoTmuxServerError(new Error("command not found: tmux")),
    false,
  );
});

test("buildTmuxCapturePaneArgs uses the configured capture line window", () => {
  assert.deepEqual(buildTmuxCapturePaneArgs("%7", 5000), [
    "capture-pane",
    "-p",
    "-t",
    "%7",
    "-S",
    "-5000",
  ]);
});

test("buildTmuxSendKeySteps preserves text submit while keeping paste raw", () => {
  assert.deepEqual(buildTmuxSendKeySteps("hello codex\r"), [
    { kind: "literal", value: "hello codex" },
    { kind: "keys", keys: ["Enter"] },
  ]);

  assert.deepEqual(buildTmuxSendKeySteps("hello codex"), [
    { kind: "literal", value: "hello codex" },
  ]);
});

test("buildTmuxSendKeySteps maps mobile control keys without appending Enter", () => {
  assert.deepEqual(buildTmuxSendKeySteps("\x03"), [
    { kind: "keys", keys: ["C-c"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b"), [
    { kind: "keys", keys: ["Escape"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x7f"), [
    { kind: "keys", keys: ["BSpace"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\t"), [
    { kind: "keys", keys: ["Tab"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[Z"), [
    { kind: "keys", keys: ["BTab"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\r"), [
    { kind: "keys", keys: ["Enter"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[13;2u"), [
    { kind: "keys", keys: ["S-Enter"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[13;5u"), [
    { kind: "keys", keys: ["C-Enter"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x0f"), [
    { kind: "keys", keys: ["C-o"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x05"), [
    { kind: "keys", keys: ["C-e"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x15\x17\x0b\x19"), [
    { kind: "keys", keys: ["C-u", "C-w", "C-k", "C-y"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x0c\x1a"), [
    { kind: "keys", keys: ["C-l", "C-z"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[A"), [
    { kind: "keys", keys: ["Up"] },
  ]);
});

test("buildTmuxSendKeySteps maps application-cursor arrow keys without literal input", () => {
  assert.deepEqual(buildTmuxSendKeySteps("\x1bOA"), [
    { kind: "keys", keys: ["Up"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1bOB"), [
    { kind: "keys", keys: ["Down"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1bOC"), [
    { kind: "keys", keys: ["Right"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1bOD"), [
    { kind: "keys", keys: ["Left"] },
  ]);
});

test("buildTmuxSendKeySteps maps modified xterm cursor keys without literal input", () => {
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[1;2D"), [
    { kind: "keys", keys: ["S-Left"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[1;5C"), [
    { kind: "keys", keys: ["C-Right"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[1;3A"), [
    { kind: "keys", keys: ["M-Up"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[1;6B"), [
    { kind: "keys", keys: ["C-S-Down"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("a\x1b[1;8Db"), [
    { kind: "literal", value: "a" },
    { kind: "keys", keys: ["C-M-S-Left"] },
    { kind: "literal", value: "b" },
  ]);
});

test("buildTmuxSendKeySteps maps xterm navigation keys without literal input", () => {
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[H\x1b[F\x1bOH\x1bOF"), [
    { kind: "keys", keys: ["Home", "End", "Home", "End"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[Z"), [
    { kind: "keys", keys: ["BTab"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[3~\x1b[2~"), [
    { kind: "keys", keys: ["DC", "IC"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[5;2~\x1b[6;5~"), [
    { kind: "keys", keys: ["S-PPage", "C-NPage"] },
  ]);
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[1;2H\x1b[1;5F"), [
    { kind: "keys", keys: ["S-Home", "C-End"] },
  ]);
});

test("buildTmuxSendKeySteps preserves bracketed paste blocks for tmux send-keys", () => {
  assert.deepEqual(buildTmuxSendKeySteps("\x1b[200~hello codex\x1b[201~"), [
    { kind: "literal", value: "\x1b[200~hello codex\x1b[201~" },
  ]);

  assert.deepEqual(
    buildTmuxSendKeySteps("before \x1b[200~line 1\nline 2\x1b[201~ after"),
    [
      {
        kind: "literal",
        value: "before \x1b[200~line 1\nline 2\x1b[201~ after",
      },
    ],
  );

  assert.deepEqual(buildTmuxSendKeySteps("\x1b[200~\x1b[201~"), [
    { kind: "literal", value: "\x1b[200~\x1b[201~" },
  ]);
});

test("buildTmuxSendKeyPlan keeps split bracketed paste chunks literal", () => {
  const firstChunk = buildTmuxSendKeyPlan("\x1b[200~line 1\r");
  assert.equal(firstChunk.bracketedPasteOpen, true);
  assert.deepEqual(firstChunk.steps, [
    { kind: "literal", value: "\x1b[200~line 1\r" },
  ]);

  const middleChunk = buildTmuxSendKeyPlan("line 2\r", {
    bracketedPasteOpen: firstChunk.bracketedPasteOpen,
  });
  assert.equal(middleChunk.bracketedPasteOpen, true);
  assert.deepEqual(middleChunk.steps, [{ kind: "literal", value: "line 2\r" }]);

  const finalChunk = buildTmuxSendKeyPlan("line 3\x1b[201~\r", {
    bracketedPasteOpen: middleChunk.bracketedPasteOpen,
  });
  assert.equal(finalChunk.bracketedPasteOpen, false);
  assert.deepEqual(finalChunk.steps, [
    { kind: "literal", value: "line 3\x1b[201~" },
    { kind: "keys", keys: ["Enter"] },
  ]);
});
