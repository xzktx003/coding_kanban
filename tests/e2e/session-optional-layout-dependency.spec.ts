import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test(`closed layout panels cannot block a usable composer at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 1);
    await page.addInitScript(() => localStorage.setItem("kanban.session.layout-storage", JSON.stringify({ version: 0, state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false } })));
    const requested: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/src\/session-mode\/components\/layout\/(?:AppSidebar|RightPanel)\.tsx/, async route => {
      requested.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    });
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
      await expect(editor).toBeVisible({ timeout: 5000 });
      await seedSessionUx(page, 1, { sidebarOpen: false });
      await editor.fill("Keep the target and draft while project navigation loads");
      expect(requested).toEqual([]);
      await page.getByRole("button", { name: "展开项目列表", exact: true }).first().click();
      await expect.poll(() => requested.some(path => path.endsWith("/AppSidebar.tsx"))).toBe(true);
      await expect(page.getByRole("status").filter({ hasText: "正在加载项目列表" })).toBeVisible();
      await expect(editor).toHaveText("Keep the target and draft while project navigation loads");
      release();
      await expect(page.getByRole("button", { name: "搜索和管理会话", exact: true })).toBeVisible();
      if (width < 768) await page.getByRole("button", { name: "收起项目列表", exact: true }).click();
      else await page.getByRole("button", { name: "收起项目列表", exact: true }).first().click();
      await expect(editor).toHaveText("Keep the target and draft while project navigation loads");
    } finally { release(); }
  });
}

test("a failed optional right-panel module leaves the visible target and editable draft mounted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installSessionUxFixture(page, 1);
  await page.addInitScript(() => localStorage.setItem("kanban.session.layout-storage", JSON.stringify({ version: 0, state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false } })));
  let requests = 0;
  await page.route(/\/src\/session-mode\/components\/layout\/RightPanel\.tsx/, route => { requests++; return route.fulfill({ status: 503, contentType: "text/javascript", body: "export const unavailable = true;" }); });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await seedSessionUx(page, 1, { sidebarOpen: false });
  await editor.fill("Preserve the draft after a tool module fails");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "文件浏览器", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "工具面板暂时无法加载" })).toBeVisible();
  await expect(editor).toHaveText("Preserve the draft after a tool module fails");
  await page.getByRole("button", { name: "关闭此面板", exact: true }).click();
  await editor.fill("Still editable after closing the failed tool");
  await expect(editor).toHaveText("Still editable after closing the failed tool");
});

test("Git actions do not wait for an unrelated animated counter module", async ({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await installSessionUxFixture(page,1);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/framer-motion\.js(?:\?|$)/,async route=>{await held;await route.continue();});
  try{
    await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});
    const editor=page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible();
    await seedSessionUx(page,1,{sidebarOpen:false});
    await editor.fill("Keep draft while counters are unavailable");
    await page.getByRole("button",{name:"Git 操作",exact:true}).click({timeout:5000});
    await expect(page.getByRole("menuitem",{name:"提交更改…",exact:true})).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveText("Keep draft while counters are unavailable");
  }finally{release();}
});
