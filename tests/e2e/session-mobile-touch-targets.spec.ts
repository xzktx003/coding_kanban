import { expect, test, type Locator } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds?.width, "touch target width").toBeGreaterThanOrEqual(44);
  expect(bounds?.height, "touch target height").toBeGreaterThanOrEqual(44);
  expect(
    await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return Boolean(hit && (hit === element || element.contains(hit)));
    }),
  ).toBe(true);
}

test("new-chat banner actions have reliable touch targets", async ({
  page,
}) => {
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 0);

  const banner = page.locator(".session-multi-agent-banner");
  await expect(banner).toBeVisible();
  await expectTouchTarget(banner.getByRole("button", { name: "立即试用" }));
  await expectTouchTarget(
    banner.getByRole("button", { name: "关闭子代理提示" }),
  );
  await expectTouchTarget(page.getByRole("button", { name: "Codex 菜单" }));
});

test("the new-chat banner stays compact and readable at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 0);

  const banner = page.locator(".session-multi-agent-banner");
  await expect(banner).toBeVisible();
  expect((await banner.boundingBox())?.height).toBeLessThanOrEqual(145);
  const title = banner.getByRole("heading", { name: "Codex 子代理" });
  await expect(title).toBeVisible();
  expect((await title.boundingBox())?.height).toBeLessThanOrEqual(22);
  expect(
    (await banner.locator(".session-multi-agent-banner-copy").boundingBox())
      ?.width,
  ).toBeGreaterThanOrEqual(220);
  await expectTouchTarget(banner.getByRole("button", { name: "立即试用" }));
  await expectTouchTarget(
    banner.getByRole("button", { name: "关闭子代理提示" }),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("project details in session tabs remain easy to tap", async ({ page }) => {
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .findLast((entry) =>
        new URL(entry.name).pathname.endsWith(
          "/src/session-mode/stores/useAgentCenterStore.ts",
        ),
      )?.name;
    if (!url) throw new Error("Agent center store not loaded");
    const { useAgentCenterStore } = await import(url);
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "touch target fixture",
      },
      { activate: true },
    );
  });

  await expect(
    page.locator(".session-tab .session-identity-project-static"),
  ).toBeVisible();
  await expect(
    page.locator(".session-tab button.session-identity-project"),
  ).toBeHidden();
  const actions = page.getByRole("button", { name: /标签操作：/ }).first();
  await expectTouchTarget(actions);
  await actions.click();
  await expect(page.getByRole("menu")).toContainText(
    "/fixture/项目/very-long-project-path-for-ui-regression",
  );
  await expect(
    page.getByRole("menuitem", { name: "在侧栏定位项目" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "复制项目路径" }),
  ).toBeVisible();
});

test("project sidebar actions have reliable touch targets", async ({
  page,
}) => {
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page.getByRole("button", { name: "展开项目列表" }).click();

  const sidebar = page.locator(".session-sidebar-projects");
  await expect(sidebar).toBeVisible();
  for (const control of [
    sidebar.getByRole("button", { name: "会话排序" }),
    sidebar.getByRole("button", { name: "历史项目" }),
    sidebar.getByTitle("添加项目"),
  ])
    await expectTouchTarget(control);

  const projectActions = page
    .locator(".session-project-group")
    .first()
    .locator(".session-project-action");
  await expect(projectActions.first()).toBeVisible();
  for (let index = 0; index < (await projectActions.count()); index += 1)
    await expectTouchTarget(projectActions.nth(index));
  expect(
    await sidebar.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test("choosing a conversation closes the mobile project drawer", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 2);
  await page.getByRole("button", { name: "展开项目列表" }).click();

  const sidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
  await expect(sidebar).toBeVisible();
  const rows = page.locator(
    ".session-sidebar-projects .session-nav-row[role='button']",
  );
  await expect(rows).toHaveCount(2);
  await rows.first().locator(".session-row-menu").click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar).toBeVisible();
  await rows.nth(1).click();
  await expect(sidebar).toBeHidden();
  await expect(page.locator(".session-composer-form")).toBeVisible();
  expect(
    fixture.calls.some((call) =>
      /\/thread\/(start|resume)$|\/turn\/start$|\/followups\/submit$/.test(
        call.path,
      ),
    ),
  ).toBe(false);
});
