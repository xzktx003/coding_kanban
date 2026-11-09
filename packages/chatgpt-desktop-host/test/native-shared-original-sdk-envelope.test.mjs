import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{z}=require('zod');
const {createNativeSharedThreadRouter}=require('../src/native-shared-thread-routing.cjs');
const {createNativeSharedThreadSubmission}=require('../src/native-shared-thread-submission.cjs');
const {createHostSharedThreadCreationEndpoint}=require('../src/shared-thread-creation-ipc.cjs');
const {createHostSharedThreadSendEndpoint}=require('../src/shared-thread-send-ipc.cjs');
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const {copySharedThreadSendFrame}=require('../src/shared-thread-send-schema.cjs');
const sdkPath=process.env.CHATGPT_SHARED_SCHEDULER_ORIGINAL,hash=x=>createHash('sha256').update(x).digest('hex'),HOST='kanban-shared-cli';
function originalDispatch(){
 const source=readFileSync(sdkPath,'utf8');assert.equal(hash(source),'f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
 const exact=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);};
 // Actual record schema stays active, including non-null metadata paths.
 const nwText=exact('function nw(e,t){','async function nb(');
 const nw=new Function('nv','Buffer',nwText+';return nw;')(z.record(z.string(),z.unknown()),Buffer);
 const Prewarm=new Function('return ('+exact('class rG{','var rj=')+');')();
 const scheduler=exact('let nJ=new Set(','class n5{');
 const rtSource=exact('class rt{','let rn=');
 // Size/trace log metadata are owned service boundaries. The full rt class,
 // original rG.prepare, nw and complete constructor send closure are unchanged.
 const Rt=new Function('nX','n7','re','nc','q','n9','nQ','n8','nF','Buffer',scheduler+';return ('+rtSource+');')({$:class{track(){return[];}}},[65536,262144,1048576],[16384,262144,1048576],{l3:class extends Error{}},{iwv:'durable',V57:'remote-control'},()=>({}),()=>false,null,()=>null,Buffer);
 const body=exact('sendRequest:(e,t,n,r)=>',',requestScheduler:this.requestScheduler').slice('sendRequest:'.length);
 const factory=new Function('t5','nw','q','"use strict";return function(){return ('+body+');};')(String,nw,{f5g:(_options,callback)=>callback(),PpM:()=>null});
 return{Prewarm,Rt,dispatch:owner=>factory.call(owner)};
}

