import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("Codex tabs control grid/list order, input destination, safe close and reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 950 });
  const fixture = await installSessionUxFixture(page, 4);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 4);
  const row = (i: number) =>
    page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${i} ` })
      .first();
  for (const i of [0, 1, 2]) await row(i).click();
  const tabs = page.getByRole("tablist", { name: "关注会话" });
  const order = () =>
    tabs
      .getByRole("tab")
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("data-tab-key")),
      );
  await expect.poll(order).toEqual(["codex:ux-0", "codex:ux-1", "codex:ux-2"]);
  await row(0).click();
  await expect(tabs.getByRole("tab").nth(0)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(order).toEqual(["codex:ux-0", "codex:ux-1", "codex:ux-2"]);
  // Native drag changes order, not selection.
  await tabs.getByRole("tab").nth(2).dragTo(tabs.getByRole("tab").nth(0));
  await expect.poll(order).toEqual(["codex:ux-2", "codex:ux-0", "codex:ux-1"]);
  await page.getByRole("button", { name: "多会话网格", exact: true }).click();
  const windows = page.locator(".session-agent-view [data-session-card]");
  await expect
    .poll(() =>
      windows.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-session-card")),
      ),
    )
    .toEqual(["ux-2", "ux-0", "ux-1"]);
  await expect(
    page.locator(".session-agent-view [contenteditable=true]"),
  ).toHaveCount(1);

  // A tab opened in another project synchronizes cwd and the shared composer.
  fixture.threads[3].cwd = "/fixture/second-project";
  await page.evaluate(async () => {
    const { navigateToAgentSession } =
      await import("/src/session-mode/lib/agentNav.ts");
    navigateToAgentSession({
      agent: "codex",
      cwd: "/fixture/second-project",
      threadId: "ux-3",
    });
  });
  await expect(tabs.getByRole("tab").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.locator('[data-session-card="ux-1"] .session-card-header').click();
  await expect(page.locator(".session-input-target")).toContainText(
    "中文会话 1",
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (
            await import("/src/session-mode/stores/useWorkspaceStore.ts")
          ).useWorkspaceStore.getState().cwd,
      ),
    )
    .toBe(fixture.threads[1].cwd);
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  await editor.fill("仅发送到选中的第二个会话");
  await editor.press("Enter");
  await expect
    .poll(
      () =>
        fixture.calls.filter((call) => call.path.endsWith("/turn/start")).at(-1)
          ?.body?.threadId,
    )
    .toBe("ux-1");

  // Close the running selection: no interrupt, delete or worktree cleanup request.
  const beforeClose = fixture.calls.length;
  await page
    .locator('[data-session-card="ux-1"]')
    .getByRole("button", { name: "关闭标签", exact: true })
    .click();
  await expect.poll(order).toEqual(["codex:ux-2", "codex:ux-0", "codex:ux-3"]);
  await expect(tabs.getByRole("tab").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    fixture.calls
      .slice(beforeClose)
      .filter((call) =>
        /interrupt|delete|worktree.*remove|disconnect|\/stop/.test(call.path),
      ),
  ).toEqual([]);
  await page.getByRole("button", { name: "会话列表", exact: true }).click();
  await expect(windows).toHaveCount(3);
  await expect(
    page.locator(".session-agent-view [data-card-root]"),
  ).toHaveCount(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(order).toEqual(["codex:ux-2", "codex:ux-0", "codex:ux-3"]);
  await expect(tabs.getByRole("tab").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "会话列表", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".session-input-target")).toContainText(
    "中文会话 3",
  );
  await page.screenshot({ path: ".dev-runtime/session-tabs/list-desktop.png" });
  await page.getByRole("button", { name: "多会话网格", exact: true }).click();
  await page.screenshot({ path: ".dev-runtime/session-tabs/grid-desktop.png" });
  await page.getByRole("button", { name: "自由分屏", exact: true }).click();
  while (await tabs.getByRole("tab").count()) {
    const tab = tabs.getByRole("tab").first();
    await tab.hover();
    await tab
      .locator("..")
      .getByRole("button", { name: /^关闭标签：/ })
      .click();
  }
  await expect(tabs.getByRole("tab")).toHaveCount(0);
  await expect(
    page.locator(".session-agent-view [contenteditable=true]"),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.locator(".session-agent-view [contenteditable=true]"),
  ).toBeVisible();
  await expect(tabs.getByRole("tab")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("many tabs scroll inside the header and legacy cards do not flood the new tab set", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installSessionUxFixture(page, 20);
  await page.addInitScript(() => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 4,
        state: {
          cards: [
            { kind: "codex", id: "legacy-unfollowed", preview: "以前打开过" },
          ],
          cardsViewMode: "solo",
        },
      }),
    );
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await expect(
    page.getByRole("tablist", { name: "关注会话" }).getByRole("tab"),
  ).toHaveCount(0);
  await seedSessionUx(page, 20);
  await page.evaluate(async () => {
    const { navigateToAgentSession } =
      await import("/src/session-mode/lib/agentNav.ts");
    for (let i = 0; i < 20; i++)
      navigateToAgentSession({
        agent: "codex",
        threadId: `ux-${i}`,
        cwd: "/fixture",
      });
  });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("tablist", { name: "关注会话" })).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: "关注会话" }).getByRole("tab"),
    ).toHaveCount(20);
    expect(
      await page
        .locator(".session-tab-strip")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      `viewport ${width}`,
    ).toBe(true);
    expect(
      await page
        .locator(".session-tabs")
        .first()
        .evaluate(
          (el) => el.getBoundingClientRect().right <= window.innerWidth + 1,
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: ".dev-runtime/session-tabs/narrow-tabs.png" });
});
