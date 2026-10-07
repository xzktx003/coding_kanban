import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("secondary pages provide responsive controls, project links and recoverable errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installSessionUxFixture(page, 0);
  let failAutomation = true;
  await page.route("**/api/session/api/automation/list", (route) =>
    route.fulfill(
      failAutomation
        ? { status: 503, json: { error: "isolated automation unavailable" } }
        : { json: [] },
    ),
  );
  await page.route("**/api/session/api/insights/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/filter-options")
        ? { cwds: [], session_ids: [] }
        : path.endsWith("/rankings")
          ? { by_cwd: [], by_session: [] }
          : { claude: null, codex: null, gemini: null },
    });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await page.setViewportSize({ width: 375, height: 812 });
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  await nav.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "用量", exact: true }).click();
  const refresh = page.getByRole("button", { name: "刷新用量", exact: true });
  await expect(refresh).toBeVisible();
  const box = await refresh.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await nav.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "定时任务", exact: true }).click();
  const templates = page.getByRole("tab", { name: "模板", exact: true });
  await expect(templates).toBeVisible();
  const t = await templates.boundingBox();
  expect(t!.x + t!.width).toBeLessThanOrEqual(375);
  await expect(page.getByRole("alert")).toContainText(
    "isolated automation unavailable",
  );
  await expect(page.getByText("暂无定时任务。", { exact: true })).toHaveCount(
    0,
  );
  failAutomation = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("暂无定时任务。", { exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "GitHub 项目", exact: true }),
  ).toHaveAttribute("href", "https://github.com/BrotherHappy/coding-kanban");
  await nav.getByRole("button", { name: "会话", exact: true }).click();
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
