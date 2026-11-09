import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createSharedDesktopDaemonSession} from '../src/shared-desktop-daemon-session.mjs';
import {createSharedThreadCreationAuthority,consumeSharedThreadCreationReceipt} from '../src/shared-thread-creation.mjs';
import {createSharedCreatedThreadAdoption} from '../src/shared-created-thread-adoption.mjs';
import {createSourceBoundSharedAuthority} from '../src/container-shared-source-authority.mjs';
import {readBoundedChunks,parseJsonLines} from '../src/json-lines.mjs';
const {createNativeSharedDesktopTransport}=createRequire(import.meta.url)('../src/native-shared-desktop-transport.cjs');
const fixture=fileURLToPath(new URL('./owned-ws-daemon.mjs',import.meta.url));
const sha=createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
const ticks=pid=>{const text=readFileSync(`/proc/${pid}/stat`,'utf8');return text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/)[19];};
async function until(predicate){const end=Date.now()+2000;while(!predicate()){if(Date.now()>end)throw Error('owned peer deadline');await new Promise(resolve=>setTimeout(resolve,5));}}
async function ownedPeer(t,mode='normal'){
 const dir=await mkdtemp(join(tmpdir(),'desktop-owned-peer-'));await chmod(dir,0o700);const socketPath=join(dir,'daemon.sock'),seen=[];
 const child=spawn(process.execPath,[fixture,'app-server',socketPath,dir,mode],{stdio:['ignore','pipe','pipe','ipc']});
 child.stderr.on('data',()=>{});child.on('message',frame=>seen.push(frame));
 await until(()=>seen.some(frame=>frame.ready));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
 return{dir,child,seen,daemon:{pid:child.pid,startTicks:ticks(child.pid),socketPath,daemonGeneration:randomUUID(),exeSha256:sha}};
}
function createPair(f,{memoryBudget,verifyThreadMetadataSync,onAuthority=()=>{}}={}){
 const profileId=randomUUID(),generation=randomUUID(),messages=[],authority=[],failures=[],state={live:true},nativeToHost=[];
 let native,session;
 native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>state.live,timeoutMs:1000,sendFrame:frame=>{nativeToHost.push(frame);return session.receiveNative(frame);}});
 session=createSharedDesktopDaemonSession({profileId,generation,daemon:f.daemon,daemonVersion:'0.166.0',timeoutMs:1000,
  verifyContainerSync:()=>true,verifySessionSync:()=>state.live,verifyReadSync:()=>state.live,verifyBindingSync:()=>state.live,verifyHistorySync:()=>state.live,
  verifyInitializeSync:result=>result.codexHome===f.dir,verifyInitialAccountNotificationSync:()=>state.live,
  verifyServerEventSync:()=>state.live,authorizeServerReplySync:()=>false,
  sendFrame:frame=>native.receive(frame),receiveAuthority:encoded=>{const frame=JSON.parse(encoded);onAuthority(encoded);authority.push(frame);if(!frame.method)assert.equal(session.authorityGate.receive(encoded),encoded);return true;},
  onFailure:cause=>failures.push(cause.code),memoryBudget,verifyThreadMetadataSync,
 });
 return{native,session,messages,authority,failures,state,nativeToHost,close(){session.close();native.close();}};
}
async function initialize(pair){
 const connection=await pair.native.connect();connection.onmessage=event=>pair.messages.push(JSON.parse(event.data));
 const frame={id:'original-sdk-initialize',method:'initialize',params:{clientInfo:{name:'codex_desktop',title:'Codex Desktop',version:'26.1027.51404'},capabilities:{experimentalApi:true,requestAttestation:false}}};
 connection.send(JSON.stringify(frame));await until(()=>pair.messages.some(value=>value.id===frame.id));
 await until(()=>pair.messages.some(value=>value.method==='account/updated'));
 assert.equal(pair.nativeToHost.some(frame=>frame.type==='shared-desktop-write'&&JSON.parse(frame.text).method==='initialized'),false);
 return connection;
}

