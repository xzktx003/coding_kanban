import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentGridCard,
  getAgentCardGitSummaryRefreshKey,
  getAgentCardTaskSummaryRefreshKey,
  shouldFocusGridCardFromDoubleClick,
  shouldFocusGridCardFromMouseDown,
} from "./AgentGridCard.js";

test("continuous terminal output does not invalidate card summaries", () => {
  const session = {
    id: "session-refresh-key",
    workspaceId: "default",
    sourceType: "local" as const,
    agentKind: "codex",
    displayName: "Refresh Key",
    connectionState: "online" as const,
    interactionState: "running" as const,
    lastOutputAt: "2026-08-14T15:00:00.000Z",
  };

  assert.equal(
    getAgentCardTaskSummaryRefreshKey(session),
    getAgentCardTaskSummaryRefreshKey({
      ...session,
      lastOutputAt: "2026-08-14T15:00:14.999Z",
    }),
  );
  assert.equal(
    getAgentCardTaskSummaryRefreshKey(session),
    getAgentCardTaskSummaryRefreshKey({
      ...session,
      interactionState: "idle",
    }),
  );
  assert.notEqual(
    getAgentCardTaskSummaryRefreshKey(session),
    getAgentCardTaskSummaryRefreshKey({
      ...session,
      lastOutputAt: "2026-08-14T15:00:15.000Z",
    }),
  );
  assert.equal(
    getAgentCardGitSummaryRefreshKey(session),
    getAgentCardGitSummaryRefreshKey({
      ...session,
      lastOutputAt: "2026-08-14T15:00:59.999Z",
    }),
  );
  assert.notEqual(
    getAgentCardGitSummaryRefreshKey(session),
    getAgentCardGitSummaryRefreshKey({
      ...session,
      lastOutputAt: "2026-08-14T15:01:00.000Z",
    }),
  );
});

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

test("grid cards show compact project and Git summaries", () => {
  const markup = renderToStaticMarkup(
    createElement(AgentGridCard, {
      session: {
        id: "session-git",
        workspaceId: "default",
        sourceType: "local",
        agentKind: "codex",
        displayName: "Git Session",
        connectionState: "online",
        interactionState: "idle",
        projectName: "coding_kanban",
        gitBranch: "feature/summary",
        gitIsWorktree: true,
        gitChangedFiles: 5,
        gitAddedLines: 82,
        gitDeletedLines: 17,
      },
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
    }),
  );

  assert.match(markup, /grid-card-git-summary/);
  assert.match(markup, /coding_kanban/);
  assert.match(markup, /feature\/summary · worktree/);
  assert.match(markup, /5 文件/);
  assert.match(markup, /\+82/);
  assert.match(markup, /-17/);
});

test("completed grid cards expose mark unread and mark read actions", () => {
  const readyMarkup = renderToStaticMarkup(
    createElement(AgentGridCard, {
      session: {
        id: "session-ready",
        workspaceId: "default",
        sourceType: "local",
        agentKind: "codex",
        displayName: "Ready Session",
        connectionState: "online",
        interactionState: "idle",
        hasUnreadCompletion: false,
      },
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
      onUnreadCompletionChange: () => {},
    }),
  );
  assert.match(readyMarkup, /title="标记未读"/);

  const reviewMarkup = renderToStaticMarkup(
    createElement(AgentGridCard, {
      session: {
        id: "session-review",
        workspaceId: "default",
        sourceType: "local",
        agentKind: "codex",
        displayName: "Review Session",
        connectionState: "online",
        interactionState: "idle",
        hasUnreadCompletion: true,
      },
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
      onUnreadCompletionChange: () => {},
    }),
  );
  assert.match(reviewMarkup, /title="标记已读"/);
});

test("grid cards keep the fixed height when task summaries are visible", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  assert.match(css, /\.grid-card\s*\{[\s\S]*?height:\s*240px;/);
  assert.match(
    css,
    /\.grid-card-task-summary\s*\{[\s\S]*?max-height:\s*48px;/,
  );
  assert.match(css, /\.grid-card-terminal\s*\{[\s\S]*?min-height:\s*0;/);
  assert.match(
    css,
    /\.grid-card-git-summary\s*\{[\s\S]*?max-height:\s*24px;/,
  );
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
