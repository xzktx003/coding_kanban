import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { NativeCodexReadonlyClient, verifyExtensionHost } from '../src/index.mjs';

const compatibility = Object.freeze({
  extensionVersion: '26.51002.51308',
  hostSha256: 'bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c',
});

// Independent fixture encoder: no production framing helpers are imported.
function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function success(request, result, owner = 'owner-panel-A') {
  return { type: 'response', requestId: request.requestId, resultType: 'success',
    method: request.method, handledByClientId: owner, result };
}

async function fixture(t, handler, extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'nca-'));
  await mkdir(join(home, 'ipc'), { mode: 0o700 });
  const socketPath = join(home, 'ipc', 'ipc.sock');
  const messages = [];
  const sockets = new Set();
  let peer;
  const server = createServer((socket) => {
    peer = socket;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let bytes = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4 && bytes.length >= 4 + bytes.readUInt32LE(0)) {
        const size = bytes.readUInt32LE(0);
        const message = JSON.parse(bytes.subarray(4, 4 + size));
        bytes = bytes.subarray(4 + size);
        messages.push(message);
        if (message.method === 'initialize') {
          assert.equal(message.sourceClientId, 'initializing-client');
          assert.equal(message.version, 0);
          assert.deepEqual(message.params, { clientType: 'vscode' });
          assert.equal(message.type, 'request');
          if (extra.initializeReply !== null) socket.write(Buffer.concat([frame(extra.initializeReply?.(message) ??
            success(message, { clientId: 'adapter-client' }, 'adapter-client')), extra.initializeSuffix ?? Buffer.alloc(0)]));
        } else handler?.(message, socket);
      }
    });
  });
  server.listen(socketPath);
  await once(server, 'listening');
  await chmod(socketPath, 0o600);
  let client;
  t.after(async () => {
    client?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  const options = { isolatedCodexHome: home, socketPath, compatibility, timeoutMs: 200, ...extra };
  return { home, socketPath, options, messages, get peer() { return peer; },
    async connect() { client = await NativeCodexReadonlyClient.connect(options); return client; } };
}

test('exact initialize, local owner discovery and targeted read, split UTF-8/coalesced frames', async (t) => {
  const f = await fixture(t, (request, socket) => {
    assert.equal(request.sourceClientId, 'adapter-client');
    assert.equal(request.version, 1);
    if (request.method === 'thread-owner-discovery') {
      assert.deepEqual(request.params, { hostId: 'local', conversationId: 'thread-A' });
      socket.write(frame(success(request, { supportsUntrustedAppInput: true })));
    } else {
      assert.equal(request.method, 'thread-follower-read-model-settings');
      assert.equal(request.targetClientId, 'owner-panel-A');
      assert.equal(request.hostId, undefined);
      assert.deepEqual(request.params, { conversationId: 'thread-A' });
      const wire = frame(success(request, { model: '测试-model', reasoningEffort: 'high' }));
      const utf8 = wire.indexOf(Buffer.from('测'));
      socket.write(wire.subarray(0, 2));
      socket.write(wire.subarray(2, utf8 + 1));
      socket.write(Buffer.concat([wire.subarray(utf8 + 1), frame(success(request, { duplicate: true }))]));
    }
  });
  const client = await f.connect();
  const owner = await client.findOwner({ hostId: 'local', conversationId: 'thread-A' });
  assert.deepEqual(owner, { hostId: 'local', conversationId: 'thread-A', targetClientId: 'owner-panel-A',
    methodVersions: { ownerDiscovery: 1, readModelSettings: 1 } });
  assert.deepEqual(await client.readModelSettings(owner), { model: '测试-model', reasoningEffort: 'high' });
  assert.equal(f.messages.length, 4); // initialize + discovery + recheck + read
  assert.equal(f.messages[2].targetClientId, owner.targetClientId);
  assert.equal(client.diagnostics.pendingRequests, 0);
  assert.equal(client.sendRequest, undefined);
});

test('remote ownership preserves host identity and increments follower version', async (t) => {
  const f = await fixture(t, (request, socket) => {
    if (request.method === 'thread-owner-discovery') {
      assert.equal(request.version, 1);
      assert.equal(request.params.hostId, 'remote-A');
    } else {
      assert.equal(request.hostId, 'remote-A');
      assert.equal(request.version, 2);
    }
    socket.write(frame(success(request, { model: 'remote-model' })));
  });
  const client = await f.connect();
  const owner = await client.findOwner({ hostId: 'remote-A', conversationId: 'thread-A' });
  assert.equal(owner.methodVersions.readModelSettings, 2);
  assert.deepEqual(await client.readModelSettings(owner), { model: 'remote-model' });
});

test('no owner returns null; no-client-found does not close the client', async (t) => {
  const f = await fixture(t, (request, socket) => socket.write(frame({ type: 'response',
    requestId: request.requestId, resultType: 'error', error: 'no-client-found' })));
  const client = await f.connect();
  assert.equal(await client.findOwner({ hostId: 'local', conversationId: 'absent' }), null);
  assert.equal(client.diagnostics.closed, false);
});

test('owner capabilities cannot be forged, changed or used on another client', async (t) => {
  const f = await fixture(t, (request, socket) => socket.write(frame(success(request, {}))));
  const client = await f.connect();
  const owner = await client.findOwner({ hostId: 'local', conversationId: 'thread-A' });
  assert.equal(Object.isFrozen(owner), true);
  assert.equal(Object.isFrozen(owner.methodVersions), true);
  await assert.rejects(client.readModelSettings({ ...owner, conversationId: 'thread-B' }), /invalid-owner/);
  const g = await fixture(t);
  const other = await g.connect();
  await assert.rejects(other.readModelSettings(owner), /invalid-owner/);
  assert.equal(g.messages.length, 1);
});

test('owner changes are rejected before any model read', async (t) => {
  let discovery = 0;
  const f = await fixture(t, (request, socket) => {
    assert.equal(request.method, 'thread-owner-discovery');
    socket.write(frame(success(request, {}, ++discovery === 1 ? 'owner-panel-A' : 'owner-panel-B')));
  });
  const client = await f.connect();
  const owner = await client.findOwner({ hostId: 'local', conversationId: 'thread-A' });
  await assert.rejects(client.readModelSettings(owner), /response-owner-mismatch/);
  assert.equal(f.messages.length, 3);
});

test('readonly client denies incoming discovery and requests without running handlers', async (t) => {
  const f = await fixture(t);
  const client = await f.connect();
  f.peer.write(Buffer.concat([
    frame({ type: 'client-discovery-request', requestId: 'probe-1', request: {
      method: 'thread-follower-start-turn', version: 2 } }),
    frame({ type: 'request', requestId: 'probe-2', method: 'thread-follower-read-model-settings', version: 99 }),
    frame({ type: 'request', requestId: 'probe-3', method: 'thread-owner-discovery', version: 1 }),
    frame({ type: 'request', requestId: 'probe-4', method: 'thread-follower-start-turn', version: 2 }),
    frame({ type: 'request', requestId: 'probe-5', method: 'thread-follower-interrupt-turn', version: 3 }),
    frame({ type: 'request', requestId: 'probe-6', method: 'unknown-method', version: 0 }),
  ]));
  for (let i = 0; i < 30 && f.messages.length < 7; i++) await delay(5);
  assert.deepEqual(f.messages.slice(1), [
    { type: 'client-discovery-response', requestId: 'probe-1', response: { canHandle: false } },
    { type: 'response', requestId: 'probe-2', resultType: 'error', error: 'request-version-mismatch' },
    { type: 'response', requestId: 'probe-3', resultType: 'error', error: 'no-handler-for-request' },
    { type: 'response', requestId: 'probe-4', resultType: 'error', error: 'no-handler-for-request' },
    { type: 'response', requestId: 'probe-5', resultType: 'error', error: 'no-handler-for-request' },
    { type: 'response', requestId: 'probe-6', resultType: 'error', error: 'no-handler-for-request' },
  ]);
  assert.equal(client.diagnostics.pendingRequests, 0);
});

test('timeout clears pending work and late response cannot resolve a new request', async (t) => {
  const f = await fixture(t, undefined, { timeoutMs: 25 });
  const client = await f.connect();
  await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /timeout/);
  assert.equal(client.diagnostics.pendingRequests, 0);
  f.peer.write(frame(success(f.messages.at(-1), {})));
  await delay(10);
  assert.equal(client.diagnostics.pendingRequests, 0);
});

