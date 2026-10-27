import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
const output = ".dev-runtime/session-composer-parent-menu-20261027";
async function prepare(page: Page) {
  const fixture = await installSessionUxFixture(page, 2);
  const turns = Array.from({length:60},(_,i)=>({id:`parent-turn-${i}`,status:"completed",items:[{type:"userMessage",id:`parent-user-${i}`,clientId:null,content:[{type:"text",text:`用户消息 ${i} parent menu fixture`,text_elements:[]}]}],startedAt:1,durationMs:1000,error:null}));
  fixture.threads[0].turns = turns;
  await page.goto("/?mode=session&view=agent", { waitUntil: "domcontentloaded" });
  await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 2);
  await page.evaluate(async (turns) => {
    const load = (path: string) => import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
    const [{useCodexStore},{useLayoutStore},{useAgentCenterStore},{useSessionDraftStore,sessionDraftKey}] = await Promise.all([
      load("/src/session-mode/components/codex/stores/useCodexStore.ts"),load("/src/session-mode/stores/useLayoutStore.ts"),
      load("/src/session-mode/stores/useAgentCenterStore.ts"),load("/src/session-mode/stores/useSessionDraftStore.ts"),
    ]);
    useLayoutStore.setState({view:"agent",isSidebarOpen:false,isRightPanelOpen:false});
    useAgentCenterStore.getState().addAgentCard({kind:"codex",id:"ux-0",cwd:"/fixture/项目/very-long-project-path-for-ui-regression",preview:"Parent menu fixture"},{activate:true});
    useAgentCenterStore.setState({cardsViewMode:"solo"});
    useCodexStore.setState({currentThreadId:"ux-0",currentTurnId:null,threadStatusMap:{"ux-0":{type:"idle"}},events:{"ux-0":turns.flatMap(turn=>[...turn.items.map(item=>({method:"item/started",params:{threadId:"ux-0",turnId:turn.id,item}})),{method:"turn/completed",params:{threadId:"ux-0",turn}}])}});
    useSessionDraftStore.getState().setText(sessionDraftKey("codex","ux-0"),"Keep original owner draft");
  }, turns);
  await expect(page.locator('.session-codex-composer:visible')).toHaveAttribute('data-draft-owner',JSON.stringify(['codex','','session','ux-0']));
  return fixture;
}
for(const width of [390,1440]) test.describe(`${width}px parent menu`,()=>{
  test.use({viewport:{width,height:844},hasTouch:width===390,isMobile:width===390});
  const activate=(locator:Locator)=>width===390?locator.tap({timeout:4000}):locator.click({timeout:4000});
  async function action(page:Page,name:string){
    await activate(page.getByRole('button',{name:'附加文件',exact:true}));
    await activate(page.getByRole('button',{name:'当前会话的更多操作',exact:true}));
    await activate(page.getByRole('menuitem',{name,exact:true}));
  }
  test('selected navigation closes both menus and accepts the next real pointer/touch',async({page})=>{
    test.setTimeout(45000);const fixture=await prepare(page);await mkdir(output,{recursive:true});
    await action(page,'用户消息导航');
    try{
      await activate(page.locator('.codex-thread-user-navigation').getByRole('button',{name:/用户消息 59/}));
      await expect(page.getByRole('button',{name:'附加文件',exact:true})).toHaveAttribute('aria-expanded','false');
      await expect(page.locator('[data-slot=popover-content]:visible')).toHaveCount(0);
      await expect(page.locator('.codex-native-user[data-owner-turn="parent-turn-59"]')).toBeVisible();
      await activate(page.getByRole('button',{name:'关闭用户消息导航'}));
      await expect(page.locator('.session-codex-composer [contenteditable=true]').first()).toContainText('Keep original owner draft');
      expect(fixture.calls.filter(call=>/\/turn\/|\/archive|\/delete/.test(call.path))).toEqual([]);
    }finally{await page.screenshot({path:`${output}/navigation-${width}.png`,fullPage:true})}
  });
  test('closing the parent preserves the child confirmation until explicit cancel',async({page})=>{
    const fixture=await prepare(page);await action(page,'归档聊天');
    const sheet=page.getByRole('dialog',{name:'归档聊天',exact:true});
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('button',{name:'附加文件',exact:true,includeHidden:true})).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('[data-slot=popover-content]:visible')).toHaveCount(0);
    await activate(sheet.getByRole('button',{name:'返回',exact:true}));
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.session-codex-composer [contenteditable=true]').first()).toContainText('Keep original owner draft');
    expect(fixture.calls.filter(call=>/\/turn\/|\/archive|\/delete/.test(call.path))).toEqual([]);
    await action(page,'归档聊天');await expect(sheet).toBeVisible();await activate(sheet.getByRole('button',{name:'返回',exact:true}));
  });
  test('Escape returns through nested trigger and attachment trigger without running an action',async({page})=>{
    await prepare(page);const attach=page.getByRole('button',{name:'附加文件',exact:true});
    await activate(attach);const conversation=page.getByRole('button',{name:'当前会话的更多操作',exact:true});await activate(conversation);
    await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(attach).toHaveAttribute('aria-expanded','true');await expect(conversation).toBeFocused();
    await page.keyboard.press('Escape');await expect(attach).toHaveAttribute('aria-expanded','false');await expect(attach).toBeFocused();
    await activate(attach);await expect(page.getByRole('button',{name:'当前会话的更多操作',exact:true})).toBeVisible();
  });
});
