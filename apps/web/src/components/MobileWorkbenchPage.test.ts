import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MobileWorkbenchPage } from "./MobileWorkbenchPage.js";

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
  it("puts desktop/mobile switching in the Coding Kanban title area", () => {
    installDocumentStub();

    const markup = renderToStaticMarkup(
      createElement(MobileWorkbenchPage, {
        activeSessionId: null,
        isLoading: false,
        sessions: [],
        agentCompletionNotificationPermission: "default",
        onSwitchSession: () => {},
        onToggleAgentCompletionNotifications: () => {},
      }),
    );

    assert.match(markup, /手机端 Coding Kanban/);
    assert.match(markup, /电脑端 Coding Kanban/);
    assert.match(markup, /href="\/"/);
    assert.match(
      markup,
      /data-testid="mobile-agent-completion-notification-toggle"/,
    );
    assert.match(markup, /通知关/);
  });

  it("shows a compact transcript entry for the active mobile session", () => {
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

    assert.match(
      markup,
      /class="mobile-transcript-btn"[^>]*>完整记录<\/button>/,
    );
  });
});
