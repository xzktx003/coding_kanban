import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createContainerSharedFrameRouter} from '../src/container-shared-frame-router.mjs';

const require=createRequire(import.meta.url);
const {isSharedThreadAuthorityFrame}=require('../src/shared-thread-authority-wire.cjs');

test('default-disabled router never sends and rejects unsanctioned shared frames',()=>{
 const profileId=randomUUID(),generation=randomUUID();let writes=0;
 const router=createContainerSharedFrameRouter({profileId,generation,enabled:false});
 assert.equal(router.receiveNative({v:1,type:'viewMessage'}),false);
 assert.throws(()=>router.receiveNative({v:1,type:'shared-forged'}),{code:'CONTAINER_SHARED_FRAME_DENIED'});
 assert.equal(writes,0);router.close();
});

import {createServer, createConnection} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeWireValue,decodeWireValue} from '../src/wire-value.mjs';
import {readContainerProcessIdentitySync,matchesContainerProcessIdentitySync} from '../src/container-service.mjs';
const {createNativeSharedThreadIntegration}=require('../src/native-shared-thread-integration.cjs');
async function pair(t,dir,name){
 const server=createServer(),path=join(dir,name),accepted=once(server,'connection');
 server.on('error',()=>{});server.listen(path);await once(server,'listening');await chmod(path,0o600);
 const client=createConnection(path);client.on('error',()=>{});await once(client,'connect');const [peer]=await accepted;peer.on('error',()=>{});
 t.after(()=>{client.destroy();peer.destroy();server.close();});return {client,peer};
}
function lines(socket,onLine){let data='';socket.on('data',chunk=>{data+=chunk.toString('utf8');for(;;){const p=data.indexOf('\n');if(p<0)break;const line=data.slice(0,p);data=data.slice(p+1);onLine(line);}});}
function writeLine(socket,text){return new Promise((resolve,reject)=>socket.write(text+'\n',err=>err?reject(err):resolve()));}

test('one explicit native gesture carries the exact existing thread to a private real Unix daemon socket',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'shared-frame-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const nativeLink=await pair(t,dir,'native.sock'),daemonLink=await pair(t,dir,'daemon.sock');
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),epoch=randomUUID(),attemptId=randomUUID();
 const sender={id:7,isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false},record={senderId:7,viewId,window,failed:false};
 const processAnchor=readContainerProcessIdentitySync(process.pid),binding={hostId:'local',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'fixture',threadId,viewId,clientId:randomUUID()};
 const received=[];let live=true,native,router;
 const same=candidate=>JSON.stringify(candidate)===JSON.stringify(binding);
 const sharedThread={
   resolveBinding:async request=>request.viewId===viewId&&request.threadId===threadId&&request.hostId==='local'?binding:null,
   verifyViewSync:request=>live&&request.viewId===viewId&&request.threadId===threadId&&request.hostId==='local',
   verifyBindingSync:candidate=>live&&same(candidate),verifyHistorySync:candidate=>live&&same(candidate),verifyReadSync:()=>live,
   write:encoded=>{if(!live)throw Error('fixture identity revoked');daemonLink.client.write(encoded+'\n');},
 };
 router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:()=>live&&matchesContainerProcessIdentitySync(processAnchor),verifyOwnedViewSync:id=>live&&id===viewId,writeNative:encoded=>writeLine(nativeLink.peer,encoded),sharedThread});
 native=createNativeSharedThreadIntegration({profileId,generation,getRecord:id=>id===sender.id?record:null,getOwnedRecord:value=>value===sender?record:null,verifyRuntimeSync:()=>live,sendToView:()=>{},sendFrame:frame=>writeLine(nativeLink.client,encodeWireValue(frame))});
 lines(nativeLink.peer,line=>router.receiveNative(decodeWireValue(line)));
 lines(nativeLink.client,line=>native.receive(decodeWireValue(line)));
 lines(daemonLink.client,line=>router.receiveDaemon(line));
 lines(daemonLink.peer,line=>{
   const request=JSON.parse(line);received.push(request);
   if(request.method==='thread/resume')void writeLine(daemonLink.peer,JSON.stringify({id:request.id,result:{thread:{id:threadId,historyMode:'paginated',turns:[]},turnsBackwardsCursor:null,itemsBackwardsCursor:null}}));
 });
 t.after(()=>{native.dispose();router.close();});
 const request={id:'fixture:1',method:'thread/resume',params:{threadId}};
 await assert.rejects(native.exchangeRequest({...request,params:{threadId,excludeTurns:true}}));
 assert.equal(received.length,0,'without a gesture no daemon resume is written');
 assert.equal(native.lifecycle(sender,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
 assert.equal(await native.intent(sender,{type:'kanban-shared-connect-intent',v:1,action:'connect',attemptId,profileId,generation,viewId,hostId:'local',threadId,sequence:1,epoch}),true);
 assert.equal(received.length,0,'the gesture only authorizes the later exact request');
 const result=await native.withResume(sender,'local',{conversationId:threadId,__kanbanSharedConnectAttempt:attemptId},async()=>native.exchangeRequest(await native.guardRequest('local',request)));
 assert.deepEqual(received,[{...request,params:{threadId,excludeTurns:true}}]);
 assert.equal(JSON.parse(result).result.thread.id,threadId);
 await assert.rejects(native.withResume(sender,'local',{conversationId:threadId,__kanbanSharedConnectAttempt:attemptId},async()=>{}));
 assert.equal(received.length,1,'the same gesture cannot be replayed');
});
test('owned native account frames are validated and delivered only to the server account guard',()=>{
 const profileId=randomUUID(),generation=randomUUID(),received=[];
 const sharedThread={resolveBinding:async()=>null,verifyViewSync:()=>false,verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyReadSync:()=>false,write:()=>{throw Error('no writes')}};
 const router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:()=>true,verifyOwnedViewSync:()=>false,writeNative:()=>{},sharedThread,onAccountFrame:frame=>(received.push(frame),true)});
 const frame={v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId:randomUUID(),fingerprint:'b'.repeat(64),expiresAtMs:Date.now()+60000};
 assert.equal(router.receiveNative(frame),true);assert.deepEqual(received,[frame]);
 assert.throws(()=>router.receiveNative({...frame,email:'forbidden@example.invalid'}),{code:'CONTAINER_SHARED_FRAME_DENIED'});router.close();
});

