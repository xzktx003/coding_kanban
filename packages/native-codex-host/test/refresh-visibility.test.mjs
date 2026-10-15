import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createVisibleLeaseController} from "../refresh-prototype/visibility-leases.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t,options={}) {
  const calls=[], consumers=new Map();
  let ready=true, scopeHook=async()=>{};
  const manager={
    onInvalidated:()=>()=>{},
    snapshot:()=>({ready,authorizationBound:ready}),
    async scopeForThread(threadId){await scopeHook(threadId);return {domain:randomUUID(),generation:randomUUID(),threadId,cwd:"/private/native/project"}},
    async open(key,{consumerId}){const ids=consumers.get(consumerId)??new Set();ids.add(key.threadId);consumers.set(consumerId,ids);calls.push({type:"open",threadId:key.threadId});return {warm:true}},
    async disconnect(id){consumers.delete(id);calls.push({type:"disconnect"})},
  };
  const controller=createVisibleLeaseController({manager,profileId:randomUUID(),leaseGraceMs:30,...options});
  t.after(()=>controller.close());
  const identity={origin:"https://lan.example:8484",instanceId:randomUUID()};
  return {controller,manager,calls,consumers,identity,setReady:v=>ready=v,setScopeHook:v=>scopeHook=v,
    attach:(resume={},hooks={})=>controller.attach({...identity,...resume},{assertCurrent:async()=>{},...hooks})};
}
test("a refresh reconnect reuses one visible lease, fences its old connection and has no idle-thread TTL",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const f=fixture(t),id=randomUUID();let replaced=0;
  const a=await f.attach({}, {onReplaced:()=>replaced++});
  await a.update({sequence:1,threadIds:[id]});
  const firstConsumer=[...f.consumers.keys()][0];a.disconnect();
  t.mock.timers.tick(5);assert.equal(f.consumers.size,1);
  const b=await f.attach(a.identity);
  await b.update({sequence:1,threadIds:[id]});
  assert.equal(f.consumers.size,1);assert.ok(f.consumers.has(firstConsumer));
  await assert.rejects(a.update({sequence:2,threadIds:[]}),/superseded/);
  t.mock.timers.tick(45);assert.equal(f.consumers.size,1);
  b.disconnect();t.mock.timers.tick(60);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.consumers.size,0);
  assert.equal(f.calls.filter(x=>x.type==="open").length,1);
  assert.equal(f.controller.snapshot().leases,0);
});
test("reconnection fences a delayed scope lookup before it can create or clear a new visible consumer",async t=>{
  const f=fixture(t),a=await f.attach();let release,entered;
  const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  f.setScopeHook(async()=>{entered();await held});
  const update=a.update({sequence:1,threadIds:[randomUUID()]});const rejected=assert.rejects(update,/superseded/);await started;
  const b=await f.attach(a.identity);f.setScopeHook(async()=>{});release();await rejected;
  const id=randomUUID();await b.update({sequence:1,threadIds:[id]});
  assert.deepEqual([...f.consumers.values()].map(s=>[...s]),[[id]]);
});
test("leases bind exact origin and native instance; wrong tokens and unknown fields fail without touching a consumer",async t=>{
  const f=fixture(t),a=await f.attach();await a.update({sequence:1,threadIds:[randomUUID()]});
  for(const extra of [{token:"0".repeat(64)},{origin:"https://other.example"},{instanceId:randomUUID()},{cwd:"/browser/supplied"}])
    await assert.rejects(f.attach({...a.identity,...extra}));
  assert.equal(f.consumers.size,1);
  assert.equal(JSON.stringify(f.controller.snapshot()).includes(a.identity.token),false);
  assert.equal(JSON.stringify(f.controller.snapshot()).includes("native/project"),false);
});
test("bounded updates preserve the previous visible set on unknown native state and reject stale sequences",async t=>{
  const f=fixture(t),a=await f.attach(),id=randomUUID();await a.update({sequence:1,threadIds:[id]});
  await assert.rejects(a.update({sequence:1,threadIds:[]}),/sequence/);
  await assert.rejects(a.update({sequence:2,threadIds:Array.from({length:65},()=>randomUUID())}),/visible/);
  f.setScopeHook(async()=>{throw Error("native unavailable")});
  await assert.rejects(a.update({sequence:2,threadIds:[randomUUID()]}),/native unavailable/);
  assert.deepEqual([...f.consumers.values()].map(s=>[...s]),[[id]]);
  f.setScopeHook(async()=>{});await a.update({sequence:3,threadIds:[]});assert.equal(f.consumers.size,0);
});
test("bounded leases and authorization failure never stop the manager or accept new visibility",async t=>{
  const f=fixture(t,{maxLeases:1}),a=await f.attach();
  await assert.rejects(f.attach(),/budget/);f.setReady(false);
  await assert.rejects(a.update({sequence:1,threadIds:[randomUUID()]}),/unavailable/);
  assert.equal(f.calls.length,0);
});
