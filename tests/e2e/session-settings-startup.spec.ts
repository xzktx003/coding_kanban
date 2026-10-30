import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test(`a pending display-name read leaves the conversation usable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 1);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    await page.route("**/api/session/api/settings", async (route) => {
      requested = true;
      await held;
      await route.fulfill({ json: {} }).catch(() => {});
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("/?mode=session");
      await expect.poll(() => requested).toBe(true);
      const editor = page
        .locator(".session-agent-view [contenteditable=true]")
        .first();
      await expect(editor).toBeVisible({ timeout: 5000 });
      await editor.fill("Settings cannot block this draft");
      await expect(editor).toHaveText("Settings cannot block this draft");
      await page.screenshot({ path: info.outputPath("settings-pending.png") });
      release();
      await expect(editor).toHaveText("Settings cannot block this draft");
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}
