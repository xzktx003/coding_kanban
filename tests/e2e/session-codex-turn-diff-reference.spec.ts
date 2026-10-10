import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const unifiedDiff = "diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -42 +42 @@\n-old\n+new\n";
for (const theme of ["dark", "light"]) test(`actual original one-file footer header and separate affordances (${theme})`, async ({ page }, info) => {
  test.skip(!reference, "Requires readonly original VSIX reference URL");
  test.setTimeout(90000);
  const native=await page.context().newPage();
  const host=theme==="dark" ? {bg:"#20211d",secondary:"#282a23",fg:"#ccc",muted:"#858585",added:"#81b88b",removed:"#c74e39"} : {bg:"#fff",secondary:"#f5f5f3",fg:"#3b3b3b",muted:"#717171",added:"#587c0c",removed:"#ad0707"};
  await native.route("**/*",route=>new URL(route.request().url()).origin===new URL(reference!).origin ? route.continue() : route.abort());
  await native.setViewportSize({width:700,height:400});await native.goto(reference!);await native.waitForFunction(()=>(window as any).nativeLoaded);
  await native.evaluate(async ({theme,host})=>{
    document.documentElement.setAttribute("data-theme",theme);document.body.style.background=host.bg;document.body.style.color=host.fg;
    for(const [key,value] of Object.entries({"font-family":"system-ui","editor-background":host.bg,"sideBar-background":host.secondary,foreground:host.fg,descriptionForeground:host.muted,"gitDecoration-addedResourceForeground":host.added,"gitDecoration-deletedResourceForeground":host.removed})) document.documentElement.style.setProperty(`--vscode-${key}`,value);
    const S=await import(/* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js");S.v();S.U();
    (window as any).renderNativeElement(S._,{children:(window as any).nativeModules.React.createElement("span",{},"footer initialized")});
  },{theme,host});
  await native.getByText("footer initialized",{exact:true}).waitFor();
  await native.evaluate(async ({unifiedDiff})=>{
    const S=await import(/* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"),A=await import(/* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js"),P=await import(/* @vite-ignore */ "./native/assets/sites-end-resource-39518ab206b4.js");P.M();A.zpt();const {React:R,Dst}=(window as any).nativeModules;
    const footer=R.createElement(P.j,{isInProgress:false,item:{unifiedDiff,patchBatches:null},conversationId:"fixture",cwd:"/fixture",hostId:"local",showRevertButton:false});
    (window as any).renderNativeElement(S._,{children:R.createElement(A.Rpt.Provider,{value:{requiresAuth:false,isLoading:false,authMethod:null}},R.createElement(S.H,{},R.createElement(Dst,{scope:S.l1t,value:{conversationId:"fixture",hostId:"local"}},R.createElement(Dst,{scope:S.W$t,value:{kind:"local"}},footer))))});
    setTimeout(()=>S.s5t.dispatchHostMessage({type:"persisted-atom-sync",state:{},canWritePrimaryWindowTabPersistence:false}),30);
  },{unifiedDiff});
  await native.getByText("已编辑 source.ts",{exact:true}).waitFor();
  await installSessionUxFixture(page);await page.setViewportSize({width:700,height:400});await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({timeout:60000});
  await page.evaluate(async ({theme,host,unifiedDiff})=>{
    const Rm=await import((window as any).__sessionFixtureDependency("react.js")),Dm=await import((window as any).__sessionFixtureDependency("react-dom_client.js")),M=await import("/src/session-mode/components/codex/items/ThreadFileChangesSummary.tsx");const R=Rm.default??Rm,{createRoot}=Dm.default??Dm;
    document.getElementById("root")!.style.display="none";document.body.style.margin="0";document.body.style.background=host.bg;document.body.style.color=host.fg;
    const fixture=document.createElement("div");fixture.id="footer-product-reference";fixture.className=`session-mode ${theme==="dark"?"dark":""}`;fixture.style.cssText="width:616px;padding:16px;box-sizing:border-box;min-height:400px";
    for(const [key,value] of Object.entries({"font-family":"system-ui","editor-background":host.bg,"sideBar-background":host.secondary,foreground:host.fg,descriptionForeground:host.muted,"gitDecoration-addedResourceForeground":host.added,"gitDecoration-deletedResourceForeground":host.removed}))fixture.style.setProperty(`--vscode-${key}`,value);
    document.body.append(fixture);createRoot(fixture).render(R.createElement("div",{className:"codex-presentation"},R.createElement(M.ThreadFileChangesSummary,{changes:[{path:"/fixture/source.ts",kind:{type:"update",move_path:null},diff:unifiedDiff,addedCount:1,removedCount:1}]})));
  },{theme,host,unifiedDiff});
  await expect(page.locator(".codex-turn-diff-title-text")).toHaveText("已编辑 source.ts");
  const original=await native.evaluate(()=>{
    const title=[...document.querySelectorAll<HTMLElement>("span")].find(e=>e.textContent==="已编辑 source.ts"&&e.children.length===0)!;
    const header=document.querySelector<HTMLElement>('[class*="group/turn-diff-header"]')!;
    const metric=(e:HTMLElement)=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,color:s.color,padding:s.padding}};
    return{title:metric(title),header:metric(header),card:metric(header.parentElement!),subtitle:metric(title.nextElementSibling as HTMLElement)};
  });
  const product=await page.evaluate(()=>{
    const metric=(e:HTMLElement)=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,color:s.color,padding:s.padding}};
    return{title:metric(document.querySelector<HTMLElement>(".codex-turn-diff-title-text")!),header:metric(document.querySelector<HTMLElement>(".codex-turn-diff-header")!),card:metric(document.querySelector<HTMLElement>(".codex-turn-diff-summary")!),subtitle:metric(document.querySelector<HTMLElement>(".codex-turn-diff-subtitle")!),lowerRows:document.querySelectorAll(".session-file-change-row").length};
  });
  await writeFile(info.outputPath(`footer-${theme}-metrics.json`),JSON.stringify({original,product,note:"Product retains explicit preview and authoritative Undo controls; complete component pixels remain a separate gate."},null,2));
  expect(product.lowerRows).toBe(0);expect(product.header.height).toBe(original.header.height);expect(product.title.font).toBe(original.title.font);expect(product.title.x).toBe(original.title.x);expect(product.title.y).toBe(original.title.y);expect(product.subtitle.height).toBe(original.subtitle.height);
  await native.screenshot({path:info.outputPath(`native-footer-${theme}.png`)});await page.screenshot({path:info.outputPath(`product-footer-${theme}.png`)});await native.close();
});
