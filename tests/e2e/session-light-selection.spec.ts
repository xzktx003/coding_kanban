import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

async function startFixture(
  page: Page,
  layout: "split" | "grid",
  theme: "light" | "dark",
) {
  const fixture = await installSessionUxFixture(page, 4);
  for (const thread of fixture.threads)
    (thread as any).turns = Array.from({ length: 24 }, (_, i) => ({
      id: `${thread.id}-turn-${i}`,
      status: "completed",
      startedAt: i + 1,
      completedAt: i + 2,
      items: [
        {
          id: `${thread.id}-reply-${i}`,
          type: "agentMessage",
          text: `历史回复 ${i}\n\n${"保留阅读位置并检查窗口切换。".repeat(16)}`,
        },
      ],
    }));
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.addInitScript(
    ({ cards, layout, theme }) => {
      localStorage.setItem(
        "kanban.session.theme-storage",
        JSON.stringify({
          version: 1,
          state: { theme, accent: "default" },
        }),
      );
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: layout === "grid" ? "grid" : "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      const group = (id: string, keys: string[]) => ({
        type: "group",
        id,
        keys,
        selected: keys[0],
      });
      localStorage.setItem(
        "kanban.session.split-layout",
        JSON.stringify({
          version: 1,
          state: {
            activeGroupId: "left",
            tree: {
              type: "split",
              id: "columns",
              direction: "horizontal",
              ratio: 50,
              first: group("left", ["codex:ux-0", "codex:ux-3"]),
              second: {
                type: "split",
                id: "rows",
                direction: "vertical",
                ratio: 50,
                first: group("top", ["codex:ux-1"]),
                second: group("bottom", ["codex:ux-2"]),
              },
            },
          },
        }),
      );
      localStorage.setItem(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            isSidebarOpen: false,
            isRightPanelOpen: false,
            view: "agent",
          },
        }),
      );
    },
    { cards, layout, theme },
  );
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  return fixture;
}
for (const theme of ["light", "dark"] as const)
  for (const layout of ["split", "grid"] as const)
    for (const width of [900, 1440]) {
      test(`${theme} ${layout} selection stays visually clear without any window movement (${width}px)`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(60000);
        await page.setViewportSize({ width, height: 1100 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const fixture = await startFixture(page, layout, theme);
        const windows = page.locator(
          layout === "split"
            ? "[data-session-group]"
            : "[data-card-root][data-session-card]",
        );
        await expect(windows).toHaveCount(layout === "split" ? 3 : 4);
        const activeSelector =
          layout === "split"
            ? '[data-session-group][data-group-active="true"]'
            : '[data-card-root][data-selected="true"]';
        const headerSelector =
          layout === "split" ? ".session-tabs" : ".session-card-header";
        const edge =
          theme === "dark" ? "rgb(96, 165, 250)" : "rgb(59, 130, 246)";
        const inactiveSelector =
          layout === "split"
            ? '[data-session-group][data-group-active="false"]'
            : '[data-card-root][data-selected="false"]';
        const header =
          layout === "split"
            ? await page.locator(".session-mode").evaluate((root) => {
                // The original focused group header uses the theme sidebar color.
                const probe = document.createElement("span");
                probe.style.cssText =
                  "position:absolute;visibility:hidden;color:var(--sidebar)";
                root.appendChild(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
              })
            : await page
                .locator(inactiveSelector)
                .first()
                .locator(`:scope > ${headerSelector}`)
                .evaluate((el) => getComputedStyle(el).backgroundColor);
        const underline =
          theme === "dark" ? "rgb(214, 183, 122)" : "rgb(148, 113, 61)";
        const actualHeader = await page
          .locator(activeSelector)
          .locator(`:scope > ${headerSelector}`)
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        if (actualHeader !== header)
          await page.screenshot({
            path: `.dev-runtime/selection-review/before-border-only-${layout}-${width}-${theme}.png`,
          });
        const actualEdge = await page
          .locator(activeSelector)
          .evaluate((el) => getComputedStyle(el).outlineColor);
        if (actualEdge !== edge)
          await page.screenshot({
            path: `.dev-runtime/selection-review/before-${layout}-${width}-${theme}.png`,
          });
        await expect
          .poll(() =>
            page
              .locator(activeSelector)
              .evaluate((el) => getComputedStyle(el).outlineColor),
          )
          .toBe(edge);
        await expect
          .poll(() =>
            page
              .locator(activeSelector)
              .locator(`:scope > ${headerSelector}`)
              .evaluate((el) => getComputedStyle(el).backgroundColor),
          )
          .toBe(header);
        expect(
          await page
            .locator(activeSelector)
            .evaluate((el) => getComputedStyle(el).outlineWidth),
        ).toBe("2px");
        const contrast = await page
          .locator(activeSelector)
          .evaluate((frame, headerSelector) => {
            const contrastRatio = (a: string, b: string) => {
              const luminance = (color: string) => {
                const channels = (color.match(/[\d.]+/g) ?? [])
                  .slice(0, 3)
                  .map(Number)
                  .map((c) => c / 255);
                const linear = channels.map((c) =>
                  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
                );
                return (
                  linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
                );
              };
              const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
              return (values[1] + 0.05) / (values[0] + 0.05);
            };
            const surface = getComputedStyle(
              frame.closest(".session-mode")!,
            ).backgroundColor;
            const frameStyle = getComputedStyle(frame);
            const head = getComputedStyle(
              frame.querySelector(`:scope > ${headerSelector}`)!,
            );
            return {
              edge: contrastRatio(frameStyle.outlineColor, surface),
              title: contrastRatio(head.color, head.backgroundColor),
            };
          }, headerSelector);
        expect(contrast.edge).toBeGreaterThanOrEqual(3);
        expect(contrast.title).toBeGreaterThanOrEqual(4.5);
        if (layout === "split") {
          const tab = page
            .locator(activeSelector)
            .locator('.session-tab[data-active="true"]');
          const inactiveTabBackground = await page
            .locator(inactiveSelector)
            .first()
            .locator('.session-tab[data-active="true"]')
            .evaluate((el) => getComputedStyle(el).backgroundColor);
          expect(
            await tab.evaluate((el) => getComputedStyle(el).backgroundColor),
          ).toBe(inactiveTabBackground);
          expect(
            await tab.evaluate((el) => getComputedStyle(el).boxShadow),
          ).toContain(underline);
        }
        const viewports = windows
          .locator('[data-slot="scroll-area-viewport"]')
          .filter({ has: page.locator("[data-session-latest]") });
        await expect(viewports).toHaveCount(layout === "split" ? 3 : 4);
        await expect
          .poll(() =>
            viewports.evaluateAll((els) =>
              els.every((el) => el.scrollHeight > el.clientHeight + 300),
            ),
          )
          .toBe(true);
        // Reading is intentional; disable follow-to-bottom through the same wheel/scroll
        // events a user generates before taking the stable geometry baseline.
        await viewports.evaluateAll((els) =>
          els.forEach((el) => {
            el.dispatchEvent(
              new WheelEvent("wheel", { deltaY: -500, bubbles: true }),
            );
            el.scrollTop = 120;
            el.dispatchEvent(new Event("scroll"));
          }),
        );
        // Virtual rows correct estimated heights on first read. Wait for that
        // initial measurement to settle before attributing movement to selection.
        const readingPositions = await viewports.evaluateAll(async (els) => {
          let previous = els.map((el) => el.scrollTop),
            stable = 0;
          for (let frame = 0; frame < 120; frame++) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const current = els.map((el) => el.scrollTop);
            stable = current.every((value, i) => value === previous[i])
              ? stable + 1
              : 0;
            previous = current;
            if (stable >= 12) return current;
          }
          throw new Error("Transcript reading position never settled");
        });
        expect(readingPositions.every((top) => top > 0)).toBe(true);
        await page.evaluate(
          ({ layout, headerSelector }) => {
            const roots = [
              ...document.querySelectorAll<HTMLElement>(
                layout === "split"
                  ? "[data-session-group]"
                  : "[data-card-root][data-session-card]",
              ),
            ];
            const nodes = roots.flatMap((root) => [
              root,
              root.querySelector<HTMLElement>(`:scope > ${headerSelector}`)!,
            ]);
            nodes.push(
              ...document.querySelectorAll<HTMLElement>(
                ".session-split-workspace [data-panel-resize-handle-id]",
              ),
            );
            const measure = (node: HTMLElement) => {
              const r = node.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            };
            const baseline = nodes.map(measure);
            const audit = {
              windowCount: roots.length,
              separatorCount: nodes.length - roots.length * 2,
              frames: 0,
              maxDelta: 0,
              detached: false,
              stopped: false,
            };
            (window as any).__selectionAudit = audit;
            const tick = () => {
              if (audit.stopped) return;
              audit.frames++;
              nodes.forEach((node, i) => {
                if (!node.isConnected) audit.detached = true;
                measure(node).forEach((v, j) => {
                  audit.maxDelta = Math.max(
                    audit.maxDelta,
                    Math.abs(v - baseline[i][j]),
                  );
                });
              });
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          },
          { layout, headerSelector },
        );
        const count = layout === "split" ? 3 : 4;
        for (let i = 0; i < 12; i++) {
          const index = i % count;
          const target = windows.nth(index);
          if (layout === "split") await target.getByRole("tab").first().click();
          else
            await target
              .locator(".session-card-header")
              .click({ position: { x: 8, y: 8 } });
          await expect(target).toHaveAttribute(
            layout === "split" ? "data-group-active" : "data-selected",
            "true",
          );
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
        }
        const audit = await page.evaluate(() => {
          const audit = (window as any).__selectionAudit;
          audit.stopped = true;
          return audit;
        });
        expect(audit.windowCount).toBe(count);
        if (layout === "split") expect(audit.separatorCount).toBe(2);
        expect(audit.frames).toBeGreaterThan(20);
        expect(audit.maxDelta).toBe(0);
        expect(audit.detached).toBe(false);
        console.log(
          "Selection audit",
          JSON.stringify({ theme, layout, width, ...audit }),
        );
        expect(
          await viewports.evaluateAll((els) => els.map((el) => el.scrollTop)),
        ).toEqual(readingPositions);
        expect(await page.locator(activeSelector).count()).toBe(1);

        // Screenshot shows the actual selected frame, status marks and neighbouring windows.
        await page.screenshot({
          path: `.dev-runtime/selection-review/${layout}-${width}-${theme}.png`,
          animations: "disabled",
        });
        await testInfo.attach("selection-geometry", {
          body: JSON.stringify(audit, null, 2),
          contentType: "application/json",
        });
        const beforeTheme = await windows.evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          }),
        );
        const otherTheme = theme === "dark" ? "light" : "dark";
        await page.evaluate(async (otherTheme) => {
          const path = "/src/session-mode/stores/settings/useThemeStore.ts";
          const { useThemeStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
          useThemeStore.getState().setTheme(otherTheme);
        }, otherTheme);
        await expect(page.locator(".session-mode")).toHaveClass(
          new RegExp(otherTheme),
        );
        expect(
          await page
            .locator(activeSelector)
            .evaluate((el) => getComputedStyle(el).outlineColor),
        ).toBe(
          otherTheme === "dark" ? "rgb(96, 165, 250)" : "rgb(59, 130, 246)",
        );
        expect(
          await windows.evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height];
            }),
          ),
        ).toEqual(beforeTheme);
        expect(
          await viewports.evaluateAll((els) => els.map((el) => el.scrollTop)),
        ).toEqual(readingPositions);
        expect(
          fixture.calls.filter((call) =>
            /\/(turn\/start|thread\/start|interrupt|stop)$/.test(call.path),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
