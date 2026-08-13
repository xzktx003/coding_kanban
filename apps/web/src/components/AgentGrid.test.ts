import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  AgentGrid,
  getAgentKanbanColumnId,
  getAgentKanbanColumnScrollTop,
} from "./AgentGrid.js";

function makeSession(
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: overrides.id ?? "session-default",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Default Session",
    workingDirectory: "/data01/home/xuzk/workspace/coding_kanban",
    connectionState: "online",
    interactionState: "idle",
    outputPreview: "ready",
    ...overrides,
  };
}

describe("AgentGrid", () => {
  it("prioritizes explicit response and execution states over stale completion review metadata", () => {
    assert.equal(
      getAgentKanbanColumnId(
        makeSession({
          interactionState: "awaiting_input",
          hasUnreadCompletion: true,
        }),
      ),
      "response",
    );
    assert.equal(
      getAgentKanbanColumnId(
        makeSession({
          interactionState: "running",
          hasUnreadCompletion: true,
        }),
      ),
      "executing",
    );
  });

  it("sorts sessions into four status columns and shows every count", () => {
    const sessions = [
      makeSession({
        id: "response-session",
        displayName: "Needs Response",
        interactionState: "awaiting_input",
      }),
      makeSession({
        id: "unread-completion-session",
        displayName: "Unread Completion",
        interactionState: "idle",
        hasUnreadCompletion: true,
      }),
      makeSession({
        id: "working-session",
        displayName: "Working",
        interactionState: "running",
      }),
      makeSession({
        id: "completed-idle-session",
        displayName: "Completed Idle",
        interactionState: "idle",
      }),
      makeSession({
        id: "completed-exited-session",
        displayName: "Completed Exited",
        interactionState: "exited",
      }),
      makeSession({
        id: "available-session",
        displayName: "Available",
        interactionState: "detached",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(
      markup,
      /data-kanban-column="response"[\s\S]*?需响应[\s\S]*?data-kanban-count="1"[\s\S]*?terminal-preview-response-session/,
    );
    assert.match(
      markup,
      /data-kanban-column="executing"[\s\S]*?执行中[\s\S]*?data-kanban-count="1"[\s\S]*?terminal-preview-working-session/,
    );
    assert.match(
      markup,
      /data-kanban-column="review"[\s\S]*?待验收[\s\S]*?data-kanban-count="1"[\s\S]*?terminal-preview-unread-completion-session/,
    );
    assert.match(
      markup,
      /data-kanban-column="ready"[\s\S]*?可继续[\s\S]*?data-kanban-count="3"[\s\S]*?terminal-preview-completed-idle-session[\s\S]*?terminal-preview-completed-exited-session[\s\S]*?terminal-preview-available-session/,
    );
    assert.equal((markup.match(/data-kanban-column=/g) ?? []).length, 4);
  });

  it("sorts sessions inside each column using the selected board order", () => {
    const sessions = [
      makeSession({
        id: "zeta-session",
        displayName: "Zeta",
        interactionState: "running",
        projectName: "alpha-project",
      }),
      makeSession({
        id: "alpha-session",
        displayName: "Alpha",
        interactionState: "running",
        projectName: "beta-project",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        sortMode: "name",
        onSortModeChange: () => {},
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(markup, /aria-label="看板排序"/);
    assert.match(
      markup,
      /data-kanban-column="executing"[\s\S]*?terminal-preview-alpha-session[\s\S]*?terminal-preview-zeta-session/,
    );
  });

  it("keeps user groups inside their matching status columns", () => {
    const sessions = [
      makeSession({
        id: "grouped-working-session",
        displayName: "Grouped Working",
        interactionState: "running",
      }),
      makeSession({
        id: "ungrouped-completed-session",
        displayName: "Ungrouped Completed",
        interactionState: "idle",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        sessionGroups: {
          groups: [{ id: "group-backend", name: "后端" }],
          assignments: { "session:grouped-working-session": "group-backend" },
          collapsedGroupIds: [],
        },
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(
      markup,
      /data-kanban-column="executing"[\s\S]*?data-session-group-id="group-backend"[\s\S]*?terminal-preview-grouped-working-session/,
    );
    assert.match(
      markup,
      /data-kanban-column="ready"[\s\S]*?data-session-group-id="__ungrouped__"[\s\S]*?terminal-preview-ungrouped-completed-session/,
    );
  });

  it("collapses the same group independently in each status column", () => {
    const sessions = [
      makeSession({
        id: "response-session",
        interactionState: "awaiting_input",
      }),
      makeSession({
        id: "executing-session",
        interactionState: "running",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        sessionGroups: {
          groups: [{ id: "group-backend", name: "后端" }],
          assignments: {
            "session:response-session": "group-backend",
            "session:executing-session": "group-backend",
          },
          collapsedGroupIds: ["kanban:executing:group-backend"],
        },
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(
      markup,
      /data-kanban-column="response"[\s\S]*?data-session-group-id="group-backend"[\s\S]*?aria-expanded="true"[\s\S]*?terminal-preview-response-session/,
    );
    assert.match(
      markup,
      /data-kanban-column="executing"[\s\S]*?data-session-group-id="group-backend"[\s\S]*?aria-expanded="false"/,
    );
    assert.doesNotMatch(
      markup,
      /data-kanban-column="executing"[\s\S]*?terminal-preview-executing-session/,
    );
  });

  it("collapses an individual group while keeping its header visible", () => {
    const sessions = [
      makeSession({ id: "session-1", displayName: "Alpha" }),
      makeSession({ id: "session-2", displayName: "Beta" }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        sessionGroups: {
          groups: [{ id: "group-backend", name: "后端" }],
          assignments: { "session:session-1": "group-backend" },
          collapsedGroupIds: ["kanban:ready:group-backend"],
        },
        onToggleSessionGroup: () => {},
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(
      markup,
      /data-collapsed="true"[^>]*data-session-group-id="group-backend"/,
    );
    assert.match(markup, /aria-expanded="false"/);
    assert.doesNotMatch(markup, /data-testid="terminal-preview-session-1"/);
    assert.match(markup, /data-testid="terminal-preview-session-2"/);
  });

  it("renders configured session groups and card assignment controls", () => {
    const sessions = [
      makeSession({ id: "session-1", displayName: "Alpha" }),
      makeSession({ id: "session-2", displayName: "Beta" }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        sessionGroups: {
          groups: [{ id: "group-backend", name: "后端" }],
          assignments: { "session:session-1": "group-backend" },
          collapsedGroupIds: [],
        },
        onCreateSessionGroup: () => {},
        onDeleteSessionGroup: () => {},
        onMoveSessionToGroup: () => {},
        onRenameSessionGroup: () => {},
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
      }),
    );

    assert.match(markup, /data-session-group-id="group-backend"/);
    assert.match(markup, />后端</);
    assert.match(markup, /data-session-group-id="__ungrouped__"/);
    assert.equal((markup.match(/aria-label="移动到分组"/g) ?? []).length, 2);
  });

  it("keeps toolbar actions without duplicating status counts", () => {
    const sessions = [
      makeSession({
        id: "running-session",
        displayName: "Running Session",
        interactionState: "running",
      }),
      makeSession({
        id: "idle-session",
        displayName: "Idle Session",
        interactionState: "idle",
      }),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions,
        allSessions: sessions,
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        hiddenCount: 2,
        onDeleteSession: () => {},
        onFiltersChange: () => {},
        onFocusSession: () => {},
        onReconnectSession: () => {},
        onShowHidden: () => {},
      }),
    );

    assert.match(markup, /class="agent-grid-toolbar-actions"/);
    assert.match(markup, /class="hidden-sessions-btn"[^>]*>已隐藏 \(2\)/);
    assert.doesNotMatch(markup, /grid-stat-running/);
    assert.equal((markup.match(/data-kanban-count=/g) ?? []).length, 4);
  });

  it("computes virtualization scroll positions relative to each column", () => {
    assert.equal(getAgentKanbanColumnScrollTop(120, 300), 0);
    assert.equal(getAgentKanbanColumnScrollTop(420, 300), 120);
  });
});

describe("AgentGrid empty states", () => {
  const noop = () => {};

  it("shows onboarding guidance when no sessions exist", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions: [],
        allSessions: [],
        filters: {
          host: null,
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        hiddenCount: 0,
        onDeleteSession: noop,
        onFiltersChange: noop,
        onFocusSession: noop,
        onReconnectSession: noop,
        onShowHidden: noop,
        onNewSession: noop,
        onScanTmux: noop,
      }),
    );

    assert.match(markup, /暂无 Agent 会话/);
    assert.match(markup, /点击左侧面板启动或扫描 Agent/);
    assert.match(markup, /新建会话/);
    assert.match(markup, /扫描 tmux/);
    assert.doesNotMatch(markup, /没有匹配的会话/);
  });

  it("shows filtered empty state when sessions exist but none match", () => {
    const sessions = [makeSession({ id: "s1", displayName: "Session 1" })];

    const markup = renderToStaticMarkup(
      createElement(AgentGrid, {
        sessions: [],
        allSessions: sessions,
        filters: {
          host: "remote",
          kind: null,
          transport: null,
          dirQuery: "",
          tag: null,
        },
        hiddenCount: 0,
        onDeleteSession: noop,
        onFiltersChange: noop,
        onFocusSession: noop,
        onReconnectSession: noop,
        onShowHidden: noop,
      }),
    );

    assert.match(markup, /没有匹配的会话，试试调整筛选条件/);
    assert.doesNotMatch(markup, /暂无 Agent 会话/);
  });
});
