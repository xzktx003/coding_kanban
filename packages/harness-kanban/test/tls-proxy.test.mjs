import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTlsProxy, readProxyConfig, validateProxyConfig, rewriteLocation, secureCookies } from '../tls-proxy.mjs';

let directory, cert, key;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'harness-kanban-tls-'));
  cert = join(directory, 'cert.pem'); key = join(directory, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

function configuration(overrides = {}) {
  return { host: '127.0.0.1', port: 3443, externalOrigin: 'https://127.0.0.1:3443',
    upstream: 'http://127.0.0.1:3080', certFile: cert, keyFile: key, ...overrides };
}
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
function request(port, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port, rejectUnauthorized: false,
      path: '/', ...options }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}
async function fixture(handler, upgrade) {
  const upstream = http.createServer(handler);
  if (upgrade) upstream.on('upgrade', upgrade);
  const upstreamSockets = new Set();
  upstream.on('connection', socket => { upstreamSockets.add(socket); socket.on('close', () => upstreamSockets.delete(socket)); });
  const upstreamPort = await listen(upstream);
  const proxy = await createTlsProxy(configuration({ port: 0, externalOrigin: 'https://127.0.0.1:3443', upstream: `http://127.0.0.1:${upstreamPort}` }), { allowEphemeralPort: true });
  const port = await proxy.listen();
  return { proxy, upstream, port, async close() { await proxy.close(); for (const socket of upstreamSockets) socket.destroy(); await new Promise(resolve => upstream.close(resolve)); } };
}

test('configuration requires an explicit fixed HTTPS authority and plain HTTP upstream', () => {
  assert.equal(validateProxyConfig(configuration()).externalOrigin, 'https://127.0.0.1:3443');
  for (const patch of [
    { externalOrigin: 'http://127.0.0.1:3443' }, { externalOrigin: 'https://user:pass@127.0.0.1:3443' },
    { externalOrigin: 'https://127.0.0.1:3443/path' }, { upstream: 'http://127.0.0.1:3080/path' },
    { upstream: 'https://127.0.0.1:3080' }, { upstream: 'http://user:pass@127.0.0.1:3080' },
    { port: 0 }, { host: 'example.test' }, { port: 3080 }, { unknown: true },
  ]) assert.throws(() => validateProxyConfig(configuration(patch)));
});

test('CLI config must be a private owned regular file', async () => {
  const file = join(directory, 'private.json');
  await writeFile(file, JSON.stringify(configuration()), { mode: 0o600 });
  assert.equal((await readProxyConfig(file)).externalOrigin, 'https://127.0.0.1:3443');
  const publicFile = join(directory, 'public.json');
  await writeFile(publicFile, JSON.stringify(configuration()), { mode: 0o644 });
  await assert.rejects(readProxyConfig(publicFile), /private owned regular file/);
});

test('redirects keep relative routes, map only the fixed upstream, and refuse other origins', () => {
  const c = validateProxyConfig(configuration());
  assert.equal(rewriteLocation('./api/remote.mux', c), './api/remote.mux');
  assert.equal(rewriteLocation('http://127.0.0.1:3080/path?q=1', c), 'https://127.0.0.1:3443/path?q=1');
  for (const value of ['https://evil.test/', '//evil.test/', 'javascript:alert(1)', '\\evil.test', 'http://user@127.0.0.1:3080/']) {
    assert.throws(() => rewriteLocation(value, c));
  }
});

test('only Harness auth cookies gain Secure without changing names or signed values', () => {
  const result = secureCookies(['dsh-auth-external=signed; Path=/; HttpOnly; SameSite=Strict', 'other=value; Path=/']);
  assert.deepEqual(result, ['dsh-auth-external=signed; Path=/; HttpOnly; SameSite=Strict; Secure', 'other=value; Path=/']);
  assert.equal(secureCookies(['dsh-auth-a=v; Secure'])[0], 'dsh-auth-a=v; Secure');
});

