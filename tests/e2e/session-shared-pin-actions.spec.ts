import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { createSessionManagementFixture } from "./session-management-fixture";

async function pinned(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/stores/usePinStore.ts";
    const { usePinStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
    );
    return usePinStore
      .getState()
      .pinned.some((row: { id: string }) => row.id === "ux-1");
  });
}
test("shared pin menus synchronize desktop and phone and an older undo cannot overwrite the phone revision", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const firstFixture = await installSessionUxFixture(page, 2),
    second = await page.context().newPage();
  const secondFixture = await installSessionUxFixture(second, 2);
  const shared = await createSessionManagementFixture({
    threads: () => firstFixture.threads,
    context: {
      scopeToken: "ux-fixture-native-scope",
      namespace: "ux-fixture-native-domain",
    },
  });
  const mutations: unknown[] = [];
  try {
    for (const target of [page, second]) {
      await target.route("**/api/session/management", async (route) => {
        const request = route.request(),
          body =
            request.method() === "POST" ? request.postDataJSON() : undefined;
        if (body) mutations.push(body);
        const result = await shared.handle({
          method: request.method(),
          url: request.url(),
          ...(body ? { body } : {}),
        });
        await route.fulfill({
          status: result.status,
          contentType: "application/json",
          body: result.body,
        });
      });
    }
    await page.setViewportSize({ width: 1440, height: 852 });
    await second.setViewportSize({ width: 393, height: 852 });
    for (const target of [page, second]) {
      await target.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect(
        target
          .locator(".session-codex-composer [contenteditable=true]")
          .first(),
      ).toBeVisible();
      await seedSessionUx(target, 2);
    }
    const menu = async (target: Page, action: string) => {
      const row = target
        .locator('.session-nav-row[role="button"]')
        .filter({ hasText: "中文会话 1 " })
        .last();
      if (!(await row.isVisible()))
        await target
          .getByRole("button", { name: "展开项目列表", exact: true })
          .click();
      await expect(row).toBeVisible();
      await row.hover();
      await row.getByRole("button", { name: "会话操作", exact: true }).click();
      await target.getByRole("menuitem", { name: action, exact: true }).click();
    };
    await page.bringToFront();
    await menu(page, "置顶");
    await expect.poll(() => pinned(page)).toBe(true);
    await expect(page.getByText("已置顶聊天", { exact: true })).toBeVisible();
    await second.bringToFront();
    await expect.poll(() => pinned(second)).toBe(true);
    await menu(second, "取消置顶");
    await expect.poll(() => pinned(second)).toBe(false);
    await page.bringToFront();
    await expect.poll(() => pinned(page)).toBe(false);
    const rejected = await page.evaluate(async () => {
      const path =
        "/src/session-mode/components/codex/composer/appActionHistory.ts";
      const { undoAppAction } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
      );
      try {
        await undoAppAction();
        return "unexpected success";
      } catch (error) {
        return String(error);
      }
    });
    expect(rejected).toContain("更新");
    expect(await pinned(page)).toBe(false);
    expect(await pinned(second)).toBe(false);
    expect(
      [...firstFixture.calls, ...secondFixture.calls].filter((row) =>
        /turn\/(start|interrupt)|followups\/(submit|change|stop)/.test(
          row.path,
        ),
      ),
    ).toEqual([]);
    await info.attach("shared-pin-evidence", {
      body: JSON.stringify({ mutations, rejected }),
      contentType: "application/json",
    });
  } finally {
    await second.close();
    await page.close();
    await shared.close();
  }
});
