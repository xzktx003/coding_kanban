import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { AgentGrid } from "./AgentGrid.js";

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
          collapsedGroupIds: ["group-backend"],
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

  it("shows running counts as compact grid toolbar chips", () => {
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
    assert.match(
      markup,
      /class="stat-item stat-running grid-status-chip"[^>]*>🟢 1 运行中/,
    );
    assert.doesNotMatch(markup, /stat-awaiting/);
    assert.doesNotMatch(markup, /等待输入/);
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
