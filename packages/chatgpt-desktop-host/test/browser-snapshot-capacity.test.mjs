import test from 'node:test';
import assert from 'node:assert/strict';
import { installDesktopBridge } from '../src/browser-bridge.mjs';
import { encodeWireValue, decodeWireValue } from '../src/wire-value.mjs';

const scope = Object.freeze({profileId:'43e56e8a-de3f-40fb-8cf3-7177d17d24f1',generation:'b94128f4-288c-4c97-a5cb-891555dc8199',viewId:'9d79066f-f08f-4f00-a75e-e24cc65e5d00'});
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const events = new Map(), listeners = new Set(), sent = [], ports = [];
  let sequence = 0, failure, diagnostic, closeCount = 0;
  const win = {
    performance:{timeOrigin:1},
    addEventListener(type, handler) { events.set(type, handler); },
    removeEventListener(type) { events.delete(type); },
  };
  const bridge = installDesktopBridge({...options,window:win,scope,bootstrap:{windowType:'electron',getters:{},sharedObjects:{}},transport:{
    async send(encoded) { const frame=decodeWireValue(encoded);sent.push(frame);await options.sendGate?.(frame); },
    subscribe(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    close() { closeCount++; },
  },onFailure(reason, detail) { failure = reason; diagnostic = detail; }});
  t.after(() => bridge.dispose());
  const input = frame => {
    let result;
    for (const handler of listeners) result = handler(encodeWireValue({v:1,scope,seq:++sequence,...frame}));
    return result;
  };
  const connect = () => {
    const handlers = new Map(), delivered = [];
    let closed = false;
    const port = {addEventListener(type, callback) { handlers.set(type, callback); },start() {},postMessage(data) { delivered.push(data); },close() { closed=true; }};
    events.get('message')({source:win,data:{type:'connect-app-host',port}});
    const result = {emit(data) { handlers.get('message')({data}); },delivered,get closed() { return closed; }};
    ports.push(result); return result;
  };
  const first = connect();
  return {win,bridge,sent,listeners,input,connect,port:first,get failure() { return failure; },get diagnostic() { return diagnostic; },get closeCount() { return closeCount; }};
}
async function ready(f) {
  await turn();
  const open = f.sent.find(frame => frame.type === 'openPort');
  assert.ok(open);f.input({type:'return',id:open.id,value:undefined});await turn();
}
function rop(n) {
  const ref = 'fixture-ref-' + Math.floor(n / 4);
  switch (n % 4) {
    case 0: return ['push',['pipeline',ref,['fixtureService','subscribe'],[]]];
    case 1: return ['pull',ref];
    case 2: return ['release',ref,1];
    default: return ['resolve',ref,['value',n]];
  }
}

test('800 original ROP-shaped snapshots wait locally and drain exactly once with only 32 port writes in flight', async t => {
  const f = fixture(t);await ready(f);
  const expected = Array.from({length:800},(_,n)=>rop(n));
  for (const frame of expected) f.port.emit(frame);
  await turn();
  assert.equal(f.failure,undefined,'a normal desktop-sized local burst must not exhaust the old 264-snapshot pool');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,32);
  const held=f.bridge.getResourceUsage();assert.equal(held.rawSnapshots,800);assert.equal(held.peakRawSnapshots,800);assert.equal(held.inFlightPortPosts,32);assert.equal(held.peakInFlightPortPosts,32);assert.ok(held.heldLogicalBytes>0&&held.peakHeldLogicalBytes<=8*1024*1024);
  assert.equal(f.win.electronBridge.getResourceUsage,undefined,'only the own bridge handle exposes numeric accounting');assert.ok(Object.isFrozen(held));
  assert.ok(Object.values(held).every(value=>typeof value==='number'||typeof value==='boolean'));
  const ordinary = f.win.electronBridge.sendMessageFromView({kind:'fixture-ordinary'});
  await turn();const call = f.sent.find(frame=>frame.type==='call');assert.ok(call,'local snapshots must leave ordinary RPC capacity');
  f.input({type:'return',id:call.id,value:undefined});await ordinary;
  const acknowledged = new Set();
  while (acknowledged.size < expected.length) {
    const active = f.sent.filter(frame=>frame.type==='portPost'&&!acknowledged.has(frame.id));
    assert.ok(active.length>0&&active.length<=32,'each legal receipt batch must retain the original port concurrency');
    for (const frame of active) { acknowledged.add(frame.id);f.input({type:'return',id:frame.id,value:undefined}); }
    await turn();
  }
  const posted = f.sent.filter(frame=>frame.type==='portPost');
  assert.deepEqual(posted.map(frame=>frame.data),expected);
  assert.deepEqual(f.sent.map(frame=>frame.seq),Array.from({length:f.sent.length},(_,n)=>n+1));
  assert.equal(new Set(posted.map(frame=>frame.id)).size,800);
  assert.equal(f.failure,undefined);
  const drained=f.bridge.getResourceUsage();assert.equal(drained.rawSnapshots,0);assert.equal(drained.heldLogicalBytes,0);assert.equal(drained.pendingRPC,0);assert.equal(drained.waitingRPC,0);assert.equal(drained.portProduced,800);assert.equal(drained.peakRawSnapshots,800);
});

