import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const width of [375, 1440]) {
  test(`new chat shows and sends its catalog default before the first message (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await setup(page, false);
    const starts: Array<Record<string, unknown>> = [];
    await page.route("**/api/codex/thread/start", async (route) => {
      starts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: { error: "isolated fixture: creation stopped" },
      });
    });
    try {
      await page
        .locator("[data-session-group]")
        .getByRole("button", { name: "新聊天", exact: true })
        .click();
      const composer = page.locator(".session-native-composer");
      await expect(composer).not.toHaveAttribute("data-owner-thread", /.+/);
      await page.evaluate(async () => {
        const path =
          "/src/session-mode/components/codex/stores/useConfigStore.ts";
        const url =
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path;
        const { useConfigStore } = await import(url);
        useConfigStore.setState({
          model: "",
          modelProvider: "openai",
          providerModels: {},
          reasoningEffort: "medium",
        });
      });
      await expect(
        composer.getByText("测试模型", { exact: true }),
      ).toBeVisible();
      await composer
        .locator("[contenteditable=true]")
        .fill("isolated model initialization test");
      await composer
        .getByRole("button", { name: "发送消息", exact: true })
        .click();
      await expect.poll(() => starts.length).toBe(1);
      expect(starts[0]).toMatchObject({ model: "fixture-model" });
      expect(fixture.calls).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
}