test('external authority and Origin reach Harness unchanged; spoofed forwards are removed', async () => {
  let observed;
  const f = await fixture((req, res) => { observed = req.headers; res.setHeader('set-cookie', 'dsh-auth-external=signed; Path=/; HttpOnly; SameSite=Strict'); res.end('ok'); });
  try {
    const r = await request(f.port, { headers: { host: '127.0.0.1:3443', origin: 'https://127.0.0.1:3443', cookie: 'dsh-auth-external=signed',
      forwarded: 'host=evil.test', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'http', 'x-real-ip': '1.2.3.4' } });
    assert.equal(r.status, 200); assert.equal(observed.host, '127.0.0.1:3443');
    assert.equal(observed.origin, 'https://127.0.0.1:3443'); assert.equal(observed.cookie, 'dsh-auth-external=signed');
    for (const name of ['forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) assert.equal(observed[name], undefined);
    assert.match(r.headers['set-cookie'][0], /; Secure$/);
    assert.doesNotMatch(r.headers['set-cookie'][0], /dsh-auth-3080/);
  } finally { await f.close(); }
});

test('Host, Origin, cross-site and absolute URL requests are refused before upstream', async () => {
  let calls = 0; const f = await fixture((_req, res) => { calls++; res.end('unexpected'); });
  try {
    for (const options of [
      { headers: { host: 'evil.test' } },
      { headers: { host: '127.0.0.1:3443', origin: 'https://evil.test' } },
      { headers: { host: '127.0.0.1:3443', 'sec-fetch-site': 'cross-site' } },
      { path: 'http://evil.test/', headers: { host: '127.0.0.1:3443' } },
      { path: '//evil.test/', headers: { host: '127.0.0.1:3443' } },
    ]) assert.equal((await request(f.port, options)).status, 403);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('an absent Origin is not manufactured and foreign redirects do not reach browser', async () => {
  let observed; const f = await fixture((req, res) => { observed = req.headers.origin; res.writeHead(302, { location: 'https://evil.test/' }); res.end(); });
  try {
    const r = await request(f.port, { headers: { host: '127.0.0.1:3443' } });
    assert.equal(observed, undefined); assert.equal(r.status, 502); assert.equal(r.headers.location, undefined);
  } finally { await f.close(); }
});

test('streamed response is forwarded before upstream completes, and close cancels only proxy connections', async () => {
  let upstreamRequest; const f = await fixture((req, res) => { upstreamRequest = req; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); });
  try {
    const req = https.request({ hostname: '127.0.0.1', port: f.port, rejectUnauthorized: false, headers: { host: '127.0.0.1:3443' } });
    req.end(); const [res] = await once(req, 'response');
    const [chunk] = await once(res, 'data'); assert.equal(chunk.toString(), 'data: first\n\n');
    res.on('error', () => {}); const closed = new Promise(resolve => res.once('close', resolve));
    await f.proxy.close(); await closed;
    assert.equal(f.upstream.listening, true); assert.ok(upstreamRequest);
  } finally { await f.close(); }
});

test('request bodies stream without buffering and client cancellation aborts upstream', { timeout: 5000 }, async () => {
  let sawData, sawAborted;
  const data = new Promise(resolve => { sawData = resolve; });
  const aborted = new Promise(resolve => { sawAborted = resolve; });
  const f = await fixture((req, _res) => { req.once('data', chunk => sawData(chunk.toString())); req.once('aborted', sawAborted); });
  const req = https.request({ hostname: '127.0.0.1', port: f.port, rejectUnauthorized: false, method: 'POST',
    path: '/api/upload', headers: { host: '127.0.0.1:3443', origin: 'https://127.0.0.1:3443' } });
  req.on('error', () => {});
  try {
    req.write('first'); assert.equal(await data, 'first');
    req.destroy(); await aborted;
    assert.equal(f.upstream.listening, true);
  } finally { req.destroy(); await f.close(); }
});

test('WebSocket upgrades forward raw bytes and external authority, then close owned tunnels', async () => {
  let observed;
  const f = await fixture((_req, res) => res.end(), (req, socket, head) => {
    observed = req.headers;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', chunk => socket.write(chunk));
  });
  let socket;
  try {
    socket = tls.connect({ host: '127.0.0.1', port: f.port, rejectUnauthorized: false });
    await once(socket, 'secureConnect');
    socket.write('GET /api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:3443\r\nOrigin: https://127.0.0.1:3443\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    const [headers] = await once(socket, 'data'); assert.match(headers.toString(), /^HTTP\/1.1 101/);
    assert.equal(observed.host, '127.0.0.1:3443'); assert.equal(observed.origin, 'https://127.0.0.1:3443');
    const bytes = Buffer.from([0x81, 0x80, 0x11, 0x22, 0x33, 0x44]); socket.write(bytes);
    const [echo] = await once(socket, 'data'); assert.deepEqual(echo, bytes);
    const closed = once(socket, 'close'); await f.proxy.close(); await closed;
    assert.equal(f.upstream.listening, true);
  } finally { socket?.destroy(); await f.close(); }
});
