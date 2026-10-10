import assert from "node:assert/strict";
import { test } from "node:test";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService } from "./client.js";

const source = String.raw`
const readline = require('node:readline');
let initialized=false, count=0, loaded=false;
const send = v => process.stdout.write(JSON.stringify(v)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize'){ count++;send({id:m.id,result:{userAgent:'fixture',count}});return; }
 if(m.method==='initialized'){initialized=true;return;}
 if(m.id==='approval' && m.result){ send({method:'serverRequest/resolved',params:{threadId:'t',requestId:'approval'}});return; }
 if(m.method==='thread/start'){loaded=true;send({id:m.id,result:{thread:{id:'t'}}});return;}
 if(m.method==='thread/read'){send({id:m.id,result:{thread:{id:'t',source:'cli',historyMode:'legacy',status:{type:'idle'},turns:[]}}});return;}
 if(m.method==='thread/loaded/list'){send({id:m.id,result:{data:loaded?['t']:[],nextCursor:null}});return;}
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'turn'}}});
  send({method:'item/reasoning/textDelta',params:{threadId:'t',delta:'RAW_PRIVATE'}});
  send({method:'rawResponseItem/completed',params:{item:{type:'reasoning',content:['RAW_PRIVATE']}}});
  send({method:'item/reasoning/summaryTextDelta',params:{threadId:'t',delta:'Public summary'}});
  send({method:'item/completed',params:{threadId:'t',item:{id:'r',type:'reasoning',summary:['Public'],content:['RAW_PRIVATE']}}});
  send({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'t',turnId:'turn',itemId:'item',command:'test'}});return;
 }
 if(m.method==='model/list'){send({id:m.id,result:{data:[],initialized,count}});return;}
 if(m.method==='thread/rollback'){setTimeout(()=>send({id:m.id,result:{thread:{id:'t',turns:[]}}}),50);return;}
 send({id:m.id,error:{code:-32601,message:'Method not found'}});
});`;

test("one native process initializes once, emits public summaries and answers only live approval identity", async t => {
  const hub = new EventHub();
  const service = new CodexService({ hub, instance: "test", launch: { command: process.execPath, args: ["-e", source] }, sweepIntervalMs: 0 });
  t.after(async () => { await service.close(); hub.close(); });
  const models = await Promise.all([service.call("model/list", {}), service.call("model/list", {})]);
  for (const model of models) assert.deepEqual(model, { data: [], initialized: true, count: 1 });
  await service.call("thread/start", {});
  await service.call("turn/start", { threadId: "t", input: [] });
  // A following RPC flushes notifications emitted after the turn acknowledgement.
  await service.call("model/list", {});
  const sub = hub.subscribe({ since: 0, snapshots: true });
  assert.doesNotMatch(JSON.stringify(sub.backlog), /RAW_PRIVATE/);
  assert.match(JSON.stringify(sub.backlog), /Public summary/);
  const approval = sub.backlog.find(e => e.event === "codex/approval-request")!;
  assert.equal(approval.payload.requestId, "approval");
  assert.equal(typeof approval.payload.requestToken, "string");
  await assert.rejects(service.respond("commandExecution", { request_id: "approval", request: { ...approval.payload, threadId: "other" }, decision: "accept" }), /SESSION_RPC_EXPIRED/);
  await service.respond("commandExecution", { request_id: "approval", request: approval.payload, decision: "accept" });
  await assert.rejects(service.respond("commandExecution", { request_id: "approval", request: approval.payload, decision: "accept" }), /SESSION_RPC_EXPIRED/);
  await service.call("model/list", {});
  assert.equal(hub.pendingCount, 0);
  sub.close();
});

test("concurrent same-boundary rollback is coalesced and conflicting boundaries are rejected", async t => {
  const hub = new EventHub();
  const service = new CodexService({ hub, instance: "test", launch: { command: process.execPath, args: ["-e", source] }, sweepIntervalMs: 0 });
  t.after(async () => { await service.close(); hub.close(); });
  await service.call("thread/start", {});
  const params = { threadId: "t", numTurns: 1, beforeTurnId: "x" };
  const one = service.rollback(params), two = service.rollback(params);
  assert.equal(one, two);
  await assert.rejects(service.rollback({ ...params, beforeTurnId: "y" }), /SESSION_ROLLBACK_PENDING/);
  assert.equal(object(object(await one).thread).id, "t");
});
