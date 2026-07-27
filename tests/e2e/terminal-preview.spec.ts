import { expect, test, type Locator, type Page } from "@playwright/test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

test.use({ ignoreHTTPSErrors: true });

function makeSession(
  overrides: Partial<AgentSessionRecord>,
): AgentSessionRecord {
  return {
    id: "session-default",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Default Session",
    workingDirectory: "/data01/home/xuzk/workspace/coding_kanban",
    connectionState: "online",
    interactionState: "running",
    outputPreview: "ready",
    ...overrides,
  };
}

function buildSnapshot(items: AgentSessionRecord[]): ListAgentSessionsResponse {
  return {
    items,
    activeAgentSessionId: items[0]?.id ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function installTrackingWebSocket(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();

    const trackedWindow = window as Window & {
      __allWebSocketUrls?: string[];
      __disableTerminalMonitorDragImageForTest?: boolean;
      __terminalWebSocketUrls?: string[];
    };
    trackedWindow.__allWebSocketUrls = [];
    trackedWindow.__disableTerminalMonitorDragImageForTest = true;
    trackedWindow.__terminalWebSocketUrls = [];

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

        trackedWindow.__allWebSocketUrls?.push(this.url);
        if (
          this.url.includes("/ws/agent-sessions/") &&
          this.url.includes("/terminal")
        ) {
          trackedWindow.__terminalWebSocketUrls?.push(this.url);
        }

        queueMicrotask(() => {
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        });
      }

      send(_data?: unknown) {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const event = new Event("close");
        this.dispatchEvent(event);
        this.onclose?.(event);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  });
}

async function mockSessions(
  page: Page,
  sessions: AgentSessionRecord[],
): Promise<void> {
  await installTrackingWebSocket(page);

  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ hosts: [] }),
    });
  });

  await page.route("**/api/agent-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(buildSnapshot(sessions)),
    });
  });
}

async function terminalWebSocketUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return [
      ...((window as Window & { __terminalWebSocketUrls?: string[] })
        .__terminalWebSocketUrls ?? []),
    ];
  });
}

async function dragRangeToValue(
  page: Page,
  slider: Locator,
  value: number,
): Promise<void> {
  await dragRangeToValueBeforeRelease(page, slider, value);
  await page.mouse.up();
}

async function dragRangeToValueBeforeRelease(
  page: Page,
  slider: Locator,
  value: number,
): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Range input is not visible");
  }

  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  const current = Number(await slider.inputValue());
  const valueToX = (nextValue: number) =>
    box.x + (box.width * (nextValue - min)) / (max - min);
  const y = box.y + box.height / 2;

  await page.mouse.move(valueToX(current), y);
  await page.mouse.down();
  await page.mouse.move(valueToX(value), y, { steps: 8 });
}

async function focusedTerminalFontSize(page: Page): Promise<number | null> {
  return page.locator(".focus-main-terminal .terminal-view-live").evaluate(
    (element) =>
      (
        element as HTMLElement & {
          __xterm?: { options?: { fontSize?: number } };
        }
      ).__xterm?.options?.fontSize ?? null,
  );
}

async function dragElementToPane(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !target) {
        throw new Error("Drag source or target not found");
      }

      const dataTransfer = new DataTransfer();
      const dispatchDragEvent = (element: Element, type: string) => {
        const event = new Event(type, {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "dataTransfer", {
          configurable: true,
          value: dataTransfer,
        });
        element.dispatchEvent(event);
      };

      dispatchDragEvent(source, "dragstart");
      if (!dataTransfer.getData("text/plain")) {
        const sourceSession =
          source
            .closest("[data-session-id]")
            ?.getAttribute("data-session-id") ??
          source
            .closest("[data-terminal-pane-session]")
            ?.getAttribute("data-terminal-pane-session");
        if (!sourceSession) {
          throw new Error("Drag source session not found");
        }
        const sourceSlot =
          source
            .closest("[data-terminal-pane-slot]")
            ?.getAttribute("data-terminal-pane-slot") ?? undefined;
        const payload = JSON.stringify({
          sessionId: sourceSession,
          sourceSlotId: sourceSlot,
        });
        dataTransfer.setData(
          "application/x-coding-kanban-terminal-session",
          payload,
        );
        dataTransfer.setData("text/plain", payload);
      }
      dispatchDragEvent(target, "dragover");
      dispatchDragEvent(target, "drop");
      dispatchDragEvent(source, "dragend");
    },
    { sourceSelector, targetSelector },
  );
}

test("grid cards use lightweight terminal previews without opening terminal WebSockets", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await expect(page.locator(".grid-card")).toHaveCount(2);
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(2);
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    0,
  );
  await expect(page.locator(".grid-card-terminal .xterm")).toHaveCount(0);
  await expect(
    page.locator(".grid-card", { hasText: "Alpha Session" }),
  ).toContainText("alpha ready");

  expect(await terminalWebSocketUrls(page)).toEqual([]);
});

