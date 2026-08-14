import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

test.describe("Mobile workspace", () => {
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