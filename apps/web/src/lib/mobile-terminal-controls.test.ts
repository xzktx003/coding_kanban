import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildMobileComposerInput,
  buildMobileComposerInputFrames,
  getMobileTerminalControlInput,
} from "./mobile-terminal-controls.js";

describe("mobile terminal controls", () => {
  it("maps touch buttons to real terminal control sequences", () => {
    assert.equal(getMobileTerminalControlInput("interrupt"), "\x03");
    assert.equal(getMobileTerminalControlInput("escape"), "\x1b");
    assert.equal(getMobileTerminalControlInput("backspace"), "\x7f");
    assert.equal(getMobileTerminalControlInput("tab"), "\t");
    assert.equal(getMobileTerminalControlInput("shift-tab"), "\x1b[Z");
    assert.equal(getMobileTerminalControlInput("enter"), "\r");
    assert.equal(getMobileTerminalControlInput("shift-enter"), "\x1b[13;2u");
    assert.equal(getMobileTerminalControlInput("ctrl-enter"), "\x1b[13;5u");
    assert.equal(getMobileTerminalControlInput("arrow-up"), "\x1b[A");
    assert.equal(getMobileTerminalControlInput("arrow-down"), "\x1b[B");
    assert.equal(getMobileTerminalControlInput("arrow-left"), "\x1b[D");
    assert.equal(getMobileTerminalControlInput("arrow-right"), "\x1b[C");
    assert.equal(getMobileTerminalControlInput("ctrl-l"), "\x0c");
    assert.equal(getMobileTerminalControlInput("ctrl-z"), "\x1a");
  });

  it("applies a one-shot Shift modifier to supported terminal controls", () => {
    assert.equal(getMobileTerminalControlInput("tab", true), "\x1b[Z");
    assert.equal(getMobileTerminalControlInput("enter", true), "\x1b[13;2u");
    assert.equal(getMobileTerminalControlInput("arrow-up", true), "\x1b[1;2A");
    assert.equal(getMobileTerminalControlInput("arrow-down", true), "\x1b[1;2B");
    assert.equal(getMobileTerminalControlInput("arrow-left", true), "\x1b[1;2D");
    assert.equal(getMobileTerminalControlInput("arrow-right", true), "\x1b[1;2C");
    assert.equal(getMobileTerminalControlInput("interrupt", true), "\x03");
  });

  it("turns composer send into paste followed by a separate submit key", () => {
    assert.deepEqual(buildMobileComposerInputFrames("hello codex", "send"), [
      "\x1b[200~hello codex\x1b[201~",
      "\r",
    ]);
    assert.deepEqual(buildMobileComposerInputFrames("hello codex\n", "send"), [
      "\x1b[200~hello codex\x1b[201~",
      "\r",
    ]);
    assert.equal(
      buildMobileComposerInput("hello codex", "send"),
      "\x1b[200~hello codex\x1b[201~\r",
    );
  });

  it("keeps multiline prompts together before submitting", () => {
    assert.deepEqual(
      buildMobileComposerInputFrames("line 1\r\nline 2", "send"),
      ["\x1b[200~line 1\nline 2\x1b[201~", "\r"],
    );
    assert.deepEqual(
      buildMobileComposerInputFrames("line 1\nline 2", "paste-run"),
      ["\x1b[200~line 1\nline 2\x1b[201~", "\r"],
    );
  });

  it("keeps paste mode as raw text without adding enter", () => {
    assert.deepEqual(buildMobileComposerInputFrames("hello codex", "paste"), [
      "hello codex",
    ]);
    assert.equal(
      buildMobileComposerInput("line 1\r\nline 2", "paste"),
      "line 1\nline 2",
    );
  });
});
