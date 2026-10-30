import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { mkdtemp,mkdir,writeFile,rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { promisify } from "node:util";
import { CodexService } from "../../../packages/session-runtime/src/codex/client.ts";
import { EventHub } from "../../../packages/session-runtime/src/core/events.ts";
import { registerCodexRoutes } from "../../../packages/session-runtime/src/codex/routes.ts";
import { registerSessionModeRoutes } from "../../../apps/server/src/routes/session-mode.ts";
import { registerOwnedNativeFixture, cleanupOwnedNativeFixture, ownedDaemonIdentity,type OwnedNativeIdentity } from "../../../packages/session-runtime/src/codex/daemon-native-fixture.ts";
import { object } from "../../../packages/session-runtime/src/core/json.ts";

const require=createRequire(resolve("packages/session-runtime/package.json")),Fastify=require("fastify"),{WebSocketServer}=require("ws");
const binary=process.env.SESSION_CODEX_DAEMON_NATIVE_BIN;
if(!binary||!binary.startsWith("/"))throw new Error("An explicit official native binary is required");
const run=promisify(execFile),base=await mkdtemp(join(tmpdir(),"kanban-browser-voice-")),home=join(base,"home"),codexHome=join(base,"codex"),project=join(base,"project");
await Promise.all([home,codexHome,project].map(path=>mkdir(path,{mode:0o700})));
await registerOwnedNativeFixture(codexHome);
const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:home,CODEX_HOME:codexHome,CODEX_PATH:binary,HTTP_PROXY:"http://127.0.0.1:9",HTTPS_PROXY:"http://127.0.0.1:9",NO_PROXY:"127.0.0.1,localhost",SESSION_CODEX_DAEMON_AUTO_START:"1"};
let identity:OwnedNativeIdentity|undefined,codex:CodexService|undefined,gateway:any,native:any,nativeRequested=false,offers=0,sidebands=0,typed=0;
const hub=new EventHub(),methods:string[]=[],errors:string[]=[],answers=new Map<number,{resolve:(sdp:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
const send=(value:unknown)=>process.stdout.write(JSON.stringify(value)+"\n");
const provider=createServer((req,res)=>{void(async()=>{
  const chunks:Buffer[]=[];let size=0;for await(const part of req){size+=Buffer.byteLength(part);if(size>262144)throw new Error("Private offer exceeds budget");chunks.push(Buffer.from(part));}
  if(!req.url?.includes("/realtime/calls")){res.writeHead(404);res.end();return;}
  const body=Buffer.concat(chunks),contentType=req.headers["content-type"]??"";
  let sdp:string;
  if(contentType.includes("multipart/form-data")){const form=await new Response(body,{headers:{"content-type":contentType}}).formData();sdp=String(form.get("sdp"));}
  else if(contentType.includes("application/json"))sdp=JSON.parse(body.toString()).sdp;
  else sdp=body.toString();
  if(!sdp.startsWith("v=0")||Buffer.byteLength(sdp)>131072)throw new Error("Invalid browser offer");
  const id=++offers,answer=new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>{answers.delete(id);reject(new Error("Browser answer timed out"));},15000);timer.unref();answers.set(id,{resolve,reject,timer});});
  send({kind:"offer",id,sdp});
  const result=await answer;
  res.writeHead(201,{"content-type":"application/sdp",location:"/v1/realtime/calls/rtc_owned_browser_fixture"});res.end(result);
})().catch(error=>{errors.push(String(error));res.writeHead(500);res.end("Private signaling fixture failed");});});
const sockets=new WebSocketServer({server:provider});
sockets.on("connection",(socket:any)=>{sidebands++;socket.send(JSON.stringify({type:"session.created",session:{id:"owned-browser-session"}}));socket.on("message",(data:Buffer)=>{const value=JSON.parse(String(data));if(String(data).includes("PRIVATE_NATIVE_BROWSER_TEXT"))typed++;if(value.type==="session.update")socket.send(JSON.stringify({type:"session.updated",session:{id:"owned-browser-session"}}));});});
let closing:Promise<{ownedExited:boolean}>|undefined;
function close(){return closing??=(async()=>{
  const failures:unknown[]=[];
  for(const value of answers.values()){clearTimeout(value.timer);value.reject(new Error("Owned fixture closed"));}answers.clear();
  await gateway?.close().catch((error:unknown)=>failures.push(error));
  await native?.close().catch((error:unknown)=>failures.push(error));
  await codex?.close().catch((error:unknown)=>failures.push(error));hub.close();
  if(nativeRequested){
    // A failed first RPC can still have started our private daemon. Never lose its cleanup
    // merely because the success path did not get as far as recording the identity.
    if(!identity)try{identity=await ownedDaemonIdentity(codexHome);}catch(error){failures.push(error);}
    await run(binary!,["app-server","daemon","stop"],{env,timeout:15000,maxBuffer:65536}).catch(error=>failures.push(error));
    if(identity)await cleanupOwnedNativeFixture(identity).catch(error=>failures.push(error));
  }
  for(const socket of sockets.clients)socket.terminate();await new Promise<void>(resolve=>sockets.close(()=>resolve()));
  provider.closeAllConnections();if(provider.listening)await new Promise<void>(resolve=>provider.close(()=>resolve()));
  await rm(base,{recursive:true,force:true});
  if(failures.length)throw new AggregateError(failures,"Owned native fixture cleanup failed");return {ownedExited:!!identity};
})();}
process.once("SIGTERM",()=>void close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);}));
try{
 await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));
 const port=(provider.address() as {port:number}).port;
 await writeFile(join(codexHome,"config.toml"),`experimental_realtime_ws_base_url="http://127.0.0.1:${port}/v1"\nexperimental_realtime_webrtc_call_base_url="http://127.0.0.1:${port}/v1"\nexperimental_realtime_ws_startup_context="Private browser fixture"\nmodel="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[realtime]\nversion="v1"\ntype="conversational"\n[model_providers.fixture]\nname="Private browser fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`,{mode:0o600});
 codex=new CodexService({hub,instance:"voice-native-browser-fixture",env,sweepIntervalMs:0});
 native=Fastify();registerCodexRoutes(native,codex);await native.listen({host:"127.0.0.1",port:0});
 gateway=Fastify();registerSessionModeRoutes(gateway,{origin:`http://127.0.0.1:${native.server.address().port}`});await gateway.listen({host:"127.0.0.1",port:0});
 hub.subscribe({filter:event=>{if(event.event==="codex:notification")methods.push(String(event.payload.method));return false;}});
 nativeRequested=true;await codex.raw("account/read",{refreshToken:false});identity=await ownedDaemonIdentity(codexHome);
 send({kind:"ready",origin:`http://127.0.0.1:${gateway.server.address().port}`});
 const lines=createInterface({input:process.stdin});
 lines.on("line",line=>{void(async()=>{
   const value=JSON.parse(line);
   if(value.kind==="answer"){
     const waiting=answers.get(value.id);if(!waiting)return;answers.delete(value.id);clearTimeout(waiting.timer);
     if(typeof value.sdp!=="string"||!value.sdp.startsWith("v=0")||Buffer.byteLength(value.sdp)>131072)waiting.reject(new Error("Invalid browser answer"));else waiting.resolve(value.sdp);return;
   }
   if(value.method==="thread"){
     const result=object(await codex!.raw("thread/start",{cwd:project,model:"fixture",approvalPolicy:"never",sandbox:"read-only"}));
     send({id:value.id,value:{threadId:String(object(result.thread).id),project}});
   }else if(value.method==="metrics")send({id:value.id,value:{offers,sidebands,typed,methods,errors}});
   else if(value.method==="close"){const result=await close();send({id:value.id,value:result});lines.close();process.stdin.destroy();}
   else throw new Error("Unknown owned fixture operation");
 })().catch(error=>{console.error(error);void close().finally(()=>process.exit(1));});});
 lines.once("close",()=>void close());
}catch(error){console.error(error);await close();process.exitCode=1;}
