import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSafariTextInputRecoveryState,
  isSafariTerminalInputRecoveryRequired,
  recordTerminalTextForSafariRecovery,
  recoverSafariNativeTextInput,
} from "./terminal-safari-input.js";

describe("Safari terminal input recovery", () => {
  it("enables the fallback only for Safari", () => {
    assert.equal(
      isSafariTerminalInputRecoveryRequired({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
        vendor: "Apple Computer, Inc.",
      }),
      true,
    );
    assert.equal(
      isSafariTerminalInputRecoveryRequired({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        vendor: "Google Inc.",
      }),
      false,
    );
  });

  it("forwards native insertText data that xterm did not emit", () => {
    const state = createSafariTextInputRecoveryState();

    assert.equal(recoverSafariNativeTextInput(state, "fast", 10), "fast");
  });

  it("does not duplicate text that xterm already emitted", () => {
    const state = createSafariTextInputRecoveryState();
    recordTerminalTextForSafariRecovery(state, "fast", 10);

    assert.equal(recoverSafariNativeTextInput(state, "fast", 12), "");
  });

  it("forwards only the missing suffix when Safari combines native input", () => {
    const state = createSafariTextInputRecoveryState();
    recordTerminalTextForSafariRecovery(state, "fa", 10);

    assert.equal(recoverSafariNativeTextInput(state, "fast", 12), "st");
  });

  it("keeps a later xterm character available when an earlier native character was missed", () => {
    const state = createSafariTextInputRecoveryState();
    recordTerminalTextForSafariRecovery(state, "b", 10);

    assert.equal(recoverSafariNativeTextInput(state, "a", 12), "a");
    assert.equal(recoverSafariNativeTextInput(state, "b", 14), "");
  });

  it("does not let stale or control input suppress a later character", () => {
    const state = createSafariTextInputRecoveryState();
    recordTerminalTextForSafariRecovery(state, "a", 10);

    assert.equal(recoverSafariNativeTextInput(state, "a", 500), "a");

    recordTerminalTextForSafariRecovery(state, "\u001b[A", 510);
    assert.equal(recoverSafariNativeTextInput(state, "b", 512), "b");
  });
});
