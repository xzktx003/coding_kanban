import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MobileWorkbenchPage,
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
  it("opens on a lightweight attention-sorted workspace instead of a terminal", () => {
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
    assert.match(markup, /手机工作区/);
    assert.match(markup, /需要确认的任务/);
    assert.match(markup, /执行中的任务/);
    assert.ok(
      markup.indexOf("需要确认的任务") < markup.indexOf("执行中的任务"),
    );
    assert.doesNotMatch(markup, /mobile-terminal-surface/);
    assert.doesNotMatch(markup, /手机终端快捷键/);
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
});
