import { expect, test } from '@playwright/test';
import { installSessionUxFixture, seedSessionUx } from './session-ux-fixture';

test('Magpie history remains in the project sidebar after a list reload', async ({page}) => {
  await installSessionUxFixture(page, 0);
  let allProviderReads = 0;
  await page.route('**/api/codex/thread/list', async route => {
    const params = route.request().postDataJSON();
    const all = Array.isArray(params.modelProviders) && params.modelProviders.length === 0;
    if (all) allProviderReads++;
    await route.fulfill({json:{data:all ? [{
      id:'magpie-new-history', name:'Magpie新建对话', preview:'列表回归',
      modelProvider:'magpie', cwd:'/fixture/项目/very-long-project-path-for-ui-regression',
      createdAt:1, updatedAt:2, source:'cli', status:{type:'idle'}, turns:[],
    }] : [],nextCursor:null}});
  });
  await page.goto('/?mode=session',{waitUntil:'domcontentloaded'});
  await page.locator('.session-mode [contenteditable=true]').first().waitFor();
  await seedSessionUx(page,0);
  await expect(page.getByText('Magpie新建对话',{exact:true}).first()).toBeVisible();
  await page.evaluate(async () => {
    const path='/src/session-mode/services/codexService.ts';
    const {codexService}=await import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===path)?.name??path);
    await codexService.loadThreads('/fixture/项目/very-long-project-path-for-ui-regression');
  });
  await expect(page.getByText('Magpie新建对话',{exact:true}).first()).toBeVisible();
  expect(allProviderReads).toBeGreaterThan(1);
});
