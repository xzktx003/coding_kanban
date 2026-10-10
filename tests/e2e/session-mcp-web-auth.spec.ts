import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 390])
  test.describe(`${width}px MCP browser auth`, () => {
    test.use({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const theme of ["light", "dark"])
      test(`OAuth notifications and refresh release the real management UI (${theme})`, async ({
        page,
        context,
      }, info) => {
        test.setTimeout(60_000);
        const fixture = await installSessionUxFixture(page, 1);
        await page.addInitScript(() => {
          const sources: any[] = [];
          Object.assign(window, { __mcpSources: sources, __mcpSequence: 0 });
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
        let authorized = false;
        const authCalls: unknown[] = [],
          statusCalls: unknown[] = [];
        await page.route(/\/codex\/mcp\/read$/, (route) =>
          route.fulfill({
            json: {
              mcpServers: {
                "fixture-oauth": {
                  type: "http",
                  url: "https://fixture.invalid/mcp",
                  enabled: true,
                },
                "fixture-stdio": {
                  type: "stdio",
                  command: "fixture-not-executed",
                  args: [],
                  enabled: false,
                },
              },
            },
          }),
        );
        await page.route(/\/codex\/mcp\/status\/list$/, (route) => {
          statusCalls.push(route.request().postDataJSON());
          return route.fulfill({
            json: {
              data: [
                {
                  name: "fixture-oauth",
                  authStatus: authorized ? "oAuth" : "notLoggedIn",
                  serverInfo: null,
                  tools: {},
                  resources: [],
                  resourceTemplates: [],
                },
                {
                  name: "fixture-stdio",
                  authStatus: "unsupported",
                  serverInfo: null,
                  tools: {},
                  resources: [],
                  resourceTemplates: [],
                },
              ],
              nextCursor: null,
            },
          });
        });
        await page.route(/\/codex\/mcp\/oauth\/login$/, (route) => {
          authCalls.push(route.request().postDataJSON());
          return route.fulfill({
            json: { authorizationUrl: "https://fixture.invalid/authorize" },
          });
        });
        await context.route("https://fixture.invalid/authorize", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<title>Isolated OAuth browser fixture</title><p>No real account was contacted.</p>",
          }),
        );
        await page.goto("/?mode=session");
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        await editor.waitFor({ timeout: 60_000 });
        await seedSessionUx(page, 1);
        await editor.fill("MCP 设置保留原草稿");
        await page.evaluate(async (theme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const { useThemeStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useThemeStore.getState().setTheme(theme);
        }, theme);
        const tools = page.getByRole("button", {
          name: "工具与技能",
          exact: true,
        });
        if (await tools.isVisible()) await tools.click();
        else {
          await page
            .getByRole("button", { name: "更多功能", exact: true })
            .click();
          await page
            .getByRole("menuitem", { name: "工具与技能", exact: true })
            .click();
        }
        await page
          .getByRole("button", {
            name: "Manage plugins and tools",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: "Connectors", exact: true }),
        ).toBeVisible();
        const authorize = page.getByRole("button", {
          name: "Authorize",
          exact: true,
        });
        await expect(authorize).toHaveCount(1); // stdio has no OAuth action.
        await expect(authorize).toBeEnabled();
        await page.screenshot({
          path: info.outputPath(`mcp-manage-${width}-${theme}.png`),
          fullPage: true,
        });
        const card = page
          .locator('[data-slot="card"]')
          .filter({ has: authorize });
        const layout = await card.evaluate((element) => {
          const details = element.querySelector(
            '[data-slot="card-content"] > div',
          )!;
          const rgb = (color: string) =>
            color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                const s = v / 255;
                return s <= 0.04045
                  ? s / 12.92
                  : Math.pow((s + 0.055) / 1.055, 2.4);
              });
          const lum = (color: string) => {
            const [r, g, b] = rgb(color);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const a = lum(getComputedStyle(details).color),
            b = lum(getComputedStyle(element).backgroundColor);
          const badge = element.querySelector('[data-slot="badge"]')!;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const paint = (colors: string[]) => {
            ctx.clearRect(0, 0, 1, 1);
            for (const color of colors) {
              ctx.fillStyle = color;
              ctx.fillRect(0, 0, 1, 1);
            }
            const data = ctx.getImageData(0, 0, 1, 1).data;
            return lum(`rgb(${data[0]},${data[1]},${data[2]})`);
          };
          const badgeStyle = getComputedStyle(badge),
            cardColor = getComputedStyle(element).backgroundColor;
          const badgeBg = paint([cardColor, badgeStyle.backgroundColor]),
            badgeFg = paint([
              cardColor,
              badgeStyle.backgroundColor,
              badgeStyle.color,
            ]);
          const title =
            element.querySelector(".session-mcp-server-name") ??
            element.querySelector('[data-slot="card-title"] > span')!;
          const node = [...title.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          );
          const range = document.createRange();
          if (node) range.selectNodeContents(node);
          const nameLines = new Set(
            [...range.getClientRects()].map((r) => Math.round(r.y)),
          ).size;
          const switches = [
            ...element.querySelectorAll<HTMLButtonElement>(
              '[data-slot="switch"]',
            ),
          ].map((button) => {
            const root = button.getBoundingClientRect(),
              thumb = button
                .querySelector('[data-slot="switch-thumb"]')!
                .getBoundingClientRect();
            return {
              left: thumb.left - root.left,
              right: thumb.right - root.left,
            };
          });
          const controls = [
            ...element.querySelectorAll<HTMLButtonElement>(
              '[data-slot="card-header"] button',
            ),
          ].map((button) => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return {
              width: rect.width,
              height: rect.height,
              hit: button === hit || button.contains(hit),
            };
          });
          return {
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            badgeContrast:
              (Math.max(badgeBg, badgeFg) + 0.05) /
              (Math.min(badgeBg, badgeFg) + 0.05),
            nameLines,
            controls,
            switches,
          };
        });
        await writeFile(
          info.outputPath("mcp-layout-receipt.json"),
          JSON.stringify(layout, null, 2),
        );
        expect(layout.contrast).toBeGreaterThanOrEqual(4.5);
        expect(layout.badgeContrast).toBeGreaterThanOrEqual(4.5);
        expect(layout.nameLines).toBe(1);
        if (width === 390)
          for (const thumb of layout.switches) {
            expect(thumb.left).toBeGreaterThanOrEqual(6);
            expect(thumb.right).toBeLessThanOrEqual(38);
          }
        if (width === 390)
          for (const control of layout.controls) {
            expect(control.width).toBeGreaterThanOrEqual(44);
            expect(control.height).toBeGreaterThanOrEqual(44);
            expect(control.hit).toBe(true);
          }
        const popupPromise = page.waitForEvent("popup");
        await authorize.click();
        const popup = await popupPromise;
        await popup.waitForLoadState();
        await popup.close();
        await expect(authorize).toBeDisabled();
        expect(authCalls).toEqual([
          {
            name: "fixture-oauth",
            threadId: null,
            scopes: null,
            timeoutSecs: 120,
          },
        ]);
        const emit = async (name: string, success: boolean) =>
          page.evaluate(
            ({ name, success }) => {
              const windowState = window as any;
              const envelope = {
                seq: ++windowState.__mcpSequence,
                event: "codex:notification",
                payload: {
                  method: "mcpServer/oauthLogin/completed",
                  params: {
                    name,
                    threadId: null,
                    success,
                    error: success ? undefined : "fixture denial",
                  },
                },
              };
              for (const source of windowState.__mcpSources)
                if (
                  source.readyState === 1 &&
                  source.url.includes("/api/events")
                )
                  source.onmessage?.({ data: JSON.stringify(envelope) });
            },
            { name, success },
          );
        await emit("other-server", true);
        await expect(authorize).toBeDisabled();
        authorized = true;
        await emit("fixture-oauth", true);
        await expect(authorize).toHaveCount(0);
        await expect(page.getByText("OAuth", { exact: true })).toBeVisible();
        if (width === 390) {
          const notice = page
            .locator("[data-sonner-toast]")
            .filter({ hasText: 'Authorized "fixture-oauth"' });
          await expect(notice).toBeVisible();
          // Sonner deliberately animates in from below the viewport. Audit the
          // settled surface, rather than capturing an intermediate animation.
          await expect
            .poll(
              async () =>
                (await notice.boundingBox())!.y +
                (await notice.boundingBox())!.height,
            )
            .toBeLessThanOrEqual(828);
          const geometry = await notice.evaluate((element) => {
            const rect = element.getBoundingClientRect(),
              close = element.querySelector<HTMLButtonElement>(
                "[data-close-button]",
              )!;
            const closeRect = close.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              bottom: rect.bottom,
              viewport: innerHeight,
              closeWidth: closeRect.width,
              closeHeight: closeRect.height,
              closeBackground: getComputedStyle(close).backgroundColor,
              visibleClose: {
                width: getComputedStyle(close, "::before").width,
                height: getComputedStyle(close, "::before").height,
              },
              position: element.parentElement!.getAttribute("data-y-position"),
              styles: {
                top: getComputedStyle(element.parentElement!).top,
                bottom: getComputedStyle(element.parentElement!).bottom,
              },
            };
          });
          await writeFile(
            info.outputPath("mcp-toast-layout-receipt.json"),
            JSON.stringify(geometry, null, 2),
          );
          expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport - 16);
          expect(geometry.closeWidth).toBeGreaterThanOrEqual(44);
          expect(geometry.closeHeight).toBeGreaterThanOrEqual(44);
          expect(geometry.closeBackground).toBe("rgba(0, 0, 0, 0)");
          expect(geometry.visibleClose).toEqual({
            width: "20px",
            height: "20px",
          });
        }
        await page.screenshot({
          path: info.outputPath(`mcp-authorized-${width}-${theme}.png`),
          fullPage: true,
        });
        if (width === 390 && theme === "light") {
          const notice = page.locator("[data-sonner-toast]").filter({
            hasText: 'Authorized "fixture-oauth"',
          });
          await notice.locator("[data-close-button]").click();
          await expect(notice).toHaveCount(0);
          expect(authCalls).toHaveLength(1);
        }
        // Read-only startup notification can reconcile a later credential change.
        authorized = false;
        await page.evaluate(() => {
          const state = window as any;
          for (const source of state.__mcpSources)
            if (source.readyState === 1 && source.url.includes("/api/events"))
              source.onmessage?.({
                data: JSON.stringify({
                  seq: ++state.__mcpSequence,
                  event: "codex:notification",
                  payload: {
                    method: "mcpServer/startupStatus/updated",
                    params: { name: "fixture-oauth", status: "ready" },
                  },
                }),
              });
        });
        await expect(authorize).toBeEnabled();
        expect(authCalls).toHaveLength(1); // Refresh never starts OAuth.
        const returnButton = page.getByRole("button", {
          name: "返回会话",
          exact: true,
        });
        expect(
          await returnButton.evaluate((button) => {
            const r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return hit === button || button.contains(hit);
          }),
        ).toBe(true);
        await page
          .getByRole("button", { name: "返回会话", exact: true })
          .click();
        await expect(editor).toHaveText("MCP 设置保留原草稿");
        await expect(
          page.getByText("Complete the authorization in your browser", {
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByText('Authorized "fixture-oauth"', { exact: true }),
        ).toHaveCount(0);
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((call) =>
            /\/turn\/start$|\/followups\/submit$|\/thread\/resume$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await writeFile(
          info.outputPath("mcp-web-auth-receipt.json"),
          JSON.stringify(
            { width, theme, authCalls, statusCalls, errors },
            null,
            2,
          ),
        );
      });
  });
