import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
test("merged navigation keeps projects, followed sessions and pending status reachable on phones", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 5);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const startupErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("websocket"))
      startupErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session");
  await expect(page.locator(".session-mode [contenteditable=true]").first())
    .toBeVisible({ timeout: 15000 })
    .catch((error) => {
      throw new Error(`${error}\nStartup errors: ${startupErrors.join("\n")}`);
    });
  await expect(page.locator(".workbench-header")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "会话工作台导航" }),
  ).toBeVisible();
  await seedSessionUx(page, 5);
  for (const i of [0, 1, 2])
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${i} ` })
      .first()
      .click();
  Object.assign(fixture.threads[0], {
    status: { type: "active", activeFlags: [] },
  });
  Object.assign(fixture.threads[1], {
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
  });
  Object.assign(fixture.threads[4], {
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
  });
  await page.evaluate(async () => {
    const get = (path: string) =>
      performance
        .getEntriesByType("resource")
        .find((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useAgentCenterStore } = await import(
      get("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { useCodexStore } = await import(
      get("/src/session-mode/components/codex/stores/useCodexStore.ts")
    );
    const { useApprovalStore } = await import(
      get("/src/session-mode/components/codex/stores/useApprovalStore.ts")
    );
    useApprovalStore.setState({
      pendingApprovals: [
        {
          type: "fileChange",
          requestId: 11,
          threadId: "ux-1",
          turnId: "t",
          itemId: "i",
          startedAtMs: 0,
          reason: null,
          grantRoot: "/fixture/pending-target",
        },
        {
          type: "fileChange",
          requestId: 44,
          threadId: "ux-4",
          turnId: "t",
          itemId: "i",
          startedAtMs: 0,
          reason: null,
          grantRoot: "/fixture/unfollowed",
        },
      ],
    });
    useAgentCenterStore.setState({ sharedTabsInitialized: true });
    useCodexStore.setState({
      threadStatusMap: {
        "ux-0": { type: "active", activeFlags: [] },
        "ux-1": { type: "active", activeFlags: ["waitingOnApproval"] },
        "ux-2": { type: "idle" },
        "ux-4": { type: "active", activeFlags: ["waitingOnApproval"] },
      },
    });
  });
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  await expect(
    nav.getByRole("button", { name: "待确认 1", exact: true }),
  ).toBeVisible();
  for (const width of [390, 320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await nav.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(46);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeInViewport();
    if (width < 768) {
      await expect(
        nav.getByRole("button", { name: /^(展开|收起)项目列表$/ }),
      ).toBeVisible();
      await expect(page.locator(".session-group-switch")).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await nav.getByRole("button", { name: "待确认 1", exact: true }).click();
  await expect(page.getByRole("menu")).toContainText("仅统计关注会话");
  await page.getByRole("menuitem").filter({ hasText: "中文会话 1 " }).click();
  await expect(page.locator(".session-input-target")).toContainText(
    "中文会话 1",
  );
  await expect(
    page.getByText("/fixture/pending-target", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("/fixture/unfollowed", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-tab-key="codex:ux-1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page
    .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
    .click();
  await expect(page.getByRole("menu")).toContainText("中文会话 0");
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: /^(展开|收起)项目列表$/ }).click();
  const drawer = page.getByRole("dialog");
  // Project navigation and the persistent editor tools have distinct surfaces.
  await expect(
    drawer.getByRole("button", { name: "添加项目", exact: true }),
  ).toBeVisible();
  await expect(drawer.locator(".session-nav-row").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: "更多功能", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.screenshot({
    path: ".dev-runtime/session-ui-review/implemented-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopCode = page.getByRole("button", {
    name: "VS Code",
    exact: true,
  });
  expect((await desktopCode.boundingBox())!.width).toBeLessThanOrEqual(32);
  const sidebar = page.locator(".session-mode [data-sidebar=sidebar]").first();
  if (!(await sidebar.isVisible()))
    await nav.getByRole("button", { name: /^(展开|收起)项目列表$/ }).click();
  await expect(sidebar).toBeVisible();
  await page.screenshot({
    path: ".dev-runtime/session-ui-review/implemented-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 520 });
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("手机键盘尺寸变化后保留的草稿");
  await editor.focus();
  await expect(
    page.getByRole("button", { name: /^(发送消息|停止生成)$/ }),
  ).toBeInViewport();
  await expect(nav).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(editor).toContainText("手机键盘尺寸变化后保留的草稿");

  await nav.getByRole("switch", { name: "工作模式", exact: true }).click();
  await expect(page.locator(".session-mode")).toBeHidden();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(nav).toBeVisible();
  await expect(page.locator('[data-tab-key="codex:ux-1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator(".session-tabs .session-new-tab button").click();
  await expect(page.locator(".session-input-target")).toContainText("新聊天");
  await expect(page.locator(".session-input-target")).toContainText("Codex");
  expect(
    fixture.calls.filter((c) => /turn\/start|approval.*respond/.test(c.path)),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
