import { test, expect } from '@playwright/test';
import { installSessionUxFixture } from './session-ux-fixture';

test('a sent message that fails recovers its native echo and shows the persisted error after reload', async ({page}) => {
  const fixture = await installSessionUxFixture(page, 1);
  const cards = fixture.threads.map(t => ({kind:'codex',id:t.id,cwd:t.cwd,preview:t.name}));
  await page.route('**/api/session/tabs', route => route.fulfill({json:{cards,initialized:true,revision:1,sequence:0}}));
  await page.addInitScript(cards => {
    localStorage.setItem('kanban.session.agent-center-store', JSON.stringify({version:5,state:{cards,currentAgentCardId:'ux-0',currentAgentCardKind:'codex',cardsViewMode:'solo',sharedTabsInitialized:true}}));
  },cards);
  const urls: Record<string,string> = {};
  page.on('request', r => {const path = new URL(r.url()).pathname; if(path.includes('/src/session-mode/')) urls[path] = r.url();});
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?mode=session', {waitUntil:'domcontentloaded'});
  const editor = page.locator('.session-agent-view [contenteditable=true]').first();
  await editor.fill('请问刚刚做了什么？');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await expect(page.getByText('已接收，等待消息同步',{exact:true})).toBeVisible();
  const submission = fixture.calls.find(c => c.path.endsWith('/followups/submit'))!.body;
  const turn = {id:'ux-turn-ux-0',status:'failed',startedAt:2,completedAt:7,durationMs:5000,items:[],error:{message:JSON.stringify({error:{message:"Invalid 'input[1853].arguments': string too long. Expected maximum length 1048576, got length 2815158."}})}};
  // Simulate a missing userMessage SSE event. Only a read-only history rejoin
  // can recover the native clientId, which must remove the optimistic echo.
  let refreshes = 0;
  await page.route('**/api/session/api/codex/thread/resume', async route => {
    refreshes++;
    await route.fulfill({json:{thread:{...fixture.threads[0],status:{type:'systemError'},turns:[{...turn,items:[{id:'native',type:'userMessage',clientId:submission.id,content:[{type:'text',text:submission.text,text_elements:[]}]}]}]}}});
  });
  await page.evaluate(async ({url,turn}) => {
    const {useCodexStore} = await import(url);
    useCodexStore.getState().addEvent('ux-0',{method:'turn/completed',params:{threadId:'ux-0',turn}});
  },{url:urls['/src/session-mode/components/codex/stores/index.ts'],turn});
  await expect(page.getByRole('alert').filter({hasText:'历史工具调用参数过长'})).toBeVisible();
  await expect(page.locator('[data-delivery-echo]')).toHaveCount(0);
  await expect(page.getByText('请问刚刚做了什么？',{exact:true})).toHaveCount(1);
  expect(refreshes).toBe(1);
  expect(fixture.calls.filter(c => c.path.endsWith('/followups/submit'))).toHaveLength(1);
  expect(fixture.calls.filter(c => c.path.endsWith('/turn/start') || c.path.endsWith('/turn/steer'))).toHaveLength(0);
  await page.screenshot({path:'.dev-runtime/failed-session-recovery/failure-visible.png',fullPage:true});
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('alert').filter({hasText:'历史工具调用参数过长'})).toBeVisible();
  await expect(page.getByText('请问刚刚做了什么？',{exact:true})).toHaveCount(1);
  await expect(page.getByText('已接收，等待消息同步',{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
