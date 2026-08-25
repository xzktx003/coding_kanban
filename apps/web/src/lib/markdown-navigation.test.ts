import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSyncedScrollTop,
  createMarkdownHeadingId,
  extractMarkdownHeadings,
} from "./markdown-navigation.js";

test("extracts ATX and setext headings while ignoring fenced code", () => {
  const headings = extractMarkdownHeadings(
    [
      "# Overview",
      "",
      "## Install `now` ##",
      "",
      "```md",
      "# Not a heading",
      "```",
      "",
      "Results *and* notes",
      "-------------------",
    ].join("\n"),
  );

  assert.deepEqual(
    headings.map(({ level, text, line, id }) => ({ level, text, line, id })),
    [
      { level: 1, text: "Overview", line: 1, id: "markdown-heading-1" },
      { level: 2, text: "Install now", line: 3, id: "markdown-heading-3" },
      {
        level: 2,
        text: "Results and notes",
        line: 9,
        id: "markdown-heading-9",
      },
    ],
  );
});

test("uses source line numbers for stable unique heading ids", () => {
  assert.equal(createMarkdownHeadingId(7), "markdown-heading-7");
  assert.equal(createMarkdownHeadingId(undefined), undefined);
});

test("does not close a fenced block when the marker has trailing content", () => {
  const headings = extractMarkdownHeadings(
    [
      "```md",
      "# Hidden",
      "```still fenced",
      "## Hidden too",
      "```",
      "# Visible",
    ].join("\n"),
  );

  assert.deepEqual(
    headings.map((heading) => heading.text),
    ["Visible"],
  );
});

test("bounds pathological outlines before they create excessive DOM", () => {
  const headings = extractMarkdownHeadings("# One\n# Two\n# Three", 2);
  assert.deepEqual(
    headings.map((heading) => heading.text),
    ["One", "Two"],
  );
});

test("maps either pane to the same relative scroll position", () => {
  assert.equal(
    calculateSyncedScrollTop({
      sourceScrollTop: 300,
      sourceScrollHeight: 1_200,
      sourceClientHeight: 200,
      targetScrollHeight: 2_200,
      targetClientHeight: 200,
    }),
    600,
  );
  assert.equal(
    calculateSyncedScrollTop({
      sourceScrollTop: 500,
      sourceScrollHeight: 500,
      sourceClientHeight: 500,
      targetScrollHeight: 2_200,
      targetClientHeight: 200,
    }),
    0,
  );
});
