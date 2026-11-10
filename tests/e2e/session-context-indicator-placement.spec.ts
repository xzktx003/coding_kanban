import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const touch of [false, true]) {
  test.describe(touch ? "phone" : "desktop pane", () => {
    test.use({ hasTouch: touch, isMobile: touch });
    for (const theme of ["light", "dark"] as const) {
      test(`context indicator stays reachable in a narrow ${touch ? "phone" : "desktop pane"} (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: touch ? 390 : 1440, height: 900 });
        const fixture = await installSessionUxFixture(page, 1);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        const composer = page.locator(".session-codex-composer").first();
        const editor = composer.locator("[contenteditable=true]").first();
        await editor.waitFor({ timeout: 90_000 });
        await seedSessionUx(page, 1);
        await page.evaluate(async (theme) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const [
            { useCodexStore },
            { useAgentCenterStore },
            { useThemeStore },
          ] = await Promise.all([
            module("/src/session-mode/components/codex/stores/index.ts"),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/settings/useThemeStore.ts"),
          ]);
          useAgentCenterStore.setState({
            cards: [
              {
                kind: "codex",
                id: "ux-0",
                cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
                preview: "上下文测试",
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
              "ux-0": {
                total: usage,
                last: usage,
                modelContextWindow: 100_000,
              },
            },
          });
          useThemeStore.getState().setTheme(theme);
        }, theme);
        if (!touch) {
          await page.locator(".session-composer-width").evaluate((element) => {
            (element as HTMLElement).style.width = "360px";
          });
        }
        await editor.fill("保留原会话草稿");
        const context = composer.getByRole("button", {
          name: "上下文用量：25%",
        });
        await expect(context).toBeVisible();
        await expect(
          composer.locator(
            ".session-composer-actions > .session-native-context-usage",
          ),
        ).toBeVisible();
        const ring = (await context.boundingBox())!;
        const text = (await editor.boundingBox())!;
        expect(ring.width).toBe(44);
        expect(ring.height).toBe(44);
        expect(ring.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
        expect(
          await context
            .locator("circle")
            .last()
            .getAttribute("stroke-dashoffset"),
        ).toBe("75");
        const controls = await composer
          .locator(".session-composer-toolbar button:visible")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
              return {
                name: button.getAttribute("aria-label"),
                disabled: (button as HTMLButtonElement).disabled,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                reachable: hit === button || button.contains(hit),
              };
            }),
          );
        expect(
          controls.filter((control) => !control.disabled && !control.reachable),
        ).toEqual([]);
        for (let left = 0; left < controls.length; left++) {
          for (let right = left + 1; right < controls.length; right++) {
            const a = controls[left],
              b = controls[right];
            const overlapX =
              Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY =
              Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            expect(
              overlapX > 0.5 && overlapY > 0.5,
              `${a.name} overlaps ${b.name}`,
            ).toBe(false);
          }
        }
        await context.click();
        await expect(page.getByRole("tooltip")).toContainText(
          "25% 已用（剩余 75%）",
        );
        await expect(editor).toHaveText("保留原会话草稿");
        await page.screenshot({
          path: info.outputPath(
            `context-${touch ? "phone" : "pane"}-${theme}.png`,
          ),
        });
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /\/(?:resume|turn\/start|turn\/steer|rollback|fork)$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
      });
    }
  });
}
