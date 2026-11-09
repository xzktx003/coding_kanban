import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createBrowserSharedThreadSubmission} from '../src/browser-shared-thread-submission.mjs';
// Unit stand-ins deliberately do not claim real browser isTrusted evidence.
function fixture(conversationId=null,{registerRoot=true,timeoutMs=30000,delaySendReceipt=false}={}){
 const listeners=new Map(),document={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 class Element{};const root=Object.assign(new Element(),{ownerDocument:document,isConnected:true,contains:x=>x?.ownerDocument===document}),editorDom={ownerDocument:document,isConnected:true,contains:x=>x===editorDom};document.getElementById=name=>name==='root'?root:null;
 class Event{constructor(type,more={}){Object.assign(this,{type,isTrusted:true,currentTarget:root,eventPhase:3,defaultPrevented:false,target:editorDom},more)}composedPath(){return[this.target,root]}}
 class MouseEvent extends Event{};class KeyboardEvent extends Event{};
 const win={document,Element,Event,MouseEvent,KeyboardEvent,crypto:{randomUUID},setTimeout,clearTimeout};
 const scope={profileId:randomUUID(),generation:randomUUID(),viewId:randomUUID()};
 let target={hostId:'kanban-shared-cli',conversationId,clientThreadId:'original-client'},life={sequence:1,epoch:randomUUID(),promise:Promise.resolve(true)},current=true;
 const frames=[],acks=[],writeReceipts=[];let adapter,autoAck=true;
 const sendMessage=async frame=>{frames.push(frame);if(delaySendReceipt)await new Promise(resolve=>writeReceipts.push(resolve));const ack=()=>adapter.receive({source:null,data:{type:frame.type+'-ack',attemptId:frame.attemptId,sequence:frame.sequence,epoch:frame.epoch,accepted:true}});queueMicrotask(()=>{if(autoAck)ack();else acks.push(ack)})};
 adapter=createBrowserSharedThreadSubmission({window:win,documentScope:scope,sendMessage,getLifecycle:()=>life,getComposer:()=>({getCommittedTarget:()=>({target,editorDom,canSubmit:true})}),isCurrent:()=>current,timeoutMs});
 if(registerRoot)adapter.wrapDelegatedListener(root,()=>{});
 return{adapter,scope,frames,root,releaseWriteReceipt:()=>{for(const resolve of writeReceipts.splice(0))resolve()},pauseAck:()=>{autoAck=false},releaseAck:()=>{for(const fn of acks.splice(0))fn()},captureEnter:event=>listeners.get('keydown')?.(event),captureClick:event=>listeners.get('click')?.(event),click:more=>new MouseEvent('click',{button:0,...more}),enter:more=>new KeyboardEvent('keydown',{key:'Enter',...more}),target:()=>target,setTarget:x=>{target=x},revoke:()=>{current=false;life={};adapter.invalidate()}};
}
test('trusted original create submit uses its real client, selected project/cwd and one acknowledged marker',async()=>{
 const f=fixture();try{
  const original=async()=>{const marker=await f.adapter.consumeComposerSubmit(f.target());return f.adapter.prepareComposerCreate({hostId:'kanban-shared-cli',clientThreadId:'original-client',attemptId:marker.__kanbanSharedCreateAttempt,projectId:'project-owned',cwd:'/fixed/project'})};
  const submit=f.adapter.wrapComposerSubmit(original,()=>f.target());const delegated=f.adapter.wrapDelegatedListener(f.root,()=>submit());
  const marker=await delegated(f.click());assert.equal(f.frames.length,1);assert.equal(f.frames[0].type,'kanban-shared-create-intent');assert.equal(f.frames[0].projectId,'project-owned');assert.equal(f.frames[0].cwd,'/fixed/project');assert.equal(marker.__kanbanSharedCreateClient,'original-client');
 }finally{f.adapter.dispose()}
});
test('existing-thread Enter hands the exact target to native intent and preserves original arguments/return',async()=>{
 const threadId=randomUUID(),f=fixture(threadId);try{
  const arg={prompt:'原文\nuntouched',model:'selected'},result={accepted:true};let seen;
  const submit=f.adapter.wrapComposerSubmit(async input=>{seen=input;const marker=await f.adapter.consumeComposerSubmit({...f.target(),clientThreadId:null});assert.ok(marker.__kanbanSharedSendAttempt);return result},()=>f.target());
  const delegated=f.adapter.wrapDelegatedListener(f.root,()=>submit(arg));assert.equal(await delegated(f.enter()),result);assert.equal(seen,arg);assert.equal(f.frames.length,1);assert.equal(f.frames[0].threadId,threadId);assert.equal(f.frames[0].type,'kanban-shared-send-intent');
 }finally{f.adapter.dispose()}
});
test('programmatic submit, untrusted event, another committed target and duplicate event cannot create native intent',async()=>{
 const f=fixture();try{
  const submit=f.adapter.wrapComposerSubmit(()=>{},()=>f.target());assert.throws(()=>submit(),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});
  const delegated=f.adapter.wrapDelegatedListener(f.root,()=>submit());assert.throws(()=>delegated(f.click({isTrusted:false})),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});
  const wrong=f.adapter.wrapComposerSubmit(()=>{},()=>({...f.target(),conversationId:randomUUID()}));assert.throws(()=>f.adapter.wrapDelegatedListener(f.root,()=>wrong())(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});
  assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});