test('1024 retained snapshots include in-flight writes and the 1025th fails without another native send', async t => {
  const f = fixture(t);await ready(f);
  for (let n=0;n<1024;n++) f.port.emit(rop(n));
  await turn();assert.equal(f.failure,undefined);assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,32);
  f.port.emit(rop(1024));
  assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'waiting_count');
  assert.equal(f.diagnostic.portPostsInFlight,32);assert.equal(f.diagnostic.waitingPortPosts,992);
  assert.equal(f.listeners.size,0);assert.equal(f.closeCount,1);assert.equal(f.port.closed,true);
  const before=f.sent.length;f.input({type:'return',id:f.sent.find(frame=>frame.type==='portPost').id,value:undefined});f.port.emit(rop(1025));await turn();
  assert.equal(f.sent.length,before,'closing must not retry, replay or send a rejected snapshot');
  const closed=f.bridge.getResourceUsage();assert.equal(closed.disposed,true);assert.equal(closed.rawSnapshots,0);assert.equal(closed.heldLogicalBytes,0);assert.equal(closed.peakRawSnapshots,1024);
});

test('large snapshot backlog does not consume the original 256 encoded RPC waiting reservations or enlarge 64 active requests', async t => {
  const f=fixture(t);await ready(f);for(let n=0;n<800;n++)f.port.emit(rop(n));await turn();assert.equal(f.failure,undefined);
  const active=Array.from({length:32},(_,n)=>f.win.electronBridge.sendMessageFromView({active:n}).catch(e=>e));await turn();
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,32);assert.equal(f.sent.filter(frame=>frame.type==='call').length,32);
  const waiting=Array.from({length:256},(_,n)=>f.win.electronBridge.sendMessageFromView({waiting:n}).catch(e=>e));await turn();
  assert.equal(f.failure,undefined,'raw snapshots and encoded RPC waiters have distinct count ceilings');
  assert.equal(f.sent.filter(frame=>frame.type!=='openPort').length,64);
  await assert.rejects(f.win.electronBridge.sendMessageFromView({overflow:true}),{code:'BRIDGE_PENDING_LIMIT'});
  assert.equal(f.diagnostic.pendingTotal,64);assert.equal(f.diagnostic.waitingRequests,256);
  assert.ok((await Promise.all([...active,...waiting])).every(e=>e.code==='BRIDGE_PENDING_LIMIT'));
  assert.equal(f.sent.filter(frame=>frame.type!=='openPort').length,64);
});

test('the unchanged eight MiB byte ceiling rejects four two-MiB snapshots before the new count limit', async t => {
  const f=fixture(t);await turn();
  const body='b'.repeat(2*1024*1024);
  for(let n=0;n<3;n++)f.port.emit({n,body});assert.equal(f.failure,undefined);
  f.port.emit({n:3,body});assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'snapshot_bytes');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,0,'an unopened port never obtains native write authority');
});

test('eight deferred native data frames remain the output ceiling while local input has spare capacity', async t => {
  const f=fixture(t);await ready(f);for(let n=0;n<48;n++)f.port.emit(rop(n));await turn();
  const deferred=[];for(let n=0;n<8;n++)deferred.push(Promise.resolve(f.input({type:'portMessage',portId:'app-host-1',data:n})).catch(e=>e));
  assert.equal(f.failure,undefined);f.input({type:'portMessage',portId:'app-host-1',data:8});
  assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'native_output_count');assert.equal(f.diagnostic.nativeDeferred,8);
  assert.ok((await Promise.all(deferred)).every(e=>e.code==='BRIDGE_QUEUE_FULL'));
});

