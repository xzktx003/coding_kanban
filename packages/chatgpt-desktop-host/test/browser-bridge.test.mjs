import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { installDesktopBridge } from '../src/browser-bridge.mjs';
import { encodeWireValue, decodeWireValue } from '../src/wire-value.mjs';

const scope = Object.freeze({ profileId: '43e56e8a-de3f-40fb-8cf3-7177d17d24f1', generation: 'b94128f4-288c-4c97-a5cb-891555dc8199', viewId: '9d79066f-f08f-4f00-a75e-e24cc65e5d00' });
function fixture(t, extra = {}) {
  const handlers = new Map(), listeners = new Set(), sent = [], encodedSent = [];
  const win = {
    performance: { timeOrigin: 1000 }, MessageChannel,
    MessageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    addEventListener(type, handler) { const set = handlers.get(type) ?? new Set(); set.add(handler); handlers.set(type, set); },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    dispatchEvent(event) { for (const handler of handlers.get(event.type) ?? []) handler(event); },
  };
  let inbound = 0;
  const send = (frame) => { for (const listener of listeners) listener(encodeWireValue({ v: 1, scope, seq: ++inbound, ...frame })); };
  const transport = {
    send: async (encoded) => { encodedSent.push(encoded); const value = decodeWireValue(encoded); sent.push(value); if (extra.autoReply !== false && value.id) queueMicrotask(() => send({ type: 'return', id: value.id, value: undefined })); },
    subscribe(handler) { listeners.add(handler); return () => listeners.delete(handler); },
  };
  let failure;
  const bridge = installDesktopBridge({ window: win, scope, transport, bootstrap: { windowType: 'electron', getters: { getBuildFlavor: 'stable', getSystemThemeVariant: 'light', getInitialSidebarBootstrap: { projects: [] } }, sharedObjects: { saved: 123 } }, onFailure: e => { failure = e; }, ...extra });
  t.after(() => bridge.dispose());
  return { win, bridge, send, sent, encodedSent, listeners, get failure() { return failure; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('exposes the synchronous preload surface and acknowledged async view calls', async t => {
  const f = fixture(t), b = f.win.electronBridge;
  assert.equal(f.win.codexWindowType, 'electron');
  assert.equal(b.getBuildFlavor(), 'stable'); assert.equal(b.getPreloadStartedAtMs(), 1000);
  assert.equal(b.getSharedObjectSnapshotValue('saved'), 123);
  assert.equal(b.getPathForFile({}), null); assert.equal(b.startFileDrag([]), false);
  await b.sendMessageFromView({ type: 'shared-object-set', key: 'saved', value: 456 });
  assert.equal(b.getSharedObjectSnapshotValue('saved'), 456);
  assert.deepEqual(f.sent[0].args, [{ type: 'shared-object-set', key: 'saved', value: 456 }]);
  assert.equal(f.sent[0].method, 'sendMessageFromView');
  assert.deepEqual(f.sent[0].scope, scope);
});

test('an explicit browser menu adapter handles decisions without opening a server native menu', async t => {
  const decisions = [], items = [{id:'choice',label:'Choose'}], position = {x:12,y:24};
  let disposals = 0;
  const f = fixture(t, {contextMenuAdapter: {
    async show(...args) { decisions.push(args); return {id:'choice'}; },
    dispose() { disposals++; },
  }});
  assert.deepEqual(await f.win.electronBridge.showContextMenu(items,position), {id:'choice'});
  assert.equal(decisions[0][0],items);
  assert.equal(decisions[0][1],position);
  assert.equal(f.sent.length,0);
  f.bridge.dispose(); f.bridge.dispose();
  assert.equal(disposals,1);
  await assert.rejects(f.win.electronBridge.showContextMenu(items,position), {code:'BRIDGE_CLOSED'});
});

test('browser menu failure is local and does not dispose unrelated native RPC', async t => {
  const f = fixture(t, {contextMenuAdapter: {
    async show() { throw new Error('private menu failure'); },
    dispose() {},
  }});
  await assert.rejects(f.win.electronBridge.showContextMenu([], {x:0,y:0}), {code:'BRIDGE_MENU_UNAVAILABLE'});
  await f.win.electronBridge.sendMessageFromView({type:'fixture'});
  assert.equal(f.sent.length,1);
  assert.equal(f.failure,undefined);
});

test('a late local menu decision cannot outlive its originating bridge', async t => {
  let resolve;
  const f = fixture(t, {contextMenuAdapter:{
    show: () => new Promise(done => { resolve = done; }), dispose() {},
  }});
  const decision = f.win.electronBridge.showContextMenu([{id:'late',label:'Late'}], {x:0,y:0});
  f.bridge.dispose();
  resolve({id:'late'});
  await assert.rejects(decision, {code:'BRIDGE_CLOSED'});
  assert.equal(f.sent.length,0);
});

test('invalid optional menu adapters and malformed decisions fail without a native fallback', async t => {
  assert.throws(() => fixture(t, {contextMenuAdapter:{show(){}}}), {code:'BRIDGE_INVALID_CONFIG'});
  const f = fixture(t, {contextMenuAdapter:{async show(){return {id:1};},dispose(){}}});
  await assert.rejects(f.win.electronBridge.showContextMenu([], {x:0,y:0}), {code:'BRIDGE_MENU_UNAVAILABLE'});
  assert.equal(f.sent.length,0);
});

test('relays state messages with the original null-source event and unsubscribes listeners', async t => {
  const f = fixture(t), events = []; let themes = 0;
  f.win.addEventListener('message', e => events.push(e));
  const off = f.win.electronBridge.subscribeToSystemThemeVariant(() => { themes++; });
  f.send({ type: 'viewMessage', data: { type: 'shared-object-updated', key: 'saved', value: 999 } });
  assert.equal(f.win.electronBridge.getSharedObjectSnapshotValue('saved'), 999);
  assert.equal(events[0].source, null);
  f.send({ type: 'theme', value: 'dark' }); off();
  f.send({ type: 'theme', value: 'light' });
  assert.equal(themes, 1); assert.equal(f.win.electronBridge.getSystemThemeVariant(), 'light');
});

test('opens an exact MessagePort, preserves binary data, and closes only its own port', async t => {
  const f = fixture(t), channel = new MessageChannel(); t.after(() => channel.port1.close());
  f.win.dispatchEvent({ type: 'message', source: f.win, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick();
  const opened = f.sent.find(x => x.type === 'openPort'); assert.equal(opened.name, 'app-host');
  const bytes = new Uint8Array([0, 128, 255]); channel.port1.postMessage(['bytes', bytes, 'Uint8Array']);
  await tick(); await tick();
  const posted = f.sent.find(x => x.type === 'portPost');
  assert.equal(posted.portId, opened.portId); assert.deepEqual(posted.data[1], bytes);
  const received = new Promise(resolve => channel.port1.once('message', resolve));
  f.send({ type: 'portMessage', portId: opened.portId, data: { result: bytes } });
  assert.deepEqual((await received).result, bytes);
  f.bridge.dispose(); assert.equal(f.listeners.size, 0);
});

test('only accepts app-host connection events from its own browsing context', async t => {
  const f = fixture(t), channel = new MessageChannel(); t.after(() => { channel.port1.close(); channel.port2.close(); });
  f.win.dispatchEvent({ type: 'message', source: {}, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick(); assert.equal(f.sent.length, 0);
});

test('waits for port creation acknowledgement before forwarding its first data', async t => {
  const f = fixture(t, { autoReply: false }), channel = new MessageChannel();
  t.after(() => channel.port1.close());
  f.win.dispatchEvent({ type: 'message', source: f.win, data: { type: 'connect-app-host', port: channel.port2 } });
  channel.port1.postMessage({ hello: 1 }); await tick(); await tick();
  assert.deepEqual(f.sent.map(x => x.type), ['openPort']);
  f.send({ type: 'return', id: f.sent[0].id, value: undefined });
  await tick(); await tick();
  assert.deepEqual(f.sent.map(x => x.type), ['openPort', 'portPost']);
  f.send({ type: 'return', id: f.sent[1].id, value: undefined });
});

test('pipelines a bounded number of ordered port writes without waiting for every round trip', async t => {
  const f = fixture(t, { autoReply: false }), channel = new MessageChannel();
  t.after(() => channel.port1.close());
  f.win.dispatchEvent({ type: 'message', source: f.win, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick(); f.send({ type: 'return', id: f.sent[0].id, value: undefined });
  for (let n = 0; n < 40; n++) channel.port1.postMessage({ n });
  for (let n = 0; n < 8; n++) await tick();
  const first = f.sent.filter(x => x.type === 'portPost');
  assert.equal(first.length, 32); assert.deepEqual(first.map(x => x.data.n), Array.from({length:32}, (_, n) => n));
  // Out-of-order acknowledgements may release slots; original send order remains.
  f.send({ type: 'return', id: first[5].id, value: undefined });
  await tick(); await tick();
  assert.deepEqual(f.sent.filter(x => x.type === 'portPost').map(x => x.data.n), Array.from({length:33}, (_, n) => n));
});

test('keeps bounded waiting port messages separate from requests already in flight', async t => {
  const f = fixture(t, { autoReply: false }), channel = new MessageChannel(); t.after(() => channel.port1.close());
  f.win.dispatchEvent({ type: 'message', source: f.win, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick(); f.send({ type: 'return', id: f.sent[0].id, value: undefined });
  for (let n = 0; n < 160; n++) channel.port1.postMessage({ n });
  for (let n = 0; n < 10; n++) await tick();
  assert.equal(f.failure, undefined);
  assert.equal(f.sent.filter(x => x.type === 'portPost').length, 32);
  // Waiting plus in-flight snapshots must fit the fixed 1024 local slots.
  for (let n = 160; n < 1024; n++) channel.port1.postMessage({ n });
  for (let n = 0; n < 10; n++) await tick();
  assert.equal(f.failure, undefined);
  channel.port1.postMessage({ n: 1024 });
  for (let n = 0; n < 10 && !f.failure; n++) await tick();
  assert.equal(f.failure?.code, 'BRIDGE_QUEUE_FULL');
  assert.equal(f.failure?.limitKind, 'waiting_count');
});

test('identifies the independent outgoing and retained port byte budgets', async t => {
  const queued = fixture(t, { autoReply: false, maxQueuedBytes: 1024 });
  await assert.rejects(
    queued.win.electronBridge.sendMessageFromView({ value: 'x'.repeat(3000) }),
    { code: 'BRIDGE_QUEUE_FULL', limitKind: 'queued_bytes' },
  );
  assert.equal(queued.failure?.limitKind, 'queued_bytes');

  const retained = fixture(t, { autoReply: false, maxQueuedBytes: 1024 });
  const channel = new MessageChannel();
  t.after(() => channel.port1.close());
  retained.win.dispatchEvent({ type: 'message', source: retained.win, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick();
  channel.port1.postMessage({ value: 'x'.repeat(3000) });
  for (let n = 0; n < 10 && !retained.failure; n++) await tick();
  assert.equal(retained.failure?.code, 'BRIDGE_QUEUE_FULL');
  assert.equal(retained.failure?.limitKind, 'snapshot_bytes');
});

test('a closed port drops its waiting posts while another port can still send', async t => {
  const f = fixture(t, { autoReply: false, maxQueuedBytes: 12 * 1024 }), channel = new MessageChannel();
  t.after(() => channel.port1.close());
  let gitPort;
  f.win.location = {origin: 'https://fixture.invalid'};
  f.win.postMessage = (_message, _origin, ports) => { gitPort = ports[0]; };
  f.win.dispatchEvent({ type: 'message', source: f.win, data: { type: 'connect-app-host', port: channel.port2 } });
  await tick();
  const opened = f.sent[0];
  f.send({ type: 'return', id: opened.id, value: undefined });
  f.send({ type: 'gitPort', portId: 'git-1', requestId: 1, closed: false });
  await tick();
  assert.ok(gitPort);
  t.after(() => gitPort.close());
  for (let n = 0; n < 32; n++) channel.port1.postMessage({ n });
  channel.port1.postMessage({ body: 'x'.repeat(8000) });
  for (let n = 0; n < 8; n++) await tick();
  const posts = f.sent.filter(frame => frame.type === 'portPost' && frame.portId === opened.portId);
  assert.equal(posts.length, 32);
  assert.equal(f.failure, undefined);
  f.send({ type: 'portClosed', portId: opened.portId });
  f.send({ type: 'return', id: posts[0].id, value: undefined });
  for (let n = 0; n < 8; n++) await tick();
  assert.equal(f.sent.filter(frame => frame.type === 'portPost' && frame.portId === opened.portId).length, 32);
  gitPort.postMessage({ body: 'y'.repeat(8000) });
  for (let n = 0; n < 8; n++) await tick();
  const other = f.sent.find(frame => frame.type === 'portPost' && frame.portId === 'git-1');
  assert.ok(other, 'closed-port waiting bytes must be released for other ports');
  f.send({ type: 'throw', id: posts[1].id });
  f.send({ type: 'return', id: other.id, value: undefined });
  for (let n = 0; n < 8; n++) await tick();
  assert.equal(f.failure, undefined);
});

test('a late open acknowledgement cannot revive a closed port or retain its bytes', async t => {
  const f = fixture(t, {autoReply: false, maxQueuedBytes: 4096});
  const callbacks = new Map(); let closed = false, gitPort;
  const closedPort = {addEventListener(type, cb) { callbacks.set(type, cb); }, start() {}, close() { closed = true; }, postMessage() {}};
  f.win.location = {origin:'https://fixture.invalid'};
  f.win.postMessage = (_message, _origin, ports) => { gitPort = ports[0]; };
  f.win.dispatchEvent({type:'message', source:f.win, data:{type:'connect-app-host', port:closedPort}});
  await tick(); const opened = f.sent[0];
  f.send({type:'gitPort', portId:'git-1', requestId:1, closed:false}); await tick();
  t.after(() => gitPort.close());
  f.send({type:'portClosed', portId:opened.portId});
  assert.equal(closed, true);
  callbacks.get('message')({data:{body:'x'.repeat(2500)}});
  f.send({type:'return', id:opened.id, value:undefined});
  for (let n=0;n<8;n++) await tick();
  assert.equal(f.sent.filter(frame => frame.type === 'portPost' && frame.portId === opened.portId).length, 0);
  gitPort.postMessage({body:'y'.repeat(2500)});
  for (let n=0;n<8;n++) await tick();
  assert.ok(f.sent.some(frame => frame.type === 'portPost' && frame.portId === 'git-1'));
  assert.equal(f.failure, undefined);
});

test('a failed open after portClosed does not tear down other ports', async t => {
  const f = fixture(t, {autoReply:false}), channel = new MessageChannel();
  t.after(() => channel.port1.close()); let gitPort;
  f.win.location = {origin:'https://fixture.invalid'};
  f.win.postMessage = (_message, _origin, ports) => {gitPort = ports[0];};
  f.win.dispatchEvent({type:'message', source:f.win, data:{type:'connect-app-host',port:channel.port2}});
  await tick(); const opened = f.sent[0];
  f.send({type:'gitPort',portId:'git-1',requestId:1,closed:false}); await tick();
  t.after(() => gitPort.close());
  f.send({type:'portClosed',portId:opened.portId});
  f.send({type:'throw',id:opened.id});
  for (let n=0;n<8;n++) await tick();
  gitPort.postMessage({ok:true}); for (let n=0;n<8;n++) await tick();
  assert.equal(f.failure, undefined);
  assert.ok(f.sent.some(frame => frame.type === 'portPost' && frame.portId === 'git-1'));
});

test('a native failure on a still-open port continues to fail the bridge', async t => {
  const f = fixture(t, {autoReply:false}), channel = new MessageChannel();
  t.after(() => channel.port1.close());
  f.win.dispatchEvent({type:'message',source:f.win,data:{type:'connect-app-host',port:channel.port2}});
  await tick(); const opened = f.sent[0];
  f.send({type:'return',id:opened.id,value:undefined});
  channel.port1.postMessage({ok:true});
  for (let n=0;n<8;n++) await tick();
  const posted = f.sent.find(frame => frame.type === 'portPost');
  assert.ok(posted);
  f.send({type:'throw',id:posted.id});
  for (let n=0;n<8;n++) await tick();
  assert.equal(f.failure?.code,'BRIDGE_NATIVE_ERROR');
});

test('binds every incoming frame to exact identity and monotonic sequence', async t => {
  for (const invalid of [{ scope: { ...scope, generation: scope.profileId } }, { seq: 0 }, { type: 'executeJavaScript', source: 'x' }]) {
    const f = fixture(t);
    f.send({ type: 'theme', value: 'dark', ...invalid });
    await tick(); assert.ok(f.failure); assert.equal(f.listeners.size, 0);
  }
});

test('bounds active requests and their shared waiting slots without replaying', async t => {
  const f = fixture(t, { autoReply: false, maxPending: 1 });
  const accepted = Array.from({length:257},(_,n)=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.length,1);
  await assert.rejects(f.win.electronBridge.sendMessageFromView({overflow:true}),{code:'BRIDGE_PENDING_LIMIT'});
  const outcomes=await Promise.all(accepted);assert.ok(outcomes.every(error=>error.code==='BRIDGE_PENDING_LIMIT'));
  assert.equal(f.sent.length,1);
});

test('timeout and disconnect reject pending calls and release subscriptions', async t => {
  const f = fixture(t, { autoReply: false, requestTimeoutMs: 10 });
  await assert.rejects(f.win.electronBridge.sendMessageFromView({ type: 'fixture' }), { code: 'BRIDGE_OUTCOME_UNKNOWN' });
  assert.ok(f.failure); assert.equal(f.failure.causeKind, 'request_timeout'); assert.equal(f.listeners.size, 0);
});

test('a request timeout keeps only the exact request transport metadata before cleanup', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let observed;
  const f=fixture(t,{autoReply:false,requestTimeoutMs:10,onFailure(reason,diagnostic){observed={reason,diagnostic};}});
  const pending=f.win.electronBridge.sendMessageFromView({type:'PRIVATE_BODY_SENTINEL',secret:'PRIVATE_BODY_SENTINEL'});
  const rejected=assert.rejects(pending,{code:'BRIDGE_OUTCOME_UNKNOWN'});
  t.mock.timers.tick(10);await rejected;
  assert.deepEqual(observed.diagnostic.timedOutRequest,{id:1,seq:1,type:'call',method:'sendMessageFromView',dispatched:true,admitted:true,queued:false,queueAhead:null});
  assert.equal(observed.diagnostic.pendingTotal,1);
  assert.equal(observed.diagnostic.queuedTransportFrames,0);
  assert.ok(!JSON.stringify(observed.diagnostic).includes('PRIVATE_BODY_SENTINEL'));
  assert.ok(Object.isFrozen(observed.diagnostic.timedOutRequest));
  assert.equal(f.sent.length,1);
});

test('a timeout distinguishes an encoded request blocked before transport dispatch', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let observed,receive,release;const sent=[];
  const held=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{requestTimeoutMs:10,onFailure(reason,diagnostic){observed={reason,diagnostic};},transport:{
    async send(encoded){sent.push(decodeWireValue(encoded));await held;},
    subscribe(fn){receive=fn;return()=>{};},
  }});
  const first=f.win.electronBridge.sendMessageFromView({type:'first'});
  receive(encodeWireValue({v:1,scope,seq:1,type:'return',id:1,value:undefined}));await first;
  const second=f.win.electronBridge.sendMessageFromView({type:'second'});
  const rejected=assert.rejects(second,{code:'BRIDGE_NOT_SENT'});
  t.mock.timers.tick(10);await rejected;
  assert.deepEqual(observed.diagnostic.timedOutRequest,{id:2,seq:2,type:'call',method:'sendMessageFromView',dispatched:false,admitted:true,queued:true,queueAhead:0});
  assert.equal(observed.diagnostic.queuedTransportFrames,1);
  release();await tick();assert.equal(sent.length,1);
});

test('unknown outcome identifies transport send failure without exposing its error or replaying', async t => {
  let sends = 0;
  const transport = {
    async send() { sends++; throw new Error('PRIVATE_PAYLOAD_SENTINEL'); },
    subscribe() { return () => {}; },
  };
  const f = fixture(t, {transport});
  await assert.rejects(f.win.electronBridge.sendMessageFromView({type:'fixture'}), {code:'BRIDGE_OUTCOME_UNKNOWN'});
  assert.equal(f.failure?.causeKind, 'send_failure');
  assert.ok(!JSON.stringify(f.failure).includes('PRIVATE_PAYLOAD_SENTINEL'));
  assert.equal(sends, 1);
});

test('original project-folder dialogs can await a decision while ordinary calls keep their deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  for (const message of [
    {type:'electron-pick-workspace-root-option',allowMultiple:true},
    {type:'electron-add-new-workspace-root-option'},
    {type:'electron-add-new-workspace-root-option',root:null},
  ]) {
    const f = fixture(t, {autoReply:false,requestTimeoutMs:10});
    let settled = false;
    const pending = f.win.electronBridge.sendMessageFromView(message).finally(() => { settled = true; });
    t.mock.timers.tick(11);
    await Promise.resolve();
    assert.equal(settled,false);
    assert.equal(f.failure,undefined);
    f.send({type:'return',id:f.sent[0].id,value:undefined});
    await pending;
    f.bridge.dispose();
  }
  const ordinary = fixture(t, {autoReply:false,requestTimeoutMs:10});
  const pending = ordinary.win.electronBridge.sendMessageFromView({type:'electron-add-new-workspace-root-option',root:'/direct'});
  const result = assert.rejects(pending,{code:'BRIDGE_OUTCOME_UNKNOWN'});
  t.mock.timers.tick(10);
  await result;
  assert.equal(ordinary.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');
});

test('project-folder dialog still fails with unknown outcome after its bounded decision deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture(t,{autoReply:false,requestTimeoutMs:10});
  const pending = f.win.electronBridge.sendMessageFromView({type:'electron-pick-workspace-root-option'});
  const result = assert.rejects(pending,{code:'BRIDGE_OUTCOME_UNKNOWN'});
  t.mock.timers.tick(129999);
  await Promise.resolve();
  assert.equal(f.failure,undefined);
  t.mock.timers.tick(1);
  await result;
  assert.equal(f.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');
  assert.equal(f.sent.length,1);
});

function controlledPort(f) {
  const callbacks = new Map();
  const port = { addEventListener(type, cb) { callbacks.set(type, cb); }, start() {}, close() {}, postMessage() {} };
  f.win.dispatchEvent({type:'message', source:f.win, data:{type:'connect-app-host', port}});
  return data => callbacks.get('message')({data});
}

test('a legal initialization burst drains with the unchanged native port concurrency', async t => {
  const f = fixture(t, {autoReply:false}), emit = controlledPort(f);
  await tick(); f.send({type:'return',id:f.sent[0].id,value:undefined}); await tick();
  for(let n=0;n<32;n++)emit({n});
  await tick();
  // A first round trip occurs before the next burst. With only eight in
  // flight, 24 of these are still retained; with 32, all can be acknowledged.
  const first = f.sent.filter(frame=>frame.type==='portPost');
  for(const frame of first)f.send({type:'return',id:frame.id,value:undefined});
  await tick();
  for(let n=32;n<282;n++)emit({n});
  await tick();
  assert.equal(f.failure,undefined);
  assert.equal(first.length,32);
  const sent=f.sent.filter(frame=>frame.type==='portPost');
  assert.deepEqual(sent.map(frame=>frame.data.n),Array.from({length:64},(_,n)=>n));
});

test('waiting and in-flight posts share the fixed 1024 local cap for smaller pending budgets', async t => {
  for(const maxPending of [1,4,9,20,64]) {
    const f=fixture(t,{autoReply:false,maxPending}),emit=controlledPort(f);
    await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
    const allowed=1024;
    for(let n=0;n<allowed;n++)emit({n});
    await tick();assert.equal(f.failure,undefined,`budget ${maxPending}`);
    assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,Math.min(32,maxPending-Math.min(8,Math.max(0,maxPending-8))));
    emit({n:allowed});
    assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'waiting_count');
  }
});

test('ordinary requests wait at the active limit and resume in FIFO order', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  for(let n=0;n<32;n++)emit({n});
  await tick();assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,32);
  const ordinary=Array.from({length:32},(_,n)=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.filter(frame=>frame.type==='call').length,32);
  const queued=f.win.electronBridge.sendMessageFromView({n:33}).catch(error=>error);
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.filter(frame=>frame.type==='call').length,32);
  f.send({type:'return',id:f.sent.find(frame=>frame.type==='portPost').id,value:undefined});
  await tick();assert.equal(f.sent.filter(frame=>frame.type==='call').length,33);
  f.bridge.dispose();
  const outcomes=await Promise.all([...ordinary,queued]);assert.ok(outcomes.every(error=>error.code==='BRIDGE_CLOSED'));
});

test('the observed 32-port plus 33-call initialization burst waits without enlarging the active budget', async t=>{
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  for(let n=0;n<32;n++)emit({n});await tick();
  const calls=Array.from({length:33},(_,n)=>f.win.electronBridge.sendMessageFromView({type:n<22?'log-message':'initialization',n}).catch(error=>error));
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.length,65,'open plus 64 active, with the final call waiting');
  const original=f.sent.slice(1);for(const frame of original)f.send({type:'return',id:frame.id,value:undefined});
  await tick();assert.equal(f.sent.length,66);assert.equal(f.sent.at(-1).args[0].n,32);
  f.send({type:'return',id:f.sent.at(-1).id,value:undefined});
  assert.ok((await Promise.all(calls)).every(value=>value===undefined));
  assert.deepEqual(f.sent.map(frame=>frame.seq),Array.from({length:f.sent.length},(_,n)=>n+1));
});

test('unopened raw snapshots do not consume the original 256 encoded waiting slots', async t=>{
  const f=fixture(t,{autoReply:false,maxPending:1}),emit=controlledPort(f);
  await tick();for(let n=0;n<800;n++)emit({n});
  const calls=Array.from({length:256},(_,n)=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.length,1);
  await assert.rejects(f.win.electronBridge.sendMessageFromView({overflow:true}),{code:'BRIDGE_PENDING_LIMIT'});
  await Promise.all(calls);assert.equal(f.sent.length,1);
});

test('port promotion joins the FIFO behind waiting calls and ahead of later calls', async t=>{
  const f=fixture(t,{autoReply:false,maxPending:2}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const first=[0,1].map(n=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  await tick();const body={n:2};const waiting=f.win.electronBridge.sendMessageFromView(body).catch(error=>error);body.n=200;
  emit({port:1});await tick();const later=f.win.electronBridge.sendMessageFromView({n:3}).catch(error=>error);
  const heads=f.sent.slice(1);f.send({type:'return',id:heads[0].id,value:undefined});await tick();
  assert.equal(f.sent.at(-1).args[0].n,2,'waiting arguments were snapshotted at request time');
  f.send({type:'return',id:heads[1].id,value:undefined});await tick();assert.equal(f.sent.at(-1).type,'portPost');
  const promoted=f.sent.at(-1);f.send({type:'return',id:f.sent.find(frame=>frame.type==='call'&&frame.args[0].n===2).id,value:undefined});
  await tick();assert.equal(f.sent.at(-1).args[0].n,3);
  f.send({type:'return',id:promoted.id,value:undefined});f.send({type:'return',id:f.sent.at(-1).id,value:undefined});
  await Promise.all([...first,waiting,later]);assert.equal(f.failure,undefined);
  assert.deepEqual(f.sent.map(frame=>frame.seq),Array.from({length:f.sent.length},(_,n)=>n+1));
});

test('a queued timeout or a closed queued port invalidates the connection without skipping or replaying encoded sequence numbers', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const timed=fixture(t,{autoReply:false,maxPending:1,requestTimeoutMs:10});
  const pending=[0,1].map(n=>timed.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  await tick();assert.equal(timed.sent.length,1);t.mock.timers.tick(10);await tick();
  assert.deepEqual((await Promise.all(pending)).map(error=>error.code),['BRIDGE_OUTCOME_UNKNOWN','BRIDGE_NOT_SENT']);
  timed.send({type:'return',id:timed.sent[0].id,value:undefined});await tick();assert.equal(timed.sent.length,1);
  const f=fixture(t,{autoReply:false,maxPending:1}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const active=f.win.electronBridge.sendMessageFromView({active:true}).catch(error=>error);
  await tick();emit({port:1});await tick();const later=f.win.electronBridge.sendMessageFromView({later:true}).catch(error=>error);
  f.send({type:'portClosed',portId:f.sent[0].portId});await tick();
  assert.equal(f.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');
  assert.equal(f.failure?.causeKind,'port_closed_queued');
  assert.deepEqual((await Promise.all([active,later])).map(error=>error.code),['BRIDGE_OUTCOME_UNKNOWN','BRIDGE_NOT_SENT']);
  assert.equal(f.sent.length,2,'neither the closed port nor its later suffix was dispatched');
});

test('full unopened-port waiting slots do not block an ordinary request with a free reservation', async t=>{
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();for(let n=0;n<1024;n++)emit({n});
  const call=f.win.electronBridge.sendMessageFromView({ordinary:true});
  await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.at(-1).type,'call');
  f.send({type:'return',id:f.sent.at(-1).id,value:undefined});await call;
});

test('new requests cannot reserve ahead of an older FIFO waiter while a transport send is still pending', async t=>{
  let receive, release, inbound=0;const gate=new Promise(resolve=>{release=resolve;}),sent=[];
  const reply=id=>receive(encodeWireValue({v:1,scope,seq:++inbound,type:'return',id,value:undefined}));
  const f=fixture(t,{maxPending:1,transport:{
    async send(encoded){const frame=decodeWireValue(encoded);sent.push(frame);if(sent.length===1)await gate;else queueMicrotask(()=>reply(frame.id));},
    subscribe(handler){receive=handler;return()=>{};},
  }});
  const first=f.win.electronBridge.sendMessageFromView({n:0}).catch(error=>error);
  const waiting=f.win.electronBridge.sendMessageFromView({n:1}).catch(error=>error);
  await tick();reply(sent[0].id);
  const later=f.win.electronBridge.sendMessageFromView({n:2}).catch(error=>error);
  release();await tick();await tick();
  assert.deepEqual(sent.map(frame=>frame.args[0].n),[0,1,2]);
  assert.ok((await Promise.all([first,waiting,later])).every(value=>value===undefined));
  assert.equal(f.failure,undefined);
});

test('a response cannot settle a reserved request before its actual transport send', async t=>{
  let release, receive;const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{autoReply:false,maxPending:2,transport:{send:()=>gate,subscribe(handler){receive=handler;return()=>{};}}});
  const calls=[0,1].map(n=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
  receive(encodeWireValue({v:1,scope,seq:1,type:'return',id:2,value:undefined}));
  assert.equal(f.failure?.code,'BRIDGE_INVALID_MESSAGE');release();await Promise.all(calls);
});

test('timed out port posts remain unknown and are never retried', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t,{autoReply:false,requestTimeoutMs:10}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  for(let n=0;n<3;n++)emit({n});
  await tick();assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,3);
  t.mock.timers.tick(10);await tick();
  assert.equal(f.failure?.code,'BRIDGE_OUTCOME_UNKNOWN');
  t.mock.timers.tick(100);await tick();
  assert.deepEqual(f.sent.filter(frame=>frame.type==='portPost').map(frame=>frame.data.n),[0,1,2]);
});

test('the default eight MiB retained snapshot budget remains enforced', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick(); // Keep the original open request unacknowledged so snapshots wait.
  const body='x'.repeat(4*1024*1024);
  emit({body});assert.equal(f.failure,undefined);
  emit({body});assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'snapshot_bytes');
});

test('the sixteen port limit remains a hard failure', async t => {
  const f=fixture(t,{autoReply:false});
  for(let n=0;n<16;n++)controlledPort(f);
  assert.equal(f.failure,undefined);
  controlledPort(f);assert.equal(f.failure?.code,'BRIDGE_PORT_LIMIT');
});

test('smaller pending budgets preserve ordinary-call slots when the old window did', async t => {
  for(const maxPending of [9,20]) {
    const f=fixture(t,{autoReply:false,maxPending}),emit=controlledPort(f);
    await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
    const reserve=Math.min(8,maxPending-8),portCount=maxPending-reserve;
    for(let n=0;n<portCount;n++)emit({n});
    const ordinary=Array.from({length:reserve},(_,n)=>f.win.electronBridge.sendMessageFromView({n}).catch(error=>error));
    await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.filter(frame=>frame.type==='call').length,reserve);
    const queued=f.win.electronBridge.sendMessageFromView({waiting:true}).catch(error=>error);
    await tick();assert.equal(f.failure,undefined);assert.equal(f.sent.filter(frame=>frame.type==='call').length,reserve);
    f.bridge.dispose();await Promise.all([...ordinary,queued]);
  }
});

