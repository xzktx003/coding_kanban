import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

test.use({ ignoreHTTPSErrors: true });

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeSession(): AgentSessionRecord {
  return {
    id: "clipboard-image-session",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Clipboard Image Session",
    workingDirectory: process.cwd(),
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    outputPreview: "ready",
  };
}

function buildSnapshot(items: AgentSessionRecord[]): ListAgentSessionsResponse {
  return {
    items,
    activeAgentSessionId: items[0]?.id ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function installTerminalMock(page: Page) {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.OPEN;
      bufferedAmount = 0;
      extensions = "";
      protocol = "";
      binaryType: BinaryType = "blob";
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);

        queueMicrotask(() => {
          const openEvent = new Event("open");
          this.dispatchEvent(openEvent);
          this.onopen?.(openEvent);

          if (!this.url.includes("/terminal")) {
            return;
          }

          const replayCompleteEvent = new MessageEvent("message", {
            data: JSON.stringify({
              __agentOrchestrator: "terminal-control",
              event: "replay-complete",
            }),
          });
          this.dispatchEvent(replayCompleteEvent);
          this.onmessage?.(replayCompleteEvent);
        });
      }

      send(_data?: unknown) {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const closeEvent = new CloseEvent("close");
        this.dispatchEvent(closeEvent);
        this.onclose?.(closeEvent);
      }
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    localStorage.clear();
  });
}

async function mockSessions(page: Page, sessions: AgentSessionRecord[]) {
  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ hosts: [] }),
    });
  });

  await page.route("**/api/agent-sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(buildSnapshot(sessions)),
    });
  });
}

async function grantClipboardPermissions(context: BrowserContext) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

test("pasting a browser clipboard image opens the Kanban image confirmation instead of reaching Codex", async ({
  context,
  page,
}) => {
  await grantClipboardPermissions(context);
  await installTerminalMock(page);
  await mockSessions(page, [makeSession()]);

  await page.goto("/");
  await page
    .locator(".grid-card", { hasText: "Clipboard Image Session" })
    .dblclick();
  const terminalInput = page.locator(
    '[data-active-terminal-pane="true"] .xterm-helper-textarea',
  );
  await expect(terminalInput).toBeAttached();

  await page.evaluate(async (encodedPng) => {
    const bytes = Uint8Array.from(atob(encodedPng), (character) =>
      character.charCodeAt(0),
    );
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([bytes], { type: "image/png" }),
      }),
    ]);
  }, ONE_PIXEL_PNG_BASE64);

  await terminalInput.focus();
  await page.keyboard.press("Control+V");

  const dialog = page.getByRole("dialog", { name: "发送图片到 Codex" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText("待发送图片预览")).toBeVisible();
  await expect(dialog).toContainText("Clipboard Image Session");
});
