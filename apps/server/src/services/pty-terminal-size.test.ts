import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseTerminalConnection,
  rememberTerminalConnectionSize,
} from "./pty-terminal-size.js";

test("closing the phone terminal restores the still-open desktop width", () => {
  const sizes = new Map();
  rememberTerminalConnectionSize(sizes, "session-1", "desktop", 168, 44);
  rememberTerminalConnectionSize(sizes, "session-1", "phone", 47, 18);

  assert.deepEqual(releaseTerminalConnection(sizes, "session-1", "phone"), {
    cols: 168,
    rows: 44,
  });
});

test("closing the last terminal client leaves the pty size alone", () => {
  const sizes = new Map();
  rememberTerminalConnectionSize(sizes, "session-1", "phone", 47, 18);

  assert.equal(releaseTerminalConnection(sizes, "session-1", "phone"), null);
});
