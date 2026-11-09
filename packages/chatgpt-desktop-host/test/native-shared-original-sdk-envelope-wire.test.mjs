import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createSharedThreadSendAuthority,copySharedThreadSendFrame} from '../src/shared-thread-send.mjs';
const require=createRequire(import.meta.url);
const {createNativeSharedDesktopTransport}=require('../src/native-shared-desktop-transport.cjs');
const sdkPath=process.env.CHATGPT_SHARED_ENVELOPE_SDK_MODULE;
const originalDir=process.env.CHATGPT_SHARED_ENVELOPE_ORIGINAL_DIR;
const unavailable=!sdkPath||!originalDir?'Requires explicitly supplied pinned original SDK and method excerpts':false;
const sha=text=>createHash('sha256').update(text).digest('hex');
function originals(){
 const sdk=readFileSync(sdkPath,'utf8');assert.equal(sha(sdk),'287765da61b5093c7464a85fe6b1e5357e9627be12c22c11550a261c4e846618');
 const load=(name,pin)=>{const value=readFileSync(join(originalDir,name),'utf8');assert.equal(sha(value),pin);return value;};
 const a=sdk.indexOf('sendRequest:(e,t,n,r)=>')+'sendRequest:'.length,b=sdk.indexOf(',requestScheduler:this.requestScheduler',a);
 assert.ok(a>0&&b>a);const source=sdk.slice(a,b);assert.equal(sha(source),'4d9ea10fc4f64fd8672240886170bcb643e949bc6d9768cc8b440f5bce2d05de');
 const nwSource=load('nw.js','63b660190add9656014094647a7e55b51307c855281ca5ff04dec3e753b5ec33');assert.ok(sdk.includes(nwSource));
 // The original SDK uses record(string, unknown) here. Keep that library
 // boundary validating records so original nw cannot silently take its catch.
 const nw=new Function('nv','"use strict";'+nwSource+';return nw;')({parse(value){assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value;}});
 const composer=new Function(load('OTs.js','19e9d98e08e04a2d9b8baf42c8cae99435e604340653b5b791f8ec6d27121287')+';return OTs;')();
 const sendMessage=new Function('nc','q','n9','nQ','Buffer','"use strict";return ({'+load('rt-sendMessage.js','04d0ab608dd0b94567b439f7405c14af40e8e47a2119d8896ebd9935e1df98aa')+'}).sendMessage;')({l3:Error},{iwv:'durable',V57:'durable'},()=>({}),()=>false,Buffer);
 const Preparation=new Function(load('rG.js','8507f7540048bfe9a7477a849c735b208816db41efbf31ab9c81cd29050554b9')+';return rG;')();
 return{nw,composer,Preparation,sendMessage,dispatch(owner){return new Function('nw','t5','q','"use strict";return ('+source+');').call(owner,nw,value=>value,{});}};
}
async function fixture(t,original,{capturedId=undefined,hostedId=null}={}){
 const binding={hostId:'kanban-shared-cli',runtimeGeneration:randomUUID(),daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:randomUUID(),viewId:randomUUID(),clientId:randomUUID()};
 const profileId=randomUUID(),generation=binding.runtimeGeneration,record={viewId:binding.viewId},writes=[],events=[];let current=true;
 const authority=createSharedThreadSendAuthority({getOwnedView:()=>record,verifyOwnedViewSync:()=>current,verifyBindingSync:b=>current&&JSON.stringify(b)===JSON.stringify(binding),verifyExplicitIntentSync:()=>current,verifySelectionSync:()=>current,verifyPermissionsSync:()=>current,now:()=>10});
 const search=JSON.stringify({mode:'cached',is_web_access_restricted:true,session_persistent:false,allowed_domains:['owned.example.invalid']});
 const mcp={'openai/search_context':search,...(capturedId===undefined?{}:{'openai/codex_installation_id':capturedId})};
 const params={threadId:binding.threadId,input:[{type:'text',text:'owned immutable SDK handoff fixture',text_elements:[]}],model:'owned-native-model',effort:'low',summary:'auto',personality:'none',approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'},responsesapiClientMetadata:{...original.composer({message_submission_source:'shared_fixture'}),workspace_kind:'project',mcp_request_meta:JSON.stringify(mcp)}};
 const canonical=copySharedThreadSendFrame({id:'turn/start:'+randomUUID(),method:'turn/start',params},binding),captured=JSON.stringify(canonical);
 authority.registerSend(binding,canonical,{attemptId:randomUUID(),signal:new AbortController().signal,deadline:30010});
 let transport;const host=(type,extra={})=>({v:1,type,profileId,generation,streamId:transport.streamId,...extra});
 transport=createNativeSharedDesktopTransport({profileId,generation,verifyRuntimeSync:()=>current,sendFrame(frame){
  events.push(frame.type);
  if(frame.type==='shared-desktop-open')transport.receive(host('shared-desktop-ready'));
  if(frame.type==='shared-desktop-write'){
   const raw=JSON.parse(frame.text);authority.beforeWriteSync(raw);writes.push(raw);
   transport.receive(host('shared-desktop-written',{sequence:frame.sequence}));
  }
 }});
 const connection=await transport.connect();
 const runtime={options:{hostId:binding.hostId,hostKind:'local',transportKind:'websocket',getConnection:()=>connection,logger:{debug(){},trace(){}}},outgoingMessageSizeTracker:{track:()=>[]},rememberSharedThread(){}};
 const owner={backendAuth:{beginAccountChange(){}},options:{transport:{kind:'websocket'},getHostedAutomationInstallationId:()=>hostedId},threadStartPreparation:new original.Preparation(),messageDelivery:{sendMessage:(...args)=>original.sendMessage.call(runtime,...args)},turnCwds:{track(){}},prewarmedThreads:{publishThreadStarted(){}}};
 const dispatch=original.dispatch(owner);
 t.after(()=>{transport.close();authority.close();});
 return{binding,canonical,captured,writes,events,authority,dispatch,revoke(){current=false;},handoff:()=>({...canonical})};
}

test('actual SDK closure attempts assignment on the frozen authorization frame before any transport send',{skip:unavailable},async t=>{
 const original=originals(),f=await fixture(t,original);
 assert.equal(Object.isFrozen(f.canonical),true);assert.equal(Object.isFrozen(f.canonical.params),true);
 assert.throws(()=>f.dispatch(f.canonical,f.binding.threadId),TypeError);
 assert.equal(f.events.includes('shared-desktop-write'),false);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.canonical),f.captured);
});

