import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("network recovery clears connection and sync warnings without losing the draft", async ({ page }) => {
  await installSessionUxFixture(page, 1);
  let offline = false;
  let failures = 0;
  await page.route("**/api/session/health", route => { if (offline) failures++; return route.fulfill({
    status: offline ? 503 : 200,
    json: offline ? { error: "isolated outage" } : { status: "ok", instance: "fixture" },
  }); });
  await page.route(/\/api\/session\/(tabs|projects)$/, async route => {
    if (offline) await route.fulfill({ status: 503, json: { error: "isolated outage" } });
    else await route.fallback();
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.waitFor();
  await seedSessionUx(page, 1);
  await editor.fill("断线期间保留的草稿");
  await page.clock.install();
  offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // Let routed HTTP responses settle between timer advances; one large jump
  // can fire request deadlines before the browser processes the mock response.
  await expect.poll(async () => {
    await page.clock.runFor(1_600);
    return page.getByRole("button", { name: "立即重试", exact: true }).isVisible();
  }, { timeout: 15_000 }).toBe(true);
  expect(failures).toBeGreaterThanOrEqual(5);
  await expect(page.getByText("会话服务连接中断，正在自动重连。草稿已保留。", { exact: false })).toBeVisible();
  await expect(page.getByText("同步待重试", { exact: true })).toBeVisible();
  await expect(editor).toContainText("断线期间保留的草稿");
  offline = false;
  await page.getByRole("button", { name: "立即重试", exact: true }).click();
  await page.clock.runFor(100);
  await expect(page.getByText("同步待重试", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "立即重试", exact: true })).toBeHidden();
  await expect(editor).toContainText("断线期间保留的草稿");
});

test("connection and shared sync work without newer AbortSignal static helpers", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
  });
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".session-mode [contenteditable=true]").first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("同步待重试", { exact: true })).toBeHidden();
});
