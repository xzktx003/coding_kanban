import assert from "node:assert/strict";
import test from "node:test";

import type {
  FilePreviewInput,
  FilePreviewResponse,
} from "@agent-orchestrator/shared";

import {
  DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES,
  DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES,
  loadMarkdownPreviewWindow,
} from "./markdown-preview-window.js";

function response(
  content: string,
  offset: number,
  nextOffset: number | null,
  size = 12,
): FilePreviewResponse {
  return {
    path: "/tmp/readme.md",
    content,
    encoding: "utf8",
    truncated: nextOffset !== null,
    size,
    mimeType: "text/markdown",
    offset,
    bytesRead: content.length,
    previousOffset: offset > 0 ? Math.max(0, offset - 4) : null,
    nextOffset,
  };
}

test("combines bounded server pages into one desktop Markdown window", async () => {
  const calls: FilePreviewInput[] = [];
  const pages = [response("first ", 0, 6), response("second", 6, null)];

  const result = await loadMarkdownPreviewWindow(
    { path: "/tmp/readme.md", offset: 0 },
    async (input) => {
      calls.push(input);
      return pages.shift()!;
    },
  );

  assert.equal(result.content, "first second");
  assert.equal(result.offset, 0);
  assert.equal(result.nextOffset, null);
  assert.equal(result.complete, true);
  assert.equal(calls[0]?.maxBytes, DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES);
  assert.equal(calls[1]?.offset, 6);
});

test("retains only one bounded window and exposes navigation for huge files", async () => {
  let offset = 0;
  const result = await loadMarkdownPreviewWindow(
    { path: "/tmp/readme.md", offset: 0 },
    async () => {
      const nextOffset = offset + DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES;
      const currentOffset = offset;
      offset = nextOffset;
      return {
        ...response(
          "x".repeat(DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES),
          currentOffset,
          nextOffset,
          DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES * 2,
        ),
        bytesRead: DESKTOP_MARKDOWN_PREVIEW_PAGE_BYTES,
      };
    },
  );

  assert.equal(result.bytesRead, DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES);
  assert.equal(result.content.length, DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES);
  assert.equal(result.nextOffset, DESKTOP_MARKDOWN_PREVIEW_WINDOW_BYTES);
  assert.equal(result.complete, false);
});

test("rejects non-advancing preview pages instead of looping forever", async () => {
  await assert.rejects(
    () =>
      loadMarkdownPreviewWindow(
        { path: "/tmp/readme.md", offset: 0 },
        async () => ({ ...response("", 0, 0), bytesRead: 0 }),
      ),
    /没有继续向后推进/,
  );
});
