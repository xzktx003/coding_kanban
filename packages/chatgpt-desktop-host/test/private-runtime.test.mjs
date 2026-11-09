import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { preparePrivateRuntime } from '../src/private-runtime.mjs';

const profileId = randomUUID();
const generation = randomUUID();

test('refuses runtime roots whose derived native IPC path exceeds Unix socket bytes', async t => {
  const f = await fixture(t);
  await assert.rejects(preparePrivateRuntime({ ...f, runtimeRoot: join(f.dir, 'x'.repeat(100)) }), { code: 'PRIVATE_PATH_TOO_LONG' });
  await assert.rejects(preparePrivateRuntime({ ...f, runtimeRoot: join(f.dir, '路径'.repeat(20)) }), { code: 'PRIVATE_PATH_TOO_LONG' });
});

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-private-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sourceRoot = join(dir, 'source');
  await mkdir(join(sourceRoot, 'resources'), { recursive: true });
  await chmod(sourceRoot, 0o755);
  await chmod(join(sourceRoot, 'resources'), 0o755);
  await writeFile(join(sourceRoot, 'ChatGPT'), 'not the official binary', { mode: 0o755 });
  await writeFile(join(sourceRoot, 'resources', 'app.asar'), 'not the official archive', {mode:0o644});
  return { dir, sourceRoot, runtimeRoot: join(dir, 'runtime'), profileId, generation };
}

test('requires canonical paths and UUID-scoped profile identity', async t => {
  const f = await fixture(t);
  for (const config of [
    { ...f, sourceRoot: 'relative' },
    { ...f, runtimeRoot: join(f.dir, 'nested', '..', 'runtime') + '/..' },
    { ...f, profileId: 'invalid' },
    { ...f, generation: '' },
  ]) await assert.rejects(preparePrivateRuntime(config));
});

test('rejects malformed project roots before preparing an artifact or reading accessor values', async t => {
  const f = await fixture(t);
  let accessed = false;
  const roots = [join(f.dir, 'project')];
  Object.defineProperty(roots, '0', {get() {accessed = true; return f.sourceRoot;}});
  for (const projectRoots of ['relative', ['relative'], [f.sourceRoot, f.sourceRoot], roots]) {
    await assert.rejects(preparePrivateRuntime({...f, projectRoots}), {code:'PRIVATE_INVALID_PROJECTS'});
  }
  assert.equal(accessed, false);
  await assert.rejects(lstat(f.runtimeRoot), {code:'ENOENT'});
});

test('refuses pre-existing, non-private and symlinked runtime parents without changing them', async t => {
  const f = await fixture(t);
  await mkdir(f.runtimeRoot, { mode: 0o700 });
  const marker = join(f.runtimeRoot, 'keep');
  await writeFile(marker, 'unchanged');
  await assert.rejects(preparePrivateRuntime(f));
  assert.equal(await readFile(marker, 'utf8'), 'unchanged');
  const publicParent = join(f.dir, 'public');
  await mkdir(publicParent, { mode: 0o755 });
  await chmod(publicParent, 0o755);
  await assert.rejects(preparePrivateRuntime({ ...f, runtimeRoot: join(publicParent, 'runtime') }));
  const alias = join(f.dir, 'alias');
  await symlink(f.dir, alias);
  await assert.rejects(preparePrivateRuntime({ ...f, runtimeRoot: join(alias, 'different') }));
});

test('rejects unknown binary and archives without creating a runtime', async t => {
  const f = await fixture(t);
  await assert.rejects(preparePrivateRuntime(f), /digest|version|artifact|hash/i);
  await assert.rejects(lstat(f.runtimeRoot), { code: 'ENOENT' });
});

test('rejects a source tree writable by other users before checking artifacts', async t => {
  const f = await fixture(t);
  await chmod(f.sourceRoot,0o777);
  await assert.rejects(preparePrivateRuntime(f),{code:'PRIVATE_UNSAFE_SOURCE'});
  await assert.rejects(lstat(f.runtimeRoot),{code:'ENOENT'});
});

