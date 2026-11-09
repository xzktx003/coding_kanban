import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { constants, createReadStream } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { patchFixedNoVncClipboard } from './clipboard-adapter.mjs';

const LIMIT = 8 * 1024 * 1024;
const ASSET_LIMIT = 2 * 1024 * 1024;
const HEADER = 'x-cg-gui-broker-token';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.cur': 'image/x-icon', '.ico': 'image/x-icon',
};

function absolutePath(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || /[\x00-\x1f]/.test(value)) {
    throw new Error(`${name} must be a canonical absolute path`);
  }
  return value;
}

function identity(info) {
  return [info.dev, info.ino, info.uid, info.mode, info.size, info.mtimeMs, info.ctimeMs].join(':');
}

async function privateParent(file) {
  const parent = dirname(file);
  if (await realpath(parent) !== parent) throw new Error('private directory must not be a symlink');
  const info = await lstat(parent);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('private directory must be owned and inaccessible to other users');
  }
  // A socket or token replacement may change directory timestamps, but not its identity or mode.
  return [info.dev, info.ino, info.uid, info.mode].join(':');
}

async function checkToken(file) {
  const parent = await privateParent(file);
  const info = await lstat(file);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 65) {
    throw new Error('token file must be owned 0600');
  }
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (identity(before) !== identity(info)) throw new Error('token identity changed');
    const value = await fd.readFile('utf8');
    if (!/^[a-f0-9]{64}\n?$/.test(value)) throw new Error('invalid broker token');
    if (identity(await fd.stat()) !== identity(info) || await privateParent(file) !== parent) throw new Error('token identity changed');
    return { parent, file: identity(info), secret: Buffer.from(value.trim()) };
  } finally { await fd.close(); }
}

async function socketIdentity(file) {
  const parent = await privateParent(file);
  const info = await lstat(file);
  if (!info.isSocket() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('VNC socket must be owned and private');
  }
  return `${parent}/${identity(info)}`;
}

