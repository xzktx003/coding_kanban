import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const width of [1440, 390]) {
  test(`selection formatting stays readable below the draft (${width})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, false);
    try {
      const editor = page
        .locator(".session-composer-editor [contenteditable=true]")
        .first();
      await editor.fill("检查选中文字时的工具栏");
      await editor.press("ControlOrMeta+A");
      const toolbar = page.getByRole("toolbar", { name: "文本格式" });
      await expect(toolbar).toBeVisible();
      await expect(toolbar).toHaveCSS("opacity", "1");
      const inputBox = (await editor.boundingBox())!;
      const toolbarBox = (await toolbar.boundingBox())!;
      expect(inputBox.height).toBeGreaterThan(0);
      expect(toolbarBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height);
      expect(toolbarBox.x).toBeGreaterThanOrEqual(0);
      expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(width);
      await expect
        .poll(() =>
          toolbar.evaluate((el) => {
            const button = el.querySelector("button")!;
            const rect = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        )
        .toBe(true);
      await page.screenshot({ path: info.outputPath("selected-draft.png") });
      await toolbar.getByRole("button", { name: "粗体", exact: true }).click();
      await expect(editor).toHaveText("**检查选中文字时的工具栏**");
      await expect(toolbar).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}
