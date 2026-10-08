import { test, expect, type Page } from '@playwright/test';
import { installSessionUxFixture } from './session-ux-fixture';
async function setup(page: Page) {
  const fixture = await installSessionUxFixture(page, 2);
  const urls: Record<string,string> = {};
  page.on('request', r => { const path = new URL(r.url()).pathname; if (path.includes('/src/session-mode/')) urls[path] = r.url(); });
  const cards = fixture.threads.map(t => ({kind:'codex',id:t.id,cwd:t.cwd,preview:t.name}));
  await page.route('**/api/session/tabs', route => route.fulfill({json:{cards,initialized:true,revision:1,sequence:route.request().method()==='POST'?route.request().postDataJSON().operations?.at(-1)?.seq??0:0}}));
  await page.addInitScript(cards => {
    if (!localStorage.getItem('kanban.session.agent-center-store')) localStorage.setItem('kanban.session.agent-center-store',JSON.stringify({version:5,state:{cards,currentAgentCardId:'ux-0',currentAgentCardKind:'codex',cardsViewMode:'solo',sharedTabsInitialized:true}}));
  },cards);
  const errors:string[]=[]; page.on('pageerror',e=>{errors.push(e.message); console.error('pageerror',e.message);});
  await page.goto('/?mode=session',{waitUntil:'domcontentloaded'});
  await page.locator('.session-agent-view [contenteditable=true]').first().waitFor();
  return {fixture, errors, urls};
}
async function push(page:Page, urls:Record<string,string>, events:any[]) {
  await page.evaluate(async ({url,events})=>{
    const {useCodexStore}=await import(url);
    for(const e of events) useCodexStore.getState().addEvent('ux-0',e);
  },{url:urls['/src/session-mode/components/codex/stores/index.ts'],events});
}
const status=(type:string)=>({method:'thread/status/changed',params:{threadId:'ux-0',status:{type,activeFlags:[]}}});
const turn=(method:string,id:string,state:string,startedAt:number)=>({method,params:{threadId:'ux-0',turn:{id,status:state,startedAt,items:[],durationMs:state==='inProgress'?null:100,error:null}}});

test('completion, late events, failure and retry keep composer and tab consistent',async({page})=>{
 const f=await setup(page);const editor=page.locator('.session-agent-view [contenteditable=true]').first();
 const tab=page.locator('[role=tab][data-tab-key="codex:ux-0"]');
 await editor.fill('保留当前草稿');
 await push(page,f.urls,[status('active'),turn('turn/started','old','inProgress',1)]);
 await expect(tab.locator('[data-state=running]')).toBeVisible();
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeVisible();
 await push(page,f.urls,[turn('turn/completed','old','completed',1)]);
 await expect(tab.locator('[data-state=running]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeVisible();
 await push(page,f.urls,[turn('turn/started','new','inProgress',2),turn('turn/started','old','inProgress',1)]);
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeVisible();
 await push(page,f.urls,[{method:'error',params:{threadId:'ux-0',turnId:'old',willRetry:false,error:{message:'old failure'}}}]);
 await expect(page.getByRole('button',{name:'停止生成',exact:true})).toBeVisible();
 await push(page,f.urls,[{method:'error',params:{threadId:'ux-0',turnId:'new',willRetry:false,error:{message:'capacity'}}}]);
 await expect(tab.locator('[data-state=failed]')).toBeVisible();
 await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeVisible();
 await expect(editor).toHaveText('保留当前草稿');
 expect(f.errors).toEqual([]);
});
for(const width of [390,1440]) test(`theme switch preserves draft, selection and persisted preference (${width}px)`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await setup(page);
 const editor=page.locator('.session-agent-view [contenteditable=true]').first();
 await editor.fill('主题切换不丢草稿');
 await page.getByRole('button',{name:'切换为浅色模式'}).click();
 await expect(page.locator('.session-mode')).toHaveClass(/light/);
 await page.screenshot({path:`.dev-runtime/state-audit/light-${width}.png`,fullPage:true});
 await expect(editor).toHaveText('主题切换不丢草稿');
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('.session-mode')).toHaveClass(/light/);
 await expect(editor).toHaveText('主题切换不丢草稿');
 await expect(page.locator('[role=tab][data-tab-key="codex:ux-0"]')).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'切换为深色模式'}).click();
 await expect(page.locator('.session-mode')).toHaveClass(/dark/);
 await page.screenshot({path:`.dev-runtime/state-audit/dark-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('pending snapshot restores permission card after reload and a failed reply remains visible',async({page})=>{
 const f=await setup(page);
 const request={threadId:'ux-0',turnId:'t',itemId:'permission',requestId:18,cwd:'/fixture',permissions:{},reason:'审批恢复验收'};
 const snapshot=async()=>page.evaluate(async({url,request})=>{
   const {reconcileCodexRequests}=await import(url);
   reconcileCodexRequests([{event:'codex/permissions-request',payload:request}]);
 },{url:f.urls['/src/session-mode/components/codex/hooks/serverRequests.ts'],request});
 await snapshot();await expect(page.getByText('审批恢复验收',{exact:true})).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('.session-agent-view [contenteditable=true]').first().waitFor();
 await snapshot();await expect(page.getByText('审批恢复验收',{exact:true})).toBeVisible();
 let replies=0;await page.route('**/api/session/api/codex/approval/permissions',async route=>{replies++;await route.abort('connectionfailed');});
 const card=page.getByText('审批恢复验收',{exact:true}).locator('..');
 await card.getByRole('button').first().click();
 await expect(page.getByRole('button',{name:'核对状态',exact:true})).toBeVisible();
 await expect(page.getByText('审批恢复验收',{exact:true})).toBeVisible();
 await card.getByRole('button').filter({hasNotText:'核对状态'}).first().click();
 expect(replies).toBe(1);
 expect(f.errors).toEqual([]);
});