test('private catalog uses the owned native connection through the bounded shared frame router',async()=>{
 const {createHostDirectoryIpc}=require('../src/shared-directory-ipc.cjs');
 const profileId=randomUUID(),generation=randomUUID(),threadId=randomUUID(),sent=[],accountFrames=[];let native,router,host;
 const principal={accountId:'workspace',userId:'user',expiresAtMs:Date.now()+60000};
 const connection={backendAuth:{hasPendingAccountChange:false},getConnectionState:()=>'connected',getAccount:async()=>({account:{type:'chatgpt'},requiresOpenaiAuth:true}),getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,registerInternalNotificationHandler:()=>()=>{},registerInternalAuthenticatedPrincipalChangeHandler:()=>()=>{},registerInternalConnectionStateHandler:()=>()=>{},registerHostEventHandler:()=>()=>{},
  listThreads:async params=>(sent.push(['list',params]),{data:[{id:threadId,cwd:'/fixture',turns:[],canAcceptDirectInput:true}],nextCursor:'cursor'}),
  readThread:async(id,options)=>(sent.push(['read',id,options]),{id,cwd:'/fixture',turns:[],canAcceptDirectInput:true})};
 const sharedThread={resolveBinding:async()=>null,verifyViewSync:()=>false,verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyReadSync:()=>false,write:()=>{throw Error('no daemon writes')}};
 router=createContainerSharedFrameRouter({profileId,generation,enabled:true,verifyContainerSync:()=>true,verifyOwnedViewSync:()=>false,writeNative:encoded=>{queueMicrotask(()=>native.receive(decodeWireValue(encoded)));},sharedThread,onAccountFrame:frame=>(accountFrames.push(frame),true),onDirectoryFrame:frame=>host.receive(frame)});
 native=createNativeSharedThreadIntegration({profileId,generation,getRecord:()=>null,getOwnedRecord:()=>null,verifyRuntimeSync:()=>true,sendToView:()=>{},sendFrame:frame=>{queueMicrotask(()=>router.receiveNative(frame));},desktopAccountObservation:true});
 host=createHostDirectoryIpc({profileId,generation,verifyCurrentSync:()=>true,sendFrame:frame=>router.sendDirectoryFrame(frame)});
 const release=native.registerHostEvents({connection,isCurrent:()=>true,disposed:false},{getHostId:()=>'local'},{onNotification(){},onRequest(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(accountFrames[0]?.type,'shared-account-observation');
 const page=await host.fetch('thread/list',{limit:5,useStateDbOnly:true});assert.equal(page.nextCursor,'cursor');assert.equal(page.data[0].canAcceptDirectInput,true);
 const read=await host.fetch('thread/read',{threadId,includeTurns:false});assert.equal(read.thread.id,threadId);
 assert.deepEqual(sent,[['list',{limit:5,useStateDbOnly:true}],['read',threadId,{includeTurns:false}]]);
 await new Promise(resolve=>setImmediate(resolve));host.close();await new Promise(resolve=>setImmediate(resolve));release();await new Promise(resolve=>setImmediate(resolve));native.dispose();await new Promise(resolve=>setImmediate(resolve));router.close();
});
