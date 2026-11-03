import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isPhoneTerminalViewport,
  phoneTerminalMinimumHeight,
  shouldEnableMobileTerminalTouchMode,
  shouldUsePhoneTerminal,
} from "./mobile-terminal-mode.js";

describe("mobile terminal mode", () => {
  it("enables touch terminal control for coarse pointer devices", () => {
    assert.equal(
      shouldEnableMobileTerminalTouchMode({
        maxTouchPoints: 0,
        pointerCoarse: true,
      }),
      true,
    );
  });

  it("enables touch terminal control for touchscreen devices", () => {
    assert.equal(
      shouldEnableMobileTerminalTouchMode({
        maxTouchPoints: 1,
        pointerCoarse: false,
      }),
      true,
    );
  });

  it("keeps desktop pointer devices on the normal terminal path", () => {
    assert.equal(
      shouldEnableMobileTerminalTouchMode({
        maxTouchPoints: 0,
        pointerCoarse: false,
      }),
      false,
    );
  });

  it("treats a phone portrait and a short landscape as one phone terminal", () => {
    assert.equal(isPhoneTerminalViewport(390, 844), true);
    assert.equal(isPhoneTerminalViewport(844, 390), true);
    assert.equal(isPhoneTerminalViewport(1440, 900), false);
    assert.equal(phoneTerminalMinimumHeight(390), 140);
    assert.equal(phoneTerminalMinimumHeight(844), 180);
  });

  it("opens the phone terminal from mobile routes and from the desktop terminal page", () => {
    assert.equal(
      shouldUsePhoneTerminal({
        location: { hash: "", pathname: "/mobile", search: "" },
        viewportWidth: 1440,
        viewportHeight: 900,
        workbenchMode: "session",
      }),
      true,
    );
    assert.equal(
      shouldUsePhoneTerminal({
        location: { hash: "", pathname: "/", search: "?mode=terminal" },
        viewportWidth: 390,
        viewportHeight: 844,
        workbenchMode: "terminal",
      }),
      true,
    );
    assert.equal(
      shouldUsePhoneTerminal({
        location: { hash: "", pathname: "/", search: "?mode=session" },
        viewportWidth: 390,
        viewportHeight: 844,
        workbenchMode: "session",
      }),
      false,
    );
    assert.equal(
      shouldUsePhoneTerminal({
        location: { hash: "", pathname: "/", search: "?mode=terminal" },
        viewportWidth: 1440,
        viewportHeight: 900,
        workbenchMode: "terminal",
      }),
      false,
    );
    assert.equal(
      shouldUsePhoneTerminal({
        coarsePointer: true,
        location: { hash: "", pathname: "/", search: "" },
        viewportWidth: 844,
        viewportHeight: 390,
        workbenchMode: "terminal",
      }),
      true,
    );
  });
});
