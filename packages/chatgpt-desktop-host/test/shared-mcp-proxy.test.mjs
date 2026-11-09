import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {createSharedMcpProxy} from '../src/shared-mcp-proxy.mjs';
const {isSharedMcpFrame}=createRequire(import.meta.url)('../src/shared-mcp-wire.cjs');
const metadata={enabled:true,enabled_tools:[],omit_tools_from:['deferred'],default_tools_approval_mode:'prompt',startup_timeout_sec:10,tool_timeout_sec:3600};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){const end=Date.now()+1500;while(!predicate()){if(Date.now()>end)throw Error('fixture deadline');await new Promise(resolve=>setTimeout(resolve,2));}}
function budget(limit=8*1024*1024){let used=0;return {reserveBytes(n){if(used+n>limit)return false;used+=n;return true},releaseBytes(n){assert.ok(n>=0&&n<=used);used-=n},get used(){return used}};}
async function fixture(t,{auto=true,register=true,requestTimeoutMs,verifyThread,verifyScope,verifyRuntime,memory=budget(),sendBarrier}={}){
 const profileId=randomUUID(),generation=randomUUID(),streamId=randomUUID(),threadId=randomUUID(),frames=[],errors=[],threads=new Set([threadId]);
 let runtime=true,scope=true,proxy,sequence=0,owner;
 const nativeFrame=(type,requestId,extra={})=>({v:1,type,profileId,generation,streamId,requestId,...extra});
 function respond(request,{status=200,headers={'content-type':'application/json'},body}={}){
  return proxy.receive(nativeFrame('shared-mcp-response',request.requestId,{status,headers,body:(Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body))).toString('base64')}));
 }
 function defaultOwner(request){
  const rpc=request.body?JSON.parse(Buffer.from(request.body,'base64')):null;
  if(rpc?.method==='initialize')return respond(request,{headers:{'content-type':'application/json','mcp-session-id':randomUUID()},body:{jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'explicit-synthetic-owner',version:'test'}}}});
  if(rpc?.method?.startsWith('notifications/'))return respond(request,{status:202,body:''});
  if(request.method==='DELETE')return respond(request,{status:200,body:''});
  if(request.method==='GET')return respond(request,{headers:{'content-type':'text/event-stream'},body:'event: message\ndata: owner\n\n'});
  return respond(request,{body:{jsonrpc:'2.0',id:rpc.id,result:{ownerReply:rpc.method,unmodified:'only from synthetic IPC fixture'}}});
 }
 owner=auto?defaultOwner:null;
 proxy=await createSharedMcpProxy({profileId,generation,streamId,
  verifyRuntimeSync:()=>runtime&&(verifyRuntime?verifyRuntime():true),verifyScopeSync:()=>scope&&(verifyScope?verifyScope():true),
  verifyThreadSync:(id,rpc)=>threads.has(id)&&(verifyThread?verifyThread(id,rpc):true),memoryBudget:memory,
  sendFrame(value,finalVerifySync){const dispatch=()=>{assert.equal(isSharedMcpFrame(value,{side:'host',profileId,generation}),true);frames.push(value);if(value.type==='shared-mcp-request'&&owner)queueMicrotask(()=>owner(value));};return sendBarrier?sendBarrier(value,finalVerifySync,dispatch):dispatch();},
  onFailure:error=>errors.push(error),timeoutMs:2000,...(requestTimeoutMs===undefined?{}:{requestTimeoutMs})});
 t.after(()=>proxy.close());
 const f={proxy,profileId,generation,streamId,threadId,frames,errors,threads,memory,nativeFrame,respond,
  setOwner:fn=>{owner=fn},defaultOwner,setRuntime:value=>{runtime=value},setScope:value=>{scope=value},nextId:()=>++sequence,
  register(){const id=randomUUID();assert.equal(proxy.receive(nativeFrame('shared-mcp-register',id,{config:metadata})),true);assert.equal(frames.at(-1).requestId,id);return id}};
 if(register)f.register();return f;
}
function request(f,{method='POST',rpc,body,headers={},path='/mcp',rawHeaders}={}){
 const config=f.proxy.config;assert.ok(config,'fixture must register before using its private config');const url=new URL(config.url);
 const bytes=body===undefined?Buffer.from(rpc===undefined?'':JSON.stringify(rpc)):Buffer.isBuffer(body)?body:Buffer.from(body);
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:Number(url.port),path,method,agent:false,
   headers:rawHeaders??{'content-type':'application/json',Authorization:config.http_headers.Authorization,...headers,'content-length':String(bytes.length)}},res=>{
    const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));res.on('error',reject);
   });req.on('error',reject);req.end(bytes);
 });
}
async function session(f){
 const first=await request(f,{rpc:{jsonrpc:'2.0',id:f.nextId(),method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'owned-http-fixture',version:'test'}}}});
 assert.equal(first.status,200);const id=first.headers['mcp-session-id'];assert.ok(id);
 const initialized=await request(f,{rpc:{jsonrpc:'2.0',method:'notifications/initialized'},headers:{'mcp-session-id':id}});assert.equal(initialized.status,202);return id;
}
const rpc=(f,method,params)=>({jsonrpc:'2.0',id:f.nextId(),method,...(params===undefined?{}:{params})});
const tool=(f,meta={threadId:f.threadId})=>rpc(f,'tools/call',{name:'name-is-selected-by-original-owner',arguments:{value:7},_meta:meta});
const requests=f=>f.frames.filter(frame=>frame.type==='shared-mcp-request');

