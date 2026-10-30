import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("a restored exact input target is prepared while the optional application body is still loading", async ({ page }) => {
  const fixture=await installSessionUxFixture(page,1);
  const card={kind:"codex",id:"ux-0",cwd:fixture.threads[0].cwd,preview:"Prepared target"};
  await page.route("**/api/session/tabs",route=>route.fulfill({json:{cards:[card],initialized:true,revision:1,sequence:0}}));
  await page.addInitScript(card=>{
    localStorage.setItem("kanban.session.agent-center-store",JSON.stringify({version:5,state:{cards:[card],currentAgentCardId:card.id,currentAgentCardKind:card.kind,cardsViewMode:"solo",sharedTabsInitialized:true}}));
    localStorage.setItem("kanban.session.layout-storage",JSON.stringify({version:0,state:{view:"agent",isSidebarOpen:false,isRightPanelOpen:false}}));
  },card);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/src\/session-mode\/App\.tsx/,async route=>{await held;await route.continue();});
  try{
    await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});
    await expect(page.locator(".session-top-nav")).toBeVisible();
    await expect.poll(()=>page.evaluate(async()=>{
      const path="/src/session-mode/components/codex/stores/useCodexStore.ts";
      const {useCodexStore}=await import(performance.getEntriesByType("resource").findLast(row=>new URL(row.name).pathname===path)?.name??path);
      return useCodexStore.getState().currentThreadId;
    }),{timeout:5000}).toBe("ux-0");
    expect(fixture.calls.filter(call=>/\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork))$/.test(call.path))).toEqual([]);
    release();
    const composer=page.locator('.session-codex-composer[data-owner-thread="ux-0"]');
    await expect(composer.locator("[contenteditable=true]")).toBeVisible();
    await composer.locator("[contenteditable=true]").fill("Prepared without acquiring a task");
    await expect(composer.locator("[contenteditable=true]")).toHaveText("Prepared without acquiring a task");
  }finally{release();}
});
