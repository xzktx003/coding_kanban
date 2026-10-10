import { expect, test, type Page } from "@playwright/test";

declare const process: {
  cwd(): string;
};

async function openScanMenu(page: Page): Promise<void> {
  await page.getByTestId("scan-menu-toggle").click();
}

async function openScanTmuxHostDropdown(page: Page): Promise<void> {
  await openScanMenu(page);
  await page.getByTestId("btn-扫描 tmux").click();
}

async function openScanAppsHostDropdown(page: Page): Promise<void> {
  await openScanMenu(page);
  await page.getByTestId("btn-扫描会话").click();
}

test.describe("Discovery Dialog", () => {
  test("TopBar has scan tmux dropdown button", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await openScanMenu(page);
    const scanTmuxBtn = page.getByTestId("btn-扫描 tmux");
    await expect(scanTmuxBtn).toBeVisible();
  });

  test("TopBar has scan apps dropdown button", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await openScanMenu(page);
    const scanAppsBtn = page.getByTestId("btn-扫描会话");
    await expect(scanAppsBtn).toBeVisible();
  });

  test("clicking scan tmux opens host dropdown then dialog", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await openScanTmuxHostDropdown(page);

    // Should see host dropdown with 本机 option
    const localOption = page.locator(".host-dropdown-item", {
      hasText: "本机",
    });
    await expect(localOption).toBeVisible();

    // Select local host
    await localOption.click();

    // Dialog should open
    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    // Title should indicate tmux
    await expect(page.locator(".discovery-dialog-title")).toContainText(
      "发现 tmux 会话",
    );
  });

  test("clicking scan apps opens host dropdown then dialog", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await openScanAppsHostDropdown(page);

    const localOption = page.locator(".host-dropdown-item", {
      hasText: "本机",
    });
    await expect(localOption).toBeVisible();

    await localOption.click();

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    await expect(page.locator(".discovery-dialog-title")).toContainText(
      "发现会话",
    );
  });

  test("host dropdown menu keeps a scrollable container for long machine lists", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await openScanTmuxHostDropdown(page);

    const menu = page.locator(".host-dropdown-menu");
    await expect(menu).toBeVisible();

    const styles = await menu.evaluate((element) => {
      const computed = window.getComputedStyle(element);
      return {
        overflowY: computed.overflowY,
        maxHeight: computed.maxHeight,
      };
    });

    expect(styles.overflowY).toBe("auto");
    expect(styles.maxHeight).not.toBe("none");
  });

  test("Cmd+Shift+S opens tmux discovery dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Press Cmd+Shift+S (Meta on macOS)
    await page.keyboard.press("Meta+Shift+KeyS");

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    await expect(page.locator(".discovery-dialog-title")).toContainText(
      "发现 tmux 会话",
    );
  });

  test("ESC closes the discovery dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Open dialog via keyboard
    await page.keyboard.press("Meta+Shift+KeyS");

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    // Press ESC
    await page.keyboard.press("Escape");

    // Dialog should be gone
    await expect(dialog).not.toBeVisible();
  });

  test("clicking overlay closes the discovery dialog", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await page.keyboard.press("Meta+Shift+KeyS");

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    // Click on overlay (outside dialog)
    const overlay = page.locator(".discovery-overlay");
    await overlay.click({ position: { x: 10, y: 10 } });

    await expect(dialog).not.toBeVisible();
  });

  test("tmux panel shows refresh button and search", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await page.keyboard.press("Meta+Shift+KeyS");

    const dialog = page.locator(".discovery-dialog");
    await expect(dialog).toBeVisible();

    // Should have search input
    const search = dialog.locator(".discovery-search");
    await expect(search).toBeVisible();

    // Should have refresh button
    const refreshBtn = dialog.locator("text=刷新");
    await expect(refreshBtn).toBeVisible();
  });

  test("scanning tmux does not auto-add sessions into the grid", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    const beforeCount = await page.locator(".grid-card").count();

    await openScanTmuxHostDropdown(page);
    await page.locator(".host-dropdown-item", { hasText: "本机" }).click();

    await expect(page.locator(".discovery-dialog")).toBeVisible();
    await page.waitForTimeout(1500);

    await expect(page.locator(".grid-card")).toHaveCount(beforeCount);
    await expect(page.locator(".discovery-error")).toHaveCount(0);
  });

  test("tmux discovery does not rescan when session snapshots refresh", async ({
    page,
    request,
  }) => {
    let scanCount = 0;
    let sessionId: string | undefined;

    await page.route("**/api/agent-discovery/tmux/scan", async (route) => {
      scanCount += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          unavailable: false,
        }),
      });
    });

    try {
      const displayName = `snapshot-refresh-${Date.now()}`;

      await page.goto("/");

      await openScanTmuxHostDropdown(page);
      await page.locator(".host-dropdown-item", { hasText: "本机" }).click();

      await expect(page.locator(".discovery-dialog")).toBeVisible();
      await expect.poll(() => scanCount, { timeout: 5000 }).toBeGreaterThan(0);
      await page.waitForTimeout(250);
      const baselineScanCount = scanCount;

      const response = await request.post("/api/agent-sessions/register", {
        data: {
          workspaceId: "default",
          sourceType: "local",
          agentKind: "shell",
          displayName,
          connectionState: "online",
          interactionState: "running",
        },
      });
      const created = (await response.json()) as { id: string };
      sessionId = created.id;

      await expect(
        page.locator(".grid-card", { hasText: displayName }),
      ).toBeVisible();
      await page.waitForTimeout(500);

      expect(scanCount).toBe(baselineScanCount);
    } finally {
      if (sessionId) {
        await request
          .delete(`/api/agent-sessions/${sessionId}`)
          .catch(() => {});
      }
    }
  });

  test("layout fold toggle works", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    const collapseBtn = page.locator(".top-bar-collapse-btn");
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();

    await expect(page.locator(".top-bar--collapsed")).toBeVisible();

    const expandBtn = page.locator(".top-bar-expand-btn");
    await expandBtn.click();

    await expect(page.locator(".top-bar--collapsed")).toHaveCount(0);
    await expect(
      page.locator(".workbench-terminal:not([hidden]) .workbench-brand"),
    ).toContainText("Coding Kanban");
  });
});