test('server construction requires independent runtime, scope, thread and shared-memory guards',async()=>{
 const options={profileId:randomUUID(),generation:randomUUID(),streamId:randomUUID(),verifyRuntimeSync:()=>true,verifyScopeSync:()=>true,verifyThreadSync:()=>true,sendFrame(){},memoryBudget:budget()};
 for(const name of ['verifyRuntimeSync','verifyScopeSync','verifyThreadSync','memoryBudget'])await assert.rejects(createSharedMcpProxy({...options,[name]:undefined}),{code:'SHARED_MCP_PROXY_UNAVAILABLE'});
 await assert.rejects(createSharedMcpProxy({...options,requestTimeoutMs:0}));
});
test('bind is actual 127.0.0.1 ephemeral HTTP; private config appears only after exact original metadata registration',async t=>{
 let server;const original=http.createServer;http.createServer=function(...args){server=Reflect.apply(original,http,args);return server};syncBuiltinESMExports();
 let f;try{f=await fixture(t,{register:false})}finally{http.createServer=original;syncBuiltinESMExports()}
 assert.equal(f.proxy.config,null);assert.equal(server.address().address,'127.0.0.1');assert.ok(server.address().port>0);
 const before=await new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:'/mcp',agent:false},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))}).on('error',reject)});assert.equal(before,401);assert.equal(requests(f).length,0);
 f.register();assert.match(f.proxy.config.http_headers.Authorization,/^Bearer [A-Za-z0-9_-]{43}$/);assert.equal(Object.isFrozen(f.proxy.config),true);
 const {url,http_headers,...actual}=f.proxy.config;assert.deepEqual(actual,metadata);assert.equal(new URL(url).port,String(server.address().port));
});
test('native cannot select the proxy endpoint or bearer or register a second source',async t=>{
 const f=await fixture(t,{register:false});const supplied={...metadata,url:'http://127.0.0.1:9/mcp',http_headers:{Authorization:'Bearer '+'x'.repeat(43)}};
 assert.throws(()=>f.proxy.receive(f.nativeFrame('shared-mcp-register',randomUUID(),{config:supplied})),{code:'SHARED_MCP_PROXY_UNAVAILABLE'});assert.equal(f.proxy.config,null);assert.equal(f.frames.length,0);
 const g=await fixture(t);assert.throws(()=>g.register(),{code:'SHARED_MCP_PROXY_UNAVAILABLE'});
});
test('registration can precede account binding but HTTP still needs actual scope',async t=>{
 const f=await fixture(t,{register:false});f.setScope(false);f.register();assert.ok(f.proxy.config);
 assert.equal((await request(f,{rpc:rpc(f,'initialize',{})})).status,403);assert.equal(requests(f).length,0);
});
test('real HTTP rejects wrong bearer, Host, Origin, path, method and duplicate Host without IPC',async t=>{
 const f=await fixture(t),init=rpc(f,'initialize',{}),auth=f.proxy.config.http_headers.Authorization,host=new URL(f.proxy.config.url).host;
 for(const [options,status] of [
  [{rpc:init,headers:{Authorization:'Bearer '+'x'.repeat(43)}},401],
  [{rpc:init,headers:{Host:'localhost:'+new URL(f.proxy.config.url).port}},403],
  [{rpc:init,headers:{Origin:'https://example.invalid'}},403],
  [{rpc:init,headers:{Origin:''}},403],
  [{rpc:init,path:'/mcp?url=elsewhere'},403],
  [{rpc:init,method:'PUT'},405],
  [{rpc:init,rawHeaders:['Host',host,'Host',host,'Authorization',auth,'content-type','application/json']},403],
 ])assert.equal((await request(f,options)).status,status);
 assert.equal(requests(f).length,0);
});
test('actual HTTP initialize, initialized, tools/list and authorized tools/call preserve only owner replies',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id};
 const listed=await request(f,{rpc:rpc(f,'tools/list'),headers});assert.equal(listed.status,200);assert.equal(JSON.parse(listed.body).result.ownerReply,'tools/list');
 const called=await request(f,{rpc:tool(f),headers});assert.equal(called.status,200);assert.equal(JSON.parse(called.body).result.ownerReply,'tools/call');
 const forwarded=JSON.parse(Buffer.from(requests(f).at(-1).body,'base64'));assert.equal(forwarded.params.name,'name-is-selected-by-original-owner');assert.deepEqual(forwarded.params.arguments,{value:7});
 assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers})).status,200);assert.equal(f.memory.used,0);
});
test('valid bearer cannot call an unconnected thread or inject conflicting thread metadata',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id},before=requests(f).length;
 for(const meta of [{threadId:randomUUID()},{threadId:f.threadId,thread_id:randomUUID()},{threadId:f.threadId+' '},{threadId:f.threadId,thread:{id:randomUUID()}},{'x-codex-turn-metadata':'invalid JSON'},{}])
  assert.equal((await request(f,{rpc:tool(f,meta),headers})).status,403);
 assert.equal(requests(f).length,before);
});
test('only original thread aliases, turn metadata and nested thread id are admitted',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id};
 for(const meta of [{'openai/threadId':f.threadId},{codex_thread_id:f.threadId},{'x-codex-turn-metadata':JSON.stringify({thread_id:f.threadId,turn_id:'owned-turn'})},{thread:{id:f.threadId}}])
  assert.equal((await request(f,{rpc:tool(f,meta),headers})).status,200);
});
test('finite lifecycle requires its own initialized session, never a supplied foreign session',async t=>{
 const f=await fixture(t);assert.equal((await request(f,{rpc:rpc(f,'tools/list')})).status,404);
 assert.equal((await request(f,{rpc:rpc(f,'initialize',{}),headers:{'mcp-session-id':randomUUID()}})).status,404);
 assert.equal((await request(f,{rpc:rpc(f,'arbitrary/method')})).status,400);
 assert.equal((await request(f,{body:'[]'})).status,400);
 for(const method of ['GET','DELETE'])assert.equal((await request(f,{method})).status,404);
 const id=await session(f),headers={'mcp-session-id':id};
 assert.equal((await request(f,{method:'GET',headers})).body.toString(),'event: message\ndata: owner\n\n');
 assert.equal((await request(f,{method:'DELETE',headers})).status,200);
 assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers})).status,404);
});
test('failed native initialize is forwarded intact and creates no proxy session',async t=>{
 const f=await fixture(t),id=randomUUID(),failure={jsonrpc:'2.0',id:1,error:{code:-32602,message:'explicit owner initialize failure'}};
 f.setOwner(frame=>f.respond(frame,{status:400,headers:{'content-type':'application/json','mcp-session-id':id},body:failure}));
 const reply=await request(f,{rpc:rpc(f,'initialize',{})});assert.equal(reply.status,400);assert.deepEqual(JSON.parse(reply.body),failure);
 assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers:{'mcp-session-id':id}})).status,404);
});
test('thread authority is rechecked before IPC and immediately before a real HTTP reply',async t=>{
 let deny=false;const f=await fixture(t,{verifyThread:()=>!deny}),id=await session(f),headers={'mcp-session-id':id};
 f.setOwner(frame=>{deny=true;f.respond(frame,{body:{mustNotReachClient:'secret owner reply'}})});
 const reply=await request(f,{rpc:tool(f),headers});assert.equal(reply.status,403);assert.equal(reply.body.length,0);
});
test('per-request timeout sends exactly its own cancel and releases shared memory',async t=>{
 const f=await fixture(t,{requestTimeoutMs:25}),id=await session(f),headers={'mcp-session-id':id};f.setOwner(null);
 const reply=await request(f,{rpc:rpc(f,'tools/list'),headers});assert.equal(reply.status,504);
 const sent=requests(f).at(-1),cancel=f.frames.filter(frame=>frame.type==='shared-mcp-cancel');assert.deepEqual(cancel.map(frame=>frame.requestId),[sent.requestId]);assert.equal(f.memory.used,0);
 f.setOwner(f.defaultOwner);assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers})).status,200);
});
test('eight actual HTTP requests may wait; the ninth cannot cross owner IPC',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id};f.setOwner(null);const before=requests(f).length;
 const pending=Array.from({length:8},()=>request(f,{rpc:rpc(f,'tools/list'),headers}));await until(()=>requests(f).length===before+8);
 assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers})).status,503);
 for(const frame of requests(f).slice(before))f.defaultOwner(frame);
 assert.ok((await Promise.all(pending)).every(reply=>reply.status===200));assert.equal(f.memory.used,0);
});
test('request remains bounded at 64 KiB and response at two MiB',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id},before=requests(f).length;
 assert.equal((await request(f,{body:Buffer.alloc(65537,120),headers})).status,413);assert.equal(requests(f).length,before);
 const exact=tool(f);exact.params.arguments.padding='';exact.params.arguments.padding='x'.repeat(65536-Buffer.byteLength(JSON.stringify(exact)));const exactBytes=Buffer.from(JSON.stringify(exact));assert.equal(exactBytes.length,65536);
 assert.equal((await request(f,{body:exactBytes,headers})).status,200);
 f.setOwner(frame=>f.respond(frame,{body:Buffer.alloc(2*1024*1024,120)}));assert.equal((await request(f,{rpc:rpc(f,'tools/list'),headers})).body.length,2*1024*1024);
 assert.equal(f.memory.used,0);
});
test('shared budget contention rejects only this proxy request and returns its reservations',async t=>{
 const memory=budget(128),f=await fixture(t,{memory});const reply=await request(f,{rpc:rpc(f,'initialize',{padding:'x'.repeat(256)})});assert.equal(reply.status,503);assert.equal(memory.used,0);assert.equal(requests(f).length,0);
});
test('owner IPC rejects wrong stream and unknown receipt without exposing endpoint alternatives',async t=>{
 const f=await fixture(t);assert.throws(()=>f.proxy.receive({...f.nativeFrame('shared-mcp-response',randomUUID(),{status:200,headers:{},body:''}),streamId:randomUUID()}),{code:'SHARED_MCP_PROXY_UNAVAILABLE'});
 assert.equal(f.proxy.config,null);assert.equal(f.errors.length,1);
});
test('close cancels only pending owned HTTP requests and leaves no payload reservation',async t=>{
 const f=await fixture(t),id=await session(f),headers={'mcp-session-id':id};f.setOwner(null);const before=requests(f).length;
 const pending=request(f,{rpc:rpc(f,'tools/list'),headers});await until(()=>requests(f).length===before+1);const target=requests(f).at(-1).requestId;
 f.proxy.close();try{await pending}catch{/* An owned socket may close before its 503 is flushed. */}
 assert.deepEqual(f.frames.filter(frame=>frame.type==='shared-mcp-cancel').map(frame=>frame.requestId),[target]);assert.equal(f.memory.used,0);assert.equal(f.proxy.config,null);
});

