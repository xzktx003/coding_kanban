import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { validateOptions, validateDirectories, buildHostArgs, OwnedProcesses, assertPortAvailable, buildChildEnv, readPasswordFile, assertFreshOutput } from '../host.mjs';
import companion from '../companion/control.cjs';
const id = '019aabcd-1234-7890-abcd-0123456789ab';
function options(root = '/isolated') {
  return { unsafeNoAuth: true, runtimeRoot: root, codeServer: '/tool/code-server', officialVsix: '/tool/official.vsix', codexCli: '/tool/codex', port: 34567,
    userDataDir: join(root, 'user'), extensionsDir: join(root, 'extensions'), projectDir: join(root, 'project'), codexHome: join(root, 'codex'), processHome: join(root, 'home') };
}
test('strict options reject missing, malformed ports, nested or default directories', () => {
  assert.equal(validateOptions(options()).port, 34567);
  for (const port of ['34567;kill', 0, 1023, 65536, '12.3']) assert.throws(() => validateOptions({ ...options(), port }));
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
test('host arguments isolate settings and bind LAN, never shell interpolate', () => {
  const args = buildHostArgs(validateOptions(options()));
  assert.ok(args.includes('0.0.0.0:34567'));
  assert.ok(args.includes('/isolated/user'));
  assert.ok(args.includes('/isolated/extensions'));
  assert.ok(args.includes('/isolated/project'));
  assert.ok(args.includes('openai.chatgpt'));
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
  const env = buildChildEnv(validateOptions(options()), { PATH: '/bin', HOME: '/real', TMPDIR: '/tmp', CODEX_HOME: '/real/.codex', OPENAI_API_KEY: 'secret', PASSWORD: 'secret', CODEX_API_KEY: 'secret' });
  assert.equal(env.CODEX_HOME, '/isolated/codex'); assert.equal(env.HOME, '/isolated/home');
  assert.equal(env.TMPDIR, '/isolated/tmp'); assert.equal(env.TMP, env.TMPDIR); assert.equal(env.TEMP, env.TMPDIR);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.PASSWORD, undefined); assert.equal(env.CODEX_API_KEY, undefined);
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
