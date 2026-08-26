import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeTerminalReconnectDelay,
  getTerminalInputModeRestoreSequence,
  shouldAttemptTerminalInputForward,
} from "./terminal-input-forwarding.js";

describe("terminal input forwarding", () => {
  it("does not forward stdin from monitor-only panes", () => {
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: false,
        sanitizedPayload: "whoami",
        socketOpen: true,
      }),
      false,
    );
  });

  it("still forwards terminal handshake replies from monitor-only panes", () => {
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: false,
        sanitizedPayload: "\u001b[?1;2c",
        socketOpen: true,
      }),
      true,
    );
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: false,
        sanitizedPayload: "\u001b[A",
        socketOpen: true,
      }),
      false,
    );
  });

  it("forwards stdin only from the active input pane over an open socket", () => {
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: true,
        sanitizedPayload: "whoami",
        socketOpen: true,
      }),
      true,
    );
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: true,
        sanitizedPayload: "whoami",
        socketOpen: false,
      }),
      false,
    );
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: true,
        sanitizedPayload: "",
        socketOpen: true,
      }),
      false,
    );
  });

  it("forwards only protocol replies while the terminal replay is still loading", () => {
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: true,
        terminalInputReady: false,
        sanitizedPayload: "typed too early",
        socketOpen: true,
      }),
      false,
    );
    assert.equal(
      shouldAttemptTerminalInputForward({
        inputEnabled: true,
        terminalInputReady: false,
        sanitizedPayload: "\u001b[?1;2c",
        socketOpen: true,
      }),
      true,
    );
  });

  it("reconnects quickly with a bounded exponential delay", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 100].map(computeTerminalReconnectDelay),
      [250, 500, 1_000, 2_000, 4_000, 5_000, 5_000],
    );
    assert.equal(computeTerminalReconnectDelay(-1), 250);
    assert.equal(computeTerminalReconnectDelay(Number.NaN), 250);
  });

  it("restores bracketed paste after sanitized OpenCode replay", () => {
    assert.equal(
      getTerminalInputModeRestoreSequence({ restoreBracketedPaste: true }),
      "\u001b[?2004h",
    );
    assert.equal(
      getTerminalInputModeRestoreSequence({ restoreBracketedPaste: false }),
      "",
    );
  });
});
