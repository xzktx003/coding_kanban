import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampMobileTerminalFontSize,
  computeMobilePinchFontSize,
  computeMobileTerminalScrollLines,
  getMobileTerminalCursorOptions,
  initializeMobileTerminalCursor,
  measureTouchDistance,
} from "./mobile-terminal-touch.js";

describe("mobile terminal touch helpers", () => {
  it("converts downward drag into xterm scrollback movement", () => {
    const result = computeMobileTerminalScrollLines({
      accumulatedDeltaY: 34,
      lineHeight: 16,
    });

    assert.deepEqual(result, {
      remainingDeltaY: 2,
      scrollLines: -2,
    });
  });

  it("keeps sub-line touch movement accumulated", () => {
    const result = computeMobileTerminalScrollLines({
      accumulatedDeltaY: 7,
      lineHeight: 16,
    });

    assert.deepEqual(result, {
      remainingDeltaY: 7,
      scrollLines: 0,
    });
  });

  it("measures pinch distance and clamps font size", () => {
    assert.equal(
      measureTouchDistance(
        { clientX: 0, clientY: 0 },
        { clientX: 3, clientY: 4 },
      ),
      5,
    );
    assert.equal(clampMobileTerminalFontSize(8), 11);
    assert.equal(clampMobileTerminalFontSize(99), 24);
    assert.equal(
      computeMobilePinchFontSize({
        currentDistance: 160,
        startDistance: 80,
        startFontSize: 12,
      }),
      24,
    );
  });

  it("keeps an underline cursor visible while mobile controls own focus", () => {
    assert.deepEqual(getMobileTerminalCursorOptions(true), {
      cursorInactiveStyle: "underline",
      cursorStyle: "underline",
    });
    assert.deepEqual(getMobileTerminalCursorOptions(false), {
      cursorInactiveStyle: "outline",
      cursorStyle: "block",
    });
  });

  it("initializes the xterm cursor without leaving the monitor focused", () => {
    const calls: string[] = [];
    const terminal = {
      blur: () => calls.push("blur"),
      focus: () => calls.push("focus"),
    };

    assert.equal(
      initializeMobileTerminalCursor({
        inputEnabled: false,
        mobileTouchMode: true,
        terminal,
      }),
      true,
    );
    assert.deepEqual(calls, ["focus", "blur"]);

    calls.length = 0;
    assert.equal(
      initializeMobileTerminalCursor({
        inputEnabled: false,
        mobileTouchMode: false,
        terminal,
      }),
      false,
    );
    assert.deepEqual(calls, []);

    assert.equal(
      initializeMobileTerminalCursor({
        inputEnabled: true,
        mobileTouchMode: true,
        terminal,
      }),
      false,
    );
    assert.deepEqual(calls, []);
  });
});
