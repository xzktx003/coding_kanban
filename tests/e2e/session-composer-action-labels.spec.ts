import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { composerAction } from "./session-composer-actions";

for (const width of [1440, 390])
  test(`main and expanded submit names follow the actual action (${width})`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page, false);
    try {
      const editor = page
        .locator(".session-composer-editor [contenteditable=true]")
        .first();
      const main = page.locator(".session-composer-send");
      await expect(main).toHaveAccessibleName("发送消息");
      await expect(main).toHaveAttribute("title", "发送消息");
      await fixture.event("turn/started", "action-label-turn", "inProgress");
      await expect(
        page.getByRole("button", { name: "停止生成", exact: true }),
      ).toBeVisible();
      await expect(main).toHaveCount(0);
      await editor.fill("保留这份草稿，不发送任务");
      await expect(main).toHaveAccessibleName("加入队列");
      await expect(main).toHaveAttribute("title", "加入队列");
      await composerAction(page, "展开编辑");
      await expect(
        page.locator(".session-expanded-submit"),
      ).toHaveAccessibleName("加入队列");
      await page
        .getByRole("button", { name: "返回并保留草稿", exact: true })
        .click();
      await page.getByRole("button", { name: "附加文件", exact: true }).click();
      await page
        .getByLabel("运行中发送方式", { exact: true })
        .selectOption("steer");
      await page.keyboard.press("Escape");
      await expect(
        page.getByLabel("运行中发送方式", { exact: true }),
      ).toBeHidden();
      await expect(main).toHaveAccessibleName("引导当前任务");
      await expect(main).toHaveAttribute("title", "引导当前任务");
      await composerAction(page, "展开编辑");
      await expect(
        page.locator(".session-expanded-submit"),
      ).toHaveAccessibleName("引导当前任务");
      await page
        .getByRole("button", { name: "返回并保留草稿", exact: true })
        .click();
      await fixture.event("turn/completed", "action-label-turn", "completed");
      await expect(main).toHaveAccessibleName("发送消息");
      await expect(editor).toHaveText("保留这份草稿，不发送任务");
      expect(fixture.calls).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
