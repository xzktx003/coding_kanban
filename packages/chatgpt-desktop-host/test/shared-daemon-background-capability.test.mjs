import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
import {createSharedThreadCreationAuthority} from '../src/shared-thread-creation.mjs';

const background=(id='background-title')=>({id,method:'thread/start',params:{model:'owned-fixture-model',modelProvider:null,allowProviderModelFallback:true,cwd:'/owned/project',approvalPolicy:'never',permissions:':read-only',runtimeWorkspaceRoots:[],config:{'features.hooks':false},personality:null,ephemeral:true,threadSource:'thread_title',experimentalRawEvents:false,dynamicTools:null,serviceTier:null,serviceName:'owned-fixture-service'}});
function fixture({creation,deliver}={}){
 const writes=[],responses=[],receipts=[],state={live:true};
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:()=>false,verifyHistorySync:()=>false,write:text=>writes.push(text),creation,
  desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:r=>receipts.push(r),deliverUnsupportedCapabilitySync:response=>{responses.push(response);return deliver?.(response,state);}}});
 gate.write(JSON.stringify({id:'init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));
 gate.receive(JSON.stringify({id:'init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));
 assert.equal(receipts[0].consumeSync(),true);
 return{gate,writes,responses,state};
}

test('fixed read-only ephemeral background request gets a capability error without any daemon start',()=>{
 const f=fixture();try{
  const frame=background();assert.doesNotThrow(()=>f.gate.write(JSON.stringify(frame)));
  assert.deepEqual(f.responses,[{id:frame.id,error:{code:-32601,message:'Shared desktop policy does not support background thread/start',data:{source:'kanban-shared-policy',code:'SHARED_CAPABILITY_NOT_SUPPORTED',method:'thread/start'}}}]);
  assert.equal(f.writes.length,1);assert.equal(Object.hasOwn(f.responses[0],'result'),false);
  const read={id:'after-background-refusal',method:'account/read',params:{refreshToken:false}};f.gate.write(JSON.stringify(read));assert.equal(f.writes.at(-1),JSON.stringify(read));
  assert.throws(()=>f.gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.responses.length,1);
 }finally{f.gate.close();}
});

test('background refusal cannot consume or replay the separate explicit ordinary creation',()=>{
 const view={viewId:randomUUID()},creation=createSharedThreadCreationAuthority({verifyProjectSync:()=>true,getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});
 const f=fixture({creation}),frame={id:'explicit-user-create',method:'thread/start',params:{cwd:'/owned/project'}};
 const scope={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',cwd:'/owned/project',viewId:view.viewId,creationNonce:randomUUID()};
 try{
  creation.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+5000});
  f.gate.write(JSON.stringify(background()));assert.equal(f.responses.length,1);
  f.gate.write(JSON.stringify(frame));assert.equal(f.writes.at(-1),JSON.stringify(frame));assert.equal(f.writes.length,2);
  assert.throws(()=>f.gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});
 }finally{f.gate.close();creation.close();}
});

test('ephemeral alone, meaningful policy changes, unknown producers and unknown fields retain ordinary creation denial',()=>{
 for(const patch of [{ephemeral:false},{ephemeral:null},{approvalPolicy:'on-request'},{permissions:':workspace'},{runtimeWorkspaceRoots:['/owned/project']},{threadSource:'user'},{threadSource:'unknown-background'},{dynamicTools:[]},{experimentalRawEvents:true},{personality:'friendly'},{allowProviderModelFallback:false},{unexpectedSetting:true}]){
  const f=fixture();try{const frame=background();Object.assign(frame.params,patch);assert.throws(()=>f.gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.responses.length,0);assert.equal(f.writes.length,1);}finally{f.gate.close();}
 }
 const f=fixture();try{assert.throws(()=>f.gate.write(JSON.stringify({id:'only-ephemeral',method:'thread/start',params:{ephemeral:true}})),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.responses.length,0);}finally{f.gate.close();}
});

test('revoked or failed capability delivery remains a real refusal and never writes a daemon request',()=>{
 const f=fixture();try{f.state.live=false;assert.throws(()=>f.gate.write(JSON.stringify(background())),{code:'SHARED_DAEMON_DENIED'});assert.equal(f.responses.length,0);assert.equal(f.writes.length,1);}finally{f.gate.close();}
 for(const deliver of [()=>{throw Object.assign(new Error('owned fixture delivery failed'),{code:'OWNED_DELIVERY_FAILED'});},(_reply,state)=>{state.live=false;}]){
  const x=fixture({deliver});try{assert.throws(()=>x.gate.write(JSON.stringify(background())),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});assert.equal(x.writes.length,1);}finally{x.gate.close();}
 }
});