test("preview mode toggle restores full terminal previews on demand", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  const toggle = page.getByTestId("terminal-preview-mode-toggle");
  const toggleLabel = toggle.locator("span").first();
  await expect(toggleLabel).toHaveText("轻量预览：开");
  expect(await terminalWebSocketUrls(page)).toEqual([]);

  await toggle.click();

  await expect(toggleLabel).toHaveText("完整预览");
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    2,
  );
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(0);
  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/alpha-session/terminal"));
  expect(await terminalWebSocketUrls(page)).toContainEqual(
    expect.stringContaining("/beta-session/terminal"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("terminal-preview-mode")),
    )
    .toBe("full");
});

test("grid virtualizes full terminal previews when many tmux sessions are joined", async ({
  page,
}) => {
  const sessions = Array.from({ length: 30 }, (_, index) =>
    makeSession({
      id: `bulk-session-${index + 1}`,
      displayName: `Bulk Session ${index + 1}`,
      outputPreview: `bulk ${index + 1} ready`,
      sourceType: "remote-tmux-discovered",
      transportRef: {
        tmuxSession: `bulk-${index + 1}`,
      },
    }),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await mockSessions(page, sessions);
  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  await page.getByTestId("terminal-preview-mode-toggle").click();

  const grid = page.getByTestId("agent-grid");
  await expect(grid).toHaveAttribute("data-virtualized", "true");
  await expect
    .poll(async () =>
      page.locator(".grid-card-terminal .terminal-view").count(),
    )
    .toBeGreaterThan(0);

  const initiallyMountedCards = await page.locator(".grid-card").count();
  const initiallyMountedTerminals = await page
    .locator(".grid-card-terminal .terminal-view")
    .count();
  expect(initiallyMountedCards).toBeLessThan(sessions.length);
  expect(initiallyMountedTerminals).toBeLessThan(sessions.length);
  expect((await terminalWebSocketUrls(page)).length).toBeLessThan(
    sessions.length,
  );

  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(
    page.locator(".grid-card", { hasText: "Bulk Session 30" }),
  ).toBeVisible();
});

test("VS Code preserve-state profile restores full terminal previews for running panes", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  const vscodeProfileToggle = page.getByTestId("vscode-cache-mode-toggle");
  const vscodeProfileLabel = vscodeProfileToggle.locator("span").first();
  await expect(vscodeProfileLabel).toHaveText("VS Code 省内存");
  const terminalPreviewToggle = page.getByTestId(
    "terminal-preview-mode-toggle",
  );
  const terminalPreviewLabel = terminalPreviewToggle.locator("span").first();
  await expect(terminalPreviewLabel).toHaveText("轻量预览：开");
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(2);
  expect(await terminalWebSocketUrls(page)).toEqual([]);

  await vscodeProfileToggle.click();

  await expect(vscodeProfileLabel).toHaveText("VS Code 保持状态");
  await expect(terminalPreviewLabel).toHaveText("完整预览");
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    2,
  );
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(0);
  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/alpha-session/terminal"));
  expect(await terminalWebSocketUrls(page)).toContainEqual(
    expect.stringContaining("/beta-session/terminal"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("vscode-iframe-cache-mode")),
    )
    .toBe("preserve-state");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("terminal-preview-mode")),
    )
    .toBe("full");
});

test("focus view keeps every sidebar card lightweight while only the main pane opens a real terminal", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "focused-session",
      displayName: "Focused Session",
      outputPreview: "focused ready",
    }),
    makeSession({
      id: "sidebar-session",
      displayName: "Sidebar Session",
      outputPreview: "sidebar ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Focused Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect(
    page.locator(".focus-sidebar-terminal .terminal-preview"),
  ).toHaveCount(2);
  await expect(
    page.locator(".focus-sidebar-terminal .terminal-view"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("terminal-preview-focused-session"),
  ).toContainText("focused ready");
  await expect(
    page.getByTestId("terminal-preview-sidebar-session"),
  ).toContainText("sidebar ready");

  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/focused-session/terminal"));
  expect(await terminalWebSocketUrls(page)).not.toContainEqual(
    expect.stringContaining("/sidebar-session/terminal"),
  );
});

test("top font-size slider adjusts the focused terminal font size", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "focused-session",
      displayName: "Focused Session",
      outputPreview: "focused ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Focused Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);

  const slider = page.getByTestId("terminal-font-size-slider");
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("14");

  await dragRangeToValue(page, slider, 21);
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(18);

  const selectedFontSize = Number(await slider.inputValue());
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(selectedFontSize);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe(String(selectedFontSize));
});

test("top font-size slider defers terminal resize until the drag is released", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "deferred-font-session",
      displayName: "Deferred Font Session",
      outputPreview: "deferred font ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Deferred Font Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe("14");

  const slider = page.getByTestId("terminal-font-size-slider");
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("14");

  await dragRangeToValueBeforeRelease(page, slider, 21);
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(18);
  const selectedFontSize = Number(await slider.inputValue());

  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe("14");

  await page.mouse.up();

  await expect.poll(() => focusedTerminalFontSize(page)).toBe(selectedFontSize);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe(String(selectedFontSize));
});

