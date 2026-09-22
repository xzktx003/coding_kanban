import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitTerminalReplayWrite } from "./terminal-replay-chunks.js";

describe("terminal replay chunks", () => {
  it("keeps small replay frames in one xterm write", () => {
    assert.deepEqual(splitTerminalReplayWrite("ready", 8), ["ready"]);
  });

  it("splits large replay frames without changing their bytes", () => {
    const replay = "0123456789abcdef";
    const chunks = splitTerminalReplayWrite(replay, 5);

    assert.deepEqual(chunks, ["01234", "56789", "abcde", "f"]);
    assert.equal(chunks.join(""), replay);
  });

  it("does not split a UTF-16 surrogate pair", () => {
    const replay = `1234😀5678`;
    const chunks = splitTerminalReplayWrite(replay, 5);

    assert.equal(chunks.join(""), replay);
    assert.ok(
      chunks.every(
        (chunk) =>
          !/[\uD800-\uDBFF]$/u.test(chunk) && !/^[\uDC00-\uDFFF]/u.test(chunk),
      ),
    );
  });
});
