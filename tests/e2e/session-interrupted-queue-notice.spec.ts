import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`queued acceptance follows the interrupted state at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const fixture = await setup(page);
    try {
      const composer = page.locator(
        '.session-native-composer[data-owner-thread="ux-0"]',
      );
      const editor = composer.locator('[contenteditable="true"]').first();
      await editor.fill("你好");
      await composer
        .getByRole("button", { name: "加入队列", exact: true })
        .click();
      await expect
        .poll(async () => (await fixture.queue.get("ux-0")).items.length)
        .toBe(1);
      await expect(
        composer.getByText("消息已接收，请查看当前会话进度"),
      ).toBeVisible();
      expect(
        fixture.calls.filter((call) => call.method === "turn/interrupt"),
      ).toHaveLength(0);

      await composer
        .getByRole("button", { name: "停止生成", exact: true })
        .click();
      await expect
        .poll(
          () =>
            fixture.calls.filter((call) => call.method === "turn/interrupt")
              .length,
        )
        .toBe(1);
      await fixture.event("turn/completed", "initial-turn", "interrupted");
      await expect(
        composer.getByText("消息已接收，队列已暂停；请查看待发送消息"),
      ).toBeVisible();
      await expect(composer.getByText("消息已接收，将按顺序发送")).toHaveCount(
        0,
      );
      expect(
        (await fixture.queue.get("ux-0")).items.map((item) => item.text),
      ).toEqual(["你好"]);
      expect(
        fixture.calls.filter((call) => call.method === "turn/start"),
      ).toHaveLength(0);
      expect(
        fixture.calls.filter((call) => call.method === "turn/interrupt"),
      ).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}
