import { test, expect, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

async function setup(page: Page) {
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map(t => ({kind:"codex",id:t.id,cwd:t.cwd,preview:t.name}));
  await page.route("**/api/session/tabs",route => route.fulfill({json:{cards,initialized:true,revision:1,sequence:0}}));
  await page.addInitScript(cards => {
    localStorage.setItem("kanban.session.agent-center-store",JSON.stringify({version:5,state:{cards,currentAgentCardId:"ux-0",currentAgentCardKind:"codex",cardsViewMode:"solo",sharedTabsInitialized:true}}));
  },cards);
  const access = {state:"readonly",reason:"",generation:1};
  const requests: any[] = [];
  await page.route("**/api/session/api/codex/thread/access", async route => {
    const request=route.request().postDataJSON();requests.push(request);
    if(request.release && access.state === "readonly") {access.state="releasing";access.reason="等待原生服务关闭并释放写锁";}
    await route.fulfill({json:access});
  });
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});
  const editor=page.locator(".session-agent-view [contenteditable=true]").first();
  await editor.waitFor();
  return {fixture,access,requests,errors,editor};
}

test("navigation and refresh read history without acquiring; draft survives", async ({page}) => {
  const f=await setup(page);
  await expect(page.locator("[data-codex-access=readonly]")).toBeVisible();
  await f.editor.fill("交接前保留的草稿");
  await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
  await page.locator('[role=tab][data-tab-key="codex:ux-0"]').click();
  await expect(f.editor).toHaveText("交接前保留的草稿");
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(f.editor).toHaveText("交接前保留的草稿");
  const reads = f.fixture.calls.filter(c=>c.path.endsWith("/thread/read")).length;
  expect(reads).toBeGreaterThan(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.fixture.calls.filter(c=>c.path.endsWith("/thread/read")).length).toBeGreaterThan(reads);
  expect(f.fixture.calls.filter(c=>c.path.endsWith("/thread/resume") || c.path.endsWith("/turn/start"))).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("manual release waits for confirmation and never interrupts", async ({page}) => {
  const f=await setup(page);
  await f.editor.fill("释放时也保留草稿");
  await page.getByRole("button",{name:"当前会话的更多操作",exact:true}).click();
  await page.getByRole("menuitem",{name:"释放给其他客户端",exact:true}).click();
  await expect(page.locator("[data-codex-access=releasing]")).toContainText("等待原生服务");
  expect(f.requests.filter(r=>r.release)).toEqual([{threadId:"ux-0",release:true}]);
  await expect(f.editor).toHaveText("释放时也保留草稿");
  f.access.state="readonly";f.access.reason="";
  await expect(page.locator("[data-codex-access=readonly]")).toBeVisible();
  expect(f.fixture.calls.filter(c=>/turn\/(interrupt|start)|thread\/resume/.test(c.path))).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("background resource holds and external ownership remain explanatory, preserving input", async ({page}) => {
  const f=await setup(page);
  await f.editor.fill("尚未发送的完整内容");
  f.access.state="owned";f.access.reason="会话仍有后台终端，释放会结束这些进程";
  await page.getByRole("button",{name:"当前会话的更多操作",exact:true}).click();
  await page.getByRole("menuitem",{name:"释放给其他客户端",exact:true}).click();
  await expect(page.locator("[data-codex-access=owned]")).toContainText("后台终端");
  f.access.state="external";
  await expect(page.locator("[data-codex-access=external]")).toContainText("其他客户端正在使用");
  await expect(f.editor).toHaveText("尚未发送的完整内容");
  expect(f.fixture.calls.filter(c=>/turn\/(interrupt|start)|thread\/resume/.test(c.path))).toEqual([]);
  expect(f.errors).toEqual([]);
});
