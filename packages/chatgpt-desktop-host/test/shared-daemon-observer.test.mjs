import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod,mkdtemp,rm,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startSharedDaemonObserver} from '../src/shared-daemon-observer.mjs';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
const sha=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
const fixture=fileURLToPath(new URL('./owned-ws-daemon.mjs',import.meta.url));
function ticks(pid){const value=readFileSync(`/proc/${pid}/stat`,'utf8');return value.slice(value.lastIndexOf(')')+2).trim().split(/\s+/)[19];}
async function start(t,mode='normal'){
 const dir=await mkdtemp(join(tmpdir(),'shared-observer-'));await chmod(dir,0o700);
 const socketPath=join(dir,'daemon.sock'),seen=[];
 const child=spawn(process.execPath,[fixture,'app-server',socketPath,dir,mode],{stdio:['ignore','ignore','pipe','ipc']});
 child.stderr.on('data',()=>{});child.on('message',m=>seen.push(m));
 let timer;try{await Promise.race([new Promise((resolve,reject)=>{child.on('message',m=>{if(m.ready)resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('fixture exited')));}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture timeout')),3000);})]);}finally{clearTimeout(timer);}
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 return {dir,child,seen,daemon:{pid:child.pid,startTicks:ticks(child.pid),socketPath,daemonGeneration:randomUUID(),exeSha256:sha}};
}
async function until(predicate){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw Error('fixture deadline');await new Promise(resolve=>setTimeout(resolve,5));}}
test('two actual read-only account replies bind the live Unix daemon, then account change revokes it',async t=>{
 const f=await start(t),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 assert.equal(observer.matchesPrincipal({accountId:'fixture-account',userId:'fixture-user'}),true);
 const digest=createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','fixture-account','fixture-user'])).digest('hex');
 assert.equal(observer.matchesFingerprint(digest),true);
 assert.equal(observer.matchesFingerprint('0'.repeat(64)),false);
 assert.ok(observer.expiresAtMs>Date.now());
 assert.equal(observer.matchesPrincipal({accountId:'fixture-account',userId:'other-user'}),false);
 const threadId=randomUUID();assert.equal((await observer.readThread(threadId)).thread.id,threadId);
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
 assert.equal(f.seen.filter(x=>x.method==='account/read').length,2);
 assert.equal(f.seen.filter(x=>x.method==='getAuthStatus').length,2);
 f.child.send({type:'revoke'});await until(()=>observer.signal.aborted);
 await assert.rejects(observer.readThread(threadId),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});
for(const mode of ['missing-user','wrong-account','expired-token'])test(`account identity ${mode} is rejected even with a matching email`,async t=>{
 const f=await start(t,mode);
 await assert.rejects(startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000}),{code:'SHARED_DAEMON_AUTH_UNVERIFIED'});
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});
for(const [mode,userId] of [['preferred-user','preferred-user'],['fallback-account','fixture-user'],['opaque-user','opaque|user+值']])test(`matches the original principal conversion for ${mode}`,async t=>{
 const f=await start(t,mode),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 assert.equal(observer.matchesPrincipal({accountId:'fixture-account',userId}),true);
 if(mode==='preferred-user')assert.equal(observer.matchesPrincipal({accountId:'fixture-account',userId:'fixture-user'}),false);
});
test('one authenticated socket carries the authorized gate request and its real reply; observer IDs stay private',async t=>{
 const f=await start(t),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 const replies=[],serverRequests=[];
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,write:encoded=>observer.writeGateFrame(encoded)});
 t.after(()=>gate.close());
 observer.signal.addEventListener('abort',()=>gate.close(),{once:true});
 observer.attachGateReceiver(encoded=>{const frame=JSON.parse(encoded);if(frame.method)serverRequests.push(frame);else replies.push(JSON.parse(gate.receive(encoded)));return true;});
 const threadId=randomUUID(),binding={hostId:'local',runtimeGeneration:randomUUID(),daemonGeneration:f.daemon.daemonGeneration,accountRevision:1,projectId:'project',threadId,viewId:randomUUID(),clientId:randomUUID()};
 const frame={id:19,method:'thread/resume',params:{threadId,excludeTurns:true}};
 assert.throws(()=>gate.write(JSON.stringify(frame)),{code:'SHARED_DAEMON_DENIED'});
 assert.equal(gate.registerConnect(binding,frame,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000}),true);
 gate.write(JSON.stringify(frame));await until(()=>replies.length===1);
 assert.equal(replies[0].id,frame.id);assert.equal(replies[0].result.thread.id,threadId);
 for(const id of [20,'20'])gate.write(JSON.stringify({id,method:'thread/read',params:{threadId,includeTurns:false}}));
 const ownRead=observer.readThread(threadId);await until(()=>replies.length===3);await ownRead;
 assert.deepEqual(replies.slice(1).map(x=>x.id),[20,'20']);
 assert.equal(f.seen.filter(x=>x.method==='initialize').length,1);
 const observerId=f.seen.find(x=>x.method==='getAuthStatus').id;
 assert.throws(()=>gate.write(JSON.stringify({id:observerId,method:'thread/read',params:{threadId,includeTurns:false}})),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
 assert.equal(f.seen.some(x=>x.id===observerId&&x.method==='thread/read'),false);
 // Server request IDs occupy a separate JSON-RPC namespace: the same string
 // is legal as the ID of a response to a server-originated request.
 f.child.send({type:'server-request',threadId});await until(()=>serverRequests.length===1);
 observer.writeGateFrame(JSON.stringify({id:observerId,result:{answers:{}}}));
 await until(()=>f.seen.some(x=>x.id===observerId&&x.method==='response'));
 f.child.send({type:'duplicate'});await until(()=>observer.signal.aborted);
 assert.equal(replies.length,3);
});
test('observer and gate requests share the existing 64 in-flight slot budget',async t=>{
 const f=await start(t,'hold-all'),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,write:encoded=>observer.writeGateFrame(encoded)});
 t.after(()=>gate.close());observer.signal.addEventListener('abort',()=>gate.close(),{once:true});
 observer.attachGateReceiver(encoded=>{gate.receive(encoded);return true;});
 const threadId=randomUUID(),own=observer.readThread(threadId);own.catch(()=>{});
 for(let id=1000;id<1063;id++)gate.write(JSON.stringify({id,method:'thread/read',params:{threadId,includeTurns:false}}));
 assert.throws(()=>gate.write(JSON.stringify({id:1063,method:'thread/read',params:{threadId,includeTurns:false}})),{code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
 await until(()=>f.seen.filter(x=>x.method==='thread/read').length===64);
 assert.equal(f.seen.some(x=>x.id===1063),false);
 observer.close();await assert.rejects(own,{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
test('two owned Unix daemons provide bounded raw pages and metadata with independent revocation',async t=>{
 const a=await start(t),b=await start(t);
 const x=await startSharedDaemonObserver({daemon:a.daemon,codexHome:a.dir,timeoutMs:1000});t.after(()=>x.close());
 const y=await startSharedDaemonObserver({daemon:b.daemon,codexHome:b.dir,timeoutMs:1000});t.after(()=>y.close());
 const first=await x.listThreads({limit:2,useStateDbOnly:true});
 assert.equal(first.data.length,1);assert.equal(first.data[0].cwd,a.dir);
 assert.deepEqual(first.data[0].unknownMetadata,{value:17});assert.equal(first.nextCursor,'fixture-page-2');assert.equal(first.unknownResultField,'preserved');
 const second=await x.listThreads({limit:2,useStateDbOnly:true,cursor:first.nextCursor});
 assert.equal(second.data[0].name,'second');assert.equal(second.nextCursor,null);assert.equal(second.backwardsCursor,'fixture-page-1');
 const other=await y.listThreads({limit:2,useStateDbOnly:true});assert.equal(other.data[0].cwd,b.dir);
 const metadata=await x.readThreadMetadata(first.data[0].id);
 assert.equal(metadata.thread.id,first.data[0].id);assert.deepEqual(metadata.thread.opaque,{source:'cli'});assert.equal(metadata.metadata,'preserved');
 assert.equal(a.seen.filter(x=>x.method==='thread/resume').length,0);assert.equal(b.seen.filter(x=>x.method==='thread/resume').length,0);
 assert.deepEqual(a.seen.filter(x=>x.method==='thread/list').map(x=>x.params),[{limit:2,useStateDbOnly:true},{limit:2,useStateDbOnly:true,cursor:'fixture-page-2'}]);
 await assert.rejects(x.readThreadMetadata('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),{code:'SHARED_DAEMON_RPC_FAILED'});
 assert.equal((await x.listThreads({limit:2,useStateDbOnly:true})).data[0].cwd,a.dir);
 let touched=false;const bad={limit:2,useStateDbOnly:true};Object.defineProperty(bad,'cursor',{enumerable:true,get(){touched=true;return 'x';}});
 await assert.rejects(x.listThreads(bad));assert.equal(touched,false);
 for(const params of [{limit:201,useStateDbOnly:true},{limit:2,useStateDbOnly:false},{limit:2,useStateDbOnly:true,cursor:'x'.repeat(4097)},{limit:2,useStateDbOnly:true,origin:'attacker'}])await assert.rejects(x.listThreads(params));
 a.child.send({type:'revoke'});await until(()=>x.signal.aborted);
 await assert.rejects(x.listThreads({limit:2,useStateDbOnly:true}),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 assert.equal((await y.listThreads({limit:2,useStateDbOnly:true})).data[0].cwd,b.dir);
 await unlink(b.daemon.socketPath);
 await assert.rejects(y.readThreadMetadata(other.data[0].id),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
test('read-only directory rejects a real Unix frame over the existing 16 MiB limit',async t=>{
 const f=await start(t,'oversize-frame'),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 await assert.rejects(observer.listThreads({limit:2,useStateDbOnly:true}),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
 assert.equal(observer.signal.aborted,true);assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
});

test('desktop connection observation and actual Unix daemon account gate one explicit resume and revoke it on change',async t=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
 const {createContainerSharedFrameRouter}=await import('../src/container-shared-frame-router.mjs');
 const {createContainerSharedAccountAuthority,createAccountBoundSharedAuthority}=await import('../src/container-shared-account-authority.mjs');
 const {decodeWireValue}=await import('../src/wire-value.mjs');
 const f=await start(t),daemon=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>daemon.close());
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),epoch=randomUUID(),attemptId=randomUUID();
 const sender={id:7,isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false},record={senderId:7,viewId,window,failed:false};
 const principal={accountId:'fixture-account',userId:'fixture-user',expiresAtMs:Date.now()+60000};
 let notice, principalNotice, statusNotice;
 const connection={backendAuth:{hasPendingAccountChange:false},getConnectionState:()=>'connected',getAccount:async()=>({account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'fixture-account'}}),getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,
 registerInternalNotificationHandler:fn=>(notice=fn,()=>{}),registerInternalAuthenticatedPrincipalChangeHandler:fn=>(principalNotice=fn,()=>{}),registerInternalConnectionStateHandler:fn=>(statusNotice=fn,()=>{}),registerHostEventHandler:()=>()=>{}};
 const owner={connection,isCurrent:()=>true,disposed:false};
 const account=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync:()=>true,daemon});
 let binding,router,native;
 const delegate={
  resolveBinding:async request=>{const rev=account.currentRevision();if(rev===null||request.viewId!==viewId||request.threadId!==threadId)return null;const history=await daemon.readThread(threadId);if(history.thread.cwd!==f.dir||!account.verifyRevisionSync(rev))return null;return binding={hostId:'local',runtimeGeneration:generation,daemonGeneration:f.daemon.daemonGeneration,accountRevision:rev,projectId:'fixture',threadId,viewId,clientId:randomUUID()};},
  verifyViewSync:req=>req.viewId===viewId&&req.threadId===threadId,verifyBindingSync:b=>!!binding&&JSON.stringify(b)===JSON.stringify(binding)&&account.verifyRevisionSync(b.accountRevision),verifyHistorySync:b=>!!binding&&JSON.stringify(b)===JSON.stringify(binding)&&account.verifyRevisionSync(b.accountRevision),verifyReadSync:()=>account.currentRevision()!==null,
  write:encoded=>{if(account.currentRevision()===null)throw Error('revoked');daemon.writeGateFrame(encoded);},
 };
 const sharedThread=createAccountBoundSharedAuthority({account,sharedThread:delegate});
 router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:()=>true,verifyOwnedViewSync:id=>id===viewId,writeNative:encoded=>native.receive(decodeWireValue(encoded)),sharedThread,onAccountFrame:frame=>account.receive(frame)});
 daemon.attachGateReceiver(encoded=>router.receiveDaemon(encoded));daemon.signal.addEventListener('abort',()=>{account.close();router.close()},{once:true});
 native=createNativeSharedThreadIntegration({profileId,generation,getRecord:id=>id===sender.id?record:null,getOwnedRecord:x=>x===sender?record:null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:frame=>router.receiveNative(frame),desktopAccountObservation:true});
 t.after(()=>{native.dispose();router.close();account.close();});
 const release=native.registerHostEvents(owner,{getHostId:()=>'local'},{onNotification(){},onRequest(){return true}});t.after(release);
 await until(()=>account.currentRevision()!==null);
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
 assert.equal(native.lifecycle(sender,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
 assert.equal(await native.intent(sender,{type:'kanban-shared-connect-intent',v:1,action:'connect',attemptId,profileId,generation,viewId,hostId:'local',threadId,sequence:1,epoch}),true);
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
 const request={id:'test:one',method:'thread/resume',params:{threadId}};
 const reply=await native.withResume(sender,'local',{conversationId:threadId,__kanbanSharedConnectAttempt:attemptId},async()=>{const prepared=await native.prepareRequest('local',request);assert.equal(prepared.shared,true);return native.exchangeRequest(prepared.frame);});
 assert.equal(JSON.parse(reply).result.thread.id,threadId);
 await until(()=>f.seen.some(x=>x.method==='thread/resume'));const resumes=f.seen.filter(x=>x.method==='thread/resume');assert.equal(resumes.length,1);assert.deepEqual(resumes[0].params,{threadId,excludeTurns:true});
 notice({method:'account/updated',params:{authMode:'chatgpt'}});assert.equal(account.verifyRevisionSync(binding.accountRevision),false);
 assert.equal(f.seen.filter(x=>x.method==='thread/resume').length,1);
});
test('two authenticated Unix sources preserve raw pages and reject an unlisted duplicate UUID',async t=>{
 const {createThreadSourceRegistry}=await import('../src/thread-source-registry.mjs');
 const a=await start(t),b=await start(t),x=await startSharedDaemonObserver({daemon:a.daemon,codexHome:a.dir,timeoutMs:1000}),y=await startSharedDaemonObserver({daemon:b.daemon,codexHome:b.dir,timeoutMs:1000});
 t.after(()=>{x.close();y.close()});
 const adapter=(observer,generation)=>({generation,getAccountRevision:()=>1,verifySync:()=>{try{observer.assertCurrent();return true}catch{return false}},list:params=>observer.listThreads(params),read:id=>observer.readThreadMetadata(id)});
 const registry=createThreadSourceRegistry({privateSource:adapter(x,a.daemon.daemonGeneration),daemonSource:adapter(y,b.daemon.daemonGeneration)});t.after(()=>registry.close());
 const first=await registry.listPrivate({limit:2,useStateDbOnly:true});assert.equal(first.data[0].cwd,a.dir);assert.equal(first.nextCursor,'fixture-page-2');assert.equal(first.unknownResultField,'preserved');assert.deepEqual(first.data[0].unknownMetadata,{value:17});
 await assert.rejects(registry.resolve(first.data[0].id),{code:'THREAD_SOURCE_AMBIGUOUS'});
 const second=await registry.listPrivate({limit:2,useStateDbOnly:true,cursor:first.nextCursor});assert.equal(second.nextCursor,null);assert.equal(second.backwardsCursor,'fixture-page-1');
 assert.equal(a.seen.some(x=>x.method==='thread/resume'),false);assert.equal(b.seen.some(x=>x.method==='thread/resume'),false);
});
test('two actual Unix sources with the same thread reject page-bound native connect without resume',async t=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
 const {createContainerSharedFrameRouter}=await import('../src/container-shared-frame-router.mjs');
 const {createContainerSharedAccountAuthority,createAccountBoundSharedAuthority}=await import('../src/container-shared-account-authority.mjs');
 const {createSourceBoundSharedAuthority}=await import('../src/container-shared-source-authority.mjs');
 const {createThreadSourceRegistry}=await import('../src/thread-source-registry.mjs');
 const {decodeWireValue}=await import('../src/wire-value.mjs');
 const f=await start(t),p=await start(t),daemon=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000}),privateDaemon=await startSharedDaemonObserver({daemon:p.daemon,codexHome:p.dir,timeoutMs:1000});t.after(()=>{daemon.close();privateDaemon.close()});
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),epoch=randomUUID(),attemptId=randomUUID();
 const sender={id:7,isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false},record={senderId:7,viewId,window,failed:false};
 const principal={accountId:'fixture-account',userId:'fixture-user',expiresAtMs:Date.now()+60000};let notice;
 const connection={backendAuth:{hasPendingAccountChange:false},getConnectionState:()=>'connected',getAccount:async()=>({account:{type:'chatgpt'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'fixture-account'}}),getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,
 registerInternalNotificationHandler:fn=>(notice=fn,()=>{}),registerInternalAuthenticatedPrincipalChangeHandler:()=>()=>{},registerInternalConnectionStateHandler:()=>()=>{},registerHostEventHandler:()=>()=>{}};
 const owner={connection,isCurrent:()=>true,disposed:false};
 const account=createContainerSharedAccountAuthority({profileId,generation,verifyContainerSync:()=>true,daemon});
 const source=(observer,sourceGeneration)=>({generation:sourceGeneration,getAccountRevision:()=>account.currentRevision(),verifySync:()=>{try{observer.assertCurrent();return true}catch{return false}},list:params=>observer.listThreads(params),read:id=>observer.readThreadMetadata(id)});
 const registry=createThreadSourceRegistry({privateSource:source(privateDaemon,p.daemon.daemonGeneration),daemonSource:source(daemon,f.daemon.daemonGeneration),verifyViewSync:value=>value===record});
 let binding,router,native;const base={
  resolveBinding:async request=>{if(request.source.executionDomain!=='daemon'||request.source.cwd!==f.dir)return null;return binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:f.daemon.daemonGeneration,accountRevision:request.source.accountRevision,projectId:'fixture',threadId:request.threadId,viewId,clientId:randomUUID()};},
  verifyViewSync:req=>req.viewId===viewId,verifyBindingSync:b=>!!binding&&JSON.stringify(b)===JSON.stringify(binding),verifyHistorySync:b=>!!binding&&JSON.stringify(b)===JSON.stringify(binding),verifyReadSync:()=>true,
  write:encoded=>daemon.writeGateFrame(encoded),
 };
 const accountBound=createAccountBoundSharedAuthority({account,sharedThread:base});
 const sourceBound=createSourceBoundSharedAuthority({registry,getOwnedView:id=>id===viewId?record:null,sharedThread:accountBound});
 router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:()=>true,verifyOwnedViewSync:id=>id===viewId,writeNative:encoded=>native.receive(decodeWireValue(encoded)),sharedThread:sourceBound.sharedThread,onAccountFrame:frame=>account.receive(frame)});
 daemon.attachGateReceiver(encoded=>router.receiveDaemon(encoded));daemon.signal.addEventListener('abort',()=>{account.close();router.close()},{once:true});
 native=createNativeSharedThreadIntegration({profileId,generation,getRecord:id=>id===sender.id?record:null,getOwnedRecord:x=>x===sender?record:null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:frame=>router.receiveNative(frame),desktopAccountObservation:true,requireSourceToken:true});
 t.after(()=>{native.dispose();router.close();sourceBound.close();registry.close();account.close();});
 const release=native.registerHostEvents(owner,{getHostId:()=>'local'},{onNotification(){},onRequest(){return true}});t.after(release);await until(()=>account.currentRevision()!==null);
 const page=await registry.listDaemon({limit:2,useStateDbOnly:true,originators:undefined});assert.equal(page.nextCursor,'fixture-page-2');const threadId=page.data[0].id,[row]=registry.issuePageTokens(record,page);
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);native.lifecycle(sender,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch});
 const message={type:'kanban-shared-connect-intent',v:1,action:'connect',attemptId,profileId,generation,viewId,hostId:'kanban-shared-cli',threadId,sequence:1,epoch,sourceToken:row.token};
 assert.equal(await native.intent(sender,message),false);
 assert.equal(f.seen.some(x=>x.method==='thread/resume'),false);
 assert.equal(p.seen.some(x=>x.method==='thread/resume'),false);
 assert.equal(binding,undefined);
});


test('model discovery uses the same verified observer socket with a fixed bounded request and original cursor',async t=>{
 const f=await start(t),observer=await startSharedDaemonObserver({daemon:f.daemon,codexHome:f.dir,timeoutMs:1000});t.after(()=>observer.close());
 const first=await observer.readModelPage();assert.equal(first.data[0].model,'fixture-model');
 await observer.readModelPage('original opaque cursor');
 assert.deepEqual(f.seen.filter(x=>x.method==='model/list').map(x=>x.params),[{limit:100,includeHidden:false},{limit:100,includeHidden:false,cursor:'original opaque cursor'}]);
 assert.equal(f.seen.filter(x=>x.method==='initialize').length,1);
 await assert.rejects(observer.readModelPage({cursor:'browser object'}),{code:'SHARED_DAEMON_READ_INVALID'});
 assert.equal(f.seen.filter(x=>x.method==='model/list').length,2);
 assert.equal(f.seen.some(x=>['thread/start','thread/resume','turn/start'].includes(x.method)),false);
 f.child.send({type:'revoke'});await until(()=>observer.signal.aborted);
 await assert.rejects(observer.readModelPage(),{code:'SHARED_DAEMON_IDENTITY_CHANGED'});
});
