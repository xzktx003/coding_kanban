import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNativeSharedThreadCreationRouter,readNativeSharedFirstTurnControl}=require('../src/native-shared-thread-creation-routing.cjs');
const {createDynamicToolsRouter}=require('../src/dynamic-tools-routing.cjs');
const directory=process.env.CHATGPT_SHARED_FIRST_TURN_ORIGINAL_DIR;
const expected=process.env.CHATGPT_SHARED_FIRST_TURN_EXPECTED;
const modelSettings=process.env.CHATGPT_SHARED_FIRST_TURN_MODEL_SETTINGS;
const HOST='kanban-shared-cli',CWD='/owned/ep-fixture';
const sha=value=>createHash('sha256').update(value).digest('hex');
const requiresOriginal={skip:!directory?'Requires explicitly supplied fixed original native ID/IM/IO/Cu and permission factory':false};
function original(){
 const source=readFileSync(join(directory,'early-bootstrap-439-a0f25ba32c465de1.js'),'utf8');
 assert.equal(sha(source),'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333');
 const module=readFileSync(join(directory,'module-61082.js'),'utf8');
 assert.equal(sha(module),'25691348784d7d58598fab0fd278ecac9b15f8f40db0063a38850c20202933b7');
 const unavailable=()=>{throw Error('Unselected original service boundary');},permissions={};
 const permissionRequire=id=>{assert.ok([44814,8857].includes(id));return unavailable;};
 permissionRequire.n=value=>()=>value;permissionRequire.d=(target,getters,constants)=>{for(const[key,get]of Object.entries(getters))Object.defineProperty(target,key,{get});Object.assign(target,constants);};
 new Function('return ('+module+')[61082]')()({},permissions,permissionRequire);
 const exact=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start);assert.equal(source.indexOf(from,start+1),-1);return source.slice(start,end);};
 const body=[exact('function Cu(','async function Ch('),exact('function yR(','var yE='),exact('async function ID(','async function IF(')].join('\n');
 class DeliveryError extends Error{constructor(stage){super('owned delivery outcome');this.delivery={stage,requestId:'owned-unknown-request'};}}
 const ID=new Function('yA','yo','yw','yl','m6','S0',body+';return ID;')(permissions,{iw:'local'},{u:()=>Promise.withResolvers()},{R:error=>error instanceof Error?error.message:String(error)},{q3:DeliveryError},unavailable);
 const method=exact('startConversation(e,t){return ID(this,','async forkConversationFromLatest(');
 const startConversation=new Function('ID','return ({'+method+'}).startConversation;')(ID);
 const nBegin=source.indexOf('N=function(e,{runtime:t,filesystem:r'),nEnd=source.indexOf('}(this,e,this.turnStartObservations',nBegin);assert.ok(nBegin>=0&&nEnd>nBegin);
 const makeTurnStart=(dispatch)=>new Function('I7','wL','bu','return ('+source.slice(nBegin+2,nEnd+1)+');')(dispatch,'owned window unavailable',unavailable);
 const recovery=new Function('wT','return class{'+exact('wrapTurnStart(e){','forgetConversation(e){')+'};')(unavailable);
 return{permissions,startConversation,DeliveryError,makeTurnStart,recovery};
}
function captured(){
 const value=expected?JSON.parse(readFileSync(expected,'utf8')):{marker:'owned-ep-marker',prompts:['Only reply owned-ep-marker. Do not use tools.'],model:'owned-model'};
 assert.equal(typeof value.marker,'string');assert.equal(typeof value.prompts[0],'string');
 const settings=modelSettings?JSON.parse(readFileSync(modelSettings,'utf8')):{model:value.model,wireEffort:'low'};
 assert.equal(settings.model,value.model);assert.equal(typeof settings.wireEffort,'string');
 return {...value,wireEffort:settings.wireEffort};
}
async function fixture(t,options={}){
 const shipped=original(),known=captured(),events=[],wire=[],settlements=[],warnings=[],heldUnknown=Promise.withResolvers();
 const state={live:true,now:100,activeCalls:0,executeCalls:0};
 const profileId=randomUUID(),generation=randomUUID(),viewId=randomUUID(),threadId=randomUUID(),turnId=randomUUID(),clientUserMessageId=randomUUID();
 const sender={isDestroyed:()=>false},record={senderId:1,viewId,window:{webContents:sender,isDestroyed:()=>false}};
 const scope={hostId:HOST,runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1,projectId:'owned-source-project',cwd:CWD,viewId,creationNonce:randomUUID()};
 const binding={hostId:HOST,runtimeGeneration:generation,daemonGeneration:scope.daemonGeneration,accountRevision:1,projectId:scope.projectId,threadId,viewId,clientId:randomUUID()};
 const router=createNativeSharedThreadCreationRouter({profileId,generation,getRecord:()=>record,getOwnedRecord:value=>value===sender?record:null,verifyRuntimeSync:()=>state.live,sendToView(){},resolveCreateScope:async()=>scope,authorizeCreate:async(_scope,frame)=>{events.push('thread/start');wire.push(frame);return true;},resolveCreatedBinding:async()=>binding,onBound:async()=>{events.push('bound');return true;},now:()=>state.now});
 t.after(()=>router.dispose());
 const life={type:'kanban-shared-connect-lifecycle',sequence:1,epoch:randomUUID()};assert.equal(router.lifecycle(sender,life),true);
 const attemptId=randomUUID(),clientThreadId='client-new-thread:'+randomUUID();
 assert.equal(await router.intent(sender,{type:'kanban-shared-create-intent',v:1,action:'create',profileId,generation,viewId,hostId:HOST,projectId:scope.projectId,cwd:CWD,clientThreadId,attemptId,sequence:life.sequence,epoch:life.epoch}),true);
 const permissions=shipped.permissions.$5('auto',[CWD]);
 const input=[{type:'text',text:known.prompts[0],text_elements:[]}],collaborationMode={mode:'default',settings:{model:known.model,reasoning_effort:known.wireEffort,developer_instructions:null}};
 // The known v41 text/model/effort are replayed. Remaining fields are explicit
 // owned service fixtures; this does not claim a capture of unknown clean params.
 const params={cwd:CWD,workspaceRoots:[CWD],input,mode:'default',workspaceKind:'project',permissionsConfig:permissions,useAppServerPermissionDefault:false,collaborationMode,clientUserMessageId,projectAssignment:{projectKind:'local',projectId:scope.projectId},__kanbanSharedCreateAttempt:attemptId,__kanbanSharedCreateClient:clientThreadId};
 const response={model:known.model,activePermissionProfile:permissions.activePermissionProfile,runtimeWorkspaceRoots:permissions.runtimeWorkspaceRoots,approvalPolicy:permissions.approvalPolicy,approvalsReviewer:permissions.approvalsReviewer,sandbox:permissions.sandboxPolicy,thread:{id:threadId,createdAt:1,daybreakEnabled:false}};
 const point=name=>{events.push(name);if(options.fail===name)throw options.error??Error('owned:'+name);};
 const manager={
  logger:{warning:name=>warnings.push(name)},getHostId:()=>HOST,readDefaultPersonality:async()=>null,
  assertActive(){state.activeCalls++;point('active:'+state.activeCalls);if(!state.live)throw Error('owned:retired');},
  settings:{readDefaultFeatureOverrides:()=>({})},history:{createSearchIslandId:()=>randomUUID()},runtimeSettings:{onFirstTurnReady(){point('ready');}},
  threadWorkspaceStorage:{async setProjectAssignment(id,assignment){assert.equal(id,threadId);assert.equal(assignment,params.projectAssignment);point('project');}},
  threadStartedNotificationDeferral:{async run(enabled,callback){assert.equal(enabled,true);return callback();}},
  threadStore:{notifyConversationCallbacks(id){assert.equal(id,threadId);point('notify');}},
  updateThreadDaybreakEnabled(){assert.fail('unchanged daybreak must not write');},broadcastConversationSnapshot(id){assert.equal(id,threadId);point('snapshot');},
  threadCreation:{
   async createConversation(prepared,_read,_unknown,created){
    assert.equal(prepared.cwd,CWD);assert.equal(prepared.mode,'default');assert.equal(prepared.collaborationMode,collaborationMode);assert.equal(prepared.permissionsConfig,permissions);
    await router.prepareRequest(HOST,{id:'owned-start',method:'thread/start',params:{cwd:CWD,model:known.model,approvalPolicy:permissions.approvalPolicy,approvalsReviewer:permissions.approvalsReviewer,permissions:':workspace',runtimeWorkspaceRoots:[CWD]}});
    await created(threadId,scope.projectId);point('created-callback');
    return{conversationId:threadId,conversationResponse:response,effectiveCwd:CWD,firstTurnContext:{conversationId:threadId,workspaceKind:'project'},serviceTier:null,initializationError:options.initializationError??null};
   },async saveInitialDaybreak(){point('daybreak');}
  },
  async executeTurnStart(id,value,kind,unknown,onMessageAdded){
   state.executeCalls++;point('execute');assert.equal(id,threadId);assert.equal(kind,'nested');assert.equal(typeof unknown,'function');assert.equal(onMessageAdded,undefined);
   assert.equal(value.request.input,input);assert.equal(value.request.collaborationMode,collaborationMode);assert.equal(value.request.model,null);assert.equal(value.request.effort,known.wireEffort);assert.equal(value.request.permissions,':workspace');assert.equal(value.request.approvalPolicy,'on-request');
   assert.equal(value.context.restoreMessage.text,known.prompts[0]);assert.equal(value.context.restoreMessage.context.prompt,known.prompts[0]);
   await value.context.assertRequestCurrent?.();await value.context.beforeSendRequest?.();
   if(options.outcomeUnknown){unknown({requestId:'owned-pending-first-turn'});await heldUnknown.promise;}
   const frame={id:'owned-first-turn',method:'turn/start',params:value.request},capability=router.getFirstTurnContext(HOST,frame);assert.ok(capability,'first native frame must still have the original withStart binding');
   assert.ok(readNativeSharedFirstTurnControl(binding,capability.token,frame),'captured exact input/model/permission must match');
   wire.push(frame);point('turn/start');return options.returnValue??{turn:{id:turnId}};
  },startConversation:shipped.startConversation,
 };
 if(options.originalDispatcher){
  const execute=manager.executeTurnStart.bind(manager),role={role:'owner'};manager.getStreamRole=()=>role;
  const factory=shipped.makeTurnStart(context=>{state.originalDispatcherCalled=true;assert.equal(context.manager,manager);assert.equal(context.origin,'nested');assert.equal(context.operation.request.input,input);assert.equal(typeof context.onOutcomeUnknown,'function');assert.equal(context.onMessageAdded,undefined);return execute(context.conversationId,context.operation,context.origin,context.onOutcomeUnknown,context.onMessageAdded);});
  const native=factory(manager,{runtime:{},filesystem:{},storage:{}},{begin(){assert.fail('I7 observation boundary is not executed by this forwarding-only replay');}},()=>manager.assertActive(),()=>state.live,()=>randomUUID(),()=>{});
  const recovery=new shipped.recovery();recovery.deps={manager:{getConversation:()=>null}};recovery.turnRecoveries=new Map();
  manager.executeTurnStart=recovery.wrapTurnStart(native);
 }
 const dynamic=createDynamicToolsRouter({getRecord:()=>record,getOwnedRecord:value=>value===sender?record:null,withStart:router.withStart});
 const bound=dynamic.bindManagers({open:host=>{assert.equal(host,HOST);return{status:'ready',manager};}},sender).open(HOST).manager;
 const callbacks={
  afterConversationCreated:async id=>{assert.equal(id,threadId);point('after-created');},
  prepareFirstTurnEnvironments:async id=>{assert.equal(id,threadId);point('environments');return[];},
  prepareFirstTurn:async context=>{assert.equal(context.conversationId,threadId);point('prepare');return null;},
  assertRequestCurrent:async()=>{point('current');if(options.retireBeforeFirstTurn)state.live=false;},
  onSettled:async result=>{settlements.push(result);},
 };
 return{releaseUnknown:()=>heldUnknown.resolve(),run:()=>bound.startConversation(params,callbacks),params,callbacks,manager,router,sender,life,state,events,wire,settlements,warnings,threadId,turnId,known,shipped};
}