test('one real owned Unix WS carries original initialize and minimal explicitly registered resume, preserving peer responses',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());
 const connection=await initialize(pair);
 const threadId=randomUUID(),frame={id:'clicked-existing-thread',method:'thread/resume',params:{threadId,excludeTurns:true}};
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:f.daemon.daemonGeneration,accountRevision:1,projectId:'owned-project',threadId,viewId:randomUUID(),clientId:randomUUID()};
 const control={attemptId:randomUUID(),signal:new AbortController().signal,deadline:performance.now()+1000};
 assert.equal(pair.session.authorityGate.registerConnect(binding,frame,control),true);
 pair.session.authorityGate.write(JSON.stringify(frame));await until(()=>pair.authority.some(value=>value.id===frame.id));
 const response=pair.authority.find(value=>value.id===frame.id);assert.equal(response.result.thread.id,threadId);assert.equal(response.result.thread.turns.length,0);
 assert.equal(Object.hasOwn(response.result,'turnsBackwardsCursor'),true);assert.equal(Object.hasOwn(response.result,'itemsBackwardsCursor'),true);
 assert.deepEqual(f.seen.filter(value=>value.method==='thread/resume').map(value=>value.params),[{threadId,excludeTurns:true}]);
 assert.equal(f.seen.filter(value=>value.method==='initialize').length,1);assert.equal(pair.messages.some(value=>value.id===frame.id),false);
 connection.send(JSON.stringify({id:'native-read',method:'thread/read',params:{threadId,includeTurns:false}}));await until(()=>pair.messages.some(value=>value.id==='native-read'));
 assert.equal(pair.authority.some(value=>value.id==='native-read'),false);assert.deepEqual(pair.failures,[]);
 assert.throws(()=>pair.session.authorityGate.write(JSON.stringify({...frame,id:'not-clicked'})),{code:'SHARED_DAEMON_DENIED'});
 assert.equal(f.seen.some(value=>value.id==='not-clicked'),false);
});

test('runtime revocation blocks the actual socket write and never reconnects or retries',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 pair.state.live=false;
 assert.throws(()=>connection.send(JSON.stringify({id:'late-read',method:'thread/read',params:{threadId:randomUUID(),includeTurns:false}})));
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(f.seen.some(value=>value.id==='late-read'),false);
 assert.equal(f.seen.filter(value=>value.method==='initialize').length,1);await assert.rejects(pair.native.connect());
});

test('an SDK callback which throws cannot ACK or confirm the initialize reply',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());
 const connection=await pair.native.connect();connection.onmessage=()=>{throw Error('owned SDK callback did not consume its reply');};
 connection.send(JSON.stringify({id:'failed-consumption',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'},capabilities:{experimentalApi:true}}}));
 await until(()=>pair.session.signal.aborted);
 assert.equal(pair.nativeToHost.some(frame=>frame.type==='shared-desktop-received'),false);
 assert.equal(f.seen.filter(frame=>frame.method==='initialize').length,1);
 assert.equal(f.seen.some(frame=>frame.method==='initialized'||frame.method==='config/read'),false);
 assert.ok(pair.failures.includes('SHARED_DESKTOP_DAEMON_NATIVE_WRITE_FAILED'));
});
test('native SDK receives truthful errors for fixed read-only FS methods and continues on the same connection',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 for(const method of ['fs/readFile','fs/getMetadata','fs/readDirectory']){
  connection.send(JSON.stringify({id:method,method,params:{path:'/owned/home/auth.json'}}));
  await until(()=>pair.messages.some(frame=>frame.id===method));
  const response=pair.messages.find(frame=>frame.id===method);assert.equal(response.error.data.source,'kanban-shared-policy');assert.equal(response.error.message,`Shared desktop policy does not support ${method}`);assert.equal(Object.hasOwn(response,'result'),false);
  assert.equal(f.seen.some(frame=>frame.method===method),false);assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 }
 connection.send(JSON.stringify({id:'after-policy-errors',method:'account/read',params:{refreshToken:false}}));await until(()=>pair.messages.some(frame=>frame.id==='after-policy-errors'));
 assert.equal(f.seen.some(frame=>frame.id==='after-policy-errors'),true);assert.equal(f.seen.some(frame=>frame.method==='initialized'),false);
});

test('a second same-valued account notification retires the shared desktop channel',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());await initialize(pair);
 f.child.send({type:'revoke'});await until(()=>pair.session.signal.aborted);
 assert.throws(()=>pair.session.authorityGate.write(JSON.stringify({id:'after-account-change',method:'account/read',params:{refreshToken:false}})));
 assert.equal(f.seen.some(value=>value.id==='after-account-change'),false);
});

