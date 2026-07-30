import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_TERMINAL_PREVIEW_TEXT,
  SUSPENDED_TERMINAL_PREVIEW_TEXT,
  buildTerminalPreviewLines,
  sanitizeTerminalPreviewText,
} from "./terminal-preview.js";

describe("terminal preview", () => {
  it("strips ANSI and control sequences before rendering lightweight text", () => {
    assert.equal(
      sanitizeTerminalPreviewText(
        "\u001b[31mred\u001b[0m\r\n\u001b]11;rgb:ff/00/ab\u0007ok\u0007",
      ),
      "red\nok",
    );
  });

  it("strips terminal character-set selection sequences", () => {
    assert.equal(
      sanitizeTerminalPreviewText(
        "\u001b(B\u001b[31mready\u001b[0m\u001b(0\u001b(B",
      ),
      "ready",
    );
  });

  it("keeps only the most recent non-empty lines", () => {
    assert.deepEqual(
      buildTerminalPreviewLines("one\n\ntwo\nthree\nfour", { maxLines: 2 }),
      ["three", "four"],
    );
  });

  it("caps long preview lines to keep card DOM and layout bounded", () => {
    assert.deepEqual(
      buildTerminalPreviewLines("abcdefghijklmnopqrstuvwxyz", {
        maxLineLength: 8,
      }),
      ["abcdefg…"],
    );
  });

  it("uses stable placeholder text when output is empty or suspended", () => {
    assert.deepEqual(buildTerminalPreviewLines(" \n\t "), [
      EMPTY_TERMINAL_PREVIEW_TEXT,
    ]);
    assert.deepEqual(buildTerminalPreviewLines("live", { suspended: true }), [
      SUSPENDED_TERMINAL_PREVIEW_TEXT,
    ]);
  });
});
