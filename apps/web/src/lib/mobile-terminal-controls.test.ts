import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildMobileComposerInput,
  buildMobileComposerInputFrames,
  createMobilePressRepeater,
  exceedsMobileTerminalHoldMovement,
  getMobileTerminalControlInput,
  isMobileTerminalControlRepeatable,
  MOBILE_TERMINAL_HOLD_REPEAT_DELAY_MS,
  MOBILE_TERMINAL_TOOLBAR_ORDER,
  sendMobileComposerFrames,
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
    assert.equal(
      getMobileTerminalControlInput("arrow-down", true),
      "\x1b[1;2B",
    );
    assert.equal(
      getMobileTerminalControlInput("arrow-left", true),
      "\x1b[1;2D",
    );
    assert.equal(
      getMobileTerminalControlInput("arrow-right", true),
      "\x1b[1;2C",
    );
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
  });

  it("keeps paste mode bracketed without adding enter", () => {
    assert.deepEqual(buildMobileComposerInputFrames("hello codex", "paste"), [
      "\x1b[200~hello codex\x1b[201~",
    ]);
    assert.equal(
      buildMobileComposerInput("line 1\r\nline 2", "paste"),
      "\x1b[200~line 1\nline 2\x1b[201~",
    );
  });

  it("keeps every shortcut in one frequent-first toolbar row", () => {
    assert.deepEqual(MOBILE_TERMINAL_TOOLBAR_ORDER, [
      "shift",
      "escape",
      "interrupt",
      "enter",
      "tab",
      "arrow-left",
      "arrow-up",
      "arrow-down",
      "arrow-right",
      "backspace",
      "shift-tab",
      "shift-enter",
      "ctrl-enter",
      "ctrl-l",
      "ctrl-z",
      "help",
    ]);
  });

  it("limits long-press repeat to cursor movement and backspace", () => {
    assert.equal(isMobileTerminalControlRepeatable("arrow-up"), true);
    assert.equal(isMobileTerminalControlRepeatable("arrow-down"), true);
    assert.equal(isMobileTerminalControlRepeatable("arrow-left"), true);
    assert.equal(isMobileTerminalControlRepeatable("arrow-right"), true);
    assert.equal(isMobileTerminalControlRepeatable("backspace"), true);
    assert.equal(isMobileTerminalControlRepeatable("enter"), false);
    assert.equal(isMobileTerminalControlRepeatable("interrupt"), false);
  });

  it("cancels a pending hold when the finger starts scrolling", () => {
    assert.equal(MOBILE_TERMINAL_HOLD_REPEAT_DELAY_MS, 3000);
    assert.equal(exceedsMobileTerminalHoldMovement(0, 0, 6, 8), false);
    assert.equal(exceedsMobileTerminalHoldMovement(0, 0, 11, 0), true);
  });

  it("repeats serially while held and stops without building a backlog", async () => {
    interface ScheduledTask {
      callback: () => void;
      delayMs: number;
    }
    const scheduled: ScheduledTask[] = [];
    const scheduler = {
      setTimeout(callback: () => void, delayMs: number) {
        const task = { callback, delayMs };
        scheduled.push(task);
        return task;
      },
      clearTimeout(handle: unknown) {
        const index = scheduled.indexOf(handle as ScheduledTask);
        if (index >= 0) scheduled.splice(index, 1);
      },
    };
    let calls = 0;
    const repeater = createMobilePressRepeater(
      async () => {
        calls += 1;
      },
      { delayMs: 85, intervalMs: 85, scheduler, startDelayMs: 3000 },
    );

    repeater.start();
    await Promise.resolve();
    assert.equal(calls, 0);
    assert.equal(scheduled[0]?.delayMs, 3000);

    const start = scheduled.shift();
    start?.callback();
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(scheduled[0]?.delayMs, 85);

    const repeat = scheduled.shift();
    repeat?.callback();
    await Promise.resolve();
    assert.equal(calls, 2);
    assert.equal(scheduled[0]?.delayMs, 85);

    repeater.stop();
    assert.equal(scheduled.length, 0);
  });

  it("reports the failed composer frame so retry only sends the remainder", async () => {
    const frames = buildMobileComposerInputFrames("hello codex", "send");
    const firstAttempt: string[] = [];
    const failed = await sendMobileComposerFrames(frames, async (input) => {
      firstAttempt.push(input);
      if (input === "\r") throw new Error("offline");
    });

    assert.deepEqual(firstAttempt, ["\x1b[200~hello codex\x1b[201~", "\r"]);
    assert.equal(failed.ok, false);
    if (failed.ok) assert.fail("expected the submit frame to fail");
    assert.equal(failed.nextFrameIndex, 1);

    const retried: string[] = [];
    const retryResult = await sendMobileComposerFrames(
      frames,
      async (input) => {
        retried.push(input);
      },
      failed.nextFrameIndex,
    );
    assert.deepEqual(retried, ["\r"]);
    assert.equal(retryResult.ok, true);
  });
});
