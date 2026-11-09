import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreLedger, createCoreSendGate, createCoreOwnedTurnGate, CORE_EXPECTED_REPLY, CORE_PROMPT } from './chatgpt-desktop-account-core-ledger.mjs';
import { encodeWireValue, decodeWireValue } from '../../packages/chatgpt-desktop-host/src/wire-value.mjs';

const directory = '/owned/private/home/fixture-project';
const request = (id, method, params) => ({type:'mcp-request',hostId:'local',request:{id,method,params}});
const response = (id, result) => ({type:'mcp-response',hostId:'local',message:{id,result}});
const event = (method, params) => ({type:'mcp-notification',hostId:'local',message:{method,params}});
const valid = () => ({fixtureOwned:true,projectSelected:true,oneComposer:true,draftExact:true,buttonUnique:true,buttonEnabled:true,activityIdle:true,noObservedStarts:true,nativeCoverageConfirmed:true});

test('an isolated target permits each authorized GUI send once and follow-up only after original completion and same target',()=>{
 const gate=createCoreOwnedTurnGate(),first={fixtureOwned:true,projectSelected:true,oneComposer:true,draftExact:true,buttonUnique:true,buttonEnabled:true,sameView:true};
 assert.equal(gate.beginFirst({...first,sameView:false}),false);assert.equal(gate.beginFirst(first),true);assert.equal(gate.beginFirst(first),false);
 assert.equal(gate.beginFollowup({...first,firstSettled:true,sameThread:true}),false);assert.equal(gate.confirmFirst({createdTarget:true,uiReply:true,composerCleared:true,idle:true}),true);
 assert.equal(gate.beginFollowup({...first,firstSettled:true,sameThread:false}),false);assert.equal(gate.beginFollowup({...first,firstSettled:true,sameThread:true}),true);assert.equal(gate.beginFollowup({...first,firstSettled:true,sameThread:true}),false);
});

test('browser-visible MCP projection cannot establish complete native request coverage',()=>{
 const l=createCoreLedger({projectPath:directory}),snapshot=l.snapshot();assert.equal(snapshot.coverage,'browser-visible-mcp-only');assert.equal(snapshot.nativeCoverage,false);assert.equal(snapshot.threadStartRequests,0);assert.equal(snapshot.turnStartRequests,0);
 const gate=createCoreSendGate();assert.equal(gate.begin({...valid(),nativeCoverageConfirmed:snapshot.nativeCoverage}),false);assert.equal(gate.snapshot().attempted,false);
});

test('the explicit send gate consumes one attempt and never retries unknown outcomes', () => {
  const gate=createCoreSendGate();
  assert.equal(gate.begin({...valid(),projectSelected:false}),false);
  assert.equal(gate.begin(valid()),true); assert.equal(gate.begin(valid()),false);
  assert.deepEqual(gate.snapshot(),{attempted:true});
});

test('correlates one owned thread and turn with the exact response while retaining no IDs or message text', () => {
  const l=createCoreLedger({projectPath:directory});
  l.observe('sent',request('thread-id','thread/start',{cwd:directory}));
  l.observe('received',response('thread-id',{thread:{id:'private-thread'},cwd:directory,sandbox:{type:'readOnly'}}));
  l.observe('sent',request('turn-id','turn/start',{threadId:'private-thread',input:[{type:'text',text:CORE_PROMPT}]}));
  l.observe('received',response('turn-id',{turn:{id:'private-turn',status:'inProgress'}}));
  l.observe('received',event('item/completed',{threadId:'private-thread',turnId:'private-turn',item:{type:'agentMessage',text:CORE_EXPECTED_REPLY}}));
  l.observe('received',event('turn/completed',{threadId:'private-thread',turn:{id:'private-turn',status:'completed'}}));
  const s=l.snapshot();assert.equal(s.reliable,true);assert.equal(s.threadStartRequests,1);assert.equal(s.threadReceiptMatchesProject,true);
  assert.equal(s.turnStartRequests,1);assert.equal(s.turnMatchesThread,true);assert.equal(s.promptMatches,true);
  assert.equal(s.completionMatchesTurn,true);assert.equal(s.completionStatus,'completed');assert.equal(s.expectedReplySeen,true);
  assert.equal(s.observedToolItems,0);assert.equal(s.sandbox,'readOnly');
  assert.doesNotMatch(JSON.stringify(s),/private-thread|private-turn|thread-id|turn-id|fixture-project|DESKTOP_PROBE_OK/);
});

