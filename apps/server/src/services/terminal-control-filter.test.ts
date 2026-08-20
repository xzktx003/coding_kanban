import assert from "node:assert/strict";
import test from "node:test";

import {
  isTerminalControlPayload,
  isTerminalFocusPayload,
  isTerminalPtyControlPayload,
  isTerminalMousePayload,
  getTerminalProtocolQueryResponseKinds,
  getTerminalProtocolResponses,
  isTerminalProtocolResponsePayload,
  sanitizeReplayForTerminal,
  stripTerminalResponsePayload,
} from "./terminal-control-filter.js";

test("forward device-attribute responses to the PTY for capability handshakes", () => {
  // Copilot CLI probes the terminal with Primary DA (CSI c); xterm.js
  // auto-answers via term.onData. The reply MUST reach the PTY or the TUI
  // stays blocked waiting for capabilities and never accepts keystrokes.
  const sanitized = stripTerminalResponsePayload("\u001b[?1;2c");

  assert.equal(sanitized, "\u001b[?1;2c");
});

test("strip secondary device-attribute replies so shell prompts do not echo terminal version noise", () => {
  const sanitized = stripTerminalResponsePayload("\u001b[>0;276;0c");

  assert.equal(sanitized, "");
});

test("keep normal keyboard escape sequences intact", () => {
  const sanitized = stripTerminalResponsePayload("\u001b[A");

  assert.equal(sanitized, "\u001b[A");
});

test("keep modified keyboard escape sequences intact", () => {
  assert.equal(stripTerminalResponsePayload("\u001b[1;2D"), "\u001b[1;2D");
  assert.equal(stripTerminalResponsePayload("\u001b[1;5C"), "\u001b[1;5C");
  assert.equal(stripTerminalResponsePayload("\u001b[3;2~"), "\u001b[3;2~");
});

test("keep application-cursor keyboard escape sequences intact", () => {
  assert.equal(stripTerminalResponsePayload("\u001bOA"), "\u001bOA");
  assert.equal(stripTerminalResponsePayload("\u001bOB"), "\u001bOB");
  assert.equal(stripTerminalResponsePayload("\u001bOC"), "\u001bOC");
  assert.equal(stripTerminalResponsePayload("\u001bOD"), "\u001bOD");
});

test("keep CPR replies intact for interactive prompts", () => {
  const sanitized = stripTerminalResponsePayload("\u001b[12;42R");

  assert.equal(sanitized, "\u001b[12;42R");
});

test("keep DSR replies intact so TUIs receive their status answers", () => {
  const sanitized = stripTerminalResponsePayload("\u001b[0n");

  assert.equal(sanitized, "\u001b[0n");
});

test("identifies complete protocol replies so they can be serialized before user input", () => {
  assert.equal(isTerminalProtocolResponsePayload("\u001b[?1;2c"), true);
  assert.equal(isTerminalProtocolResponsePayload("\u001b[0n"), true);
  assert.equal(isTerminalProtocolResponsePayload("\u001b[12;42R"), true);
  assert.equal(isTerminalProtocolResponsePayload("\u001b[12R"), false);
  assert.equal(isTerminalProtocolResponsePayload("\u001b[A"), false);
});

test("classifies protocol queries and replies so stale replies cannot complete a different query", () => {
  assert.deepEqual(
    getTerminalProtocolQueryResponseKinds("\u001b[c\u001b[5n\u001b[6n"),
    ["device-attributes", "status", "cursor-position"],
  );
  assert.deepEqual(getTerminalProtocolResponses("\u001b[?1;2c\u001b[0n\u001b[12;42R"), [
    { kind: "device-attributes", payload: "\u001b[?1;2c" },
    { kind: "status", payload: "\u001b[0n" },
    { kind: "cursor-position", payload: "\u001b[12;42R" },
  ]);
});

