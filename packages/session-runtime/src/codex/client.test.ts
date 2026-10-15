import assert from "node:assert/strict";
import { test } from "node:test";
import { EventHub } from "../core/events.js";
import { object } from "../core/json.js";
import { CodexService, supportsParentOnlyRelease } from "./client.js";

test("parent-only release capability is selected only by an exact verified native handshake version", () => {
  assert.equal(supportsParentOnlyRelease("codexia/0.162.1 (Ubuntu 24.4.0; x86_64) unknown (codexia; 0.1.0)"), true);
  assert.equal(supportsParentOnlyRelease("codexia/0.162.0-alpha.17.2 (Ubuntu 24.4.0; x86_64) unknown (codexia; 0.1.0)"), true);
  for (const userAgent of [null, undefined, {}, "fixture", "codexia/0.162.2 (Linux)", "codexia/0.162.1-untested (Linux)",
    "codexia/0.162.10 (Linux)", "codexia/0.162.1spoof (Linux)", "other/0.162.1 (Linux)", "other codexia/0.162.1 (Linux)",
    "codexia/0.162.1+unknown (Linux)", "codexia/0.162.1/other (Linux)"])
    assert.equal(supportsParentOnlyRelease(userAgent), false, String(userAgent));
});

const releaseSource = String.raw`
const readline = require('node:readline');
const userAgent = process.argv[1];
const unsubscribed = [];
let loaded = false;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
 const message = JSON.parse(line), params = message.params || {};
 let result;
 if(message.method === 'initialize') result = { userAgent };
 else if(message.method === 'initialized') return;
 else if(message.method === 'thread/start') { loaded = true; result = { thread: { id: 't' } }; }
 else if(message.method === 'thread/read') result = { thread: {
   id: params.threadId, source: params.threadId === 't' ? 'cli' : { subAgent: { thread_spawn: { parent_thread_id: 't' } } },
   ...(params.threadId === 't' ? {} : { parentThreadId: 't', canAcceptDirectInput: false }), status: { type: 'idle' },
 }};
 else if(message.method === 'thread/loaded/list') result = { data: loaded ? ['t', 'child'] : [], nextCursor: null };
 else if(message.method === 'thread/backgroundTerminals/list') result = { data: [], nextCursor: null };
 else if(message.method === 'thread/goal/get') result = { goal: null };
 else if(message.method === 'turn/start') result = { turn: { id: 'turn' } };
 else if(message.method === 'thread/unsubscribe') { unsubscribed.push(params.threadId); result = { status: 'unsubscribed' }; }
 else if(message.method === 'model/list') result = { unsubscribed };
 else { send({ id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
 send({ id: message.id, result });
});`;

test("the service selects descendant release from its own native initialize handshake and never unsubscribes a child", async t => {
  for (const [userAgent, supported] of [["codexia/0.162.1 (Linux)", true], ["codexia/0.162.0-alpha.17.2 (Linux)", true],
    ["codexia/0.162.2 (Linux)", false], ["other/0.162.1 (Linux)", false]] as const) {
    const hub = new EventHub();
    const service = new CodexService({ hub, instance: `release-${supported}`, launch: { command: process.execPath, args: ["-e", releaseSource, userAgent] }, sweepIntervalMs: 0 });
    t.after(async () => { await service.close(); hub.close(); });
    await service.call("thread/start", {});
    await assert.rejects(service.raw("thread/unsubscribe", { threadId: "t" }, { beforeSend: () => {
      throw new Error("NOT_SENT: synthetic dispatch guard changed");
    } }), /NOT_SENT: synthetic dispatch guard changed/);
    await service.call("turn/start", { threadId: "t", input: [] });
    service.ownership.queueUpdate(1n, false, []);
    const access = await service.ownership.release("t");
    assert.equal(access.state, supported ? "releasing" : "owned", userAgent);
    await service.ownership.release("child");
    const calls = object(await service.raw("model/list", {}));
    assert.deepEqual(calls.unsubscribed, supported ? ["t"] : [], userAgent);
    await service.close(); hub.close();
  }
});

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