test('large binary port snapshot is not decoded again just to construct its transport frame', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const payload={body:new Uint8Array(4_400_000)};payload.body[0]=31;
  const write=Buffer.prototype.write;let calls=0;
  Buffer.prototype.write=function(value,offset,length,encoding){if(encoding==='base64')calls++;return write.call(this,value,offset,length,encoding)};
  try {emit(payload);} finally {Buffer.prototype.write=write;}
  assert.equal(calls,1,
    'only the receiving fake transport decodes the binary payload');
  const sent=f.sent.find(frame=>frame.type==='portPost');
  assert.deepEqual(sent.data.body,payload.body);
  f.send({type:'return',id:sent.id,value:undefined});
});

test('port snapshots preserve cyclic graph, binary data and user text resembling frame fields', async t=>{
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const text='["seq",0],["type","portPost"],["id",0],',buffer=new Uint8Array([1,2,255]);
  const source={text,seq:0,type:'portPost',id:0,buffer};source.self=source;source.alias=buffer;
  emit(source);buffer[0]=9;source.text='changed';await tick();
  const sent=f.sent.find(frame=>frame.type==='portPost');assert.ok(sent);
  assert.equal(sent.data.text,text);assert.equal(sent.data.seq,0);assert.equal(sent.data.id,0);
  assert.equal(sent.data.self,sent.data);assert.equal(sent.data.alias,sent.data.buffer);
  assert.deepEqual([...sent.data.buffer],[1,2,255]);
  assert.equal(sent.id,2);assert.equal(sent.seq,2);
  f.send({type:'return',id:sent.id,value:undefined});
});

