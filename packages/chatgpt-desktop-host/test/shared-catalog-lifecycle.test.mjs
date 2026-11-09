import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createContainerSharedSourceBridge} from '../src/container-service.mjs';
import {createContainerSharedSourceCoordinator} from '../src/container-shared-source-coordinator.mjs';
import {decodeWireValue} from '../src/wire-value.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,readPage){
 const profileId=randomUUID(),generation=randomUUID(),daemonGeneration=randomUUID(),observationId=randomUUID(),controller=new AbortController(),sent=[];
 let closed=0,revision=1,observedId=observationId;
 const bridge=createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync:()=>true,writeNative:async(encoded,verify)=>{assert.equal(verify(),true);sent.push(decodeWireValue(encoded));}});
 const daemon={signal:controller.signal,expiresAtMs:Date.now()+60000,assertCurrent(){},matchesFingerprint:x=>x==='a'.repeat(64),listThreads:readPage,readThreadMetadata:async()=>{throw Error('not used')},attachGateReceiver(){}};
 const sharedThread={resolveBinding:async()=>null,verifyViewSync:()=>false,verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyReadSync:()=>false,write(){throw Error('no task writes')}};
 const coordinator=createContainerSharedSourceCoordinator({profileId,generation,daemonGeneration,daemon,privateSource:{generation,verifySync:()=>true,list:async()=>({data:[],nextCursor:null}),read:async()=>null},verifyContainerSync:bridge.context.verifyContainerSync,getOwnedView:bridge.context.getOwnedView,verifyOwnedViewSync:bridge.context.verifyOwnedViewSync,writeNative:bridge.context.writeNative,sharedThread});
 bridge.activate({...coordinator,close(){closed++;coordinator.close();}});
 bridge.receiveNative({v:1,type:'shared-account-observation',profileId,generation,revision,observationId,fingerprint:'a'.repeat(64),expiresAtMs:Date.now()+60000});
 t.after(()=>bridge.close());
 const frame=(type,viewId,requestId,extra={})=>({v:1,type,profileId,generation,viewId,requestId,...extra});
 return {bridge,coordinator,sent,frame,get closed(){return closed},request(viewId,requestId){return bridge.receiveNative(frame('shared-catalog-request',viewId,requestId,{cursor:null,limit:50}));},cancel(viewId,requestId){return bridge.receiveNative(frame('shared-catalog-cancel',viewId,requestId));},revoke(){bridge.receiveNative({v:1,type:'shared-account-revoked',profileId,generation,revision:++revision,observationId:observedId});},reobserve(){observedId=randomUUID();bridge.receiveNative({v:1,type:"shared-account-observation",profileId,generation,revision:++revision,observationId:observedId,fingerprint:"a".repeat(64),expiresAtMs:Date.now()+60000});}};
}
test('retired view catalog cancellation is exact idempotent cleanup; a fresh view still works',async t=>{
 let finishFirst,calls=0;
 const f=fixture(t,()=>++calls===1?new Promise(resolve=>{finishFirst=resolve}):Promise.resolve({data:[],nextCursor:null}));
 const oldView=randomUUID(),oldRequest=randomUUID();f.bridge.viewCreated(oldView);assert.equal(f.request(oldView,oldRequest),true);
 f.bridge.retireView(oldView);
 assert.equal(f.cancel(oldView,oldRequest),true);
 assert.equal(f.cancel(oldView,oldRequest),true);
 assert.equal(f.closed,0);assert.equal(f.coordinator.accountRevision(),1);
 const nextView=randomUUID(),nextRequest=randomUUID();f.bridge.viewCreated(nextView);assert.equal(f.request(nextView,nextRequest),true);
 finishFirst({data:[],nextCursor:null});await tick();await tick();
 assert.equal(f.closed,0);assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'shared-catalog-chunk');assert.equal(f.sent[0].viewId,nextView);
});
test('late cancellation after a failed catalog page leaves the account and next request usable',async t=>{
 let calls=0;const f=fixture(t,async()=>{if(++calls===1)throw Error('fixture failure');return {data:[],nextCursor:null}});
 const view=randomUUID(),request=randomUUID();f.bridge.viewCreated(view);assert.equal(f.request(view,request),true);await tick();
 assert.equal(f.sent[0].type,'shared-catalog-error');assert.equal(f.cancel(view,request),true);assert.equal(f.closed,0);
 assert.equal(f.request(view,randomUUID()),true);await tick();assert.equal(f.sent.at(-1).type,'shared-catalog-chunk');
});
test('cancel after a final acknowledgement is harmless and cannot reopen or reuse a request',async t=>{
 const f=fixture(t,async()=>({data:[],nextCursor:null})),view=randomUUID(),request=randomUUID();f.bridge.viewCreated(view);f.request(view,request);await tick();
 assert.equal(f.bridge.receiveNative(f.frame('shared-catalog-ack',view,request,{sequence:1})),true);
 const sent=f.sent.length;assert.equal(f.cancel(view,request),true);assert.equal(f.sent.length,sent);assert.equal(f.closed,0);
 assert.throws(()=>f.request(view,request),{code:'CONTAINER_SHARED_SOURCE_FAILED'});
});
for(const kind of ['wrong-view','unknown-request','changed-generation'])test(`catalog cleanup still fails closed for ${kind}`,async t=>{
 const f=fixture(t,()=>new Promise(()=>{})),view=randomUUID(),request=randomUUID();f.bridge.viewCreated(view);f.request(view,request);f.bridge.retireView(view);
 const value=f.frame('shared-catalog-cancel',kind==='wrong-view'?randomUUID():view,kind==='unknown-request'?randomUUID():request);
 if(kind==='changed-generation')value.generation=randomUUID();
 assert.throws(()=>f.bridge.receiveNative(value),{code:kind==='changed-generation'?'CONTAINER_SHARED_PROTOCOL_ERROR':'CONTAINER_SHARED_SOURCE_FAILED'});assert.equal(f.closed,1);
});
test('account revocation precedes tombstone cleanup and cannot be bypassed by known request/view',async t=>{
 const f=fixture(t,()=>new Promise(()=>{})),view=randomUUID(),request=randomUUID();f.bridge.viewCreated(view);f.request(view,request);f.bridge.retireView(view);f.revoke();
 assert.equal(f.coordinator.accountRevision(),null);assert.throws(()=>f.cancel(view,request),{code:'CONTAINER_SHARED_SOURCE_FAILED'});assert.equal(f.closed,1);assert.equal(f.sent.length,0);
});