test('changing the committed target before async create preparation rejects without clearing or dispatching',async()=>{
 const f=fixture();try{
  let cleared=0;
  const submit=f.adapter.wrapComposerSubmit(async()=>{const marker=await f.adapter.consumeComposerSubmit(f.target());f.setTarget({...f.target(),clientThreadId:'other-client'});await f.adapter.prepareComposerCreate({hostId:'kanban-shared-cli',clientThreadId:'original-client',attemptId:marker.__kanbanSharedCreateAttempt,projectId:'owned',cwd:'/fixed/project'});cleared++},()=>f.target());
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});assert.equal(f.frames.length,0);assert.equal(cleared,0);
 }finally{f.adapter.dispose()}
});

test('the original click captures text/model before ACK; later editor changes do not change that submission',async()=>{
 const f=fixture(randomUUID());f.pauseAck();try{
  let draft='clicked text',model='clicked model',captured,sent;
  const submit=f.adapter.wrapComposerSubmit(async()=>{
   captured={text:draft,model};
   await f.adapter.consumeComposerSubmit({...f.target(),clientThreadId:null});
   sent=captured;return sent;
  },()=>f.target());
  const result=f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click());
  assert.deepEqual(captured,{text:'clicked text',model:'clicked model'},'the actual original callback starts in the trusted click stack');
  draft='new unsent draft';model='new unsent model';
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,undefined);f.releaseAck();
  assert.deepEqual(await result,{text:'clicked text',model:'clicked model'});assert.equal(draft,'new unsent draft');assert.equal(model,'new unsent model');
 }finally{f.adapter.dispose()}
});
test('the original editor Enter callback can submit before React bubble through the passive trusted bracket',async()=>{
 const f=fixture(randomUUID());try{
  const submit=f.adapter.wrapComposerSubmit(async()=>{const captured='original keyboard text';await f.adapter.consumeComposerSubmit({...f.target(),clientThreadId:null});return captured},()=>f.target());
  f.captureEnter(f.enter());assert.equal(await submit(),'original keyboard text');assert.equal(f.frames.length,1);
  await Promise.resolve();assert.throws(()=>submit(),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});
 }finally{f.adapter.dispose()}
});


test('expired explicit shared project choice is reported by the original error handler and never falls back',()=>{
 const f=fixture();try{
  let originalCalls=0;const failures=[],failure=Object.assign(new Error('Shared project selection unavailable'),{code:'SHARED_PROJECT_SELECTION_UNAVAILABLE'});
  const submit=f.adapter.wrapComposerSubmit(()=>{originalCalls++},()=>{throw failure},error=>failures.push(error));
  assert.throws(()=>f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),error=>error===failure);
  assert.deepEqual(failures,[failure]);assert.equal(originalCalls,0);assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});


test('registered original root capture reaches its pinned submit in a nested delegate without the outer bubble',async()=>{
 const f=fixture();try{
  const event=f.click({eventPhase:1,currentTarget:null});f.captureClick(event);
  // A native dispatch may perform a microtask checkpoint between listeners.
  await Promise.resolve();event.eventPhase=2;
  const submit=f.adapter.wrapComposerSubmit(async()=>{const marker=await f.adapter.consumeComposerSubmit(f.target());return f.adapter.prepareComposerCreate({...f.target(),attemptId:marker.__kanbanSharedCreateAttempt,projectId:'owned',cwd:'/fixed/project'})},()=>f.target());
  const marker=await submit();assert.ok(marker.__kanbanSharedCreateAttempt);assert.equal(f.frames.length,1);
  assert.throws(()=>submit(),{code:'SHARED_COMPOSER_SUBMIT_DENIED'});
 }finally{f.adapter.dispose()}
});

test('editor capture survives a microtask within the dispatch but expires when the native dispatch ends',async()=>{
 const f=fixture(randomUUID());try{
  const submit=f.adapter.wrapComposerSubmit(async()=>{await f.adapter.consumeComposerSubmit(f.target());return true},()=>f.target());
  const event=f.enter({eventPhase:1,currentTarget:null});f.captureEnter(event);await Promise.resolve();event.eventPhase=2;assert.equal(await submit(),true);
  const late=f.enter({eventPhase:1,currentTarget:null});f.captureEnter(late);late.eventPhase=0;
  assert.throws(()=>submit(),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'gesture-expired'});
 }finally{f.adapter.dispose()}
});

