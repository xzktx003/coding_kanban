import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldFocusGridCardFromDoubleClick,
  shouldFocusGridCardFromMouseDown,
} from "./AgentGridCard.js";

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

test("grid cards focus on the second primary-button press before descendants can disrupt dblclick", () => {
  const terminalTarget = targetMatching(".terminal-preview");

  assert.equal(shouldFocusGridCardFromMouseDown(1, 0, terminalTarget), false);
  assert.equal(shouldFocusGridCardFromMouseDown(2, 0, terminalTarget), true);
  assert.equal(shouldFocusGridCardFromMouseDown(2, 1, terminalTarget), false);
  assert.equal(
    shouldFocusGridCardFromMouseDown(2, 0, targetMatching("button")),
    false,
  );
});
