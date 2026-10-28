import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedFields = new Set(['host', 'port', 'externalOrigin', 'upstream', 'certFile', 'keyFile', 'idleTimeoutMs']);
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const untrustedHeaders = /^(?:forwarded|x-forwarded(?:-.*)?|x-real-ip|x-original-.*|x-rewrite-.*)$/i;

function origin(value, protocol, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${field} must be an explicit origin`); }
  if (typeof value !== 'string' || value !== value.trim() || /[\r\n]/.test(value) || url.protocol !== protocol || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error(`${field} must be a ${protocol} origin without credentials or a path`);
  return url;
}

/** Configuration is owner-supplied, never taken from browser request parameters. */
export function validateProxyConfig(value, { allowEphemeralPort = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowedFields.has(key))) {
    throw new Error('Invalid TLS proxy configuration fields');
  }
  if (typeof value.host !== 'string' || !isIP(value.host)) throw new Error('host must be an explicit bind IP');
  const external = origin(value.externalOrigin, 'https:', 'externalOrigin');
  const upstream = origin(value.upstream, 'http:', 'upstream');
  if (!Number.isInteger(value.port) || value.port < (allowEphemeralPort ? 0 : 1) || value.port > 65535 ||
      (value.port !== 0 && Number(external.port || 443) !== value.port)) throw new Error('port must match externalOrigin');
  if (external.hostname === '0.0.0.0' || external.hostname === '[::]') throw new Error('externalOrigin must name a reachable authority');
  if (Number(external.port || 443) === Number(upstream.port || 80) && external.hostname === upstream.hostname) {
    throw new Error('TLS proxy and upstream must use different authorities');
  }
  for (const field of ['certFile', 'keyFile']) if (typeof value[field] !== 'string' || !isAbsolute(value[field])) throw new Error(`${field} must be an absolute file path`);
  const idleTimeoutMs = value.idleTimeoutMs ?? 300_000;
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 3_600_000) throw new Error('idleTimeoutMs must be between 1000 and 3600000');
  return { ...value, externalOrigin: external.origin, upstream: upstream.origin, idleTimeoutMs };
}

export async function readProxyConfig(file) {
  if (!isAbsolute(file)) throw new Error('Configuration requires an absolute path');
  const info = await lstat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('Configuration must be a private owned regular file');
  }
  return validateProxyConfig(JSON.parse(await readFile(file, 'utf8')));
}

export function secureCookies(values) {
  if (!values) return values;
  return (Array.isArray(values) ? values : [values]).map(value => {
    if (/^dsh-auth-[^=;\s]+=/.test(value) && !/;\s*secure(?:;|$)/i.test(value)) return `${value}; Secure`;
    return value;
  });
}

export function rewriteLocation(value, config) {
  if (typeof value !== 'string' || /[\\\r\n]/.test(value) || value.startsWith('//')) throw new Error('Unsupported upstream redirect');
  const url = new URL(value, config.externalOrigin);
  if (url.username || url.password) throw new Error('Unsupported upstream redirect');
  if (url.origin === config.externalOrigin) return value;
  if (url.origin !== config.upstream) throw new Error('Unsupported upstream redirect');
  return config.externalOrigin + url.pathname + url.search + url.hash;
}

function cleanHeaders(headers, { upgrade = false } = {}) {
  const nominated = new Set(String(headers.connection ?? '').toLowerCase().split(',').map(x => x.trim()));
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || untrustedHeaders.test(name) || hopHeaders.has(name) || nominated.has(name)) continue;
    result[name] = value;
  }
  if (upgrade) { result.connection = 'Upgrade'; result.upgrade = 'websocket'; }
  return result;
}

function responseHeaders(headers, config, upgrade = false) {
  const result = cleanHeaders(headers, { upgrade });
  if (result['set-cookie']) result['set-cookie'] = secureCookies(result['set-cookie']);
  if (result.location !== undefined) result.location = rewriteLocation(result.location, config);
  return result;
}

function admitted(request, config) {
  if (request.method === 'CONNECT' || request.method === 'TRACE') return false;
  const expected = new URL(config.externalOrigin).host;
  const hostRows = request.rawHeaders.filter((_value, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host');
  if (hostRows.length !== 1 || request.headers.host !== expected) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  if (request.headers.origin !== undefined && request.headers.origin !== config.externalOrigin) return false;
  const path = request.url;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\\\r\n]/.test(path);
}

function reject(response, status = 403) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end(status === 403 ? 'Forbidden\n' : 'Harness upstream unavailable\n');
}

/** TLS frontend for exactly one existing Harness service; never starts or stops it. */
export async function createTlsProxy(input, options = {}) {
  const config = validateProxyConfig(input, options);
  const [cert, key] = await Promise.all([readFile(config.certFile), readFile(config.keyFile)]);
  const upstream = new URL(config.upstream);
  const externalAuthority = new URL(config.externalOrigin).host;
  const sockets = new Set();
  let closing = false, closePromise;
  const track = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(config.idleTimeoutMs, () => socket.destroy());
    return socket;
  };
  const upstreamRequest = (request, upgrade = false) => {
    const headers = cleanHeaders(request.headers, { upgrade });
    // RC.4 authenticates Host and Origin authority independently of the HTTP hop.
    // Keeping the external authority also keeps its auth cookie separate from HTTP.
    headers.host = externalAuthority;
    const outgoing = http.request({ protocol: 'http:', hostname: upstream.hostname.replace(/^\[|\]$/g, ''),
      port: upstream.port || 80, method: request.method, path: request.url, headers, agent: false });
    outgoing.on('socket', track);
    outgoing.setTimeout(config.idleTimeoutMs, () => outgoing.destroy());
    return outgoing;
  };
  const server = https.createServer({ cert, key, minVersion: 'TLSv1.2', requestTimeout: config.idleTimeoutMs,
    headersTimeout: Math.min(30_000, config.idleTimeoutMs) }, (request, response) => {
    if (closing || !admitted(request, config)) { reject(response); return; }
    const outgoing = upstreamRequest(request);
    const abandon = () => { if (!response.writableFinished) outgoing.destroy(); };
    request.once('aborted', abandon);
    response.once('close', abandon);
    outgoing.once('error', () => {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) reject(response, 502);
    });
    outgoing.once('response', incoming => {
      let headers;
      try { headers = responseHeaders(incoming.headers, config); }
      catch { incoming.destroy(); reject(response, 502); return; }
      response.writeHead(incoming.statusCode ?? 502, headers);
      incoming.once('error', () => response.destroy());
      incoming.pipe(response);
    });
    request.pipe(outgoing);
  });
  server.on('connection', track);
  server.on('tlsClientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request, client, head) => {
    if (closing || !admitted(request, config) || request.method !== 'GET' ||
        new URL(request.url, config.externalOrigin).pathname !== '/api/remote.mux' ||
        request.headers.upgrade?.toLowerCase() !== 'websocket') {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    const outgoing = upstreamRequest(request, true);
    let tunnel;
    const abandon = () => { outgoing.destroy(); tunnel?.destroy(); };
    client.on('error', abandon); client.once('close', abandon);
    outgoing.once('error', () => {
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    outgoing.once('upgrade', (incoming, socket, upstreamHead) => {
      tunnel = track(socket);
      let headers;
      try { headers = responseHeaders(incoming.headers, config, true); }
      catch { tunnel.destroy(); client.destroy(); return; }
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map(row => `${name}: ${row}\r\n`)).join('')}\r\n`);
      tunnel.on('error', () => client.destroy()); tunnel.once('close', () => client.destroy());
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) tunnel.write(head);
      client.pipe(tunnel); tunnel.pipe(client);
    });
    outgoing.once('response', incoming => {
      const status = incoming.statusCode ?? 502;
      // An unauthenticated upgrade remains refused; do not invent a session.
      client.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      incoming.destroy();
    });
    outgoing.end();
  });
  return {
    server,
    async listen() {
      if (closing) throw new Error('TLS proxy is closed');
      await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(config.port, config.host, () => { server.off('error', rejectListen); resolveListen(); });
      });
      return server.address().port;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = new Promise(resolveClose => {
        if (!server.listening) { resolveClose(); return; }
        server.close(resolveClose);
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
      });
      return closePromise;
    },
  };
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--config' || !isAbsolute(process.argv[3])) {
    throw new Error('Usage: node tls-proxy.mjs --config /absolute/private-config.json');
  }
  const config = await readProxyConfig(process.argv[3]);
  const proxy = await createTlsProxy(config);
  await proxy.listen();
  const close = () => proxy.close().catch(() => { process.exitCode = 1; });
  process.once('SIGTERM', close); process.once('SIGINT', close);
  console.log(`Harness TLS frontend ready at ${new URL(config.externalOrigin).origin}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Harness TLS frontend failed; check explicit configuration, certificate and listener availability.'); process.exitCode = 1; });
}
