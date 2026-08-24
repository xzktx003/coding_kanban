import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { resolveTerminalMouseGestureAction } from "./terminal-mouse-selection.js";

describe("terminal mouse selection", () => {
  it("keeps the browser context menu available for terminal copy and paste", () => {
    const source = readFileSync(
      new URL("../components/TerminalView.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /onContextMenuCapture=/);
    assert.doesNotMatch(source, /shouldSuppressTerminalContextMenu/);
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