// Opt-in only. This broker supplies neither LAN authentication nor TLS: put it behind
// an authenticated same-origin HTTPS proxy which injects HEADER and validates Origin.
export async function createGuiVncBroker(options) {
  const assetRoot = absolutePath(options.assetRoot, 'assetRoot');
  const tokenFile = absolutePath(options.tokenFile, 'tokenFile');
  const rfbSocket = absolutePath(options.rfbSocket, 'rfbSocket');
  const port = options.port;
  if (options.utf8Clipboard !== undefined && typeof options.utf8Clipboard !== 'boolean') throw new Error('invalid utf8Clipboard');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
  if (await realpath(assetRoot) !== assetRoot || !(await lstat(assetRoot)).isDirectory()) throw new Error('invalid asset root');
  const token = await checkToken(tokenFile);
  const expectedSocket = await socketIdentity(rfbSocket);
  let clipboardAsset;
  if (options.utf8Clipboard === true) {
    const file = await realpath(join(assetRoot, 'core', 'rfb.js'));
    if (!file.startsWith(assetRoot + sep)) throw new Error('NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED');
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await fd.stat();
      if (!before.isFile() || before.size > ASSET_LIMIT) throw new Error('NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED');
      const body = patchFixedNoVncClipboard(await fd.readFile());
      if (identity(await fd.stat()) !== identity(before) || identity(await lstat(file)) !== identity(before)) throw new Error('NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED');
      clipboardAsset = { file, identity: identity(before), body };
    } finally { await fd.close(); }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMIT, perMessageDeflate: false });

  async function authorized(req) {
    const value = req.headers[HEADER];
    if (typeof value !== 'string') return false;
    const supplied = Buffer.from(value);
    if (supplied.length !== token.secret.length || !timingSafeEqual(supplied, token.secret)) return false;
    try {
      return await privateParent(tokenFile) === token.parent && identity(await lstat(tokenFile)) === token.file;
    } catch { return false; }
  }

  const server = createServer(async (req, res) => {
    try {
      if (!(await authorized(req))) { res.writeHead(403).end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith('/vnc/')) { res.writeHead(404).end(); return; }
      const relative = decodeURIComponent(url.pathname.slice(5));
      if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\\]/.test(relative)) {
        res.writeHead(404).end(); return;
      }
      const file = await realpath(join(assetRoot, relative));
      if (!file.startsWith(assetRoot + sep)) { res.writeHead(404).end(); return; }
      const info = await lstat(file);
      if (!info.isFile() || info.size > ASSET_LIMIT) { res.writeHead(404).end(); return; }
      if (clipboardAsset && relative === 'core/rfb.js') {
        if (file !== clipboardAsset.file || identity(info) !== clipboardAsset.identity) { res.writeHead(503).end(); return; }
        res.writeHead(200, { 'content-type': mime['.js'], 'content-length': clipboardAsset.body.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : clipboardAsset.body);
        return;
      }
      res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream',
        'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.writeHead(404).end(); else res.destroy(); }
  });

  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (!(await authorized(req)) || path !== '/vnc/websockify' || await socketIdentity(rfbSocket) !== expectedSocket) throw new Error('rejected');
      if (socket.destroyed) return;
      if (wss.clients.size >= 4) throw new Error('connection limit');
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } catch { if (!socket.destroyed) socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });

  wss.on('connection', (ws, req) => {
    const upstream = createConnection(rfbSocket);
    let closed = false, ready = false;
    const close = () => {
      if (closed) return;
      closed = true; upstream.destroy();
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'VNC connection closed'); else ws.terminate();
    };
    upstream.pause();
    upstream.on('error', close); upstream.on('close', close); ws.on('error', close); ws.on('close', close);
    upstream.on('connect', async () => {
      try {
        if (!(await authorized(req)) || await socketIdentity(rfbSocket) !== expectedSocket || closed) { close(); return; }
        ready = true; upstream.resume(); ws._socket?.resume();
      } catch { close(); }
    });
    ws._socket?.pause();
    ws.on('message', (data, binary) => {
      if (!ready || !binary || !Buffer.isBuffer(data) || data.length > LIMIT || upstream.writableLength + data.length > LIMIT) { close(); return; }
      if (!upstream.write(data)) { ws._socket?.pause(); upstream.once('drain', () => ws._socket?.resume()); }
    });
    upstream.on('data', data => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount + data.length > LIMIT) { close(); return; }
      if (ws.bufferedAmount > 1024 * 1024) upstream.pause();
      ws.send(data, { binary: true, compress: false }, error => {
        if (error) close(); else if (ws.bufferedAmount < 128 * 1024) upstream.resume();
      });
    });
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolveListen(); });
  });
  return {
    port: server.address().port,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      server.closeAllConnections();
      await new Promise(resolveClose => server.close(resolveClose));
      token.secret.fill(0);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GUI_NOVNC_ROOT, GUI_RFB_SOCKET, GUI_BROKER_TOKEN_FILE, GUI_BROKER_PORT, GUI_VNC_UTF8_CLIPBOARD } = process.env;
  if (!/^[1-9][0-9]{0,4}$/.test(GUI_BROKER_PORT ?? '')) throw new Error('GUI_BROKER_PORT must be a nonzero port');
  if (GUI_VNC_UTF8_CLIPBOARD !== undefined && !['0', '1'].includes(GUI_VNC_UTF8_CLIPBOARD)) throw new Error('GUI_VNC_UTF8_CLIPBOARD must be 0 or 1');
  await createGuiVncBroker({ assetRoot: GUI_NOVNC_ROOT, rfbSocket: GUI_RFB_SOCKET, tokenFile: GUI_BROKER_TOKEN_FILE, port: Number(GUI_BROKER_PORT), utf8Clipboard: GUI_VNC_UTF8_CLIPBOARD === '1' });
  console.log('Private noVNC broker listening on loopback');
}
