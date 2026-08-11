import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TERMINAL_WHEEL_DELTA_LINE,
  TERMINAL_WHEEL_DELTA_PAGE,
  TERMINAL_WHEEL_DELTA_PIXEL,
  computeTerminalWheelScrollLines,
  isTerminalWheelBlockedByOverlayTarget,
  shouldCaptureTerminalWheel,
  shouldForwardTerminalWheelToApplication,
} from "./terminal-wheel.js";

function targetInsideOverlay(selector: string): EventTarget {
  return {
    closest(candidate: string) {
      return candidate === selector ? this : null;
    },
  } as unknown as EventTarget;
}

describe("computeTerminalWheelScrollLines", () => {
  it("turns wheel-down pixels into positive terminal scrollback lines", () => {
    assert.deepEqual(
      computeTerminalWheelScrollLines({
        deltaMode: TERMINAL_WHEEL_DELTA_PIXEL,
        deltaY: 48,
        lineHeight: 16,
        pageHeight: 160,
        previousDeltaY: 0,
      }),
      {
        remainingDeltaY: 0,
        scrollLines: 3,
      },
    );
  });

  it("turns wheel-up line deltas into negative terminal scrollback lines", () => {
    assert.deepEqual(
      computeTerminalWheelScrollLines({
        deltaMode: TERMINAL_WHEEL_DELTA_LINE,
        deltaY: -2,
        lineHeight: 14,
        pageHeight: 140,
        previousDeltaY: 0,
      }),
      {
        remainingDeltaY: 0,
        scrollLines: -2,
      },
    );
  });

  it("accumulates sub-line trackpad deltas without emitting stdin-like arrows", () => {
    const first = computeTerminalWheelScrollLines({
      deltaMode: TERMINAL_WHEEL_DELTA_PIXEL,
      deltaY: 5,
      lineHeight: 16,
      pageHeight: 160,
      previousDeltaY: 0,
    });
    const second = computeTerminalWheelScrollLines({
      deltaMode: TERMINAL_WHEEL_DELTA_PIXEL,
      deltaY: 12,
      lineHeight: 16,
      pageHeight: 160,
      previousDeltaY: first.remainingDeltaY,
    });

    assert.deepEqual(first, {
      remainingDeltaY: 5,
      scrollLines: 0,
    });
    assert.deepEqual(second, {
      remainingDeltaY: 1,
      scrollLines: 1,
    });
  });

  it("maps page-mode wheel events to a full terminal page", () => {
    assert.deepEqual(
      computeTerminalWheelScrollLines({
        deltaMode: TERMINAL_WHEEL_DELTA_PAGE,
        deltaY: 1,
        lineHeight: 10,
        pageHeight: 80,
        previousDeltaY: 0,
      }),
      {
        remainingDeltaY: 0,
        scrollLines: 8,
      },
    );
  });
});

describe("shouldForwardTerminalWheelToApplication", () => {
  it("forwards a plain wheel gesture when the active TUI tracks the mouse", () => {
    assert.equal(
      shouldForwardTerminalWheelToApplication({
        inputEnabled: true,
        interactive: true,
        mouseTrackingMode: "vt200",
        shiftKey: false,
      }),
      true,
    );
  });

  it("keeps Shift+wheel and non-interactive terminals on local scrollback", () => {
    assert.equal(
      shouldForwardTerminalWheelToApplication({
        inputEnabled: true,
        interactive: true,
        mouseTrackingMode: "any",
        shiftKey: true,
      }),
      false,
    );
    assert.equal(
      shouldForwardTerminalWheelToApplication({
        inputEnabled: false,
        interactive: false,
        mouseTrackingMode: "vt200",
        shiftKey: false,
      }),
      false,
    );
  });

  it("keeps wheel gestures local when the terminal application does not track the mouse", () => {
    assert.equal(
      shouldForwardTerminalWheelToApplication({
        inputEnabled: true,
        interactive: true,
        mouseTrackingMode: "none",
        shiftKey: false,
      }),
      false,
    );
    assert.equal(
      shouldForwardTerminalWheelToApplication({
        inputEnabled: true,
        interactive: true,
        mouseTrackingMode: "x10",
        shiftKey: false,
      }),
      false,
    );
  });
});

describe("shouldCaptureTerminalWheel", () => {
  it("lets focus-sidebar previews bubble wheel events to the sidebar scroller", () => {
    assert.equal(shouldCaptureTerminalWheel({ wheelPassthrough: true }), false);
    assert.equal(shouldCaptureTerminalWheel({ wheelPassthrough: false }), true);
  });
});

describe("isTerminalWheelBlockedByOverlayTarget", () => {
  it("prevents terminal cards from intercepting wheel gestures over overlays", () => {
    assert.equal(
      isTerminalWheelBlockedByOverlayTarget(
        targetInsideOverlay(".new-session-backdrop"),
      ),
      true,
    );
    assert.equal(
      isTerminalWheelBlockedByOverlayTarget(
        targetInsideOverlay(".discovery-overlay"),
      ),
      true,
    );
    assert.equal(
      isTerminalWheelBlockedByOverlayTarget(
        targetInsideOverlay(".terminal-session-switcher-menu"),
      ),
      true,
    );
    assert.equal(
      isTerminalWheelBlockedByOverlayTarget(
        targetInsideOverlay(".file-browser-modal"),
      ),
      true,
    );
    assert.equal(
      isTerminalWheelBlockedByOverlayTarget(targetInsideOverlay(".grid-card")),
      false,
    );
    assert.equal(isTerminalWheelBlockedByOverlayTarget(null), false);
  });
});
