import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {canonicalizeOriginalSharedTurn}=require('../src/native-shared-thread-submission.cjs');
const threadId='11111111-1111-4111-8111-111111111111';
test('original native text/model/effort remain exact while only audited generated defaults are projected',()=>{
 const frame={id:'native-rpc',method:'turn/start',trace:{traceId:'internal'},params:{threadId,input:[{type:'text',text:'原文\n第二行',text_elements:[]}],model:null,effort:'high',collaborationMode:{mode:'default',settings:{model:'gpt-test',reasoning_effort:'high',developer_instructions:null}},clientUserMessageId:'original-id',turnTrigger:'composer',additionalContext:null,serviceTier:null}};
 const out=canonicalizeOriginalSharedTurn(frame,{threadId});
 assert.deepEqual(out.params.input,frame.params.input);assert.equal(out.params.collaborationMode.settings.model,'gpt-test');assert.equal(out.params.effort,'high');assert.equal(out.params.clientUserMessageId,frame.params.clientUserMessageId);assert.equal(out.id,frame.id);assert.equal(Object.hasOwn(out,'trace'),false);
});
test('SDK pre-JSON undefined optionals have exactly absent wire semantics',()=>{
 const base={id:'native-rpc',method:'turn/start',params:{threadId,input:[{type:'text',text:'captured'}]}};
 const original={...base,params:{...base.params,model:undefined,effort:undefined,collaborationMode:undefined,approvalPolicy:undefined,sandboxPolicy:undefined,config:undefined,unknown:undefined}};
 assert.deepEqual(canonicalizeOriginalSharedTurn(original,{threadId}),canonicalizeOriginalSharedTurn(base,{threadId}));
});
test('user permission/config/context, unknown fields and another thread fail closed instead of losing settings',()=>{
 const frame={id:'native-rpc',method:'turn/start',params:{threadId,input:[{type:'text',text:'keep'}]}};
 for(const extra of[{approvalPolicy:'unsupported-policy'},{config:{x:1}},{additionalContext:{user:'context'}},{serviceTier:'fast'},{unknown:true}])assert.throws(()=>canonicalizeOriginalSharedTurn({...frame,params:{...frame.params,...extra}},{threadId}),{code:'SHARED_SEND_INTENT_DENIED'});
 assert.throws(()=>canonicalizeOriginalSharedTurn(frame,{threadId:'22222222-2222-4222-8222-222222222222'}),{code:'SHARED_SEND_INTENT_DENIED'});
});

