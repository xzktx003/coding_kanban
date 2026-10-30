import { expect,test,type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { installSessionUxFixture,seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

async function nativeVoiceFixture(page:Page) {
  const require=createRequire(resolve("packages/session-runtime/package.json"));
  const child=spawn(process.execPath,[require.resolve("tsx/cli"),resolve("tests/e2e/helpers/realtime-native-browser-server.mts")],{stdio:["pipe","pipe","pipe"]});
  let stderr="",sequence=0,ready!:(origin:string)=>void,rejectReady!:(error:Error)=>void;
  const started=new Promise<string>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
  const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const errors:string[]=[];
  child.stderr.on("data",part=>{stderr=(stderr+part).slice(-4000);});
  const lines=createInterface({input:child.stdout});
  lines.on("line",line=>{void(async()=>{
    const value=JSON.parse(line);
    if(value.kind==="ready"){ready(value.origin);return;}
    if(value.kind==="offer"){
      const sdp=await page.evaluate(async offer=>{
        const peer=new RTCPeerConnection();(window as any).__nativeVoiceReceiver=peer;
        peer.ontrack=event=>peer.addTrack(event.track,event.streams[0]);
        await peer.setRemoteDescription({type:"offer",sdp:offer});
        await peer.setLocalDescription(await peer.createAnswer());
        if(peer.iceGatheringState!=="complete")await new Promise<void>(resolve=>{
          const timer=setTimeout(resolve,3000);
          peer.addEventListener("icegatheringstatechange",()=>{if(peer.iceGatheringState==="complete"){clearTimeout(timer);resolve();}});
        });
        return peer.localDescription!.sdp;
      },value.sdp);
      child.stdin.write(JSON.stringify({kind:"answer",id:value.id,sdp})+"\n");return;
    }
    const waiter=pending.get(value.id);if(waiter){clearTimeout(waiter.timer);pending.delete(value.id);waiter.resolve(value.value);}
  })().catch(error=>errors.push(String(error)));});
  child.once("exit",code=>{const error=new Error(`Owned native voice fixture exited ${code}: ${stderr}`);rejectReady(error);for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();lines.close();});
  const call=(method:string)=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Owned native fixture ${method} timed out: ${stderr}`));},45000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method})+"\n");});
  const timer=setTimeout(()=>rejectReady(new Error("Owned native voice fixture did not start: "+stderr)),30000);
  let origin:string;
  try {origin=await started;}catch(error){child.kill("SIGTERM");await exited;throw error;}finally{clearTimeout(timer);}
  return {origin,errors,thread:()=>call("thread"),metrics:()=>call("metrics"),async close(){let result;try{result=await call("close");}finally{child.stdin.end();await exited;}return result;}};
}

test.use({launchOptions:{args:["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]}});
test("real browser voice traverses the production gateway and official private daemon into a real WebRTC peer",async({page,context,baseURL},info)=>{
  test.skip(!process.env.SESSION_CODEX_DAEMON_NATIVE_BIN||!process.env.PLAYWRIGHT_BASE_URL,"Requires explicit existing HTTPS LAN frontend and official native binary");
  test.setTimeout(120000);expect(new URL(baseURL!).protocol).toBe("https:");
  const native=await nativeVoiceFixture(page);let stream:Awaited<ReturnType<typeof liveStream>>|undefined;
  const pageErrors:string[]=[];page.on("pageerror",error=>pageErrors.push(error.message));
  try {
    await context.grantPermissions(["microphone"],{origin:baseURL!});
    const fixture=await installSessionUxFixture(page,1);stream=await liveStream(page,baseURL!);
    await page.addInitScript(()=>{const Native=window.RTCPeerConnection;(window as any).__nativeVoicePeers=[];window.RTCPeerConnection=class extends Native{constructor(config?:RTCConfiguration){super(config);(window as any).__nativeVoicePeers.push(this);}};});
    await page.route("**/api/codex/realtime/*",async route=>{
      const action=new URL(route.request().url()).pathname.split("/").at(-1)!;
      const response=await route.fetch({url:native.origin+"/api/session/api/codex/realtime/"+action});
      await route.fulfill({response});
    });
    await page.goto("/?mode=session",{waitUntil:"domcontentloaded"});await seedSessionUx(page,1);
    await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor({timeout:60000});
    const target=await native.thread();fixture.threads[0].id=target.threadId;fixture.threads[0].cwd=target.project;
    await page.evaluate(async target=>{const path="/src/session-mode/stores/useAgentCenterStore.ts";const {useAgentCenterStore}=await import(performance.getEntriesByType("resource").findLast(row=>new URL(row.name).pathname===path)?.name??path);useAgentCenterStore.getState().addAgentCard({kind:"codex",id:target.threadId,cwd:target.project,preview:"Native voice acceptance"},{activate:true});},target);
    await page.getByRole("button",{name:"语音对话",exact:true}).click();
    await page.getByRole("button",{name:"确认开始语音对话"}).click();
    await expect(page.getByRole("button",{name:"静音麦克风",exact:true})).toBeVisible({timeout:30000});
    await expect.poll(()=>page.evaluate(()=>(window as any).__nativeVoicePeers[0].connectionState),{timeout:15000}).toBe("connected");
    await page.getByRole("button",{name:"静音扬声器",exact:true}).click();
    await page.getByRole("button",{name:"返回聊天（保持语音）"}).click();
    expect(await page.locator("audio").evaluate(node=>node.isConnected)).toBe(true);
    const editor=page.locator(".session-codex-composer [contenteditable=true]").first();await editor.fill("PRIVATE_NATIVE_BROWSER_TEXT");
    await page.getByRole("button",{name:/发送.*语音|发送语音/}).click();
    await expect(editor).toBeEmpty();await expect.poll(async()=>(await native.metrics()).typed).toBe(1);
    await page.getByRole("button",{name:"结束语音对话",exact:true}).click();
    await expect.poll(async()=>(await native.metrics()).methods.filter((method:string)=>method==="thread/realtime/closed").length).toBe(1);
    const metrics=await native.metrics();expect(metrics.offers).toBe(1);expect(metrics.sidebands).toBe(1);expect(metrics.errors).toEqual([]);expect(native.errors).toEqual([]);expect(pageErrors).toEqual([]);
    await info.attach("native-webrtc-chain",{body:JSON.stringify({productionUi:true,productionGateway:true,productionRuntime:true,officialDaemon:true,realBrowserPeers:true,exactThread:true,accountCopied:false,onlineModelAudio:false,...metrics}),contentType:"application/json"});
  } finally {
    await page.evaluate(()=>(window as any).__nativeVoiceReceiver?.close()).catch(()=>{});
    await stream?.close();const closed=await native.close();expect(closed.ownedExited).toBe(true);
  }
});
