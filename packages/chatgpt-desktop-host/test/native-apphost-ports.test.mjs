import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { EventEmitter, once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createOwnedAppHostPorts } = require('../src/native-apphost-ports.cjs');

class MainPort extends EventEmitter {
  constructor(port) {
    super(); this.port = port; this.closed = false;
    port.on('message', data => this.emit('message', {data}));
    port.on('close', () => this.emit('close'));
  }
  start() { this.port.start(); }
  postMessage(value) { this.port.postMessage(value); }
  close() { this.closed = true; this.port.close(); }
}

function fixture() {
  const sender = {id: 7, mainFrame: {}};
  const record = {senderId:7, viewId:'view-a', failed:false, bootstrapped:true,
    window:{webContents:sender, isDestroyed:() => false}, pending:new Map(), ports:new Set()};
  const live = new Map([[sender,record]]), outputs = [], failures = [];
  const router = createOwnedAppHostPorts({getOwnedRecord:s => live.get(s),
    output:(r,f) => outputs.push([r,f]), fail:r => failures.push(r)});
  function pending(id, portId = 'app-host-1') {
    record.pending.set(id,{type:'openPort',portId}); record.ports.add(portId);
  }
  const event = ports => ({sender,senderFrame:sender.mainFrame,ports});
  return {sender,record,live,outputs,failures,router,pending,event};
}

test('adopt acknowledges only after owned transfer and exchanges real frames', async t => {
  const f = fixture(), {port1,port2} = new MessageChannel(), main = new MainPort(port1);
  t.after(() => { f.router.retire(f.record); port2.close(); });
  f.pending(1);
  assert.equal(f.outputs.length,0);
  assert.equal(f.router.adopt(f.event([main]),{id:1,portId:'app-host-1'}),true);
  assert.deepEqual(f.outputs.map(([,frame]) => frame),[{type:'return',id:1,value:undefined}]);
  f.record.pending.set(2,{type:'portPost',portId:'app-host-1'});
  const received = once(port2,'message');
  f.router.dispatch(f.record,{type:'portPost',id:2,portId:'app-host-1',data:{value:7}});
  assert.deepEqual((await received)[0],{value:7});
  assert.deepEqual(f.outputs.at(-1)[1],{type:'return',id:2,value:undefined});
  const returned = once(main,'message');
  port2.postMessage({reply:'ok'}); await returned;
  assert.deepEqual(f.outputs.at(-1)[1],{type:'portMessage',portId:'app-host-1',data:{reply:'ok'}});
});

test('wrong sender, frame, pending id and duplicate transfer cannot acquire an owned port', t => {
  const f = fixture(); f.pending(1);
  const ports = [];
  function fresh() { const pair = new MessageChannel(), main = new MainPort(pair.port1); ports.push([main,pair.port2]); return main; }
  t.after(() => { f.router.retire(f.record); for (const [main,peer] of ports) { main.close(); peer.close(); } });
  const foreign = {id:7,mainFrame:{}};
  const wrongSender = fresh();
  assert.equal(f.router.adopt({sender:foreign,senderFrame:foreign.mainFrame,ports:[wrongSender]}, {id:1,portId:'app-host-1'}),false);
  assert.equal(wrongSender.closed,true);
  const wrongFrame = fresh();
  assert.equal(f.router.adopt({sender:f.sender,senderFrame:{},ports:[wrongFrame]}, {id:1,portId:'app-host-1'}),false);
  assert.equal(wrongFrame.closed,true);
  const wrongId = fresh();
  assert.equal(f.router.adopt(f.event([wrongId]),{id:2,portId:'app-host-1'}),false);
  assert.equal(wrongId.closed,true);
  assert.equal(f.outputs.length,0);
  const good = fresh();
  assert.equal(f.router.adopt(f.event([good]),{id:1,portId:'app-host-1'}),true);
  const duplicate = fresh();
  assert.equal(f.router.adopt(f.event([duplicate]),{id:1,portId:'app-host-1'}),false);
  assert.equal(duplicate.closed,true); assert.equal(good.closed,false);
  assert.equal(f.outputs.length,1);
});

test('close/retire affect only the owned port and suppress late events', async t => {
  const f = fixture(), pair = new MessageChannel(), main = new MainPort(pair.port1);
  t.after(() => { main.close(); pair.port2.close(); });
  f.pending(1); f.router.adopt(f.event([main]),{id:1,portId:'app-host-1'});
  f.record.pending.set(2,{type:'closePort',portId:'app-host-1'});
  f.router.dispatch(f.record,{type:'closePort',id:2,portId:'app-host-1'});
  assert.equal(main.closed,true); assert.equal(f.record.ports.has('app-host-1'),false);
  const count = f.outputs.length;
  main.emit('message',{data:'late'}); main.emit('close');
  assert.equal(f.outputs.length,count);
  assert.equal(f.outputs.at(-1)[1].type,'return');
  f.router.retire(f.record);
});

test('posting failure throws only once without claiming success', t => {
  const f = fixture(), pair = new MessageChannel(), main = new MainPort(pair.port1);
  t.after(() => { f.router.retire(f.record); pair.port2.close(); });
  f.pending(1); f.router.adopt(f.event([main]),{id:1,portId:'app-host-1'});
  main.postMessage = () => { throw Error('uncloneable'); };
  f.record.pending.set(2,{type:'portPost',portId:'app-host-1'});
  f.router.dispatch(f.record,{type:'portPost',id:2,portId:'app-host-1',data:null});
  assert.deepEqual(f.outputs.at(-1)[1],{type:'throw',id:2});
});

test('eight original port requests are posted and acknowledged independently', async t => {
  const f = fixture(), pair = new MessageChannel(), main = new MainPort(pair.port1);
  t.after(() => { f.router.retire(f.record); pair.port2.close(); });
  f.pending(1); f.router.adopt(f.event([main]),{id:1,portId:'app-host-1'});
  const received = [];
  pair.port2.on('message', value => received.push(value)); pair.port2.start();
  for (let i=0; i<8; i++) {
    const id = i+2, data = {request:i, body:['original',i]};
    f.record.pending.set(id,{type:'portPost',portId:'app-host-1'});
    f.router.dispatch(f.record,{type:'portPost',id,portId:'app-host-1',data});
  }
  await new Promise(resolve => setTimeout(resolve,20));
  assert.deepEqual(received,Array.from({length:8},(_,i) => ({request:i,body:['original',i]})));
  assert.deepEqual(f.outputs.slice(1).map(([,frame]) => frame.id),[2,3,4,5,6,7,8,9]);
  assert.equal(f.record.pending.size,0);
});
