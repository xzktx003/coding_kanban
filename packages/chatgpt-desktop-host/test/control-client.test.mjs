import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once, EventEmitter } from 'node:events';
import { encodeWireValue, decodeWireValue } from '../src/wire-value.mjs';
import { parseJsonLines } from '../src/json-lines.mjs';
import { connectDesktopControl, readDesktopProjectPersistence } from '../src/control-client.mjs';

const id = '43e56e8a-de3f-40fb-8cf3-7177d17d24f1', generation = 'b94128f4-288c-4c97-a5cb-891555dc8199', viewId = '9d79066f-f08f-4f00-a75e-e24cc65e5d00';
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-control-')); await chmod(dir, 0o700);
  const sockets = new Set(), received = [], events = new EventEmitter();
  const profile = { id, generation, pid: process.pid, startTicks: '12345', controlSocketPath: path.join(dir, 'control.sock') };
  const scope = { profileId: id, generation, viewId };
  let serverSocket, pauseGate, releasePause, paused = false;
  const server = createServer(socket => {
    serverSocket = socket; sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    void (async () => {
      for await (const line of parseJsonLines(socket)) {
        if (pauseGate) { paused = true; events.emit('paused'); await pauseGate; }
        const frame = decodeWireValue(line); received.push(frame); events.emit('received');
        let reply;
        if (frame.type === 'hello') reply = overrides.helloFrame ?? { v: 1, type: 'hello', profileId: id, generation, pid: process.pid, startTicks: '12345', ...overrides.hello };
        else if (frame.type === 'createView') reply = overrides.createViewFrame ?? { v: 1, type: 'bootstrap', scope, bootstrap: { windowType: 'electron', getters: {}, sharedObjects: {} } };
        else if (frame.type === 'projectPersistenceStatus') reply = { v: 1, type: 'projectPersistenceStatus', state: overrides.status };
        if (reply && !overrides.silent) socket.write(encodeWireValue(reply) + '\n');
      }
    })().catch(() => {});
  });
  server.listen(profile.controlSocketPath); await once(server, 'listening'); await chmod(profile.controlSocketPath, 0o600);
  t.after(async () => { releasePause?.(); for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { profile, scope, received, waitReceived: async count => { while (received.length < count) await once(events, 'received', { signal: AbortSignal.timeout(1000) }); }, connect: extra => connectDesktopControl({ profile, viewId, verifyProfile: async () => true, ...extra }), pause: () => { pauseGate = new Promise(resolve => { releasePause = resolve; }); }, waitPaused: async () => { if (!paused) await once(events, 'paused', { signal: AbortSignal.timeout(1000) }); }, send: value => serverSocket.write(encodeWireValue(value) + '\n') };
}

test('opens only the fixed private socket, checks runtime hello, then creates one exact view', async t => {
  const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
  assert.deepEqual(connection.scope, f.scope); assert.equal(connection.bootstrap.windowType, 'electron');
  assert.deepEqual(f.received.map(x => x.type), ['hello', 'createView']);
  const frame = { v: 1, scope: f.scope, seq: 1, type: 'call', id: 1, method: 'sendMessageFromView', args: [{ type: 'fixture' }] };
  await connection.sendFrame(encodeWireValue(frame));
  await f.waitReceived(3);
  assert.deepEqual(f.received[2], frame);
  f.send({ v: 1, scope: f.scope, seq: 1, type: 'return', id: 1, value: new Uint8Array([0, 255]) });
  const next = await connection.frames[Symbol.asyncIterator]().next();
  assert.deepEqual(decodeWireValue(next.value).value, new Uint8Array([0, 255]));
});

test('reads only scoped status without creating a view, and clamps unknown values', async t => {
  for (const [value, expected] of [['unsupported', 'unsupported'], ['private-path', 'unknown'], [undefined, 'unknown']]) {
    const f = await fixture(t, { status: value });
    const status = await readDesktopProjectPersistence({ profile: f.profile, verifyProfile: async () => true, timeoutMs: 1000 });
    assert.equal(status, expected);
    assert.deepEqual(f.received.map(x => x.type), ['hello', 'projectPersistenceStatus']);
  }
});

test('hello-only status rejects changed profile identity and never creates a view', async t => {
  const f = await fixture(t, { hello: { pid: process.pid + 1 }, status: 'active' });
  await assert.rejects(readDesktopProjectPersistence({ profile: f.profile, verifyProfile: async () => true, timeoutMs: 1000 }), { code: 'CONTROL_IDENTITY_CHANGED' });
  assert.deepEqual(f.received.map(x => x.type), ['hello']);
});

test('refuses another process or runtime generation and never falls back', async t => {
  for (const hello of [{ generation: id }, { pid: process.pid + 1 }, { startTicks: 'changed' }]) {
    const f = await fixture(t, { hello });
    await assert.rejects(f.connect(), { code: 'CONTROL_IDENTITY_CHANGED' });
    assert.equal(f.received.length, 1);
  }
});

test('rejects a batch when the bound profile changes before its write', async t => {
  const f = await fixture(t); let valid = true;
  const connection = await f.connect({ verifyProfile: async () => valid }); t.after(() => connection.close());
  valid = false;
  await assert.rejects(connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: 1, type: 'call', id: 1, method: 'sendMessageFromView', args: [] })), { code: 'CONTROL_IDENTITY_CHANGED' });
  assert.deepEqual(f.received.map(x => x.type), ['hello', 'createView']);
});

