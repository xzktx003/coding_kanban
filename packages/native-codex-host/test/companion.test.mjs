import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import net from 'node:net';
import http from 'node:http';
const require = createRequire(import.meta.url);
const id = '019aabcd-1234-7890-abcd-0123456789ab';
async function sparePort() { const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port; }
async function load(config, vscode, timerOverrides = {}) {
  const source = await readFile(new URL('../companion/extension.cjs', import.meta.url), 'utf8');
  const module = { exports: {} };
  const context = { module, exports: module.exports, Buffer, console, setTimeout, clearTimeout, ...timerOverrides,
    process: { env: { NATIVE_CODEX_COMPANION_CONFIG: config }, getuid: () => process.getuid(), pid: process.pid },
    require: name => name === 'node:http' && timerOverrides.httpModule ? timerOverrides.httpModule : name === 'vscode' ? vscode : name === './control.cjs' ? require('../companion/control.cjs') : require(name) };
  vm.runInNewContext(source, context); return module.exports;
}
test('private companion enforces auth, bounded schema and fixed allowlist without arbitrary commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-companion-test-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const token = 'test-only-auth-value-012345678901234567890'; const calls = []; const disposals = [];
  const official = { isActive: false, packageJSON: { version: 'test' }, async activate() { this.isActive = true; } };
  const vscode = { extensions: { getExtension: () => official }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri }, commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async (...args) => { calls.push(args); } } };
  await writeFile(file, JSON.stringify({ port, token, threads: [id] }), { mode: 0o600 });
  const extension = await load(file, vscode);
  try {
    await extension.activate({ subscriptions: disposals });
    const base = `http://127.0.0.1:${port}`; const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/status`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/command`, { method: 'POST', headers, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/open`, { method: 'POST', headers, body: JSON.stringify({ threadId: id, column: 1, command: 'evil' }) })).status, 400);
    assert.equal((await fetch(`${base}/open`, { method: 'POST', headers, body: JSON.stringify({ threadId: id.replace(/.$/, 'c'), column: 1 }) })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(`${base}/open`, { method: 'POST', headers, body: JSON.stringify({ threadId: id, column: 2 }) })).status, 200);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'vscode.openWith'); assert.equal(calls[0][2], 'chatgpt.conversationEditor');
    assert.equal((await fetch(`${base}/open`, { method: 'POST', headers, body: 'x'.repeat(2100) })).status, 413);
    const ready = JSON.parse(await readFile(join(root, 'companion-ready.json'), 'utf8'));
    assert.equal(ready.officialActive, true); assert.equal(JSON.stringify(ready).includes(token), false);
  } finally { extension.deactivate(); for (const disposable of disposals) disposable.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('companion refuses non-private credential file before binding broker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-companion-test-')); const file = join(root, 'auth.json');
  try {
    await writeFile(file, '{}'); await chmod(file, 0o644);
    const extension = await load(file, {});
    await assert.rejects(extension.activate({ subscriptions: [] }), /0600/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('streaming open owns the lock before reading body and rejected requests cannot release it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-open-lock-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const token = 'test-only-lock-012345678901234567890'; const calls = []; const disposals = [];
  let releaseOpen; const execution = new Promise(resolve => { releaseOpen = resolve; });
  const vscode = { extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async (...args) => { calls.push(args); await execution; } } };
  await writeFile(file, JSON.stringify({ port, token, threads: [id] }), { mode: 0o600 });
  const extension = await load(file, vscode); const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let first;
  try {
    await extension.activate({ subscriptions: disposals });
    const response = new Promise((resolve, reject) => {
      first = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/open', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      first.on('error', reject); first.write('{');
    });
    response.catch(() => {});
    // Status is independent of opening and provides a scheduling barrier after the partial body arrived.
    await fetch(`http://127.0.0.1:${port}/status`, { headers });
    const blocked = await fetch(`http://127.0.0.1:${port}/open`, { method: 'POST', headers, body: 'invalid' });
    assert.equal(blocked.status, 409); assert.equal(calls.length, 0);
    first.end(JSON.stringify({ threadId: id, column: 1 }).slice(1));
    await fetch(`http://127.0.0.1:${port}/status`, { headers });
    const blockedAgain = await fetch(`http://127.0.0.1:${port}/open`, { method: 'POST', headers, body: 'invalid' });
    assert.equal(blockedAgain.status, 409);
    releaseOpen(); assert.equal(await response, 200); assert.equal(calls.length, 1);
  } finally { releaseOpen(); first?.destroy(); extension.deactivate(); for (const item of disposals) item.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('contributed palette command opens exactly two captured fixture threads with no caller parameters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-command-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const secondId = '019aabcd-1234-7890-abcd-0123456789ac'; const commands = new Map(); const calls = []; const disposals = [];
  const vscode = { extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { commands.delete(name); } }; }, executeCommand: async (...args) => { calls.push(args); } } };
  await writeFile(file, JSON.stringify({ port, token: 'test-only-command-012345678901234567890', threads: [id, secondId] }), { mode: 0o600 });
  const extension = await load(file, vscode);
  try {
    await extension.activate({ subscriptions: disposals });
    const manifest = JSON.parse(await readFile(new URL('../companion/package.json', import.meta.url), 'utf8'));
    const contribution = manifest.contributes.commands.find(item => item.command === 'nativeCodexPrototype.openTwoTestPanels');
    assert.equal(contribution.title, 'Native Codex: Open Two Test Panels');
    assert.deepEqual([...commands.keys()], ['nativeCodexPrototype.openTwoTestPanels']);
    const command = commands.get('nativeCodexPrototype.openTwoTestPanels');
    await assert.rejects(command({ threadId: secondId, column: 3 }), /arguments|parameters/); assert.equal(calls.length, 0);
    await command();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => [call[0], call[1], call[2], call[3].viewColumn]), [
      ['vscode.openWith', `openai-codex://route/local/${id}`, 'chatgpt.conversationEditor', 1],
      ['vscode.openWith', `openai-codex://route/local/${secondId}`, 'chatgpt.conversationEditor', 2]
    ]);
  } finally { extension.deactivate(); for (const item of disposals) item.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('command HTTP deadline replies 504 while retaining the lock until VS Code settles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-deadline-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const token = 'test-only-deadline-012345678901234567890'; const disposals = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const vscode = { extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => pending } };
  await writeFile(file, JSON.stringify({ port, token, threads: [id] }), { mode: 0o600 });
  const extension = await load(file, vscode, { setTimeout: (callback, delay) => setTimeout(callback, delay === 20000 ? 0 : delay) });
  try {
    await extension.activate({ subscriptions: disposals });
    const options = { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ threadId: id, column: 1 }) };
    assert.equal((await fetch(`http://127.0.0.1:${port}/open`, options)).status, 504);
    assert.equal((await fetch(`http://127.0.0.1:${port}/open`, options)).status, 409);
    release(); await fetch(`http://127.0.0.1:${port}/status`, { headers: options.headers });
    assert.equal((await fetch(`http://127.0.0.1:${port}/open`, options)).status, 200);
  } finally { release(); extension.deactivate(); for (const item of disposals) item.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('second module on occupied broker port activates and its palette command uses its own VS Code instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-two-hosts-')); const file = join(root, 'auth.json'); const record = join(root, 'runtime.json'); const port = await sparePort();
  const secondId = '019aabcd-1234-7890-abcd-0123456789ac'; const token = 'test-only-two-hosts-012345678901234567890';
  const contexts = [0, 1].map(() => ({ commands: new Map(), calls: [], subscriptions: [] }));
  const mockedVscode = context => ({ extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand: (name, callback) => { context.commands.set(name, callback); return { dispose() { context.commands.delete(name); } }; }, executeCommand: async (...args) => { context.calls.push(args); } } });
  await writeFile(file, JSON.stringify({ port, token, threads: [id, secondId] }), { mode: 0o600 });
  await writeFile(record, JSON.stringify({ brokerPort: port, brokerAuthFile: file }));
  const first = await load(file, mockedVscode(contexts[0])); const second = await load(file, mockedVscode(contexts[1]));
  try {
    await first.activate({ subscriptions: contexts[0].subscriptions });
    await second.activate({ subscriptions: contexts[1].subscriptions });
    await contexts[1].commands.get('nativeCodexPrototype.openTwoTestPanels')();
    assert.equal(contexts[0].calls.length, 0); assert.equal(contexts[1].calls.length, 2);
    const { brokerRequest } = await import('../broker.mjs');
    const status = await brokerRequest(record, 'status'); assert.equal(status.broker.enabled, true); assert.equal(status.broker.scope, 'first-listener-instance');
    assert.equal(status.opened.length, 0); assert.equal(status.brokerScope, 'first-listener-instance');
    const opened = await brokerRequest(record, 'open', { threadId: id, column: 1 }); assert.equal(opened.brokerScope, 'first-listener-instance');
    assert.equal(contexts[0].calls.length, 1); assert.equal(contexts[1].calls.length, 2);
    const { readdir } = await import('node:fs/promises');
    const states = await Promise.all((await readdir(root)).filter(name => name.startsWith('companion-instance-')).map(async name => JSON.parse(await readFile(join(root, name), 'utf8'))));
    assert.equal(states.length, 2);
    const disabled = states.find(state => state.brokerEnabled === false);
    assert.equal(disabled.brokerDisabledReason, 'address-in-use'); assert.equal(disabled.companionActive, true);
    assert.equal(JSON.stringify(states).includes(token), false); assert.equal(JSON.stringify(disabled).includes(id), false);
    second.deactivate();
    assert.equal((await brokerRequest(record, 'status')).broker.enabled, true);
  } finally { first.deactivate(); second.deactivate(); for (const context of contexts) for (const item of context.subscriptions) item.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('listen errors other than address-in-use still fail activation and dispose only this instance command', async () => {
  const { EventEmitter } = await import('node:events');
  const root = await mkdtemp(join(tmpdir(), 'native-bind-error-')); const file = join(root, 'auth.json'); const commands = new Map(); const disposals = []; let closed = false;
  const failure = Object.assign(new Error('test permission denied'), { code: 'EACCES' });
  class FailedServer extends EventEmitter { listen() { queueMicrotask(() => this.emit('error', failure)); } close() { closed = true; } }
  const vscode = { extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } },
    commands: { registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() { commands.delete(name); } }; } } };
  await writeFile(file, JSON.stringify({ port: 18486, token: 'test-only-bind-error-012345678901234567890', threads: [id] }), { mode: 0o600 });
  const extension = await load(file, vscode, { httpModule: { createServer: () => new FailedServer() } });
  try { await assert.rejects(extension.activate({ subscriptions: disposals }), /permission denied/); assert.equal(commands.size, 0); assert.equal(closed, true); }
  finally { extension.deactivate(); for (const item of disposals) item.dispose(); await rm(root, { recursive: true, force: true }); }
});
