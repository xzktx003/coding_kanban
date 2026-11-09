import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createContainerSharedSourceCoordinator} from '../src/container-shared-source-coordinator.mjs';
const uuid=randomUUID;
test('owned coordinator connects real source pages, account observations and source-bound authority',async()=>{
 const profileId=uuid(),generation=uuid(),daemonGeneration=uuid(),viewId=uuid(),threadId=uuid(),view={viewId};const signal=new AbortController(),writes=[],sent=[];let receiver;
 const daemon={signal:signal.signal,expiresAtMs:Date.now()+60000,assertCurrent(){},matchesFingerprint:value=>value==='a'.repeat(64),listThreads:async()=>({data:[{id:threadId,cwd:'/daemon',turns:[]}],nextCursor:'next'}),readThreadMetadata:async()=>({thread:{id:threadId,cwd:'/daemon',turns:[]}}),writeGateFrame:encoded=>writes.push(encoded),attachGateReceiver:fn=>{receiver=fn}};
 const base={resolveBinding:async req=>({hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration,accountRevision:req.source.accountRevision,projectId:'project',threadId:req.threadId,viewId,clientId:uuid()}),verifyViewSync:req=>req.viewId===viewId,verifyBindingSync:()=>true,verifyHistorySync:()=>true,verifyReadSync:()=>true,write:encoded=>daemon.writeGateFrame(encoded)};
 const privateSource={generation,verifySync:()=>true,list:async()=>({data:[],nextCursor:null}),read:async()=>null};
 const coordinator=createContainerSharedSourceCoordinator({profileId,generation,daemonGeneration,daemon,privateSource,verifyContainerSync:()=>true,getOwnedView:id=>id===viewId?view:null,verifyOwnedViewSync:id=>id===viewId,writeNative:encoded=>sent.push(encoded),sharedThread:base});
 assert.equal(typeof receiver,'function');assert.equal(coordinator.accountRevision(),null);
 const frame={v:1,type:'shared-account-observation',profileId,generation,revision:1,observationId:uuid(),fingerprint:'a'.repeat(64),expiresAtMs:Date.now()+60000};
 assert.equal(coordinator.receiveNative(frame),true);const result=await coordinator.listDaemon(viewId,{limit:100,useStateDbOnly:true});assert.equal(result.page.nextCursor,'next');assert.equal(result.tokens[0].threadId,threadId);
 const binding=await coordinator.sharedThread.resolveBinding({viewId,hostId:'kanban-shared-cli',threadId,sourceToken:result.tokens[0].token});assert.equal(coordinator.sharedThread.verifyBindingSync(binding),true);
 coordinator.retireView(viewId);assert.equal(coordinator.sharedThread.verifyBindingSync(binding),false);assert.equal(writes.length,0);coordinator.close();
});

test('coordinator registers the private catalog from the actual native owner IPC, with no resume',async()=>{
 const {createRequire}=await import('node:module');const {decodeWireValue}=await import('../src/wire-value.mjs');const {createHash}=await import('node:crypto');
 const {createNativeSharedThreadIntegration}=createRequire(import.meta.url)('../src/native-shared-thread-integration.cjs');
 const profileId=uuid(),generation=uuid(),daemonGeneration=uuid(),viewId=uuid(),threadId=uuid(),sender={id:7},view={viewId,senderId:7,window:{webContents:sender}},signal=new AbortController(),calls=[],catalogFrames=[],principal={accountId:'workspace',userId:'user',expiresAtMs:Date.now()+60000};let native,coordinator,receiving=true;
 const fingerprint=createHash('sha256').update(JSON.stringify(['shared-account-principal-v1','workspace','user'])).digest('hex');
 const daemon={signal:signal.signal,expiresAtMs:principal.expiresAtMs,assertCurrent(){},matchesFingerprint:x=>x===fingerprint,listThreads:async()=>({data:[{id:threadId,cwd:'/daemon',turns:[]}],nextCursor:'daemon-cursor'}),readThreadMetadata:async()=>{throw Error('thread not loaded')},attachGateReceiver(){}};
 const connection={backendAuth:{hasPendingAccountChange:false},getConnectionState:()=>'connected',getAccount:async()=>({account:{type:'chatgpt'},requiresOpenaiAuth:true}),getRequestAuthenticatedPrincipal:async()=>principal,getCachedAuthenticatedPrincipal:()=>principal,registerInternalNotificationHandler:()=>()=>{},registerInternalAuthenticatedPrincipalChangeHandler:()=>()=>{},registerInternalConnectionStateHandler:()=>()=>{},registerHostEventHandler:()=>()=>{},
 listThreads:async params=>(calls.push(['list',params]),{data:[{id:threadId,cwd:'/private',turns:[],canAcceptDirectInput:true}],nextCursor:'next'}),readThread:async(id,options)=>(calls.push(['read',id,options]),{id,cwd:'/private',turns:[],canAcceptDirectInput:true})};
 const sharedThread={resolveBinding:async()=>null,verifyViewSync:()=>false,verifyBindingSync:()=>false,verifyHistorySync:()=>false,verifyReadSync:()=>false,write:()=>{throw Error('unexpected write')}};
 coordinator=createContainerSharedSourceCoordinator({profileId,generation,daemonGeneration,daemon,privateSource:{generation,verifySync:()=>true},useNativeDirectory:true,verifyContainerSync:()=>true,getOwnedView:id=>id===viewId?view:null,verifyOwnedViewSync:id=>id===viewId,writeNative:encoded=>{queueMicrotask(()=>native.receive(decodeWireValue(encoded)));},sharedThread});
 native=createNativeSharedThreadIntegration({profileId,generation,getRecord:id=>id===7?view:null,getOwnedRecord:s=>s===sender?view:null,verifyRuntimeSync:()=>true,sendToView:(_view,frame)=>catalogFrames.push(frame),sendFrame:frame=>{queueMicrotask(()=>{if(receiving)coordinator.receiveNative(frame);});},desktopAccountObservation:true});
 const release=native.registerHostEvents({connection,isCurrent:()=>true,disposed:false},{getHostId:()=>'local'},{onNotification(){},onRequest(){}});await new Promise(resolve=>setImmediate(resolve));
 const result=await coordinator.listPrivate(viewId,{limit:20,useStateDbOnly:true});assert.equal(result.page.nextCursor,'next');assert.equal(result.page.data[0].canAcceptDirectInput,true);assert.equal(result.tokens[0].threadId,threadId);assert.deepEqual(calls,[['list',{limit:20,useStateDbOnly:true}]]);
 const requestId=uuid();assert.equal(native.catalogRequest(sender,{type:'kanban-shared-catalog-request',requestId,cursor:null,limit:50}),true);
 for(let i=0;i<20&&!catalogFrames.length;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(catalogFrames.length,1);
 const first=catalogFrames[0],page=JSON.parse(Buffer.from(first.data,'base64').toString());assert.equal(first.final,true);assert.equal(page.page.nextCursor,'daemon-cursor');assert.equal(page.tokens[0].threadId,threadId);
 assert.equal(native.catalogAck(sender,{type:'kanban-shared-catalog-ack',requestId,sequence:1}),true);
 await new Promise(resolve=>setImmediate(resolve));coordinator.close();receiving=false;await new Promise(resolve=>setImmediate(resolve));release();native.dispose();await new Promise(resolve=>setImmediate(resolve));
});
