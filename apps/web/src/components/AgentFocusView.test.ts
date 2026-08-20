import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { AgentFocusView } from "./AgentFocusView.js";

function installLocalStorageStub(
  layoutMode = "dual",
  workspaceState?: Record<string, unknown>,
) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        if (key === "terminal-monitor-workspace-v1" && workspaceState) {
          return JSON.stringify(workspaceState);
        }
        return key === "terminal-monitor-layout-mode" ? layoutMode : null;
      },
      setItem: () => {},
    },
  });
}

function makeSession(
  id: string,
  displayName: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName,
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    ...overrides,
  };
}

function getSidebarCardTag(markup: string, sessionId: string): string {
  const match = markup.match(
    new RegExp(`<div[^>]*data-session-id="${sessionId}"[^>]*>`),
  );
  assert.ok(match, `missing sidebar card for ${sessionId}`);
  return match[0];
}

describe("AgentFocusView", () => {
  it("collapses an individual group in the other-session sidebar", () => {
    installLocalStorageStub("single");
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
      makeSession("session-3", "Gamma"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        sessionGroups: {
          groups: [{ id: "group-review", name: "评审" }],
          assignments: { "session:session-2": "group-review" },
          collapsedGroupIds: ["group-review"],
        },
        onToggleSessionGroup: () => {},
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.match(
      markup,
      /data-collapsed="true"[^>]*data-session-group-id="group-review"/,
    );
    assert.doesNotMatch(markup, /data-session-id="session-2"/);
    assert.match(markup, /data-session-id="session-3"/);
  });

  it("renders the same session groups in the all-session sidebar", () => {
    installLocalStorageStub("single");
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
      makeSession("session-3", "Gamma"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        sessionGroups: {
          groups: [{ id: "group-review", name: "评审" }],
          assignments: { "session:session-2": "group-review" },
          collapsedGroupIds: [],
        },
        onCreateSessionGroup: () => {},
        onDeleteSessionGroup: () => {},
        onMoveSessionToGroup: () => {},
        onRenameSessionGroup: () => {},
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.match(markup, /data-session-group-id="group-review"/);
    assert.match(markup, />评审</);
    assert.match(markup, /data-session-group-id="__ungrouped__"/);
    assert.equal((markup.match(/aria-label="移动到分组"/g) ?? []).length, 3);
  });

  it("renders a prominent current-input badge for the active monitor pane", () => {
    installLocalStorageStub();
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    const badgeMatches = markup.match(/focus-terminal-active-badge/g) ?? [];
    assert.equal(badgeMatches.length, 1);
    assert.match(markup, /aria-label="当前输入终端"/);
    assert.match(markup, />当前输入<\/span>/);
    assert.match(markup, />完整记录<\/button>/);
    assert.match(markup, />变更<\/button>/);
    assert.equal(
      (markup.match(/data-terminal-pane-menu-scope="active-titlebar"/g) ?? [])
        .length,
      1,
    );
    assert.doesNotMatch(markup, /data-testid="terminal-pane-context-menu"/);
  });

  it("keeps the desktop focus header compact on narrow workspaces", () => {
    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

    assert.match(
      css,
      /\.focus-main-header\s*{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*6px;[^}]*padding:\s*6px 10px;/s,
    );
    assert.match(
      css,
      /\.focus-main-name\s*{[^}]*flex:\s*1 1 160px;[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    assert.match(
      css,
      /\.focus-main-header button\s*{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s,
    );
  });

  it("binds the complete transcript action to the active monitor session", () => {
    installLocalStorageStub("quad", {
      mode: "quad",
      slots: [
        { id: "terminal-monitor-slot-1", sessionId: "session-1" },
        { id: "terminal-monitor-slot-2", sessionId: "session-2" },
        { id: "terminal-monitor-slot-3", sessionId: "session-3" },
        { id: "terminal-monitor-slot-4", sessionId: "session-4" },
      ],
      activeSlotId: "terminal-monitor-slot-2",
      closedSlotIds: [],
    });
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
      makeSession("session-3", "Gamma"),
      makeSession("session-4", "Delta"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.match(markup, /aria-label="查看 Beta 的完整记录"/);
    assert.match(markup, /data-transcript-session-id="session-2"/);
  });

  it("links every monitored pane to the matching card in the existing sidebar groups", () => {
    installLocalStorageStub("dual");
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
      makeSession("session-3", "Gamma"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    const firstCard = getSidebarCardTag(markup, "session-1");
    const secondCard = getSidebarCardTag(markup, "session-2");
    const unmonitoredCard = getSidebarCardTag(markup, "session-3");

    assert.match(markup, />全部会话</);
    assert.match(firstCard, /data-monitor-index="1"/);
    assert.match(firstCard, /data-active-monitor-session="true"/);
    assert.match(firstCard, /aria-current="true"/);
    assert.match(firstCard, /focus-sidebar-card--monitor-active/);
    assert.match(secondCard, /data-monitor-index="2"/);
    assert.doesNotMatch(secondCard, /data-active-monitor-session/);
    assert.doesNotMatch(unmonitoredCard, /data-monitor-index/);
    assert.equal(
      (markup.match(/aria-label="对应第 [12] 个监控窗格"/g) ?? []).length,
      2,
    );
  });

  it("marks tmux transport separately without changing the sidebar title or monitor index", () => {
    installLocalStorageStub("dual");
    const sessions = [
      makeSession("session-1", "dev", {
        transportRef: {
          runtimeId: "tmux:dev",
          tmuxSession: "dev",
        },
      }),
      makeSession("session-2", "Direct shell"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    const tmuxCard = getSidebarCardTag(markup, "session-1");

    assert.match(markup, /focus-sidebar-card-name">dev<\/span>/);
    assert.doesNotMatch(markup, /focus-sidebar-card-name">tmux:dev/);
    assert.match(markup, /aria-label="tmux 会话"/);
    assert.equal(
      (markup.match(/class="focus-sidebar-transport-tag"/g) ?? []).length,
      1,
    );
    assert.match(tmuxCard, /data-monitor-index="1"/);
  });

  it("marks every sidebar card as a title-safe context menu target", () => {
    installLocalStorageStub("single");
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.equal(
      (markup.match(/data-terminal-sidebar-menu-scope="other-session"/g) ?? [])
        .length,
      2,
    );
  });

  it("enables an internal scroll region when the all-session sidebar is crowded", () => {
    installLocalStorageStub("single");
    const sessions = Array.from({ length: 7 }, (_, index) =>
      makeSession(`session-${index + 1}`, `Session ${index + 1}`),
    );

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.match(markup, /focus-sidebar--scrollable/);
    assert.match(markup, /data-sidebar-scroll-mode="enabled"/);
    assert.match(markup, /data-testid="focus-sidebar-scroll"/);
    assert.equal(
      (markup.match(/data-terminal-sidebar-menu-scope="other-session"/g) ?? [])
        .length,
      7,
    );
  });

  it("keeps the sidebar in auto mode for a small number of sessions", () => {
    installLocalStorageStub("single");
    const sessions = [
      makeSession("session-1", "Alpha"),
      makeSession("session-2", "Beta"),
      makeSession("session-3", "Gamma"),
    ];

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.doesNotMatch(markup, /focus-sidebar--scrollable/);
    assert.match(markup, /data-sidebar-scroll-mode="auto"/);
  });

  it("enables sidebar scrolling when group headers exceed the compact space", () => {
    installLocalStorageStub("single");
    const sessions = Array.from({ length: 5 }, (_, index) =>
      makeSession(`session-${index + 1}`, `Session ${index + 1}`),
    );

    const markup = renderToStaticMarkup(
      createElement(AgentFocusView, {
        focusedSession: sessions[0],
        sessions,
        sessionGroups: {
          groups: Array.from({ length: 4 }, (_, index) => ({
            id: `group-${index + 1}`,
            name: `Group ${index + 1}`,
          })),
          assignments: Object.fromEntries(
            Array.from({ length: 4 }, (_, index) => [
              `session:session-${index + 2}`,
              `group-${index + 1}`,
            ]),
          ),
          collapsedGroupIds: [],
        },
        onExit: () => {},
        onDeleteSession: () => {},
        onHideSession: () => {},
        onReconnect: () => {},
        onSwitchFocus: () => {},
      }),
    );

    assert.match(markup, /focus-sidebar--scrollable/);
    assert.match(markup, /data-sidebar-scroll-mode="enabled"/);
  });
});
