import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSharedThreadSendAuthority,isSharedThreadSendAuthority} from '../src/shared-thread-send.mjs';
const denied={code:'SHARED_SEND_DENIED'},unknown={code:'SHARED_DAEMON_OUTCOME_UNKNOWN'};
function fixture(extra={}){
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:2,projectId:'project',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()};
 let record={viewId:binding.viewId},alive=true,time=10,intent=true,selection=true;
 const authority=createSharedThreadSendAuthority({verifyBindingSync:b=>alive&&JSON.stringify(b)===JSON.stringify(binding),getOwnedView:()=>record,verifyOwnedViewSync:()=>alive,verifyExplicitIntentSync:()=>intent,verifySelectionSync:()=>selection,now:()=>time,...extra});
 const control=()=>({attemptId:randomUUID(),signal:new AbortController().signal,deadline:time+30000});
 const frame=(id='turn:start:1',params={})=>({id,method:'turn/start',params:{threadId:binding.threadId,input:[{type:'text',text:'真实消息 🎯',text_elements:[]}],...params}});
 const reply=f=>({id:f.id,result:{turn:{id:randomUUID(),items:[],status:'inProgress',error:null}}});
 return{binding,authority,control,frame,reply,revoke:()=>{alive=false;},replace:()=>{record={...record};},tick:()=>{time+=30001;},denyIntent:()=>{intent=false;},denySelection:()=>{selection=false;}};
}
test('server-minted authority requires exact explicit one-shot scope and preserves text and selected native model',()=>{
 const f=fixture(),frame=f.frame('turn:start:1',{model:'known-model',effort:'high'}),control=f.control();
 assert.equal(isSharedThreadSendAuthority(f.authority),true);assert.equal(isSharedThreadSendAuthority({...f.authority}),false);
 assert.equal(f.authority.registerSend(f.binding,frame,control),true);
 assert.equal(f.authority.beforeWriteSync(frame),true);
 assert.deepEqual(frame.params.input,[{type:'text',text:'真实消息 🎯',text_elements:[]}]);assert.equal(frame.params.model,'known-model');assert.equal(frame.params.effort,'high');
 assert.equal(f.authority.observeReplySync(frame,f.reply(frame)).status,'started');
 assert.throws(()=>f.authority.beforeWriteSync(frame),denied);assert.throws(()=>f.authority.registerSend(f.binding,f.frame('retry'),control),denied);
 f.authority.close();
});
test('switch/replaced view/account/expired send and changed original input or model fail before any write',()=>{
 for(const invalidate of [f=>f.revoke(),f=>f.replace(),f=>f.tick(),f=>f.denySelection()]){
  const f=fixture(),frame=f.frame('selected',{model:'known-model'});f.authority.registerSend(f.binding,frame,f.control());invalidate(f);assert.throws(()=>f.authority.beforeWriteSync(frame),denied);f.authority.close();
 }
 for(const params of [{input:[{type:'text',text:'changed'}]},{model:'other'}]){
  const f=fixture(),frame=f.frame();f.authority.registerSend(f.binding,frame,f.control());assert.throws(()=>f.authority.beforeWriteSync({...frame,params:{...frame.params,...params}}),denied);f.authority.close();
 }
});
test('default cannot accept unknown selection, config, permission, nontext or arbitrary frame fields',()=>{
 const base=fixture();base.authority.close();
 const f=fixture({verifySelectionSync:undefined});
 for(const params of [{model:'unverified'},{config:{anything:true}},{approvalPolicy:'never'},{sandboxPolicy:{type:'dangerFullAccess'}},{input:[{type:'localImage',path:'/tmp/private.png'}]},{input:[{type:'text',text:'ok',text_elements:[{}]}]}]) assert.throws(()=>f.authority.registerSend(f.binding,f.frame(randomUUID(),params),f.control()),denied);
 assert.throws(()=>f.authority.registerSend(f.binding,{...f.frame(),trace:{}},f.control()),denied);f.authority.close();
});
test('intent is mandatory, duplicate request IDs and nonce are burned, unresolved dispatch is never replayable',()=>{
 const f=fixture(),frame=f.frame(),control=f.control();f.denyIntent();assert.throws(()=>f.authority.registerSend(f.binding,frame,control),denied);f.authority.close();
 const g=fixture(),a=g.frame(),c=g.control();g.authority.registerSend(g.binding,a,c);g.authority.beforeWriteSync(a);
 assert.throws(()=>g.authority.registerSend(g.binding,a,g.control()),denied);assert.throws(()=>g.authority.registerSend(g.binding,g.frame('other'),c),denied);assert.throws(()=>g.authority.beforeWriteSync(a),denied);g.authority.close();
});
test('reply loss/revocation/malformed result stays unknown and explicit native errors stay rejected',()=>{
 for(const reply of [f=>({id:'other',result:{}}),f=>({id:f.frame().id,result:{turn:{id:'x'}}}),f=>({id:f.frame().id,result:{},error:{code:1,message:'both'}})]){
  const f=fixture(),frame=f.frame();f.authority.registerSend(f.binding,frame,f.control());f.authority.beforeWriteSync(frame);assert.throws(()=>f.authority.observeReplySync(frame,reply(f)),unknown);assert.throws(()=>f.authority.beforeWriteSync(frame),denied);f.authority.close();
 }
 const f=fixture(),frame=f.frame();f.authority.registerSend(f.binding,frame,f.control());f.authority.beforeWriteSync(frame);f.revoke();assert.throws(()=>f.authority.observeReplySync(frame,f.reply(frame)),unknown);f.authority.close();
 const g=fixture(),a=g.frame();g.authority.registerSend(g.binding,a,g.control());g.authority.beforeWriteSync(a);assert.deepEqual(g.authority.observeReplySync(a,{id:a.id,error:{code:-1,message:'rejected'}}),{status:'rejected'});g.authority.close();
});

