import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createContext, Script } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { adaptNativeSharedThreadChunk } = require('../src/native-shared-thread-policy.cjs');
const { createNativeSharedThreadRouter } = require('../src/native-shared-thread-routing.cjs');
const { createDynamicToolsRouter } = require('../src/dynamic-tools-routing.cjs');
const original = process.env.CHATGPT_PICKER_NATIVE_CHUNK;

test('fixed Linux AppHost preserves original local and remote dispatch; only the prepared shared frame reaches the daemon', { skip: !original }, async () => {
  const bytes = await readFile(original);
  const source = adaptNativeSharedThreadChunk({ body: bytes }).body.toString('utf8');
  const begin = source.indexOf('async send(e,t,r,n){this.assertCurrent();try{');
  const end = source.indexOf('async sendToConnection(e,t,r,n){', begin);
  assert.ok(begin >= 0 && end > begin);
  const calls = [], errors = [];
  let sharedError = false;
  const context = createContext({
    el: { iwv: 'local' },
    Rm: { send: frame => { calls.push(['native', frame.id]); return frame.id === 'rewrite' ? { type:'request', request:{ ...frame, method:'rewritten' } } : { type:'response', response:{ result:`native:${frame.id}` } }; } },
    m6: { ee: Error }, em: { UKQ: (_id, error) => ({ message: String(error) }) },
    __kanbanGuardSharedThreadRequest: async (_host, frame) => frame,
    __kanbanPrepareSharedThreadRequest: async (_host, frame) => ({ frame, shared:frame.id === 'shared' }),
    __kanbanExchangeSharedThreadRequest: async (_host, frame) => { calls.push(['shared', frame.id]); if (sharedError) throw Object.assign(new Error('unknown'), { code:'SHARED_DAEMON_OUTCOME_UNKNOWN' }); return { result:'real-shared' }; },
  });
  const methods = new Script(`({${source.slice(begin,end)}})`).runInContext(context);
  const adapter = { ...methods, hostId:'local', assertCurrent(){}, requestLifecycleListeners:[x => errors.push(x.type)], sendToConnection: async frame => { calls.push(['connection',frame.id,frame.method]); return { result:`connection:${frame.id}` }; } };
  assert.equal(await adapter.send({id:'init',method:'account/read'}), 'native:init');
  assert.equal(await adapter.send({id:'normal',method:'thread/resume'}), 'native:normal');
  assert.equal(await adapter.send({id:'rewrite',method:'foo'}), 'connection:rewrite');
  adapter.hostId = 'remote';
  assert.equal(await adapter.send({id:'remote',method:'foo'}), 'connection:remote');
  adapter.hostId = 'local';
  assert.equal(await adapter.send({id:'shared',method:'thread/resume'}), 'real-shared');
  sharedError = true;
  const outcomes = [];
  await assert.rejects(adapter.send({id:'shared',method:'thread/resume'}, { onOutcomeUnknown:e=>outcomes.push(e) }, false, true), {code:'SHARED_DAEMON_OUTCOME_UNKNOWN'});
  assert.equal(outcomes.length,1);
  assert.deepEqual(errors, ['outcome-unknown','failed']);
  assert.deepEqual(calls, [['native','init'],['native','normal'],['native','rewrite'],['connection','rewrite','rewritten'],['connection','remote','foo'],['shared','shared'],['shared','shared']]);
});

