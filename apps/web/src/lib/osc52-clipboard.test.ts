import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_OSC52_CLIPBOARD_BASE64_LENGTH,
  decodeOsc52ClipboardPayload,
} from "./osc52-clipboard.js";

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("decodeOsc52ClipboardPayload", () => {
  it("decodes OSC 52 clipboard payloads as UTF-8 text", () => {
    const text = "pane 内复制\nsecond line";

    assert.equal(decodeOsc52ClipboardPayload(`c;${encodeBase64(text)}`), text);
    assert.equal(decodeOsc52ClipboardPayload(`;${encodeBase64(text)}`), text);
  });

  it("ignores unsupported targets, queries, malformed base64, and oversized payloads", () => {
    assert.equal(
      decodeOsc52ClipboardPayload(`p;${encodeBase64("primary")}`),
      null,
    );
    assert.equal(decodeOsc52ClipboardPayload("c;?"), null);
    assert.equal(decodeOsc52ClipboardPayload("c;not base64%%"), null);
    assert.equal(
      decodeOsc52ClipboardPayload(
        `c;${"A".repeat(MAX_OSC52_CLIPBOARD_BASE64_LENGTH + 1)}`,
      ),
      null,
    );
  });
});
