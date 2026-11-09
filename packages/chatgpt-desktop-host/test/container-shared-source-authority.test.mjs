import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createThreadSourceRegistry} from '../src/thread-source-registry.mjs';
import {createSourceBoundSharedAuthority} from '../src/container-shared-source-authority.mjs';
function fixture(){
 const viewId=randomUUID(),profileGeneration=randomUUID(),daemonGeneration=randomUUID(),threadId=randomUUID(),view={viewId};let writable=0;
 const rec={id:threadId,cwd:'/project',turns:[]},priv={generation:profileGeneration,getAccountRevision:()=>1,verifySync:()=>true,list:async()=>({data:[],nextCursor:null}),read:async()=>null};
 const daemon={generation:daemonGeneration,getAccountRevision:()=>7,verifySync:()=>true,list:async()=>({data:[rec],nextCursor:null}),read:async()=>({thread:rec})};
 const registry=createThreadSourceRegistry({privateSource:priv,daemonSource:daemon,verifyViewSync:v=>v===view});
 let seenSource;
 const original={resolveBinding:async request=>{seenSource=request.source;return {hostId:'kanban-shared-cli',runtimeGeneration:profileGeneration,daemonGeneration,accountRevision:7,projectId:'project',threadId,viewId,clientId:randomUUID()}},verifyViewSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,verifyReadSync:()=>true,write:()=>{writable++}};
 const bound=createSourceBoundSharedAuthority({registry,getOwnedView:id=>id===viewId?view:null,sharedThread:original});
 return {viewId,view,threadId,profileGeneration,registry,bound,seen:()=>seenSource,writes:()=>writable,rec};
}
test('actual per-view page token binds the daemon metadata and is checked before later authority',async()=>{
 const f=fixture(),page=await f.registry.listDaemon({}),[row]=f.registry.issuePageTokens(f.view,page);
 const request={viewId:f.viewId,hostId:'kanban-shared-cli',threadId:f.threadId,sourceToken:row.token};
 const binding=await f.bound.sharedThread.resolveBinding(request);
 assert.equal(f.seen().executionDomain,'daemon');assert.equal(f.seen().cwd,'/project');
 assert.equal(f.bound.sharedThread.verifyBindingSync(binding),true);assert.equal(f.bound.sharedThread.verifyHistorySync(binding),true);
 f.registry.retireView(f.view);assert.equal(f.bound.sharedThread.verifyBindingSync(binding),false);assert.equal(f.bound.sharedThread.verifyHistorySync(binding),false);
});
test('forged, cross-view or mismatched source token cannot cause shared binding',async()=>{
 const f=fixture(),page=await f.registry.listDaemon({}),[row]=f.registry.issuePageTokens(f.view,page);
 for(const request of [{viewId:f.viewId,hostId:'kanban-shared-cli',threadId:f.threadId,sourceToken:'A'.repeat(43)},{viewId:randomUUID(),hostId:'kanban-shared-cli',threadId:f.threadId,sourceToken:row.token},{viewId:f.viewId,hostId:'kanban-shared-cli',threadId:randomUUID(),sourceToken:row.token},{viewId:f.viewId,hostId:'kanban-shared-cli',threadId:f.threadId}])await assert.rejects(f.bound.sharedThread.resolveBinding(request));
 assert.equal(f.seen(),undefined);assert.equal(f.writes(),0);
});
test('shared bind frame preserves an opaque source token and rejects forged forms',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {isSharedThreadAuthorityFrame}=require('../src/shared-thread-authority-wire.cjs');
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),requestId=randomUUID();
 const frame={v:1,type:'shared-authorize',profileId,generation,requestId,operation:'bind',viewId,hostId:'kanban-shared-cli',threadId,sourceToken:'a'.repeat(43)};
 assert.equal(isSharedThreadAuthorityFrame(frame,{side:'native',profileId,generation}),true);
 assert.equal(isSharedThreadAuthorityFrame({...frame,sourceToken:'bad'},{side:'native',profileId,generation}),false);
 assert.equal(isSharedThreadAuthorityFrame({...frame,executionDomain:'daemon'},{side:'native',profileId,generation}),false);
});
test('opt-in native intent requires and forwards the per-view token through the existing binding channel',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {createNativeSharedThreadRouter}=require('../src/native-shared-thread-routing.cjs');
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),epoch=randomUUID(),attemptId=randomUUID(),sender={id:2,isDestroyed:()=>false};
 const record={senderId:2,viewId,window:{webContents:sender,isDestroyed:()=>false},failed:false};let captured;
 const router=createNativeSharedThreadRouter({profileId,generation,getRecord:id=>id===2?record:null,getOwnedRecord:v=>v===sender?record:null,verifyRuntimeSync:()=>true,requireSourceToken:true,resolveBinding:async(_record,request)=>{captured=request;return {...request,hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'test',viewId,clientId:randomUUID(),sourceToken:undefined}},verifyBinding:async()=>true,verifyBindingSync:()=>true,authorizeRequest:async()=>true,sendToView:()=>{}});
 // A source token is mandatory when this server-owned opt-in is enabled.
 router.lifecycle(sender,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch});
 const message={type:'kanban-shared-connect-intent',v:1,action:'connect',attemptId,profileId,generation,viewId,hostId:'kanban-shared-cli',threadId,sequence:1,epoch};
 assert.equal(await router.intent(sender,message),false);assert.equal(captured,undefined);
 const token='a'.repeat(43);captured=null;
 // This test needs only the forwarded request; the synthetic resolver then denies binding.
 const result=await router.intent(sender,{...message,attemptId:randomUUID(),sourceToken:token});
 assert.equal(captured?.sourceToken,token);assert.equal(result,false);router.dispose();
});
test('opaque page token traverses the owned authority channel and reaches the source-bound server',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {createSharedThreadAuthorityWire}=require('../src/shared-thread-authority-wire.cjs');
 const {createSharedThreadAuthorityServer,createSharedThreadAuthorityClient}=require('../src/shared-thread-authority-channel.cjs');
 const {createSharedDaemonRpcGate}=await import('../src/shared-daemon-rpc-gate.mjs');
 const f=fixture(),page=await f.registry.listDaemon({}),[row]=f.registry.issuePageTokens(f.view,page);
 const profileId=randomUUID();let host,native;
 host=createSharedThreadAuthorityWire({side:'host',sendFrame:frame=>native.receive(frame)});native=createSharedThreadAuthorityWire({side:'native',sendFrame:frame=>host.receive(frame)});
 const runtimeGeneration=f.profileGeneration;
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,write:()=>{}});
 const server=createSharedThreadAuthorityServer({socket:host.stream,profileId,generation:runtimeGeneration,gate,verifyViewSync:f.bound.sharedThread.verifyViewSync,verifyBindingSync:f.bound.sharedThread.verifyBindingSync,resolveBinding:f.bound.sharedThread.resolveBinding});
 const client=createSharedThreadAuthorityClient({socket:native.stream,profileId,generation:runtimeGeneration});
 try{const binding=await client.resolveBinding({viewId:f.viewId,hostId:'kanban-shared-cli',threadId:f.threadId,sourceToken:row.token});assert.equal(binding.threadId,f.threadId);assert.equal(f.seen().executionDomain,'daemon');}finally{client.close();server.close();native.close();host.close();gate.close();}
});

test('daemon page capability cannot bind the original local host even when UUID matches',async()=>{
 const f=fixture(),page=await f.registry.listDaemon({}),[row]=f.registry.issuePageTokens(f.view,page);
 await assert.rejects(f.bound.sharedThread.resolveBinding({viewId:f.viewId,hostId:'local',threadId:f.threadId,sourceToken:row.token}));
 assert.equal(f.seen(),undefined);
});
