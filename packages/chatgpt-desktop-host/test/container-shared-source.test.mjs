import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as service from '../src/container-service.mjs';
import {startContainerDesktopService} from '../src/container-host-service.mjs';
import {createOwnedSharedDesktopSourceFactory,isOwnedSharedDesktopSourceFactory} from '../src/owned-shared-desktop-source.mjs';
import {encodeWireValue} from '../src/wire-value.mjs';
const registration={daemon:{pid:2,startTicks:"1",socketPath:"/fixture/daemon.sock",daemonGeneration:randomUUID(),exeSha256:"0".repeat(64)},projects:[],verifyExecutionDomainSync:()=>false};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t){
 let live=true,revision=1,closed=0;const seen=[],retired=[],written=[];
 const profileId=randomUUID(),generation=randomUUID();
 const bridge=service.createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync:()=>live,writeNative:async(encoded,verify)=>{
   if(!verify())throw Error('last write guard rejected');written.push(encoded);
 }});t.after(()=>bridge.close());
 const source={receiveNative:frame=>(seen.push(frame),true),retireView:id=>retired.push(id),close:()=>{closed++},accountRevision:()=>revision};
 return {bridge,source,profileId,generation,seen,retired,written,setLive:value=>{live=value},setRevision:value=>{revision=value},get closed(){return closed}};
}
for(const launch of [service.startContainerDesktopUpstream,startContainerDesktopService])test('only the WeakSet branded server factory is accepted before launcher IO',async()=>{
 for(const sharedDesktopSource of [null,{},()=>{},JSON.parse('{"create":true}'),{create:async()=>({})}])
  await assert.rejects(launch({sharedDesktopSource}),{code:'CONTAINER_SHARED_INVALID_CONFIG'});
 let called=0;const options={};Object.defineProperty(options,'sharedDesktopSource',{enumerable:true,get(){called++;throw Error('getter must not execute')}});
 await assert.rejects(launch(options),{code:'CONTAINER_SHARED_INVALID_CONFIG'});assert.equal(called,0);
});
test('production branded factory receives exact held context; pending account frames drain in true order',async t=>{
 const f=fixture(t),gate=deferred();let context;
 const factory=createOwnedSharedDesktopSourceFactory(registration,{sourceConstructor:async value=>{context=value;await gate.promise;return f.source}});
 assert.equal(isOwnedSharedDesktopSourceFactory(factory),true);assert.equal(isOwnedSharedDesktopSourceFactory({...factory}),false);
 const creating=factory.create(f.bridge.context);
 const first={v:1,type:'shared-account-observation',profileId:f.profileId,generation:f.generation,revision:1};
 const second={v:1,type:'shared-account-revoked',profileId:f.profileId,generation:f.generation,revision:2};
 f.bridge.receiveNative(first);f.bridge.receiveNative(second);assert.deepEqual(f.seen,[]);
 gate.resolve();f.bridge.activate(await creating);assert.deepEqual(f.seen,[first,second]);
 assert.equal(context.getOwnedView,f.bridge.context.getOwnedView);assert.equal(context.verifyContainerSync(),true);
});
test('view authority exists only after actual server creation and is permanently retired on destroy',t=>{
 const f=fixture(t),id=randomUUID();f.bridge.activate(f.source);
 assert.equal(f.bridge.context.getOwnedView(id),null);assert.equal(f.bridge.context.verifyOwnedViewSync(id),false);
 const record=f.bridge.viewCreated(id);assert.equal(Object.isFrozen(record),true);assert.equal(f.bridge.context.getOwnedView(id),record);
 assert.deepEqual(record,{profileId:f.profileId,generation:f.generation,viewId:id});
 f.bridge.retireView(id);f.bridge.retireView(id);assert.equal(f.bridge.context.getOwnedView(id),null);assert.deepEqual(f.retired,[id]);
 assert.throws(()=>f.bridge.viewCreated(id),{code:'CONTAINER_SHARED_PROTOCOL_ERROR'});
});
test('pending source output is bounded by frame count rather than silently dropped',t=>{
 const f=fixture(t),frame={v:1,type:'shared-account-revoked',profileId:f.profileId,generation:f.generation};
 for(let n=0;n<64;n++)assert.equal(f.bridge.receiveNative({...frame,revision:n}),true);
 assert.throws(()=>f.bridge.receiveNative({...frame,revision:65}),{code:'CONTAINER_QUEUE_FULL'});
 assert.throws(()=>f.bridge.activate(f.source),{code:'CONTAINER_IDENTITY_CHANGED'});
});
test('pending source output retains the existing eight MiB aggregate budget',t=>{
 const f=fixture(t),frame={v:1,type:'shared-account-revoked',profileId:f.profileId,generation:f.generation};
 const encoded='x'.repeat(4*1024*1024);f.bridge.receiveNative(frame,encoded);f.bridge.receiveNative(frame,encoded);
 assert.throws(()=>f.bridge.receiveNative(frame,'x'),{code:'CONTAINER_QUEUE_FULL'});
});
test('foreign instance shared frames are rejected and never enter the pending queue',t=>{
 const f=fixture(t);assert.throws(()=>f.bridge.receiveNative({v:1,type:'shared-account-observation',profileId:f.profileId,generation:randomUUID()}),{code:'CONTAINER_SHARED_PROTOCOL_ERROR'});
 assert.deepEqual(f.seen,[]);
});
test('a late source cannot revive a closed startup',t=>{
 const f=fixture(t);f.bridge.close();assert.throws(()=>f.bridge.activate(f.source),{code:'CONTAINER_IDENTITY_CHANGED'});
 assert.equal(f.bridge.context.verifyContainerSync(),false);assert.equal(f.closed,1);
});
test('current source revision is checked after asynchronous outer identity verification',async t=>{
 const gate=deferred(),profileId=randomUUID(),generation=randomUUID();let revision=1,writes=0;
 const bridge=service.createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync:()=>true,writeNative:async(encoded,verify)=>{
   await gate.promise;if(!verify())throw Error('last write guard rejected');writes++;
 }});t.after(()=>bridge.close());
 bridge.activate({receiveNative:()=>true,retireView(){},close(){},accountRevision:()=>revision});
 const pending=bridge.context.writeNative(encodeWireValue({v:1,type:'shared-directory-close',profileId,generation}));
 revision=null;gate.resolve();await assert.rejects(pending,/last write guard rejected/);assert.equal(writes,0);
});
test('a ready same-source reply reaches only its guarded server writer',async t=>{
 const f=fixture(t);f.bridge.activate(f.source);const encoded=encodeWireValue({v:1,type:'shared-directory-close',profileId:f.profileId,generation:f.generation});
 await f.bridge.context.writeNative(encoded);assert.deepEqual(f.written,[encoded]);
 f.setLive(false);assert.equal(f.bridge.context.getOwnedView(randomUUID()),null);await assert.rejects(Promise.resolve().then(()=>f.bridge.context.writeNative(encoded)),{code:'CONTAINER_IDENTITY_CHANGED'});
});
test('source receive rejection stops output instead of falling through to browser subscribers',t=>{
 const f=fixture(t);f.source.receiveNative=()=>false;f.bridge.activate(f.source);
 assert.throws(()=>f.bridge.receiveNative({v:1,type:'shared-directory-error',profileId:f.profileId,generation:f.generation}),{code:'CONTAINER_SHARED_SOURCE_FAILED'});
 assert.equal(f.closed,1);assert.equal(f.bridge.context.verifyContainerSync(),false);
});