test('component keeps its eight MiB aggregate cap even with a larger shared caller budget',async t=>{
 const memory=budget(32*1024*1024),f=await fixture(t,{memory}),id=await session(f),headers={'mcp-session-id':id};f.setOwner(null);const before=requests(f).length;
 const calls=Array.from({length:8},()=>request(f,{rpc:rpc(f,'tools/list'),headers}));await until(()=>requests(f).length===before+8);
 const bytes=Buffer.alloc(2*1024*1024,120);let peak=memory.used;
 for(const frame of requests(f).slice(before)){f.respond(frame,{body:bytes});peak=Math.max(peak,memory.used);}
 const replies=await Promise.all(calls);assert.ok(replies.some(reply=>reply.status===503));assert.ok(replies.some(reply=>reply.status===200));assert.ok(peak<=8*1024*1024);assert.equal(memory.used,0);
});
test('client disconnect cancels precisely its pending owner request, without retrying it',async t=>{
 const f=await fixture(t),id=await session(f);f.setOwner(null);const before=requests(f).length,url=new URL(f.proxy.config.url),body=Buffer.from(JSON.stringify(rpc(f,'tools/list')));
 const client=http.request({hostname:'127.0.0.1',port:Number(url.port),path:'/mcp',method:'POST',agent:false,headers:{Authorization:f.proxy.config.http_headers.Authorization,'content-type':'application/json','mcp-session-id':id,'content-length':String(body.length)}});
 client.on('error',()=>{});client.end(body);await until(()=>requests(f).length===before+1);const target=requests(f).at(-1).requestId;client.destroy();
 await until(()=>f.frames.some(frame=>frame.type==='shared-mcp-cancel'&&frame.requestId===target));assert.equal(requests(f).length,before+1);assert.equal(f.memory.used,0);
});
test('thread revocation at the second final IPC guard prevents the actual send',async t=>{
 let checks=0;const f=await fixture(t,{verifyThread:()=>++checks<4}),id=await session(f),before=requests(f).length;
 const result=await request(f,{rpc:tool(f),headers:{'mcp-session-id':id}});assert.ok([403,503].includes(result.status));assert.ok(checks>=4);assert.equal(requests(f).length,before);assert.equal(f.memory.used,0);
});

test('async owner transport checks the captured request thread at its actual write, after its await',async t=>{
 const waits=[];
 const f=await fixture(t,{sendBarrier(value,finalVerifySync,dispatch){
  const body=value.type==='shared-mcp-request'?JSON.parse(Buffer.from(value.body,'base64')):null;
  if(body?.method!=='tools/call')return dispatch();
  let release;const wait=new Promise(resolve=>{release=resolve});waits.push({release,frame:value});
  return wait.then(()=>{if(typeof finalVerifySync!=='function'||finalVerifySync()!==true)throw Error('final owner write denied');return dispatch();});
 }}),id=await session(f),headers={'mcp-session-id':id};
 const valid=request(f,{rpc:tool(f),headers});await until(()=>waits.length===1);waits[0].release();assert.equal((await valid).status,200);
 const before=requests(f).length,pending=request(f,{rpc:tool(f),headers});await until(()=>waits.length===2);
 f.threads.delete(f.threadId);waits[1].release();assert.equal((await pending).status,502);assert.equal(requests(f).length,before);assert.equal(f.memory.used,0);
});