test('owned view forwards a fixed call and one real MessagePort without creating fixture services', async t => {
  const source = await readFile(new URL('../src/native-view-shim.js', import.meta.url), 'utf8');
  let command, nativePort, transferredPort;
  const emitted = [], listeners = new Map();
  const control = { subscribe(fn) { command = fn; }, emit(frame) { emitted.push(frame); } };
  const bridge = { sendMessageFromView: async value => ({ accepted:value }),
    subscribeToSystemThemeVariant: () => () => {}, getSystemThemeVariant: () => 'light' };
  const win = {
    __kanbanOwnedControl:control, electronBridge:bridge, location:{origin:'app://-'},
    addEventListener(name, fn) { listeners.set(name, fn); },
    postMessage(data, origin, ports) {
      if (data.type === 'connect-app-host') { nativePort = data.port; nativePort.start(); }
      if (data.type === 'kanban-owned:app-host-port') {
        assert.equal(origin,'app://-'); assert.equal(data.id,2); assert.equal(data.portId,'app-host-1');
        assert.equal(ports.length,1); transferredPort = ports[0]; transferredPort.start();
      }
    },
  };
  vm.runInNewContext(source, { window:win, MessageChannel, TextEncoder, setTimeout, clearTimeout });
  assert.ok(command);
  await command({type:'call', id:1, method:'sendMessageFromView', args:['hello']});
  assert.equal(emitted.at(-1).type,'return');
  assert.deepEqual(emitted.at(-1).value,{accepted:'hello'});
  await command({type:'openPort', id:2, portId:'app-host-1', name:'app-host'});
  assert.ok(nativePort);
  assert.ok(transferredPort);
  assert.equal(emitted.some(frame => frame.type === 'return' && frame.id === 2),false);
  assert.equal(emitted.filter(item => item.type === 'portMessage').length, 0);
  const hostFrame = once(transferredPort,'message');
  nativePort.postMessage(['host-frame']);
  assert.deepEqual((await hostFrame)[0],['host-frame']);
  await command({type:'openPort', id:3, portId:'app-host-2', name:'app-host'});
  assert.equal(emitted.at(-1).type,'throw');
  const received = once(nativePort,'message');
  transferredPort.postMessage(new Uint8Array([4,7]));
  assert.deepEqual((await received)[0],new Uint8Array([4,7]));
  await command({type:'call',id:6,method:'executeJavaScript',args:['1+1']});
  assert.equal(emitted.at(-1).type,'throw');
  await command({type:'dispose'});
  nativePort.close(); transferredPort.close();
});

