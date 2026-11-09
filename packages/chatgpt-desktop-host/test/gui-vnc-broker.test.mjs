import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer as createUnixServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGuiVncBroker } from '../gui-vnc-prototype/broker.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gui-vnc-broker-'));
  await chmod(root, 0o700);
  const assets = join(root, 'assets');
  await mkdir(assets);
  await mkdir(join(assets, 'core'));
  await writeFile(join(assets, 'core', 'rfb.js'), 'unknown noVNC version');
  await writeFile(join(assets, 'vnc.html'), '<!doctype html><title>test</title>');
  await writeFile(join(root, 'outside.txt'), 'not served');
  await symlink(join(root, 'outside.txt'), join(assets, 'escape.txt'));
  const token = 'ab'.repeat(32), tokenFile = join(root, 'token'), socketPath = join(root, 'rfb.sock');
  await writeFile(tokenFile, token + '\n', { mode: 0o600 });
  const sockets = new Set();
  const rfb = createUnixServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.write('RFB 003.008\n'); socket.on('data', (data) => socket.write(data));
  });
  await new Promise((resolve, reject) => rfb.once('error', reject).listen(socketPath, resolve));
  await chmod(socketPath, 0o700);
  let broker;
  t.after(async () => {
    await broker?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => rfb.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  broker = await createGuiVncBroker({ assetRoot: assets, rfbSocket: socketPath, tokenFile, port: 0, ...options });
  return { root, token, tokenFile, socketPath, broker, base: `http://127.0.0.1:${broker.port}` };
}

test('serves only authorized noVNC assets and rejects path escapes and revoked tokens', async (t) => {
  const f = await fixture(t), headers = { 'X-CG-GUI-Broker-Token': f.token };
  assert.equal((await fetch(f.base + '/vnc/vnc.html')).status, 403);
  assert.equal((await fetch(f.base + '/vnc/vnc.html', { headers })).status, 200);
  assert.equal((await fetch(f.base + '/vnc/escape.txt', { headers })).status, 404);
  assert.equal((await fetch(f.base + '/vnc/%2e%2e%2foutside.txt', { headers })).status, 404);
  assert.equal((await fetch(f.base + '/vnc/vnc.html', { method: 'POST', headers })).status, 405);
  await chmod(f.tokenFile, 0o644);
  assert.equal((await fetch(f.base + '/vnc/vnc.html', { headers })).status, 403);
});

test('rejects a changed socket identity before establishing a new VNC connection', async (t) => {
  const f = await fixture(t), url = f.base.replace('http:', 'ws:') + '/vnc/websockify';
  await chmod(f.socketPath, 0o777);
  const rejected = new WebSocket(url, { headers: { 'X-CG-GUI-Broker-Token': f.token } });
  rejected.on('error', () => {});
  const [, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 403); rejected.terminate();
});

test('requires the broker token and forwards each binary RFB message unchanged', async (t) => {
  const f = await fixture(t), url = f.base.replace('http:', 'ws:') + '/vnc/websockify';
  const rejected = new WebSocket(url);
  rejected.on('error', () => {});
  const [, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 403); rejected.terminate();
  const ws = new WebSocket(url, { headers: { 'X-CG-GUI-Broker-Token': f.token } });
  ws.on('error', () => {});
  const greeting = once(ws, 'message'); await once(ws, 'open');
  const [first, binary] = await greeting;
  assert.equal(binary, true); assert.equal(first.toString(), 'RFB 003.008\n');
  const echo = once(ws, 'message'); ws.send(Buffer.from([0, 1, 127, 255]));
  const [received] = await echo; assert.deepEqual(received, Buffer.from([0, 1, 127, 255]));
  ws.terminate();
});

test('concurrent upgrades cannot exceed the four-client limit', async (t) => {
  const f = await fixture(t), url = f.base.replace('http:', 'ws:') + '/vnc/websockify';
  const clients = [];
  t.after(() => { for (const ws of clients) ws.terminate(); });
  const results = await Promise.all(Array.from({ length: 5 }, () => new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { 'X-CG-GUI-Broker-Token': f.token } });
    clients.push(ws); ws.on('error', () => {});
    ws.once('open', () => resolve(101));
    ws.once('unexpected-response', (_req, res) => { ws.terminate(); resolve(res.statusCode); });
  })));
  assert.deepEqual(results.sort(), [101, 101, 101, 101, 403]);
});

test('rejects an unsafe token file before opening a listener', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gui-vnc-unsafe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700); await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'token'), 'ab'.repeat(32) + '\n', { mode: 0o644 });
  await assert.rejects(createGuiVncBroker({ assetRoot: join(root, 'assets'), rfbSocket: join(root, 'socket'), tokenFile: join(root, 'token'), port: 0 }), /token file must be owned 0600/);
});


test('clipboard compatibility is explicit and rejects unknown original resources before listening', async (t) => {
  await assert.rejects(fixture(t, { utf8Clipboard: true }), /NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED/);
});

test('clipboard compatibility does not accept truthy strings or numbers as an opt-in', async (t) => {
  for (const utf8Clipboard of ['1', 'true', 1]) {
    await assert.rejects(fixture(t, { utf8Clipboard }), /invalid utf8Clipboard/);
  }
});