test('pinned stable schema keeps default collaboration selection and native-advertised effort strings',()=>{
 const f=fixture(),frame=f.frame('selected',{collaborationMode:{mode:'default',settings:{model:'native-model',reasoning_effort:'native-advertised-effort'}}});
 f.authority.registerSend(f.binding,frame,f.control());f.authority.beforeWriteSync(frame);assert.equal(frame.params.collaborationMode.settings.reasoning_effort,'native-advertised-effort');
 const reply=f.reply(frame);delete reply.result.turn.error;assert.equal(f.authority.observeReplySync(frame,reply).status,'started');f.authority.close();
});

test('real permission proof is required again at dispatch and reply while exact selected fields are preserved',()=>{
 const selected={approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},multiAgentMode:'explicitRequestOnly'};
 const noProof=fixture(),missing=noProof.frame('missing-proof',selected);assert.throws(()=>noProof.authority.registerSend(noProof.binding,missing,noProof.control()),denied);noProof.authority.close();
 let permissionCurrent=true,checks=0;const f=fixture({verifyPermissionsSync:(params,binding)=>{checks++;return permissionCurrent&&binding.threadId===f.binding.threadId&&params.approvalPolicy===selected.approvalPolicy&&params.sandboxPolicy.type==='readOnly'}}),frame=f.frame('selected-proof',selected);
 f.authority.registerSend(f.binding,frame,f.control());f.authority.beforeWriteSync(frame);assert.equal(f.authority.observeReplySync(frame,f.reply(frame)).status,'started');assert.ok(checks>=3);assert.equal(frame.params.multiAgentMode,'explicitRequestOnly');
 const next=f.frame('permission-revoked',selected);f.authority.registerSend(f.binding,next,f.control());permissionCurrent=false;assert.throws(()=>f.authority.beforeWriteSync(next),denied);f.authority.close();
});
