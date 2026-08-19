import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MobileSessionSwitcher,
  MobileWorkbenchPage,
  sortMobileSessionPickerSessions,
  sortMobileSessionsByAttention,
} from "./MobileWorkbenchPage.js";

function installDocumentStub() {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        classList: {
          add: () => {},
          remove: () => {},
        },
      },
      body: {
        classList: {
          add: () => {},
          remove: () => {},
        },
      },
    },
  });
}

describe("MobileWorkbenchPage", () => {
  it("uses one in-page session menu and keeps transcript actions on the same row", () => {
    const sessions = [
      {
        id: "active",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "codex",
        displayName: "Active Codex",
        connectionState: "online" as const,
        interactionState: "running" as const,
      },
      {
        id: "ready",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "shell",
        displayName: "Ready Shell",
        connectionState: "online" as const,
        interactionState: "idle" as const,
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(MobileSessionSwitcher, {
        activeSession: sessions[0],
        open: true,
        sessions,
        onOpenChanges: () => {},
        onOpenFiles: () => {},
        onOpenTranscript: () => {},
        onSelectSession: () => {},
        onToggle: () => {},
      }),
    );

    assert.doesNotMatch(markup, /<select/);
    assert.equal((markup.match(/role="listbox"/g) ?? []).length, 1);
    assert.equal((markup.match(/role="option"/g) ?? []).length, 2);
    assert.match(markup, /aria-expanded="true"/);
    assert.match(
      markup,
      /class="mobile-session-actions"[^>]*>.*完整记录.*变更.*文件.*<\/div>/,
    );

    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    assert.match(
      css,
      /\.mobile-session-actions\s*{[^}]*display:\s*flex;[^}]*white-space:\s*nowrap;/s,
    );
    assert.match(css, /\.mobile-transcript-btn\s*{[^}]*min-height:\s*44px;/s);
    assert.match(
      css,
      /\.mobile-session-picker-menu\s*{[^}]*position:\s*absolute;/s,
    );
  });

  it("opens directly on the current session instead of the board", () => {
    installDocumentStub();

    const markup = renderToStaticMarkup(
      createElement(MobileWorkbenchPage, {
        activeSessionId: "running-session",
        isLoading: false,
        sessions: [
          {
            id: "running-session",
            workspaceId: "default",
            sourceType: "local",
            agentKind: "codex",
            displayName: "执行中的任务",
            connectionState: "online",
            interactionState: "running",
            outputPreview: "正在实现功能",
          },
          {
            id: "response-session",
            workspaceId: "default",
            sourceType: "local",
            agentKind: "copilot",
            displayName: "需要确认的任务",
            connectionState: "online",
            interactionState: "awaiting_input",
            lastAgentMessageSummary: "请选择是否继续",
          },
        ],
        agentCompletionNotificationPermission: "default",
        onSwitchSession: () => {},
        onToggleAgentCompletionNotifications: () => {},
      }),
    );

    assert.match(markup, /手机端 Coding Kanban/);
    assert.match(markup, /电脑端 Coding Kanban/);
    assert.match(markup, /href="\/"/);
    assert.match(markup, /执行中的任务/);
    assert.match(markup, /mobile-terminal-surface/);
    assert.match(markup, /手机终端快捷键/);
    assert.match(markup, /aria-label="当前会话" class="active"/);
    assert.doesNotMatch(markup, /等待你的回答或确认/);
    assert.match(
      markup,
      /data-testid="mobile-agent-completion-notification-toggle"/,
    );
    assert.match(markup, /通知关/);
  });

  it("renders the four mobile primary navigation destinations", () => {
    installDocumentStub();

    const markup = renderToStaticMarkup(
      createElement(MobileWorkbenchPage, {
        activeSessionId: "mobile-session",
        isLoading: false,
        sessions: [
          {
            id: "mobile-session",
            workspaceId: "default",
            sourceType: "local",
            agentKind: "codex",
            displayName: "Mobile Codex",
            connectionState: "online",
            interactionState: "idle",
          },
        ],
        onSwitchSession: () => {},
      }),
    );

    assert.match(markup, /aria-label="手机端主导航"/);
    assert.match(markup, />看板<\/button>/);
    assert.match(markup, />活动<\/button>/);
    assert.match(markup, />当前会话<\/button>/);
    assert.match(markup, />项目\/文件<\/button>/);
  });

  it("sorts response and review sessions ahead of executing and ready sessions", () => {
    const sessions = [
      {
        id: "ready",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "shell",
        displayName: "Ready",
        connectionState: "online" as const,
        interactionState: "idle" as const,
      },
      {
        id: "running",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "codex",
        displayName: "Running",
        connectionState: "online" as const,
        interactionState: "running" as const,
      },
      {
        id: "review",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "codex",
        displayName: "Review",
        connectionState: "online" as const,
        interactionState: "idle" as const,
        hasUnreadCompletion: true,
      },
      {
        id: "response",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "copilot",
        displayName: "Response",
        connectionState: "online" as const,
        interactionState: "awaiting_input" as const,
      },
    ];

    assert.deepEqual(
      sortMobileSessionsByAttention(sessions).map((session) => session.id),
      ["response", "review", "running", "ready"],
    );
  });

  it("sorts the current-session picker by ready, executing, then session name", () => {
    const sessions = [
      {
        id: "running-zulu",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "codex",
        displayName: "Zulu running",
        connectionState: "online" as const,
        interactionState: "running" as const,
      },
      {
        id: "ready-zulu",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "shell",
        displayName: "Zulu ready",
        connectionState: "online" as const,
        interactionState: "idle" as const,
      },
      {
        id: "running-alpha",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "codex",
        displayName: "alpha running",
        connectionState: "online" as const,
        interactionState: "running" as const,
      },
      {
        id: "ready-alpha",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "shell",
        displayName: "alpha ready",
        connectionState: "online" as const,
        interactionState: "idle" as const,
      },
      {
        id: "response",
        workspaceId: "default",
        sourceType: "local" as const,
        agentKind: "copilot",
        displayName: "Needs response",
        connectionState: "online" as const,
        interactionState: "awaiting_input" as const,
      },
    ];

    assert.deepEqual(
      sortMobileSessionPickerSessions(sessions).map((session) => session.id),
      [
        "ready-alpha",
        "ready-zulu",
        "running-alpha",
        "running-zulu",
        "response",
      ],
    );
  });
});
