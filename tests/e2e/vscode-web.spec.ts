import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import path from "node:path";

import { selectTerminalPaneSession } from "./terminal-session-switcher";

declare const process: {
  cwd(): string;
};

async function launchMockSession(
  request: APIRequestContext,
  displayName: string,
  workingDirectory: string,
) {
  const response = await request.post("/api/agent-launch/pty", {
    data: {
      workspaceId: "default",
      displayName,
      agentKind: "shell",
      command: `node ${JSON.stringify(path.join(process.cwd(), "scripts/mock-terminal-agent.mjs"))} scroll`,
      workingDirectory,
    },
  });

  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

async function deleteSessionIfPresent(
  request: APIRequestContext,
  sessionId?: string,
) {
  if (!sessionId) {
    return;
  }

  await request.delete(`/api/agent-sessions/${sessionId}`).catch(() => {});
}

async function focusSession(page: Page, displayName: string) {
  await page.goto("/");
  const targetCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: displayName }),
  });
  await expect(targetCard).toBeVisible({ timeout: 15_000 });
  await targetCard.dblclick();
  await expect(page.locator(".focus-main-name")).toContainText(displayName);
}

async function switchFocusedSession(page: Page, displayName: string) {
  const sidebarCard = page.locator(".focus-sidebar-card", {
    has: page.locator("span", { hasText: displayName }),
  });
  await expect(sidebarCard).toBeVisible();
  await sidebarCard
    .locator(".focus-sidebar-card-name")
    .click({ timeout: 2000 });
  await expect(page.locator(".focus-main-name")).toContainText(displayName, {
    timeout: 5000,
  });
}

test("vscode divider keeps pointer capture and persists only the final width", async ({
  page,
  request,
}) => {
  const sessionName = `vscode-web-resize-${Date.now()}`;
  let sessionId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: "data:text/html,<html><body>resize-editor</body></html>",
        reused: false,
        workingDirectory: "/tmp/project-resize",
      }),
    });
  });

  try {
    sessionId = await launchMockSession(
      request,
      sessionName,
      "/tmp/project-resize",
    );
    await focusSession(page, sessionName);
    await page.getByTestId("vscode-toggle").click();
    await expect(page.getByTestId("vscode-web-frame")).toBeVisible();

    await page.evaluate(() => {
      const trackedWindow = window as Window & {
        __fileBrowserStateWriteCount: number;
      };
      const originalSetItem = Storage.prototype.setItem;
      trackedWindow.__fileBrowserStateWriteCount = 0;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === "file-browser-ui-state") {
          trackedWindow.__fileBrowserStateWriteCount += 1;
        }
        return originalSetItem.call(this, key, value);
      };
    });

    const sidePanel = page.locator(".file-browser-shell");
    const splitter = page.getByTestId("file-browser-main-splitter");
    const sidePanelBefore = await sidePanel.boundingBox();
    const splitterBox = await splitter.boundingBox();
    expect(sidePanelBefore).not.toBeNull();
    expect(splitterBox).not.toBeNull();

    const startX = splitterBox!.x + splitterBox!.width / 2;
    const centerY = splitterBox!.y + splitterBox!.height / 2;
    await page.mouse.move(startX, centerY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, centerY, { steps: 24 });
    await expect(page.locator(".main-layout")).toHaveClass(/resizing/);
    await page.mouse.up();

    const sidePanelAfter = await sidePanel.boundingBox();
    expect(sidePanelAfter).not.toBeNull();
    expect(sidePanelAfter!.width).toBeLessThan(sidePanelBefore!.width - 80);
    await expect(page.locator(".main-layout")).not.toHaveClass(/resizing/);
    await expect(page.getByTestId("vscode-web-frame")).toBeVisible();

    const storageWriteCount = await page.evaluate(
      () =>
        (
          window as Window & {
            __fileBrowserStateWriteCount: number;
          }
        ).__fileBrowserStateWriteCount,
    );
    expect(storageWriteCount).toBe(1);
  } finally {
    await deleteSessionIfPresent(request, sessionId);
  }
});

