import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const theme of ["light", "dark"] as const) {
  test(`model picker keeps the native chart colors and selected range (${theme})`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const fixture = await installSessionUxFixture(page, 1);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/(?:session\/)?codex\/model\/list$/, (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: "fixture-model",
              model: "fixture-model",
              displayName: "GPT Fixture",
              description: "Isolated model picker fixture",
              isDefault: true,
              hidden: false,
              supportedReasoningEfforts: [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
                "ultra",
              ].map((reasoningEffort) => ({
                reasoningEffort,
                description: reasoningEffort,
              })),
              defaultReasoningEffort: "medium",
              inputModalities: ["text"],
              supportsPersonality: false,
              additionalSpeedTiers: [],
              serviceTiers: [],
              defaultServiceTier: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-codex-composer [contenteditable=true]")
      .first()
      .waitFor({ timeout: 90_000 });
    await seedSessionUx(page, 1);
    await page.evaluate(async (theme) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const { useThemeStore } = await module(
        "/src/session-mode/stores/settings/useThemeStore.ts",
      );
      const { useNativeModelPickerPreferencesStore } = await module(
        "/src/session-mode/stores/settings/useNativeModelPickerPreferencesStore.ts",
      );
      const { ensureThreadModelSettings, hydrateThreadModel } = await module(
        "/src/session-mode/stores/useThreadModelStore.ts",
      );
      const { useCodexStore } = await module(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useAgentCenterStore } = await module(
        "/src/session-mode/stores/useAgentCenterStore.ts",
      );
      useThemeStore.getState().setTheme(theme);
      useNativeModelPickerPreferencesStore.getState().setSelectionMode("model");
      useAgentCenterStore.setState({
        cards: [
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "颜色测试",
          },
        ],
        currentAgentCardId: "ux-0",
        currentAgentCardKind: "codex",
        cardsViewMode: "solo",
      });
      const usage = {
        totalTokens: 25_000,
        inputTokens: 25_000,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
      };
      useCodexStore.setState({
        currentThreadId: "ux-0",
        tokenUsageMap: {
          "ux-0": { total: usage, last: usage, modelContextWindow: 100_000 },
        },
      });
      await ensureThreadModelSettings("ux-0");
      hydrateThreadModel("ux-0", {
        model: "fixture-model",
        modelProvider: "openai",
        reasoningEffort: "max",
        serviceTier: null,
      });
    }, theme);
    const trigger = page.getByRole("button", { name: /^模型：/ });
    const context = page.getByRole("button", { name: "上下文用量：25%" });
    await expect(context).toBeVisible();
    const contextBox = (await context.boundingBox())!;
    const triggerBox = (await trigger.boundingBox())!;
    expect(Math.abs(contextBox.y - triggerBox.y)).toBeLessThanOrEqual(1);
    expect(
      triggerBox.x - (contextBox.x + contextBox.width),
    ).toBeGreaterThanOrEqual(0);
    expect(
      triggerBox.x - (contextBox.x + contextBox.width),
    ).toBeLessThanOrEqual(8);
    await trigger.click();
    const menu = page.locator(".session-native-model-menu");
    const range = menu.locator(".session-native-power-range");
    const label = menu.locator(".session-native-power-effort");
    const dots = menu.locator(".session-native-power-dot");
    await expect(range).toBeVisible({ timeout: 30_000 });
    await expect(label).toHaveText("Max");
    await expect(dots).toHaveCount(6);
    await expect(range).toHaveCSS("background-color", "rgb(51, 156, 255)");
    await expect(label).toHaveCSS("color", "rgb(51, 156, 255)");
    expect((await range.boundingBox())!.width).toBeCloseTo(152.2, 0);
    await expect(dots.nth(4)).toHaveAttribute("data-selected", "true");
    await expect(dots.nth(5)).toHaveAttribute("data-selected", "false");
    expect(
      await dots
        .nth(4)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe(
      await dots
        .nth(5)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await menu.screenshot({
      path: info.outputPath(`model-picker-${theme}.png`),
    });

    await menu.getByRole("menuitem", { name: "强度" }).press("ArrowLeft");
    await expect(label).toHaveText("极高");
    expect((await range.boundingBox())!.width).toBeCloseTo(117.4, 0);
    await expect(dots.nth(4)).toHaveAttribute("data-selected", "false");

    await page.evaluate(() =>
      document.documentElement.style.setProperty(
        "--vscode-charts-blue",
        "#569cd6",
      ),
    );
    await expect(range).toHaveCSS("background-color", "rgb(86, 156, 214)");
    await expect(label).toHaveCSS("color", "rgb(86, 156, 214)");
    expect(errors).toEqual([]);
    expect(
      fixture.calls.filter((call) =>
        /\/(?:resume|turn\/start|turn\/steer|rollback|fork)$/.test(call.path),
      ),
    ).toEqual([]);
  });
}