test('complete shipped manager ID ep preserves exact captured input and returns accepted only after the original nested first-turn call',requiresOriginal,async t=>{
 const f=await fixture(t),result=await f.run();
 assert.deepEqual(result,{status:'created',conversationId:f.threadId,firstTurn:{status:'accepted',turnId:f.turnId}});
 assert.equal(f.wire.filter(x=>x.method==='turn/start').length,1);assert.deepEqual(f.settlements,[result]);assert.equal(f.warnings.length,0);
 assert.deepEqual(f.events,['active:1','thread/start','bound','after-created','created-callback','daybreak','project','notify','snapshot','environments','active:2','current','prepare','active:3','current','ready','execute','current','turn/start']);
});

test('complete shipped ID ep resolves created/not-started for each pre-frame failure instead of rejecting withStart or dispatching a turn',requiresOriginal,async t=>{
 for(const fail of ['daybreak','project','environments','active:2','current','prepare','active:3','ready','execute'])await t.test(fail,async t=>{
  const f=await fixture(t,{fail}),result=await f.run();
  assert.deepEqual(result,{status:'created',conversationId:f.threadId,firstTurn:{status:'not-started',message:'owned:'+fail}});
  assert.equal(f.wire.filter(x=>x.method==='thread/start').length,1);assert.equal(f.wire.filter(x=>x.method==='turn/start').length,0);
  assert.deepEqual(f.settlements,[result]);assert.equal(f.warnings.length,0,'ordinary ep failures are returned without an error log');
 });
});

