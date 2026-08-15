import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

test.describe("Mobile workspace", () => {
  test("keeps one session picker layer and aligns transcript actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/agent-sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          activeAgentSessionId: "mobile-alpha",
          items: [
            {
              id: "mobile-alpha",
              workspaceId: "default",
              sourceType: "local",
              agentKind: "codex",
              displayName: "Mobile Alpha",
              connectionState: "online",
              interactionState: "running",
            },
            {
              id: "mobile-beta",
              workspaceId: "default",
              sourceType: "local",
              agentKind: "shell",
              displayName: "Mobile Beta",
              connectionState: "online",
              interactionState: "idle",
            },
          ],
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto("/?view=mobile");
    await page.getByRole("button", { name: "当前会话" }).click();

    const picker = page.locator(".mobile-session-picker-trigger");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await picker.click();
      await expect(page.getByRole("listbox", { name: "选择终端会话" })).toHaveCount(1);
      await expect(page.getByRole("option")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox", { name: "选择终端会话" })).toHaveCount(0);
    }

    const transcriptBox = await page
      .getByRole("button", { name: "完整记录" })
      .boundingBox();
    const changesBox = await page
      .getByRole("button", { name: "变更" })
      .boundingBox();
    expect(transcriptBox).not.toBeNull();
    expect(changesBox).not.toBeNull();
    expect(Math.abs((transcriptBox?.y ?? 0) - (changesBox?.y ?? 0))).toBeLessThan(
      1,
    );
  });

  test("opens the lightweight board and mounts a terminal only after session navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=mobile");

    await expect(page.getByRole("heading", { name: "手机工作区" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "手机端主导航" })).toBeVisible();
    await expect(page.locator(".mobile-terminal-surface")).toHaveCount(0);
    await expect(page.locator(".terminal-view")).toHaveCount(0);

    await page.getByRole("button", { name: "当前会话" }).click();
    await expect(page.locator(".mobile-terminal-surface")).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(1);
  });

  test("provides board, activity, current session, and project/file destinations", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=mobile");

    const navigation = page.getByRole("navigation", { name: "手机端主导航" });
    await expect(navigation.getByRole("button", { name: "看板" })).toBeVisible();
    await expect(navigation.getByRole("button", { name: "活动" })).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "当前会话" }),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: "项目/文件" }),
    ).toBeVisible();

    await navigation.getByRole("button", { name: "活动" }).click();
    await expect(page.getByRole("heading", { name: "最近活动" })).toBeVisible();

    await navigation.getByRole("button", { name: "项目/文件" }).click();
    await expect(page.getByRole("heading", { name: "项目与文件" })).toBeVisible();
    await expect(page.locator(".terminal-view")).toHaveCount(0);
  });
});