test('real routing and fixed IPC composition joins explicit create, branded first turn, and later followed send without resume',async()=>{
 const {randomUUID}=await import('node:crypto');
 const {createNativeSharedThreadRouter}=require('../src/native-shared-thread-routing.cjs');
 const {createNativeSharedThreadSubmission}=require('../src/native-shared-thread-submission.cjs');
 const {createHostSharedThreadCreationEndpoint}=require('../src/shared-thread-creation-ipc.cjs');
 const {createHostSharedThreadSendEndpoint}=require('../src/shared-thread-send-ipc.cjs');
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),epoch=randomUUID(),owner={id:5,isDestroyed:()=>false},record={senderId:5,viewId,window:{webContents:owner,isDestroyed:()=>false}};
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'project',threadId:randomUUID(),viewId,clientId:randomUUID()};
 const scope={hostId:binding.hostId,runtimeGeneration:generation,daemonGeneration:binding.daemonGeneration,accountRevision:1,projectId:'project',cwd:'/project',viewId,creationNonce:randomUUID()};
 const accepted=[],viewMessages=[];let following=0,submission;const selected={approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},multiAgentMode:'explicitRequestOnly'};
 const getRecord=id=>id===5?record:null,getOwnedRecord=sender=>sender===owner?record:null;
 const router=createNativeSharedThreadRouter({profileId,generation,getRecord,getOwnedRecord,verifyRuntimeSync:()=>true,resolveBinding:async()=>binding,verifyBinding:async()=>true,verifyBindingSync:()=>true,authorizeRequest:async()=>{throw Error('resume must not occur')},onConnected:async()=>{following++;return true},sendToView:(_r,m)=>viewMessages.push(m)});
 const sendFrame=frame=>{queueMicrotask(()=>{const endpoint=frame.type.startsWith('shared-create-')?createEndpoint:sendEndpoint;assert.equal(endpoint.receive(frame),true)});};
 const deliver=frame=>{queueMicrotask(()=>assert.equal(submission.receive(frame),true))};
 const createEndpoint=createHostSharedThreadCreationEndpoint({profileId,generation,verifyCurrentSync:()=>true,sendFrame:deliver,onScope:async()=>scope,onAuthorize:async(_s,frame)=>{accepted.push(frame);return true},onBinding:async()=>binding});
 const sendEndpoint=createHostSharedThreadSendEndpoint({profileId,generation,verifyCurrentSync:()=>true,sendFrame:deliver,onBinding:async()=>binding,onAuthorize:async(_b,frame)=>{accepted.push(frame);return true}});
 submission=createNativeSharedThreadSubmission({profileId,generation,getRecord,getOwnedRecord,verifyCurrentSync:()=>true,sendToView:(_r,m)=>viewMessages.push(m),sendFrame,router});
 try{
  assert.equal(submission.lifecycle(owner,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
  const createAttempt=randomUUID();assert.equal(await submission.createIntent(owner,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:binding.hostId,projectId:'project',cwd:'/project',clientThreadId:'original-client',attemptId:createAttempt,sequence:1,epoch}),true);
  await submission.withStart(owner,binding.hostId,{cwd:'/project',input:[{type:'text',text:'first'}],__kanbanSharedCreateAttempt:createAttempt,__kanbanSharedCreateClient:'original-client'},async(clean,settle)=>{
   assert.equal(clean.cwd,'/project');const start=await submission.prepareRequest(binding.hostId,{id:'rpc-start',method:'thread/start',params:{cwd:'/project'}});assert.equal(start.shared,false);
   await settle(binding.threadId);const first=await submission.prepareRequest(binding.hostId,{id:'rpc-first',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'first'}],...selected}});assert.equal(first.shared,false);
  });
  assert.equal(following,1);assert.deepEqual(accepted.map(x=>x.method),['thread/start','turn/start']);
  const sendAttempt=randomUUID();assert.equal(await submission.sendIntent(owner,{type:'kanban-shared-send-intent',v:1,action:'send',profileId,generation,viewId,hostId:binding.hostId,threadId:binding.threadId,attemptId:sendAttempt,sequence:1,epoch}),true);
  await submission.withSend(owner,binding.hostId,{conversationId:binding.threadId,__kanbanSharedSendAttempt:sendAttempt,permissionsConfig:{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}},approvalsReviewer:'user',multiAgentMode:'explicitRequestOnly'},async clean=>{assert.deepEqual(clean.permissionsConfig,{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}});assert.equal(clean.approvalsReviewer,'user');assert.equal(clean.multiAgentMode,'explicitRequestOnly');
   const send=await submission.prepareRequest(binding.hostId,{id:'rpc-next',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'continue'}],...selected}});assert.equal(send.shared,false);
  });
  assert.deepEqual(accepted.map(x=>x.params.input?.[0].text??x.method),['thread/start','first','continue']);for(const frame of accepted.filter(x=>x.method==='turn/start'))for(const [key,value]of Object.entries(selected))assert.deepEqual(frame.params[key],value);
  await assert.rejects(submission.prepareRequest(binding.hostId,{id:'auto',method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'auto forbidden'}]}}));
 }finally{submission.dispose();router.dispose();createEndpoint.close();sendEndpoint.close();}
});

test('fixed native first and later turn permission choices and explicit-request-only mode survive canonicalization',()=>{
 const selected={approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite',writableRoots:['/project'],networkAccess:false},multiAgentMode:'explicitRequestOnly'};
 for(const id of ['original-first','original-followup']){const frame={id,method:'turn/start',params:{threadId,input:[{type:'text',text:'原始输入'}],...selected}};const out=canonicalizeOriginalSharedTurn(frame,{threadId});assert.deepEqual(out,frame);assert.equal(Object.isFrozen(out.params.sandboxPolicy),true);}
 const profile={id:'profile',method:'turn/start',params:{threadId,input:[{type:'text',text:'next'}],approvalPolicy:'never',approvalsReviewer:'auto_review',permissions:':workspace',runtimeWorkspaceRoots:['/project'],multiAgentMode:'explicitRequestOnly'}};
 assert.deepEqual(canonicalizeOriginalSharedTurn(profile,{threadId}),profile);
 for(const extra of [{multiAgentMode:'delegate'},{sandboxPolicy:{type:'unknown'}},{permissions:':workspace',sandboxPolicy:{type:'readOnly'}},{runtimeWorkspaceRoots:['/project/../other']}])assert.throws(()=>canonicalizeOriginalSharedTurn({...profile,params:{...profile.params,...extra}},{threadId}),{code:'SHARED_SEND_INTENT_DENIED'});
});