test('desktop message retention shares the authority byte pool and releases all its own allocations',async t=>{
 const f=await ownedPeer(t);let used=0,peak=0;
 const memoryBudget={reserveBytes(n){if(used+n>8*1024*1024)return false;used+=n;peak=Math.max(peak,used);return true;},releaseBytes(n){assert.ok(n<=used);used-=n;}};
 const pair=createPair(f,{memoryBudget});t.after(()=>pair.close());await initialize(pair);
 await until(()=>used===0);assert.ok(peak>0);
 const external=8*1024*1024-16;assert.equal(memoryBudget.reserveBytes(external),true);
 pair.close();await until(()=>used===external);memoryBudget.releaseBytes(external);assert.equal(used,0);
});

test('optional host capabilities return truthful errors and metadata continues on the same socket',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 for(const method of ['process/spawn','fs/createDirectory','process/kill','project/list','skills/list','plugin/list','environment/info','fuzzyFileSearch/sessionStart']){
  connection.send(JSON.stringify({id:method,method,params:method==='process/spawn'?{command:['/bin/sh','-c','mkdir -p /owned/worktrees'],cwd:'/owned/project',streamStdoutStderr:true,streamStdin:false,timeoutMs:null,processHandle:'native-process'}:{}}));
  await until(()=>pair.messages.some(frame=>frame.id===method));
  const response=pair.messages.find(frame=>frame.id===method);assert.equal(response.error.data.source,'kanban-shared-policy');assert.equal(response.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(response.error.data.method,method);assert.equal(Object.hasOwn(response,'result'),false);assert.equal(f.seen.some(frame=>frame.method===method),false);assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 }
 connection.send(JSON.stringify({id:'after-optional-errors',method:'account/read',params:{refreshToken:false}}));await until(()=>pair.messages.some(frame=>frame.id==='after-optional-errors'));assert.equal(f.seen.some(frame=>frame.id==='after-optional-errors'),true);
});

test('global metadata and stream for another daemon thread do not bind, retain or kill the owned writer',async t=>{
 const f=await ownedPeer(t),ownedThreadId=randomUUID(),otherThreadId=randomUUID();
 const pair=createPair(f,{verifyThreadMetadataSync:id=>id===ownedThreadId});t.after(()=>pair.close());const connection=await initialize(pair);
 f.child.send({type:'concurrent-thread-metadata',ownedThreadId,otherThreadId});
 await until(()=>pair.authority.some(frame=>frame.params?.threadId===ownedThreadId));
 assert.equal(pair.authority.some(frame=>frame.params?.threadId===otherThreadId),false);
 assert.equal(pair.messages.some(frame=>frame.params?.thread?.id===otherThreadId||frame.params?.threadId===otherThreadId),false);
 assert.equal(pair.authority.filter(frame=>frame.method==='item/agentMessage/delta').length,1);
 assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 connection.send(JSON.stringify({id:'after-unrelated-native-task',method:'account/read',params:{refreshToken:false}}));
 await until(()=>pair.messages.some(frame=>frame.id==='after-unrelated-native-task'));
 f.child.send({type:'unknown-thread-notification',threadId:otherThreadId});await until(()=>pair.session.signal.aborted);
 assert.ok(pair.failures.includes('SHARED_DESKTOP_DAEMON_RESPONSE_DENIED'));
});


test('startup enablement refusal returns to the original SDK while the same owned socket remains usable',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 const request={id:'original-enable-sync',method:'experimentalFeature/enablement/set',params:{enablement:{memories:false,remote_plugin:true,daybreak_program_propagation:true}}};
 assert.doesNotThrow(()=>connection.send(JSON.stringify(request)));
 await until(()=>pair.messages.some(frame=>frame.id===request.id));
 const response=pair.messages.find(frame=>frame.id===request.id);
 assert.equal(response.error.code,-32601);assert.equal(response.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(response.error.data.method,request.method);assert.equal(Object.hasOwn(response,'result'),false);
 assert.equal(f.seen.some(frame=>frame.method===request.method),false);assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 connection.send(JSON.stringify({id:'metadata-after-enable-refusal',method:'account/read',params:{refreshToken:false}}));
 await until(()=>pair.messages.some(frame=>frame.id==='metadata-after-enable-refusal'));
 assert.equal(f.seen.filter(frame=>frame.method==='initialize').length,1);assert.equal(f.seen.some(frame=>frame.id==='metadata-after-enable-refusal'),true);assert.equal(pair.session.signal.aborted,false);
});


