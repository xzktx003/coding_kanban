import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { nativeNotifications } from "./session-native-notifications-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
for (const width of [390,700]) test(`native notification boundary resize and removal (${width})`, async ({page},info) => {
  test.skip(!reference,"Requires unchanged original notification providers");
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  const f = await setup(page,false), native = await page.context().newPage();
  try {
    await native.setViewportSize({width,height:900});
    await nativeNotifications(native,reference!,width,"dark");
    await native.evaluate(async () => {
      const S=await import(/* @vite-ignore */ "./native/assets/app-initial-e98b9eaef8e3.js"), Auth=await import(/* @vite-ignore */ "./native/assets/app-initial-3192ac99b6cd.js");
      const w=window as any,R=w.nativeModules.React;
      function Probe(){return R.createElement(Auth.ZK,{"data-testid":"native-boundary",style:{position:"fixed",left:24,right:40,top:60,bottom:30}},R.createElement(Auth.XK,null,"Boundary"));}
      w.renderNativeElement(S._,{children:R.createElement(Auth.Rpt.Provider,{value:{requiresAuth:false,isLoading:false,authMethod:null}},R.createElement(S.H,null,R.createElement(Probe)))});
    });
    await expect(native.getByTestId("native-boundary")).toBeVisible();
    await native.evaluate(()=> (window as any).showNativeNotice("info","Bounded notice",{duration:0}));
    await page.evaluate(async () => {
      const path="/src/session-mode/features/native-notifications/viewportBounds.ts";
      const m=await import(performance.getEntriesByType("resource").findLast(e=>new URL(e.name).pathname===path)?.name??path);
      const servicePath="/src/session-mode/features/native-notifications/service.tsx";
      const {nativeNotifications}=await import(performance.getEntriesByType("resource").findLast(e=>new URL(e.name).pathname===servicePath)?.name??servicePath);
      const element=document.createElement("div");element.id="test-notice-boundary";element.style.cssText="position:fixed;left:24px;right:40px;top:60px;bottom:30px;pointer-events:none";document.body.append(element);
      const w=window as any;w.removeBoundary=m.observeNotificationBoundary("test",element);w.boundaryRegistry=m.notificationViewportBounds;
      nativeNotifications.info("Bounded notice",{duration:0});
    });
    const metrics = (p:typeof page,selector:string) => p.locator(selector).evaluate(e=>{
      const area=e.getBoundingClientRect(),position=e.firstElementChild!.getBoundingClientRect();return {area:{x:area.x,y:area.y,width:area.width,height:area.height},position:{x:position.x,y:position.y,width:position.width,height:position.height}};
    });
    const compare=async()=>{const expected=await metrics(native,".codex-toast-area"),actual=await metrics(page,".codex-native-toast-area");await writeFile(info.outputPath("boundary-metrics.json"),JSON.stringify({expected,actual},null,2));expect(actual).toEqual(expected);};
    await expect.poll(()=>metrics(page,".codex-native-toast-area").then(m=>m.area.y)).toBe(60);
    await compare();
    await native.getByTestId("native-boundary").evaluate(e=>(e as HTMLElement).style.top="100px");
    await page.locator("#test-notice-boundary").evaluate(e=>(e as HTMLElement).style.top="100px");
    await expect.poll(()=>metrics(native,".codex-toast-area").then(m=>m.area.y)).toBe(100);
    await expect.poll(()=>metrics(page,".codex-native-toast-area").then(m=>m.area.y)).toBe(100);
    await compare();
    await native.screenshot({path:info.outputPath("native-boundary.png")}); await page.screenshot({path:info.outputPath("product-boundary.png")});
    await page.evaluate(()=>{const w=window as any;w.removeBoundary();document.getElementById("test-notice-boundary")?.remove();});
    await expect.poll(()=>metrics(page,".codex-native-toast-area").then(m=>m.area.y)).toBe(0);
    expect(f.errors).toEqual([]);
  } finally {await f.close();await native.close();}
});
