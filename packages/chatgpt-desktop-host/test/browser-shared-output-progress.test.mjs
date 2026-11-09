import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createConnection, createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {installDesktopBridge} from '../src/browser-bridge.mjs';
import {consumeContainerOutput, decodeContainerOutput} from '../src/container-service.mjs';
import {readBoundedChunks, parseJsonLines} from '../src/json-lines.mjs';
import {encodeWireValue, decodeWireValue} from '../src/wire-value.mjs';

const until = async (predicate, message) => {
  const deadline = performance.now() + 750;
  while (!predicate() && performance.now() < deadline) await delay(2);
  assert.ok(predicate(), typeof message === 'function' ? message() : message);
};

function document(viewId) {
  const scope = {profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', viewId};
  const handlers = new Map(), sent = [], delivered = [], failures = [];
  const channel = new MessageChannel();
  channel.port1.on('message', value => delivered.push(value));
  let receive, sequence = 0;
  const win = {
    performance: {timeOrigin: 1}, MessageChannel, setTimeout, clearTimeout,
    addEventListener(name, callback) { handlers.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); },
  };
  const bridge = installDesktopBridge({window: win, scope,
    bootstrap: {windowType: 'electron', getters: {}, sharedObjects: {}},
    transport: {
      async send(encoded) { sent.push(decodeWireValue(encoded)); },
      subscribe(callback) { receive = callback; return () => {}; },
    },
    onFailure(error) { failures.push(error); },
  });
  handlers.get('message')({source: win, data: {type: 'connect-app-host', port: channel.port2}});
  return {scope, sent, delivered, failures, bridge,
    receive: encoded => receive(encoded),
    encode: frame => encodeWireValue({v: 1, scope, seq: ++sequence, ...frame}),
    posts: () => sent.filter(frame => frame.type === 'portPost'),
    produce() { for (let request = 0; request < 48; request++) channel.port1.postMessage({request}); },
    close() { bridge.dispose(); channel.port1.close(); channel.port2.close(); },
  };
}

test('two real document ports share the native eight-slot reader without trapping later post receipts', {timeout: 4000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cg-output-progress-'));
  const socketPath = join(root, 'owned.sock'), server = createServer();
  const documents = [document('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), document('dddddddd-dddd-4ddd-8ddd-dddddddddddd')];
  let writer, reader, run, cleaning = false, streamFailure;
  t.after(async () => {
    cleaning = true;
    for (const value of documents) value.close();
    writer?.destroy(); reader?.destroy();
    await run;
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  });
  server.listen(socketPath);
  await once(server, 'listening');
  const accepted = once(server, 'connection');
  writer = createConnection(socketPath); writer.on('error', () => {});
  await once(writer, 'connect');
  [reader] = await accepted;
  const seen = [], byView = new Map(documents.map(value => [value.scope.viewId, value]));
  let unfinished = 0, peak = 0;
  run = consumeContainerOutput(parseJsonLines(readBoundedChunks(reader, 65536), {
    maxLineBytes: 8 * 1024 * 1024, maxChunkBytes: 65536,
  }), encoded => {
    const frame = decodeContainerOutput(encoded), target = byView.get(frame.scope.viewId);
    assert.ok(target, 'every output belongs to its exact test document');
    seen.push(frame.type);
    const receipt = target.receive(encoded);
    unfinished++; peak = Math.max(peak, unfinished);
    return Promise.resolve(receipt).finally(() => unfinished--);
  }).catch(error => { if (!cleaning) streamFailure = error; });
  const emit = (target, frame) => writer.write(target.encode(frame) + '\n');

  await until(() => documents.every(value => value.sent.some(frame => frame.type === 'openPort')), 'both actual MessagePorts requested their native endpoint');
  for (const value of documents) emit(value, {type: 'return', id: value.sent[0].id, value: undefined});
  await until(() => seen.length === 2, 'both actual open receipts traversed the Unix pipe');
  for (const value of documents) value.produce();
  await until(() => documents.every(value => value.bridge.getResourceUsage().rawSnapshots === 48), 'both real producers reached their unchanged local window');
  assert.deepEqual(documents.map(value => value.posts().length), [32, 32]);
  for (let reply = 0; reply < 4; reply++) for (const value of documents)
    emit(value, {type: 'portMessage', portId: 'app-host-1', data: {reply}});
  // These are real pending portPost IDs. No model reply or successful native
  // operation is synthesized: only the transport receipt needed to free input.
  for (const value of documents) emit(value, {type: 'return', id: value.posts()[0].id, value: undefined});
  await until(() => seen.length >= 10, 'the shared native reader admitted all eight document data frames');
  assert.ok(peak <= 8, 'the original shared output window must remain eight');
  await until(() => documents.every(value => value.posts().length === 33),
    () => 'later post receipts are trapped behind the shared eight-slot window: ' + JSON.stringify({
      seen: seen.length, unfinished, peak,
      posts: documents.map(value => value.posts().length),
      delivered: documents.map(value => value.delivered.length),
      failures: documents.map(value => value.failures.map(error => error.code)),
    }));
  assert.equal(streamFailure, undefined);
  assert.ok(documents.every(value => value.failures.length === 0));
  assert.ok(documents.every(value => value.delivered.length > 0), 'each real MessagePort made bounded progress');
  for (const value of documents) {
    const usage = value.bridge.getResourceUsage();
    assert.ok(usage.peakPendingRPC <= 64);
    assert.ok(usage.peakInFlightPortPosts <= 32);
    assert.ok(usage.peakHeldLogicalBytes <= 8 * 1024 * 1024);
  }
});
