import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

const html = `<!doctype html><html><body><p id="ready">starting</p><p id="input"></p><p id="result"></p><p id="isolation"></p><button id="invoke">Update app</button><button id="forged">Forge parent call</button><script>
const rpc=(value)=>parent.postMessage({jsonrpc:'2.0',...value},'*');
try{void parent.parent.document.body;document.querySelector('#isolation').textContent='host accessible';}catch{document.querySelector('#isolation').textContent='isolated';}
window.addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data;if(message.id==='initialize'&&message.result){document.querySelector('#ready').textContent='ready';rpc({method:'ui/notifications/initialized'});}if(message.method==='ui/notifications/tool-input')document.querySelector('#input').textContent=JSON.stringify(message.params.arguments);if(message.method==='ui/notifications/tool-result')document.querySelector('#result').textContent='initial result';if(message.id==='call'&&message.result)document.querySelector('#result').textContent='updated result';});
document.querySelector('#invoke').onclick=()=>rpc({id:'call',method:'tools/call',params:{name:'show',arguments:{value:2}}});
document.querySelector('#forged').onclick=()=>top.postMessage({jsonrpc:'2.0',id:'forged',method:'tools/call',params:{name:'hidden',arguments:{}}},'*');
rpc({id:'initialize',method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'real sandbox fixture',version:'1'},appCapabilities:{availableDisplayModes:['inline']}}});
</script></body></html>`;
async function setup(page: Page, baseURL: string) {
  const fixture = await installSessionUxFixture(page, 1), stream = await liveStream(page, baseURL);
  (fixture.threads[0].turns as unknown[]).push({ id:"app-turn",status:"completed",error:null,startedAt:1,completedAt:2,durationMs:5,items:[{ type:"mcpToolCall",id:"app-item",server:"local",tool:"show",status:"completed",arguments:null,result:null,error:null,appContext:{connectorId:"local",appName:"Example",resourceUri:"ui://example"},transcriptMetadataOnly:true,durationMs:5 }] });
  const requests: Array<{ action: string; body: any }> = [];
  await page.route("**/api/codex/mcp/app/*", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().postDataJSON(); requests.push({ action, body });
    if (action === "context") {
      expect(body).toEqual({ threadId: "ux-0", turnId: "app-turn", itemId: "app-item" });
      return route.fulfill({ json: { contextToken: "a".repeat(64), identity: "b".repeat(64), server: "local", tool: "show", resourceUri: "ui://example", html, csp: {}, toolInput: { captured: "original" }, toolResult: { content: [{ type: "text", text: "native result" }] }, toolInfo: { name: "show" } } });
    }
    if (action === "call") return route.fulfill({ json: { content: [{type:"text",text:"updated"}], isError:false } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path);
    useAgentCenterStore.getState().addAgentCard({kind:"codex",id:"ux-0",cwd:"/fixture/项目/very-long-project-path-for-ui-regression",preview:"MCP 应用验收"},{activate:true});
  });
  try { await Promise.race([page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({timeout:60000}), page.getByRole("heading", {name:"会话界面加载失败"}).waitFor({timeout:60000}).then(async()=>{await page.getByText("错误详情",{exact:true}).click(); throw new Error((await page.locator('[role="alert"]').innerText()).slice(0,2000));})]); }
  catch (error) { const detail = page.getByText("错误详情", {exact:true}); if (await detail.isVisible()) { await detail.click(); console.log((await page.locator('[role="alert"]').innerText()).slice(0,2000)); } throw error; }
  await page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path);
    const item = { type: "mcpToolCall", id: "app-item", server: "local", tool: "show", status: "completed", arguments: null, result: null, error: null, appContext: { connectorId: "local", appName: "Example", resourceUri: "ui://example" }, transcriptMetadataOnly: true, durationMs: 5 };
    useCodexStore.setState({ events: { "ux-0": [{ method: "item/completed", params: { threadId: "ux-0", turnId: "app-turn", item } }] }, historyLoadedMap: { "ux-0": true }, historyLoadingMap: {}, currentThreadId: "ux-0", turnTimingMap: { "ux-0": { turnId: "app-turn", status: "completed", startedAtMs: 1000, durationMs: 5 } } });
  });
  await page.getByRole("button", {name:"打开应用",exact:true}).or(page.getByRole("button", {name:/^用时/})).first().waitFor({timeout:15000});
  if (!(await page.getByRole("button", {name:"打开应用",exact:true}).isVisible())) {
    const activity = page.getByRole("button", {name:/^用时/}).first();
    if (await activity.isVisible()) await activity.click();
  }
  return { fixture, stream, requests };
}

