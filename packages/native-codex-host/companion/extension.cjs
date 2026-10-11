'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { openThread, threadUri, openFixturePanels } = require('./control.cjs');
let server;
function secureRead(file) {
  if (!file || !path.isAbsolute(file)) throw new Error('explicit companion config path required');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) throw new Error('companion config must be private owned mode 0600 file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function activationStatus(opened) {
  const official = vscode.extensions.getExtension('openai.chatgpt');
  return { companionActive: true, officialInstalled: Boolean(official), officialActive: Boolean(official?.isActive), officialVersion: official?.packageJSON.version,
    opened, tabs: vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, active: group.isActive,
      tabs: group.tabs.map(tab => ({ label: tab.label, active: tab.isActive, uri: tab.input?.uri?.toString(), viewType: tab.input?.viewType })) })) };
}
async function activate(context) {
  const config = secureRead(process.env.NATIVE_CODEX_COMPANION_CONFIG);
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('private companion port invalid');
  if (!Array.isArray(config.threads) || config.threads.length > 16 || typeof config.token !== 'string' || config.token.length < 32) throw new Error('invalid companion config');
  for (const id of config.threads) threadUri(id, config.threads);
  const opened = []; let opening = false;
  const fixtures = Object.freeze(config.threads.slice(0, 2));
  const instanceId = crypto.randomUUID();
  const broker = { enabled: false, scope: 'first-listener-instance', pid: process.pid, instanceId };
  const official = vscode.extensions.getExtension('openai.chatgpt');
  let activationError = null;
  try { if (official) await official.activate(); } catch (error) { activationError = String(error.message); }
  const remember = results => { opened.push(...results); while (opened.length > 32) opened.shift(); };
  const commandDisposable = vscode.commands.registerCommand('nativeCodexPrototype.openTwoTestPanels', async (...args) => {
    if (args.length !== 0) throw new Error('test panel command accepts no arguments');
    if (opening) throw new Error('panel opening in progress');
    opening = true;
    try { const results = await openFixturePanels(vscode, fixtures); remember(results); return results; }
    finally { opening = false; }
  });
  context.subscriptions.push(commandDisposable);
  server = http.createServer(async (request, response) => {
    const send = (status, value) => { if (response.writableEnded || response.destroyed) return; response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    const supplied = Buffer.from(request.headers.authorization || ''); const expected = Buffer.from(`Bearer ${config.token}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(401, { error: 'unauthorized' });
    if (request.method === 'GET' && request.url === '/status') return send(200, { ...activationStatus(opened), activationError, broker });
    if (request.method !== 'POST' || request.url !== '/open') return send(404, { error: 'unsupported operation' });
    if (opening) return send(409, { error: 'panel opening in progress' });
    opening = true;
    let body = ''; request.setTimeout(5000, () => request.destroy());
    const bodyDeadline = setTimeout(() => request.destroy(), 5000);
    let executionDeadline;
    try {
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 2048) { send(413, { error: 'request too large' }); request.destroy(); return; } }
      clearTimeout(bodyDeadline); request.setTimeout(0);
      // VS Code commands cannot be cancelled. A timeout replies but retains the lock until the command settles.
      executionDeadline = setTimeout(() => send(504, { error: 'panel command timed out; still waiting for VS Code' }), 20000);
      const result = await openThread(vscode, JSON.parse(body), config.threads); remember([result]);
      send(200, result);
    } catch (error) { send(400, { error: String(error.message).slice(0, 240) }); }
    finally { clearTimeout(bodyDeadline); clearTimeout(executionDeadline); opening = false; }
  });
  // A retained browser extension host may still own the fixed port. Never replace it or pick another port.
  try {
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
      broker.enabled = true;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      server.close(); server = null;
      broker.disabledReason = 'address-in-use';
    }
    const directory = path.dirname(process.env.NATIVE_CODEX_COMPANION_CONFIG);
    const activatedAt = new Date().toISOString();
    // Per-instance diagnostics contain flags/counts only; a disabled instance must not overwrite owner readiness.
    fs.writeFileSync(path.join(directory, `companion-instance-${process.pid}-${instanceId}.json`), JSON.stringify({
      pid: process.pid, activatedAt, companionActive: true, brokerEnabled: broker.enabled,
      brokerDisabledReason: broker.disabledReason ?? null, fixtureCount: fixtures.length
    }, null, 2), { mode: 0o600, flag: 'wx' });
    if (broker.enabled) fs.writeFileSync(path.join(directory, 'companion-ready.json'), JSON.stringify({
      pid: process.pid, activatedAt, ...activationStatus(opened), activationError, broker
    }, null, 2), { mode: 0o600 });
    const ownedServer = server;
    context.subscriptions.push({ dispose() { ownedServer?.close(); } });
  } catch (error) {
    commandDisposable.dispose(); server?.close(); server = null;
    throw error;
  }
}
function deactivate() { server?.close(); }
module.exports = { activate, deactivate };
