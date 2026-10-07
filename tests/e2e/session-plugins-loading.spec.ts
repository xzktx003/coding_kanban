import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("plugin catalog failures show retry and retain prior navigation after failed refresh", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installSessionUxFixture(page, 0);
  let fail = true;
  let empty = false;
  await page.route("**/api/session/api/codex/plugin/list", async (route) => {
    if (fail)
      await route.fulfill({ status: 503, json: { error: "隔离插件目录离线" } });
    else
      await route.fulfill({
        json: {
          marketplaces: empty
            ? []
            : [
                {
                  name: "Fixture",
                  path: "/fixture/plugins",
                  plugins: [
                    {
                      id: "fixture-readonly",
                      name: "fixture-readonly",
                      installed: false,
                      enabled: false,
                      installPolicy: "available",
                      interface: {
                        displayName: "隔离插件",
                        shortDescription: "只读目录示例",
                        category: "开发",
                      },
                    },
                  ],
                },
              ],
          marketplaceLoadErrors: [],
        },
      });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await page.evaluate(async () => {
    const { usePluginsNavigationStore } =
      await import("/src/session-mode/stores/usePluginsNavigationStore.ts");
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    usePluginsNavigationStore.setState({ mainTab: "Plugins" });
    useLayoutStore.setState({ view: "plugins" });
  });
  await expect(page.getByRole("alert")).toContainText("隔离插件目录离线");
  await expect(page.getByText("暂无插件", { exact: true })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "重新加载插件" }).click();
  await expect(page.getByText("隔离插件", { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "插件目录操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "刷新插件", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("隔离插件目录离线");
  await expect(page.getByText("隔离插件", { exact: true })).toBeVisible();
  fail = false;
  empty = true;
  await page.getByRole("button", { name: "重新加载插件" }).click();
  await expect(page.getByText("暂无插件", { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 900, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const main = await page.locator(".session-mode").boundingBox();
    expect(main!.x + main!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({
      path: `.dev-runtime/session-ui-upgrade/plugins-empty-${viewport.width}.png`,
    });
  }
  expect(
    fixture.calls.filter((call) =>
      /plugin\/(install|uninstall)$/.test(call.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
