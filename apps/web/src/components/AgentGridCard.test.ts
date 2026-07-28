import assert from "node:assert/strict";
import test from "node:test";

import { shouldFocusGridCardFromDoubleClick } from "./AgentGridCard.js";

function targetMatching(...matchedSelectors: string[]): EventTarget {
  return {
    closest(selector: string) {
      return matchedSelectors.includes(selector) ? {} : null;
    },
  } as unknown as EventTarget;
}

test("grid cards accept double clicks from nested terminal content", () => {
  assert.equal(shouldFocusGridCardFromDoubleClick(null), true);
  assert.equal(
    shouldFocusGridCardFromDoubleClick(targetMatching(".terminal-preview")),
    true,
  );
  assert.equal(
    shouldFocusGridCardFromDoubleClick(
      targetMatching(".xterm-helper-textarea", "textarea"),
    ),
    true,
  );
});

test("grid cards ignore double clicks from real controls", () => {
  for (const selector of [
    "button",
    "input",
    "select",
    "textarea",
    "a",
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="menuitem"]',
  ]) {
    assert.equal(
      shouldFocusGridCardFromDoubleClick(targetMatching(selector)),
      false,
      selector,
    );
  }
});