test('actual nw nonnull id remains exact through original closure, rG, rt and the real owned transport',{skip:unavailable},async t=>{
 const original=originals(),installationId=randomUUID(),f=await fixture(t,original,{capturedId:installationId,hostedId:installationId});
 const handoff=f.handoff();assert.equal(Object.isFrozen(handoff),false);assert.equal(handoff.params,f.canonical.params);assert.equal(Object.isFrozen(handoff.params),true);
 f.dispatch(handoff,f.binding.threadId);
 assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0],f.canonical);assert.equal(JSON.stringify(f.canonical),f.captured);
 assert.notEqual(handoff.params,f.canonical.params);assert.equal(JSON.parse(handoff.params.responsesapiClientMetadata.mcp_request_meta)['openai/codex_installation_id'],installationId);
 assert.throws(()=>f.authority.beforeWriteSync(f.writes[0]),{code:'SHARED_SEND_DENIED'});
});

test('actual nw adding or replacing an installation id after authorization cannot reach the owned writer',{skip:unavailable},async t=>{
 const original=originals();
 for(const capturedId of [undefined,randomUUID()]){
  const hostedId=randomUUID(),f=await fixture(t,original,{capturedId,hostedId}),handoff=f.handoff();
  assert.throws(()=>f.dispatch(handoff,f.binding.threadId),{code:'SHARED_SEND_DENIED'});
  assert.equal(JSON.parse(handoff.params.responsesapiClientMetadata.mcp_request_meta)['openai/codex_installation_id'],hostedId);
  assert.equal(f.events.filter(type=>type==='shared-desktop-write').length,1);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.canonical),f.captured);
  assert.throws(()=>f.authority.beforeWriteSync(f.canonical),{code:'SHARED_SEND_DENIED'});
 }
});

test('mutable SDK envelope never grants changed input, permissions, thread, or revoked current scope',{skip:unavailable},async t=>{
 const original=originals();
 for(const change of [
  (f,frame)=>{frame.params={...frame.params,input:[{type:'text',text:'changed input',text_elements:[]}]};},
  (f,frame)=>{frame.params={...frame.params,sandboxPolicy:{type:'dangerFullAccess'}};},
  (f,frame)=>{frame.params={...frame.params,threadId:randomUUID()};},
  (f,frame)=>{f.revoke();},
 ]){
  const installationId=randomUUID(),f=await fixture(t,original,{capturedId:installationId,hostedId:installationId}),handoff=f.handoff();change(f,handoff);
  assert.throws(()=>f.dispatch(handoff,f.binding.threadId));assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.canonical),f.captured);
 }
});
