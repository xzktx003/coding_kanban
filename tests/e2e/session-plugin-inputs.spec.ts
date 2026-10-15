import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
for (const { width, theme } of [
  { width: 1440, theme: "dark" },
  { width: 1440, theme: "light" },
  { width: 390, theme: "dark" },
  { width: 390, theme: "light" },
] as const)
  test.describe(`${width}px ${theme} typed plugin input`, () => {
    test.use({ hasTouch: width === 390, isMobile: width === 390 });
    test("install refreshes mounted candidates; Try now guard and captured native identity survive submission", async ({
      page,
    }, info) => {
      test.setTimeout(60_000);
      const fixture = await installSessionUxFixture(page, 2);
      const geometry: Array<Record<string, unknown>> = [];
      const activate = (target: Locator) =>
        width === 390 ? target.tap() : target.click();
      const checkTarget = async (target: Locator, name: string) => {
        await expect(target).toBeVisible();
        if (width === 1440) await page.mouse.move(width - 2, 842);
        await expect
          .poll(() =>
            target.evaluate((element) =>
              element
                .getAnimations()
                .every(
                  (animation) =>
                    animation.playState !== "running" && !animation.pending,
                ),
            ),
          )
          .toBe(true);
        const metrics = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            centerHit: Boolean(
              hit && (element === hit || element.contains(hit)),
            ),
            font: style.font,
            color: style.color,
            background: style.backgroundColor,
            hovered: element.matches(":hover"),
            coarsePointer: matchMedia("(pointer: coarse)").matches,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          };
        });
        geometry.push({ name, ...metrics });
        await writeFile(
          info.outputPath("plugin-touch-metrics.json"),
          JSON.stringify({ width, theme, geometry }, null, 2),
        );
        expect.soft(metrics.centerHit, `${name} true center hit`).toBe(true);
        if (width === 390) {
          expect
            .soft(metrics.width, `${name} touch width`)
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(metrics.height, `${name} touch height`)
            .toBeGreaterThanOrEqual(44);
        }
        expect.soft(metrics.x, `${name} left bound`).toBeGreaterThanOrEqual(0);
        expect
          .soft(metrics.x + metrics.width, `${name} right bound`)
          .toBeLessThanOrEqual(width);
        return metrics;
      };
      let installed = false;
      const plugin = {
        id: "fixture-native@fixture",
        name: "fixture-native@fixture",
        source: { type: "local", path: "/fixture/plugins" },
        installed: false,
        enabled: true,
        keywords: [],
        installPolicy: "available",
        interface: {
          displayName: "Fixture Plugin",
          shortDescription: "Isolated typed plugin identity",
          composerIconUrl:
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'/>",
        },
      };
      const catalog = () => ({
        marketplaces: [
          {
            name: "Fixture",
            path: "/fixture/plugins",
            plugins: [{ ...plugin, installed }],
          },
        ],
        marketplaceLoadErrors: [],
      });
      const pluginCalls: Array<{ path: string; body: any }> = [];
      await page.route(/\/plugin\/(list|installed|install|read)$/, (route) => {
        const path = new URL(route.request().url()).pathname;
        pluginCalls.push({ path, body: route.request().postDataJSON() });
        if (path.endsWith("/install")) {
          installed = true;
          return route.fulfill({ json: { appsNeedingAuth: [] } });
        }
        if (path.endsWith("/read"))
          return route.fulfill({
            json: {
              plugin: {
                marketplaceName: "Fixture",
                marketplacePath: "/fixture/plugins",
                summary: { ...plugin, installed },
                skills: [],
                hooks: [],
                apps: [],
                appTemplates: [],
                mcpServers: [],
                scheduledTasks: null,
              },
            },
          });
        return route.fulfill({ json: catalog() });
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/?mode=session");
      await page
        .locator(".session-codex-composer [contenteditable=true]")
        .first()
        .waitFor({ timeout: 60000 });
      await seedSessionUx(page, 2);
      await page.evaluate(async (theme) => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [
          { useAgentCenterStore },
          { useLayoutStore },
          { useSessionDraftStore, sessionDraftKey },
          { useCodexStore },
          { usePluginsNavigationStore },
          { registerSessionLeaveGuard },
          { useThemeStore },
        ] = await Promise.all([
          module("/src/session-mode/stores/useAgentCenterStore.ts"),
          module("/src/session-mode/stores/useLayoutStore.ts"),
          module("/src/session-mode/stores/useSessionDraftStore.ts"),
          module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
          module("/src/session-mode/stores/usePluginsNavigationStore.ts"),
          module("/src/session-mode/services/sessionNavigationGuard.ts"),
          module("/src/session-mode/stores/settings/useThemeStore.ts"),
        ]);
        useThemeStore.getState().setTheme(theme);
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          },
          { activate: false },
        );
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-1",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          },
          { activate: true },
        );
        useCodexStore.setState({
          currentThreadId: "ux-1",
          historyLoadedMap: { "ux-0": true, "ux-1": true },
        });
        useSessionDraftStore
          .getState()
          .setText(sessionDraftKey("codex", "ux-0"), "Original A");
        useSessionDraftStore
          .getState()
          .setText(sessionDraftKey("codex", "ux-1"), "Original B");
        usePluginsNavigationStore.setState({ mainTab: "Plugins" });
        useLayoutStore.setState({ view: "plugins", isSidebarOpen: false });
        (window as any).pluginGuardDirty = true;
        (window as any).releasePluginGuard = registerSessionLeaveGuard(() => ({
          dirty: (window as any).pluginGuardDirty,
          saving: false,
        }));
      }, theme);
      await expect(
        page.getByTitle("Install Fixture Plugin", { exact: true }),
      ).toBeVisible();
      const readsBeforeInstall = pluginCalls.filter((call) =>
        call.path.endsWith("/installed"),
      ).length;
      const installCard = page.getByTitle("Install Fixture Plugin", {
        exact: true,
      });
      await checkTarget(installCard, "card-install");
      await page.screenshot({
        path: info.outputPath(`plugin-catalog-${width}-${theme}.png`),
        fullPage: true,
      });
      await activate(page.getByText("Fixture Plugin", { exact: true }).first());
      const installDetail = page.getByRole("button", {
        name: "Install",
        exact: true,
      });
      await checkTarget(installDetail, "detail-install");
      const detailBack = page.getByRole("button", {
        name: "Plugin",
        exact: true,
      });
      await checkTarget(detailBack, "detail-back");
      await page.screenshot({
        path: info.outputPath(
          `plugin-detail-uninstalled-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
      await activate(detailBack);
      await activate(installCard);
      await expect(
        page.getByTitle("Use Fixture Plugin", { exact: true }),
      ).toBeVisible();
      const notice = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Plugin installed" });
      await expect(notice).toBeVisible();
      await expect(notice).toHaveAttribute("data-mounted", "true");
      await expect
        .poll(() =>
          notice.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.y >= 16 &&
              rect.bottom <= innerHeight - 16 &&
              element
                .getAnimations()
                .every(
                  (animation) =>
                    animation.playState !== "running" && !animation.pending,
                )
            );
          }),
        )
        .toBe(true);
      const returnToChat = page.getByRole("button", {
        name: "返回会话",
        exact: true,
      });
      const noticeMetrics = await notice.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const close = element.querySelector<HTMLButtonElement>(
          "[data-close-button]",
        )!;
        const closeRect = close.getBoundingClientRect();
        const closeStyle = getComputedStyle(close);
        const circle = getComputedStyle(close, "::before");
        const root = element.closest<HTMLElement>(".session-mode")!;
        const probe = document.createElement("span");
        probe.style.cssText =
          "position:fixed;visibility:hidden;pointer-events:none;background:var(--background);color:var(--foreground)";
        root.append(probe);
        const expected = {
          background: getComputedStyle(probe).backgroundColor,
          color: getComputedStyle(probe).color,
        };
        probe.remove();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
          background: style.backgroundColor,
          color: style.color,
          expected,
          position: element.parentElement!.getAttribute("data-y-position"),
          closeWidth: closeRect.width,
          closeHeight: closeRect.height,
          closeBackground: closeStyle.backgroundColor,
          closeCircle: { width: circle.width, height: circle.height },
        };
      });
      const returnMetrics = await returnToChat.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerHit: Boolean(hit && (element === hit || element.contains(hit))),
        };
      });
      await writeFile(
        info.outputPath("plugin-notice-metrics.json"),
        JSON.stringify({ width, theme, noticeMetrics, returnMetrics }, null, 2),
      );
      expect
        .soft(returnMetrics.centerHit, "return while install toast visible")
        .toBe(true);
      expect
        .soft(
          noticeMetrics.background,
          "normal toast current Session background",
        )
        .toBe(noticeMetrics.expected.background);
      expect
        .soft(noticeMetrics.color, "normal toast current Session foreground")
        .toBe(noticeMetrics.expected.color);
      if (width === 390) {
        expect.soft(noticeMetrics.position).toBe("bottom");
        expect.soft(noticeMetrics.closeWidth).toBe(44);
        expect.soft(noticeMetrics.closeHeight).toBe(44);
        expect.soft(noticeMetrics.closeBackground).toBe("rgba(0, 0, 0, 0)");
        expect
          .soft(noticeMetrics.closeCircle)
          .toEqual({ width: "20px", height: "20px" });
      }
      await page.screenshot({
        path: info.outputPath(`plugin-installed-toast-${width}-${theme}.png`),
        fullPage: true,
      });
      if (returnMetrics.centerHit) {
        await activate(returnToChat);
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await activate(
          page.getByRole("button", { name: "继续编辑", exact: true }),
        );
      }
      await activate(notice.locator("[data-close-button]"));
      await expect(notice).toHaveCount(0);
      await expect
        .poll(
          () =>
            pluginCalls.filter((call) => call.path.endsWith("/installed"))
              .length,
        )
        .toBeGreaterThan(readsBeforeInstall);
      const useCard = page.getByTitle("Use Fixture Plugin", { exact: true });
      await checkTarget(useCard, "card-use");
      await activate(page.getByText("Fixture Plugin", { exact: true }).first());
      const useDetail = page.getByRole("button", {
        name: "Try now",
        exact: true,
      });
      await checkTarget(useDetail, "detail-use");
      await checkTarget(
        page.getByRole("button", { name: "Uninstall", exact: true }),
        "detail-uninstall",
      );
      const detailMetrics = await useDetail.evaluate((element) => {
        const header = element.closest(".session-plugin-detail-header")!;
        const detail = header.parentElement!;
        const body = header.nextElementSibling!;
        const headerRect = header.getBoundingClientRect();
        const detailRect = detail.getBoundingClientRect();
        const style = getComputedStyle(detail);
        return {
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          headerX: headerRect.x,
          detailX: detailRect.x,
          bodyGap: body.getBoundingClientRect().top - headerRect.bottom,
        };
      });
      await writeFile(
        info.outputPath("plugin-detail-spacing.json"),
        JSON.stringify({ width, theme, detailMetrics }, null, 2),
      );
      if (width === 390) {
        expect.soft(detailMetrics.paddingLeft).toBe("16px");
        expect.soft(detailMetrics.paddingRight).toBe("16px");
        expect.soft(detailMetrics.headerX - detailMetrics.detailX).toBe(16);
        expect.soft(detailMetrics.bodyGap).toBe(16);
      }
      await page.screenshot({
        path: info.outputPath(`plugin-detail-installed-${width}-${theme}.png`),
        fullPage: true,
      });
      await activate(useDetail);
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await activate(
        page.getByRole("button", { name: "继续编辑", exact: true }),
      );
      await expect(useDetail).toBeVisible();
      await activate(detailBack);
      await page.evaluate(() => {
        (window as any).pluginGuardDirty = false;
      });
      const manage = page.getByTitle("Manage plugins and tools", {
        exact: true,
      });
      await checkTarget(manage, "manage-entry");
      await activate(manage);
      await expect(
        page.getByRole("button", { name: "Connectors", exact: true }),
      ).toBeVisible();
      await checkTarget(
        page.getByRole("button", { name: "Connectors", exact: true }),
        "manage-connectors",
      );
      await activate(
        page.getByRole("button", { name: "Connectors", exact: true }),
      );
      await checkTarget(
        page.getByRole("button", { name: "Skills", exact: true }),
        "manage-skills",
      );
      const manageBack = page.locator("button:not([aria-label])").filter({
        has: page.locator("svg.lucide-arrow-left"),
        hasText: width === 390 ? /^$/ : /^Plugin$/,
      });
      await checkTarget(manageBack, "manage-back");
      await page.screenshot({
        path: info.outputPath(`plugin-manage-${width}-${theme}.png`),
        fullPage: true,
      });
      await activate(manageBack);
      await expect(useCard).toBeVisible();
      await page.evaluate(() => {
        (window as any).pluginGuardDirty = true;
      });
      await activate(useCard);
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await activate(
        page.getByRole("button", { name: "继续编辑", exact: true }),
      );
      const before = await page.evaluate(async () => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [
          { useAgentCenterStore },
          { readDraft, sessionDraftKey },
          { pluginInputDrafts },
        ] = await Promise.all([
          module("/src/session-mode/stores/useAgentCenterStore.ts"),
          module("/src/session-mode/stores/useSessionDraftStore.ts"),
          module("/src/session-mode/features/plugins/pluginInputs.ts"),
        ]);
        return {
          card: useAgentCenterStore.getState().currentAgentCardId,
          a: readDraft(sessionDraftKey("codex", "ux-0")).text,
          b: readDraft(sessionDraftKey("codex", "ux-1")).text,
          plugins: pluginInputDrafts.read(sessionDraftKey("codex", "ux-1")),
        };
      });
      expect(before).toEqual({
        card: "ux-1",
        a: "Original A",
        b: "Original B",
        plugins: [],
      });
      await activate(useCard);
      await activate(
        page.getByRole("button", { name: "放弃更改并离开", exact: true }),
      );
      await expect(page.locator(".session-codex-composer")).toBeVisible();
      await expect(
        page.locator(".session-codex-composer [contenteditable=true]"),
      ).toContainText("Fixture Plugin");
      await expect(
        page.getByRole("button", { name: "引用子 Agent 或配置角色" }),
      ).toHaveText("@");
      await activate(
        page.getByRole("button", { name: "发送消息", exact: true }),
      );
      await expect
        .poll(
          () =>
            fixture.calls.filter((call) =>
              call.path.endsWith("/followups/submit"),
            ).length,
        )
        .toBe(1);
      const submit = fixture.calls.find((call) =>
        call.path.endsWith("/followups/submit"),
      )!.body;
      expect(submit.threadId).toBe("ux-1");
      expect(submit.text).toContain("@Fixture Plugin");
      expect(submit.mentions).toEqual([
        { name: "Fixture Plugin", path: "plugin://fixture-native@fixture" },
      ]);
      expect(
        fixture.calls.filter((call) =>
          /\/codex\/(turn\/(start|steer)|thread\/(resume|fork|rollback))/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`plugin-typed-owner-${width}-${theme}.png`),
        fullPage: true,
      });
      await info.attach("typed-plugin-receipt", {
        body: JSON.stringify({
          before,
          submit,
          pluginCalls,
          geometry,
          width,
          theme,
          activation: width === 390 ? "tap" : "click",
        }),
        contentType: "application/json",
      });
      await writeFile(
        info.outputPath("typed-plugin-receipt.json"),
        JSON.stringify(
          {
            before,
            submit,
            pluginCalls,
            readsBeforeInstall,
            geometry,
            width,
            theme,
            activation: width === 390 ? "tap" : "click",
          },
          null,
          2,
        ),
      );
      await page.evaluate(() => {
        (window as any).releasePluginGuard?.();
      });
    });
  });
