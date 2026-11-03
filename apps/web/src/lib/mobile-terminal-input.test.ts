import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mobileAccessoryKeyInput,
  mobileImeCommit,
  type MobileAccessoryKey,
} from "./mobile-terminal-input.js";

describe("mobile terminal input", () => {
  it("maps accessory keys to the bytes the session PTY must receive", () => {
    const expected: Record<MobileAccessoryKey, string> = {
      escape: "\x1b",
      tab: "\t",
      "arrow-up": "\x1b[A",
      "arrow-down": "\x1b[B",
      "arrow-left": "\x1b[D",
      "arrow-right": "\x1b[C",
      enter: "\r",
      "ctrl-c": "\x03",
      "ctrl-d": "\x04",
      backspace: "\x7f",
      "shift-tab": "\x1b[Z",
      "shift-enter": "\x1b[13;2u",
      "ctrl-enter": "\x1b[13;5u",
      "ctrl-l": "\x0c",
      "ctrl-z": "\x1a",
    };

    for (const [key, bytes] of Object.entries(expected)) {
      assert.equal(mobileAccessoryKeyInput(key as MobileAccessoryKey), bytes);
    }
  });

  it("holds an in-progress IME composition and sends only the committed string", () => {
    assert.equal(
      mobileImeCommit({ type: "compositionupdate", data: "ni" }),
      null,
    );
    assert.equal(
      mobileImeCommit({ type: "input", data: "ni", composing: true }),
      null,
    );
    assert.equal(
      mobileImeCommit({ type: "compositionend", data: "你" }),
      "你",
    );
    assert.equal(
      mobileImeCommit({ type: "input", data: "hello", composing: false }),
      "hello",
    );
    assert.equal(
      mobileImeCommit({ type: "input", data: "", composing: false }),
      null,
    );
  });
});
