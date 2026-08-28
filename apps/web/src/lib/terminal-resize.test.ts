import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTerminalViewportMeasurable } from "./terminal-resize.js";

describe("terminal resize", () => {
  it("does not fit a retained terminal while its pane is hidden", () => {
    assert.equal(isTerminalViewportMeasurable(0, 480), false);
    assert.equal(isTerminalViewportMeasurable(720, 0), false);
    assert.equal(isTerminalViewportMeasurable(0, 0), false);
  });

  it("fits a terminal once both viewport dimensions are positive", () => {
    assert.equal(isTerminalViewportMeasurable(720, 480), true);
  });
});