test('an account-bearing shared host without a durable history anchor is rejected before startup',async()=>{
 let calls=0;const factory=createOwnedSharedDesktopSourceFactory(registration,{sourceConstructor:async()=>{calls++;throw Error('must not start')}});
 for(const launch of [service.startContainerDesktopUpstream,startContainerDesktopService])
  await assert.rejects(launch({sharedDesktopSource:factory,accountSnapshot:{sourceFile:'/fixture/account.json',homeRoot:'/fixture/home'}}),{code:'CONTAINER_SHARED_IDENTITY_UNAVAILABLE'});
 assert.equal(calls,0);
});

test('an exact request verifier is retained through the async outer check to the actual native writer',async t=>{
 const gate=deferred(),profileId=randomUUID(),generation=randomUUID();let allowed=true,writes=0;
 const bridge=service.createContainerSharedSourceBridge({profileId,generation,verifyCurrentSync:()=>true,writeNative:async(_encoded,verify)=>{await gate.promise;if(verify()!==true)throw Error('thread retired before write');writes++;}});t.after(()=>bridge.close());
 bridge.activate({receiveNative:()=>true,retireView(){},close(){},accountRevision:()=>1});
 const pending=bridge.context.writeNative(encodeWireValue({v:1,type:'shared-directory-close',profileId,generation}),()=>allowed);
 allowed=false;gate.resolve();await assert.rejects(pending,/thread retired before write/);assert.equal(writes,0);
});

test('only the production source requests native App Tools; an alternate controlled fixture cannot select it with JSON',async()=>{
 const production=createOwnedSharedDesktopSourceFactory(registration);assert.equal(production.requiresAppTools,true);
 let captured;const alternate=createOwnedSharedDesktopSourceFactory(registration,{sourceConstructor:async value=>{captured=value;return {};}});
 assert.equal(alternate.requiresAppTools,false);assert.equal(Object.isFrozen(alternate),true);
 await alternate.create({profileId:randomUUID(),generation:randomUUID(),getOwnedView(){},verifyOwnedViewSync(){},verifyContainerSync(){},writeNative(){}});
 assert.equal(captured.nativeAppTools,false);assert.equal(isOwnedSharedDesktopSourceFactory({...production}),false);
});

test('an explicit executable acceptance fixture may request the same native App Tools handshake without task authority',async()=>{
 let captured;const factory=createOwnedSharedDesktopSourceFactory(registration,{nativeAppTools:true,sourceConstructor:async value=>{captured=value;return {}}});
 assert.equal(factory.requiresAppTools,true);await factory.create({profileId:randomUUID(),generation:randomUUID(),getOwnedView(){},verifyOwnedViewSync(){},verifyContainerSync(){},writeNative(){}});assert.equal(captured.nativeAppTools,true);
 for(const nativeAppTools of [null,1,'true',{}])assert.throws(()=>createOwnedSharedDesktopSourceFactory(registration,{nativeAppTools}));
});
