import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {createNativeSharedDesktopTransport} = require('../src/native-shared-desktop-transport.cjs');
const sdkSource = process.env.CHATGPT_MCP_SDK_SOURCE;
const sha = value => createHash('sha256').update(value).digest('hex');
const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const threadId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

async function originalMethods() {
  const source = await readFile(sdkSource, 'utf8');
  assert.equal(sha(source), '6ea5bdff2450c39e515ea6cb26de4b51aaff8516cb2a8f97268bfb6dc7e804d6');
  function extract(start, end, digest, skipStart = false) {
    const first = source.indexOf(start);
    assert.ok(first >= 0);
    const a = first + (skipStart ? start.length : 0), b = source.indexOf(end, a);
    assert.ok(b > a);
    const body = source.slice(a, b);
    assert.equal(sha(body), digest);
    return body;
  }
  const onmessage = extract('e.onmessage=', ',e.onerror=', 'fcef0606b07b62e0db8147cefc9c05b43371e7c44079bdf8e062a92192df07cf', true);
  const routeIncoming = extract('routeIncomingMessage(e,t,n=e,r=Date.now()){', 'isLocalAppServerConnection(){', '0dc2bfcdc3507b87df604a05d393998d0500c1434eaaec58ebc3f8b9b6c80da4');
  const routeResponse = extract('routeResponse(e,t){', 'markLoginRequiredForCloudRequirementsAuthError(e,t){', '46cfe61e752ae7513b3c4d0640c4a1d804a762c538cf93e488d9f5af06efa5db');
  // Execute the complete shipped callbacks. JSON-line decoding, SDK services and
  // the result-envelope adapter are local boundaries; no SDK/CLI is launched.
  const boundaries = {
    nf: value => Object.hasOwn(value, 'id') && (Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error')),
    t5: String,
    nj: value => value.error || !value.result ? null : value.result.thread,
    nV: {Zo: value => value},
    q: {F5T: () => false, V57: 'remote-control'},
  };
  const methods = new Function(...Object.keys(boundaries), `return ({${routeIncoming},${routeResponse}});`)(...Object.values(boundaries));
  const install = new Function('e', 't', 'nc', `return (${onmessage});`);
  return {methods, install};
}

test('original SDK consumes a start reply and ACKs before business binding or the owner write receipt settles', {
  skip: !sdkSource && 'Requires fixed original SDK source in CHATGPT_MCP_SDK_SOURCE',
}, async () => {
  const original = await originalMethods();
  const sent = [], pending = new Map(), events = [];
  const transport = createNativeSharedDesktopTransport({
    profileId, generation, verifyRuntimeSync: () => true,
    sendFrame(frame) {
      sent.push(frame);
      if (frame.type === 'shared-desktop-received') events.push(`ack:${frame.sequence}`);
    },
  });
  const hostFrame = (type, fields = {}) => ({v: 1, type, profileId, generation, streamId: transport.streamId, ...fields});
  const bindings = [], writes = [];
  try {
    const connecting = transport.connect();
    transport.receive(hostFrame('shared-desktop-ready'));
    const connection = await connecting;
    const noop = () => {};
    const sdk = {
      ...original.methods, connection, initialized: true,
      options: {hostId: 'kanban-shared-cli', hostConfig: {kind: 'local'}},
      logger: {trace: noop, debug: noop},
      backendAuth: {finishAccountChange: noop},
      clientRequestQueue: {
        get: id => pending.get(id), getResponseMethod: id => pending.get(id)?.method,
        hasCoalescedWaiters: () => false,
        complete(id) { pending.delete(id); return []; },
      },
      internalResponseHandlers: new Map(),
      threadObservations: {observe: noop}, streamTracing: {settleRequest: noop},
      turnCwds: {observeResponse: noop}, configuration: {handleSuccessfulRequest: noop},
      messageDelivery: {getClientRequestHostMetrics: noop, logRoutedResponse: noop},
    };
    sdk.incomingLineProcessor = {
      handleIncomingData(text, receivedAtMs) {
        const result = sdk.routeIncomingMessage(JSON.parse(text), receivedAtMs);
        assert.equal(result.routeKind, 'response');
      },
    };
    connection.onmessage = original.install.call(sdk, connection, 'owned-connection', {});

    for (const sequence of [1, 2]) {
      const id = `thread/start:owned-${sequence}`;
      const request = deferred(), bound = deferred(), written = deferred();
      let businessSettled = false, writeSettled = false;
      const business = request.promise.then(response => {
        events.push(`request-resolved:${sequence}`);
        assert.equal(response.result.thread.id, threadId);
        return bound.promise.then(() => { businessSettled = true; });
      });
      bindings.push({request, bound, business});
      pending.set(id, {
        method: 'thread/start', params: {cwd: '/owned/project'},
        request: {method: 'thread/start', params: {cwd: '/owned/project'}},
        destination: {type: 'host', resolve(response) {
          events.push(`sdk-resolve:${sequence}`);
          request.resolve(response);
        }},
      });
      const response = {id, result: {thread: {id: threadId}}};
      // The owner may deliver bytes synchronously while its IPC write callback
      // remains pending. This is not a second send or a business-completion ACK.
      const writeNative = value => {
        assert.equal(transport.receive(value), true);
        return written.promise.then(() => { writeSettled = true; });
      };
      const write = writeNative(hostFrame('shared-desktop-message', {sequence, text: JSON.stringify(response)}));
      writes.push({written, write});
      assert.equal(pending.has(id), false);
      assert.equal(sent.at(-1).type, 'shared-desktop-received');
      assert.equal(sent.at(-1).sequence, sequence);
      assert.equal(writeSettled, false);
      assert.equal(businessSettled, false);
      assert.ok(events.indexOf(`sdk-resolve:${sequence}`) < events.indexOf(`ack:${sequence}`));
      await Promise.resolve();
      assert.ok(events.indexOf(`ack:${sequence}`) < events.indexOf(`request-resolved:${sequence}`));
      assert.equal(businessSettled, false);
      written.resolve();
      await write;
      assert.equal(writeSettled, true);
      assert.equal(businessSettled, false);
    }
    assert.deepEqual(sent.filter(value => value.type === 'shared-desktop-received').map(value => value.sequence), [1, 2]);
    assert.equal(sent.some(value => value.type === 'shared-desktop-write'), false);
  } finally {
    for (const value of writes) value.written.resolve();
    for (const value of bindings) { value.request.resolve({result: {thread: {id: threadId}}}); value.bound.resolve(); }
    await Promise.all(writes.map(value => value.write));
    await Promise.allSettled(bindings.map(value => value.business));
    transport.close();
  }
});