test("vscode web drawer is scoped per focused session and replaces the old capture entry point", async ({
  page,
  request,
}) => {
  const sessionAName = `vscode-web-a-${Date.now()}`;
  const sessionBName = `vscode-web-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    const url = new URL(route.request().url());
    const sessionId = url.pathname.split("/").slice(-2)[0];
    const payload =
      sessionId === sessionAId
        ? {
            provider: "code-server",
            url: "data:text/html,<html><body>editor-a</body></html>",
            reused: false,
            workingDirectory: "/tmp/project-a",
          }
        : {
            provider: "code-server",
            url: "data:text/html,<html><body>editor-b</body></html>",
            reused: false,
            workingDirectory: "/tmp/project-b",
          };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      "/tmp/project-a",
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      "/tmp/project-b",
    );

    await page.goto("/");
    await expect(page.getByTestId("vscode-toggle")).toBeDisabled();
    await expect(
      page.locator(".top-bar-action", { hasText: "添加 VS Code 窗口" }),
    ).toHaveCount(0);

    await focusSession(page, sessionAName);
    await expect(page.getByTestId("vscode-toggle")).toBeEnabled();
    await page.getByTestId("vscode-toggle").click();

    const drawerA = page.getByTestId("vscode-web-drawer");
    await expect(drawerA).toBeVisible();
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );

    const frameBodyA = page
      .frameLocator(`iframe[title="VS Code - ${sessionAName}"]`)
      .locator("body");
    await expect(frameBodyA).toContainText("editor-a");
    await frameBodyA.evaluate((body) => {
      body.textContent = "sticky-a";
    });

    await page.getByTestId("file-browser-toggle").click();
    await expect(page.getByTestId("file-browser-drawer")).toBeVisible();
    await page.getByTestId("vscode-toggle").click();
    await expect(frameBodyA).toContainText("editor-a");

    await switchFocusedSession(page, sessionBName);
    const drawerB = page.getByTestId("vscode-web-drawer");
    await expect(drawerB).toBeVisible();
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-b/,
    );

    await switchFocusedSession(page, sessionAName);
    await expect(page.getByTestId("vscode-web-drawer")).toBeVisible();
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );
    await expect(frameBodyA).toContainText("editor-a");

    await page.reload();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    await expect(page.getByTestId("vscode-web-drawer")).toHaveCount(0);
    await page.getByTestId("vscode-toggle").click();
    await expect(page.getByTestId("vscode-web-drawer")).toBeVisible();
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );

    await page.getByRole("button", { name: "返回宫格" }).click();
    await expect(page.getByTestId("vscode-web-drawer")).toHaveCount(0);
    await expect(page.getByTestId("vscode-toggle")).toBeDisabled();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
  }
});

test("vscode web follows the active monitor terminal only when opened or explicitly requested", async ({
  page,
  request,
}) => {
  const sessionAName = `vscode-web-monitor-a-${Date.now()}`;
  const sessionBName = `vscode-web-monitor-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    const url = new URL(route.request().url());
    const sessionId = url.pathname.split("/").slice(-2)[0];
    const label = sessionId === sessionBId ? "editor-b" : "editor-a";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: `data:text/html,<html><body>${label}</body></html>`,
        reused: false,
        workingDirectory:
          sessionId === sessionBId ? "/tmp/project-b" : "/tmp/project-a",
      }),
    });
  });

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      "/tmp/project-a",
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      "/tmp/project-b",
    );

    await page.goto("/");
    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);
    await expect(secondPane).toHaveAttribute(
      "data-terminal-pane-session",
      sessionBId!,
    );
    await secondPane.locator(".terminal-view").click();

    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await page.getByTestId("vscode-toggle").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-b/,
    );

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
  }
});

