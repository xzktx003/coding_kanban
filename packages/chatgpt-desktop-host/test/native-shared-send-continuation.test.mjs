import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncResource} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url);
const {createNativeSharedThreadSendRouter}=require('../src/native-shared-thread-send-routing.cjs');
const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
const denied={code:'SHARED_SEND_INTENT_DENIED'};
function fixture(){
 const outside=new AsyncResource('original-execution-readiness'),sender={isDestroyed:()=>false},profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID();
 const record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}};
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'fixture-project',threadId:randomUUID(),viewId,clientId:randomUUID()};
 let fresh=true,clock=0;const writes=[];
 const router=createNativeSharedThreadSendRouter({profileId,generation,getRecord:()=>record,getOwnedRecord:s=>s===sender?record:null,verifyRuntimeSync:()=>fresh,verifyBindingSync:()=>fresh,resolveBinding:()=>binding,authorizeSend:(b,frame,control)=>{writes.push({b,frame,control});return true;},sendToView:()=>{},now:()=>clock});
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()};router.lifecycle(sender,life);
 const intent={type:'kanban-shared-send-intent',v:1,action:'send',profileId,generation,viewId,hostId:binding.hostId,threadId:binding.threadId,attemptId:randomUUID(),sequence:life.sequence,epoch:life.epoch};
 const frame={id:'turn:exact-original',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'captured continuation'}],model:'gpt-6.1-sol',effort:'low'}};
 const prepared=Object.freeze({conversationId:binding.threadId,start:Object.freeze({request:frame.params})});
 const run=(start,invoke)=>router.runPreparedSend?router.runPreparedSend(start,invoke):invoke();
 let capture,finish;const ready=new Promise(r=>{capture=r;}),done=new Promise(r=>{finish=r;});
 const start=async()=>{assert.equal(await router.intent(sender,intent),true);return router.withSend(sender,binding.hostId,{conversationId:binding.threadId,__kanbanSharedSendAttempt:intent.attemptId},async(_clean,bindPrepared)=>{assert.equal((bindPrepared??(x=>x))(prepared),prepared);capture();await done;});};
 return{router,binding,frame,prepared,outside,run,start,ready,finish,writes,intent,life,sender,revoke:()=>{fresh=false;},expire:()=>{clock=30000;}};
}
test('exact prepared start restores the still-live original gesture only at its later host start',async()=>{
 const f=fixture(),pending=f.start();try{await f.ready;
  await f.outside.runInAsyncScope(async()=>{
   await assert.rejects(()=>f.router.prepareRequest(f.binding.hostId,f.frame),denied);
   const result=await f.run(f.prepared.start,()=>f.router.prepareRequest(f.binding.hostId,f.frame));
   assert.deepEqual(result.frame,f.frame);assert.equal(f.writes.length,1);assert.equal(f.writes[0].control.attemptId,f.intent.attemptId);
   await assert.rejects(async()=>f.run(f.prepared.start,()=>f.router.prepareRequest(f.binding.hostId,f.frame)),denied);
  });
 }finally{f.finish();await pending;f.router.dispose();f.outside.emitDestroy();}
});
test('clones, unrelated starts, and settled, expired, replaced or revoked gestures cannot borrow a continuation',async()=>{
 for(const change of ['clone','foreign','settled','expired','lifecycle','revoked']){
  const f=fixture(),pending=f.start();try{await f.ready;
   let start=f.prepared.start;
   if(change==='clone')start={...start};if(change==='foreign')start={request:{...f.frame.params}};
   if(change==='settled'){f.finish();await pending;}if(change==='expired')f.expire();
   if(change==='lifecycle')f.router.lifecycle(f.sender,{...f.life,sequence:2,epoch:null});if(change==='revoked')f.revoke();
   await f.outside.runInAsyncScope(async()=>assert.rejects(async()=>f.run(start,()=>f.router.prepareRequest(f.binding.hostId,f.frame)),denied));
   assert.equal(f.writes.length,0,change);
  }finally{f.finish();await pending;f.router.dispose();f.outside.emitDestroy();}
 }
});
test('actual bootstrap runner reaches the integration facade and preserves the original promise and throw',async()=>{
 const bootstrap=await readFile(new URL('../src/native-bootstrap.cjs',import.meta.url),'utf8');
 const line=bootstrap.split('\n').find(x=>x.includes('Object.defineProperty(globalThis,"__kanbanRunSharedPreparedSend"'));
 assert.ok(line,'fixed native bootstrap entry must install the runner');
 for(const enabled of [false,true]){
  const sharedThread=createNativeSharedThreadIntegration({profileId:randomUUID(),generation:randomUUID(),getRecord:()=>null,getOwnedRecord:()=>null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:()=>{},enableSubmission:enabled});
  try{
   const sandbox={sharedThread};runInNewContext(line,sandbox);const run=sandbox.__kanbanRunSharedPreparedSend;
   if(!enabled){assert.throws(()=>run({},()=>{}),{code:'SHARED_NAV_UNAVAILABLE'});continue;}
   const promise=Promise.resolve('same original result');assert.equal(run({},()=>promise),promise);
   const failure=new Error('owned fixture rejection');assert.throws(()=>run({},()=>{throw failure;}),e=>e===failure);
  }finally{sharedThread.dispose();}
 }
});