test('rejects malformed, changed-scope and out-of-order client frames before writing', async t => {
  for (const change of [{ scope: { profileId: id, generation: id, viewId } }, { seq: 2 }, { type: 'executeJavaScript', source: 'x' }]) {
    const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
    await assert.rejects(connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: 1, type: 'call', id: 1, method: 'sendMessageFromView', args: [], ...change })));
    assert.equal(f.received.length, 2);
  }
});

test('rejects incoming runtime change and closes its own connection', async t => {
  const f = await fixture(t), connection = await f.connect();
  f.send({ v: 1, scope: { ...f.scope, viewId: id }, seq: 1, type: 'viewMessage', data: {} });
  await assert.rejects(connection.frames[Symbol.asyncIterator]().next(), { code: 'CONTROL_IDENTITY_CHANGED' });
});

test('cancels an incomplete handshake and does not replay it', async t => {
  const f = await fixture(t, { silent: true });
  await assert.rejects(f.connect({ timeoutMs: 20 }), { code: 'CONTROL_TIMEOUT' });
  assert.deepEqual(f.received.map(x => x.type), ['hello']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.connect({ signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.equal(f.received.length, 1);
});

test('batches at most eight immutable frames per fresh identity check over a real Unix socket', async t => {
  const f = await fixture(t); let active = false, checks = 0;
  const connection = await f.connect({ verifyProfile: async () => { if (active) { checks++; await new Promise(resolve => setTimeout(resolve, 10)); } return true; } });
  t.after(() => connection.close()); active = true;
  const burst = Array.from({ length: 20 }, (_, index) => ({ v: 1, scope: f.scope, seq: index + 1, type: 'call', id: index + 1, method: 'sendMessageFromView', args: [{ value: index }] }));
  const began = performance.now();
  await Promise.all(burst.map(frame => connection.sendFrame(encodeWireValue(frame))));
  await f.waitReceived(22);
  const elapsed = Math.round(performance.now() - began);
  t.diagnostic(`20 frames, ${checks} identity checks at 10ms each, ${elapsed}ms; real Unix socket`);
  assert.equal(checks, 3, `fresh checks for 20 frames; elapsed ${elapsed}ms`);
  assert.deepEqual(f.received.slice(2), burst);
});

test('a changed profile blocks the next batch without retrying or sending those frames', async t => {
  const f = await fixture(t); let active = false, checks = 0;
  const connection = await f.connect({ verifyProfile: async () => !active || ++checks === 1 });
  t.after(() => connection.close()); active = true;
  const deliveries = Array.from({ length: 10 }, (_, index) => connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: index + 1, type: 'call', id: index + 1, method: 'sendMessageFromView', args: [] })));
  const results = await Promise.allSettled(deliveries);
  await f.waitReceived(10);
  assert.equal(checks, 2); assert.equal(results.filter(result => result.status === 'fulfilled').length, 8);
  for (const result of results.slice(8)) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'CONTROL_IDENTITY_CHANGED'); }
  assert.deepEqual(f.received.slice(2).map(frame => frame.seq), [1,2,3,4,5,6,7,8]);
});

test('abort immediately rejects unsent queued frames while an identity check is pending', async t => {
  const f = await fixture(t); let active = false, release, checking;
  const checked = new Promise(resolve => { checking = resolve; });
  const guard = new Promise(resolve => { release = resolve; });
  const abort = new AbortController();
  const connection = await f.connect({ signal: abort.signal, verifyProfile: async () => { if (!active) return true; checking(); return guard; } });
  t.after(() => { release(true); connection.close(); }); active = true;
  const delivery = connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: 1, type: 'call', id: 1, method: 'sendMessageFromView', args: [] }));
  const assertion = assert.rejects(delivery, { code: 'ABORT_ERR' });
  await checked; abort.abort();
  const immediate = await Promise.race([assertion.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
  release(true); await assertion;
  assert.equal(immediate, true); assert.equal(f.received.length, 2);
});

