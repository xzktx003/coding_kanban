import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [390, 1440]) {
  test(`followed menu has live status markers, fixed summary and accessible navigation (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 20);
    Object.assign(fixture.threads[1], {
      status: { type: "active", activeFlags: [] },
    });
    Object.assign(fixture.threads[4], {
      status: { type: "active", activeFlags: ["waitingOnApproval"] },
    });
    Object.assign(fixture.threads[5], { status: { type: "systemError" } });
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
    await page.addInitScript((cards) => {
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      localStorage.setItem(
        "kanban.session.attention",
        JSON.stringify({
          state: {
            receipts: {
              "codex:ux-2": { completed: [{ id: "reply-2", at: 2 }], read: [] },
              "codex:ux-3": {
                completed: [{ id: "reply-3", at: 3 }],
                read: ["reply-3"],
              },
            },
          },
        }),
      );
    }, cards);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const trigger = page
      .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
      .first();
    await trigger.click();
    const menu = page.locator(".session-followed-menu");
    const row = (id: number) =>
      menu.locator(`[data-session-key="codex:ux-${id}"]`);
    await expect(row(1).locator(".session-status-spin")).toBeVisible();
    await expect(
      row(2).locator('.session-status-dot[data-state="unread"]'),
    ).toBeVisible();
    await expect(row(3)).toContainText("已完成");
    await expect(
      row(4).locator('.session-status-dot[data-state="pending"]'),
    ).toBeVisible();
    await expect(
      row(5).locator('.session-status-dot[data-state="failed"]'),
    ).toBeVisible();
    await expect(row(0)).toHaveAttribute("aria-current", "page");
    for (const theme of ["dark", "light"]) {
      await page.evaluate(async (theme) => {
        const path = "/src/session-mode/stores/settings/useThemeStore.ts";
        const { useThemeStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
        useThemeStore.getState().setTheme(theme);
      }, theme);
      const bounds = (await menu.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      const ringColor = await row(1)
        .locator(".session-status-spin")
        .evaluate((el) => getComputedStyle(el).color);
      const tabColor = await page
        .locator('[data-tab-key="codex:ux-1"] .session-status-spin')
        .evaluate((el) => getComputedStyle(el).color);
      expect(ringColor).toBe(tabColor);
      await page.screenshot({
        path: `.dev-runtime/followed-menu/${width}-${theme}.png`,
      });
    }
    const header = menu.locator(".session-followed-header");
    const headerBefore = await header.boundingBox();
    await menu.locator(".session-followed-list").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(row(19)).toBeInViewport();
    expect((await header.boundingBox())!.y).toBe(headerBefore!.y);
    await menu.locator(".session-followed-list").evaluate((el) => {
      el.scrollTop = 0;
    });
    // A background transition must update both surfaces without selecting it.
    Object.assign(fixture.threads[1], { status: { type: "systemError" } });
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      row(1).locator('.session-status-dot[data-state="failed"]'),
    ).toBeVisible();
    await expect(row(0)).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await row(2).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-tab-key="codex:ux-2"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      fixture.calls.filter((call) =>
        /\/(turn\/start|thread\/start|interrupt|stop)$/.test(call.path),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });
}
