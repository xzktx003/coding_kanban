import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 390]) {
  test(`snapshot failure and recovery preserve reading geometry at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 1);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let failure: "none" | "http" | "incomplete" = "none";
    await page.route("**/subagents/snapshot", (route) =>
      route.fulfill({
        status: failure === "http" ? 503 : 200,
        json: {
          threads: [],
          complete: failure === "none",
          errors: failure === "none" ? [] : ["snapshot unavailable"],
          checkedAt: Date.now(),
        },
      }),
    );
    const stream = await liveStream(page, baseURL!);
    try {
      await page.goto("/?mode=session");
      const editor = page
        .locator(".session-codex-composer [contenteditable=true]")
        .first();
      await editor.waitFor();
      await seedSessionUx(page, 1);
      await page.evaluate(async () => {
        const module = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
          );
        const [
          { useCodexStore },
          { useAgentCenterStore },
          { useLayoutStore },
          { subagentService },
        ] = await Promise.all([
          module("/src/session-mode/components/codex/stores/index.ts"),
          module("/src/session-mode/stores/useAgentCenterStore.ts"),
          module("/src/session-mode/stores/useLayoutStore.ts"),
          module("/src/session-mode/features/subagents/service.ts"),
        ]);
        (window as any).__tabs = useAgentCenterStore;
        (window as any).__refreshFamily = () => subagentService.refresh("ux-0");
        useLayoutStore.setState({
          isSidebarOpen: false,
          isRightPanelOpen: false,
        });
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "稳定阅读",
          },
          { activate: true },
        );
        useAgentCenterStore.setState({ cardsViewMode: "solo" });
        useCodexStore.setState({
          events: {
            "ux-0": Array.from({ length: 35 }, (_, i) => ({
              method: "item/completed",
              params: {
                threadId: "ux-0",
                turnId: `stable-${i}`,
                item: {
                  id: `reply-${i}`,
                  type: "agentMessage",
                  phase: "final_answer",
                  text: `稳定消息 ${i}\n\n${"保持当前阅读位置。".repeat(30)}`,
                },
              },
            })),
          },
          historyLoadedMap: { "ux-0": true },
          historyLoadingMap: {},
          threadStatusMap: { "ux-0": { type: "idle" } },
          currentThreadId: "ux-0",
        });
      });
      await expect(
        page.getByText("稳定消息 34", { exact: true }),
      ).toBeVisible();
      await editor.fill("请保留我的草稿");
      await page.evaluate(() => (window as any).__refreshFamily());
      const viewport = page
        .locator(".thread-surface")
        .first()
        .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"]');
      const box = (await viewport.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -500);
      await expect(
        page.getByRole("button", { name: "Scroll to bottom" }),
      ).toBeVisible();
      await page.waitForTimeout(500);
      const geometry = () =>
        viewport.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const input = document
            .querySelector(".session-composer-target-container")!
            .getBoundingClientRect();
          return {
            y: rect.y,
            height: rect.height,
            scrollTop: el.scrollTop,
            inputY: input.y,
            inputHeight: input.height,
          };
        });
      const before = await geometry();
      const samples = [before];
      for (const state of ["http", "none", "incomplete", "none"] as const) {
        failure = state;
        await page.evaluate(() => (window as any).__refreshFamily());
        await expect(
          page.locator(".session-subagent-summary"),
        ).toHaveAccessibleName(
          state === "none" ? "子智能体 · 0" : "子智能体 · 待确认",
        );
        const after = await geometry();
        samples.push(after);
        for (const key of Object.keys(before) as (keyof typeof before)[]) {
          expect(
            Math.abs(after[key] - before[key]),
            `${state}: ${key}`,
          ).toBeLessThanOrEqual(1);
        }
        await expect(editor).toHaveText("请保留我的草稿");
      }
      let tabsUnavailable = true;
      await page.route("**/api/session/tabs", (route) =>
        tabsUnavailable
          ? route.fulfill({ status: 503, json: { error: "isolated sync failure" } })
          : route.fallback(),
      );
      await page.evaluate(() =>
        window.dispatchEvent(new Event("session-connection-retry")),
      );
      const syncTrigger = page.getByRole("button", { name: /同步待重试/ });
      await expect(syncTrigger).toBeVisible();
      await expect(syncTrigger).toHaveAttribute("aria-expanded", "false");
      expect(await geometry()).toEqual(before);
      await syncTrigger.click();
      await page.getByRole("button", { name: "收起同步详情", exact: true }).click();
      expect(await geometry()).toEqual(before);
      await syncTrigger.click();
      await expect(
        page.getByRole("button", { name: "立即同步", exact: true }),
      ).toBeVisible();
      const notice = (await page.locator(".session-sync-details").boundingBox())!;
      const input = (await editor.boundingBox())!;
      expect(notice.y + notice.height).toBeLessThan(input.y);
      await page.screenshot({ path: info.outputPath("sync-notice.png") });
      tabsUnavailable = false;
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      await expect(page.getByRole("button", { name: /同步待重试/ })).toHaveCount(
        0,
      );
      expect(await geometry()).toEqual(before);
      for (const control of [
        page.locator(".session-subagent-summary"),
        page.getByRole("button", { name: "发送消息", exact: true }),
      ]) {
        const rect = (await control.boundingBox())!;
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      }
      let offline = true;
      await page.route("**/api/session/health", (route) =>
        route.fulfill(
          offline
            ? { status: 503, json: { error: "isolated health outage" } }
            : { json: { status: "ok" } },
        ),
      );
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(
        page.getByText("会话服务连接中断", { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      expect(await geometry()).toEqual(before);
      await page
        .getByRole("button", { name: "收起会话服务连接中断", exact: true })
        .click();
      expect(await geometry()).toEqual(before);
      await page
        .getByRole("button", { name: "展开会话服务连接中断", exact: true })
        .click();
      offline = false;
      await page.getByRole("button", { name: "立即重试", exact: true }).click();
      await expect(
        page.getByText("会话服务连接中断", { exact: true }),
      ).toHaveCount(0);
      expect(await geometry()).toEqual(before);
      await expect(editor).toHaveText("请保留我的草稿");
      await writeFile(
        info.outputPath("geometry.json"),
        JSON.stringify(samples, null, 2),
      );
      await info.attach("geometry", {
        path: info.outputPath("geometry.json"),
        contentType: "application/json",
      });
      await page.screenshot({ path: info.outputPath("stable.png") });
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/turn\/(start|interrupt)$|\/thread\/resume$/.test(call.path),
        ),
      ).toEqual([]);
    } finally {
      await stream.close();
    }
  });
}