test('abort during the initial asynchronous identity check never opens the control socket', async t => {
  const f = await fixture(t), abort = new AbortController(); let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const checking = new Promise(resolve => { started = resolve; });
  const connection = f.connect({ signal: abort.signal, verifyProfile: async () => { started(); return gate; } });
  const assertion = assert.rejects(connection, { code: 'ABORT_ERR' });
  await checking; abort.abort(); release(true); await assertion;
  assert.equal(f.received.length, 0);
});

test('abort marks dispatched writes with an unknown outcome and never replays them', async t => {
  const f = await fixture(t), abort = new AbortController();
  const connection = await f.connect({ signal: abort.signal }); t.after(() => connection.close());
  f.pause();
  const payload = 'x'.repeat(900 * 1024);
  const deliveries = Array.from({ length: 8 }, (_, index) => connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: index + 1, type: 'call', id: index + 1, method: 'sendMessageFromView', args: [payload] })));
  const results = Promise.allSettled(deliveries);
  await f.waitPaused(); abort.abort();
  const settled = await results;
  assert.ok(settled.some(result => result.status === 'rejected'));
  for (const result of settled) if (result.status === 'rejected') assert.equal(result.reason.code, 'CONTROL_OUTCOME_UNKNOWN');
  await assert.rejects(connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq: 9, type: 'call', id: 9, method: 'sendMessageFromView', args: [] })), { code: 'ABORT_ERR' });
});

test('the aggregate eight MiB queue budget rejects before any pending frame is written', async t => {
  const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
  const payload = 'x'.repeat(4 * 1024 * 1024);
  const deliveries = [1,2].map(seq => connection.sendFrame(encodeWireValue({ v: 1, scope: f.scope, seq, type: 'call', id: seq, method: 'sendMessageFromView', args: [payload] })));
  const results = await Promise.allSettled(deliveries);
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'CONTROL_QUEUE_FULL'); }
  assert.equal(f.received.length, 2);
});

test('propagates exact bounded broker error codes instead of misreporting them as sequence changes', async t => {
  for (const code of ['CONTROL_QUEUE_FULL','CONTROL_PROTOCOL_ERROR','CONTROL_UPSTREAM_ERROR','CONTROL_HANDSHAKE_TIMEOUT']) {
    const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
    const next = connection.frames[Symbol.asyncIterator]().next();
    f.send({ v: 1, type: 'error', code });
    await assert.rejects(next, { code });
  }
});

test('rejects malformed or unknown broker error codes without exposing their contents', async t => {
  for (const change of [{code:'secret-payload'}, {code:'CONTROL_QUEUE_FULL',extra:'secret-payload'}]) {
    const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
    const next = connection.frames[Symbol.asyncIterator]().next();
    f.send({ v: 1, type: 'error', ...change });
    await assert.rejects(next, error => error.code === 'CONTROL_INVALID_FRAME' && !String(error.message).includes('secret-payload'));
  }
});

test('reports only safe direction, sequence and scope-match metadata for a genuine received-frame mismatch', async t => {
  const f = await fixture(t), connection = await f.connect(); t.after(() => connection.close());
  const next = connection.frames[Symbol.asyncIterator]().next();
  f.send({ v: 1, type:'viewMessage', scope:{...f.scope,viewId:id}, seq:7, data:{secret:'do-not-log'} });
  await assert.rejects(next, error => {
    assert.equal(error.code,'CONTROL_IDENTITY_CHANGED');
    assert.deepEqual(error.controlMeta,{direction:'native_to_gateway',expectedSeq:1,actualSeq:7,versionMatches:true,profileMatches:true,generationMatches:true,viewMatches:false,scopeShapeMatches:true,frameType:'viewMessage'});
    for (const secret of ['do-not-log',id,viewId,generation]) assert.equal(JSON.stringify(error.controlMeta).includes(secret),false);
    return true;
  });
});


test('recognizes only exact broker errors during hello and bootstrap', async t => {
  for (const stage of ['helloFrame','createViewFrame']) {
    const f = await fixture(t, { [stage]: { v: 1, type: 'error', code: 'CONTROL_UPSTREAM_ERROR' } });
    await assert.rejects(f.connect(), { code: 'CONTROL_UPSTREAM_ERROR' });
    const invalid = await fixture(t, { [stage]: { v: 1, type: 'error', code: 'secret-value' } });
    await assert.rejects(invalid.connect(), { code: 'CONTROL_INVALID_FRAME' });
  }
});