for (const width of [1440, 393]) test(`MCP App exact source, real double iframe, explicit tool approval and cleanup at ${width}`, async ({ page, baseURL }, info) => {
  test.setTimeout(90_000); await page.setViewportSize({width,height:852});
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const { stream, requests } = await setup(page, baseURL!);
  try {
    expect(requests).toHaveLength(0);
    await page.getByRole("button", {name:"打开应用",exact:true}).click({timeout:15000});
    const outer = page.frameLocator('iframe[title="MCP 应用 show"]'), view = outer.frameLocator('iframe[title="MCP App"]');
    await expect(view.locator("#ready")).toHaveText("ready");
    await expect(view.locator("#input")).toContainText("original");
    await expect(view.locator("#isolation")).toHaveText("isolated");
    await expect(view.locator("#result")).toHaveText("initial result");
    await view.getByRole("button", {name:"Forge parent call"}).click();
    expect(requests.filter((value) => value.action === "call")).toHaveLength(0);
    await view.getByRole("button", {name:"Update app"}).click();
    await expect(page.getByRole("button", {name:"允许本次调用"})).toBeVisible();
    expect(requests.filter((value) => value.action === "call")).toHaveLength(0);
    await page.getByRole("button", {name:"允许本次调用"}).click();
    await expect(view.locator("#result")).toHaveText("updated result");
    expect(requests.filter((value) => value.action === "call")).toHaveLength(1);
    expect(requests.find((value) => value.action === "call")?.body).toMatchObject({contextToken:"a".repeat(64),tool:"show",arguments:{value:2},confirmed:true});
    await page.getByRole("button", {name:"关闭应用"}).click();
    await expect(page.locator('iframe[title="MCP 应用 show"]')).toHaveCount(0);
    await expect.poll(() => requests.filter((value) => value.action === "revoke").length).toBe(1);
    expect(errors).toEqual([]);
    await info.attach("mcp-app-browser-evidence", {body:JSON.stringify({width,actions:requests.map((value)=>value.action),pageErrors:errors}),contentType:"application/json"});
  } finally { await stream.close(); }
});

test("same-value account event revokes an open MCP App without resending a tool", async ({page,baseURL}) => {
  test.setTimeout(90_000);
  const {stream,requests}=await setup(page,baseURL!);
  try {
    await page.getByRole("button",{name:"打开应用",exact:true}).click();
    await expect(page.frameLocator('iframe[title="MCP 应用 show"]').frameLocator('iframe[title="MCP App"]').locator("#ready")).toHaveText("ready");
    const contextsBeforeAccountEvent=requests.filter((value)=>value.action==="context").length;
    stream.emit(1,{method:"account/updated",params:{authMode:null}});
    await expect(page.getByRole("alert").filter({hasText:"应用连接或账号已变化"})).toBeVisible();
    await expect(page.locator('iframe[title="MCP 应用 show"]')).toHaveCount(0);
    expect(requests.filter((value)=>value.action==="call")).toHaveLength(0);
    expect(requests.filter((value)=>value.action==="context")).toHaveLength(contextsBeforeAccountEvent);
  } finally {await stream.close();}
});
