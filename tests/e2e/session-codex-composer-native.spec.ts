import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lU4AAAAASUVORK5CYII=";

for (const width of [1440, 390]) {
  test.describe(`native main composer ${width}`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"]) {
      test(`main surface, direct tools and native Enter settings (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90000);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
        await installSessionUxFixture(page);
        await page.route(/\/api\/(?:session\/)?codex\/model\/list$/, (route) =>
          route.fulfill({
            json: {
              data: ["fixture-model", "fixture-second"].map((id, i) => ({
                id,
                model: id,
                displayName: i ? "测试模型二" : "测试模型",
                description: "隔离原生菜单模型",
                isDefault: !i,
                hidden: false,
                supportedReasoningEfforts: (i
                  ? ["medium", "high"]
                  : ["low", "medium", "high"]
                ).map((reasoningEffort) => ({
                  reasoningEffort,
                  description: reasoningEffort,
                })),
                defaultReasoningEffort: "medium",
                inputModalities: ["text", "image"],
                supportsPersonality: false,
                additionalSpeedTiers: [],
                serviceTiers: i
                  ? []
                  : [{ id: "fast", name: "快速", description: "使用更多额度" }],
                defaultServiceTier: null,
              })),
              nextCursor: null,
            },
          }),
        );
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 30000 })
          .catch((e) => {
            throw new Error(`${e}\n${errors.join("\n")}`);
          });
        await seedSessionUx(page);
        await page.evaluate(async (mobile) => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const { useCodexStore } = await module(
            "/src/session-mode/components/codex/stores/index.ts",
          );
          const { useLayoutStore } = await module(
            "/src/session-mode/stores/useLayoutStore.ts",
          );
          const { useAgentCenterStore } = await module(
            "/src/session-mode/stores/useAgentCenterStore.ts",
          );
          const { getThreadModelSettings, useThreadModelStore } = await module(
            "/src/session-mode/stores/useThreadModelStore.ts",
          );
          const settings = getThreadModelSettings("ux-0");
          useThreadModelStore.setState((s) => ({
            threads: {
              ...s.threads,
              "ux-0": {
                ...settings,
                model: "fixture-model",
                modelProvider: "openai",
                providerModels: {
                  ...settings.providerModels,
                  openai: "fixture-model",
                },
                reasoningEffort: "high",
              },
            },
          }));
          useLayoutStore.setState({ isSidebarOpen: !mobile });
          useAgentCenterStore.setState({
            cards: [
              {
                kind: "codex",
                id: "ux-0",
                cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
                preview: "核对输入区",
              },
            ],
            currentAgentCardId: "ux-0",
          });
          useCodexStore.setState({
            historyLoadedMap: { "ux-0": true },
            events: {
              "ux-0": [
                {
                  method: "item/completed",
                  params: {
                    threadId: "ux-0",
                    turnId: "composer-proof",
                    item: {
                      id: "user",
                      type: "userMessage",
                      content: [
                        {
                          type: "text",
                          text: "请核对输入区与会话窗口的间距，并保留会话草稿。",
                        },
                      ],
                    },
                  },
                },
                {
                  method: "item/completed",
                  params: {
                    threadId: "ux-0",
                    turnId: "composer-proof",
                    item: {
                      id: "assistant",
                      type: "agentMessage",
                      text: "输入区保持独立，正文与图片按会话保存。\n\n可以直接展开编辑、听写或查看队列；切换标签后，草稿会留在原会话。",
                      phase: "final_answer",
                    },
                  },
                },
              ],
            },
          });
        }, width === 390);
        await page.evaluate(async (theme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const { useThemeStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useThemeStore.getState().setTheme(theme);
        }, theme);
        const composer = page.locator(".session-codex-composer").first();
        const surface = composer.locator(
          "[data-composer-layout=multiline][data-composer-radius-variant=default]",
        );
        await expect(surface).toBeVisible();
        await expect(
          composer.locator('[data-native-icon="plus-lg-light-16"]'),
        ).toBeVisible();
        await expect(
          composer.locator('[data-native-icon="arrow-up-md-light-16"]'),
        ).toBeVisible();
        await expect(
          composer.getByRole("button", { name: "展开编辑", exact: true }),
        ).toBeVisible();
        await expect(
          composer.getByRole("button", {
            name: "输入状态与消息队列",
            exact: true,
          }),
        ).toBeVisible();
        const editor = composer.locator("[contenteditable=true]").first();
        if (width === 390) {
          expect(
            await editor.evaluate((el) => el === document.activeElement),
          ).toBe(false);
          expect(
            await surface.evaluate((el) => el.getBoundingClientRect().height),
          ).toBe(124);
          const button = composer.getByRole("button", {
            name: "发送消息",
            exact: true,
          });
          expect(
            await button.evaluate((el) => el.getBoundingClientRect().height),
          ).toBeGreaterThanOrEqual(44);
        }
        await composer
          .getByRole("button", { name: "输入状态与消息队列", exact: true })
          .click();
        const settings = page.getByRole("group", { name: "Enter 发送设置" });
        await expect(settings.getByRole("radio")).toHaveCount(3);
        await settings
          .getByRole("radio", {
            name: "始终使用 Ctrl/⌘ Enter 发送",
            exact: true,
          })
          .click();
        await expect(
          settings.getByRole("radio", {
            name: "始终使用 Ctrl/⌘ Enter 发送",
            exact: true,
          }),
        ).toBeChecked();
        await page
          .getByRole("button", { name: "关闭面板", exact: true })
          .click();
        await editor.fill("第一行");
        await editor.press("Enter");
        await editor.press("A");
        await expect(editor).toContainText("第一行");
        await expect(editor).toContainText("A");
        const send = composer.getByRole("button", {
          name: "发送消息",
          exact: true,
        });
        await expect(send).toHaveCSS("border-radius", "9999px");
        expect(
          await send.evaluate((el) => getComputedStyle(el).color),
        ).not.toBe(
          await send.evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        await info.attach(`composer-${width}-${theme}-metrics.json`, {
          contentType: "application/json",
          body: JSON.stringify(
            await composer.evaluate((el) => {
              const props = (node: Element) => {
                const s = getComputedStyle(node),
                  b = node.getBoundingClientRect();
                return {
                  width: b.width,
                  height: b.height,
                  font: s.font,
                  color: s.color,
                  background: s.backgroundColor,
                  radius: s.borderRadius,
                  padding: s.padding,
                };
              };
              return {
                surface: props(el.querySelector(".session-compact-frame")!),
                editor: props(el.querySelector("[contenteditable]")!),
                buttons: [...el.querySelectorAll("button")].map((node) => ({
                  name: node.ariaLabel,
                  ...props(node),
                })),
              };
            }),
            null,
            2,
          ),
        });
        await composer.screenshot({
          path: info.outputPath(`composer-${width}-${theme}.png`),
        });
        await page.screenshot({
          path: info.outputPath(`composer-workbench-${width}-${theme}.png`),
          fullPage: true,
        });
        await composer.getByRole("button", { name: /^Agent 与模型：/ }).click();
        const modelMenu = page.locator(".session-native-model-menu");
        await expect(
          modelMenu.getByRole("slider", { name: "推理强度" }),
        ).toBeVisible();
        if (width === 390)
          await expect
            .poll(() =>
              modelMenu
                .getByRole("slider", { name: "推理强度" })
                .evaluate((el) => el.getBoundingClientRect().height),
            )
            .toBeGreaterThanOrEqual(44);
        await expect
          .poll(() =>
            modelMenu.evaluate((el) => el.getBoundingClientRect().width),
          )
          .toBe(224);
        await expect(
          modelMenu.locator(".session-native-power-track"),
        ).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(modelMenu).toHaveCSS("border-radius", "20px");
        await modelMenu.screenshot({
          path: info.outputPath(`composer-model-simple-${width}-${theme}.png`),
        });
        await page.screenshot({
          path: info.outputPath(
            `composer-workbench-model-simple-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        await modelMenu
          .getByRole("menuitemcheckbox", { name: "启用快速模式", exact: true })
          .click();
        await expect(
          modelMenu.getByRole("menuitemcheckbox", {
            name: "启用标准模式",
            exact: true,
          }),
        ).toHaveAttribute("aria-checked", "true");
        await modelMenu
          .getByRole("menuitem", { name: "选择模型", exact: true })
          .click();
        await expect(modelMenu.getByRole("menuitemradio")).toHaveCount(2);
        await modelMenu.screenshot({
          path: info.outputPath(
            `composer-model-advanced-${width}-${theme}.png`,
          ),
        });
        await modelMenu
          .getByRole("menuitemradio", { name: "测试模型二", exact: true })
          .click();
        await expect(
          modelMenu.getByRole("slider", { name: "推理强度" }),
        ).toHaveAttribute("aria-valuenow", "1");
        await modelMenu.press("Escape");
        await expect(
          composer.getByRole("button", {
            name: "Agent 与模型：Codex，fixture-second，high",
          }),
        ).toBeVisible();
        await composer
          .getByRole("button", {
            name: "当前 Agent：Codex，切换 Agent",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Agent 与提供商设置",
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(
            `composer-workbench-agent-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "关闭面板", exact: true })
          .click();
        await composer.getByRole("button", { name: /^执行权限：/ }).click();
        const permissions = page.locator(".session-native-permission-menu");
        await expect(
          permissions.getByRole("menuitemradio", { name: /^帮我批准/ }),
        ).toBeDisabled();
        await permissions.screenshot({
          path: info.outputPath(`composer-permissions-${width}-${theme}.png`),
        });
        await page.screenshot({
          path: info.outputPath(
            `composer-workbench-permissions-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        await permissions
          .getByRole("menuitemradio", { name: /^请求批准/ })
          .click();
      });
    }
    test("left image thumbnails, direct deletion and long paste keep the draft owner", async ({
      page,
    }, info) => {
      test.setTimeout(60000);
      await installSessionUxFixture(page);
      let releaseUpload!: () => void;
      const uploadGate = new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      let uploadStarted = false;
      await page.route("**/api/session/files/upload", async (route) => {
        uploadStarted = true;
        await uploadGate;
        await route.fulfill({ json: { path: "/fixture/upload.png" } });
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto("/?mode=session");
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page);
      const composer = page.locator(".session-codex-composer").first();
      const editor = composer.locator("[contenteditable=true]").first();
      await editor.fill("保存当前草稿");
      await editor.evaluate((el, data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const clipboardData = new DataTransfer();
        clipboardData.items.add(
          new File([bytes], "composer-image.png", { type: "image/png" }),
        );
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData,
          }),
        );
      }, png);
      await expect(composer.locator('[data-state="uploading"]')).toBeVisible();
      const uploadHeight = await composer
        .locator(".session-compact-frame")
        .evaluate((el) => el.getBoundingClientRect().height);
      const uploadingComposerHeight = await composer.evaluate(
        (el) => el.getBoundingClientRect().height,
      );
      await expect.poll(() => uploadStarted).toBe(true);
      await page.screenshot({
        path: info.outputPath(`composer-workbench-${width}-uploading.png`),
        fullPage: true,
      });
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.setState({ currentThreadId: "ux-1" });
      });
      await expect(
        composer.locator(".session-context-chip.is-image"),
      ).toHaveCount(0);
      releaseUpload();
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.setState({ currentThreadId: "ux-0" });
      });
      const thumb = composer.getByRole("button", {
        name: "预览 composer-image.png",
        exact: true,
      });
      await expect(thumb).toBeVisible();
      expect(
        await composer
          .locator(".session-compact-frame")
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(uploadHeight);
      expect(
        await composer.evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(uploadingComposerHeight);
      const img = thumb.locator("img");
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      expect(
        await thumb.evaluate((el) => el.getBoundingClientRect().right),
      ).toBeLessThanOrEqual(
        await editor.evaluate((el) => el.getBoundingClientRect().left),
      );
      await composer.screenshot({
        path: info.outputPath(`composer-${width}-image.png`),
      });
      await page.screenshot({
        path: info.outputPath(`composer-workbench-${width}-image.png`),
        fullPage: true,
      });
      if (width === 390) {
        const footer = page.locator(
          ".session-composer-target-container:has(.session-native-composer) > .session-workspace-switcher",
        );
        await expect(footer).toHaveCSS("height", "48px");
        for (const name of [/^项目：/, /^工作目录模式：/, /^Git 分支：/])
          await expect(footer.getByRole("button", { name })).toBeVisible();
      }
      await composer
        .getByRole("button", { name: "移除 composer-image.png", exact: true })
        .click();
      await expect(thumb).toHaveCount(0);
      await editor.evaluate((el) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "完整长文".repeat(600));
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData,
          }),
        );
      });
      await expect(
        composer.getByRole("button", { name: /查看上下文 粘贴的文本/ }),
      ).toBeVisible();
      await expect(editor).toHaveText("保存当前草稿");
      if (width === 390)
        expect(
          await composer
            .locator(".session-compact-frame")
            .evaluate((el) => el.getBoundingClientRect().height),
        ).toBe(124);
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.setState({ currentThreadId: "ux-1" });
      });
      await expect(editor).toHaveText("");
      await expect(
        composer.getByRole("button", { name: /查看上下文 粘贴的文本/ }),
      ).toHaveCount(0);
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.setState({ currentThreadId: "ux-0" });
      });
      await expect(editor).toHaveText("保存当前草稿");
      await expect(
        composer.getByRole("button", { name: /查看上下文 粘贴的文本/ }),
      ).toBeVisible();
    });
  });
}