test('snapshot graph depth at the frame boundary is preserved and overflow still fails closed', async t => {
  const makeDepth=n=>{const root={};let p=root;for(let i=0;i<n;i++){p.next={};p=p.next;}root.self=root;return root;};
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  emit(makeDepth(127));await tick();const sent=f.sent.find(frame=>frame.type==='portPost');
  assert.ok(sent);assert.equal(sent.data.self,sent.data);f.send({type:'return',id:sent.id,value:undefined});await tick();
  emit(makeDepth(128));await tick();assert.equal(f.failure?.code,'BRIDGE_UNSUPPORTED_VALUE');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,1);
});

test('near node budget keeps the original allowed boundary and rejects one extra array slot', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  emit(new Array(999_989));await tick();const sent=f.sent.find(frame=>frame.type==='portPost');
  assert.equal(sent.data.length,999_989);f.send({type:'return',id:sent.id,value:undefined});await tick();
  emit(new Array(999_990));await tick();assert.equal(f.failure?.code,'BRIDGE_UNSUPPORTED_VALUE');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,1);
});

test('snapshot fitting alone but exceeding the full eight MiB wire budget is not sent', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const text='x'.repeat(8*1024*1024-128);
  assert.ok(Buffer.byteLength(encodeWireValue(text))<8*1024*1024);
  emit(text);await tick();assert.equal(f.failure?.code,'BRIDGE_UNSUPPORTED_VALUE');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,0);
});