test('close rejects work, releases partial frame and timers, and never reconnects', async (t) => {
  const f = await fixture(t);
  const client = await f.connect();
  const pending = client.findOwner({ hostId: 'local', conversationId: 'thread-A' });
  const rejected = assert.rejects(pending, /client-closed/);
  f.peer.write(Buffer.from([30, 0, 0, 0, 123]));
  await delay(10);
  assert.equal(client.diagnostics.bufferedBytes > 0, true);
  client.close();
  client.close();
  await rejected;
  assert.deepEqual(client.diagnostics, { closed: true, pendingRequests: 0, bufferedBytes: 0, frameTimerActive: false });
  await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /client-closed/);
});

test('peer disconnect rejects pending requests promptly', async (t) => {
  const f = await fixture(t, (_request, socket) => socket.destroy());
  const client = await f.connect();
  await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /connection-closed/);
  assert.equal(client.diagnostics.pendingRequests, 0);
});

for (const [name, makeWire] of [
  ['zero frame', () => Buffer.alloc(4)],
  ['oversized frame', () => { const h = Buffer.alloc(4); h.writeUInt32LE(1025); return h; }],
  ['invalid JSON', () => Buffer.from([1, 0, 0, 0, 123])],
  ['invalid UTF-8', () => Buffer.from([3, 0, 0, 0, 34, 255, 34])],
]) {
  test(`${name} closes the socket and frees pending state`, async (t) => {
    const f = await fixture(t, (_request, socket) => socket.write(makeWire()), { maxFrameBytes: 1024 });
    const client = await f.connect();
    await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /invalid-frame|invalid-json|invalid-utf8|invalid-message/);
    assert.equal(client.diagnostics.closed, true);
    assert.equal(client.diagnostics.bufferedBytes, 0);
    assert.equal(client.diagnostics.pendingRequests, 0);
  });
}