test('native view bounds unacknowledged IPC and its finite local waiting pool', async () => {
  const source = await readFile(new URL('../src/native-view-shim.js', import.meta.url), 'utf8');
  let command;
  const emitted = [];
  const win = {__kanbanOwnedControl:{subscribe(fn) {command=fn;},emit(frame) {emitted.push(frame);}},
    electronBridge:{sendMessageFromView:async () => true},location:{origin:'app://-'},
    addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(source,{window:win,MessageChannel,TextEncoder,structuredClone,setTimeout,clearTimeout});
  for (let id=1; id<=320; id++) await command({type:'call',id,method:'sendMessageFromView',args:[]});
  assert.equal(emitted.filter(frame => frame.type === 'return').length,64);
  assert.equal(emitted.some(frame => frame.type === 'overflow'),false);
  await command({type:'call',id:321,method:'sendMessageFromView',args:[]});
  assert.equal(emitted.at(-1).type,'overflow');
  assert.equal(emitted.at(-1).kind,'awaiting_count');
});

test('native view records bounded overflow kinds without including values', async () => {
  const source = await readFile(new URL('../src/native-view-shim.js', import.meta.url), 'utf8');
  for (const scenario of ['awaiting_bytes', 'unsupported_value', 'value_budget', 'emit_error', 'unexpected_ack']) {
    let command;
    const emitted = [], payload = 'PRIVATE_VALUE_SENTINEL';
    const win = {__kanbanOwnedControl:{subscribe(fn) {command=fn;},emit(frame) {
      if (scenario === 'emit_error' && frame.type !== 'overflow') throw Error(payload);
      emitted.push(frame);
    }},
      electronBridge:{sendMessageFromView:async () => scenario === 'unsupported_value' ? new Error(payload) : 'x'.repeat(scenario === 'value_budget' ? 8 * 1024 * 1024 + 1 : 4_300_000)},
      location:{origin:'app://-'}, addEventListener(){}, removeEventListener(){}};
    vm.runInNewContext(source,{window:win,MessageChannel,TextEncoder,setTimeout,clearTimeout});
    if (scenario === 'unexpected_ack') await command({type:'ack'});
    else {
      await command({type:'call',id:1,method:'sendMessageFromView',args:[]});
      if (scenario === 'awaiting_bytes') await command({type:'call',id:2,method:'sendMessageFromView',args:[]});
    }
    const last = emitted.at(-1);
    assert.equal(last.type, 'overflow');
    assert.equal(last.kind, scenario);
    assert.deepEqual(Object.keys(last).sort(), ['kind','type']);
    assert.equal(JSON.stringify(last).includes(payload), false);
  }
});

test('acknowledgements release the native view message budget', async () => {
  const source = await readFile(new URL('../src/native-view-shim.js', import.meta.url), 'utf8');
  let command;
  const emitted = [];
  const win = {__kanbanOwnedControl:{subscribe(fn) {command=fn;},emit(frame) {emitted.push(frame);}},
    electronBridge:{sendMessageFromView:async () => true},location:{origin:'app://-'},
    addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(source,{window:win,MessageChannel,TextEncoder,setTimeout,clearTimeout});
  for (let id=1; id<=70; id++) { await command({type:'call',id,method:'sendMessageFromView',args:[]}); await command({type:'ack'}); }
  assert.equal(emitted.filter(frame => frame.type === 'return').length,70);
  assert.equal(emitted.some(frame => frame.type === 'overflow'),false);
});

test('a disconnected client cancels a pending view before reporting it closed', async () => {
  const { createViewRegistry } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  const disposed = [];
  const registry = createViewRegistry({dispose: value => disposed.push(value)});
  let finishCreate;
  const work = registry.create('a', () => new Promise(resolve => { finishCreate = resolve; }));
  let destroyFinished = false;
  const destroy = registry.destroy('a').then(() => { destroyFinished = true; });
  await Promise.resolve();
  assert.equal(destroyFinished,false);
  finishCreate({id:'late-window'});
  assert.equal(await work, null);
  await destroy;
  assert.deepEqual(disposed,[{id:'late-window'}]);
  assert.equal(registry.has('a'),false);
});

test('cancelled pending creation does not leak a late failure to another client', async () => {
  const { createViewRegistry } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  const registry = createViewRegistry({dispose: () => {}});
  let rejectCreate;
  const work = registry.create('a', () => new Promise((_,reject) => { rejectCreate = reject; }));
  const destroy = registry.destroy('a');
  rejectCreate(Error('late creation failure'));
  assert.equal(await work, null);
  await destroy;
});

test('a failed pending-view cleanup is not acknowledged as closed', async () => {
  const { createViewRegistry } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  const registry = createViewRegistry({dispose: () => { throw Error('cleanup failed'); }});
  let finishCreate;
  const work = registry.create('a', () => new Promise(resolve => { finishCreate = resolve; }));
  const destroy = registry.destroy('a');
  finishCreate({id:'late-window'});
  await Promise.all([
    assert.rejects(work,/cleanup failed/),
    assert.rejects(destroy,/cleanup failed/),
  ]);
});

test('rejects debugger switches and inherited renderer or Node injection settings', () => {
  const { assertSafeLaunch } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  assert.doesNotThrow(() => assertSafeLaunch(['ChatGPT','--no-sandbox'],{}));
  for (const args of [['ChatGPT','--remote-debugging-port=9222'],['ChatGPT','--inspect=0.0.0.0:9229'],['ChatGPT','--disable-web-security']])
    assert.throws(() => assertSafeLaunch(args,{}));
  for (const env of [{NODE_OPTIONS:'--require x'}, {ELECTRON_RENDERER_URL:'http://example.test'}, {ELECTRON_RUN_AS_NODE:'1'}])
    assert.throws(() => assertSafeLaunch(['ChatGPT'],env));
});

test('recovery status distinguishes pending, live and destroying owned views without exposing identities', async () => {
  const { createViewRegistry } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  let finishCreate, finishDispose;
  const registry = createViewRegistry({ dispose: () => new Promise(resolve => { finishDispose = resolve; }) });
  assert.deepEqual(registry.recoveryStatus(), { live: 0, pending: 0, destroying: 0 });
  const create = registry.create('private-view', () => new Promise(resolve => { finishCreate = resolve; }));
  assert.deepEqual(registry.recoveryStatus(), { live: 0, pending: 1, destroying: 0 });
  finishCreate({ id: 'private' }); await create;
  assert.deepEqual(registry.recoveryStatus(), { live: 1, pending: 0, destroying: 0 });
  const destroy = registry.destroy('private-view');
  assert.deepEqual(registry.recoveryStatus(), { live: 1, pending: 0, destroying: 1 });
  finishDispose(); await destroy;
  assert.deepEqual(registry.recoveryStatus(), { live: 0, pending: 0, destroying: 0 });
  assert.ok(!JSON.stringify(registry.recoveryStatus()).includes('private'));
});

test('native recovery query is a fixed metadata-only message and refuses malformed input', () => {
  const { createViewRegistry, recoveryStatusFrame } = createRequire(import.meta.url)('../src/native-view-registry.cjs');
  const registry = createViewRegistry({ dispose: () => {} });
  const profileId = randomUUID(), generation = randomUUID(), nonce = randomUUID();
  const input = { message: { v: 1, type: 'recoveryStatus', nonce }, registry,
    profileId, generation, provisionalCount: 0, queuedIpcBytes: 0, ready: true };
  assert.deepEqual(recoveryStatusFrame(input), { v: 1, type: 'recoveryStatus', nonce, profileId, generation,
    views: { live: 0, pending: 0, destroying: 0 }, provisional: 0, pendingOutput: false, ready: true });
  assert.equal(recoveryStatusFrame({ ...input, queuedIpcBytes: 1 }).pendingOutput, true);
  assert.throws(() => recoveryStatusFrame({ ...input, message: { ...input.message, unexpected: true } }));
  assert.throws(() => recoveryStatusFrame({ ...input, message: { ...input.message, nonce: 'not-a-uuid' } }));
  assert.throws(() => recoveryStatusFrame({ ...input, provisionalCount: -1 }));
});

test('builds an owned isolated wrapper only from pinned Linux artifacts', {
  skip: !process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT && 'Set CHATGPT_DESKTOP_TEST_LINUX_ROOT to the explicit pinned Linux application root',
}, async t => {
  const f = await fixture(t);
  const sourceRoot = process.env.CHATGPT_DESKTOP_TEST_LINUX_ROOT;
  const sourceBinary = join(sourceRoot, 'ChatGPT');
  const sourceAsar = join(sourceRoot, 'resources', 'app.asar');
  const originalBinary = await lstat(sourceBinary);
  const beforeAsar = await digest(sourceAsar);
  const projectRoot = join(f.dir, 'project');
  await mkdir(projectRoot, {mode:0o700});
  const result = await preparePrivateRuntime({ ...f, sourceRoot, projectRoots:[projectRoot] });
  assert.equal(result.executable, join(f.runtimeRoot, 'ChatGPT'));
  assert.equal(result.home, join(f.runtimeRoot, 'home'));
  assert.equal(result.profileId, profileId);
  assert.equal(result.generation, generation);
  assert.equal((await lstat(result.home)).mode & 0o777, 0o700);
  assert.equal((await lstat(result.configPath)).mode & 0o777, 0o600);
  assert.notEqual((await lstat(result.executable)).ino, originalBinary.ino);
  assert.equal(await digest(result.executable), '45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b');
  assert.equal(await digest(sourceAsar), beforeAsar);
  assert.notEqual(await digest(join(f.runtimeRoot, 'resources', 'app.asar')), beforeAsar);
  const wrapper = await readFile(join(f.runtimeRoot, 'resources', 'app.asar'));
  const index = JSON.parse(wrapper.subarray(16, 16 + wrapper.readUInt32LE(12)).toString('utf8'));
  const start = 8 + wrapper.readUInt32LE(4);
  const member = name => {
    const entry = index.files[name];
    assert.ok(entry, `wrapper missing ${name}`);
    return wrapper.subarray(start + Number(entry.offset), start + Number(entry.offset) + entry.size).toString('utf8');
  };
  assert.equal(member('codex-surface-policy.cjs'), await readFile(new URL('../src/codex-surface-policy.cjs', import.meta.url), 'utf8'));
  assert.equal(member('project-consent-routing.cjs'), await readFile(new URL('../src/project-consent-routing.cjs', import.meta.url), 'utf8'));
  assert.equal(member('ssh-bootstrap-policy.cjs'), await readFile(new URL('../src/ssh-bootstrap-policy.cjs', import.meta.url), 'utf8'));
  assert.equal(member('native-host-policy.cjs'), await readFile(new URL('../src/native-host-policy.cjs', import.meta.url), 'utf8'));
  assert.equal(member('native-app-policy.cjs'), await readFile(new URL('../src/native-app-policy.cjs', import.meta.url), 'utf8'));
  assert.equal(member('dynamic-tools-routing.cjs'), await readFile(new URL('../src/dynamic-tools-routing.cjs', import.meta.url), 'utf8'));
  assert.equal(member('project-folder-picker-native.cjs'), await readFile(new URL('../src/project-folder-picker-native.cjs', import.meta.url), 'utf8'));
  assert.equal(member('project-folder-picker-policy.cjs'), await readFile(new URL('../src/project-folder-picker-policy.cjs', import.meta.url), 'utf8'));
  assert.equal(member('native-apphost-ports.cjs'), await readFile(new URL('../src/native-apphost-ports.cjs', import.meta.url), 'utf8'));
  const privatePreload = await readFile(join(f.runtimeRoot,'resources','private-preload.js'),'utf8');
  assert.match(privatePreload,/ipcRenderer\.postMessage\("kanban-owned:app-host-port"/);
  assert.doesNotThrow(() => new vm.Script(privatePreload));
  const marker = '\n;(()=>{const {contextBridge,ipcRenderer}=require("electron");';
  const preloadIndex = privatePreload.lastIndexOf(marker);
  assert.ok(preloadIndex >= 0);
  let receive; const posted = [], exposed = [];
  const isolatedWindow = {addEventListener(name,fn) {if (name === 'message') receive=fn;}};
  const electron = {contextBridge:{exposeInMainWorld:(name,api) => exposed.push([name,api])},
    ipcRenderer:{on(){},removeListener(){},send(){},postMessage:(...args) => posted.push(args)}};
  vm.runInNewContext(privatePreload.slice(preloadIndex),{window:isolatedWindow,require:() => electron});
  const port = {};
  receive({source:{},data:{type:'kanban-owned:app-host-port',id:1,portId:'app-host-1'},ports:[port]});
  assert.equal(posted.length,0);
  receive({source:isolatedWindow,data:{type:'kanban-owned:app-host-port',id:1,portId:'app-host-1'},ports:[port]});
  assert.equal(posted.length,1);
  assert.equal(posted[0][0],'kanban-owned:app-host-port');
  assert.equal(posted[0][1].id,1); assert.equal(posted[0][1].portId,'app-host-1');
  assert.equal(posted[0][2][0],port);
  assert.equal(exposed[0][0],'__kanbanOwnedControl');
  const bootstrap = member('native-bootstrap.cjs');
  assert.match(bootstrap, /assertCodexOnlyEnvironment\(process.env\)/);
  assert.match(bootstrap, /adaptNativeAppChunk\(\{body:bytes\}\)/);
  assert.match(bootstrap, /__kanbanBindAppServerManagers/);
  assert.match(bootstrap, /__kanbanSelectDynamicToolsWindow/);
  assert.match(bootstrap, /\["Lifecycle","lifecycle"\]/);
  assert.match(bootstrap, /"__kanbanProjectPicker"\+name/);
  assert.match(bootstrap, /projectPicker\.retire\(/);
  assert.match(bootstrap, /projectPicker\.dispose\(/);
  assert.match(bootstrap, /__kanbanBindProjects/);
  assert.match(bootstrap, /__kanbanSelectConsentWindow/);
  assert.ok(bootstrap.indexOf('assertCodexOnlyEnvironment(process.env)') < bootstrap.indexOf('require(entry)'));
  const config = JSON.parse(await readFile(result.configPath, 'utf8'));
  assert.equal(config.originalAsar, sourceAsar);
  assert.deepEqual(config.projectRoots, [projectRoot]);
  assert.equal(config.profileId, profileId);
  assert.equal(config.generation, generation);
});