test('actual encoded UTF-8 frame bytes still count toward the sending queue budget', async t => {
  const data={text:'汉字😊'.repeat(100)}, first=fixture(t,{autoReply:false}),emitFirst=controlledPort(first);
  await tick();first.send({type:'return',id:first.sent[0].id,value:undefined});await tick();
  emitFirst(data);const encoded=first.encodedSent.at(-1),bytes=Buffer.byteLength(encoded);
  assert.deepEqual(decodeWireValue(encoded).data,data);
  const exact=fixture(t,{autoReply:false,maxQueuedBytes:bytes*2}),emitExact=controlledPort(exact);
  await tick();exact.send({type:'return',id:exact.sent[0].id,value:undefined});await tick();
  emitExact(data);emitExact(data);assert.equal(exact.failure,undefined);
  const f=fixture(t,{autoReply:false,maxQueuedBytes:bytes*2-1}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  emit(data);emit(data);
  assert.equal(f.failure?.code,'BRIDGE_QUEUE_FULL');assert.equal(f.failure?.limitKind,'queued_bytes');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,1);
});

test('unsupported data still fails closed without reading accessor values', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);let getter=0;
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  emit({get secret(){getter++;return 'hidden'}});
  assert.equal(getter,0);assert.equal(f.failure?.code,'unsupported');
  assert.equal(f.sent.filter(frame=>frame.type==='portPost').length,0);
});

