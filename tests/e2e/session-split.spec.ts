import { expect, test } from "@playwright/test";
import { chooseSessionLayout, installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("dragging tabs creates nested groups; moving, closing and reload preserve one input destination", async ({
  page,
}) => {
  test.setTimeout(90000);
  const fixture = await installSessionUxFixture(page, 4);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?mode=session");
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 4);
  for (const i of [0, 1, 2])
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${i} ` })
      .first()
      .click();
  fixture.threads[1].cwd = '/fixture/research';
  fixture.threads[2].cwd = '/fixture/kanban';
  await page.evaluate(async () => {
    const path='/src/session-mode/stores/useAgentCenterStore.ts';
    const {useAgentCenterStore}=await import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===path)?.name??path);
    for(const [id,cwd] of [['ux-1','/fixture/research'],['ux-2','/fixture/kanban']]) {
      const card=useAgentCenterStore.getState().cards.find(c=>c.id===id);
      useAgentCenterStore.getState().updateCard({...card,cwd});
    }
  });
  const groups = page.locator("[data-session-group]");
  await expect(groups).toHaveCount(1);
  const drop = async (
    key: string,
    targetIndex: number,
    side: "right" | "bottom" | "center",
  ) => {
    const tab = page.locator(`[data-tab-key="${key}"]`),
      target = groups.nth(targetIndex).locator("[data-session-group-body]");
    const box = (await target.boundingBox())!;
    await tab.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 10,
    });
    await page.mouse.move(
      side === "right" ? box.x + box.width - 8 : box.x + box.width / 2,
      side === "bottom" ? box.y + box.height - 8 : box.y + box.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
  };
  await drop("codex:ux-2", 0, "right");
  await expect(groups).toHaveCount(2);
  await drop("codex:ux-1", 0, "bottom");
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(1).getByRole('button',{name:'项目详情：research',exact:true})).toBeVisible();
  await expect(groups.nth(2).getByRole('button',{name:'项目详情：kanban',exact:true})).toBeVisible();
  const destination = (await page.locator('.session-input-target').textContent())!;
  await groups.nth(2).getByRole('button',{name:'项目详情：kanban',exact:true}).click();
  await expect(page.locator('.session-input-target')).toHaveText(destination);
  await page.keyboard.press('Escape');
  await page.screenshot({path:'.dev-runtime/project-context-v2/split.png',animations:'disabled'});
  const rectangles = await groups.evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }),
  );
  expect(rectangles[1].y).toBeGreaterThan(rectangles[0].y);
  expect(rectangles[2].x).toBeGreaterThan(rectangles[0].x);
  expect(rectangles[2].h).toBeGreaterThan(rectangles[0].h);
  await expect(
    page.locator(".session-agent-view [contenteditable=true]"),
  ).toHaveCount(1);
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  await expect(page.locator(".session-input-target")).toContainText(
    "中文会话 0",
  );
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .fill("隔离的分屏输入目标检查");
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .press("Enter");
  await expect
    .poll(
      () =>
        fixture.calls.filter((c) => c.path.endsWith("/followups/submit")).at(-1)?.body
          ?.threadId,
    )
    .toBe("ux-0");
  await page.reload();
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({
    path: ".dev-runtime/session-split/three-groups.png",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(groups.filter({ visible: true })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "全部关注会话与窗口组", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".session-group-switch")).toHaveCount(0);
  await expect(page.locator(".session-agent-header")).toHaveCount(0);
  const bodyBox = (await page
    .locator("[data-session-group-body]")
    .boundingBox())!;
  expect(bodyBox.height).toBeGreaterThan(900 * 0.6);
  console.log(`Mobile transcript height: ${Math.round(bodyBox.height)}/900px`);
  await expect(
    page.getByRole("button", { name: "更多功能", exact: true }),
  ).toBeVisible();
  const projectBox = (await page
    .getByRole("button", { name: "展开项目列表", exact: true })
    .boundingBox())!;
  const firstTabBox = (await page
    .locator(".session-tab-strip")
    .first()
    .boundingBox())!;
  expect(projectBox.y + projectBox.height).toBeLessThanOrEqual(firstTabBox.y);
  await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "添加项目", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  const menu = groups
    .filter({ visible: true })
    .getByRole("button", { name: /标签操作/ });
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "关闭标签" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "全部关注会话与窗口组", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "窗口组 3 · 1 个会话", exact: true })
    .click();
  await expect(page.locator('[data-tab-key="codex:ux-2"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".session-input-target")).toContainText(
    "中文会话 2",
  );
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "文件浏览器", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await page.screenshot({
    path: ".dev-runtime/session-split/mobile-compact.png",
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(
    page.getByRole("button", { name: "更多功能", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开项目列表", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  expect(
    (await page.locator("[data-session-group-body]").boundingBox())!.height,
  ).toBeGreaterThan(700 * 0.55);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await drop("codex:ux-1", 0, "center");
  await expect(groups).toHaveCount(2);
  await expect(page.locator('[data-tab-key="codex:ux-1"]')).toHaveCount(1);
  await chooseSessionLayout(page, "多会话网格");
  await chooseSessionLayout(page, "自由分屏");
  await expect(groups).toHaveCount(2);
  expect(errors).toEqual([]);
});