test('a target change closes the document and its entire unsent burst without replay', async t => {
  const f=fixture(t);await ready(f);for(let n=0;n<800;n++)f.port.emit(rop(n));await turn();assert.equal(f.failure,undefined);
  const before=f.sent.length;f.input({type:'theme',value:'dark',scope:{...scope,generation:'00000000-0000-0000-0000-000000000000'}});
  assert.equal(f.failure?.code,'BRIDGE_SCOPE_CHANGED');assert.equal(f.listeners.size,0);assert.equal(f.port.closed,true);
  f.port.emit(rop(801));await turn();assert.equal(f.sent.length,before);
});

test('a closed source port releases its waiting snapshot bytes for another still-current port', async t => {
  const f=fixture(t,{maxQueuedBytes:200000});await ready(f);for(let n=0;n<800;n++)f.port.emit({n,body:'x'});await turn();assert.equal(f.failure,undefined);
  const second=f.connect();await turn();const open=f.sent.filter(frame=>frame.type==='openPort').at(-1);f.input({type:'return',id:open.id,value:undefined});await turn();
  f.input({type:'portClosed',portId:'app-host-1'});await turn();assert.equal(f.failure,undefined);assert.equal(f.port.closed,true);
  const released=f.bridge.getResourceUsage();assert.equal(released.rawSnapshots,32);assert.ok(released.heldLogicalBytes<10000,'only already dispatched snapshots remain charged');
  second.emit({body:'y'.repeat(120000)});await turn();assert.equal(f.failure,undefined,'released waiting snapshots cannot keep their byte reservation');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost'&&frame.portId==='app-host-2').length,0,'the existing 32-write window stays occupied until a real receipt');
  f.input({type:'return',id:f.sent.find(frame=>frame.type==='portPost').id,value:undefined});await turn();
  assert.equal(f.sent.filter(frame=>frame.type==='portPost'&&frame.portId==='app-host-2').length,1);
  assert.equal(f.sent.filter(frame=>frame.type==='portPost'&&frame.portId==='app-host-1').length,32,'closed unsent suffix is discarded without a sequence gap');
});

test('the original default native receipt timeout still closes a large local burst with unknown outcome', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);await ready(f);for(let n=0;n<800;n++)f.port.emit(rop(n));await turn();assert.equal(f.failure,undefined);
  const before=f.sent.length;t.mock.timers.tick(10000);await turn();assert.equal(f.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');assert.equal(f.failure?.causeKind,'request_timeout');
  assert.equal(f.listeners.size,0);f.port.emit(rop(801));await turn();assert.equal(f.sent.length,before);
});


test('an unopened port keeps the original ten-second open receipt timeout over its entire raw backlog', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);await turn();for(let n=0;n<1024;n++)f.port.emit(rop(n));await turn();assert.equal(f.failure,undefined);
  assert.equal(f.bridge.getResourceUsage().rawSnapshots,1024);assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'openPort');
  t.mock.timers.tick(10000);await turn();assert.equal(f.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');assert.equal(f.failure?.causeKind,'request_timeout');
  assert.equal(f.bridge.getResourceUsage().rawSnapshots,0);assert.equal(f.bridge.getResourceUsage().heldLogicalBytes,0);assert.equal(f.listeners.size,0);assert.equal(f.sent.length,1);
});


