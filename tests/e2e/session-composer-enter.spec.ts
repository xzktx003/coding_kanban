import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

async function setup(page: Page, behavior: string) {
  const fixture = await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  const composer = page.locator(".session-codex-composer").first();
  const editor = composer.locator("[contenteditable=true]").first();
  await composer
    .getByRole("button", { name: "输入状态与消息队列", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Enter 发送设置" })
    .getByRole("radio", { name: behavior, exact: true })
    .check();
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  return {
    fixture,
    editor,
    submitted: () => fixture.calls.filter((c) => c.path.endsWith("/submit")),
  };
}
test.describe("desktop Enter and browser composition", () => {
  test.use({
    viewport: { width: 1440, height: 1000 },
    hasTouch: false,
    isMobile: false,
  });
  for (const [label, ordinaryEnterSends] of [
    ["Enter 发送，Shift Enter 换行", true],
    ["多行时使用 Ctrl/⌘ Enter 发送", false],
    ["始终使用 Ctrl/⌘ Enter 发送", false],
  ] as const) {
    test(`${label}: multiline behavior, Shift newline and exactly one explicit submit`, async ({
      page,
    }) => {
      const { editor, submitted } = await setup(page, label);
      await editor.fill("中文第一行");
      await editor.press("End");
      await editor.press("Shift+Enter");
      await editor.press("a");
      expect(submitted()).toHaveLength(0);
      await expect(editor).toContainText("中文第一行");
      await expect(editor).toContainText("a");
      expect(await editor.innerText()).toContain("\n");
      await editor.fill("中文第一行\n第二行");
      await editor.press("Enter");
      if (!ordinaryEnterSends) {
        await page.waitForTimeout(100);
        expect(submitted()).toHaveLength(0);
        await expect(editor).toContainText("第二行");
        await editor.press("Control+Enter");
      }
      await expect.poll(() => submitted().length).toBe(1);
      expect(submitted()[0].body.threadId).toBe("ux-0");
      expect(submitted()[0].body.text).toContain("中文第一行");
      expect(submitted()[0].body.text).toContain("第二行");
    });
  }
  test("multiline-only modifier setting still sends a single line with Enter", async ({
    page,
  }) => {
    const { editor, submitted } = await setup(
      page,
      "多行时使用 Ctrl/⌘ Enter 发送",
    );
    await editor.fill("只有一行的中文需求");
    await editor.press("Enter");
    await expect.poll(() => submitted().length).toBe(1);
    expect(submitted()[0].body.text).toBe("只有一行的中文需求");
  });
  test("composing Enter and legacy 229 never submit; explicit send after composition delivers once", async ({
    page,
  }) => {
    const { editor, submitted } = await setup(
      page,
      "Enter 发送，Shift Enter 换行",
    );
    await editor.fill("输入法正在确认中文");
    await editor.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent("compositionstart", {
          bubbles: true,
          data: "中文",
        }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
    });
    await page.waitForTimeout(100);
    expect(submitted()).toHaveLength(0);
    await editor.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    await page.waitForTimeout(100);
    expect(submitted()).toHaveLength(0);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => submitted().length).toBe(1);
  });
});
test.describe("touch Return preserves multiline input", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("Return does not submit on touch; an external keyboard modifier submits once", async ({
    page,
  }) => {
    const { editor, submitted } = await setup(
      page,
      "Enter 发送，Shift Enter 换行",
    );
    await editor.fill("手机中文消息");
    await editor.press("End");
    await editor.press("Enter");
    await editor.press("a");
    expect(submitted()).toHaveLength(0);
    expect(await editor.innerText()).toContain("\n");
    await editor.press("Control+Enter");
    await expect.poll(() => submitted().length).toBe(1);
    expect(submitted()[0].body.text).toContain("手机中文消息");
  });
});
