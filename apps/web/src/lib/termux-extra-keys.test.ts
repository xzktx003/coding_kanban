import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TERMUX_EXTRA_KEY_ROWS,
  applyTermuxExtraKey,
  classifyTermuxFinger,
  listenTermuxPointer,
  termuxFlingRows,
} from "./termux-extra-keys.js";

describe("termux extra keys", () => {
  it("uses the Termux default two rows", () => {
    assert.deepEqual(TERMUX_EXTRA_KEY_ROWS, [
      ["ESC", "/", "-", "HOME", "UP", "END", "PGUP"],
      ["TAB", "CTRL", "ALT", "LEFT", "DOWN", "RIGHT", "PGDN"],
    ]);
  });

  it("locks CTRL and ALT until the next key", () => {
    const locked = applyTermuxExtraKey("CTRL", { ctrl: false, alt: false });
    assert.equal(locked.bytes, null);
    assert.equal(locked.modifiers.ctrl, true);
    const typed = applyTermuxExtraKey("/", locked.modifiers);
    assert.equal(typed.bytes, "\x1f");
    assert.equal(typed.modifiers.ctrl, false);
    const alt = applyTermuxExtraKey("ALT", { ctrl: false, alt: false });
    const word = applyTermuxExtraKey("LEFT", alt.modifiers);
    assert.equal(word.bytes, "\x1b\x1b[D");
    const ctrlLeft = applyTermuxExtraKey("LEFT", { ctrl: true, alt: false });
    assert.equal(ctrlLeft.bytes, "\x1b[1;5D");
    assert.equal(ctrlLeft.modifiers.ctrl, false);
  });

  it("removes document pointer handlers so a later drag reaches nothing", () => {
    const target = new EventTarget();
    const seen: string[] = [];
    const stop = listenTermuxPointer(target, {
      down: () => seen.push("down"),
      move: () => seen.push("move"),
      up: () => seen.push("up"),
    });
    target.dispatchEvent(new Event("pointerdown"));
    stop();
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointermove"));
    target.dispatchEvent(new Event("pointerup"));
    assert.deepEqual(seen, ["down"]);
  });

  it("turns a fast release into extra wheel rows", () => {
    assert.equal(termuxFlingRows(-1.2, 18, 40), -3);
    assert.equal(termuxFlingRows(0, 18, 40), 0);
  });

  it("maps a tap to a click, a drag to a wheel, and a long press to nothing", () => {
    assert.equal(
      classifyTermuxFinger({
        moved: 2,
        deltaY: 0,
        lineHeight: 18,
        longPress: false,
        mouseTracking: true,
        alternateScreen: false,
      }).type,
      "tap",
    );
    assert.deepEqual(
      classifyTermuxFinger({
        moved: 36,
        deltaY: -36,
        lineHeight: 18,
        longPress: false,
        mouseTracking: true,
        alternateScreen: false,
      }),
      { type: "wheel", rows: -2 },
    );
    assert.equal(
      classifyTermuxFinger({
        moved: 1,
        deltaY: 0,
        lineHeight: 18,
        longPress: true,
        mouseTracking: true,
        alternateScreen: false,
      }).type,
      "none",
    );
    assert.deepEqual(
      classifyTermuxFinger({
        moved: 36,
        deltaY: -36,
        lineHeight: 18,
        longPress: false,
        mouseTracking: false,
        alternateScreen: false,
      }),
      { type: "local-scroll", rows: -2 },
    );
    assert.deepEqual(
      classifyTermuxFinger({
        moved: 40,
        deltaY: 18,
        lineHeight: 18,
        longPress: false,
        mouseTracking: false,
        alternateScreen: true,
      }),
      { type: "arrows", rows: 1 },
    );
  });
});
