import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const width of [1440, 390])
  test.describe(`${width}px account`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    for (const theme of ["dark", "light"])
      test(`native limits and config notices preserve exact reads (${theme})`, async ({
        page,
      }, info) => {
        test.setTimeout(90_000);
        const fixture = await installSessionUxFixture(page);
        await page.addInitScript(() => {
          const sources: any[] = [];
          (window as any).__accountSources = sources;
          (window as any).__accountSequence = 0;
          (window as any).EventSource = class {
            readyState = 1;
            onopen: any = null;
            onmessage: any = null;
            onerror: any = null;
            constructor(public url: string) {
              sources.push(this);
              queueMicrotask(() => this.onopen?.(new Event("open")));
            }
            close() {
              this.readyState = 2;
            }
          };
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        let unavailable = false,
          signedIn = true,
          accountOffline = false,
          runtimeInstance = "ux-fixture",
          loginCount = 0,
          cancelUnknown = true;
        const requests: Array<{ path: string; body: any }> = [];
        const bucket = {
          limitId: "codex",
          limitName: "Codex",
          primary: { usedPercent: 23, windowDurationMins: 120, resetsAt: null },
          secondary: null,
          credits: null,
          individualLimit: null,
          spendControlReached: null,
          planType: "plus",
          rateLimitReachedType: null,
        };
        await page.route(
          "**/api/session/api/codex/account/get",
          async (route) => {
            requests.push({
              path: "account/get",
              body: route.request().postDataJSON(),
            });
            await route.fulfill({
              status: accountOffline ? 503 : 200,
              json: {
                ...(accountOffline
                  ? { error: "fixture account unavailable" }
                  : {}),
                account: signedIn
                  ? {
                      type: "chatgpt",
                      email: "fixture@example.invalid",
                      planType: "plus",
                    }
                  : null,
                requiresOpenaiAuth: true,
              },
            });
          },
        );
        await page.route("**/api/session/health", (route) =>
          route.fulfill({
            json: {
              status: "ok",
              instance: runtimeInstance,
              capabilities: { acpImages: true, codexAccountMutationsV1: true },
              entries: [],
            },
          }),
        );
        await page.route(
          "**/api/session/api/codex/account/login",
          async (route) => {
            requests.push({
              path: "account/login",
              body: route.request().postDataJSON(),
            });
            await route.fulfill({
              json: {
                type: "chatgptDeviceCode",
                loginId: `fixture-own-login-${++loginCount}`,
                verificationUrl: "https://example.invalid/device",
                userCode: "FIXTURE-ONLY",
              },
            });
          },
        );
        await page.route(
          "**/api/session/api/codex/account/login/cancel",
          async (route) => {
            requests.push({
              path: "account/login/cancel",
              body: route.request().postDataJSON(),
            });
            await route.fulfill(
              cancelUnknown
                ? {
                    status: 502,
                    json: { error: "fixture cancel receipt unknown" },
                  }
                : { json: { status: "canceled" } },
            );
          },
        );
        await page.route(
          "**/api/session/api/codex/account/logout",
          async (route) => {
            requests.push({
              path: "account/logout",
              body: route.request().postDataJSON(),
            });
            await route.fulfill({
              status: 502,
              json: { error: "fixture logout receipt unknown" },
            });
          },
        );
        await page.route(
          "**/api/session/api/codex/account/rate-limits",
          async (route) => {
            requests.push({ path: "account/rate-limits", body: null });
            await route.fulfill(
              unavailable
                ? { status: 503, json: { error: "fixture quota unavailable" } }
                : {
                    json: {
                      rateLimits: bucket,
                      rateLimitsByLimitId: {
                        codex: bucket,
                        special: {
                          ...bucket,
                          limitId: "special",
                          limitName: "gpt_special",
                          primary: {
                            usedPercent: 99,
                            windowDurationMins: 10080,
                            resetsAt: null,
                          },
                        },
                      },
                      rateLimitResetCredits: null,
                    },
                  },
            );
          },
        );
        await page.goto("/usage?mode=session", {
          waitUntil: "domcontentloaded",
        });
        await page.locator("#usage-panel").waitFor({ timeout: 60_000 });
        const moduleState = async () =>
          page.evaluate(async (theme) => {
            const path = "/src/session-mode/stores/settings/useThemeStore.ts";
            const url =
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path;
            const { useThemeStore } = await import(url);
            useThemeStore.getState().setTheme(theme);
          }, theme);
        await moduleState();
        const quota = page.locator(".codex-native-usage");
        await expect(quota).toContainText("剩余 77%");
        await expect(quota).toContainText("2 小时额度");
        await expect(quota).toContainText("7 天额度");
        await expect(quota).toContainText("gpt-special");
        if (width === 390)
          expect(
            (await quota
              .getByRole("button", { name: "刷新 Codex 额度" })
              .boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: info.outputPath(`quota-page-${width}-${theme}.png`),
          fullPage: true,
        });
        unavailable = true;
        signedIn = false;
        await quota.getByRole("button", { name: "刷新 Codex 额度" }).click();
        await expect(quota).toContainText("fixture quota unavailable");
        await expect(quota).not.toContainText("剩余 77%");
        await expect(
          quota.getByRole("button", { name: "登录 ChatGPT" }),
        ).toBeVisible();
        expect(
          requests.filter((request) =>
            /login|logout|consume/.test(request.path),
          ),
        ).toHaveLength(0);
        await page.screenshot({
          path: info.outputPath(`quota-unavailable-page-${width}-${theme}.png`),
          fullPage: true,
        });
        signedIn = true;
        await page.route("**/api/session/api/filesystem/codex-home", (route) =>
          route.fulfill({ json: "/fixture/.codex" }),
        );
        await page.route(
          "**/api/session/api/filesystem/read-text-file",
          async (route) => {
            requests.push({
              path: "filesystem/read-text-file",
              body: route.request().postDataJSON(),
            });
            await route.fulfill({ json: "first\n世界a\nlast" });
          },
        );
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        await page
          .locator(".session-codex-composer [contenteditable=true]")
          .first()
          .waitFor({ timeout: 60_000 });
        await seedSessionUx(page);
        await moduleState();
        const openAccountMenu = async () => {
          const button = page.getByRole("button", {
            name: "账户与登录",
            exact: true,
          });
          if (!(await button.isVisible()))
            await page.locator(".session-global-projects").click();
          await button.click();
        };
        unavailable = false;
        await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const url =
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path;
          const { useLayoutStore } = await import(url);
          useLayoutStore.setState({ isSidebarOpen: true });
        });
        await openAccountMenu();
        await page
          .getByRole("button", { name: "使用情况", exact: true })
          .click();
        const accountDialog = page.getByRole("dialog", {
          name: "使用情况",
          exact: true,
        });
        await expect(
          accountDialog.locator(".codex-native-usage"),
        ).toContainText("剩余 77%");
        await page.screenshot({
          path: info.outputPath(`account-entry-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(accountDialog).toHaveCount(0);
        if (width === 390) await page.keyboard.press("Escape");
        await page.evaluate(async () => {
          const module = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const { observeConfigNotice } = await module(
            "/src/session-mode/features/codex-account/config-notices.ts",
          );
          observeConfigNotice({
            method: "configWarning",
            params: {
              summary: "原生配置提示",
              details: "请使用 `safe` 配置。",
              path: "/fixture/owner.toml",
              range: {
                start: { line: 2, column: 1 },
                end: { line: 2, column: 3 },
              },
            },
          });
          observeConfigNotice({
            method: "deprecationNotice",
            params: { summary: "旧配置已弃用", details: "按原始说明迁移。" },
          });
          const { useLayoutStore } = await module(
            "/src/session-mode/stores/useLayoutStore.ts",
          );
          useLayoutStore.getState().setView("settings");
        });
        if (width === 390) {
          await page
            .getByRole("combobox")
            .filter({ hasText: "通用" })
            .first()
            .click({ timeout: 10_000 });
          await page
            .getByRole("option", { name: "Codex: 配置", exact: true })
            .click();
        } else
          await page.getByRole("button", { name: "配置", exact: true }).click();
        const notices = page.locator(".codex-native-config-notices");
        await expect(notices).toContainText("原生配置提示");
        await expect(notices).toContainText("旧配置已弃用");
        await expect(notices.getByRole("alert")).toHaveCount(2);
        const glyph = await notices
          .locator("svg")
          .first()
          .evaluate((svg) => ({
            viewBox: svg.getAttribute("viewBox"),
            paths: Array.from(svg.querySelectorAll("path")).map((path) =>
              path.getAttribute("d"),
            ),
          }));
        if (reference) {
          const native = await page.context().newPage();
          await native.setViewportSize({ width, height: 600 });
          await native.goto(reference);
          await native.waitForFunction(() => (window as any).nativeLoaded);
          await native.evaluate(async (theme) => {
            document.documentElement.dataset.theme = theme;
            const color = theme === "dark" ? "#ccc" : "#3b3b3b";
            document.body.style.color = color;
            document.body.style.background =
              theme === "dark" ? "#20211d" : "#fff";
            document.documentElement.style.setProperty(
              "--vscode-foreground",
              color,
            );
            const modules =
              await import("./native/assets/app-initial-e98b9eaef8e3.js");
            modules.Vd();
            (window as any).renderNativeElement(modules.Bd, {});
          }, theme);
          await expect(native.locator("#root svg")).toBeVisible();
          expect(glyph).toEqual(
            await native.locator("#root svg").evaluate((svg) => ({
              viewBox: svg.getAttribute("viewBox"),
              paths: Array.from(svg.querySelectorAll("path")).map((path) =>
                path.getAttribute("d"),
              ),
            })),
          );
          await native.screenshot({
            path: info.outputPath(`native-config-glyph-${width}-${theme}.png`),
            fullPage: true,
          });
          await native.evaluate(
            async ({ width, theme }) => {
              const card =
                  await import("./native/assets/app-initial-3192ac99b6cd.js"),
                glyph =
                  await import("./native/assets/app-initial-e98b9eaef8e3.js");
              card.cX();
              glyph.Vd();
              document.getElementById("root")!.style.width =
                `${width > 600 ? 616 : width - 32}px`;
              const React = (window as any).nativeModules.React;
              const content = React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  "p",
                  { style: { margin: 0 } },
                  "原生配置提示",
                ),
                React.createElement(
                  "p",
                  { style: { margin: 0 } },
                  "请使用 safe 配置。",
                ),
                React.createElement(
                  "p",
                  { style: { margin: 0 } },
                  "文件: /fixture/owner.toml:2:1",
                ),
              );
              (window as any).renderNativeElement(card.sX, {
                content,
                Icon: glyph.Bd,
                onPrimaryCtaClick: () => {},
                primaryCtaText: "打开文件",
                role: "alert",
                type: "warning",
              });
            },
            { width, theme },
          );
          await expect(native.locator("aside[role=alert]")).toBeVisible();
          const metrics = (element: Element) => {
            const style = getComputedStyle(element),
              button = getComputedStyle(element.querySelector("button")!);
            return {
              radius: style.borderRadius,
              padding: style.padding,
              font: style.fontSize,
              lineHeight: style.lineHeight,
              buttonRadius: button.borderRadius,
              buttonPadding: button.padding,
              buttonFont: button.fontSize,
              buttonLine: button.lineHeight,
            };
          };
          const expected = await native
              .locator("aside[role=alert]")
              .evaluate(metrics),
            actual = await notices.getByRole("alert").first().evaluate(metrics);
          expect(actual).toEqual(expected);
          await info.attach(`config-notice-metrics-${width}-${theme}`, {
            body: JSON.stringify({ actual, expected }),
            contentType: "application/json",
          });
          await native.screenshot({
            path: info.outputPath(`native-config-notice-${width}-${theme}.png`),
            fullPage: true,
          });
          await native.close();
        }
        await page.screenshot({
          path: info.outputPath(`config-notices-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await notices
          .getByRole("button", { name: "打开文件", exact: true })
          .click();
        const preview = page.getByRole("dialog");
        await expect(preview.locator('[data-config-line="2"] mark')).toHaveText(
          "世界",
        );
        expect(
          requests
            .filter((request) => request.path === "filesystem/read-text-file")
            .at(-1)?.body,
        ).toEqual({ filePath: "/fixture/owner.toml" });
        expect(
          await preview
            .locator("textarea,input,[contenteditable=true]")
            .count(),
        ).toBe(0);
        await page.screenshot({
          path: info.outputPath(`config-readonly-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(preview).toHaveCount(0);
        await page
          .getByRole("button", { name: "返回会话", exact: true })
          .click();

        const emitAccount = async (method: string, params: unknown) =>
          page.evaluate(
            ({ method, params }) => {
              const data = JSON.stringify({
                seq: ++(window as any).__accountSequence,
                event: "codex:notification",
                payload: { method, params },
              });
              for (const source of (window as any).__accountSources)
                if (source.readyState === 1)
                  source.onmessage?.(new MessageEvent("message", { data }));
            },
            { method, params },
          );
        await openAccountMenu();
        await page
          .getByRole("button", { name: "Add Account", exact: true })
          .click();
        const auth = page.getByRole("dialog", {
          name: "ChatGPT Login",
          exact: true,
        });
        await auth
          .getByRole("button", { name: "登录 ChatGPT", exact: true })
          .click();
        await expect(auth).toContainText("FIXTURE-ONLY");
        await emitAccount("account/login/completed", {
          loginId: "fixture-foreign-login",
          success: true,
          error: null,
        });
        await expect(auth).toContainText("FIXTURE-ONLY");
        expect(
          requests.filter((request) => request.path === "account/login"),
        ).toHaveLength(1);
        await page.screenshot({
          path: info.outputPath(`auth-owned-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await emitAccount("account/login/completed", {
          loginId: "fixture-own-login-1",
          success: true,
          error: null,
        });
        await expect(auth).toHaveCount(0);
        await openAccountMenu();
        await page
          .getByRole("button", { name: "Add Account", exact: true })
          .click();
        await auth
          .getByRole("button", { name: "登录 ChatGPT", exact: true })
          .click();
        await expect(auth).toContainText("FIXTURE-ONLY");
        runtimeInstance = "ux-fixture-next";
        await emitAccount("account/login/completed", {
          loginId: "fixture-own-login-2",
          success: true,
          error: null,
        });
        await expect(auth).toContainText("运行实例已改变");
        await expect(auth).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`auth-stale-page-${width}-${theme}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(auth).toHaveCount(0);
        await openAccountMenu();
        await page
          .getByRole("button", { name: "Add Account", exact: true })
          .click();
        await auth
          .getByRole("button", { name: "登录 ChatGPT", exact: true })
          .click();
        await expect(auth).toContainText("FIXTURE-ONLY");
        await auth
          .getByRole("button", { name: "取消本次登录", exact: true })
          .click();
        await expect(auth).toContainText("不会重复发送");
        await expect(
          auth.getByRole("button", { name: "取消本次登录", exact: true }),
        ).toBeDisabled();
        expect(
          requests.filter((request) => request.path === "account/login/cancel"),
        ).toEqual([
          {
            path: "account/login/cancel",
            body: {
              loginId: "fixture-own-login-3",
              runtimeInstance: "ux-fixture-next",
            },
          },
        ]);
        await page.screenshot({
          path: info.outputPath(
            `auth-cancel-uncertain-page-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(auth).toHaveCount(0);
        cancelUnknown = false;
        await openAccountMenu();
        await page
          .getByRole("button", { name: "Add Account", exact: true })
          .click();
        await auth
          .getByRole("button", { name: "登录 ChatGPT", exact: true })
          .click();
        await expect(auth).toContainText("FIXTURE-ONLY");
        await auth
          .getByRole("button", { name: "取消本次登录", exact: true })
          .click();
        await expect(auth).toContainText("已取消本次登录");
        await expect(auth).not.toContainText("FIXTURE-ONLY");
        await page.keyboard.press("Escape");
        await expect(auth).toHaveCount(0);

        await openAccountMenu();
        await page
          .getByRole("button", { name: "退出当前 Codex 账户", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "退出当前 Codex 账户",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "检查退出状态", exact: true }),
        ).toBeVisible();
        expect(
          requests.filter((request) => request.path === "account/logout"),
        ).toEqual([
          {
            path: "account/logout",
            body: {
              runtimeInstance: "ux-fixture-next",
              expectedAccount: {
                type: "chatgpt",
                email: "fixture@example.invalid",
                planType: "plus",
              },
            },
          },
        ]);
        await page.screenshot({
          path: info.outputPath(`logout-uncertain-page-${width}-${theme}.png`),
          fullPage: true,
        });
        signedIn = false;
        await page
          .getByRole("button", { name: "检查退出状态", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "检查退出状态", exact: true }),
        ).toHaveCount(0);
        await expect(auth).toHaveCount(0);
        expect(
          requests.filter((request) => request.path === "account/logout"),
        ).toHaveLength(1);
        accountOffline = true;
        const failedAccountRead = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/codex/account/get") &&
            response.status() === 503,
        );
        // A fresh offline mount starts unknown. Do not erase the preceding
        // authoritative signed-out observation while its consumers settle.
        await page.reload({ waitUntil: "domcontentloaded" });
        await (await failedAccountRead).finished();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await expect
          .poll(() =>
            page.evaluate(async () => {
              const path =
                "/src/session-mode/components/codex/stores/useCodexStore.ts";
              const url =
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path;
              const { useCodexStore } = await import(url);
              return useCodexStore.getState().hasAccount;
            }),
          )
          .toBeNull();
        await expect(auth).toHaveCount(0);
        expect(
          requests.filter((request) => request.path === "account/login"),
        ).toHaveLength(4);
        expect(
          fixture.calls.filter((call) =>
            /write-file|turn\/(start|steer|interrupt)|thread\/resume|account\/login/.test(
              call.path,
            ),
          ),
        ).toHaveLength(0);
        expect(errors).toEqual([]);
      });
  });
