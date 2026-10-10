import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import {
  installResizeDiagnostics,
  saveResizeDiagnostics,
} from "./resize-observer-diagnostics";

for (const width of [1440, 390])
  test.describe(`late content in ${width}px multi-project grid`, () => {
    test.use({
      hasTouch: width === 390,
      isMobile: width === 390,
      viewport: { width, height: 1000 },
    });
    test("two visible long histories preserve a reading anchor through late highlight/image layout and independent updates", async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      await installResizeDiagnostics(page);
      const fixture = await installSessionUxFixture(page, 2);
      fixture.threads[1].cwd = "/fixture/other-project";
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let release!: () => void;
      let imageRequested = false;
      await page.route(
        "https://fixture.invalid/late-reading.svg",
        async (route) => {
          imageRequested = true;
          await new Promise<void>((resolve) => (release = resolve));
          await route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="540"><rect width="180" height="540" fill="#809b82"/></svg>',
          });
        },
      );
      await page.goto("/?mode=session");
      const editor = page
        .locator(".session-codex-composer [contenteditable=true]")
        .first();
      await editor.waitFor({ timeout: 60_000 });
      await seedSessionUx(page, 2);
      const start = await page.evaluate(async () => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [{ useCodexStore }, { useAgentCenterStore }, { useLayoutStore }] =
          await Promise.all([
            module("/src/session-mode/components/codex/stores/index.ts"),
            module("/src/session-mode/stores/useAgentCenterStore.ts"),
            module("/src/session-mode/stores/useLayoutStore.ts"),
          ]);
        const events = (id: string) =>
          Array.from({ length: 10_000 }, (_, i) => ({
            method: "item/completed",
            params: {
              threadId: id,
              turnId: `resize-turn-${i}`,
              item: {
                id: `resize-message-${i}`,
                type: "agentMessage",
                phase: "final_answer",
                text: `${id} 阅读消息 ${i}\n\n正文与项目各自保存。`,
              },
            },
          }));
        useLayoutStore.setState({
          isSidebarOpen: false,
          isRightPanelOpen: false,
        });
        const start = performance.now();
        useCodexStore.setState({
          events: { "ux-0": events("ux-0"), "ux-1": events("ux-1") },
          historyLoadedMap: { "ux-0": true, "ux-1": true },
          historyLoadingMap: {},
          threadStatusMap: {
            "ux-0": { type: "idle" },
            "ux-1": { type: "idle" },
          },
          currentThreadId: "ux-0",
          currentTurnId: null,
        });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "Long history A",
          },
          { activate: true },
        );
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-1",
            cwd: "/fixture/other-project",
            preview: "Long history B",
          },
          { activate: false },
        );
        useAgentCenterStore.setState({ cardsViewMode: "grid" });
        return start;
      });
      const surfaces = page.locator(".thread-surface");
      await expect(surfaces).toHaveCount(2);
      await expect(
        surfaces.nth(0).getByText("ux-0 阅读消息 9999", { exact: true }),
      ).toBeVisible();
      await expect(
        surfaces.nth(1).getByText("ux-1 阅读消息 9999", { exact: true }),
      ).toBeVisible();
      const readyMs = await page.evaluate(
        (start) => performance.now() - start,
        start,
      );
      expect(await surfaces.locator("*").count()).toBeLessThan(2000);
      await editor.fill("A 的输入目标与草稿保持");
      const viewport = surfaces
        .first()
        .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"]');
      await viewport.evaluate((el) => {
        el.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -1000, bubbles: true }),
        );
        el.scrollTop = 3000;
        el.dispatchEvent(new Event("scroll"));
      });
      await page.waitForTimeout(250);
      const anchor = await viewport.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const rows = [...el.querySelectorAll<HTMLElement>("[data-codex-row]")];
        const visible = rows.find(
          (row) => row.getBoundingClientRect().bottom > top,
        )!;
        const earlier = rows
          .filter((row) => row.getBoundingClientRect().bottom < top)
          .at(-1)!;
        if (!visible || !earlier)
          throw new Error(
            "Need an actually mounted earlier row and a visible reading anchor",
          );
        return {
          key: visible.dataset.codexRow!,
          offset: visible.getBoundingClientRect().top - top,
          earlierKey: earlier.dataset.codexRow!,
          earlierIndex: Number(earlier.dataset.index),
          height: earlier.getBoundingClientRect().height,
        };
      });
      const earlier = surfaces
        .first()
        .locator(`[data-codex-row="${anchor.earlierKey}"]`);
      await page.evaluate(async (index) => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useCodexStore.getState().addEvent("ux-0", {
          method: "item/completed",
          params: {
            threadId: "ux-0",
            turnId: `resize-turn-${index}`,
            item: {
              id: `resize-message-${index}`,
              type: "agentMessage",
              phase: "final_answer",
              text: `ux-0 阅读消息 ${index}\n\n\x60\x60\x60typescript\n${Array.from({ length: 24 }, (_, i) => `const value${i} = ${i};`).join("\n")}\n\x60\x60\x60\n\n![延迟图片](https://fixture.invalid/late-reading.svg)`,
            },
          },
        });
      }, anchor.earlierIndex);
      await expect.poll(() => imageRequested).toBe(true);
      await earlier.locator(".hljs-keyword").first().waitFor();
      await expect
        .poll(async () => (await earlier.boundingBox())!.height)
        .toBeGreaterThan(anchor.height + 100);
      const offset = () =>
        viewport.evaluate(
          (el, key) =>
            el
              .querySelector(`[data-codex-row="${key}"]`)!
              .getBoundingClientRect().top - el.getBoundingClientRect().top,
          anchor.key,
        );
      await expect
        .poll(async () => Math.abs((await offset()) - anchor.offset))
        .toBeLessThanOrEqual(2);
      release();
      await expect
        .poll(() =>
          earlier
            .locator("img")
            .evaluate((el: HTMLImageElement) => el.naturalHeight),
        )
        .toBe(540);
      await expect
        .poll(async () => Math.abs((await offset()) - anchor.offset))
        .toBeLessThanOrEqual(2);
      await page.evaluate(async () => {
        const path = "/src/session-mode/components/codex/stores/index.ts";
        const { useCodexStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        for (const id of ["ux-0", "ux-1"])
          useCodexStore.getState().addEvent(id, {
            method: "item/agentMessage/delta",
            params: {
              threadId: id,
              turnId: "new-resize-turn",
              itemId: "new-resize-item",
              delta: `${id} 新消息保持独立`,
            },
          });
      });
      await expect
        .poll(async () => Math.abs((await offset()) - anchor.offset))
        .toBeLessThanOrEqual(2);
      await expect(
        page.getByRole("button", { name: "Scroll to bottom" }).first(),
      ).toContainText("有新消息");
      await expect(
        surfaces.nth(1).getByText("ux-1 新消息保持独立", { exact: true }),
      ).toBeVisible();
      await expect(editor).toHaveText("A 的输入目标与草稿保持");
      expect(await surfaces.locator("*").count()).toBeLessThan(2000);
      await saveResizeDiagnostics(page, info);
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/followups\/submit$|\/turn\/(start|interrupt)$|\/thread\/resume$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`long-grid-reading-${width}.png`),
        fullPage: true,
      });
      await info.attach("layout-anchor-receipt", {
        body: JSON.stringify({
          readyMs,
          width,
          histories: 2,
          rowsPerHistory: 10000,
          anchor,
          finalOffset: await offset(),
          mountedElements: await surfaces.locator("*").count(),
        }),
        contentType: "application/json",
      });
    });
  });