test('startup rollout compression refusal never reaches the daemon and the same socket continues reads',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 assert.doesNotThrow(()=>connection.send(JSON.stringify({id:'original-background-compress',method:'rollout/compress'})));
 await until(()=>pair.messages.some(frame=>frame.id==='original-background-compress'));
 const response=pair.messages.find(frame=>frame.id==='original-background-compress');assert.equal(response.error.code,-32601);assert.equal(response.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(Object.hasOwn(response,'result'),false);
 assert.equal(f.seen.some(frame=>frame.method==='rollout/compress'),false);assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 connection.send(JSON.stringify({id:'metadata-after-compress-refusal',method:'account/read',params:{refreshToken:false}}));await until(()=>pair.messages.some(frame=>frame.id==='metadata-after-compress-refusal'));
 assert.equal(f.seen.filter(frame=>frame.method==='initialize').length,1);assert.equal(f.seen.some(frame=>frame.id==='metadata-after-compress-refusal'),true);assert.equal(pair.session.signal.aborted,false);
});

test('original metadata background start gets an explicit native-facing error and leaves the real Unix socket usable',async t=>{
 const f=await ownedPeer(t),pair=createPair(f);t.after(()=>pair.close());const connection=await initialize(pair);
 const request={id:'background-title-negative-capability',method:'thread/start',params:{model:'owned-fixture-model',modelProvider:null,allowProviderModelFallback:true,cwd:f.dir,approvalPolicy:'never',permissions:':read-only',runtimeWorkspaceRoots:[],config:{'features.hooks':false},personality:null,ephemeral:true,threadSource:'thread_title',experimentalRawEvents:false,dynamicTools:null,serviceTier:null,serviceName:'owned-fixture-service'}};
 connection.send(JSON.stringify(request));await until(()=>pair.messages.some(frame=>frame.id===request.id));
 const response=pair.messages.find(frame=>frame.id===request.id);assert.equal(response.error.code,-32601);assert.equal(response.error.data.code,'SHARED_CAPABILITY_NOT_SUPPORTED');assert.equal(Object.hasOwn(response,'result'),false);
 assert.equal(f.seen.some(frame=>frame.method==='thread/start'),false);assert.equal(pair.session.signal.aborted,false);assert.deepEqual(pair.failures,[]);
 connection.send(JSON.stringify({id:'after-background-title-refusal',method:'account/read',params:{refreshToken:false}}));await until(()=>pair.messages.some(frame=>frame.id==='after-background-title-refusal'));
 assert.equal(f.seen.some(frame=>frame.id==='after-background-title-refusal'),true);assert.equal(f.seen.filter(frame=>frame.method==='initialize').length,1);assert.equal(pair.session.signal.aborted,false);
});

