import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { TOP_BAR_SETTINGS_SECTIONS, TopBar } from "./TopBar.js";

function installDocumentStub() {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      fullscreenElement: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      documentElement: {
        requestFullscreen: () => Promise.resolve(),
      },
      exitFullscreen: () => Promise.resolve(),
    },
  });
}

function makeSession(
  id: string,
  interactionState:
    | AgentSessionRecord["interactionState"]
    | "awaiting_input" = "running",
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: id,
    connectionState: "online",
    interactionState,
  } as unknown as AgentSessionRecord;
}

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  installDocumentStub();

  return renderToStaticMarkup(
    createElement(TopBar, {
      sessions: [makeSession("alpha"), makeSession("beta")],
      collapsed: false,
      sshHosts: [],
      fileBrowserAvailable: true,
      fileBrowserOpen: false,
      vscodeAvailable: true,
      vscodeOpen: false,
      vscodeIframeCacheMode: "memory-saving",
      vscodeCacheReleaseAvailable: false,
      useLightweightTerminalPreview: true,
      terminalFontSize: 16,
      agentCompletionNotificationsEnabled: false,
      agentCompletionNotificationPermission: "default",
      feishuNotificationSettings: {
        configured: true,
        destinationType: "user",
        enabled: true,
      },
      feishuNotificationSettingsUpdating: false,
      onToggleCollapsed: () => {},
      onToggleFileBrowser: () => {},
      onToggleVsCode: () => {},
      onToggleVsCodeIframeCacheMode: () => {},
      onReleaseVsCodeIframeCache: () => {},
      onToggleTerminalPreviewMode: () => {},
      onTerminalFontSizeChange: () => {},
      onToggleAgentCompletionNotifications: () => {},
      onToggleFeishuNotifications: () => {},
      onOpenNewSession: () => {},
      onScanTmux: () => {},
      onScanApps: () => {},
      ...overrides,
    }),
  );
}

describe("TopBar", () => {
  it("groups tools, resource tuning, and Feishu notifications under settings", () => {
    assert.deepEqual(
      TOP_BAR_SETTINGS_SECTIONS.map(({ id, label }) => ({ id, label })),
      [
        { id: "tools", label: "工具" },
        { id: "resource", label: "资源调节" },
        { id: "feishu", label: "飞书通知" },
      ],
    );
  });

  it("keeps only grouped high-level actions visible by default", () => {
    const markup = renderTopBar();

    assert.match(markup, /电脑端 Coding Kanban/);
    assert.match(markup, /手机端 Coding Kanban/);
    assert.match(markup, /共 <strong>2<\/strong> 个会话/);
    assert.match(markup, /data-testid="new-session-toggle"/);
    assert.match(markup, /data-testid="scan-menu-toggle"/);
    assert.match(markup, /data-testid="settings-menu-toggle"/);
    assert.doesNotMatch(markup, /data-testid="tools-menu-toggle"/);
    assert.doesNotMatch(markup, /完成通知/);
    assert.doesNotMatch(markup, /data-testid="resource-tuning-menu-toggle"/);
    assert.match(markup, /data-testid="terminal-font-size-slider"/);
    assert.match(markup, /aria-label="终端字号"/);
    assert.match(markup, /value="16"/);
    assert.match(markup, /data-testid="file-browser-toggle"/);
    assert.match(markup, /data-testid="vscode-toggle"/);
    assert.doesNotMatch(markup, /VS Code 省内存/);
    assert.doesNotMatch(markup, /释放 VS Code 缓存/);
    assert.doesNotMatch(markup, />资源诊断</);
    assert.doesNotMatch(markup, />轻量预览：开</);
  });

  it("does not render an awaiting-input stat even if stale session data contains that state", () => {
    const markup = renderTopBar({
      sessions: [makeSession("session-1", "awaiting_input")],
      fileBrowserAvailable: false,
      vscodeAvailable: false,
    });

    assert.doesNotMatch(markup, /stat-awaiting/);
    assert.doesNotMatch(markup, /等待输入/);
  });

  it("keeps agent completion notification controls inside the tools menu", () => {
    const markup = renderTopBar({
      agentCompletionNotificationsEnabled: true,
    });

    assert.match(markup, /data-testid="settings-menu-toggle"/);
    assert.doesNotMatch(
      markup,
      /data-testid="agent-completion-notification-toggle"/,
    );
  });
});
