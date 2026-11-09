import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import vm from 'node:vm';

const turn = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  const deadline = performance.now() + 750;
  while (!predicate() && performance.now() < deadline) await delay(2);
  assert.ok(predicate(), 'the real renderer/main IPC exchange must finish');
};

async function fixture(t, {acknowledge = true} = {}) {
  const [shim, bootstrap] = await Promise.all(['native-view-shim.js', 'native-bootstrap.cjs'].map(name =>
    readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  const ipc = new MessageChannel(), listeners = new Map(), sent = [], output = [], phases = [];
  let command, nativeEvent, disposedViews = 0, inFlight = 0, peak = 0;
  const sender = {id: 7, mainFrame: {}, send(channel, frame) {
    assert.equal(channel, 'kanban-owned:command');
    if (acknowledge) ipc.port2.postMessage(frame);
  }};
  const record = {viewId: 'owned-view', failed: false, window: {webContents: sender}};
  const actualHandler = bootstrap.match(/electron\.ipcMain\.on\("kanban-owned:event", \(event, frame\) => \{[\s\S]*?\n    \}\);/);
  assert.ok(actualHandler, 'execute the actual native ACK/overflow handler');
  vm.runInNewContext(actualHandler[0], {
    electron: {ipcMain: {on(_channel, callback) { nativeEvent = callback; }}},
    bySender: new Map([[sender.id, record]]), registry: {destroy: async () => { disposedViews++; }},
    writeFirstCause: phase => phases.push(phase), firstCauseEnabled: true,
    output(_record, frame) { output.push(frame); }, send() {},
  });
  ipc.port2.on('message', frame => nativeEvent({sender, senderFrame: sender.mainFrame}, frame));
  ipc.port1.on('message', async frame => {
    if (frame.type === 'ack') inFlight--;
    await command(frame);
  });
  const win = {
    __kanbanOwnedControl: {
      subscribe(callback) { command = callback; },
      emit(frame) {
        sent.push(frame);
        if (frame.type !== 'overflow') { inFlight++; peak = Math.max(peak, inFlight); }
        ipc.port1.postMessage(frame);
      },
    },
    electronBridge: {}, location: {origin: 'app://-'},
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
  };
  vm.runInNewContext(shim, {window: win, MessageChannel, TextEncoder, structuredClone, setTimeout, clearTimeout});
  t.after(async () => { await command({type: 'dispose'}); ipc.port1.close(); ipc.port2.close(); });
  return {sent, output, phases, record, listeners, command,
    emit(data) { listeners.get('message')?.({source: null, data}); },
    get peak() { return peak; }, get inFlight() { return inFlight; },
    get disposedViews() { return disposedViews; },
  };
}

test('a synchronous official-style burst keeps native IPC at 64 while later real ACKs drain exact snapshots', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 80; index++) {
    const value = {type: 'owned-state-update', index, mutable: {value: index}};
    f.emit(value);
    value.mutable.value = -1;
  }
  await until(() => f.output.length === 80 || f.disposedViews > 0);
  assert.equal(f.disposedViews, 0, 'a legitimate burst must not destroy its original view before IPC ACKs can run');
  assert.deepEqual(f.phases, []);
  assert.equal(f.peak, 64, 'the actual IPC awaiting window must never increase');
  assert.deepEqual(f.output.map(frame => frame.data.index), Array.from({length: 80}, (_, index) => index));
  assert.deepEqual(f.output.map(frame => frame.data.mutable.value), Array.from({length: 80}, (_, index) => index));
  await until(() => f.inFlight === 0);
});

test('a missing ACK retains only 64 in flight plus 256 local entries, then fails without values', async t => {
  const f = await fixture(t, {acknowledge: false});
  for (let index = 0; index < 320; index++) f.emit({index});
  assert.equal(f.sent.filter(frame => frame.type !== 'overflow').length, 64);
  assert.equal(f.sent.some(frame => frame.type === 'overflow'), false);
  f.emit({privateValue: 'PRIVATE_VALUE_SENTINEL'});
  await until(() => f.disposedViews > 0);
  assert.equal(f.peak, 64);
  assert.equal(f.sent.at(-1).type, 'overflow');
  assert.equal(f.sent.at(-1).kind, 'awaiting_count');
  assert.deepEqual(Object.keys(f.sent.at(-1)).sort(), ['kind', 'type']);
  assert.equal(JSON.stringify(f.sent.at(-1)).includes('PRIVATE_VALUE_SENTINEL'), false);
});

test('waiting snapshots share the existing eight MiB ceiling with already dispatched frames', async t => {
  const f = await fixture(t, {acknowledge: false});
  f.emit({body: 'x'.repeat(4_200_000)});
  for (let index = 1; index < 64; index++) f.emit({index});
  f.emit({body: 'y'.repeat(4_200_000)});
  await until(() => f.disposedViews > 0);
  assert.equal(f.sent.filter(frame => frame.type !== 'overflow').length, 64);
  assert.equal(f.sent.at(-1).kind, 'awaiting_bytes');
});

test('closing drops local waiting snapshots and late ACKs cannot dispatch them', async t => {
  const f = await fixture(t, {acknowledge: false});
  for (let index = 0; index < 80; index++) f.emit({index});
  await f.command({type: 'dispose'});
  for (let index = 0; index < 64; index++) await f.command({type: 'ack'});
  await turn();
  assert.equal(f.sent.filter(frame => frame.type !== 'overflow').length, 64);
  assert.equal(f.sent.some(frame => frame.type === 'overflow'), false);
  assert.equal(f.listeners.has('message'), false);
});

test('an accessor in a would-be waiting snapshot is rejected without executing it', async t => {
  const f = await fixture(t, {acknowledge: false});
  for (let index = 0; index < 64; index++) f.emit({index});
  let calls = 0;
  const value = {};
  Object.defineProperty(value, 'private', {enumerable: true, get() { calls++; return 'PRIVATE_VALUE_SENTINEL'; }});
  f.emit(value);
  await until(() => f.disposedViews > 0);
  assert.equal(calls, 0);
  assert.equal(f.sent.at(-1).kind, 'unsupported_value');
});