test('complete shipped ID retains initialization-error and jsonRpc-rejected result distinctions after accepted creation',requiresOriginal,async t=>{
 await t.test('initialization-error',async t=>{const f=await fixture(t,{initializationError:'owned:initialization'}),result=await f.run();assert.equal(result.firstTurn.status,'not-started');assert.equal(result.firstTurn.message,'owned:initialization');assert.equal(f.state.executeCalls,0);assert.equal(f.wire.length,1);});
 await t.test('jsonRpc-rejected',async t=>{const f=await fixture(t,{fail:'prepare',error:Object.assign(Error('owned:rpc'),{jsonRpcCode:-32000})}),result=await f.run();assert.equal(result.firstTurn.status,'rejected');assert.equal(result.firstTurn.message,'owned:rpc');assert.equal(f.wire.length,1);});
 await t.test('retired-after-created',async t=>{const f=await fixture(t,{retireBeforeFirstTurn:true}),result=await f.run();assert.equal(result.firstTurn.status,'not-started');assert.equal(result.firstTurn.message,'owned:retired');assert.equal(f.wire.length,1);});
});

test('the full original producer remains behind the unchanged exact creation scope and mode/lifecycle clamps',requiresOriginal,async t=>{
 for(const changed of ['mode','project','lifecycle'])await t.test(changed,async t=>{
  const f=await fixture(t);
  if(changed==='mode')f.params.mode='durable';
  if(changed==='project')f.params.projectAssignment={projectKind:'local',projectId:'foreign-project'};
  if(changed==='lifecycle')assert.equal(f.router.lifecycle(f.sender,{...f.life,sequence:2,epoch:null}),true);
  await assert.rejects(f.run,{code:'SHARED_CREATE_INTENT_DENIED'});assert.equal(f.wire.length,0);assert.equal(f.state.activeCalls,0);
 });
});

test('the real ID outcome-unknown callback can win its race while the nested first turn is pending; no later write may reuse the closed start scope',requiresOriginal,async t=>{
 const f=await fixture(t,{outcomeUnknown:true,originalDispatcher:true}),result=await f.run();
 assert.equal(f.state.originalDispatcherCalled,true,'the actual N factory must forward through the original recovery wrapper');
 assert.deepEqual(result,{status:'created',conversationId:f.threadId,firstTurn:{status:'outcome-unknown',clientUserMessageId:f.params.clientUserMessageId,requestId:'owned-pending-first-turn'}});
 assert.equal(f.state.executeCalls,1);assert.equal(f.wire.filter(x=>x.method==='turn/start').length,0);assert.equal(f.settlements.length,0,'x.promise wins before the main ID/ep operation is settled');
 f.releaseUnknown();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.wire.filter(x=>x.method==='turn/start').length,0,'the returned unknown operation must not revive its captured authority');
 assert.equal(f.settlements.length,1);assert.equal(f.settlements[0].firstTurn.status,'not-started');
});
