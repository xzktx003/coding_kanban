import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, chmod, rm } from 'node:fs/promises';
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
    process: { env: { NATIVE_CODEX_COMPANION_CONFIG: config }, getuid: () => process.getuid(), pid: process.pid, kill: timerOverrides.kill ?? (() => { throw new Error('unexpected extension-host signal'); }) },
    require: name => name === 'node:http' && timerOverrides.httpModule ? timerOverrides.httpModule : name === 'vscode' ? vscode : name === './control.cjs' ? require('../companion/control.cjs') : name === './appserver-send.cjs' ? require('../companion/appserver-send.cjs') : require(name) };
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

test('resume opens the exact selected local thread in only its requested editor column', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-resume-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const selectedThread = '019aabcd-1234-7890-abcd-0123456789ac'; const calls = []; const disposals = [];
  const vscode = { extensions: { getExtension: () => ({ isActive: true, packageJSON: { version: 'test' }, async activate() {} }) }, window: { tabGroups: { all: [] } }, Uri: { parse: uri => uri },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async (...args) => { calls.push(args); } } };
  await writeFile(file, JSON.stringify({ port, token: 'test-only-resume-012345678901234567890', threads: [] }), { mode: 0o600 });
  const extension = await load(file, vscode); const headers = { authorization: 'Bearer test-only-resume-012345678901234567890', 'content-type': 'application/json' };
  try {
    await extension.activate({ subscriptions: disposals });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/resume`, { method: 'POST', headers, body: JSON.stringify({ threadId: selectedThread, column: 2 }) })).status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ['vscode.openWith', `openai-codex://route/local/${selectedThread}`, 'chatgpt.conversationEditor']);
    assert.equal(calls[0][3].viewColumn, 2);
    assert.equal((await fetch(`${base}/resume`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'not-a-thread', column: 2 }) })).status, 400);
    assert.equal((await fetch(`${base}/resume`, { method: 'POST', headers, body: JSON.stringify({ threadId: selectedThread, column: 4 }) })).status, 400);
    assert.equal(calls.length, 1);
  } finally { extension.deactivate(); for (const disposable of disposals) disposable.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('send uses the captured official app-server for the exact open thread and deduplicates receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-send-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const selectedThread = '019aabcd-1234-7890-abcd-0123456789ac'; const submissionId = '019aabcd-1234-7890-abcd-0123456789ad';
  const turnId = '019aabcd-1234-7890-abcd-0123456789ae'; const requests = []; const providers = new Map(); const disposals = []; let threadStatus = 'idle';
  const official = { isActive: false, packageJSON: { version: '26.51002.51308' }, async activate() {
    this.isActive = true;
    vscode.window.registerCustomEditorProvider('chatgpt.conversationEditor', { codexMcpConnection: appServer }, {});
  } };
  const appServer = {
    registerProvider(name, callbacks) { providers.set(name, callbacks); return { dispose() { providers.delete(name); } }; },
    sendRequest(name, requestId, method, params, reportDelivery) {
      requests.push({ name, requestId, method, params, reportDelivery });
      queueMicrotask(() => providers.get(name).onResult({ id: requestId, result: method === 'thread/read'
        ? { thread: { id: selectedThread, cwd: body.cwd, status: { type: threadStatus } } }
        : { turn: { id: turnId } } }));
    },
  };
  const uri = `openai-codex://route/local/${selectedThread}`;
  const vscode = { extensions: { getExtension: () => official },
    window: { tabGroups: { all: [{ viewColumn: 2, tabs: [{ isActive: true, input: { viewType: 'chatgpt.conversationEditor', uri: { toString: () => uri } } }] }] },
      registerCustomEditorProvider(_type, provider) { this.capturedProvider = provider; return { dispose() {} }; } },
    Uri: { parse: value => value }, commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} } };
  await writeFile(file, JSON.stringify({ port, token: 'test-only-send-012345678901234567890', threads: [] }), { mode: 0o600 });
  const extension = await load(file, vscode); const headers = { authorization: 'Bearer test-only-send-012345678901234567890', 'content-type': 'application/json' };
  const body = { threadId: selectedThread, column: 2, cwd: root, submissionId, text: 'send only to the selected native thread', images: [], contexts: [], mentions: [] };
  try {
    await extension.activate({ subscriptions: disposals });
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await (await fetch(`${base}/status`, { headers })).json()).sendAvailable, true);
    const sent = await fetch(`${base}/send`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(sent.status, 200); assert.deepEqual(await sent.json(), { accepted: true, turnId });
    assert.deepEqual(requests.map(request => request.method), ['thread/read', 'turn/start']);
    assert.equal(requests[1].params.threadId, selectedThread);
    assert.equal(requests[1].params.clientUserMessageId, submissionId);
    assert.deepEqual(requests[1].params.input, [{ type: 'text', text: body.text, text_elements: [] }]);
    assert.equal('sandboxPolicy' in requests[1].params, false, 'native thread settings must remain authoritative');
    const duplicate = await fetch(`${base}/send`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(duplicate.status, 200); assert.deepEqual(await duplicate.json(), { accepted: true, turnId });
    assert.equal(requests.length, 2);
    const ledger = await readFile(join(root, 'companion-send-receipts.json'), 'utf8');
    assert.equal(ledger.includes(body.text), false, 'durable receipts must not retain message bodies');
    assert.equal((await fetch(`${base}/send`, { method: 'POST', headers, body: JSON.stringify({ ...body, text: 'different payload with same id' }) })).status, 409);
    assert.equal((await fetch(`${base}/send`, { method: 'POST', headers, body: JSON.stringify({ ...body, column: 1 }) })).status, 409);
    assert.equal(requests.length, 2);
    threadStatus = 'active';
    const busy = await fetch(`${base}/send`, { method: 'POST', headers, body: JSON.stringify({ ...body, submissionId: '019aabcd-1234-7890-abcd-0123456789af' }) });
    assert.equal(busy.status, 409);
    assert.equal(requests.at(-1).method, 'thread/read', 'busy native turns must not receive a second turn/start');
  } finally { extension.deactivate(); for (const disposable of disposals) disposable.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('module-load capture survives the official extension becoming active before companion activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-send-capture-order-')); const file = join(root, 'auth.json'); const port = await sparePort();
  const disposals = []; const providers = new Map();
  const appServer = { registerProvider(name) { providers.set(name, true); return { dispose() { providers.delete(name); } }; }, sendRequest() {} };
  const official = { isActive: false, packageJSON: { version: '26.51002.51308' }, async activate() { this.isActive = true; } };
  const vscode = { extensions: { getExtension: () => official }, window: { tabGroups: { all: [] },
    registerCustomEditorProvider() { return { dispose() {} }; } }, Uri: { parse: value => value },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} } };
  const originalRegistration = vscode.window.registerCustomEditorProvider;
  await writeFile(file, JSON.stringify({ port, token: 'test-only-order-012345678901234567890', threads: [] }), { mode: 0o600 });
  const extension = await load(file, vscode);
  // Simulate an onUri/startup activation racing after the companion module loads but before activate().
  vscode.window.registerCustomEditorProvider('chatgpt.conversationEditor', { codexMcpConnection: appServer }, {});
  official.isActive = true;
  try {
    await extension.activate({ subscriptions: disposals });
    const status = await (await fetch(`http://127.0.0.1:${port}/status`, { headers: { authorization: 'Bearer test-only-order-012345678901234567890' } })).json();
    assert.equal(status.sendAvailable, true);
    assert.equal(status.sendBridge.officialActiveAtModuleLoad, false);
    assert.equal(status.sendBridge.officialActiveAtActivation, true);
    assert.equal(status.sendBridge.capturePatchRetainedAtModuleLoad, true);
    assert.equal(status.sendBridge.registrationCallCount, 1);
    assert.deepEqual(status.sendBridge.registeredViewTypes, ['chatgpt.conversationEditor']);
    assert.equal(status.sendBridge.providerCaptured, true);
    assert.equal(providers.size, 1);
    assert.equal(vscode.window.registerCustomEditorProvider, originalRegistration, 'capture wrapper must be removed after activation');
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
    assert.deepEqual([...commands.keys()], ['nativeCodexPrototype.openTwoTestPanels', 'nativeCodexPrototype.openTwoNewChats']);
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
  const token = 'test-only-startup-012345678901234567890'; const calls = []; const groupsCreated = []; const commands = new Map(); const subscriptions = [];
  const official = { isActive: false, packageJSON: { version: 'test' }, async activate() { await callbacks.activate?.(); this.isActive = true; } };
  let nextColumn = Math.max(1, ...(callbacks.tabs ?? []).map(group => group.viewColumn ?? 0));
  const tabGroups = { all: callbacks.tabs ?? [], activeTabGroup: { viewColumn: nextColumn }, async close(tab, preserveFocus) { return callbacks.close ? callbacks.close(tab, preserveFocus) : true; } };
  const vscode = { extensions: { getExtension: () => callbacks.missingOfficial ? undefined : official }, window: { tabGroups, createStatusBarItem: callbacks.createStatusBarItem }, Uri: { parse: uri => uri },
    commands: { registerCommand(name, callback) { commands.set(name, callback); return { dispose() { commands.delete(name); } }; },
      async executeCommand(...args) {
        if (args[0] === 'workbench.action.newGroupRight') { tabGroups.activeTabGroup = { viewColumn: ++nextColumn }; groupsCreated.push(nextColumn); return; }
        calls.push(args); await callbacks.open?.(...args);
      } } };
  await writeFile(file, JSON.stringify({ port, token, threads: [id, secondFixture, thirdFixture], ...config }), { mode: 0o600 });
  const extension = await load(file, vscode, { ...(callbacks.httpModule ? { httpModule: callbacks.httpModule } : {}), ...(callbacks.kill ? { kill: callbacks.kill } : {}) });
  t.after(async () => { callbacks.cleanup?.(); extension.deactivate(); for (const item of subscriptions) item.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, calls, groupsCreated, commands, subscriptions, extension, base: `http://127.0.0.1:${port}`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
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
test('one stalled resume does not block a different conversation opening beside it', async t => {
  const entered = deferred(); const stalled = deferred();
  const data = await startupFixture(t, {}, {
    open: (_name, uri) => {
      if (String(uri).endsWith(id)) { entered.resolve(); return stalled.promise; }
    },
    cleanup: stalled.resolve,
  });
  await data.extension.activate({ subscriptions: data.subscriptions });
  const first = fetch(`${data.base}/resume-beside`, {
    method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: id }),
  });
  const early = await Promise.race([
    first.then(response => ({ returned: true, status: response.status })),
    stalled.promise.then(() => ({ returned: false })),
  ]);
  assert.equal(early.returned, true);
  assert.equal(early.status, 200);
  const second = await fetch(`${data.base}/resume-beside`, {
    method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: secondFixture }),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).opened, true);
  assert.equal((await fetch(`${data.base}/resume-beside`, {
    method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: id }),
  })).status, 409);
  assert.equal(data.calls.length, 2);
  assert.deepEqual(data.groupsCreated, [2, 3]);
  assert.deepEqual(data.calls.map(call => call[3].viewColumn), [2, 3]);
  stalled.resolve();
  assert.equal((await first).status, 200);
});
test('private broker opens successive independent new-chat editors without a fixed window cap', async t => {
  const data = await startupFixture(t);
  await data.extension.activate({ subscriptions: data.subscriptions });
  for (let index = 1; index <= 12; index++) {
    const windowId = `019aabcd-1234-7890-abcd-${String(index).padStart(12, '0')}`;
    const response = await fetch(`${data.base}/new-beside`, {
      method: 'POST', headers: data.headers, body: JSON.stringify({ windowId }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).opened, true);
  }
  assert.equal(data.calls.length, 12);
  assert.deepEqual(data.groupsCreated, Array.from({ length: 12 }, (_, index) => index + 2));
  assert.deepEqual(data.calls.map(call => call[3].viewColumn), data.groupsCreated);
});
test('native focus selects only the exact existing editor group before input', async () => {
  const { focusNativeWindow, newChatUri, threadUri } = require('../companion/control.cjs');
  const windowId = '019aabcd-1234-7890-abcd-0123456789ae';
  const newUri = newChatUri(windowId, [windowId]);
  const localUri = threadUri(id, [id]);
  const makeTab = uri => ({ isActive: true, input: { uri: { toString: () => uri }, viewType: 'chatgpt.conversationEditor' } });
  const first = { viewColumn: 1, isActive: true, tabs: [makeTab(newUri)] };
  const second = { viewColumn: 2, isActive: false, tabs: [makeTab(localUri)] };
  const tabGroups = { all: [first, second], activeTabGroup: first };
  const calls = [];
  const vscode = { window: { tabGroups }, Uri: { parse: uri => uri }, commands: { async executeCommand(...args) {
    calls.push(args);
    const group = tabGroups.all.find(candidate => candidate.viewColumn === args[3]?.viewColumn);
    if (group) { for (const candidate of tabGroups.all) candidate.isActive = candidate === group; tabGroups.activeTabGroup = group; }
  } } };
  assert.deepEqual(await focusNativeWindow(vscode, { kind: 'thread', targetId: id }), { focused: true, column: 2 });
  assert.equal(tabGroups.activeTabGroup, second);
  assert.deepEqual(await focusNativeWindow(vscode, { kind: 'new', targetId: windowId }), { focused: true, column: 1 });
  assert.equal(tabGroups.activeTabGroup, first);
  assert.deepEqual(await focusNativeWindow(vscode, { kind: 'new', targetId: windowId }), { focused: true, column: 1 });
  assert.deepEqual(calls.map(call => [call[0], call[1], call[3].viewColumn]), [
    ['vscode.openWith', localUri, 2], ['vscode.openWith', newUri, 1],
  ]);
  await assert.rejects(focusNativeWindow(vscode, { kind: 'new', targetId: windowId, command: 'evil' }), /only/);
  await assert.rejects(focusNativeWindow(vscode, { kind: 'thread', targetId: '019aabcd-1234-7890-abcd-0123456789af' }), /not open/);
});
test('resuming a thread already open in a native editor reuses its group', async () => {
  const { resumeThreadBeside, threadUri } = require('../companion/control.cjs');
  const uri = threadUri(id, [id]);
  const tab = { isActive: false, input: { uri: { toString: () => uri }, viewType: 'chatgpt.conversationEditor' } };
  const group = { viewColumn: 3, isActive: false, tabs: [tab] };
  const tabGroups = { all: [group], activeTabGroup: { viewColumn: 1, tabs: [] } };
  const calls = [];
  const vscode = { window: { tabGroups }, Uri: { parse: value => value }, commands: { async executeCommand(...args) {
    calls.push(args);
    if (args[0] === 'workbench.action.newGroupRight') throw new Error('must reuse exact existing group');
    tab.isActive = true; group.isActive = true; tabGroups.activeTabGroup = group;
  } } };
  assert.deepEqual(await resumeThreadBeside(vscode, { threadId: id }), { threadId: id, opened: true, column: 3 });
  assert.deepEqual(calls.map(call => call[0]), ['vscode.openWith']);
});
test('each extension instance publishes a private broker and a browser-visible identity marker', async t => {
  const marker = { text: '', showCalled: false, disposed: false, show() { this.showCalled = true; }, dispose() { this.disposed = true; } };
  const data = await startupFixture(t, {}, { createStatusBarItem: () => marker });
  await data.extension.activate({ subscriptions: data.subscriptions });
  const files = (await readdir(data.root)).filter(name => name.startsWith('companion-session-'));
  assert.equal(files.length, 1);
  const registry = JSON.parse(await readFile(join(data.root, files[0]), 'utf8'));
  assert.match(registry.instanceId, /^[0-9a-f-]{36}$/);
  assert.equal(marker.text, `Kanban host ${registry.instanceId}`);
  assert.equal(marker.showCalled, true);
  const status = await fetch(`http://127.0.0.1:${registry.port}/status`, { headers: { authorization: `Bearer ${registry.token}` } });
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).instanceBroker, { enabled: true, instanceId: registry.instanceId });
  data.extension.deactivate();
  assert.equal(marker.disposed, true);
  assert.equal((await readdir(data.root)).some(name => name === files[0]), false);
});
test('release stops only the authenticated private extension-host instance', async t => {
  const signals = [];
  const data = await startupFixture(t, {}, { kill: (pid, signal) => signals.push({ pid, signal }) });
  await data.extension.activate({ subscriptions: data.subscriptions });
  const file = (await readdir(data.root)).find(name => name.startsWith('companion-session-'));
  const registry = JSON.parse(await readFile(join(data.root, file), 'utf8'));
  const privateBase = `http://127.0.0.1:${registry.port}`;
  const nextInstanceId = '019aabcd-1234-7890-abcd-0123456789ae';
  const headers = { authorization: `Bearer ${registry.token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${data.base}/release`, { method: 'POST', headers, body: JSON.stringify({ currentInstanceId: nextInstanceId }) })).status, 404);
  assert.equal((await fetch(`${privateBase}/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentInstanceId: nextInstanceId }) })).status, 401);
  assert.equal((await fetch(`${privateBase}/release`, { method: 'POST', headers, body: JSON.stringify({ currentInstanceId: registry.instanceId }) })).status, 400);
  assert.equal((await fetch(`${privateBase}/release`, { method: 'POST', headers, body: JSON.stringify({ currentInstanceId: nextInstanceId, command: 'evil' }) })).status, 400);
  assert.deepEqual(signals, []);
  const response = await fetch(`${privateBase}/release`, { method: 'POST', headers, body: JSON.stringify({ currentInstanceId: nextInstanceId }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { released: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(signals, [{ pid: process.pid, signal: 'SIGTERM' }]);
  assert.equal((await readdir(data.root)).includes(file), false);
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

const newWindowIds = ['019aabcd-5678-7890-abcd-0123456789ab', '019aabcd-5678-7890-abcd-0123456789ac'];
const newChatConfig = { threads: [], newChatWindowIds: newWindowIds, autoOpenNewChats: true };
test('native new chat control constructs only captured new-page URIs and fixed columns', async () => {
  const { newChatUri, validateNewChatPanels, openNewChatPanels } = require('../companion/control.cjs');
  assert.equal(newChatUri(newWindowIds[0], newWindowIds), `openai-codex://route/extension/panel/new?nativeCodexPanel=${newWindowIds[0]}`);
  for (const value of ['../local/evil', `${newWindowIds[0]}&command=evil`, id, null]) assert.throws(() => newChatUri(value, newWindowIds), /allowlisted.*UUID/);
  for (const value of [[], [id], [id, id], [id, secondFixture, thirdFixture]]) assert.throws(() => validateNewChatPanels(value), /two distinct/);
  const calls = [];
  await openNewChatPanels({ Uri: { parse: uri => uri }, commands: { executeCommand: async (...args) => calls.push(args) } }, newWindowIds);
  assert.deepEqual(calls.map(call => [call[0], call[1], call[2], call[3]]), newWindowIds.map((windowId, index) => [
    'vscode.openWith', `openai-codex://route/extension/panel/new?nativeCodexPanel=${windowId}`, 'chatgpt.conversationEditor',
    { viewColumn: index + 1, preview: false, preserveFocus: false }
  ]));
});
test('new-chat restore replaces only its captured clean editor with the observed local thread', async () => {
  const { newChatUri, restoreNewChatThread } = require('../companion/control.cjs');
  const calls = []; const closed = [];
  const tabs = newWindowIds.map((windowId, index) => ({ viewColumn: index + 1, tabs: [{
    input: { uri: { toString: () => newChatUri(windowId, newWindowIds) }, viewType: 'chatgpt.conversationEditor' },
    isDirty: false
  }] }));
  const vscode = {
    Uri: { parse: uri => uri },
    window: { tabGroups: { all: tabs, async close(tab, preserveFocus) { closed.push({ tab, preserveFocus }); return true; } } },
    commands: { async executeCommand(...args) { calls.push(args); } }
  };
  const result = await restoreNewChatThread(vscode, { windowId: newWindowIds[1], threadId: id, column: 2 }, newWindowIds);
  assert.deepEqual(result, { windowId: newWindowIds[1], threadId: id, column: 2, restored: true });
  assert.deepEqual(calls, [[
    'vscode.openWith', `openai-codex://route/local/${id}`, 'chatgpt.conversationEditor',
    { viewColumn: 2, preview: false, preserveFocus: false }
  ]]);
  assert.equal(closed.length, 1); assert.equal(closed[0].tab, tabs[1].tabs[0]); assert.equal(closed[0].preserveFocus, true);
  for (const body of [
    { windowId: newWindowIds[0], threadId: id, column: 2 },
    { windowId: newWindowIds[1], threadId: id, column: 3 },
    { windowId: newWindowIds[1], threadId: '../local/evil', column: 2 },
    { windowId: newWindowIds[1], threadId: id, column: 2, command: 'evil' },
  ]) await assert.rejects(restoreNewChatThread(vscode, body, newWindowIds));
  assert.equal(calls.length, 1); assert.equal(closed.length, 1);
  tabs[0].tabs[0].isDirty = true;
  await assert.rejects(restoreNewChatThread(vscode, { windowId: newWindowIds[0], threadId: id, column: 1 }, newWindowIds), /unsaved/);
  assert.equal(calls.length, 1); assert.equal(closed.length, 1);
});
test('private restore route shares auth and lock and accepts only an open captured new-chat tab', async t => {
  const { newChatUri } = require('../companion/control.cjs');
  const tabs = newWindowIds.map((windowId, index) => ({ viewColumn: index + 1, tabs: [{ isDirty: false,
    input: { uri: { toString: () => newChatUri(windowId, newWindowIds) }, viewType: 'chatgpt.conversationEditor' } }] }));
  const closed = [];
  const data = await startupFixture(t, newChatConfig, { tabs, close: async (tab, preserveFocus) => { closed.push({ tab, preserveFocus }); return true; } });
  await data.extension.activate({ subscriptions: data.subscriptions });
  const body = { windowId: newWindowIds[0], threadId: id, column: 1 };
  assert.equal((await fetch(`${data.base}/restore`, { method: 'POST', headers: data.headers, body: JSON.stringify(body) })).status, 200);
  assert.deepEqual(data.calls.at(-1), ['vscode.openWith', `openai-codex://route/local/${id}`, 'chatgpt.conversationEditor',
    { viewColumn: 1, preview: false, preserveFocus: false }]);
  assert.equal(closed.length, 1); assert.equal(closed[0].tab, tabs[0].tabs[0]); assert.equal(closed[0].preserveFocus, true);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.equal(status.opened.at(-1).kind, 'restore'); assert.equal(status.opened.at(-1).threadId, undefined);
  for (const invalid of [
    { ...body, column: 2 }, { ...body, windowId: secondFixture }, { ...body, threadId: 'command:evil' }, { ...body, command: 'evil' },
  ]) assert.equal((await fetch(`${data.base}/restore`, { method: 'POST', headers: data.headers, body: JSON.stringify(invalid) })).status, 400);
  assert.equal((await fetch(`${data.base}/restore`, { headers: data.headers })).status, 404);
  assert.equal(closed.length, 1);
});
test('explicit new-chat startup waits for official activation and requires no fixture threads', async t => {
  const activation = deferred(); const entered = deferred();
  const data = await startupFixture(t, newChatConfig, { activate: () => { entered.resolve(); return activation.promise; }, cleanup: activation.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  assert.equal(data.calls.length, 0); activation.resolve(); await pending;
  assert.deepEqual(data.calls.map(call => [call[0], call[1], call[2], call[3].viewColumn]), newWindowIds.map((windowId, index) => [
    'vscode.openWith', `openai-codex://route/extension/panel/new?nativeCodexPanel=${windowId}`, 'chatgpt.conversationEditor', index + 1
  ]));
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.deepEqual(status.autoOpenNewChats, { enabled: true, state: 'completed' });
  assert.deepEqual(status.autoOpenFixtures, { enabled: false, state: 'disabled' });
  assert.deepEqual(status.opened.map(item => item.windowId), newWindowIds);
  assert.equal(status.opened.some(item => item.threadId !== undefined), false);
  assert.equal(status.tabs.length, 0);
});
test('new chat palette command accepts no arguments and startup stays disabled by default', async t => {
  const data = await startupFixture(t, { threads: [], newChatWindowIds: newWindowIds });
  await data.extension.activate({ subscriptions: data.subscriptions }); assert.equal(data.calls.length, 0);
  const manifest = JSON.parse(await readFile(new URL('../companion/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.contributes.commands.find(item => item.command === 'nativeCodexPrototype.openTwoNewChats').title, 'Native Codex: Open Two New Chats');
  const command = data.commands.get('nativeCodexPrototype.openTwoNewChats');
  for (const args of [[{}], [{ uri: 'command:evil' }], [newWindowIds], [undefined]]) await assert.rejects(command(...args), /arguments/);
  assert.equal(data.calls.length, 0); await command(); assert.equal(data.calls.length, 2);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.deepEqual(status.autoOpenNewChats, { enabled: false, state: 'disabled' });
  assert.equal((await fetch(`${data.base}/open-new`, { method: 'POST', headers: data.headers, body: '{}' })).status, 404);
});
test('new chat configuration rejects invalid identities, booleans and fixture startup conflict', async t => {
  for (const config of [{ autoOpenNewChats: 'true' }, { autoOpenNewChats: 1 }, { autoOpenNewChats: null },
    { autoOpenNewChats: true }, { autoOpenNewChats: true, newChatWindowIds: [id] }, { newChatWindowIds: [id, id] },
    { newChatWindowIds: [id, 'command:evil'] }, { newChatWindowIds: 'evil' }, { ...newChatConfig, threads: [id, secondFixture], autoOpenFixtures: true }]) {
    const data = await startupFixture(t, config);
    await assert.rejects(data.extension.activate({ subscriptions: data.subscriptions }), /boolean|two distinct|allowlisted|mutually exclusive/);
    assert.equal(data.commands.size, 0); assert.equal(data.calls.length, 0);
  }
});
test('new chat startup shares the fixture palette and HTTP lock; disposal prevents second panel', async t => {
  const entered = deferred(); const execution = deferred();
  const data = await startupFixture(t, { ...newChatConfig, threads: [id, secondFixture] }, { open: () => { entered.resolve(); return execution.promise; }, cleanup: execution.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  const command = data.commands.get('nativeCodexPrototype.openTwoNewChats');
  await assert.rejects(command(), /opening in progress/);
  await assert.rejects(data.commands.get('nativeCodexPrototype.openTwoTestPanels')(), /opening in progress/);
  assert.equal((await fetch(`${data.base}/open`, { method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: id, column: 1 }) })).status, 409);
  const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
  assert.equal(status.autoOpenNewChats.state, 'opening');
  data.extension.deactivate(); execution.resolve(); await pending;
  assert.equal(data.calls.length, 1); assert.equal(data.commands.size, 0); await assert.rejects(command(), /disposed/);
  await assert.rejects(readFile(join(data.root, 'companion-ready.json')), { code: 'ENOENT' });
});
test('new chat startup rejects missing official activation and reports failures without retry', async t => {
  for (const callbacks of [{ missingOfficial: true }, { activate() { throw new Error('activation failure'); } }, { open() { throw new Error('new panel failure'); } }]) {
    const data = await startupFixture(t, newChatConfig, callbacks); await data.extension.activate({ subscriptions: data.subscriptions });
    const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
    assert.equal(status.autoOpenNewChats.state, 'failed'); assert.match(status.autoOpenNewChats.error, /official extension|new panel failure/);
    assert.equal(data.calls.length, callbacks.open ? 1 : 0);
  }
});
test('new chat startup on occupied broker remains scoped to its own VS Code instance', async t => {
  const port = await sparePort(); const first = await startupFixture(t, { port }); const second = await startupFixture(t, { ...newChatConfig, port });
  await first.extension.activate({ subscriptions: first.subscriptions }); await second.extension.activate({ subscriptions: second.subscriptions });
  assert.equal(first.calls.length, 0); assert.equal(second.calls.length, 2);
  const status = await (await fetch(`${first.base}/status`, { headers: first.headers })).json();
  assert.deepEqual(status.autoOpenNewChats, { enabled: false, state: 'disabled' }); assert.equal(status.opened.length, 0);
  await assert.rejects(readFile(join(second.root, 'companion-ready.json')), { code: 'ENOENT' }); second.extension.deactivate();
  assert.equal((await fetch(`${first.base}/status`, { headers: first.headers })).status, 200);
});
test('new chat status observes current native tab URI identity without opening or creating threads', async t => {
  const tabs = [{ viewColumn: 1, isActive: true, tabs: [{ label: 'Native response', isActive: true,
    input: { uri: { toString: () => `openai-codex://route/local/${id}` }, viewType: 'chatgpt.conversationEditor' } }] }];
  const data = await startupFixture(t, { threads: [], newChatWindowIds: newWindowIds }, { tabs });
  await data.extension.activate({ subscriptions: data.subscriptions });
  for (let i = 0; i < 2; i += 1) {
    const status = await (await fetch(`${data.base}/status`, { headers: data.headers })).json();
    assert.deepEqual(status.tabs, [{ column: 1, active: true, tabs: [{ label: 'Native response', active: true,
      uri: `openai-codex://route/local/${id}`, viewType: 'chatgpt.conversationEditor' }] }]);
    assert.equal(status.opened.length, 0); assert.equal(data.calls.length, 0);
  }
});
test('new chat disposal during official activation prevents all commands and broker readiness', async t => {
  const entered = deferred(); const activation = deferred();
  const data = await startupFixture(t, newChatConfig, { activate: () => { entered.resolve(); return activation.promise; }, cleanup: activation.resolve });
  const pending = data.extension.activate({ subscriptions: data.subscriptions }); await entered.promise;
  data.extension.deactivate(); activation.resolve(); await pending;
  assert.equal(data.calls.length, 0); assert.equal(data.commands.size, 0);
  await assert.rejects(readFile(join(data.root, 'companion-ready.json')), { code: 'ENOENT' });
});
test('new chat startup releases the shared lock after success or command failure', async t => {
  for (const failInitially of [false, true]) {
    let fail = failInitially;
    const data = await startupFixture(t, { ...newChatConfig, threads: [id, secondFixture] }, { open() { if (fail) throw new Error('new panel failure'); } });
    await data.extension.activate({ subscriptions: data.subscriptions }); fail = false;
    const startupCalls = data.calls.length;
    await data.commands.get('nativeCodexPrototype.openTwoNewChats')();
    await data.commands.get('nativeCodexPrototype.openTwoTestPanels')();
    assert.equal(data.calls.length, startupCalls + 4);
    assert.equal((await fetch(`${data.base}/open`, { method: 'POST', headers: data.headers, body: JSON.stringify({ threadId: id, column: 1 }) })).status, 200);
    assert.equal(data.calls.length, startupCalls + 5);
  }
});
