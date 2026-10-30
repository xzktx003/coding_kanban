import {test,expect} from "@playwright/test";
import {createRequire} from "node:module";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {networkInterfaces,tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {EventHub} from "../../packages/session-runtime/src/core/events.ts";
import {createClaudeService} from "../../packages/session-runtime/src/claude/service.ts";
import {registerClaudeRoutes} from "../../packages/session-runtime/src/claude/routes.ts";
import {registerEventRoutes} from "../../packages/session-runtime/src/transport/events.ts";
import {registerSessionModeRoutes} from "../../apps/server/src/routes/session-mode.ts";
const requireServer=createRequire(new URL("../../apps/server/package.json",import.meta.url)),requireWeb=createRequire(new URL("../../apps/web/package.json",import.meta.url));
const Fastify=requireServer("fastify"),{build}=createRequire(requireWeb.resolve("vite/package.json"))("esbuild");
const webRoot=fileURLToPath(new URL("../../apps/web",import.meta.url));
class Stream {
  values:any[]=[];waiter:((value:any)=>void)|undefined;closed=false;
  [Symbol.asyncIterator](){return this;}
  next():Promise<any>{if(this.values.length)return Promise.resolve({value:this.values.shift(),done:false});if(this.closed)return Promise.resolve({done:true});return new Promise(resolve=>this.waiter=resolve);}
  push(value:any){if(this.waiter){const waiter=this.waiter;this.waiter=undefined;waiter({value,done:false});}else this.values.push(value);}
  close(){this.closed=true;this.waiter?.({done:true});}
}
test("desktop and phone refresh observe one live Claude Query, recover exact approval details and route native aliases",async({browser},testInfo)=>{
  test.setTimeout(60000);
  const lan=Object.values(networkInterfaces()).flat().find(a=>a?.family==="IPv4"&&!a.internal)?.address;
  if(!lan)throw new Error("LAN IPv4 is required");
  const home=await mkdtemp(join(tmpdir(),"claude-recovery-browser-")),hub=new EventHub(),output=new Stream();
  const nativeId="12345678-1234-4234-8234-123456789abc";let queryCount=0,options:any;const inputMessages:any[]=[],requests:string[]=[],chunks:number[]=[];
  const service=createClaudeService({hub,dataHome:home,runtimeInstance:"cc-browser-runtime",env:{HOME:home},queryFactory:params=>{
    queryCount++;options=params.options;void(async()=>{for await(const message of params.prompt as any)inputMessages.push(message);})();
    return Object.assign(output,{initializationResult:async()=>({}),interrupt:async()=>{},setPermissionMode:async()=>{},close:()=>Stream.prototype.close.call(output)}) as any;
  }});
  const runtime=Fastify(),gateway=Fastify(),contexts:any[]=[];let permission:Promise<unknown>|undefined;
  try{
    registerClaudeRoutes(runtime,service);registerEventRoutes(runtime,hub);
    runtime.addHook("onRequest",async(req:any)=>{requests.push(req.url);});
    runtime.addHook("onSend",async(req:any,_reply:any,payload:any)=>{if(req.url==="/api/cc/permission-detail")chunks.push(Buffer.byteLength(payload));return payload;});
    await runtime.listen({host:"127.0.0.1",port:0});
    const runtimeOrigin=`http://127.0.0.1:${runtime.server.address().port}`;
    registerSessionModeRoutes(gateway,{origin:runtimeOrigin});
    const wrapperId=await service.newSession({cwd:home,permissionMode:"manual",model:"captured-model"});
    await service.send(wrapperId,"initial");output.push({type:"system",subtype:"init",session_id:nativeId});await new Promise(resolve=>setImmediate(resolve));
    const input={command:"echo exact approval",payload:"detail-visible-"+"x".repeat(100000)};
    const hook=options.hooks.PreToolUse[0].hooks[0];permission=hook({hook_event_name:"PreToolUse",session_id:nativeId,transcript_path:"",cwd:home,tool_name:"FixtureApproval",tool_input:input,tool_use_id:"tool"},"tool",{signal:new AbortController().signal});
    await new Promise(resolve=>setImmediate(resolve));
    const harness=String.raw`
      import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
      import{useCCStore}from'./src/session-mode/stores/cc/ccStore.ts';
      import{useCCBackgroundEvents}from'./src/session-mode/hooks/useCCBackgroundEvents.ts';
      import{refreshClaudeConnection,ensureClaudeSessionForSend}from'./src/session-mode/services/claudeConnectionRecovery.ts';
      import{resolveClaudePermission}from'./src/session-mode/services/resolveClaudePermission.ts';
      import{PermissionRequestCard}from'./src/session-mode/components/cc/session/messages/PermissionRequestCard.tsx';
      import{ccSendMessage}from'./src/session-mode/services/apiAdapt/cc.ts';
      const id=ID,cwd=CWD;useCCStore.setState({activeSessionId:id,activeSessionIds:[id],sessionMessagesMap:{[id]:[]},messages:[]});
      function App(){useCCBackgroundEvents();const state=useCCStore(),[error,setError]=useState('');const read=()=>refreshClaudeConnection(id,cwd).catch(e=>setError(e.message));useEffect(()=>{void read();},[]);
        const request=state.messages.find(m=>m.type==='permission_request'&&!m.resolved);
        return <div className="session-mode"><h1>Claude 只读恢复</h1><p data-testid="busy">{String(state.isLoading)}</p><p data-testid="error">{error}</p>
          {request&&<PermissionRequestCard msg={request} onResolve={(id,decision)=>{void resolveClaudePermission(id,decision).catch(e=>setError(e.message));}}/>}
          <button id="refresh-owner" onClick={read}>核对已有连接</button><button id="send" onClick={()=>{void ensureClaudeSessionForSend(id,cwd,{cwd,model:'must-not-replace'}).then(()=>ccSendMessage(id,'next')).catch(e=>setError(e.message));}}>发送下一条</button>
          <p data-testid="answer">{state.messages.filter(m=>m.type==='assistant').map(m=>JSON.stringify(m.message)).join(' ')}</p></div>;
      }createRoot(document.getElementById('app')).render(<App/>);
    `;
    const bundle=await build({stdin:{contents:harness,resolveDir:webRoot,sourcefile:"claude-recovery-harness.tsx",loader:"tsx"},loader:{".css":"empty"},tsconfig:join(webRoot,"tsconfig.json"),bundle:true,format:"esm",platform:"browser",write:false,define:{"process.env.NODE_ENV":'"production"',"import.meta.hot":"undefined","import.meta.env":"{}",ID:JSON.stringify(nativeId),CWD:JSON.stringify(home)},alias:{"@session":join(webRoot,"src/session-mode")},logLevel:"silent"});
    gateway.get("/bundle.js",(_:any,reply:any)=>reply.type("application/javascript").send(bundle.outputFiles[0].text));
    gateway.get("/",(_:any,reply:any)=>reply.type("text/html").send('<!doctype html><html><body><div id="app"></div><script type="module" src="/bundle.js"></script></body></html>'));
    await gateway.listen({host:"0.0.0.0",port:0});const url=`http://${lan}:${gateway.server.address().port}/`;
    for(const viewport of [{width:1440,height:1000},{width:393,height:852}]){
      const context=await browser.newContext({viewport});contexts.push(context);const page=await context.newPage();page.on("pageerror",error=>console.error("Claude harness page error:",error.message));
      await page.goto(url);await expect(page.getByTestId("busy")).toHaveText("true");await expect(page.getByRole("button",{name:"查看完整审批参数"})).toBeVisible();
      await expect(page.getByRole("button",{name:"Allow Once",exact:true})).toBeDisabled();
      await page.reload();await expect(page.getByRole("button",{name:"查看完整审批参数"})).toBeVisible();await expect(page.getByTestId("busy")).toHaveText("true");
      await page.getByRole("button",{name:"查看完整审批参数"}).click();await expect(page.getByRole("button",{name:"Allow Once",exact:true})).toBeEnabled();
      expect(queryCount).toBe(1);expect(requests.filter(p=>p==="/api/cc/resume-session")).toEqual([]);
      if(viewport.width===393){await page.getByRole("button",{name:"Deny",exact:true}).click();await permission;}
    }
    output.push({type:"assistant",uuid:"answer",session_id:nativeId,message:{role:"assistant",content:[{type:"text",text:"same Query survives refresh"}]}});
    output.push({type:"result",uuid:"result",session_id:nativeId,is_error:false,subtype:"success",duration_ms:1,duration_api_ms:1,num_turns:1,result:"done"});
    for(const context of contexts){const page=context.pages()[0];await expect(page.getByTestId("answer")).toContainText("same Query survives refresh");await expect(page.getByTestId("busy")).toHaveText("false");await page.locator("#refresh-owner").click();}
    const page=contexts[1].pages()[0];await page.locator("#send").click();await expect.poll(()=>inputMessages.length).toBe(2);expect(queryCount).toBe(1);
    expect(service.sessionSnapshot(nativeId,"cc-browser-runtime").options.model).toBe("captured-model");expect(chunks.length).toBeGreaterThan(2);expect(Math.max(...chunks)).toBeLessThanOrEqual(65536);
    await writeFile(testInfo.outputPath("claude-readonly-recovery.json"),JSON.stringify({url,viewports:[1440,393],queryCount,inputs:inputMessages.length,resumeRequests:requests.filter(p=>p==="/api/cc/resume-session").length,detailRequests:chunks.length,maxDetailBytes:Math.max(...chunks),fullWorkbenchCovered:false},null,2));
  }finally{for(const context of contexts)await context.close();await service.close();hub.close();await gateway.close();await runtime.close();await rm(home,{recursive:true,force:true});}
});