const deferredDelivery=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve};};
async function createdDeliveryPair(t,{earlyAck=false,peerMode='normal',onAuthority=()=>{}}={}){
 const f=await ownedPeer(t,peerMode),profileId=randomUUID(),generation=randomUUID(),view={viewId:randomUUID()},delivery=deferredDelivery(),messages=[],events=[],failures=[],nativeToHost=[];let bound=false,attestation=null,native,session,receiptEmitted=false,replyConsumed=false;
 const scope={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:f.daemon.daemonGeneration,accountRevision:1,projectId:'owned-project',cwd:f.dir,viewId:view.viewId,creationNonce:randomUUID()},frame={id:'owned-created-delivery',method:'thread/start',params:{cwd:f.dir}},binding={hostId:scope.hostId,runtimeGeneration:generation,daemonGeneration:scope.daemonGeneration,accountRevision:1,projectId:scope.projectId,threadId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',viewId:view.viewId,clientId:randomUUID()};
 const creation=createSharedThreadCreationAuthority({verifyProjectSync:()=>true,getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyExplicitIntentSync:()=>true});
 const sharedThread={resolveBinding:async()=>{throw Error('No existing-thread bind');},verifyViewSync:()=>true,write:()=>{throw Error('No authority write in delivery fixture');},verifyBindingSync:b=>bound&&b.clientId===binding.clientId,verifyHistorySync:b=>bound&&b.clientId===binding.clientId,verifyReadSync:()=>true};
 const provider={sharedThread,executionProof:{getAttestationSync:()=>attestation},async resolveCreatedBinding(_request,receipt){const proof=consumeSharedThreadCreationReceipt(receipt,binding);assert.ok(proof);bound=true;attestation={policyOrigin:'native-start-response',nativeReplyDigest:proof.replySha256};return binding;}};
 const source=createSourceBoundSharedAuthority({registry:{resolveFromPage(){throw Error('No existing-thread catalog in creation test');},verifyResolvedSync:()=>false},getOwnedView:()=>view,sharedThread});
 const adoption=createSharedCreatedThreadAdoption({creationAuthority:creation,provider,getOwnedView:()=>view,verifyOwnedViewSync:()=>true,verifyCurrentSync:()=>true,adoptSourceBinding:(b,token)=>source.adoptCreatedBinding(b,token)});
 native=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>true,timeoutMs:1000,sendFrame:value=>{nativeToHost.push(value);return session.receiveNative(value);}});
 session=createSharedDesktopDaemonSession({profileId,generation,daemon:f.daemon,daemonVersion:'0.166.0',timeoutMs:1000,creation,createdAdoption:adoption,verifyContainerSync:()=>true,verifySessionSync:()=>true,verifyReadSync:()=>true,verifyBindingSync:sharedThread.verifyBindingSync,verifyHistorySync:sharedThread.verifyHistorySync,verifyInitializeSync:result=>result.codexHome===f.dir,verifyInitialAccountNotificationSync:()=>true,verifyServerEventSync:()=>true,authorizeServerReplySync:()=>false,
  resolveThreadNameBindingSync:id=>bound&&id===binding.threadId?binding:null,
  sendFrame:value=>{if(value.type==='shared-desktop-message'&&JSON.parse(value.text).id===frame.id){receiptEmitted=true;if(earlyAck){native.receive(value);return delivery.promise;}return delivery.promise.then(()=>native.receive(value));}return native.receive(value);},
  receiveAuthority:encoded=>{assert.equal(replyConsumed,true,'following metadata cannot precede the native created-reply consumption');onAuthority(encoded);events.push(JSON.parse(encoded));return true;},onFailure:error=>failures.push(error.code)});
 const pair={native,session,messages,authority:events,failures,state:{live:true},nativeToHost};const connection=await initialize(pair);connection.onmessage=event=>{const value=JSON.parse(event.data);messages.push(value);if(value.id===frame.id)replyConsumed=true;};
 creation.registerCreate(scope,frame,{signal:new AbortController().signal,deadline:performance.now()+5000});connection.send(JSON.stringify(frame));
 t.after(()=>{session.close();native.close();adoption.close();source.close();creation.close();delivery.resolve();});
 return{...pair,f,delivery,frame,connection,receiptEmitted:()=>receiptEmitted,replyConsumed:()=>replyConsumed};
}
test('created thread name uses the same real Unix socket and preserves native response, notification and errors',async t=>{
 const pair=await createdDeliveryPair(t);await until(()=>pair.receiptEmitted());pair.delivery.resolve();await until(()=>pair.replyConsumed()&&pair.authority.some(frame=>frame.method==='mcpServer/startupStatus/updated'));
 const threadId=pair.messages.find(frame=>frame.id===pair.frame.id).result.thread.id,name='原始名称 Raw',request={id:'original-title-fallback',method:'thread/name/set',params:{threadId,name}};
 pair.connection.send(JSON.stringify(request));await until(()=>pair.messages.some(frame=>frame.id===request.id)&&pair.authority.some(frame=>frame.method==='thread/name/updated'));
 assert.deepEqual(pair.f.seen.find(frame=>frame.id===request.id).params,{threadId,name});assert.deepEqual(pair.messages.find(frame=>frame.id===request.id).result,{});assert.deepEqual(pair.authority.find(frame=>frame.method==='thread/name/updated').params,{threadId,threadName:name});
 pair.connection.send(JSON.stringify({id:'original-empty-name-error',method:'thread/name/set',params:{threadId,name:''}}));await until(()=>pair.messages.some(frame=>frame.id==='original-empty-name-error'));
 assert.deepEqual(pair.messages.find(frame=>frame.id==='original-empty-name-error').error,{code:-32600,message:'Thread name cannot be empty'});
 pair.connection.send(JSON.stringify({id:'after-original-name',method:'account/read',params:{refreshToken:false}}));await until(()=>pair.messages.some(frame=>frame.id==='after-original-name'));
 assert.deepEqual(pair.failures,[]);assert.equal(pair.session.signal.aborted,false);assert.equal(pair.f.seen.filter(frame=>frame.method==='thread/start').length,1);
});
test('created reply waits for its actual asynchronous IPC write and precise consumption ACK before draining MCP notifications',async t=>{
 const pair=await createdDeliveryPair(t);await until(()=>pair.receiptEmitted());await new Promise(resolve=>setTimeout(resolve,25));assert.equal(pair.replyConsumed(),false);assert.deepEqual(pair.authority,[]);assert.deepEqual(pair.failures,[]);
 pair.delivery.resolve();await until(()=>pair.replyConsumed()&&pair.authority.some(value=>value.method==='mcpServer/startupStatus/updated'));
 assert.equal(pair.messages.filter(value=>value.id===pair.frame.id).length,1);assert.equal(pair.authority[0].params.error,'owned original startup failure');assert.deepEqual(pair.failures,[]);assert.equal(pair.session.signal.aborted,false);
});
test('early native consumption ACK cannot release created notifications before the guarded write receipt settles',async t=>{
 const pair=await createdDeliveryPair(t,{earlyAck:true});await until(()=>pair.receiptEmitted()&&pair.replyConsumed());await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(pair.authority,[]);assert.deepEqual(pair.failures,[]);
 pair.delivery.resolve();await until(()=>pair.authority.some(value=>value.method==='mcpServer/startupStatus/updated'));assert.equal(pair.messages.filter(value=>value.id===pair.frame.id).length,1);assert.deepEqual(pair.failures,[]);
});