test('known cleanup from a revoked account cannot be accepted by a later observation',async t=>{
 const f=fixture(t,()=>new Promise(()=>{})),view=randomUUID(),request=randomUUID();f.bridge.viewCreated(view);f.request(view,request);f.bridge.retireView(view);f.revoke();f.reobserve();
 assert.equal(f.coordinator.accountRevision(),3);assert.throws(()=>f.cancel(view,request),{code:'CONTAINER_SHARED_SOURCE_FAILED'});assert.equal(f.closed,1);
});

test('catalog lifetime request IDs retain the original 8192-entry cap across cleanup and revoke',async()=>{
 const {createRequire}=await import('node:module');const {createHostCatalogIpc}=createRequire(import.meta.url)('../src/shared-catalog-ipc.cjs');
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID();let live=true;
 const host=createHostCatalogIpc({profileId,generation,verifyCurrentSync:()=>live,verifyViewSync:()=>true,sendFrame(){},getPage:()=>new Promise(()=>{}),reserveBytes:()=>true,releaseBytes(){throw Error('no page reserved')}});
 const ids=[];const frame=(type,requestId)=>({v:1,type,profileId,generation,viewId,requestId,...(type==='shared-catalog-request'?{cursor:null,limit:50}:{})});
 try{
  for(let i=0;i<8192;i++){const id=randomUUID();ids.push(id);assert.equal(host.receive(frame('shared-catalog-request',id)),true);assert.equal(host.receive(frame('shared-catalog-cancel',id)),true);}
  assert.equal(host.receive(frame('shared-catalog-request',randomUUID())),false);
  host.revoke();assert.equal(host.receive(frame('shared-catalog-cancel',ids[0])),false);assert.equal(host.receive(frame('shared-catalog-request',randomUUID())),false);
 }finally{host.close()}
});
