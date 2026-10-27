import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { composerAction } from "./session-composer-actions";
for (const width of [1440, 390]) {
  test(`expanded code insertion preserves text, selection and Chinese input at ${width}`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const f = await setup(page, false);
    const editor = page
      .locator(".session-composer-editor [contenteditable=true]")
      .first();
    const textarea = page.getByRole("textbox", {
      name: "展开的消息草稿",
      exact: true,
    });
    const insert = page.getByRole("button", {
      name: "插入代码块",
      exact: true,
    });
    try {
      await editor.fill("唯一原始草稿");
      await composerAction(page, "展开编辑");
      await insert.click();
      await page
        .getByRole("button", { name: "纯文本模式", exact: true })
        .click();
      await expect(textarea).toHaveValue("唯一原始草稿\n```\n\n```\n");
      await textarea.fill("前文选中代码后文");
      await textarea.evaluate((node: HTMLTextAreaElement) => {
        node.focus();
        node.setSelectionRange(2, 6);
        node.dispatchEvent(new Event("select", { bubbles: true }));
      });
      await insert.click();
      await expect(textarea).toHaveValue("前文\n```\n选中代码\n```\n后文");
      await page
        .getByRole("button", { name: "切换代码模式", exact: true })
        .click();
      await page.locator(".ace_editor").first().click();
      await page.keyboard.press("ControlOrMeta+A");
      await insert.click();
      await page
        .getByRole("button", { name: "纯文本模式", exact: true })
        .click();
      await expect(textarea).toHaveValue(
        "前文\n```\n选中代码\n```\n```\n\n```\n后文",
      );
      await textarea.fill("中文输入");
      await textarea.evaluate((node: HTMLTextAreaElement) => {
        node.focus();
        node.setSelectionRange(4, 4);
        node.dispatchEvent(new Event("select", { bubbles: true }));
        node.dispatchEvent(
          new CompositionEvent("compositionstart", {
            data: "法",
            bubbles: true,
          }),
        );
      });
      await insert.click();
      await expect(textarea).toHaveValue("中文输入");
      await textarea.evaluate((node: HTMLTextAreaElement) => {
        node.dispatchEvent(
          new CompositionEvent("compositionend", { data: "", bubbles: true }),
        );
      });
      await insert.click();
      const expected = "中文输入\n```\n\n```\n";
      await expect(textarea).toHaveValue(expected);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow).toBe(false);
      await page.screenshot({
        path: info.outputPath(`expanded-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "返回并保留草稿", exact: true })
        .click();
      await expect(editor).toHaveText(expected, { useInnerText: true });
      await page.reload();
      await expect(editor).toHaveText(expected, { useInnerText: true });
      expect(f.calls).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}
