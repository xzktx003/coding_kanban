import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSgrMouseReport,
  classifyMobileTerminalPointer,
} from "./mobile-terminal-pointer.js";

describe("mobile terminal pointer", () => {
  it("turns a tap into a tmux click and a drag into a wheel", () => {
    assert.deepEqual(
      classifyMobileTerminalPointer({
        moved: 2,
        startX: 10,
        startY: 20,
        x: 11,
        y: 21,
        tmuxMouse: true,
      }),
      { type: "click", clientX: 10, clientY: 20 },
    );
    const drag = classifyMobileTerminalPointer({
      moved: 40,
      startX: 10,
      startY: 80,
      x: 12,
      y: 40,
      tmuxMouse: true,
    });
    assert.equal(drag.type, "drag");
    if (drag.type === "drag") {
      assert.equal(drag.deltaY, -40);
    }
  });

  it("keeps local scrolling when the session is not tmux", () => {
    assert.equal(
      classifyMobileTerminalPointer({
        moved: 30,
        startX: 0,
        startY: 0,
        x: 0,
        y: 30,
        tmuxMouse: false,
      }).type,
      "scroll",
    );
  });

  it("encodes SGR mouse press and release", () => {
    const press = buildSgrMouseReport({
      button: 0,
      release: false,
      clientX: 8,
      clientY: 8,
      screenLeft: 0,
      screenTop: 0,
      screenWidth: 80,
      screenHeight: 24,
      cols: 80,
      rows: 24,
    });
    const release = buildSgrMouseReport({
      button: 0,
      release: true,
      clientX: 8,
      clientY: 8,
      screenLeft: 0,
      screenTop: 0,
      screenWidth: 80,
      screenHeight: 24,
      cols: 80,
      rows: 24,
    });
    assert.equal(press, "\u001b[<0;9;9M");
    assert.equal(release, "\u001b[<0;9;9m");
  });
});