test('created notification draining yields to real native JSONL input between guarded WS frames',async t=>{
 let processed=0,probeAt=null,pair;
 pair=await createdDeliveryPair(t,{peerMode:'startup-burst',onAuthority(){
  if(processed===0)pair.f.child.send({type:'created-drain-jsonl-probe'});
  // Model the synchronous file/identity guards from the retained real failure,
  // without changing production timeouts or performing any model/tool action.
  const end=performance.now()+10;while(performance.now()<end){}
  processed++;
 }});
 const readProbe=(async()=>{
  for await(const line of parseJsonLines(readBoundedChunks(pair.f.child.stdout,65536),{maxLineBytes:1024,maxChunkBytes:65536})){
   const value=JSON.parse(line);
   if(value.type==='created-drain-jsonl-probe'){probeAt=processed;return;}
  }
 })();
 t.after(()=>pair.f.child.stdout.destroy());
 await until(()=>pair.receiptEmitted());
 assert.deepEqual(pair.authority,[]);
 pair.delivery.resolve();
 await until(()=>processed===13&&probeAt!==null);await readProbe;
 assert.ok(probeAt>0&&probeAt<13,`native JSONL was starved behind all ${probeAt} guarded notifications`);
 assert.deepEqual(pair.authority.map(value=>value.params.name),Array.from({length:13},(_,index)=>'owned-server-'+index));
 assert.ok(pair.authority.every(value=>value.params.status==='failed'&&value.params.error==='owned original startup failure'));
 assert.equal(pair.messages.filter(value=>value.id===pair.frame.id).length,1);
 assert.deepEqual(pair.failures,[]);assert.equal(pair.session.signal.aborted,false);
});


test('ordinary WS notification draining yields to real child JSONL input between guarded frames',async t=>{
 let processed=0,probeAt=null,pair;
 const f=await ownedPeer(t),threadId=randomUUID();
 pair=createPair(f,{verifyThreadMetadataSync:id=>{const end=performance.now()+10;while(performance.now()<end){};return id===threadId;},onAuthority(){
  if(processed===0)f.child.send({type:'created-drain-jsonl-probe'});processed++;
 }});t.after(()=>pair.close());const connection=await initialize(pair);
 const readProbe=(async()=>{
  for await(const line of parseJsonLines(readBoundedChunks(f.child.stdout,65536),{maxLineBytes:1024,maxChunkBytes:65536})){
   if(JSON.parse(line).type==='created-drain-jsonl-probe'){probeAt=processed;return;}
  }
 })();t.after(()=>f.child.stdout.destroy());
 f.child.send({type:'ordinary-startup-burst',threadId});
 await until(()=>processed===13&&probeAt!==null);await readProbe;
 t.diagnostic(`ordinary notification count=${processed}, child JSONL observed after=${probeAt}`);
 assert.ok(probeAt>0&&probeAt<13,`ordinary native JSONL was starved behind all ${probeAt} guarded notifications`);
 assert.deepEqual(pair.authority.map(value=>value.params.name),Array.from({length:13},(_,index)=>'ordinary-server-'+index));
 assert.ok(pair.authority.every(value=>value.params.status==='failed'&&value.params.error==='owned original startup failure'));
 assert.deepEqual(pair.failures,[]);assert.equal(pair.session.signal.aborted,false);
 connection.send(JSON.stringify({id:'after-ordinary-burst',method:'account/read',params:{refreshToken:false}}));
 await until(()=>pair.messages.some(value=>value.id==='after-ordinary-burst'));
 assert.equal(f.seen.filter(value=>value.id==='after-ordinary-burst').length,1);
});