test("vscode side collapse state is controlled only by collapse buttons during monitor switches", async ({
  page,
  request,
}) => {
  const sessionAName = `vscode-web-collapse-a-${Date.now()}`;
  const sessionBName = `vscode-web-collapse-b-${Date.now()}`;
  let sessionAId: string | undefined;
  let sessionBId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    const url = new URL(route.request().url());
    const sessionId = url.pathname.split("/").slice(-2)[0];
    const label = sessionId === sessionBId ? "editor-b" : "editor-a";

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: `data:text/html,<html><body>${label}</body></html>`,
        reused: false,
        workingDirectory:
          sessionId === sessionBId ? "/tmp/project-b" : "/tmp/project-a",
      }),
    });
  });

  try {
    sessionAId = await launchMockSession(
      request,
      sessionAName,
      "/tmp/project-a",
    );
    sessionBId = await launchMockSession(
      request,
      sessionBName,
      "/tmp/project-b",
    );

    await page.goto("/");
    await focusSession(page, sessionAName);
    await page.getByRole("button", { name: /屏幕布局/ }).click();
    await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

    const firstPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
    );
    const secondPane = page.locator(
      '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
    );
    await selectTerminalPaneSession(page, secondPane, sessionBId!);
    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);

    await page.getByTestId("vscode-toggle").click();
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );

    const sideShell = page.locator(".file-browser-shell");
    const sideCollapseToggle = page.getByTestId("side-panel-collapse-toggle");

    await sideCollapseToggle.click();
    const collapsedBeforeSwitch = await sideShell.boundingBox();
    expect((collapsedBeforeSwitch?.width ?? 0) < 10).toBeTruthy();

    await secondPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionBName);
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-b/,
    );
    const collapsedAfterSwitch = await sideShell.boundingBox();
    expect((collapsedAfterSwitch?.width ?? 0) < 10).toBeTruthy();

    await sideCollapseToggle.click();
    const expandedOnB = await sideShell.boundingBox();
    expect((expandedOnB?.width ?? 0) > 200).toBeTruthy();

    await firstPane.locator(".terminal-view").click();
    await expect(page.locator(".focus-main-name")).toContainText(sessionAName);
    await expect(page.getByTestId("vscode-web-frame")).toHaveAttribute(
      "src",
      /editor-a/,
    );
    const expandedAfterSwitchBack = await sideShell.boundingBox();
    expect((expandedAfterSwitchBack?.width ?? 0) > 200).toBeTruthy();
  } finally {
    await deleteSessionIfPresent(request, sessionAId);
    await deleteSessionIfPresent(request, sessionBId);
  }
});

test("vscode split view keeps editor focus after clicking back from the terminal", async ({
  page,
  request,
}) => {
  const sessionName = `vscode-web-focus-${Date.now()}`;
  const typedMarker = `left-editor-${Date.now()}`;
  let sessionId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: `data:text/html,${encodeURIComponent(
          "<html><body><textarea id=editor autofocus style='width:100%;height:160px'></textarea></body></html>",
        )}`,
        reused: false,
        workingDirectory: "/tmp/vscode-focus",
      }),
    });
  });

  try {
    sessionId = await launchMockSession(request, sessionName, "/tmp/project-a");

    await focusSession(page, sessionName);
    await page.getByTestId("vscode-toggle").click();

    const terminalScreen = page.locator(
      ".focus-main .terminal-view .xterm-screen",
    );
    await expect(terminalScreen).toBeVisible({ timeout: 15_000 });
    await terminalScreen.click({ position: { x: 90, y: 50 } });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    const editorTextarea = page
      .frameLocator(`iframe[title="VS Code - ${sessionName}"]`)
      .locator("#editor");
    await editorTextarea.click();
    await page.keyboard.type(typedMarker);

    await expect(editorTextarea).toHaveValue(typedMarker);
    await expect
      .poll(async () =>
        page.evaluate(
          (title) =>
            document.activeElement instanceof HTMLIFrameElement &&
            document.activeElement.title === title,
          `VS Code - ${sessionName}`,
        ),
      )
      .toBeTruthy();
  } finally {
    await deleteSessionIfPresent(request, sessionId);
  }
});