test('only an explicit marker enters the shared resume scope; ordinary original parameters retain identity', async () => {
  const sender={id:1,isDestroyed:()=>false};
  const record={senderId:1,window:{webContents:sender,isDestroyed:()=>false},failed:false};
  let entered=0, invoked=[];
  const manager={resumeConversation(params){invoked.push(params);return params;}};
  const routing=createDynamicToolsRouter({getRecord:id=>id===1?record:null,getOwnedRecord:s=>s===sender?record:null,withResume:(s,h,p,invoke)=>{entered++;if(p.__kanbanSharedConnectAttempt!=='valid') throw Object.assign(Error('denied'),{code:'DENIED'}); assert.equal(s,sender);assert.equal(h,'local');return invoke({conversationId:p.conversationId});}});
  const wrapped=routing.bindManagers({open:()=>({status:'ready',manager})},sender).open('local').manager;
  const ordinary={conversationId:'ordinary',extra:'unchanged'};
  assert.equal(wrapped.resumeConversation(ordinary),ordinary);
  assert.equal(entered,0);
  assert.throws(()=>wrapped.resumeConversation({conversationId:'x',__kanbanSharedConnectAttempt:undefined}),{code:'DENIED'});
  assert.equal(entered,1);
  const shared=wrapped.resumeConversation({conversationId:'target',__kanbanSharedConnectAttempt:'valid'});
  assert.deepEqual(shared,{conversationId:'target'});
  assert.equal(entered,2);assert.equal(invoked.length,2);
});

test('prepared shared routing derives only from the exact verified scope and one guarded resume', async () => {
  const profileId=randomUUID(),generation=randomUUID(), threadId=randomUUID(),attemptId=randomUUID(),epoch=randomUUID();
  const sender={id:1,isDestroyed:()=>false};
  const record={viewId:randomUUID(),senderId:1,window:{webContents:sender,isDestroyed:()=>false},failed:false};
  const authorized=[];
  const router=createNativeSharedThreadRouter({profileId,generation,getRecord:id=>id===1?record:null,getOwnedRecord:s=>s===sender?record:null,verifyRuntimeSync:()=>true,
    resolveBinding:async (_record,{hostId,threadId})=>({hostId,threadId,projectId:'fixture',viewId:record.viewId,clientId:randomUUID(),runtimeGeneration:generation,daemonGeneration:randomUUID(),accountRevision:1}),
    verifyBinding:async()=>true,verifyBindingSync:()=>true,authorizeRequest:async (binding,frame)=>{authorized.push({binding,frame});return true;},sendToView:()=>{}});
  try {
    const plain={id:'normal',method:'thread/resume',params:{threadId}};
    const immediate=router.prepareRequest('local',plain);
    assert.equal(typeof immediate?.then,'undefined','ordinary traffic must not gain an extra async scheduling step');
    const noScope=await immediate;
    assert.equal(noScope.shared,false);assert.equal(noScope.frame,plain);assert.equal(authorized.length,0);
    const forged={...plain,__kanbanSharedConnectAttempt:attemptId};
    const forgedResult=await router.prepareRequest('local',forged);
    assert.equal(forgedResult.shared,false);assert.equal(forgedResult.frame,forged);assert.equal(authorized.length,0);
    assert.equal(router.lifecycle(sender,{type:'kanban-shared-connect-lifecycle',sequence:1,epoch}),true);
    assert.equal(await router.intent(sender,{type:'kanban-shared-connect-intent',v:1,action:'connect',attemptId,profileId,generation,viewId:record.viewId,hostId:'local',threadId,sequence:1,epoch}),true);
    const request={id:'exact',method:'thread/resume',params:{threadId,cwd:'/changed',permissions:{bad:true}}};
    const result=await router.withResume(sender,'local',{conversationId:threadId,__kanbanSharedConnectAttempt:attemptId},()=>router.prepareRequest('local',request));
    assert.equal(result.shared,true);
    assert.deepEqual(result.frame,{id:'exact',method:'thread/resume',params:{threadId,excludeTurns:true}});
    assert.equal(authorized.length,1);
    const after=await router.prepareRequest('local',request);
    assert.equal(after.shared,false);assert.equal(after.frame,request);
    await assert.rejects(router.withResume(sender,'local',{conversationId:threadId,__kanbanSharedConnectAttempt:attemptId},()=>{}),{code:'SHARED_NAV_INTENT_DENIED'});
  } finally {router.dispose();}
});