function ordinaryMemory(){let used=0,peak=0,count=0,peakCount=0;return{budget:{reserveBytes(n){if(used+n>8*1024*1024)return false;used+=n;count++;peak=Math.max(peak,used);peakCount=Math.max(peakCount,count);return true;},releaseBytes(n){assert.ok(n<=used);used-=n;count--;assert.ok(count>=0);}},used:()=>used,peak:()=>peak,peakCount:()=>peakCount};}
test('ordinary pending WS input shares the existing 64-frame pool and close releases every allocation',async t=>{
 const f=await ownedPeer(t),memory=ordinaryMemory(),pair=createPair(f,{memoryBudget:memory.budget});t.after(()=>pair.close());await initialize(pair);await until(()=>memory.used()===0);
 f.child.send({type:'ordinary-startup-burst',threadId:randomUUID(),count:65});await until(()=>pair.session.signal.aborted);await until(()=>memory.used()===0);
 assert.equal(pair.authority.length,0);assert.equal(memory.peakCount(),64);assert.ok(memory.peak()>0&&memory.peak()<=8*1024*1024);
 assert.deepEqual(pair.failures,['SHARED_DESKTOP_DAEMON_RESPONSE_DENIED']);
});
test('same-chunk account revocation closes immediately before queued notifications or a native write',async t=>{
 const f=await ownedPeer(t),memory=ordinaryMemory(),pair=createPair(f,{memoryBudget:memory.budget});t.after(()=>pair.close());const connection=await initialize(pair);await until(()=>memory.used()===0);
 f.child.send({type:'ordinary-startup-burst',threadId:randomUUID(),accountAfter:1});await until(()=>pair.session.signal.aborted);await until(()=>memory.used()===0);
 assert.equal(pair.authority.length,0);assert.deepEqual(pair.failures,['SHARED_DESKTOP_DAEMON_ACCOUNT_CHANGED']);
 assert.throws(()=>connection.send(JSON.stringify({id:'after-queued-account-change',method:'account/read',params:{refreshToken:false}})));
 assert.equal(f.seen.some(value=>value.id==='after-queued-account-change'),false);
});
test('owner close during ordinary dispatch clears the scheduled remainder and leaves no retained input',async t=>{
 const f=await ownedPeer(t),memory=ordinaryMemory();let pair,processed=0;
 pair=createPair(f,{memoryBudget:memory.budget,onAuthority(){processed++;pair.close();}});t.after(()=>pair.close());await initialize(pair);await until(()=>memory.used()===0);
 f.child.send({type:'ordinary-startup-burst',threadId:randomUUID()});await until(()=>pair.session.signal.aborted);await new Promise(resolve=>setTimeout(resolve,25));await until(()=>memory.used()===0);
 assert.equal(processed,1);assert.equal(pair.authority.length,1);assert.deepEqual(pair.failures,[]);
});


test('recognized observer OAuth revocations cannot wait behind the normal notification FIFO',async t=>{
 for(const method of ['account/login/completed','account/gatewayOAuth/changed']){
  const f=await ownedPeer(t),memory=ordinaryMemory(),pair=createPair(f,{memoryBudget:memory.budget});t.after(()=>pair.close());await initialize(pair);await until(()=>memory.used()===0);
  f.child.send({type:'ordinary-startup-burst',threadId:randomUUID(),revocationAfter:1,revocationMethod:method});await until(()=>pair.session.signal.aborted);await until(()=>memory.used()===0);
  assert.equal(pair.authority.length,0);assert.deepEqual(pair.failures,['SHARED_DESKTOP_DAEMON_RESPONSE_DENIED']);
  assert.throws(()=>pair.session.authorityGate.write(JSON.stringify({id:'after-received-oauth-change',method:'account/read',params:{refreshToken:false}})));
  assert.equal(f.seen.some(value=>value.id==='after-received-oauth-change'),false);
 }
});
