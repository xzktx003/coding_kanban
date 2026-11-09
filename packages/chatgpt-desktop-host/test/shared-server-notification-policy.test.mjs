import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifySharedServerNotification,SHARED_THREAD_NOTIFICATION_METHODS} from '../src/shared-server-notification-policy.mjs';
const threadId='01a1a149-6eb4-7ba0-801b-5db075460f12',turnId='native-turn',itemId='native-item';
const frame=(method,params)=>({method,params,emittedAtMs:1794043600000});
const hookRun={id:'owned-hook',eventName:'preModelRequest',executionMode:'sync',handlerType:'command',scope:'turn',sourcePath:'',startedAt:-1,displayOrder:-1,status:'running',entries:[{kind:'context',text:'original hook context\nsecond line'},{kind:'error',text:'original error'}]};
const samples={
 'hook/started':{threadId,run:hookRun},
 'hook/completed':{threadId,turnId:null,run:{...hookRun,status:'failed',completedAt:null,durationMs:-1,statusMessage:'original failure\nsecond line',source:'project'}},
 'mcpServer/startupStatus/updated':{threadId,name:'owned-server',status:'failed',error:'original failure\nsecond line',failureReason:'reauthenticationRequired'},
 'thread/status/changed':{threadId,status:{type:'active',activeFlags:[]}},
 'thread/name/updated':{threadId,threadName:null},'thread/queue/changed':{threadId},
 'thread/readState/changed':{threadId,readState:{revision:'1',firstUnread:{type:'turn',turnId}}},
 'thread/tokenUsage/updated':{threadId,turnId,tokenUsage:{}},'thread/compacted':{threadId,turnId},
 'thread/goal/updated':{threadId,goal:{},turnId:null},'thread/goal/cleared':{threadId},
 'thread/prediction/updated':{threadId,sourceTurnId:turnId,result:{type:'completed',text:null}},
 'thread/attachment/updated':{threadId,attachmentId:'attachment',attachmentType:'file',identityKey:'identity',operation:'created'},
 'thread/project/updated':{threadId,projectId:null},'thread/settings/updated':{threadId,threadSettings:{}},
 ...Object.fromEntries(['thread/reverted','thread/archived','thread/unarchived','thread/deleted','thread/closed'].map(method=>[method,{threadId}])),
 'turn/started':{threadId,turn:{id:turnId}},'turn/completed':{threadId,turn:{id:turnId}},
 'turn/moderationMetadata':{threadId,turnId,metadata:null},
 'turn/diff/updated':{threadId,turnId,diff:'real diff'},'turn/plan/updated':{threadId,turnId,plan:[],explanation:null},
 'item/started':{threadId,turnId,item:{id:itemId},startedAtMs:1},'item/completed':{threadId,turnId,item:{id:itemId},completedAtMs:2},
 ...Object.fromEntries(['item/agentMessage/delta','item/plan/delta','item/commandExecution/outputDelta','item/fileChange/outputDelta'].map(method=>[method,{threadId,turnId,itemId,delta:'real delta'}])),
 'item/fileChange/patchUpdated':{threadId,turnId,itemId,changes:[]},
 'item/reasoning/summaryTextDelta':{threadId,turnId,itemId,summaryIndex:0,delta:'summary'},
 'item/reasoning/summaryPartAdded':{threadId,turnId,itemId,summaryIndex:0},
 'item/reasoning/textDelta':{threadId,turnId,itemId,contentIndex:0,delta:'reasoning'},
 'serverRequest/resolved':{threadId,requestId:1},
};
test('thread classifications stay aligned with the existing bounded follower table',()=>{
 const source=readFileSync(new URL('../src/shared-thread-authority-channel.cjs',import.meta.url),'utf8');const match=source.match(/const notifications = new Set\(\[([\s\S]*?)\]\);/);assert.ok(match);
 const methods=Array.from(match[1].matchAll(/"([^"]+)"/g),x=>x[1]).sort();
 assert.deepEqual(SHARED_THREAD_NOTIFICATION_METHODS.filter(method=>method!=='thread/started').sort(),methods);assert.deepEqual(Object.keys(samples).sort(),methods);
 for(const [method,params]of Object.entries(samples)){
  const value=classifySharedServerNotification(frame(method,params));assert.ok(value,method);assert.equal(value.threadId,threadId);assert.ok(['thread-metadata','thread-stream'].includes(value.kind));assert.deepEqual(Object.keys(value).sort(),['kind','threadId']);assert.equal(Object.isFrozen(value),true);
  assert.equal(classifySharedServerNotification(frame(method,{...params,extra:true})),null,method);
  assert.equal(classifySharedServerNotification(frame(method,{...params,threadId:'local:client-new-thread:bad'})),null,method);
 }
});
test('goal metadata classification never traverses or retains goal text and has no binding side effect',()=>{
 const goal=new Proxy({},{get(){throw Error('goal body must not be inspected');},ownKeys(){throw Error('goal body must not be enumerated');}});
 const original=frame('thread/goal/updated',{threadId,goal,turnId});const result=classifySharedServerNotification(original);
 assert.deepEqual(result,{kind:'thread-metadata',threadId});assert.equal(JSON.stringify(result).includes('goal'),false);assert.equal(original.params.goal,goal);
 assert.equal(classifySharedServerNotification(frame('thread/goal/updated',{threadId,goal:null})),null);assert.equal(classifySharedServerNotification(frame('thread/goal/updated',{threadId})),null);
});
test('unknown methods, replies, approvals and malformed notification envelopes cannot be classified',()=>{
 const valid=frame('thread/goal/cleared',{threadId});
 for(const value of [null,[],{...valid,id:1},{...valid,jsonrpc:'1.0'},{...valid,extra:true},{...valid,emittedAtMs:-1},{...valid,emittedAtMs:0.5},{...valid,params:[]},{...valid,method:'thread/unknown'},{...valid,method:'item/commandExecution/requestApproval'},{...valid,method:'account/login/completed'}])assert.equal(classifySharedServerNotification(value),null);
 assert.deepEqual(classifySharedServerNotification({...valid,jsonrpc:'2.0'}),{kind:'thread-metadata',threadId});
 for(const [method,params]of Object.entries(samples)){
  for(const required of [...(method==='mcpServer/startupStatus/updated'?[]:['threadId']),...(method==='thread/goal/updated'?['goal']:[])]){const copy={...params};delete copy[required];assert.equal(classifySharedServerNotification(frame(method,copy)),null);}
 }
});
test('stream classification verifies identities and primitive fields without allocating a body projection',()=>{
 const p={threadId,turnId,itemId,delta:'x'.repeat(1024*1024)};assert.deepEqual(classifySharedServerNotification(frame('item/agentMessage/delta',p)),{kind:'thread-stream',threadId});
 for(const params of [{...p,delta:[]},{...p,turnId:null},{...p,itemId:''}])assert.equal(classifySharedServerNotification(frame('item/agentMessage/delta',params)),null);
 assert.equal(classifySharedServerNotification(frame('item/reasoning/summaryTextDelta',{...p,summaryIndex:-1})),null);
 assert.equal(classifySharedServerNotification(frame('thread/status/changed',{threadId,status:{type:'active'}})),null);
 assert.equal(classifySharedServerNotification(frame('thread/status/changed',{threadId,status:{type:'active',activeFlags:['unknown']}})),null);
});
test('account classifications preserve the caller responsibility to revoke or confirm the actual account anchor',()=>{
 assert.deepEqual(classifySharedServerNotification(frame('account/updated',{authMode:'chatgpt',planType:'pro'})),{kind:'account'});
 assert.deepEqual(classifySharedServerNotification(frame('account/rateLimits/updated',{rateLimits:{}})),{kind:'account'});
 assert.equal(classifySharedServerNotification(frame('account/updated',{authMode:'invented'})),null);assert.equal(classifySharedServerNotification(frame('account/updated',{threadId})),null);
 assert.deepEqual(classifySharedServerNotification(frame('thread/started',{thread:{id:threadId,turns:[]}})),{kind:'thread-metadata',threadId});
 assert.equal(classifySharedServerNotification(frame('thread/started',{thread:{id:'bad'}})),null);
});

