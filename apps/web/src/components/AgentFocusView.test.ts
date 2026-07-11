import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { AgentFocusView } from "./AgentFocusView.js";

function installLocalStorageStub(layoutMode = "dual") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return key === "terminal-monitor-layout-mode" ? layoutMode : null;
      },
      setItem: () => {},
    },
  });
}

function makeSession(id: string, displayName: string): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName,
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
  };
}

describe("AgentFocusView", () => {
  it("renders the same session groups in the other-session sidebar", () => {
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
    assert.equal((markup.match(/aria-label="移动到分组"/g) ?? []).length, 2);
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
    assert.equal(
      (markup.match(/data-terminal-pane-menu-scope="active-titlebar"/g) ?? [])
        .length,
      1,
    );
    assert.doesNotMatch(markup, /data-testid="terminal-pane-context-menu"/);
  });

  it("marks other-session cards as title-safe context menu targets", () => {
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
      1,
    );
  });

  it("enables an internal scroll region when the other-session sidebar is crowded", () => {
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
      6,
    );
  });

  it("keeps the sidebar in auto mode for a small number of other sessions", () => {
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
