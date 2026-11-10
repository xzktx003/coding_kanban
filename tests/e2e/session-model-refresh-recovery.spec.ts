import { expect, test, type Request } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const freshModel = {
  id: "fresh-model",
  model: "fresh-model",
  displayName: "刷新后的模型",
  description: "隔离测试模型",
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: "标准推理" },
  ],
  defaultReasoningEffort: "medium",
};

test("refreshing a stalled model catalog shows new models and preserves the draft", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 0);
  const heldRequests = new Set<Request>();
  const releases: Array<() => void> = [];
  let reads = 0;
  let aborted = 0;
  page.on("requestfailed", (request) => {
    if (heldRequests.has(request)) aborted++;
  });
  await page.route("**/api/codex/model/list", async (route) => {
    reads++;
    if (reads <= 2) {
      heldRequests.add(route.request());
      await new Promise<void>((resolve) => releases.push(resolve));
      await route
        .fulfill({ json: { data: [], nextCursor: null } })
        .catch(() => {});
      return;
    }
    await route.fulfill({
      json: {
        data: [freshModel],
        nextCursor: null,
      },
    });
  });

  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page.locator(".session-mode [contenteditable=true]").first();
    await editor.waitFor();
    await seedSessionUx(page, 0);
    await page.evaluate(async () => {
      const path =
        "/src/session-mode/components/codex/stores/useConfigStore.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const { useConfigStore } = await import(url);
      useConfigStore.getState().setModelSelectionMode("follow-config");
    });
    await editor.fill("刷新期间保留的草稿");
    await expect.poll(() => reads).toBe(1);

    await page
      .getByRole("button", { name: /^跟随配置/ })
      .first()
      .click();
    await expect.poll(() => reads).toBe(2);
    await page.getByRole("menuitem", { name: "刷新配置与模型" }).click();
    await expect.poll(() => reads).toBe(3);
    await expect.poll(() => aborted).toBe(2);
    await page.getByRole("menuitem", { name: "选择模型", exact: true }).click();
    await expect(
      page.getByRole("menuitemradio").filter({ hasText: "刷新后的模型" }),
    ).toBeVisible();
    await expect(editor).toHaveText("刷新期间保留的草稿");
    expect(
      fixture.calls.filter((call) =>
        /\/(?:thread\/start|turn\/start|turn\/interrupt|turn\/steer)$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    for (const release of releases) release();
  }
});

for (const width of [375, 1440]) {
  test.describe(`catalog failure at ${width}px`, () => {
    test.use({
      viewport: { width, height: 900 },
      hasTouch: width === 375,
      isMobile: width === 375,
    });
    test("offers retry without reporting a usage limit", async ({ page }) => {
      const fixture = await installSessionUxFixture(page, 0);
      let reads = 0;
      let allowSuccess = false;
      await page.route("**/api/codex/model/list", (route) => {
        reads++;
        return allowSuccess
          ? route.fulfill({ json: { data: [freshModel], nextCursor: null } })
          : route.fulfill({ status: 503, json: { error: "模型目录暂不可用" } });
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      const editor = page
        .locator(".session-mode [contenteditable=true]")
        .first();
      await editor.waitFor();
      await seedSessionUx(page, 0, { sidebarOpen: false });
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
          modelSelectionMode: "manual",
        });
      });
      await editor.fill("重试期间保留的草稿");
      await page.getByRole("button", { name: "模型目录不可用" }).click();
      const menu = page.locator(".session-native-model-menu");
      await expect(menu.getByRole("alert")).toContainText("模型目录暂不可用");
      await expect(menu).not.toContainText("用量已达上限");
      const readsBeforeRetry = reads;
      allowSuccess = true;
      const retry = menu.getByRole("menuitem", { name: "重试" });
      if (width === 375) {
        const box = await retry.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(
          await retry.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              ),
            );
          }),
        ).toBe(true);
      }
      await retry.click();
      await expect.poll(() => reads).toBeGreaterThan(readsBeforeRetry);
      await expect(menu.getByRole("alert")).toHaveCount(0);
      await expect(editor).toHaveText("重试期间保留的草稿");
      expect(
        fixture.calls.filter((call) =>
          /\/(?:thread\/start|turn\/start|turn\/interrupt|turn\/steer)$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
    });
  });
}