test('primitive roots and delimiter-like user strings cannot alter the appended frame root', async t=>{
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const values=[null,undefined,true,false,0,-0,NaN,Infinity,-Infinity,123n,
    '" ,"nodes":[ ["object",false,[["seq",999],["id",999]]]]\\"\n汉字😊'];
  for(const value of values){
    const before=f.sent.length;emit(value);await tick();const frame=f.sent.at(-1);
    assert.equal(f.sent.length,before+1);assert.equal(frame.type,'portPost');
    assert.ok(Object.is(frame.data,value));
    f.send({type:'return',id:frame.id,value:undefined});await tick();
  }
  assert.equal(f.failure,undefined);
});

test('map set date and regexp retain cross-references through port transport', async t=>{
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  const shared={value:'shared'},map=new Map([[shared,shared]]),set=new Set([shared,map]);
  const re=/x+/gi;re.lastIndex=2;const data={shared,map,set,date:new Date('2020-01-02T00:00:00Z'),re};
  emit(data);await tick();const frame=f.sent.at(-1),copy=frame.data;
  assert.equal(copy.map.get(copy.shared),copy.shared);assert.ok(copy.set.has(copy.shared));assert.ok(copy.set.has(copy.map));
  assert.equal(copy.date.getTime(),data.date.getTime());assert.equal(copy.re.source,re.source);assert.equal(copy.re.flags,re.flags);assert.equal(copy.re.lastIndex,2);
  f.send({type:'return',id:frame.id,value:undefined});
});

