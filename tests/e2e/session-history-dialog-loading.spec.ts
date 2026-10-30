import {expect,test} from "@playwright/test";
import {installSessionUxFixture,seedSessionUx} from "./session-ux-fixture";
for(const width of [1440,393])test(`history project dialog loads after its first real gesture and a cancelled download never opens late at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:852});await installSessionUxFixture(page,1);
  await page.addInitScript(()=>localStorage.setItem("kanban.session.layout-storage",JSON.stringify({version:0,state:{view:"agent",isSidebarOpen:false,isRightPanelOpen:false}})));
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let requests=0;
  await page.route(/\/src\/session-mode\/features\/ProjectSelector\/HistoryProjectsDialog\.tsx/,async route=>{requests++;await held;await route.continue();});
  try{
    await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});const editor=page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible({timeout:5000});await seedSessionUx(page,1,{sidebarOpen:false});await editor.fill("Preserve draft while history project dialog is loading");expect(requests).toBe(0);
    await page.getByRole("button",{name:"展开项目列表",exact:true}).first().click();const trigger=page.getByRole("button",{name:"历史项目",exact:true});await expect(trigger).toBeVisible();expect(requests).toBe(0);
    await trigger.click();await expect.poll(()=>requests).toBe(1);await expect(page.getByRole("status").filter({hasText:"正在加载历史项目"})).toBeVisible();
    await page.getByRole("button",{name:"取消加载历史项目",exact:true}).click();release();
    await expect(page.getByRole("status").filter({hasText:"正在加载历史项目"})).toHaveCount(0);await expect(page.getByRole("dialog").filter({hasText:"Select a project"})).toHaveCount(0);
    await trigger.click();await expect(page.getByRole("dialog").filter({hasText:"Select a project"})).toBeVisible();
    await page.keyboard.press("Escape");await expect(page.getByRole("dialog").filter({hasText:"Select a project"})).toHaveCount(0);
    if(width<768)await page.getByRole("button",{name:"收起项目列表",exact:true}).first().click();
    await expect(editor).toHaveText("Preserve draft while history project dialog is loading");expect(requests).toBe(1);
  }finally{release();}
});