test('reports the native resolved model and actual turn model and permission fields without prompt text',()=>{
 const l=createCoreLedger({projectPath:directory});l.observe('sent',request('t','thread/start',{cwd:directory}));l.observe('received',response('t',{thread:{id:'private-thread'},cwd:directory,model:'fixture-default-model'}));
 l.observe('sent',request('u','turn/start',{threadId:'private-thread',model:'fixture-default-model',approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly'},input:[{type:'text',text:CORE_PROMPT}]}));
 const s=l.snapshot();assert.equal(s.threadResolvedModel,'fixture-default-model');assert.equal(s.turnModel,'fixture-default-model');assert.equal(s.turnApprovalPolicy,'on-request');assert.equal(s.turnSandboxPolicy,'readOnly');assert.doesNotMatch(JSON.stringify(s),/private-thread|DESKTOP_PROBE_OK/);
});

test('foreign hosts, other projects and other turns cannot satisfy the fixed target', () => {
  const l=createCoreLedger({projectPath:directory});
  l.observe('sent',{type:'mcp-request',hostId:'remote',request:{id:'x',method:'thread/start',params:{cwd:directory}}});
  l.observe('sent',request('t','thread/start',{cwd:'/other'}));
  l.observe('received',response('t',{thread:{id:'one'},cwd:'/other'}));
  l.observe('sent',request('v','turn/start',{threadId:'other',input:[{type:'text',text:CORE_PROMPT}]}));
  l.observe('received',response('v',{turn:{id:'turn'}}));
  l.observe('received',event('turn/completed',{threadId:'one',turn:{id:'turn',status:'completed'}}));
  const s=l.snapshot();assert.equal(s.threadStartRequests,1);assert.equal(s.threadReceiptMatchesProject,false);
  assert.equal(s.turnMatchesThread,false);assert.equal(s.completionMatchesTurn,false);
});

test('observed tool items, duplicate sends and unobserved frames do not produce a false clean result', () => {
  const l=createCoreLedger({projectPath:directory});
  l.observe('sent',request(1,'thread/start',{cwd:directory})); l.observe('received',response(1,{thread:{id:'t'},cwd:directory}));
  l.observe('sent',request(2,'turn/start',{threadId:'t',input:[{type:'text',text:CORE_PROMPT}]}));
  l.observe('received',response(2,{turn:{id:'u'}}));
  l.observe('received',event('item/started',{threadId:'t',turnId:'u',item:{type:'commandExecution',command:'secret'}}));
  l.observe('sent',request(3,'turn/start',{threadId:'t',input:[{type:'text',text:CORE_PROMPT}]}));
  let s=l.snapshot();assert.equal(s.turnStartRequests,2);assert.equal(s.observedToolItems,1);
  assert.doesNotMatch(JSON.stringify(s),/secret/);
  l.gap();s=l.snapshot();assert.equal(s.reliable,false);assert.equal(s.observedToolItems,null);
});

test('events arriving before a turn receipt remain bounded and are correlated once the receipt arrives', () => {
  const l=createCoreLedger({projectPath:directory});
  l.observe('sent',request(1,'thread/start',{cwd:directory})); l.observe('received',response(1,{thread:{id:'t'},cwd:directory}));
  l.observe('sent',request(2,'turn/start',{threadId:'t',input:[{type:'text',text:CORE_PROMPT}]}));
  l.observe('received',event('item/started',{threadId:'t',turnId:'u',item:{type:'commandExecution',command:'not logged'}}));
  l.observe('received',event('turn/completed',{threadId:'t',turn:{id:'u',status:'completed'}}));
  l.observe('received',response(2,{turn:{id:'u'}}));
  const s=l.snapshot();assert.equal(s.observedToolItems,1);assert.equal(s.completionMatchesTurn,true);
  assert.doesNotMatch(JSON.stringify(s),/not logged/);
});

test('a late thread receipt settles earlier matching events without permitting another send',()=>{
 const gate=createCoreSendGate(),l=createCoreLedger({projectPath:directory});assert.equal(gate.begin(valid()),true);
 l.observe('sent',request(1,'thread/start',{cwd:directory}));
 l.observe('sent',request(2,'turn/start',{threadId:'t',input:[{type:'text',text:CORE_PROMPT}]}));
 l.observe('received',response(2,{turn:{id:'u'}}));
 l.observe('received',event('turn/completed',{threadId:'t',turn:{id:'u',status:'completed'}}));
 assert.equal(l.snapshot().completionMatchesTurn,false);assert.equal(gate.begin(valid()),false);
 l.observe('received',response(1,{thread:{id:'t'},cwd:directory}));
 assert.equal(l.snapshot().completionMatchesTurn,true);assert.equal(gate.begin(valid()),false);
});

test('finds a local native request and response through the real structured wire envelope', () => {
  const l=createCoreLedger({projectPath:directory});
  const encoded = x => decodeWireValue(encodeWireValue(x));
  l.observe('sent',encoded({type:'call',method:'sendMessageFromView',args:[request(7,'thread/start',{cwd:directory})]}));
  l.observe('received',encoded({type:'viewMessage',message:response(7,{thread:{id:'owned'},cwd:directory})}));
  const s=l.snapshot();assert.equal(s.threadStartRequests,1);assert.equal(s.threadStartReceipts,1);assert.equal(s.threadReceiptMatchesProject,true);
});

test('an over-budget frame makes activity coverage unknown without exposing contents', () => {
  const l=createCoreLedger({projectPath:directory,maxNodes:2});
  l.observe('received',{value:{value:{value:'private'}}});
  const s=l.snapshot();assert.equal(s.reliable,false);assert.equal(s.observedToolItems,null);assert.doesNotMatch(JSON.stringify(s),/private/);
});