test("vscode split view keeps editor focus after terminal editor round trip", async ({
  page,
  request,
}) => {
  const sessionName = `vscode-web-roundtrip-${Date.now()}`;
  const firstEditorMarker = `editor-first-${Date.now()}`;
  const terminalMarker = `terminal-middle-${Date.now()}`;
  const secondEditorMarker = `editor-second-${Date.now()}`;
  let sessionId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: `data:text/html,${encodeURIComponent(
          "<html><body><textarea id=editor autofocus style='width:100%;height:180px'></textarea></body></html>",
        )}`,
        reused: false,
        workingDirectory: "/tmp/vscode-roundtrip",
      }),
    });
  });

  try {
    sessionId = await launchMockSession(request, sessionName, "/tmp/project-a");

    await focusSession(page, sessionName);
    await page.getByTestId("vscode-toggle").click();

    const editorTextarea = page
      .frameLocator(`iframe[title="VS Code - ${sessionName}"]`)
      .locator("#editor");
    await editorTextarea.click();
    await page.keyboard.type(firstEditorMarker);
    await expect(editorTextarea).toHaveValue(firstEditorMarker);

    const terminalScreen = page.locator(
      ".focus-main .terminal-view .xterm-screen",
    );
    await expect(terminalScreen).toBeVisible({ timeout: 15_000 });
    await terminalScreen.click({ position: { x: 90, y: 50 } });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.keyboard.type(terminalMarker);
    await page.keyboard.press("Enter");
    await expect(page.locator(".focus-main .xterm-rows")).toContainText(
      `stdin:${terminalMarker}`,
      { timeout: 10_000 },
    );

    await editorTextarea.click();
    await page.keyboard.type(secondEditorMarker);
    await expect
      .poll(async () => editorTextarea.inputValue())
      .toContain(secondEditorMarker);
    await expect
      .poll(async () =>
        page.evaluate(
          (title) =>
            document.activeElement instanceof HTMLIFrameElement &&
            document.activeElement.title === title,
          `VS Code - ${sessionName}`,
        ),
      )
      .toBeTruthy();
  } finally {
    await deleteSessionIfPresent(request, sessionId);
  }
});

test("vscode split view does not steal focus back after the user clicks the terminal", async ({
  page,
  request,
}) => {
  const sessionName = `vscode-web-terminal-focus-${Date.now()}`;
  const typedMarker = `terminal-retains-${Date.now()}`;
  let sessionId: string | undefined;

  await page.route("**/api/agent-sessions/*/vscode-web", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "code-server",
        url: `data:text/html,${encodeURIComponent(`
          <html>
            <body>
              <textarea id="editor" autofocus style="width:100%;height:160px"></textarea>
              <script>
                setInterval(() => {
                  document.getElementById('editor').focus();
                }, 120);
              </script>
            </body>
          </html>
        `)}`,
        reused: false,
        workingDirectory: "/tmp/vscode-terminal-focus",
      }),
    });
  });

  try {
    sessionId = await launchMockSession(request, sessionName, "/tmp/project-a");

    await focusSession(page, sessionName);
    await page.getByTestId("vscode-toggle").click();

    const editorTextarea = page
      .frameLocator(`iframe[title="VS Code - ${sessionName}"]`)
      .locator("#editor");
    await editorTextarea.click();

    const terminalScreen = page.locator(
      ".focus-main .terminal-view .xterm-screen",
    );
    await expect(terminalScreen).toBeVisible({ timeout: 15_000 });
    await terminalScreen.click({ position: { x: 90, y: 50 } });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.waitForTimeout(1_200);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.activeElement?.classList.contains(
              "xterm-helper-textarea",
            ) ?? false,
        ),
      )
      .toBeTruthy();

    await page.keyboard.type(typedMarker);
    await page.keyboard.press("Enter");

    await expect(page.locator(".focus-main .xterm-rows")).toContainText(
      `stdin:${typedMarker}`,
      { timeout: 10_000 },
    );
  } finally {
    await deleteSessionIfPresent(request, sessionId);
  }
});