test("focus monitor panes accept dragged sidebar sessions and swap dragged panes", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await dragElementToPane(
    page,
    '[data-session-id="gamma-session"] .focus-sidebar-card-header',
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(
    page.locator(".focus-sidebar-card", { hasText: "Alpha Session" }),
  ).toBeVisible();

  await dragElementToPane(
    page,
    '[data-terminal-pane-slot="terminal-monitor-slot-1"] .focus-terminal-pane-header',
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
});

test("links sidebar cards to monitor panes without moving monitored sessions", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");
  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );
  const alphaCard = page.locator(
    '.focus-sidebar-card[data-session-id="alpha-session"]',
  );
  const betaCard = page.locator(
    '.focus-sidebar-card[data-session-id="beta-session"]',
  );
  const gammaCard = page.locator(
    '.focus-sidebar-card[data-session-id="gamma-session"]',
  );

  await expect(alphaCard).toHaveAttribute("data-monitor-index", "1");
  await expect(alphaCard).toHaveAttribute(
    "data-active-monitor-session",
    "true",
  );
  await expect(betaCard).toHaveAttribute("data-monitor-index", "2");
  await expect(gammaCard).not.toHaveAttribute("data-monitor-index", /.+/);

  await betaCard.click();
  await expect(secondPane).toHaveAttribute("data-active-terminal-pane", "true");
  await expect(betaCard).toHaveAttribute("data-active-monitor-session", "true");
  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await gammaCard.click();
  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(gammaCard).toHaveAttribute("data-monitor-index", "2");
  await expect(gammaCard).toHaveAttribute(
    "data-active-monitor-session",
    "true",
  );
  await expect(betaCard).not.toHaveAttribute("data-monitor-index", /.+/);
});

test("focus sidebar double-click replaces the active monitor pane only once", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await page
    .locator(".focus-sidebar-card", { hasText: "Gamma Session" })
    .dblclick();

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(
    page.locator(".focus-sidebar-card", { hasText: "Alpha Session" }),
  ).toBeVisible();

  await page.waitForTimeout(300);

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
});

test("focus header follows the active monitor terminal session", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  await expect(page.locator(".focus-main-name")).toHaveText("Alpha Session");

  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );
  await secondPane.getByRole("button", { name: "设为输入" }).click();

  await expect(page.locator(".focus-main-name")).toHaveText("Beta Session");

  let renameDefaultValue = "";
  page.once("dialog", async (dialog) => {
    renameDefaultValue = dialog.defaultValue();
    await dialog.dismiss();
  });
  await page.locator(".focus-rename-btn").click({ force: true });
  await expect.poll(() => renameDefaultValue).toBe("Beta Session");
});

test("focus sidebar drag uses a single preview for the dragged session", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma line 1\ngamma line 2\ngamma line 3",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  await page.evaluate(() => {
    const trackedWindow = window as Window & {
      __forceTerminalMonitorDragImageForTest?: boolean;
      __terminalMonitorDragImages?: Array<{
        height: number;
        previewKind: string | undefined;
        sessionId: string | undefined;
        tagName: string;
        width: number;
        x: number;
        y: number;
      }>;
      __terminalMonitorDragImagePatched?: boolean;
    };
    trackedWindow.__terminalMonitorDragImages = [];
    trackedWindow.__forceTerminalMonitorDragImageForTest = true;
    if (trackedWindow.__terminalMonitorDragImagePatched) {
      return;
    }

    const originalSetDragImage = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (
      image: Element,
      x: number,
      y: number,
    ) {
      const element = image as HTMLElement;
      const canvas = image as HTMLCanvasElement;
      trackedWindow.__terminalMonitorDragImages?.push({
        height: canvas.height,
        previewKind: element.dataset.previewKind,
        sessionId: element.dataset.sessionId,
        tagName: element.tagName,
        width: canvas.width,
        x,
        y,
      });
      return originalSetDragImage.call(this, image, x, y);
    };
    trackedWindow.__terminalMonitorDragImagePatched = true;
  });

  const draggedCard = page.locator(".focus-sidebar-card", {
    hasText: "Gamma Session",
  });
  await draggedCard.evaluate((element) => {
    const event = new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    });
    element.dispatchEvent(event);
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        return (
          (
            window as Window & {
              __terminalMonitorDragImages?: unknown[];
            }
          ).__terminalMonitorDragImages ?? []
        );
      }),
    )
    .toEqual([
      expect.objectContaining({
        previewKind: "terminal-monitor-session",
        sessionId: "gamma-session",
        tagName: "CANVAS",
        x: 132,
        y: 44,
      }),
    ]);
  await expect(
    page.locator('canvas[data-preview-kind="terminal-monitor-session"]'),
  ).toHaveAttribute("data-session-id", "gamma-session");

  await draggedCard.evaluate((element) => {
    element.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  });
  await expect(
    page.locator('canvas[data-preview-kind="terminal-monitor-session"]'),
  ).toHaveCount(0);
});