test('a full encoded waiting pool holds new raw snapshots locally until real RPC capacity returns', async t => {
  const f=fixture(t,{maxPending:1});await ready(f);
  const active=f.win.electronBridge.sendMessageFromView({active:true}).catch(e=>e);await turn();
  const waiters=Array.from({length:256},(_,n)=>f.win.electronBridge.sendMessageFromView({n}).catch(e=>e));await turn();
  for(let n=0;n<800;n++)f.port.emit(rop(n));await turn();assert.equal(f.failure,undefined,'raw admission must not fail by trying to promote into a full encoded pool');
  const held=f.bridge.getResourceUsage();assert.equal(held.rawSnapshots,800);assert.equal(held.waitingRPC,256);assert.equal(held.inFlightPortPosts,0);
  const seen=new Set();while(seen.size<257){const next=f.sent.find(frame=>frame.type==='call'&&!seen.has(frame.id));assert.ok(next);seen.add(next.id);f.input({type:'return',id:next.id,value:undefined});await turn();assert.equal(f.failure,undefined);}
  assert.ok((await Promise.all([active,...waiters])).every(value=>value===undefined));
  const port=f.sent.find(frame=>frame.type==='portPost');assert.ok(port);assert.equal(f.sent.filter(frame=>frame.type==='call').length,257);
  assert.equal(f.bridge.getResourceUsage().peakWaitingRPC,256);assert.equal(f.bridge.getResourceUsage().peakPendingRPC,1);
});


test('64 active and 256 waiting ordinary RPCs release 800 raw snapshots without another port producer event', async t => {
  let releaseLast;const sendGate=new Promise(resolve=>{releaseLast=resolve;});
  const f=fixture(t,{sendGate:frame=>frame.type==='call'&&frame.args[0].active===63?sendGate:undefined});await ready(f);
  const calls=Array.from({length:64},(_,n)=>f.win.electronBridge.sendMessageFromView({active:n}).catch(e=>e));await turn();
  const waiting=Array.from({length:256},(_,n)=>f.win.electronBridge.sendMessageFromView({waiting:n}).catch(e=>e));await turn();
  const before=f.bridge.getResourceUsage();assert.equal(before.pendingRPC,64);assert.equal(before.waitingRPC,256);assert.equal(before.inFlightPortPosts,0);
  const expected=Array.from({length:800},(_,n)=>rop(n));for(const value of expected)f.port.emit(value);await turn();
  assert.equal(f.failure,undefined);assert.equal(f.bridge.getResourceUsage().rawSnapshots,800);assert.equal(f.bridge.getResourceUsage().inFlightPortPosts,0);
  const acknowledged=new Set();
  // All initial receipts arrive while the transport completion of the 64th
  // send is delayed. No raw producer or new port event occurs after this point.
  for(const frame of f.sent.filter(frame=>frame.type==='call')){acknowledged.add(frame.id);f.input({type:'return',id:frame.id,value:undefined});}
  assert.equal(acknowledged.size,64);assert.equal(f.bridge.getResourceUsage().waitingRPC,256);
  releaseLast();await turn();
  let rounds=0;
  while(acknowledged.size<320+800&&rounds++<100){
    const active=f.sent.filter(frame=>(frame.type==='call'||frame.type==='portPost')&&!acknowledged.has(frame.id));
    assert.ok(active.length>0&&active.length<=64,'real receipts alone must keep FIFO work progressing');
    for(const frame of active){acknowledged.add(frame.id);f.input({type:'return',id:frame.id,value:undefined});}
    await turn();assert.equal(f.failure,undefined);
  }
  assert.equal(acknowledged.size,1120,'all queued ordinary calls and all raw snapshots must finish without another producer event');
  assert.ok((await Promise.all([...calls,...waiting])).every(value=>value===undefined));
  const posted=f.sent.filter(frame=>frame.type==='portPost');assert.deepEqual(posted.map(frame=>frame.data),expected);
  assert.ok(f.sent.findIndex(frame=>frame.type==='portPost')>f.sent.findLastIndex(frame=>frame.type==='call'),'earlier encoded calls keep FIFO priority');
  assert.deepEqual(f.sent.map(frame=>frame.seq),Array.from({length:f.sent.length},(_,n)=>n+1));assert.equal(new Set(f.sent.map(frame=>frame.id)).size,f.sent.length);
  const done=f.bridge.getResourceUsage();assert.equal(done.rawSnapshots,0);assert.equal(done.heldLogicalBytes,0);assert.equal(done.pendingRPC,0);assert.equal(done.inFlightPortPosts,0);assert.equal(done.waitingRPC,0);
  assert.equal(done.peakPendingRPC,64);assert.equal(done.peakWaitingRPC,256);assert.equal(done.peakInFlightPortPosts,32);assert.equal(done.peakRawSnapshots,800);assert.ok(done.peakHeldLogicalBytes<=8*1024*1024);
});