test('large string port snapshots do not need another full parse or byte-array allocation', async t => {
  const f=fixture(t,{autoReply:false}),emit=controlledPort(f);
  await tick();f.send({type:'return',id:f.sent[0].id,value:undefined});await tick();
  // The original desktop startup produces a string-dominated snapshot of this
  // size. The fake receiver still parses it once to verify the emitted frame.
  const payload={body:'a'.repeat(5_659_285)}, parse=JSON.parse, encode=TextEncoder.prototype.encode;
  let largeParses=0, largeByteArrays=0;
  JSON.parse=function(value,...args){if(typeof value==='string'&&value.length>1_000_000)largeParses++;return parse.call(this,value,...args);};
  TextEncoder.prototype.encode=function(value){if(typeof value==='string'&&value.length>1_000_000)largeByteArrays++;return encode.call(this,value);};
  try { emit(payload); } finally { JSON.parse=parse;TextEncoder.prototype.encode=encode; }
  const sent=f.sent.find(frame=>frame.type==='portPost');
  assert.equal(sent?.data.body,payload.body);
  assert.equal(largeParses,1,'only the fake receiver should parse the complete emitted frame');
  assert.equal(largeByteArrays,0,'the bridge should not allocate a second byte array for a validated snapshot');
  f.send({type:'return',id:sent.id,value:undefined});
});

test('only decoded scoped host frames reach the internal catalog receiver',t=>{
 const received=[],ordinary=[];const f=fixture(t,{onInternalViewMessage:value=>{if(value?.type==='kanban-shared-catalog-chunk'){received.push(value);return true}return false}});
 f.win.addEventListener('message',event=>ordinary.push(event.data));
 f.win.dispatchEvent(new f.win.MessageEvent('message',{data:{type:'kanban-shared-catalog-chunk',requestId:'forged'}}));
 assert.equal(received.length,0);
 f.send({type:'viewMessage',data:{type:'kanban-shared-catalog-chunk',requestId:'actual'}});assert.equal(received.length,1);assert.equal(received[0].requestId,'actual');assert.equal(ordinary.length,1);
 f.send({type:'viewMessage',data:{type:'ordinary'}});assert.equal(ordinary.at(-1).type,'ordinary');
});
