import {expect,test} from '@playwright/test';
import {installSessionUxFixture,seedSessionUx} from './session-ux-fixture';
for(const width of [375,1440])test(`new chat follows external configuration and preserves manual intent ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await installSessionUxFixture(page,0);
 let configured='houmo/h200';let reads=0;
 await page.route('**/api/codex/model/config/read',r=>{reads++;return r.fulfill({json:{status:'ready',model:configured,modelProvider:'magpie',reasoningEffort:'high'}})});
 await page.goto('/?mode=session',{waitUntil:'domcontentloaded'});
 await page.locator('.session-mode [contenteditable=true]').first().waitFor();
 await seedSessionUx(page,0);
 await page.evaluate(async()=>{
  const path='/src/session-mode/components/codex/stores/useConfigStore.ts';
  const {useConfigStore}=await import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===path)?.name??path);
  useConfigStore.getState().setModelSelectionMode('follow-config');
 });
 const trigger=page.getByRole('button',{name:'跟随配置 · houmo/h200'}).first();
 await expect(trigger).toBeVisible();
 configured='custom/next';
 await trigger.click();
 await expect(page.getByRole('status').filter({hasText:'配置模型：custom/next'})).toBeVisible();
 await page.getByRole('menuitem',{name:'固定使用 custom/next'}).click();
 await expect(page.getByRole('button',{name:/^模型：custom\/next/}).first()).toBeVisible();
 expect(reads).toBeGreaterThanOrEqual(2);
});

test('Magpie models absent from native catalog can be selected with their provider',async({page})=>{
 await installSessionUxFixture(page,0);
 await page.route('**/model-catalog/magpie',r=>r.fulfill({json:{provider:'magpie',models:[{id:'houmo/h200'},{id:'kimi/k3'}]}}));
 await page.goto('/?mode=session',{waitUntil:'domcontentloaded'});
 await page.locator('.session-mode [contenteditable=true]').first().waitFor();
 await seedSessionUx(page,0);
 await page.getByRole('button',{name:/^(模型：|跟随配置)/}).first().click();
 await expect(page.getByRole('menuitem',{name:'kimi/k3',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'kimi/k3',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{
  const path='/src/session-mode/components/codex/stores/useConfigStore.ts';
  const {useConfigStore}=await import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===path)?.name??path);
  const s=useConfigStore.getState();return {model:s.model,provider:s.modelProvider,mode:s.modelSelectionMode};
 })).toEqual({model:'kimi/k3',provider:'magpie',mode:'manual'});
});

test("new chat shows the native default when the configured model is null", async ({
  page,
}) => {
  await installSessionUxFixture(page, 0);
  let reads = 0;
  let releaseConfigRead: (() => void) | undefined;
  const pendingConfigRead = new Promise<void>((resolve) => {
    releaseConfigRead = resolve;
  });
  await page.route("**/api/codex/model/config/read", async (route) => {
    reads++;
    await pendingConfigRead;
    return route.fulfill({
      json: {
        status: "ready",
        model: null,
        modelProvider: null,
        reasoningEffort: null,
      },
    });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 0);
  await expect.poll(() => reads).toBeGreaterThan(0);
  const loadingTrigger = page.getByRole("button", {
    name: "跟随配置 · 读取中…",
  });
  await expect(loadingTrigger).toBeVisible();
  await expect(loadingTrigger).toHaveAttribute("aria-busy", "true");
  releaseConfigRead?.();
  const trigger = page.getByRole("button", {
    name: "跟随配置 · 原生默认",
  });
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveAttribute("aria-busy");
});
