import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test(`archived settings page cursor retry and independent restore results at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 1);
    const rows = ["first", "second", "third"].map((id) => ({
      id: `archived-${id}`,
      name: `归档-${id}`,
      preview: "旧预览",
      cwd: "/fixture/project",
      createdAt: 1,
      updatedAt: 2,
      modelProvider: "openai",
    }));
    let failNext = true;
    const cursors: Array<string | null> = [],
      restored: string[] = [];
    await page.route("**/api/codex/thread/list", async (route) => {
      const body = route.request().postDataJSON();
      if (body.archived !== true) return route.fallback();
      cursors.push(body.cursor);
      if (!body.cursor)
        return route.fulfill({
          json: {
            data: rows.slice(0, 2),
            nextCursor: "genuine-archive-cursor",
            backwardsCursor: null,
          },
        });
      expect(body.cursor).toBe("genuine-archive-cursor");
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { error: "归档后续页暂时不可用" },
        });
      }
      return route.fulfill({
        json: {
          data: [rows[1], rows[2]],
          nextCursor: null,
          backwardsCursor: null,
        },
      });
    });
    await page.route("**/api/session/lifecycle/restore", async (route) => {
      const body = route.request().postDataJSON();
      if (body.threadId === rows[1].id)
        return route.fulfill({
          status: 409,
          json: { error: "另一客户端已变更归档状态" },
        });
      restored.push(body.threadId);
      return route.fulfill({
        json: { status: "accepted", threadId: body.threadId },
      });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator(".session-codex-composer [contenteditable=true]").first(),
    ).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useLayoutStore.ts";
      const { useLayoutStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((row) => new URL(row.name).pathname === path)?.name ?? path
      );
      useLayoutStore.getState().setView("settings");
    });
    if (width < 768) {
      await page
        .getByRole("combobox")
        .filter({ hasText: /^(通用|General)$/ })
        .click();
      await page
        .getByRole("option", { name: /Codex:.*(归档|Archived)/ })
        .click();
    } else
      await page
        .getByRole("button", { name: /^(已归档线程|Archived Threads)$/ })
        .click();
    const section = page.getByRole("region", { name: "归档聊天设置" });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("button", {
        name: "恢复聊天：归档-first",
        exact: true,
      }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: "加载更多归档聊天", exact: true })
      .click();
    await expect(section.getByRole("alert")).toContainText("加载归档聊天失败");
    await expect(
      section.getByText("归档-first", { exact: true }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: "重试加载归档聊天", exact: true })
      .click();
    await expect(
      section.getByText("归档-third", { exact: true }),
    ).toBeVisible();
    await expect(section.getByText("归档-second", { exact: true })).toHaveCount(
      1,
    );
    await section
      .getByRole("button", { name: "恢复聊天：归档-first", exact: true })
      .click();
    await expect(section.getByText("归档-first", { exact: true })).toHaveCount(
      0,
    );
    await section
      .getByRole("button", { name: "恢复聊天：归档-second", exact: true })
      .click();
    await expect(section.getByRole("alert")).toContainText("恢复聊天失败");
    await expect(section.getByText("归档-first", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      section.getByText("归档-second", { exact: true }),
    ).toBeVisible();
    expect(cursors.filter((cursor) => cursor !== null)).toEqual([
      "genuine-archive-cursor",
      "genuine-archive-cursor",
    ]);
    expect(
      cursors.filter((cursor) => cursor === null).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      cursors.filter((cursor) => cursor === null).length,
    ).toBeLessThanOrEqual(2); // React StrictMode cancels its first initial read.
    expect(restored).toEqual([rows[0].id]);
    await info.attach("archive-management-evidence", {
      body: JSON.stringify({ width, cursors, restored }),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("archives.png") });
  });
}
