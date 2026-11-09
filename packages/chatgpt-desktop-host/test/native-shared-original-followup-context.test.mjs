import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,openSync,readSync,closeSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createSharedDaemonRpcGate} from '../src/shared-daemon-rpc-gate.mjs';
import {createSharedThreadSendAuthority} from '../src/shared-thread-send.mjs';
const require=createRequire(import.meta.url),{z}=require('zod');
const root=process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
const {createDynamicToolsRouter}=require('../src/dynamic-tools-routing.cjs');
const {adaptNativeSharedHostChunk}=require('../src/native-shared-host-policy.cjs');
const {createNativeSharedThreadSendRouter}=require('../src/native-shared-thread-send-routing.cjs');
const {canonicalizeOriginalSharedTurn}=require('../src/native-shared-thread-submission.cjs');
function original(){
 const file=openSync(join(root,'resources/app.asar'),'r');
 function readAt(n,at){const b=Buffer.alloc(n);assert.equal(readSync(file,b,0,n,at),n);return b;}
 let main,sdk,entry,rop;
 try{
  const h=readAt(16,0),index=JSON.parse(readAt(h.readUInt32LE(12),16)),start=8+h.readUInt32LE(4);
  function member(name,expected){let e=index;for(const p of name.split('/'))e=e.files[p];const b=readAt(e.size,start+Number(e.offset));assert.equal(createHash('sha256').update(b).digest('hex'),expected);return b.toString();}
  main=member('.vite/build/early-bootstrap-439-a0f25ba32c465de1.js','c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
  sdk=member('.vite/build/early-bootstrap-339-af4b764b02ba589c.js','f717cf6c18dd50ef4adce39ccf532f4e3e740211ce8c276363175b6a5e883c22');
  rop=member('.vite/build/early-bootstrap-133-a2b781596743bab7.js','35629d1aabe19b3ebb2833d126f70f858778eb5252c29778b1aa93dee2167855');
  entry=member('.vite/build/early-bootstrap.js','466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf');
 }finally{closeSync(file);}
 const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
 const bundle={};new Function('exports',sdk)(bundle);
 // Load fixed original pure helpers and the ROP base. The entry module
 // dictionary is evaluated without executing its native bootstrap.
 const a=entry.indexOf('a={')+2,b=entry.indexOf(',i={};function r(e){');assert.ok(a>2&&b>a);
 const ropBundle={},mainBundle={};new Function('exports',rop)(ropBundle);new Function('exports',main)(mainBundle);
 const modules={...new Function('require','return ('+entry.slice(a,b)+');')(require),...bundle.modules,...mainBundle.modules,...ropBundle.modules},cache=new Map();
 function webpack(id){if(id===35553)return z;if(cache.has(id))return cache.get(id).exports;const fn=modules[id];assert.equal(typeof fn,'function','Original pure module '+id+' must exist');const m={exports:{}};cache.set(id,m);fn(m,m.exports,webpack);return m.exports;}
 webpack.n=value=>()=>value;webpack.d=(target,getters,values)=>{for(const[k,get]of Object.entries(getters??{}))Object.defineProperty(target,k,{get,enumerable:true});Object.assign(target,values);};webpack.g=globalThis;webpack.nmd=m=>m;
 const eo=webpack(12892),classText=adaptNativeSharedHostChunk({body:Buffer.from(main)}).body.toString();
 const wmText=cut(main,'class wm extends eo.TF{','var wg=r(57118)');
 const helpers=cut(main,'class xL extends Error{}','class xU extends eo.TF{');
 const coordinator=cut(classText,'class xU extends eo.TF{','var xH=r(86439)');
 const facade=cut(main,'function w8(','class ye extends eo.TF{');
 const {w7}=new Function('eo',facade+';return {w7};')(eo);
 const build=new Function('eo','xF','xj','ra','yw','rl','m6','m4','I_','IT','xa','xi','globalThis',wmText+';'+helpers+';'+coordinator+';return xU;');
 const never=()=>{throw Error('Unselected original service boundary');};
 const Turns=new Function('eu',cut(sdk,'class rf{','function rg(')+';return rf;')({randomUUID});
 const makeRequestTap=globals=>new Function('globalThis','el','Rm','em','m6','return ({'+cut(classText,'async send(e,t,r,n){','async sendToConnection')+'}).send;')(globals,{iwv:'durable'},{send:never},{UKQ:never},webpack(92743));
 return {Turns,w7,rop:eo,makeRequestTap,makeCoordinator:globals=>build(eo,()=>webpack(44814),webpack(72837),()=>webpack(8857),webpack(5844),webpack(90776),webpack(92743),webpack(99365),new Proxy({},{get:never}),never,never,never,globals)};
}
function originalRendererPrepare(known,binding,shapes){
 const source=readFileSync(process.env.CHATGPT_SHARED_FOLLOWUP_RENDERER_ORIGINAL,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032');
 const cut=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j);},never=()=>{throw Error('Unselected original renderer service boundary');};
 const context={prompt:known.text,imageAttachments:[],fileAttachments:[],pastedTextAttachments:[],addedFiles:[],commentAttachments:[],workspaceRoots:['/owned/project'],collaborationMode:{mode:'default',settings:{model:known.model,reasoning_effort:known.effort,developer_instructions:null}}};
 const conversation={id:binding.threadId,cwd:'/owned/project',mode:'default',resumeState:'resumed',needsResume:false};
 // Ancillary file/image, prompt projection and service boundaries use owned
 // inputs. Prepared DTO construction itself is the unmodified pinned mEs/hEs.
 const empty=value=>{assert.equal(value?.length??0,0);return[];};
 const deps={Ln:'local',BTs:'owned closed subagent',_Es:()=>false,gTs:async()=>{},n3t:empty,UTs:value=>({input:{type:'text',text:value.prompt,text_elements:[]},responseItems:[]}),HTs:value=>value.prompt,DS:()=> 'local',YTs:value=>empty(value.imageAttachments),oT:empty,h3t:(a,b)=>{empty(a);empty(b);return[];},rpe:never,vEs:()=>false,cfo:never,GT:30000,Ih:never,Ype:never,Eo:never,Wse:never,gEs:()=>false,Q_o:'explicitRequestOnly',sEe:never,bwe:never,zC:{getTrace:()=>null,markRequestDispatched(){}},qws:()=>undefined,AIo:()=>null,ht:()=>false,cEs:never,Jh:()=>({resumeConversation:never}),xwa:never,CE:class extends Error{},ID:Symbol('owned workspace roots')};
 const body=cut('function e5t(','function t5t(')+cut('function GTs(','function KTs(')+cut('async function mEs(','function gEs(');
 const {mEs,hEs}=new Function(...Object.keys(deps),body+';return {mEs,hEs};')(...Object.values(deps));
 return async(input,kind)=>{
  const args={scope:{get:()=>undefined},turnTrigger:'composer',managerHostId:binding.hostId,hostId:binding.hostId,context:{...context,...input.message.context,collaborationMode:context.collaborationMode},targetConversationId:binding.threadId,cwd:'/owned/project',agentMode:'auto',permissionProfileId:null,serviceTier:null,shouldSendPermissionOverrides:false,usePermissionSelection:false,activeCollaborationMode:context.collaborationMode,clientUserMessageId:input.message.id,conversation,isCloudFollowUp:false,inheritNativeWorkspacePermissions:false,restoreMessage:{...input.message,cwd:'/owned/project',context:{...context,...input.message.context},writingBlockAdditionalContext:null}};
  const value=await(kind==='start'?mEs(args):hEs(args));value.steer.restoreMessage=args.restoreMessage;
  shapes.push({kind,hasOwnConversationId:Object.hasOwn(value,'conversationId'),hasOwnStart:Object.hasOwn(value,'start'),startPrototypePlain:value.start==null?null:Object.getPrototypeOf(value.start)===Object.prototype});return value;
 };
}
function capture(){const file=process.env.CHATGPT_SHARED_FOLLOWUP_EXPECTED,settings=process.env.CHATGPT_SHARED_FOLLOWUP_MODEL_SETTINGS;const expected=file?JSON.parse(readFileSync(file,'utf8')):{prompts:['owned first','owned captured follow-up'],model:'owned-model'},model=settings?JSON.parse(readFileSync(settings,'utf8')):{model:expected.model,wireEffort:'low'};assert.equal(model.model,expected.model);return {text:expected.prompts[1],model:model.model,effort:model.wireEffort};}
async function fixture(t,{deferred=false,originalPrepare=false}={}){
 const shipped=original(),known=capture(),profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),epoch=randomUUID(),owner={isDestroyed:()=>false},record={senderId:1,viewId,window:{webContents:owner,isDestroyed:()=>false}},binding={hostId:'kanban-shared-cli',runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-project',threadId:randomUUID(),viewId,clientId:randomUUID()};
 const state={live:true,ready:!deferred,owned:true},physical=[],authorized=[],warnings=[],stages=[],replies=[],prepareShapes=[];let stored={},callbacks,handoffObserved;const handoffStop=Object.assign(Error('Owned original prepared handoff observed'),{code:'OWNED_RENDERER_PREPARED_HANDOFF'});
 const getRecord=id=>state.owned&&id===1?record:null,getOwnedRecord=x=>state.owned&&x===owner?record:null;
 const authority=createSharedThreadSendAuthority({getOwnedView:()=>record,verifyOwnedViewSync:()=>state.live,verifyBindingSync:b=>state.live&&JSON.stringify(b)===JSON.stringify(binding),verifyExplicitIntentSync:()=>state.live,verifySelectionSync:()=>state.live});
 const receipts=[],gate=createSharedDaemonRpcGate({verifyReadSync:()=>state.live,verifyBindingSync:()=>state.live,verifyHistorySync:()=>state.live,write:text=>physical.push(JSON.parse(text)),turn:authority,desktop:{daemonVersion:'0.166.0',verifyInitializeSync:()=>state.live,registerInitializeConsumptionSync:r=>receipts.push(r)}});
 gate.write(JSON.stringify({id:'owned-init',method:'initialize',params:{clientInfo:{name:'codex_desktop',version:'26.1027.51404'}}}));gate.receive(JSON.stringify({id:'owned-init',result:{userAgent:'codex_app_server/0.166.0',codexHome:'/owned/daemon/.codex'}}));assert.equal(receipts[0].consumeSync(),true);
 const sender=createNativeSharedThreadSendRouter({profileId,generation,getRecord,getOwnedRecord,verifyRuntimeSync:()=>state.live,verifyBindingSync:()=>state.live,resolveBinding:async()=>binding,canonicalizeFrame:canonicalizeOriginalSharedTurn,authorizeSend:async(b,frame,control)=>{authorized.push(frame);return authority.registerSend(b,frame,control);},sendToView(){}});
 assert.equal(sender.lifecycle(owner,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
 const turns=new shipped.Turns(()=>assert.fail('No automation'),()=>assert.fail('No fabricated notification'));
 const tapGlobals={__kanbanPrepareSharedThreadRequest:(host,frame)=>sender.prepareRequest(host,frame),__kanbanExchangeSharedThreadRequest:()=>assert.fail('Ordinary turn must use its real SDK connection')};
 const requestTap={hostId:binding.hostId,assertCurrent(){assert.equal(state.live,true);assert.equal(state.owned,true);},requestLifecycleListeners:new Set(),async sendToConnection(frame){stages.push('prepared');gate.write(JSON.stringify(frame));const response={id:frame.id,result:{turn:{id:randomUUID(),items:[],status:'inProgress',error:null}}};assert.equal(gate.receive(JSON.stringify(response)),JSON.stringify(response));replies.push(response);return response;}};
 requestTap.send=shipped.makeRequestTap(tapGlobals);
 const execution={subscribe(fn){callbacks=fn;return()=>{};},isClientReady:()=>state.ready,canAcquireOwnership:()=>true,tryAcquireStartTurn:()=>true,releaseStartTurn(){},acquireSendLock:async()=>({release:async()=>{}}),errorReason:error=>error.message,prepare:()=>assert.fail('Actual committed prepare callback must be retained')};
 const options={hostId:binding.hostId,createMessageThreadId:()=>undefined,getStreamRole:()=>({role:'owner'}),isDurableThread:()=>false,getMessageQueueMode:async()=> 'send-only',wasMessageAccepted:()=>false,canSend:()=>true,execution:()=>execution,logger:{error:(message,fields)=>warnings.push({message,error:fields.sensitive.error}),warning:(message,fields)=>warnings.push({message,error:fields.sensitive.error})},storage:{read:()=>({isLoading:false,value:stored}),load:async()=>stored,update:async fn=>{stored=fn(stored);}},submissionHost:{needsResume:()=>false,getActiveTurnId:()=>null,hasPendingTurnStart:()=>false,hasFinalAnswer:()=>true,canStartAfterSteerError:()=>false,steer:()=>assert.fail('No active turn exists'),async start(id,value){stages.push('host.start');assert.equal(id,binding.threadId);if(originalPrepare){handoffObserved=value;throw handoffStop;}return (await turns.startTurn(value.request,null,async frame=>{stages.push('rf.frame');return {id:frame.id,result:await requestTap.send(frame)};})).turn.id;}}};
 const globals={},Coordinator=shipped.makeCoordinator(globals),coordinator=new Coordinator(options);await coordinator.executionReady;
 const facade=new shipped.w7(()=>coordinator),dynamic=createDynamicToolsRouter({getRecord,getOwnedRecord,withSend:sender.withSend});
 const wrapped=dynamic.bindManagers({open:host=>{assert.equal(host,binding.hostId);return {status:'ready',manager:{getTurnCoordinator:()=>facade}};}},owner).open(binding.hostId).manager.getTurnCoordinator();
 // A product hook, if present, is installed by the real router. Tests never
 // re-enter AsyncLocalStorage or synthesize a sender context.
 if(typeof sender.runPreparedSend==='function')globals.__kanbanRunSharedPreparedSend=sender.runPreparedSend;
 t.after(()=>{coordinator.dispose();sender.dispose();gate.close();});
 const attemptId=randomUUID();assert.equal(await sender.intent(owner,{type:'kanban-shared-send-intent',v:1,action:'send',profileId,generation,viewId,hostId:binding.hostId,threadId:binding.threadId,attemptId,sequence:1,epoch}),true);
 const message={id:randomUUID(),text:known.text,context:{prompt:known.text,__kanbanSharedSendAttempt:attemptId}};
 let prepare=async(input,kind)=>{stages.push('prepare:'+kind);assert.equal(input.message.context.__kanbanSharedSendAttempt,undefined);assert.equal(input.message.text,known.text);const restoreMessage=input.message;return {conversationId:binding.threadId,executionHostId:binding.hostId,resume:{conversationId:binding.threadId},start:{request:{threadId:binding.threadId,input:[{type:'text',text:input.message.text,text_elements:[]}],model:known.model,effort:known.effort},context:{restoreMessage}},steer:{restoreMessage}};};
 if(originalPrepare){
  const actual=originalRendererPrepare(known,binding,prepareShapes),stub=new shipped.rop.AX({prepare:actual}),remote=stub.prepare;
  prepare=(...args)=>{const result=remote(...args);assert.equal(require('node:util').types.isPromise(result),false);assert.equal(typeof result.then,'function');return result;};
 }
 let done=false;const result=wrapped.sendMessage({conversationId:binding.threadId,message,acceptLocally:deferred},prepare,()=>{stages.push('locally-added');},undefined,()=>{});result.then(()=>{done=true;},()=>{done=true;});
 return {known,state,physical,authorized,warnings,stages,result,sender,owner,binding,coordinator,attemptId,message,wrapped,prepare,prepareShapes,handoff:()=>handoffObserved,async wake(){for(let i=0;i<30&&!coordinator.accepted.has(binding.threadId)&&!done;i++)await new Promise(setImmediate);assert.equal(coordinator.accepted.has(binding.threadId),true,'Full original coordinator must have accepted the pending message');assert.equal(done,false,'withSend must remain pending before the outside execution callback');state.ready=true;callbacks.readinessChanged(binding.threadId);},async bounded(){return Promise.race([result,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Original follow-up did not settle')),3000);timer.unref();})]);}};
}
const required={skip:!root?'Requires explicitly supplied pinned desktop originals':false};
test('original w7 and xU immediate follow-up preserve captured body/model through rf and a single branded gate write',required,async t=>{
 const f=await fixture(t);await f.bounded();assert.equal(f.physical.filter(r=>r.method==='turn/start').length,1);assert.equal(f.authorized.length,1);assert.equal(f.authorized[0].params.input[0].text,f.known.text);assert.equal(f.authorized[0].params.model,f.known.model);assert.equal(f.authorized[0].params.effort,f.known.effort);
});
test('original accepted follow-up can wake through the pre-existing execution callback without losing its exact explicit sender',required,async t=>{
 const f=await fixture(t,{deferred:true});f.message.text='owned later draft must not replace committed input';f.message.context.prompt=f.message.text;await f.wake();await f.bounded();assert.equal(f.physical.filter(r=>r.method==='turn/start').length,1);assert.equal(f.authorized.length,1);assert.equal(f.authorized[0].params.input[0].text,f.known.text);assert.equal(f.authorized[0].params.model,f.known.model);assert.equal(f.authorized[0].params.effort,f.known.effort);assert.equal(f.physical.some(r=>['thread/resume','thread/start'].includes(r.method)),false);
});

test('outside wake cannot revive a hidden lifecycle, revoked runtime or foreign owned view',required,async t=>{
 for(const kind of ['lifecycle','runtime','foreign-view']){
  const f=await fixture(t,{deferred:true});
  // Let the original accepted producer finish recording its real callback before
  // revocation, then invoke the same execution event without another gesture.
  for(let i=0;i<30&&!f.coordinator.accepted.has(f.binding.threadId);i++)await new Promise(setImmediate);
  assert.equal(f.coordinator.accepted.has(f.binding.threadId),true);
  if(kind==='lifecycle')assert.equal(f.sender.lifecycle(f.owner,{type:'kanban-shared-connect-lifecycle',sequence:2,epoch:null}),true);
  if(kind==='runtime')f.state.live=false;
  if(kind==='foreign-view')f.state.owned=false;
  await f.wake();await assert.rejects(f.bounded(),{code:'SHARED_SEND_INTENT_DENIED'});
  assert.equal(f.authorized.length,0);assert.equal(f.physical.filter(frame=>frame.method==='turn/start').length,0);
 }
});
test('an already consumed gesture cannot send the same original coordinator submission twice',required,async t=>{
 const f=await fixture(t);await f.bounded();
 await assert.rejects(f.wrapped.sendMessage({conversationId:f.binding.threadId,message:f.message,acceptLocally:false},f.prepare),{code:'SHARED_SEND_INTENT_DENIED'});
 assert.equal(f.authorized.length,1);assert.equal(f.physical.filter(frame=>frame.method==='turn/start').length,1);
});

test('actual renderer hEs and mEs DTOs resolve through original RPC thenables before the exact committed start handoff',{...required,skip:required.skip||(!process.env.CHATGPT_SHARED_FOLLOWUP_RENDERER_ORIGINAL?'Requires pinned original Mac app-initial member':false)},async t=>{
 const f=await fixture(t,{deferred:true,originalPrepare:true});await f.wake();await assert.rejects(f.bounded(),{code:'OWNED_RENDERER_PREPARED_HANDOFF'});
 assert.deepEqual(f.prepareShapes.map(x=>({kind:x.kind,hasOwnStart:x.hasOwnStart})),[{kind:'steer',hasOwnStart:false},{kind:'start',hasOwnStart:true}]);
 const params=f.handoff().request;
 assert.equal(params.input[0].text,f.known.text);assert.equal(params.model,null);assert.equal(params.effort,null);assert.equal(params.collaborationMode.settings.model,f.known.model);assert.equal(params.collaborationMode.settings.reasoning_effort,f.known.effort);
 assert.equal(params.responsesapiClientMetadata.source,'codex');assert.equal(Object.hasOwn(params.responsesapiClientMetadata,'workspace_kind'),false,'Original renderer metadata is still pre-I2; do not fabricate its native projection');
 assert.equal(f.authorized.length,0);assert.equal(f.physical.filter(x=>x.method!=='initialize').length,0);
});