test('stalled partial frame has its own bounded deadline', async (t) => {
  const f = await fixture(t, (_request, socket) => socket.write(Buffer.from([20, 0, 0, 0, 123])),
    { timeoutMs: 200, frameTimeoutMs: 25 });
  const client = await f.connect();
  await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /frame-timeout/);
  assert.equal(client.diagnostics.bufferedBytes, 0);
  assert.equal(client.diagnostics.frameTimerActive, false);
});

for (const mutation of [
  (r) => ({ ...r, method: 'thread-follower-start-turn' }),
  (r) => ({ ...r, version: 99 }),
  (r) => ({ ...r, handledByClientId: 'adapter-client' }),
  (r) => ({ ...r, resultType: 'unknown' }),
]) {
  test('malformed/mismatched success cannot create an owner capability', async (t) => {
    const f = await fixture(t, (request, socket) => socket.write(frame(mutation(success(request, {})))));
    const client = await f.connect();
    await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-A' }), /response-/);
    assert.equal(client.diagnostics.pendingRequests, 0);
  });
}

test('pending request cap prevents unbounded request maps', async (t) => {
  const f = await fixture(t, undefined, { maxPendingRequests: 1 });
  const client = await f.connect();
  const first = client.findOwner({ hostId: 'local', conversationId: 'thread-A' });
  const stopped = assert.rejects(first, /client-closed/);
  await assert.rejects(client.findOwner({ hostId: 'local', conversationId: 'thread-B' }), /pending-request-limit/);
  assert.equal(client.diagnostics.pendingRequests, 1);
  client.close();
  await stopped;
});

test('unknown extension version and digest fail before socket connection', async (t) => {
  const f = await fixture(t);
  for (const bad of [{ ...compatibility, extensionVersion: '99.0.0' },
    { ...compatibility, hostSha256: 'a'.repeat(64) }]) {
    await assert.rejects(NativeCodexReadonlyClient.connect({ ...f.options, compatibility: bad }), /unsupported-extension/);
  }
  assert.equal(f.peer, undefined);
});

test('known second manifest version requires the same verified host digest', async (t) => {
  const f = await fixture(t, undefined, { compatibility: { ...compatibility, extensionVersion: '26.1002.51308' } });
  const client = await f.connect();
  assert.equal(client.diagnostics.closed, false);
  const unknownHost = join(f.home, 'host.mjs');
  await writeFile(unknownHost, 'unrecognized official host implementation');
  await assert.rejects(verifyExtensionHost({ extensionHostPath: unknownHost, extensionVersion: compatibility.extensionVersion }), /unsupported-extension/);
});

