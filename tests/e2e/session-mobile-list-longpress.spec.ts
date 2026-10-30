import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
test("phone long press opens the original row without selecting or stopping it; movement cancels a later hold", async ({ page }, info) => {
  const fixture = await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await seedSessionUx(page, 2);
  await editor.fill("手机长按前的原会话草稿");
  const row = page.locator('.session-nav-row[role="button"]').filter({ hasText: "中文会话 1 " }).last();
  if (!(await row.isVisible())) await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  await expect(row).toBeVisible();
  const ownerBefore = await page.locator(".session-codex-composer").getAttribute("data-owner-thread");
  const box = await row.boundingBox();
  if (!box) throw new Error("The actual phone row must have geometry");
  const point = { x: box.x + Math.min(70, box.width / 3), y: box.y + box.height / 2 };
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expect(page.getByRole("menuitem", { name: "复制会话 ID", exact: true })).toBeVisible();
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.locator(".session-codex-composer").getAttribute("data-owner-thread")).toBe(ownerBefore);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "复制会话 ID", exact: true })).toHaveCount(0);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, y: point.y + 24 }] });
    await page.waitForTimeout(550);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("menuitem", { name: "复制会话 ID", exact: true })).toHaveCount(0);
    expect(await page.locator(".session-codex-composer").getAttribute("data-owner-thread")).toBe(ownerBefore);
    // Closing the project sheet returns to the same input owner and draft.
    const close = page.getByRole("button", { name: "Close", exact: true });
    if (await close.isVisible()) await close.click();
    await expect(editor).toHaveText("手机长按前的原会话草稿");
    const writes = fixture.calls.filter(row => /turn\/(start|interrupt)|followups\/(submit|change|stop)|thread\/(start|resume|fork|delete)|lifecycle\/(attach|archive)/.test(row.path));
    expect(writes).toEqual([]);
    await info.attach("phone-longpress-evidence", { body: JSON.stringify({ ownerBefore, point, writes, nativeTouch: true, boundary: "Actual Chromium touch dispatch, product 450ms hold handler, menu visibility and owner/draft preservation; isolated API fixture, no physical phone or native model task." }), contentType: "application/json" });
  } finally {
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }).catch(() => {});
    await client.detach();
  }
});
