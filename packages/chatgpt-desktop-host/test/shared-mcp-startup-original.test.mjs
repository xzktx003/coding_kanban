import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {classifySharedServerNotification} from '../src/shared-server-notification-policy.mjs';
const method='mcpServer/startupStatus/updated',threadId='11111111-1111-4111-8111-111111111111';
test('MCP startup keeps every original lifecycle/error state with nullable host and exact thread scope',()=>{
 for(const status of ['starting','ready','failed','cancelled'])for(const scope of [{}, {threadId:null}, {threadId}]){
  const params={name:'owned-test-server',status,error:status==='failed'?'owned failure\nretained':null,failureReason:status==='failed'?'reauthenticationRequired':null,...scope},frame={method,params};
  const result=classifySharedServerNotification(frame);assert.equal(result?.kind,scope.threadId?'thread-metadata':'host-metadata');if(scope.threadId)assert.equal(result.threadId,threadId);assert.equal(params.error,status==='failed'?'owned failure\nretained':null);
 }
 for(const extra of [{status:'complete'},{error:{}},{failureReason:'other'},{threadId:1},{unknown:true}])assert.equal(classifySharedServerNotification({method,params:{name:'owned-test-server',status:'failed',...extra}}),null);
});
const sdkSource=process.env.CHATGPT_MCP_SDK_SOURCE;
test('the pinned original SDK consumes and forwards host/thread MCP failure payloads without erasing error or reason',{skip:!sdkSource&&'Requires fixed original SDK source'},async()=>{
 const source=await readFile(sdkSource,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),'6ea5bdff2450c39e515ea6cb26de4b51aaff8516cb2a8f97268bfb6dc7e804d6');const a=source.indexOf('routeIncomingMessage(e,t,n=e,r=Date.now()){'),b=source.indexOf('isLocalAppServerConnection(){',a);assert.ok(a>=0&&b>a);const body=source.slice(a,b);assert.equal(createHash('sha256').update(body).digest('hex'),'0dc2bfcdc3507b87df604a05d393998d0500c1434eaaec58ebc3f8b9b6c80da4');
 // Only envelope predicates and local SDK services are boundaries. The complete
 // shipped routeIncomingMessage method executes unchanged; no task/RPC exists.
 const own={nf:()=>false,nV:{P9:()=>false},q:{V57:'ssh'},nm:()=>false,ng:v=>!!v&&typeof v.method==='string'&&!Object.hasOwn(v,'id'),nF:p=>typeof p?.threadId==='string'?p.threadId:null,nG:()=>null,rr:new Set([method]),rn:new Set()};
 const methods=new Function(...Object.keys(own),'return ({'+body+'});')(...Object.values(own));
 for(const status of ['starting','ready','failed','cancelled'])for(const id of [undefined,null,threadId]){
  const forwarded=[],logged=[],hostEvents=[],params={name:'owned-test-server',status,error:'owned failure\nretained',failureReason:'reauthenticationRequired',...(id===undefined?{}:{threadId:id})},frame={method,params};
  const connection={...methods,options:{hostConfig:{kind:'local'},hostId:'kanban-shared-cli'},initialized:true,logger:Object.fromEntries(['trace','debug','info','warning'].map(level=>[level,(event,data)=>{if(event==='mcp_server_startup_status_updated')logged.push({level,data})}])),automationTurns:{deferNotification:()=>false},requestUserInputAutoResolution:{observeServerNotification(){}},userVerification:{observeNotification(){}},notifyInternalNotificationHandlers(){},hostEventHandler:{onNotification:(value)=>hostEvents.push(value)},ephemeralThreadIds:new Set([threadId]),fullFidelityEphemeralThreadIds:new Set(),subagentThreadIds:new Set(),streamTracing:{takeNotificationDelivery:()=>undefined},messageDelivery:{broadcastToWindows:value=>forwarded.push(value)}};
  const result=connection.routeIncomingMessage(frame);assert.equal(result.routeKind,'notification');assert.equal(forwarded.length,1);assert.equal(forwarded[0].params,params);assert.equal(hostEvents[0],frame);assert.equal(logged[0].level,status==='failed'?'warning':'info');assert.equal(logged[0].data.sensitive.error,params.error);assert.equal(logged[0].data.safe.failureReason,'reauthenticationRequired');
 }
});
