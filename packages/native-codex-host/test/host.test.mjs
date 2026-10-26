import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, readdir, writeFile, lstat, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import { validateOptions, validateDirectories, createSharedCodexHomeView, buildHostArgs, OwnedProcesses, assertPortAvailable, buildChildEnv, readPasswordFile, assertFreshOutput } from '../host.mjs';
import companion from '../companion/control.cjs';
const id = '019aabcd-1234-7890-abcd-0123456789ab';
function options(root = '/isolated') {
  return { unsafeNoAuth: true, runtimeRoot: root, codeServer: '/tool/code-server', officialVsix: '/tool/official.vsix', codexCli: '/tool/codex', port: 34567,
    userDataDir: join(root, 'user'), extensionsDir: join(root, 'extensions'), projectDir: join(root, 'project'), codexHome: join(root, 'codex'), processHome: join(root, 'home') };
}
test('strict options reject missing, malformed ports, nested or default directories', () => {
  assert.equal(validateOptions(options()).port, 34567);
  for (const port of ['34567;kill', 0, 1023, 65536, '12.3']) assert.throws(() => validateOptions({ ...options(), port }));
  for (const bindHost of ['localhost', '192.168.1.2', '0.0.0.0;evil']) assert.throws(() => validateOptions({ ...options(), bindHost }));
  assert.throws(() => validateOptions({ ...options(), codeServer: 'code-server' }));
  assert.throws(() => validateOptions({ ...options(), projectDir: '/tmp/project' }));
  assert.throws(() => validateOptions({ ...options(), codexHome: '/isolated/home/.codex' }));
  assert.throws(() => validateOptions({ ...options(), extensionsDir: '/isolated/user' }));
});
test('directory checks reject symlink escape before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-host-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'native-host-outside-'));
  try {
    await symlink(outside, join(root, 'codex'));
    await assert.rejects(validateDirectories(validateOptions(options(root))), /symlink|outside/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('shared Codex home reuses the exact conversation store while keeping host scratch private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-host-shared-'));
  const shared = join(root, 'real-codex-home');
  const runtime = join(root, 'runtime');
  try {
    await mkdir(shared, { mode: 0o700 });
    await writeFile(join(shared, 'history.marker'), 'existing history', { mode: 0o600 });
    const input = { ...options(runtime), sharedCodexHome: shared };
    const configured = validateOptions(input);
    await validateDirectories(configured);
    const view = await createSharedCodexHomeView(configured);
    const environment = buildChildEnv(configured, { PATH: '/usr/bin', CODEX_HOME: '/different/inherited' });
    assert.deepEqual(view, { enabled: true, storage: 'linked', ipcIsolated: true });
    assert.equal(configured.codexHome, join(runtime, 'codex'));
    assert.equal(environment.CODEX_HOME, configured.codexHome);
    assert.equal(environment.HOME, join(runtime, 'home'));
    assert.equal(environment.TMPDIR, join(runtime, 'tmp'));
    assert.deepEqual(await readdir(shared), ['history.marker']);
    assert.equal((await lstat(join(configured.codexHome, 'history.marker'))).isSymbolicLink(), true);
    assert.equal(await readlink(join(configured.codexHome, 'history.marker')), join(shared, 'history.marker'));
    assert.equal((await lstat(join(configured.codexHome, 'ipc'))).isSymbolicLink(), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('shared Codex home must be explicit, owned, non-symlinked and cannot be combined with a cloned home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-host-shared-guard-'));
  const shared = join(root, 'real-home');
  try {
    await mkdir(shared, { mode: 0o700 });
    const input = { ...options(join(root, 'runtime')), sharedCodexHome: shared };
    await assert.rejects(validateDirectories(validateOptions({ ...input, sharedCodexHome: join(root, 'missing') })), /shared Codex home/);
    assert.throws(() => validateOptions({ ...input, connectionProfileHome: join(root, 'connection') }), /mutually exclusive/);
    assert.throws(() => validateOptions({ ...input, sharedCodexHome: root }), /overlap private runtime directories/);
    const alias = join(root, 'alias');
    await symlink(shared, alias);
    await assert.rejects(validateDirectories(validateOptions({ ...input, sharedCodexHome: alias })), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('host arguments isolate settings and bind LAN, never shell interpolate', () => {
  const args = buildHostArgs(validateOptions(options()));
  assert.ok(args.includes('127.0.0.1:34567'));
  assert.ok(args.includes('/isolated/user'));
  assert.ok(args.includes('/isolated/extensions'));
  assert.ok(args.includes('/isolated/project'));
  assert.ok(args.includes('openai.chatgpt'));
  const lanArgs = buildHostArgs(validateOptions({ ...options(), bindHost: '0.0.0.0' }));
  assert.ok(lanArgs.includes('0.0.0.0:34567'));
});
test('a fresh refresh host delegates editor restoration to the owned visible-pane recovery while ordinary hosts keep platform defaults',async()=>{
  const {buildHostSettings}=await import('../host.mjs');
  const ordinary=validateOptions(options());
  const normal=buildHostSettings(ordinary);
  assert.equal(Object.hasOwn(normal,'workbench.editor.restoreEditors'),false);
  assert.equal(Object.hasOwn(normal,'chatgpt.cliExecutable'),false);
  const refresh=validateOptions({...options(),refreshServiceConfig:'/isolated/service.json',refreshDomain:id});
  const settings=buildHostSettings(refresh,{executable:'/isolated/refresh-client-cli.mjs'});
  assert.equal(settings['workbench.editor.restoreEditors'],false);
  assert.equal(settings['chatgpt.cliExecutable'],'/isolated/refresh-client-cli.mjs');
  assert.equal(settings['chatgpt.openOnStartup'],false);
  assert.equal(settings['workbench.startupEditor'],'none');
  assert.equal(Object.hasOwn(ordinary,'workbench.editor.restoreEditors'),false);
  assert.throws(()=>buildHostSettings(refresh),/verified refresh/);
  assert.throws(()=>buildHostSettings(ordinary,{executable:'/isolated/refresh-client-cli.mjs'}),/explicit refresh/);
  assert.throws(()=>buildHostSettings(refresh,{executable:'/isolated/unsafe\ncommand'}),/absolute path/);
});
test('visible-window startup is explicit, bound to controlled refresh, and mutually exclusive with automatic or fixture opening',async()=>{
  const {buildHostStartup}=await import('../host.mjs');
  const refresh={...options(),refreshServiceConfig:'/isolated/service.json',refreshControlRoot:'/isolated/control'};
  const startup=buildHostStartup(refresh,{restoreVisibleWindows:true});
  assert.equal(startup.panelMode,'visible-windows');
  assert.equal(startup.autoOpenNewChats,false);
  assert.equal(startup.autoOpenFixtures,false);
  assert.equal(startup.restoreVisibleWindows,true);
  assert.equal(startup.newChatWindowIds.length,1);
  assert.match(startup.newChatWindowIds[0],/^[0-9a-f-]{36}$/);
  for(const value of [options(),{...refresh,refreshControlRoot:undefined},{...refresh,refreshServiceConfig:undefined}])
    assert.throws(()=>buildHostStartup(value,{restoreVisibleWindows:true}),/controlled refresh/);
  for(const flags of [{autoOpenNewChats:true},{autoOpenFixtures:true},{createThreads:true}])
    assert.throws(()=>buildHostStartup(refresh,{...flags,restoreVisibleWindows:true}),/mutually exclusive/);
  assert.throws(()=>buildHostStartup({...refresh,threadsFile:'/isolated/threads.json'},{restoreVisibleWindows:true}),/mutually exclusive/);
  assert.throws(()=>buildHostStartup(refresh,{restoreVisibleWindows:'true'}),/boolean/);
  const automatic=buildHostStartup(options(),{autoOpenNewChats:true});
  assert.equal(automatic.autoOpenNewChats,true);assert.equal(automatic.panelMode,'new-chats');
  assert.equal(automatic.restoreVisibleWindows,false);
  assert.throws(()=>buildHostStartup(options(),{}),/explicit/);
});
test('occupied port rejects and does not terminate listener', async () => {
  const net = await import('node:net');
  const server = net.createServer(); await new Promise(r => server.listen(0, '0.0.0.0', r));
  try { await assert.rejects(assertPortAvailable(server.address().port), /occupied/); assert.ok(server.listening); }
  finally { await new Promise(r => server.close(r)); }
});
test('lifecycle cleanup signals only owned live child objects once', () => {
  const owned = new OwnedProcesses(); const live = new EventEmitter(); live.exitCode = null; live.signalCode = null;
  const signals = []; live.kill = signal => signals.push(signal);
  const exited = new EventEmitter(); exited.exitCode = 0; exited.kill = () => assert.fail('already exited');
  owned.add(live); owned.add(exited); owned.stop(); owned.stop(); assert.deepEqual(signals, ['SIGTERM']);
});
test('companion URI is explicit local UUID and allowlisted; reject remote/query/injection', () => {
  assert.equal(companion.threadUri(id, [id]), `openai-codex://route/local/${id}`);
  for (const bad of ['../x', `${id}?foo=bar`, `openai-codex://route/local/${id}`, id.toUpperCase(), '019aabcd-1234-7890-abcd-0123456789ac']) {
    assert.throws(() => companion.threadUri(bad, [id]));
  }
  for (const column of [0, -1, 4, '2']) assert.throws(() => companion.validateOpen({ threadId: id, column }, [id]));
  assert.throws(() => companion.validateOpen({ threadId: id, column: 1, command: 'anything' }, [id]));
});
test('companion opens captured validated thread with fixed original editor only', async () => {
  const calls = []; const vscode = { Uri: { parse: x => x }, commands: { executeCommand: async (...args) => calls.push(args) } };
  const input = { threadId: id, column: 2 };
  await companion.openThread(vscode, input, [id]);
  assert.deepEqual(calls, [['vscode.openWith', `openai-codex://route/local/${id}`, 'chatgpt.conversationEditor', { viewColumn: 2, preview: false, preserveFocus: false }]]);
});

test('child environment isolates modern and legacy IPC and omits inherited credentials', () => {
  const env = buildChildEnv(validateOptions(options()), { PATH: '/bin', HOME: '/real', TMPDIR: '/tmp', CODEX_HOME: '/real/.codex', NODE_OPTIONS: '--require=/tmp/untrusted.cjs', OPENAI_API_KEY: 'secret', PASSWORD: 'secret', CODEX_API_KEY: 'secret' });
  assert.equal(env.CODEX_HOME, '/isolated/codex'); assert.equal(env.HOME, '/isolated/home');
  assert.equal(env.TMPDIR, '/isolated/tmp'); assert.equal(env.TMP, env.TMPDIR); assert.equal(env.TEMP, env.TMPDIR);
  assert.equal(env.NODE_OPTIONS, `--require=${JSON.stringify(fileURLToPath(new URL('../companion/preload.cjs', import.meta.url)))}`);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.PASSWORD, undefined); assert.equal(env.CODEX_API_KEY, undefined);
});
test('child environment preserves an explicit Node proxy choice without enabling it by default', () => {
  const configured = validateOptions(options());
  for (const value of ['0', '1']) {
    const env = buildChildEnv(configured, { NODE_USE_ENV_PROXY: value, NODE_OPTIONS: '--require=/untrusted.cjs' });
    assert.equal(env.NODE_USE_ENV_PROXY, value);
    assert.ok(!env.NODE_OPTIONS.includes('/untrusted.cjs'));
  }
  for (const value of [undefined, '', 'true', '1 --require=/untrusted.cjs']) {
    assert.equal(buildChildEnv(configured, { NODE_USE_ENV_PROXY: value }).NODE_USE_ENV_PROXY, undefined);
  }
});
test('explicit proxy choice reaches the isolated child fetch through an owned loopback proxy', {
  skip: !process.allowedNodeEnvironmentFlags.has('--use-env-proxy'),
}, async () => {
  let proxyRequests = 0;
  const target = createHttpServer((_request, response) => response.end('owned-proxy-ok'));
  const proxy = createHttpServer((_request, response) => response.writeHead(400).end());
  const sockets = new Set();
  for (const server of [target, proxy]) server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  proxy.on('connect', (request, socket, head) => {
    if (request.url !== 'native-host-proxy.invalid:80') return socket.destroy();
    proxyRequests++;
    const upstream = connect(target.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
  });
  try {
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    const env = buildChildEnv(validateOptions(options()), {
      NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: 'localhost,127.0.0.1',
    });
    const expression = `fetch('http://native-host-proxy.invalid/', {signal: AbortSignal.timeout(3000)})
      .then(async response => process.stdout.write(await response.text()))
      .catch(() => { process.stderr.write('owned proxy fetch failed'); process.exitCode = 1; });`;
    const child = spawn(process.execPath, ['-e', expression], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(code, 0, error); assert.equal(output, 'owned-proxy-ok'); assert.equal(proxyRequests, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([target, proxy].map(server => new Promise(resolve => server.close(resolve))));
  }
});
test('child environment loads the provider hook only in extension-host Node processes', () => {
  const env = buildChildEnv(validateOptions(options()), { PATH: '/bin', NODE_OPTIONS: '--require=/tmp/untrusted.cjs' });
  const expression = `process.stdout.write(String(Boolean(process[Symbol.for('coding-kanban.native-codex.appserver-provider')])));`;
  const extensionHost = spawnSync(process.execPath, ['-e', expression, '--', '--type=extensionHost'], { encoding: 'utf8', env });
  const ordinaryNode = spawnSync(process.execPath, ['-e', expression], { encoding: 'utf8', env });
  assert.equal(extensionHost.status, 0, extensionHost.stderr);
  assert.equal(extensionHost.stdout, 'true');
  assert.equal(ordinaryNode.status, 0, ordinaryNode.stderr);
  assert.equal(ordinaryNode.stdout, 'false');
});
test('runtime root must be private before creating child directories', async () => {
  const { chmod } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'native-host-public-'));
  try { await chmod(root, 0o755); await assert.rejects(validateDirectories(validateOptions(options(root))), /private|0700/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test('primary and legacy native socket limits reject long runtime paths explicitly', () => {
  assert.throws(() => validateOptions(options(`/tmp/${'a'.repeat(95)}`)), /socket path too long/);
});
test('HTTPS startup passes only configured certificate and key as arguments', () => {
  const config = validateOptions({ ...options(), cert: '/isolated/test.crt', certKey: '/isolated/test.key' });
  const args = buildHostArgs(config);
  assert.equal(args[args.indexOf('--cert') + 1], config.cert);
  assert.equal(args[args.indexOf('--cert-key') + 1], config.certKey);
  assert.throws(() => validateOptions({ ...options(), cert: '/isolated/test.crt' }), /together/);
});
test('temporary IPC directory cannot overlap a configured application directory', () => {
  assert.throws(() => validateOptions({ ...options(), projectDir: '/isolated/tmp' }), /temporary|distinct/);
});
test('temporary directory symlink cannot route legacy native IPC outside the runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-tmp-link-')); const outside = await mkdtemp(join(tmpdir(), 'native-tmp-out-'));
  try { await symlink(outside, join(root, 'tmp')); await assert.rejects(validateDirectories(validateOptions(options(root))), /symlink|outside/); }
  finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('all pre-existing application and temporary directories must be owned and 0700', async () => {
  const { chmod, chown } = await import('node:fs/promises');
  for (const dir of ['user', 'extensions', 'project', 'codex', 'home', 'tmp']) {
    const root = await mkdtemp(join(tmpdir(), 'native-child-private-')); const child = join(root, dir);
    try {
      await mkdir(child, { mode: 0o755 }); await chmod(child, 0o755);
      await assert.rejects(validateDirectories(validateOptions(options(root))), /owned|private|0700/);
      await chmod(child, 0o700);
      if (process.getuid() === 0) { await chown(child, 65534, 65534); await assert.rejects(validateDirectories(validateOptions(options(root))), /owned|private/); }
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('host requires password protection by default and unsafe diagnostic mode is explicit', () => {
  assert.throws(() => validateOptions({ ...options(), unsafeNoAuth: false }), /password/);
  assert.throws(() => validateOptions({ ...options(), passwordFile: '/isolated/password' }), /mutually|both/);
  const protectedOptions = validateOptions({ ...options(), unsafeNoAuth: false, passwordFile: '/isolated/password' });
  const args = buildHostArgs(protectedOptions); assert.equal(args[args.indexOf('--auth') + 1], 'password');
});
test('password comes only from private owned file, never arguments or error contents', async () => {
  const { writeFile, chmod } = await import('node:fs/promises'); const root = await mkdtemp(join(tmpdir(), 'native-pass-')); const file = join(root, 'password');
  const secret = 'private-test-value-0123456789';
  try {
    await writeFile(file, secret + '\n', { mode: 0o600 }); assert.equal(await readPasswordFile(file), secret);
    await chmod(file, 0o644); await assert.rejects(readPasswordFile(file), /0600/);
    await chmod(file, 0o600); await writeFile(file, secret + '\nsecond-line'); await assert.rejects(readPasswordFile(file), error => !error.message.includes(secret));
    const link = join(root, 'link'); await symlink(file, link); await assert.rejects(readPasswordFile(link), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('fresh runtime validation rejects existing credentials, sockets or prepopulated child contents', async () => {
  const { writeFile } = await import('node:fs/promises'); const root = await mkdtemp(join(tmpdir(), 'native-fresh-'));
  try { await mkdir(join(root, 'codex'), { mode: 0o700 }); await writeFile(join(root, 'codex', 'auth.json'), '{}'); await assert.rejects(validateDirectories(validateOptions(options(root))), /fresh|empty/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('generated outputs reject pre-existing files and symlinks instead of overwriting', async () => {
  const { writeFile, readFile } = await import('node:fs/promises'); const root = await mkdtemp(join(tmpdir(), 'native-output-'));
  try {
    const existing = join(root, 'existing'); const link = join(root, 'linked'); await writeFile(existing, 'preserve'); await symlink(existing, link);
    await assert.rejects(assertFreshOutput(existing), /already exists/); await assert.rejects(assertFreshOutput(link), /symlink/);
    await assertFreshOutput(join(root, 'new')); assert.equal(await readFile(existing, 'utf8'), 'preserve');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('owned lifecycle cannot accept or start further work after stop', () => {
  const owned = new OwnedProcesses(); owned.stop(); assert.throws(() => owned.assertRunning(), /stopped/);
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; let killed = false; child.kill = () => { killed = true; };
  assert.throws(() => owned.add(child), /stopped/); assert.equal(killed, true);
});

test('short browser reconnection grace requires an explicit scoped persistent native service', () => {
  assert.throws(()=>validateOptions({...options(),reconnectionGraceSeconds:60}),/refresh service/);
  assert.throws(()=>validateOptions({...options(),refreshServiceConfig:'/private/bridge.json'}),/domain/);
  assert.throws(()=>validateOptions({...options(),refreshDomain:id}),/config/);
  for(const value of ['0','301','60;kill','1.5'])assert.throws(()=>validateOptions({...options(),refreshServiceConfig:'/private/bridge.json',refreshDomain:id,reconnectionGraceSeconds:value}),/grace/);
  const configured=validateOptions({...options(),refreshServiceConfig:'/private/bridge.json',refreshDomain:id,reconnectionGraceSeconds:'60'});
  const args=buildHostArgs(configured);assert.equal(args[args.indexOf('--reconnection-grace-time')+1],'60');
  assert.equal(buildHostArgs(validateOptions(options())).includes('--reconnection-grace-time'),false);
});
test('persistent bridge authorization control requires an explicit native service and absolute control root',()=>{
  assert.throws(()=>validateOptions({...options(),refreshControlRoot:'/private/control'}),/refresh service/);
  for(const root of ['relative','/private/control\n'])assert.throws(()=>validateOptions({...options(),refreshServiceConfig:'/private/bridge.json',refreshDomain:id,refreshControlRoot:root}),/refreshControlRoot/);
  const configured=validateOptions({...options(),refreshServiceConfig:'/private/bridge.json',refreshDomain:id,refreshControlRoot:'/private/control'});
  assert.equal(configured.refreshControlRoot,'/private/control');
});