test('fixed MCP startup metadata preserves every status/error and treats absent or null thread as host metadata only',()=>{
 for(const status of ['starting','ready','failed','cancelled'])for(const thread of [undefined,null,threadId]){
  const params={name:'',status,error:'original private failure\n'+('x'.repeat(8192)),failureReason:'reauthenticationRequired',...(thread===undefined?{}:{threadId:thread})};
  assert.deepEqual(classifySharedServerNotification(frame('mcpServer/startupStatus/updated',params)),thread==null?{kind:'host-metadata'}:{kind:'thread-metadata',threadId});
 }
 for(const params of [{name:'owned',status:'unknown'},{name:'owned',status:'failed',error:{}},{name:'owned',status:'failed',failureReason:'other'},{name:'owned',status:'ready',threadId:'fake-alias'},{name:'owned',status:'ready',extra:true},{status:'ready'},{name:'owned'}])assert.equal(classifySharedServerNotification(frame('mcpServer/startupStatus/updated',params)),null);
 for(const params of [{name:'owned',status:'ready'},{name:'owned',status:'failed',error:null,failureReason:null,threadId:null}])assert.deepEqual(classifySharedServerNotification(frame('mcpServer/startupStatus/updated',params)),{kind:'host-metadata'});
});


test('fixed hook notifications preserve full original runs with exact required fields and native nullable metadata',()=>{
 for(const method of ['hook/started','hook/completed'])for(const status of ['running','completed','failed','blocked','stopped'])for(const turn of [undefined,null,'']){
  const run={...hookRun,status,completedAt:null,durationMs:null,statusMessage:null,source:'unknown'};
  const params={threadId,run,...(turn===undefined?{}:{turnId:turn})},original=frame(method,params);
  assert.deepEqual(classifySharedServerNotification(original),{kind:'thread-metadata',threadId});assert.equal(original.params.run,run);assert.equal(run.entries,hookRun.entries);
 }
 for(const field of Object.keys(hookRun)){
  const run={...hookRun};delete run[field];assert.equal(classifySharedServerNotification(frame('hook/started',{threadId,run})),null,field);
 }
 const mutations=[
  {extra:true},{eventName:'unknown'},{executionMode:'unknown'},{handlerType:'unknown'},{scope:'unknown'},{status:'unknown'},{source:'unknown-source'},
  {id:1},{sourcePath:null},{displayOrder:1.5},{startedAt:NaN},{startedAt:Number.MAX_SAFE_INTEGER+1},{completedAt:'now'},{durationMs:{}},{statusMessage:[]},
  {entries:null},{entries:[{kind:'unknown',text:'unchanged'}]},{entries:[{kind:'warning',text:null}]},{entries:[{kind:'warning',text:'unchanged',extra:true}]},{entries:[{text:'unchanged'}]},
 ];
 for(const change of mutations)assert.equal(classifySharedServerNotification(frame('hook/completed',{threadId,run:{...hookRun,...change}})),null);
 for(const params of [{run:hookRun},{threadId,run:null},{threadId:'not-a-thread',run:hookRun},{threadId,run:hookRun,turnId:1},{threadId,run:hookRun,extra:true}])assert.equal(classifySharedServerNotification(frame('hook/started',params)),null);
 for(const kind of ['warning','stop','feedback','context','error'])assert.deepEqual(classifySharedServerNotification(frame('hook/completed',{threadId,run:{...hookRun,status:'completed',entries:[{kind,text:'original\\n'+('x'.repeat(8192))}]}})),{kind:'thread-metadata',threadId});
 assert.equal(classifySharedServerNotification(frame('hook/unknown',{threadId,run:hookRun})),null);
});


