import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import {
  installResizeDiagnostics,
  saveResizeDiagnostics,
} from "./resize-observer-diagnostics";

async function fitsViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await locator.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
}

async function controlsAreReachable(
  composer: Locator,
  info: TestInfo,
  phase: string,
) {
  const controls = await composer
    .locator(".session-composer-toolbar button:visible")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return {
          name:
            element.getAttribute("aria-label") ?? element.textContent?.trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          reachable: hit === element || element.contains(hit),
          interceptedBy: hit?.closest("button")?.getAttribute("aria-label"),
        };
      }),
    );
  await writeFile(
    info.outputPath(`controls-${phase}.json`),
    JSON.stringify(controls, null, 2),
  );
  expect(controls.filter((control) => !control.reachable)).toEqual([]);
}

for (const touch of [false, true])
  test.describe(touch ? "phone controls" : "360px desktop composer", () => {
    test.use({
      hasTouch: touch,
      isMobile: touch,
      viewport: { width: touch ? 390 : 1440, height: 900 },
    });
    for (const theme of ["light", "dark"])
      test(`capacity, native donut, all menus and mentions preserve geometry (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        await installResizeDiagnostics(page);
        const fixture = await installSessionUxFixture(page, 2);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route(/\/codex\/skills\/list$/, (route) =>
          route.fulfill({
            json: {
              data: [
                {
                  cwd: fixture.threads[0].cwd,
                  errors: [],
                  skills: [
                    {
                      name: "fixture-skill",
                      path: "/fixture/skill/SKILL.md",
                      description: "Long skill description for a narrow editor",
                      shortDescription: "隔离技能候选",
                      enabled: true,
                      scope: "user",
                      interface: null,
                    },
                  ],
                },
              ],
            },
          }),
        );
        await page.goto("/?mode=session");
        const composer = page.locator(".session-codex-composer").first();
        const editor = composer.locator("[contenteditable=true]").first();
        await editor.waitFor({ timeout: 60_000 });
        await seedSessionUx(page, 2);
        await page.evaluate(async (theme) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [{ useLayoutStore }, { useThemeStore }] = await Promise.all([
            module("/src/session-mode/stores/useLayoutStore.ts"),
            module("/src/session-mode/stores/settings/useThemeStore.ts"),
          ]);
          useLayoutStore.setState({
            isSidebarOpen: false,
            isRightPanelOpen: false,
          });
          useThemeStore.getState().setTheme(theme);
        }, theme);
        if (!touch)
          await page
            .locator(".session-composer-width")
            .evaluate((el) => ((el as HTMLElement).style.width = "360px"));
        await editor.fill("保留原会话草稿");
        const frame = composer.locator(".session-compact-frame");
        const originalHeight = (await frame.boundingBox())!.height;
        expect(originalHeight).toBe(124);
        await expect(
          composer.locator(".session-native-context-usage"),
        ).toHaveCount(0);
        await page.evaluate(async () => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          const modelsPath = "/src/session-mode/stores/useThreadModelStore.ts";
          const { useThreadModelStore, getThreadModelSettings } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === modelsPath)?.name ??
              modelsPath
          );
          useThreadModelStore.setState({
            threads: {
              "ux-0": {
                ...getThreadModelSettings("ux-0"),
                model: "gpt-fixture-long-model-identity-for-layout",
                reasoningEffort: "xhigh",
                revision: 1,
                pending: false,
              },
            },
          });
          const breakdown = (totalTokens: number) => ({
            totalTokens,
            inputTokens: totalTokens,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
          });
          useCodexStore.setState({
            tokenUsageMap: {
              "ux-0": {
                total: breakdown(1_000_000),
                last: breakdown(25_000),
                modelContextWindow: 100_000,
              },
              "ux-1": {
                total: breakdown(800_000),
                last: breakdown(75_000),
                modelContextWindow: null,
              },
            },
          });
        });
        const capacity = composer.getByRole("button", {
          name: "上下文用量：25%",
          exact: true,
        });
        await expect(capacity).toBeVisible();
        await controlsAreReachable(composer, info, "idle");
        expect(
          await capacity
            .locator("circle")
            .last()
            .getAttribute("stroke-dashoffset"),
        ).toBe("75");
        const iconBox = (await capacity.locator("svg").boundingBox())!;
        expect(iconBox.width).toBe(12);
        expect(iconBox.height).toBe(12);
        if (touch)
          expect((await capacity.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
        await capacity.click();
        const tooltip = page.getByRole("tooltip");
        await expect(tooltip).toContainText("背景信息窗口：");
        await expect(tooltip).toContainText("25% 已用（剩余 75%）");
        await expect(tooltip).toContainText("已用 25k 标记，共 100k");
        const visibleTooltip = page.locator(
          ".session-native-context-tooltip[data-slot=tooltip-content]",
        );
        const tooltipGeometry = {
          accessible: await tooltip.evaluate((el) => ({
            tag: el.tagName,
            width: el.clientWidth,
            scroll: el.scrollWidth,
            css: el.getAttribute("style"),
          })),
          visible: await visibleTooltip.evaluate((el) => ({
            tag: el.tagName,
            width: el.clientWidth,
            scroll: el.scrollWidth,
            css: el.getAttribute("style"),
          })),
        };
        await writeFile(
          info.outputPath("tooltip-geometry.json"),
          JSON.stringify(tooltipGeometry, null, 2),
        );
        await fitsViewport(page, visibleTooltip);
        await page.screenshot({
          path: info.outputPath(
            `capacity-${touch ? "phone" : "360-pane"}-${theme}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        for (const [trigger, menu] of [
          [
            composer.getByRole("button", { name: /^Agent 与模型：/ }),
            page.locator(".session-native-model-menu"),
          ],
          [
            composer.getByRole("button", { name: /^执行权限：/ }),
            page.locator(".session-native-permission-menu"),
          ],
          [
            composer.getByRole("button", {
              name: "添加附件与上下文",
              exact: true,
            }),
            page.locator(".session-composer-menu"),
          ],
        ] as const) {
          await trigger.click();
          await fitsViewport(page, menu);
          expect((await frame.boundingBox())!.height).toBe(originalHeight);
          await page.screenshot({
            path: info.outputPath(
              `menu-${menu === undefined ? "unknown" : await menu.getAttribute("class").then((value) => value!.split(" ").find((item) => item.startsWith("session-")))}-${touch ? "phone" : "360-pane"}-${theme}.png`,
            ),
            fullPage: true,
          });
          await page.keyboard.press("Escape");
        }
        await editor.fill("");
        await editor.pressSequentially("$fixture", { delay: 20 });
        await expect(editor).toHaveText("$fixture");
        const mentions = page.locator('[data-composer-suggestions="mentions"]');
        await fitsViewport(page, mentions);
        await expect(
          mentions.getByRole("option", { name: /fixture-skill/ }),
        ).toBeVisible();
        await mentions.getByRole("option", { name: /fixture-skill/ }).click();
        await expect(editor).toContainText("fixture-skill");
        expect((await frame.boundingBox())!.height).toBe(originalHeight);
        await page.evaluate(async () => {
          const path = "/src/session-mode/components/codex/stores/index.ts";
          const { useCodexStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useCodexStore.setState({
            currentTurnId: "narrow-active-turn",
            threadStatusMap: { "ux-0": { type: "active", activeFlags: [] } },
          });
        });
        await expect(
          composer.getByRole("button", { name: "停止生成", exact: true }),
        ).toBeVisible();
        await expect(
          composer.getByRole("button", { name: "排队消息", exact: true }),
        ).toBeVisible();
        await controlsAreReachable(composer, info, "running-long-model");
        expect((await frame.boundingBox())!.height).toBe(originalHeight);
        await page.screenshot({
          path: info.outputPath(
            `running-${touch ? "phone" : "360-pane"}-${theme}.png`,
          ),
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          fixture.calls.filter((call) =>
            /\/followups\/submit$|\/turn\/start$/.test(call.path),
          ),
        ).toEqual([]);
        await saveResizeDiagnostics(page, info);
        expect(errors).toEqual([]);
        await info.attach("control-geometry", {
          body: JSON.stringify({
            theme,
            touch,
            frame: await frame.boundingBox(),
            iconBox,
          }),
          contentType: "application/json",
        });
      });
  });