test('capture cannot invent a gesture outside the registered root or from an untrusted click',()=>{
 for(const kind of ['untrusted','wrong-path','unregistered']){
  const f=fixture(null,{registerRoot:kind!=='unregistered'});try{
   const event=f.click({eventPhase:1,currentTarget:null,...kind==='untrusted'?{isTrusted:false}:{}});if(kind==='wrong-path')event.composedPath=()=>[event.target,{}];
   f.captureClick(event);let calls=0;const submit=f.adapter.wrapComposerSubmit(()=>{calls++},()=>f.target());
   assert.throws(()=>submit(),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'gesture-missing'});assert.equal(calls,0);assert.equal(f.frames.length,0);
  }finally{f.adapter.dispose()}
 }
});

// Pinned HG calls its existing onDeferred then returns a resolved Promise.
// PG later calls HG directly, so the continuation does not pass through bf.
test('original acknowledged deferral keeps only that gesture alive for the queued create continuation',async()=>{
 const f=fixture();try{
  let loading=true,queued=null,deferredCalls=0;
  const lower=async()=>{const marker=await f.adapter.consumeComposerSubmit(f.target());return f.adapter.prepareComposerCreate({...f.target(),attemptId:marker.__kanbanSharedCreateAttempt,projectId:'owned',cwd:'/fixed/project'})};
  const original=async(options={})=>{if(loading){queued=options;options.onDeferred?.();f.adapter.markComposerDeferred?.({conversationId:f.target().conversationId,clientThreadId:f.target().clientThreadId});return}return lower()};
  const options={onDeferred:()=>{deferredCalls++}},submit=f.adapter.wrapComposerSubmit(original,()=>f.target());
  assert.equal(await f.adapter.wrapDelegatedListener(f.root,()=>submit(options))(f.click()),undefined);
  assert.equal(deferredCalls,1);assert.equal(queued,options);assert.equal(f.frames.length,0);
  loading=false;const marker=await original(queued);
  assert.ok(marker.__kanbanSharedCreateAttempt);assert.equal(f.frames.length,1);
  await assert.rejects(original(queued),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
 }finally{f.adapter.dispose()}
});
test('queued existing send retains its exact one acknowledged intent until original continuation consumes it',async()=>{
 const f=fixture(randomUUID());try{
  let loading=true;
  const original=async()=>{if(loading){f.adapter.markComposerDeferred?.({conversationId:f.target().conversationId,clientThreadId:f.target().clientThreadId});return}return f.adapter.consumeComposerSubmit({...f.target(),clientThreadId:null})};
  const submit=f.adapter.wrapComposerSubmit(original,()=>f.target());
  await f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click());loading=false;
  const marker=await original();assert.ok(marker.__kanbanSharedSendAttempt);assert.equal(f.frames.length,1);
  await assert.rejects(original(),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
 }finally{f.adapter.dispose()}
});
test('a normal early return and an out-of-stack deferred marker never retain submission authority',async()=>{
 const f=fixture();try{
  const errors=[],submit=f.adapter.wrapComposerSubmit(async()=>{},()=>f.target(),error=>errors.push(error));
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'});
  assert.deepEqual(errors.map(error=>({code:error.code,phase:error.phase})),[{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'}]);
  assert.equal(f.adapter.markComposerDeferred(),false);
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
  assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});
test('a deferred signal for another original composer cannot retain the shared gesture',async()=>{
 const f=fixture();try{
  const submit=f.adapter.wrapComposerSubmit(async()=>{assert.equal(f.adapter.markComposerDeferred({conversationId:null,clientThreadId:'other-original-client'}),false)},()=>f.target());
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'});
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
  assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});
test('an original callback failure after deferral still retires the exact flow without retry',async()=>{
 const f=fixture();try{
  const failure=new Error('original callback failed');
  const submit=f.adapter.wrapComposerSubmit(async()=>{f.adapter.markComposerDeferred({conversationId:null,clientThreadId:f.target().clientThreadId});throw failure},()=>f.target());
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),error=>error===failure);
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
  assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});
test('original deferral cannot extend its initial deadline or survive committed target revocation',async()=>{
 for(const changed of ['deadline','target']){
  const f=fixture(null,{timeoutMs:10});try{
   const submit=f.adapter.wrapComposerSubmit(async()=>{f.adapter.markComposerDeferred?.({conversationId:f.target().conversationId,clientThreadId:f.target().clientThreadId})},()=>f.target());
   await f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click());
   if(changed==='deadline')await new Promise(resolve=>setTimeout(resolve,20));
   else f.setTarget({...f.target(),clientThreadId:'changed-client'});
   assert.equal(f.adapter.markComposerDeferred(),false);
   await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
   assert.equal(f.frames.length,0);
  }finally{f.adapter.dispose()}
 }
});


test('a create consumed by the original callback but resolved without native intent reports no-submission',async()=>{
 const f=fixture();try{
  const errors=[],draft={text:'keep original draft',model:'original model'},args={draft},owner={},result={original:true};let seenThis,seenArgs,called=0;
  const submit=f.adapter.wrapComposerSubmit(async function(...input){
   called++;seenThis=this;seenArgs=input;const marker=await f.adapter.consumeComposerSubmit(f.target());assert.ok(marker.__kanbanSharedCreateAttempt);
   // The real failing phase: original lower callback returns normally before prepareComposerCreate.
   return result;
  },()=>f.target(),error=>errors.push(error));
  const delegated=f.adapter.wrapDelegatedListener(f.root,()=>submit.call(owner,args));
  await assert.rejects(delegated(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'});
  assert.equal(called,1);assert.equal(seenThis,owner);assert.deepEqual(seenArgs,[args]);assert.equal(seenArgs[0],args);
  assert.deepEqual(draft,{text:'keep original draft',model:'original model'});assert.equal(f.frames.length,0);
  assert.deepEqual(errors.map(error=>({code:error.code,phase:error.phase})),[{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'}]);
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
  assert.equal(f.frames.length,0);
 }finally{f.adapter.dispose()}
});

test('a consumed create with intent awaiting ACK is not reported as no-submission',async()=>{
 const f=fixture();f.pauseAck();try{
  const errors=[],args={prompt:'kept draft'},result={originalResult:true};let observed,settled=false;
  const submit=f.adapter.wrapComposerSubmit(async input=>{observed=input;const marker=await f.adapter.consumeComposerSubmit(f.target());await f.adapter.prepareComposerCreate({...f.target(),attemptId:marker.__kanbanSharedCreateAttempt,projectId:'owned',cwd:'/fixed/project'});return result},()=>f.target(),error=>errors.push(error));
  const pending=f.adapter.wrapDelegatedListener(f.root,()=>submit(args))(f.click());void pending.then(()=>{settled=true},()=>{settled=true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.frames.length,1);assert.equal(settled,false);assert.deepEqual(errors,[]);assert.equal(observed,args);assert.deepEqual(args,{prompt:'kept draft'});
  f.releaseAck();assert.equal(await pending,result);assert.equal(f.frames.length,1);assert.deepEqual(errors,[]);
 }finally{f.adapter.dispose()}
});

test('the existing unconsumed-send rejection remains even after its intent dispatch',async()=>{
 const f=fixture(randomUUID());try{
  const errors=[],submit=f.adapter.wrapComposerSubmit(async()=>{await new Promise(resolve=>setImmediate(resolve));return true},()=>f.target(),error=>errors.push(error));
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'});
  assert.equal(f.frames.length,1);assert.equal(errors.length,1);assert.equal(errors[0].phase,'no-submission');
 }finally{f.adapter.dispose()}
});


test('immediate original resolve retires the flow before a late intent write receipt and ACK',async()=>{
 const f=fixture(randomUUID(),{delaySendReceipt:true});f.pauseAck();try{
  const errors=[],draft={text:'keep unsent draft'},submit=f.adapter.wrapComposerSubmit(async input=>input,()=>f.target(),error=>errors.push(error));
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit(draft))(f.click()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'no-submission'});
  assert.equal(f.frames.length,1);assert.deepEqual(draft,{text:'keep unsent draft'});
  f.releaseWriteReceipt();await new Promise(resolve=>setImmediate(resolve));
  f.releaseAck();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.frames.length,1);assert.equal(errors.length,1);assert.equal(errors[0].phase,'no-submission');
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
 }finally{f.adapter.dispose()}
});

test('late intent settlement cleanup preserves the original callback failure and never replays',async()=>{
 const f=fixture(randomUUID(),{delaySendReceipt:true});f.pauseAck();try{
  const originalFailure=new Error('controlled original callback failure'),errors=[];
  const submit=f.adapter.wrapComposerSubmit(async()=>{throw originalFailure},()=>f.target(),error=>errors.push(error));
  await assert.rejects(f.adapter.wrapDelegatedListener(f.root,()=>submit())(f.click()),error=>error===originalFailure);
  assert.equal(f.frames.length,1);f.releaseWriteReceipt();await new Promise(resolve=>setImmediate(resolve));
  f.releaseAck();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(errors,[]);assert.equal(f.frames.length,1);
  await assert.rejects(f.adapter.consumeComposerSubmit(f.target()),{code:'SHARED_COMPOSER_SUBMIT_DENIED',phase:'consume'});
 }finally{f.adapter.dispose()}
});
