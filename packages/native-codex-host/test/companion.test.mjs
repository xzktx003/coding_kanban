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

const secondFixture = '019aabcd-1234-7890-abcd-0123456789ac';
const thirdFixture = '019aabcd-1234-7890-abcd-0123456789ad';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function startupFixture(t, config = {}, callbacks = {}) {
  const root = await mkdtemp(join(tmpdir(), 'native-startup-')); const file = join(root, 'auth.json'); const port = config.port ?? await sparePort();
  const token = 'test-only-startup-012345678901234567890'; const calls = []; const commands = new Map(); const subscriptions = [];
  const official = { isActive: false, packageJSON: { version: 'test' }, async activate() { await callbacks.activate?.(); this.isActive = true; } };
  const vscode = { extensions: { getExtension: () => callbacks.missingOfficial ? undefined : official }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand(name, callback) { commands.set(name, callback); return { dispose() { commands.delete(name); } }; },
      async executeCommand(...args) { calls.push(args); await callbacks.open?.(...args); } } };
  await writeFile(file, JSON.stringify({ port, token, threads: [id, secondFixture, thirdFixture], ...config }), { mode: 0o600 });
  const extension = await load(file, vscode, callbacks.httpModule ? { httpModule: callbacks.httpModule } : {});
  t.after(async () => { callbacks.cleanup?.(); extension.deactivate(); for (const item of subscriptions) item.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, calls, commands, subscriptions, extension, base: `http://127.0.0.1:${port}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
}
test('explicit startup auto-open waits for official activation and opens only the first two captured fixtures', async t => {
  const activation = deferred(); const entered = deferred();
  const data = await startupFixture(t, { autoOpenFixtures: true }, { activate: () => { entered.resolve(); return activation.promise; }, cleanup: activation.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  assert.equal(data.calls.length, 0); assert.equal(data.commands.size, 0);
  activation.resolve(); await pending;
  assert.deepEqual(data.calls.map(call => [call[0], call[1], call[2], call[3].viewColumn]), [
    ['vscode.openWith', `openai-codex://route/local/${id}`, 'chatgpt.conversationEditor', 1],
    ['vscode.openWith', `openai-codex://route/local/${secondFixture}`, 'chatgpt.conversationEditor', 2]
  ]);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.deepEqual(status.autoOpenFixtures, { enabled: true, state: 'completed' }); assert.equal(status.opened.length, 2);
});
test('explicit false leaves startup panels unopened', async t => {
  const data = await startupFixture(t, { autoOpenFixtures: false });
  await data.extension.activate({ subscriptions: data.subscriptions }); assert.equal(data.calls.length, 0);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.deepEqual(status.autoOpenFixtures, { enabled: false, state: 'disabled' });
});
test('startup opening shares the palette and broker lock and releases it after completion', async t => {
  const entered = deferred(); const execution = deferred();
  const data = await startupFixture(t, { autoOpenFixtures: true }, { open: () => { entered.resolve(); return execution.promise; }, cleanup: execution.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  await assert.rejects(data.commands.get('nativeCodexPrototype.openTwoTestPanels')(), /opening in progress/);
  const options = { method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: thirdFixture, column: 3 }) };
  assert.equal((await fetch(`${data.base}/open`, options)).status, 409);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.equal(status.autoOpenFixtures.state, 'opening'); assert.equal(data.calls.length, 1);
  execution.resolve(); await pending;
  await data.commands.get('nativeCodexPrototype.openTwoTestPanels')(); assert.equal(data.calls.length, 4);
  assert.equal((await fetch(`${data.base}/open`, options)).status, 200); assert.equal(data.calls.length, 5);
});
test('private startup configuration accepts booleans only and requires two distinct captured fixtures', async t => {
  for (const config of [{ autoOpenFixtures: 'true' }, { autoOpenFixtures: 1 }, { autoOpenFixtures: null },
    { autoOpenFixtures: true, threads: [id] }, { autoOpenFixtures: true, threads: [id, id, thirdFixture] }]) {
    const data = await startupFixture(t, config);
    await assert.rejects(data.extension.activate({ subscriptions: data.subscriptions }), /boolean|two distinct fixture threads/);
    assert.equal(data.commands.size, 0); assert.equal(data.calls.length, 0);
  }
});
test('startup refuses to open when the official extension is missing or activation fails', async t => {
  for (const callbacks of [{ missingOfficial: true }, { activate() { throw new Error('fixture activation failure'); } }]) {
    const data = await startupFixture(t, { autoOpenFixtures: true }, callbacks);
    await data.extension.activate({ subscriptions: data.subscriptions }); assert.equal(data.calls.length, 0);
    const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
    assert.equal(status.autoOpenFixtures.state, 'failed'); assert.match(status.autoOpenFixtures.error, /official extension/);
  }
});
test('startup command failure is diagnosed without retry and the opening lock is released', async t => {
  let fail = true;
  const data = await startupFixture(t, { autoOpenFixtures: true }, { open() { if (fail) throw new Error('fixture panel open failure'); } });
  await data.extension.activate({ subscriptions: data.subscriptions }); assert.equal(data.calls.length, 1);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.equal(status.autoOpenFixtures.state, 'failed'); assert.match(status.autoOpenFixtures.error, /panel open/);
  fail = false; await data.commands.get('nativeCodexPrototype.openTwoTestPanels')(); assert.equal(data.calls.length, 3);
});
test('deactivation during startup cannot open a second panel or leave a usable palette command', async t => {
  const entered = deferred(); const execution = deferred();
  const data = await startupFixture(t, { autoOpenFixtures: true }, { open: () => { entered.resolve(); return execution.promise; }, cleanup: execution.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  const command = data.commands.get('nativeCodexPrototype.openTwoTestPanels'); data.extension.deactivate();
  execution.resolve(); await pending;
  assert.equal(data.calls.length, 1); assert.equal(data.commands.size, 0);
  await assert.rejects(command(), /disposed/);
  await assert.rejects(readFile(join(data.root, 'companion-ready.json')), { code: 'ENOENT' });
});
test('deactivation while official activation is pending prevents broker and palette startup', async t => {
  const entered = deferred(); const activation = deferred();
  const data = await startupFixture(t, { autoOpenFixtures: true }, { activate: () => { entered.resolve(); return activation.promise; }, cleanup: activation.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  data.extension.deactivate(); activation.resolve(); await pending;
  assert.equal(data.calls.length, 0); assert.equal(data.commands.size, 0);
  await assert.rejects(readFile(join(data.root, 'companion-ready.json')), { code: 'ENOENT' });
});
test('auto-open with an occupied broker remains local to its own VS Code instance', async t => {
  const port = await sparePort(); const first = await startupFixture(t, { port }); const second = await startupFixture(t, { port, autoOpenFixtures: true });
  await first.extension.activate({ subscriptions: first.subscriptions });
  await second.extension.activate({ subscriptions: second.subscriptions });
  assert.equal(first.calls.length, 0); assert.equal(second.calls.length, 2);
  const ownerStatus = await (await fetch(`${first.base}/status`, { headers: first.headers })).json();
  assert.equal(ownerStatus.broker.enabled, true); assert.equal(ownerStatus.autoOpenFixtures.enabled, false); assert.equal(ownerStatus.opened.length, 0);
  await assert.rejects(readFile(join(second.root, 'companion-ready.json')), { code: 'ENOENT' });
  second.extension.deactivate();
  assert.equal((await fetch(`${first.base}/status`, { headers: first.headers })).status, 200);
});
test('deactivation while a broker body is pending prevents any later VS Code execution', async t => {
  const data = await startupFixture(t); await data.extension.activate({ subscriptions: data.subscriptions });
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(`${data.base}/open`, { method: 'POST', headers: data.headers }, incoming => {
      incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode));
    });
    request.on('error', reject); request.write('{');
  });
  response.catch(() => {}); t.after(() => request.destroy());
  await fetch(`${data.base}/status`, { headers: data.headers }); data.extension.deactivate();
  request.end(JSON.stringify({ threadId: id, column: 1 }).slice(1));
  assert.equal(await response, 400); assert.equal(data.calls.length, 0);
});
test('deactivation during broker listen settles activation without panels or readiness and preserves another listener', async t => {
  const first = await startupFixture(t); await first.extension.activate({ subscriptions: first.subscriptions });
  let closed = false; let ownedServer; let data;
  const httpModule = { createServer(handler) {
    ownedServer = http.createServer(handler); const listen = ownedServer.listen.bind(ownedServer);
    ownedServer.listen = (...args) => { const result = listen(...args); queueMicrotask(() => data.extension.deactivate()); return result; };
    ownedServer.on('close', () => { closed = true; }); return ownedServer;
  } };
  data = await startupFixture(t, { autoOpenFixtures: true }, { httpModule });
  const pending = data.extension.activate({ subscriptions: data.subscriptions });
  let deadline;
  try {
    const settled = await Promise.race([pending.then(() => true), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 100); })]);
    assert.equal(settled, true, 'activation must settle after closing its pending listener');
    assert.equal(closed, true); assert.equal(ownedServer.listening, false);
    assert.equal(data.calls.length, 0); assert.equal(data.commands.size, 0);
    await assert.rejects(readFile(join(data.root, 'companion-ready.json')), { code: 'ENOENT' });
    const { readdir } = await import('node:fs/promises');
    assert.equal((await readdir(data.root)).some(name => name.startsWith('companion-instance-')), false);
    assert.equal((await fetch(`${first.base}/status`, { headers: first.headers })).status, 200);
  } finally { clearTimeout(deadline); }
});
