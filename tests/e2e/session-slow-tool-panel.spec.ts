import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test.describe(`${width}px slow tool panel`, () => {
    test.use({ hasTouch: width === 393, isMobile: width === 393 });
    test("can close a stalled panel without losing the conversation draft and reopen it after loading", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      const fixture = await installSessionUxFixture(page, 0);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let release!: () => void;
      let requested = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        /\/src\/session-mode\/components\/layout\/RightPanel\.tsx(?:\?|$)/,
        async (route) => {
          requested = true;
          await gate;
          await route.continue();
        },
      );
      try {
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        const draft = page
          .locator(".session-mode [contenteditable=true]")
          .first();
        await draft.waitFor();
        await seedSessionUx(page, 0);
        await draft.fill("工具面板加载时保留的输入");
        await page.evaluate(async () => {
          (window as any).__slowPanelDocument = "original";
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const mounted =
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path;
          const { useLayoutStore } = await import(mounted);
          useLayoutStore.setState({
            isRightPanelOpen: true,
            isRightPanelFocused: true,
            activeRightPanelTab: "files",
            openRightPanelTabs: ["files"],
          });
        });
        await expect.poll(() => requested).toBe(true);
        const status = page.getByRole("status").filter({ hasText: "工具面板" });
        await expect(status).toContainText("正在加载工具面板");
        await expect(status).toContainText("加载时间较长", { timeout: 15_000 });
        await status
          .locator("..")
          .getByRole("button", { name: "关闭工具面板" })
          .click();
        await expect(status).toHaveCount(0);
        expect(await draft.textContent()).toContain("工具面板加载时保留的输入");
        expect(
          await page.evaluate(() => (window as any).__slowPanelDocument),
        ).toBe("original");
        release();
        await page.evaluate(async () => {
          const path = "/src/session-mode/stores/useLayoutStore.ts";
          const mounted =
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path;
          const { useLayoutStore } = await import(mounted);
          useLayoutStore.setState({
            isRightPanelOpen: true,
            isRightPanelFocused: true,
          });
        });
        await expect(
          page.getByRole("toolbar", { name: "文件管理" }),
        ).toBeVisible({ timeout: 30_000 });
        expect(await draft.textContent()).toContain("工具面板加载时保留的输入");
        expect(
          fixture.calls.filter((call) =>
            /\/(?:turn\/start|thread\/resume|followups\/submit)$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        release();
      }
    });
  });
}