test("identify xterm mouse reports that must enter tmux through the attached PTY", () => {
  assert.equal(isTerminalMousePayload("\u001b[<0;12;8M"), true);
  assert.equal(isTerminalMousePayload("\u001b[<0;12;8m"), true);
  assert.equal(isTerminalMousePayload("\u001b[M !!"), true);
  assert.equal(isTerminalMousePayload("\u001b[A"), false);
  assert.equal(isTerminalMousePayload("\u001b[12;42R"), false);
  assert.equal(isTerminalMousePayload("whoami"), false);
});

test("identify xterm focus reports that local tmux input must drop", () => {
  assert.equal(isTerminalFocusPayload("\u001b[I"), true);
  assert.equal(isTerminalFocusPayload("\u001b[O"), true);
  assert.equal(isTerminalFocusPayload("\u001b[I\u001b[O"), true);
  assert.equal(isTerminalFocusPayload("\u001b[A"), false);
  assert.equal(isTerminalFocusPayload("\u001bOA"), false);
  assert.equal(isTerminalFocusPayload("whoami"), false);
});

test("identify terminal control payloads that must bypass tmux send-keys", () => {
  assert.equal(isTerminalPtyControlPayload("\u001b[<0;12;8M"), true);
  assert.equal(isTerminalPtyControlPayload("\u001b[I"), true);
  assert.equal(isTerminalPtyControlPayload("\u001b[O"), true);
  assert.equal(isTerminalPtyControlPayload("\u001b[I\u001b[O"), true);
  assert.equal(isTerminalPtyControlPayload("\u001bOA"), false);
  assert.equal(isTerminalPtyControlPayload("\u001b[A"), false);
  assert.equal(isTerminalPtyControlPayload("whoami"), false);
});

test("classify mouse motion reports as non-semantic terminal control input", () => {
  assert.equal(isTerminalControlPayload("\u001b[<35;68;23M"), true);
  assert.equal(isTerminalControlPayload("\u001b[<64;68;23M"), true);
  assert.equal(isTerminalControlPayload("\u001b[<0;68;23M"), true);
  assert.equal(isTerminalControlPayload("hello\r"), false);
});

test("strip OSC color-query replies so shell prompts do not echo rgb payload noise", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]11;rgb:0e0e/1212/1717\u0007\u001b]10;rgb:f4f4/f1f1/eaea\u0007",
  );

  assert.equal(sanitized, "");
});

test("strip canonical 2-digit OSC rgb replies so short hex payload noise does not reach the PTY", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]11;rgb:ff/00/ab\u0007",
  );

  assert.equal(sanitized, "");
});

test("keep malformed OSC 10 replies intact when the rgb payload is not canonical", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]10;rgb:not-a-color\u0007",
  );

  assert.equal(sanitized, "\u001b]10;rgb:not-a-color\u0007");
});

test("keep all-hex OSC rgb replies intact when the payload length is wrong", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]11;rgb:abc/def/012\u0007",
  );

  assert.equal(sanitized, "\u001b]11;rgb:abc/def/012\u0007");
});

test("strip OSC 4 rgb replies so palette queries do not echo color noise", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]4;0;rgb:1111/2222/3333\u001b\\",
  );

  assert.equal(sanitized, "");
});

test("keep malformed OSC 4 replies intact when the rgb payload is not canonical", () => {
  const sanitized = stripTerminalResponsePayload(
    "\u001b]4;0;rgb:bad/value\u001b\\",
  );

  assert.equal(sanitized, "\u001b]4;0;rgb:bad/value\u001b\\");
});

test("sanitize replay removes window and cursor report sequences", () => {
  const replay =
    "prompt> \u001b[>cprompt redraw\u001b[6n\u001b[18t\u001b[12;42Rstill here";

  const sanitized = sanitizeReplayForTerminal(replay);

  assert.equal(sanitized, "prompt> prompt redrawstill here");
});

test("sanitize replay removes terminal input-mode toggles so remounts do not corrupt keyboard sequences", () => {
  const replay =
    "codex\u001b[?1004hfocus\u001b[?1hcursor\u001b[?1000;1006hmouse\u001b[?2004hpaste\u001b=\u001b>ready";

  const sanitized = sanitizeReplayForTerminal(replay);

  assert.equal(sanitized, "codexfocuscursormousepasteready");
});