test('initialize timeout or malformed identity never yields a usable client', async (t) => {
  for (const initializeReply of [null, (request) => success(request, { clientId: 'wrong-id' }, 'adapter-client')]) {
    const f = await fixture(t, undefined, { timeoutMs: 25, initializeReply });
    await assert.rejects(f.connect(), /timeout|response-initialize-invalid/);
  }
});

test('initialize native error rejects connect and destroys its socket', async (t) => {
  const f = await fixture(t, undefined, { initializeReply: (request) => ({ type: 'response',
    requestId: request.requestId, resultType: 'error', error: 'server-closed' }) });
  await assert.rejects(f.connect(), /native-request-error:server-closed/);
  for (let i = 0; i < 30 && !f.peer.destroyed; i++) await delay(5);
  assert.equal(f.peer.destroyed, true);
  assert.equal(f.messages.length, 1);
});

test('initialize success followed by protocol close never returns a closed client', async (t) => {
  const f = await fixture(t, undefined, { initializeSuffix: Buffer.alloc(4) });
  await assert.rejects(f.connect(), /invalid-frame-length/);
});

test('current configured CODEX_HOME cannot be claimed as isolated home', async (t) => {
  const f = await fixture(t);
  const original = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = f.home;
    await assert.rejects(f.connect(), /default-home-forbidden/);
    await assert.rejects(NativeCodexReadonlyClient.connect({ ...f.options,
      isolatedCodexHome: join(f.home, 'nested'), socketPath: join(f.home, 'nested', 'ipc', 'ipc.sock') }), /default-home-forbidden/);
    assert.equal(f.peer, undefined);
  } finally {
    if (original === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = original;
  }
});

test('configured default home symlink alias is rejected by canonical identity', async (t) => {
  const f = await fixture(t);
  const alias = join(f.home, 'default-alias');
  await symlink(f.home, alias);
  const original = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = alias;
    await assert.rejects(f.connect(), /default-home-forbidden/);
    assert.equal(f.peer, undefined);
  } finally {
    if (original === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = original;
  }
});

test('bounded outbound socket queue rejects excess bytes and cleans up', async (t) => {
  const f = await fixture(t, undefined, { maxQueuedBytes: 512 });
  const client = await f.connect();
  await assert.rejects(client.findOwner({ hostId: 'h'.repeat(256), conversationId: 't'.repeat(256) }), /socket-write-limit/);
  assert.equal(client.diagnostics.closed, true);
  assert.equal(client.diagnostics.pendingRequests, 0);
  assert.equal(f.messages.length, 1);
});

test('host/thread input bounds reject before issuing any request', async (t) => {
  const f = await fixture(t);
  const client = await f.connect();
  for (const bad of ['', 'x'.repeat(257), 'host\nother', null]) {
    await assert.rejects(client.findOwner({ hostId: bad, conversationId: 'thread-A' }), /invalid-host/);
    await assert.rejects(client.findOwner({ hostId: 'local', conversationId: bad }), /invalid-conversation/);
  }
  assert.equal(f.messages.length, 1);
});

test('explicit isolated home/socket, owned private directories and no symlinks are mandatory', async (t) => {
  const f = await fixture(t);
  await assert.rejects(NativeCodexReadonlyClient.connect({ compatibility }), /isolated-home-required/);
  await assert.rejects(NativeCodexReadonlyClient.connect({ ...f.options, isolatedCodexHome: join(homedir(), '.codex') }), /default-home-forbidden/);
  await assert.rejects(NativeCodexReadonlyClient.connect({ ...f.options, socketPath: '/tmp/codex-ipc/ipc.sock' }), /socket-outside-isolated-home/);
  await chmod(join(f.home, 'ipc'), 0o755);
  await assert.rejects(NativeCodexReadonlyClient.connect(f.options), /insecure-ipc-directory/);
  await chmod(join(f.home, 'ipc'), 0o700);
  await chmod(f.socketPath, 0o666);
  await assert.rejects(NativeCodexReadonlyClient.connect(f.options), /insecure-socket/);
  await chmod(f.socketPath, 0o600);
  const alias = join(f.home, 'alias');
  await symlink(f.home, alias);
  await assert.rejects(NativeCodexReadonlyClient.connect({ ...f.options, isolatedCodexHome: alias,
    socketPath: join(alias, 'ipc', 'ipc.sock') }), /symlink-path-forbidden/);
  assert.equal(f.peer, undefined);
});
