import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveTerminalMouseGestureAction,
  shouldSuppressTerminalContextMenu,
} from "./terminal-mouse-selection.js";

describe("terminal mouse selection", () => {
  it("suppresses the browser context menu only for the active interactive terminal", () => {
    assert.equal(
      shouldSuppressTerminalContextMenu({
        interactive: true,
        inputEnabled: true,
        targetIsTerminal: true,
      }),
      true,
    );
    assert.equal(
      shouldSuppressTerminalContextMenu({
        interactive: true,
        inputEnabled: false,
        targetIsTerminal: true,
      }),
      false,
    );
    assert.equal(
      shouldSuppressTerminalContextMenu({
        interactive: false,
        inputEnabled: true,
        targetIsTerminal: true,
      }),
      false,
    );
    assert.equal(
      shouldSuppressTerminalContextMenu({
        interactive: true,
        inputEnabled: true,
        targetIsTerminal: false,
      }),
      false,
    );
  });

  it("turns a direct primary-button drag into local terminal selection", () => {
    assert.equal(
      resolveTerminalMouseGestureAction({
        phase: "move",
        startX: 100,
        startY: 100,
        currentX: 108,
        currentY: 103,
        selectionStarted: false,
      }),
      "start-selection",
    );
    assert.equal(
      resolveTerminalMouseGestureAction({
        phase: "up",
        startX: 100,
        startY: 100,
        currentX: 108,
        currentY: 103,
        selectionStarted: true,
      }),
      "finish-selection",
    );
  });

  it("replays a primary-button click when the pointer never becomes a drag", () => {
    assert.equal(
      resolveTerminalMouseGestureAction({
        phase: "move",
        startX: 100,
        startY: 100,
        currentX: 102,
        currentY: 101,
        selectionStarted: false,
      }),
      "hold",
    );
    assert.equal(
      resolveTerminalMouseGestureAction({
        phase: "up",
        startX: 100,
        startY: 100,
        currentX: 102,
        currentY: 101,
        selectionStarted: false,
      }),
      "replay-click",
    );
  });

  it("continues an established local selection regardless of later distance", () => {
    assert.equal(
      resolveTerminalMouseGestureAction({
        phase: "move",
        startX: 100,
        startY: 100,
        currentX: 101,
        currentY: 100,
        selectionStarted: true,
      }),
      "continue-selection",
    );
  });
});