test('fixed moderation metadata preserves original JsonValue without inspecting or retaining its contents',()=>{
 for(const value of [null,false,0,'original metadata',[null,true,{original:'nested'}],{original:['nested',null]}]){
  const original=frame('turn/moderationMetadata',{threadId,turnId,metadata:value});
  assert.deepEqual(classifySharedServerNotification(original),{kind:'thread-stream',threadId});assert.equal(original.params.metadata,value);
 }
 const body=new Proxy({},{get(){throw Error('opaque moderation body must not be read');},ownKeys(){throw Error('opaque moderation body must not be enumerated');}});
 const value=classifySharedServerNotification(frame('turn/moderationMetadata',{threadId,turnId,metadata:body}));
 assert.deepEqual(value,{kind:'thread-stream',threadId});assert.deepEqual(Object.keys(value),['kind','threadId']);
 for(const params of [{threadId,turnId},{threadId,metadata:null},{turnId,metadata:null},{threadId,turnId:null,metadata:null},{threadId:'not-a-UUID',turnId,metadata:null},{threadId,turnId,metadata:null,extra:true}])assert.equal(classifySharedServerNotification(frame('turn/moderationMetadata',params)),null);
 assert.equal(classifySharedServerNotification({...frame('turn/moderationMetadata',{threadId,turnId,metadata:null}),id:1}),null);
 assert.equal(classifySharedServerNotification(frame('turn/moderationMetadata/request',{threadId,turnId,metadata:null})),null);
});
