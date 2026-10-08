import { expect, test } from "@playwright/test";
import {
  chooseSessionLayout,
  installSessionUxFixture,
  seedSessionUx,
} from "./session-ux-fixture";

test("every layout owns its project, details never select, order and drafts survive", async ({
  page,
}) => {
  test.setTimeout(120000);
  const fixture = await installSessionUxFixture(page, 4);
  const paths = ["/company/api", "/research/api", "/work/kanban", undefined];
  fixture.threads.forEach((t, i) => {
    if (paths[i]) t.cwd = paths[i]!;
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 4);
  await page.evaluate(async (paths) => {
    const load = async (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
      );
    const { useAgentCenterStore } = await load(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    for (let i = 0; i < 4; i++)
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: `ux-${i}`,
        preview: `会话 ${i}`,
        cwd: paths[i],
        ...(i === 2 ? { worktreePath: "/trees/fix-login" } : {}),
      });
  }, paths);
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("项目 A 的草稿");
  const target = page.locator(".session-input-target");
  await expect(target).toContainText("company/api");
  expect(
    await target.evaluate((el) => !!el.closest(".session-composer-surface")),
  ).toBe(true);
  for (const label of [
    "company/api",
    "research/api",
    "kanban · fix-login",
    "项目未知",
  ])
    await expect(
      page.getByRole("button", { name: `项目详情：${label}`, exact: true }),
    ).toBeVisible();
  await expect(
    page.locator(".session-agent-header,.session-project-context"),
  ).toHaveCount(0);
  const second = page.getByRole("button", {
    name: "项目详情：research/api",
    exact: true,
  });
  await second.click();
  await expect(page.getByText("/research/api", { exact: true })).toBeVisible();
  await expect(target).toContainText("company/api");
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: ".dev-runtime/project-context-v2/tabs.png",
    animations: "disabled",
  });
  for (const [layout, file] of [
    ["多会话网格", "grid"],
    ["会话列表", "list"],
  ] as const) {
    await chooseSessionLayout(page, layout);
    await expect(page.getByRole("tablist", { name: "关注会话" })).toHaveCount(
      0,
    );
    const headers = page.locator(".session-card-header");
    await expect(headers).toHaveCount(4);
    for (const label of [
      "company/api",
      "research/api",
      "kanban · fix-login",
      "项目未知",
    ])
      await expect(
        headers.getByRole("button", {
          name: `项目详情：${label}`,
          exact: true,
        }),
      ).toBeVisible();
    expect((await headers.first().boundingBox())!.height).toBe(48);
    await headers
      .getByRole("button", { name: "项目详情：research/api", exact: true })
      .click();
    await expect(target).toContainText("company/api");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.dev-runtime/project-context-v2/${file}.png`,
      animations: "disabled",
    });
  }
  const cards = page.locator("[data-session-card]");
  await cards
    .nth(1)
    .getByRole("button", { name: /^排列会话：/ })
    .click();
  await page.getByRole("menuitem", { name: "向前移动" }).click();
  await expect(cards.first()).toHaveAttribute("data-session-card", "ux-1");
  await expect(target).toContainText("company/api");
  await chooseSessionLayout(page, "自由分屏");
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "data-tab-key",
    "codex:ux-1",
  );
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.locator('[data-tab-key="codex:ux-1"]').click();
  await expect(editor).toBeEmpty();
  await editor.fill("项目 B 的草稿");
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  await expect(editor).toHaveText("项目 A 的草稿");
  await page.getByRole("button", { name: "切换为浅色模式" }).click();
  await expect(page.locator(".session-mode")).toHaveClass(/light/);
  await page.screenshot({
    path: ".dev-runtime/project-context-v2/light.png",
    animations: "disabled",
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.locator(".session-window-group > .session-tabs"),
    ).toHaveCSS("height", "48px");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const label of ["展开项目列表", "切换为深色模式", "更多功能"]) {
      const bounds = (await page
        .getByRole("button", { name: label, exact: true })
        .boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await page
      .getByRole("button", { name: "展开项目列表", exact: true })
      .click();
    if (width < 768) {
      await expect(
        page.getByRole("dialog", { name: "项目与会话列表" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "展开项目列表", exact: true }),
      ).toBeFocused();
    }
    await page.screenshot({
      path: `.dev-runtime/project-context-v2/width-${width}.png`,
      animations: "disabled",
    });
  }
  expect(
    fixture.calls.filter((c) =>
      /interrupt|\/stop$|\/turn\/start$|\/followups\/submit$|\/thread\/start$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("phone grid and list keep global controls reachable and can create a draft", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await installSessionUxFixture(page, 2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 2);
  for (const i of [0, 1])
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${i} ` })
      .first()
      .click();
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("保留当前会话草稿");
  for (const mode of ["多会话网格", "会话列表"]) {
    await chooseSessionLayout(page, mode);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("tablist", { name: "关注会话" })).toHaveCount(
        0,
      );
      await expect(
        page.locator(".session-card-header .session-identity-project"),
      ).toHaveCount(2);
      for (const name of ["展开项目列表", "更多功能"]) {
        const box = (await page
          .getByRole("button", { name, exact: true })
          .boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      const theme = (await page
        .getByRole("button", { name: /切换为.*色模式/ })
        .boundingBox())!;
      expect(theme.x + theme.width).toBeLessThanOrEqual(width);
    }
  }
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "新聊天", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(editor).toBeEmpty();
  await expect(page.locator(".session-input-target")).toContainText("新聊天");
  await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  await page
    .getByRole("dialog", { name: "项目与会话列表" })
    .locator(".session-nav-row[role=button]")
    .filter({ hasText: "中文会话 1 " })
    .first()
    .click();
  await expect(editor).toHaveText("保留当前会话草稿");
  expect(
    fixture.calls.filter((c) =>
      /interrupt|\/stop$|\/turn\/start$|\/followups\/submit$|\/thread\/start$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});
