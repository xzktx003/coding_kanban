import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 375])
  for (const theme of ["dark", "light"]) {
    test(`Fast bolt directly toggles the current thread (${width}px, ${theme})`, async ({
      page,
    }, info) => {
      const fixture = await installSessionUxFixture(page, 2);
      await page.route(/\/api\/(?:session\/)?codex\/model\/list$/, (route) =>
        route.fulfill({
          json: {
            data: [
              {
                id: "fixture-model",
                model: "fixture-model",
                displayName: "测试模型",
                description: "隔离模型",
                isDefault: true,
                hidden: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "low", description: "low" },
                  { reasoningEffort: "medium", description: "medium" },
                  { reasoningEffort: "high", description: "high" },
                ],
                defaultReasoningEffort: "medium",
                inputModalities: ["text"],
                supportsPersonality: false,
                additionalSpeedTiers: [],
                serviceTiers: [
                  { id: "standard", name: "标准模式", description: "默认速度" },
                  { id: "priority", name: "Fast", description: "使用更多额度" },
                ],
                defaultServiceTier: null,
              },
            ],
            nextCursor: null,
          },
        }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?mode=session");
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 2);
      await page.evaluate(
        async ({ theme, width }) => {
          const load = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const { useThreadModelStore, getThreadModelSettings } = await load(
            "/src/session-mode/stores/useThreadModelStore.ts",
          );
          const { useThemeStore } = await load(
            "/src/session-mode/stores/settings/useThemeStore.ts",
          );
          const { useLayoutStore } = await load(
            "/src/session-mode/stores/useLayoutStore.ts",
          );
          useThemeStore.getState().setTheme(theme);
          useLayoutStore.setState({ isSidebarOpen: width > 768 });
          useThreadModelStore.setState((s: any) => ({
            threads: {
              ...s.threads,
              "ux-0": {
                ...getThreadModelSettings("ux-0"),
                model: "fixture-model",
                modelProvider: "openai",
                reasoningEffort: "medium",
                serviceTier: null,
              },
              "ux-1": {
                ...getThreadModelSettings("ux-1"),
                serviceTier: "priority",
              },
            },
          }));
          (window as any).readFastOwners = () => [
            getThreadModelSettings("ux-0").serviceTier,
            getThreadModelSettings("ux-1").serviceTier,
          ];
        },
        { theme, width },
      );
      await page
        .locator(".session-codex-composer")
        .first()
        .getByRole("button", { name: /^模型：/ })
        .click();
      const menu = page.locator(".session-native-model-menu");
      await expect(
        menu.getByRole("slider", { name: "推理强度" }),
      ).toBeVisible();
      const off = menu.getByRole("menuitemcheckbox", {
        name: "启用快速模式",
        exact: true,
      });
      const on = menu.getByRole("menuitemcheckbox", {
        name: "启用标准模式",
        exact: true,
      });
      await expect(off).toHaveAttribute("aria-checked", "false");
      await off.click();
      await expect(on).toHaveAttribute("aria-checked", "true");
      await expect(on).not.toHaveAttribute("aria-haspopup");
      await expect(page.locator(".session-native-tier-menu")).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as any).readFastOwners()),
      ).toEqual(["priority", "priority"]);
      await menu.screenshot({
        path: info.outputPath(`fast-lit-${width}-${theme}.png`),
      });
      await on.focus();
      await on.press("Enter");
      await expect(off).toHaveAttribute("aria-checked", "false");
      expect(
        await page.evaluate(() => (window as any).readFastOwners()),
      ).toEqual([null, "priority"]);
      await menu.screenshot({
        path: info.outputPath(`fast-off-${width}-${theme}.png`),
      });
      await off.press("Space");
      await expect(on).toHaveAttribute("aria-checked", "true");
      await expect(page.locator(".session-native-tier-menu")).toHaveCount(0);
      expect(
        fixture.calls.filter((c) =>
          /\/(resume|start|stop|cancel|interrupt)$/.test(c.path),
        ),
      ).toEqual([]);
    });
  }

// Use the live model catalog while all thread/history/execution APIs remain fixtures.
test("the live native Fast catalog uses priority and still opens no submenu", async ({
  page,
}, info) => {
  test.skip(
    process.env.FAST_TOGGLE_LIVE_CATALOG !== "1",
    "Live catalog verification requires an explicitly selected gateway with native model access",
  );
  const response = await page.request.post(
    "/api/session/api/codex/model/list",
    { data: { limit: 100 } },
  );
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  const model = catalog.data.find((m: any) =>
    m.serviceTiers?.some((t: any) => t.id === "priority"),
  );
  expect(model).toBeTruthy();
  const fixture = await installSessionUxFixture(page, 2);
  await page.route(/\/api\/(?:session\/)?codex\/model\/list$/, (route) =>
    route.continue(),
  );
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async (modelId: string) => {
    const path = "/src/session-mode/stores/useThreadModelStore.ts";
    const { useThreadModelStore, getThreadModelSettings } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    useThreadModelStore.setState((s: any) => ({
      threads: {
        ...s.threads,
        "ux-0": {
          ...getThreadModelSettings("ux-0"),
          model: modelId,
          modelProvider: "openai",
          reasoningEffort: "medium",
          serviceTier: null,
        },
      },
    }));
    (window as any).readNativeFast = () =>
      getThreadModelSettings("ux-0").serviceTier;
  }, model.id);
  await page
    .locator(".session-codex-composer")
    .first()
    .getByRole("button", { name: /^模型：/ })
    .click();
  const menu = page.locator(".session-native-model-menu");
  await menu.getByRole("menuitemcheckbox", { name: "启用快速模式" }).click();
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "启用标准模式" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => (window as any).readNativeFast())).toBe(
    "priority",
  );
  await expect(page.locator(".session-native-tier-menu")).toHaveCount(0);
  await menu.screenshot({ path: info.outputPath("live-catalog-fast-lit.png") });
  await menu.getByRole("menuitemcheckbox", { name: "启用标准模式" }).click();
  expect(
    await page.evaluate(() => (window as any).readNativeFast()),
  ).toBeNull();
  await expect(
    menu.getByRole("menuitemcheckbox", { name: "启用快速模式" }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".session-native-tier-menu")).toHaveCount(0);
  expect(
    fixture.calls.filter((c) =>
      /\/(resume|start|stop|cancel|interrupt)$/.test(c.path),
    ),
  ).toEqual([]);
  await info.attach("live-fast-catalog.json", {
    body: JSON.stringify({ model: model.id, serviceTiers: model.serviceTiers }),
    contentType: "application/json",
  });
});