test('authorized frozen snapshot is handed to the original complete SDK closure as a mutable envelope and reaches the real shared connection exactly once',{skip:!sdkPath?'Requires explicitly supplied fixed original SDK':false},async t=>{
 const original=originalDispatch(),profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),epoch=randomUUID(),owner={isDestroyed:()=>false},record={senderId:1,viewId,window:{webContents:owner,isDestroyed:()=>false}},authorized=[],sent=[],frozen=[];
 const binding={hostId:HOST,runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:randomUUID(),viewId,clientId:randomUUID()},scope={hostId:HOST,runtimeGeneration:generation,daemonGeneration:binding.daemonGeneration,accountRevision:1,projectId:binding.projectId,cwd:'/owned/project',viewId,creationNonce:randomUUID()};
 const getRecord=()=>record,getOwnedRecord=value=>value===owner?record:null;let submission,closed=false;
 const router=createNativeSharedThreadRouter({profileId,generation,getRecord,getOwnedRecord,verifyRuntimeSync:()=>true,resolveBinding:async()=>binding,verifyBinding:async()=>true,verifyBindingSync:()=>true,authorizeRequest:async()=>assert.fail('No resume'),onConnected:async()=>true,sendToView(){}});
 const deliver=frame=>queueMicrotask(()=>{if(!closed)assert.equal(submission.receive(frame),true);});
 const createEndpoint=createHostSharedThreadCreationEndpoint({profileId,generation,verifyCurrentSync:()=>true,sendFrame:deliver,onScope:async()=>scope,onAuthorize:async(_s,frame)=>{authorized.push(frame);return true;},onBinding:async()=>binding});
 const sendEndpoint=createHostSharedThreadSendEndpoint({profileId,generation,verifyCurrentSync:()=>true,sendFrame:deliver,onBinding:async()=>binding,onAuthorize:async(_binding,frame)=>{const snapshot=copySharedThreadSendFrame(frame,binding);authorized.push(snapshot);frozen.push(snapshot);return true;}});
 submission=createNativeSharedThreadSubmission({profileId,generation,getRecord,getOwnedRecord,verifyCurrentSync:()=>true,sendToView(){},sendFrame:frame=>queueMicrotask(()=>{if(!closed)assert.equal((frame.type.startsWith('shared-create-')?createEndpoint:sendEndpoint).receive(frame),true);}),router});
 let transport;
 transport=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>true,sendFrame(frame){if(frame.type==='shared-desktop-open')transport.receive({...frame,type:'shared-desktop-ready'});if(frame.type==='shared-desktop-write'){sent.push(JSON.parse(frame.text));transport.receive({v:1,type:'shared-desktop-written',profileId,generation,streamId:frame.streamId,sequence:frame.sequence});}}});
 const connection=await transport.connect();
 t.after(()=>{closed=true;submission.dispose();router.dispose();createEndpoint.close();sendEndpoint.close();transport.close();});
 const delivery=new original.Rt({getConnection:()=>connection,getIncomingQueueDepth:()=>0,hostId:HOST,hostKind:'local',transportKind:'websocket',sharedThreadIds:new Set(),getThreadAccess:()=>undefined,logger:{debug(){},trace(){}}});
 const sdkOwner={backendAuth:{beginAccountChange(){}},options:{transport:{kind:'websocket'}},messageDelivery:delivery,threadStartPreparation:new original.Prewarm(),streamTracing:{trackRequest(){}},turnCwds:{track(){}},prewarmedThreads:{publishThreadStarted(){}}};
 const dispatch=original.dispatch(sdkOwner),attemptId=randomUUID(),clientThreadId='client-new-thread:'+randomUUID(),input=[{type:'text',text:'owned exact original SDK envelope',text_elements:[]}];
 assert.equal(submission.lifecycle(owner,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
 assert.equal(await submission.createIntent(owner,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:HOST,projectId:scope.projectId,cwd:scope.cwd,clientThreadId,attemptId,sequence:1,epoch}),true);
 await submission.withStart(owner,HOST,{cwd:scope.cwd,input,__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId},async(_params,settle)=>{
  await submission.prepareRequest(HOST,{id:'owned-created',method:'thread/start',params:{cwd:scope.cwd}});await settle(binding.threadId);
  const prepared=await submission.prepareRequest(HOST,{id:'owned-first-turn',method:'turn/start',params:{threadId:binding.threadId,input,approvalPolicy:'on-request',approvalsReviewer:'user',permissions:':workspace',runtimeWorkspaceRoots:[scope.cwd],multiAgentMode:'explicitRequestOnly'}});
  const snapshot=frozen[0],before=JSON.stringify(snapshot);
  assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.params),true);
  // Actual original nd options.sendRequest mutation occurs before rt.send.
  dispatch(prepared.frame,binding.threadId,null,{method:'turn/start',startedAtMs:Date.now(),scheduling:{priority:'critical'}});
  assert.equal(Object.isFrozen(prepared.frame),false);assert.equal(Object.isFrozen(prepared.frame.params),true);
  assert.equal(JSON.stringify(snapshot),before,'the canonical authority snapshot must remain unchanged');
 });
 assert.equal(authorized.length,2);assert.equal(sent.length,1);assert.deepEqual(sent[0],JSON.parse(JSON.stringify(frozen[0])));assert.equal(sent[0].params.input[0].text,input[0].text);
});
