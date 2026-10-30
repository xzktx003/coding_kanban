import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 393]) test(`slash commands open usable panels and preserve the composer at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  const fixture = await installSessionUxFixture(page, 0);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  for (const [command, title] of [["status", "会话状态"], ["mcp", "MCP 服务器状态"], ["personality", "个性"]]) {
    await editor.fill(`/${command}`);
    await page.getByRole("option").filter({ hasText: `/${command}` }).first().click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    if (command === "personality") {
      await expect(dialog.getByRole("radio", { name: "务实", exact: true })).toBeVisible();
      await dialog.getByRole("radio", { name: "务实", exact: true }).check();
      await dialog.getByRole("button", { name: "保存兼容偏好" }).click();
    } else await dialog.getByRole("button", { name: "关闭面板" }).click();
    await expect(editor).toBeVisible();
  }
  expect(fixture.calls.filter((row) => /\/(?:turn\/start|followups\/submit)$/.test(row.path))).toEqual([]);
});
