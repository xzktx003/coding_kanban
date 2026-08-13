import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentGridCard,
  shouldFocusGridCardFromDoubleClick,
  shouldFocusGridCardFromMouseDown,
} from "./AgentGridCard.js";

test("grid cards show structured task summaries above terminal previews", () => {
  const markup = renderToStaticMarkup(
    createElement(AgentGridCard, {
      session: {
        id: "session-summary",
        workspaceId: "default",
        sourceType: "local",
        agentKind: "codex",
        displayName: "Summary Session",
        connectionState: "online",
        interactionState: "idle",
        lastUserMessageSummary: "修复手机端入口",
        lastAgentMessageSummary: "已完成入口并通过测试",
      },
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
    }),
  );

  assert.match(markup, /grid-card-task-summary/);
  assert.match(markup, /任务[\s\S]*修复手机端入口/);
  assert.match(markup, /回复[\s\S]*已完成入口并通过测试/);
  assert.match(markup, /terminal-preview-session-summary/);
});

test("grid cards keep the fixed height when task summaries are visible", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  assert.match(css, /\.grid-card\s*\{[\s\S]*?height:\s*240px;/);
  assert.match(
    css,
    /\.grid-card-task-summary\s*\{[\s\S]*?max-height:\s*48px;/,
  );
  assert.match(css, /\.grid-card-terminal\s*\{[\s\S]*?min-height:\s*0;/);
});

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
