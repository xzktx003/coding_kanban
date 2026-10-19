import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, lstat, chmod, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { readServiceConfig, runNativeCodexService } from '../service.mjs';

async function unusedPort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}

async function fixture(mode = 'ready') {
  const base = await mkdtemp(join(tmpdir(), 'nc-svc-'));
  const runtimeBase = join(base, 'runs');
  await mkdir(runtimeBase, { mode: 0o700 });
  const port = await unusedPort();
  let brokerPort = await unusedPort();
  while (brokerPort === port) brokerPort = await unusedPort();
  const config = {
    codeServer: join(base, 'code-server'), officialVsix: join(base, 'official.vsix'),
    codexCli: join(base, 'codex'), port, brokerPort, runtimeBase,
    record: join(base, 'current.json'), unsafeNoAuth: true,
  };
  const configFile = join(base, 'service.json');
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const launcher = join(base, 'launcher.mjs');
  await writeFile(launcher, `
import http from 'node:http';
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const option = name => args[args.indexOf('--' + name) + 1];
const root = option('runtime-root');
writeFileSync(join(root, 'captured.json'), JSON.stringify({ args, inherited: Object.keys(process.env).filter(key => key.startsWith('NATIVE_CODEX_')) }), { mode: 0o600 });
if (${JSON.stringify(mode)} === 'fail') process.exit(7);
const server = http.createServer((request, response) => {
  if (${JSON.stringify(mode)} === 'blocked') return;
  const healthy = ${JSON.stringify(mode)} !== 'waiting' || existsSync(${JSON.stringify(join(base, 'healthy'))});
  response.writeHead(request.url === '/healthz' && healthy ? 200 : 503);
  response.end('health');
});
server.on('error', () => process.exit(8));
process.on('SIGTERM', () => {
  appendFileSync(join(root, 'signals'), 'SIGTERM\\n');
  server.closeAllConnections(); server.close(() => process.exit(0));
});
server.listen(Number(option('port')), '127.0.0.1', () => {
  writeFileSync(option('record'), JSON.stringify({
    runtimeRoot: ${JSON.stringify(mode)} === 'wrong-record' ? '/unrelated-runtime' : root, launcherPid: process.pid, hostPid: process.pid,
    port: Number(option('port')), brokerPort: Number(option('broker-port')), protocol: 'http',
    brokerAuthFile: join(root, 'companion-auth.json'),
  }), { mode: 0o600 });
});
`, { mode: 0o600 });
  return { base, config, configFile, launcher };
}

function start(data, extras = {}) {
  const controller = new AbortController();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const done = runNativeCodexService(data.config, {
    launcher: data.launcher, signal: controller.signal, stdio: 'ignore',
    startupTimeoutMs: 3000, pollIntervalMs: 10, onReady: resolveReady, ...extras,
  });
  // The caller may intentionally inspect files before awaiting a failed start.
  done.catch(() => {});
  return { controller, ready, done };
}

async function waitForRecord(runtimeBase) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    for (const name of await readdir(runtimeBase)) {
      const file = join(runtimeBase, name, 'record.json');
      try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('fake launcher did not write its runtime record');
}

test('service config requires an owned private regular JSON file and explicit authentication', async () => {
  const data = await fixture();
  try {
    assert.deepEqual(await readServiceConfig(data.configFile), data.config);
    await chmod(data.configFile, 0o644);
    await assert.rejects(readServiceConfig(data.configFile), /0600/);
    await chmod(data.configFile, 0o600);
    const alias = join(data.base, 'config-link.json');
    await symlink(data.configFile, alias);
    await assert.rejects(readServiceConfig(alias), /symlink|regular/);
    await writeFile(data.configFile, JSON.stringify({ ...data.config, unsafeNoAuth: 'true' }));
    await assert.rejects(readServiceConfig(data.configFile), /unsafeNoAuth/);
    const { unsafeNoAuth, ...withoutAuth } = data.config;
    await writeFile(data.configFile, JSON.stringify(withoutAuth));
    await assert.rejects(readServiceConfig(data.configFile), /passwordFile|authentication/);
    await writeFile(data.configFile, JSON.stringify({ ...data.config, sharedCodexHome: '/authorized/a', connectionProfileHome: '/authorized/b' }));
    await assert.rejects(readServiceConfig(data.configFile), /exclusive/);
    const { brokerPort, ...withoutBroker } = data.config;
    await writeFile(data.configFile, JSON.stringify(withoutBroker));
    await assert.rejects(readServiceConfig(data.configFile), /brokerPort/);
    await writeFile(data.configFile, ' '.repeat(16 * 1024 + 1));
    await assert.rejects(readServiceConfig(data.configFile), /size limit/);
    await writeFile(data.configFile, JSON.stringify(data.config));
    await chmod(data.configFile, 0o4600);
    await assert.rejects(readServiceConfig(data.configFile), /0600/);
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

test('service publishes only after its own fresh record and HTTP health are ready', async () => {
  const data = await fixture('waiting');
  const oldRecord = '{"previous":"preserved until ready"}';
  await writeFile(data.config.record, oldRecord, { mode: 0o600 });
  const running = start(data, { env: { ...process.env, NATIVE_CODEX_SHARED_CODEX_HOME: '/must/not/import', NATIVE_CODEX_CERT: '/must/not/use' } });
  try {
    const ownRecord = await waitForRecord(data.config.runtimeBase);
    assert.equal(await readFile(data.config.record, 'utf8'), oldRecord);
    await writeFile(join(data.base, 'healthy'), 'yes');
    const ready = await running.ready;
    const published = JSON.parse(await readFile(data.config.record, 'utf8'));
    assert.equal(published.runtimeRoot, ownRecord.runtimeRoot);
    assert.equal(ready.runtimeRoot, ownRecord.runtimeRoot);
    assert.equal((await lstat(data.config.record)).isSymbolicLink(), false);
    assert.equal((await lstat(data.config.record)).mode & 0o777, 0o600);
    assert.equal((await lstat(ownRecord.runtimeRoot)).mode & 0o777, 0o700);
    const captured = JSON.parse(await readFile(join(ownRecord.runtimeRoot, 'captured.json'), 'utf8'));
    assert.deepEqual(captured.inherited, []);
    assert.ok(captured.args.includes('--auto-open-new-chats'));
    assert.ok(captured.args.includes('--unsafe-no-auth'));
    assert.equal(captured.args[captured.args.indexOf('--bind-host') + 1], '127.0.0.1');
    assert.equal(captured.args.includes('--shared-codex-home'), false);
    assert.equal(captured.args.includes('--connection-profile-home'), false);
    for (const flag of ['user-data-dir', 'extensions-dir', 'project-dir', 'codex-home', 'process-home']) {
      const path = captured.args[captured.args.indexOf('--' + flag) + 1];
      assert.ok(path.startsWith(ownRecord.runtimeRoot + '/'));
      assert.equal((await lstat(path)).mode & 0o777, 0o700);
    }
    running.controller.abort();
    assert.equal((await running.done).code, 0);
    assert.equal(await readFile(join(ownRecord.runtimeRoot, 'signals'), 'utf8'), 'SIGTERM\n');
  } finally { running.controller.abort(); await running.done.catch(() => {}); await rm(data.base, { recursive: true, force: true }); }
});

test('each service restart uses a new runtime and leaves the previous runtime intact', async () => {
  const data = await fixture();
  const first = start(data);
  let second;
  try {
    const a = await first.ready;
    await writeFile(join(a.runtimeRoot, 'retain'), 'old diagnostics');
    first.controller.abort(); await first.done;
    second = start(data);
    const b = await second.ready;
    assert.notEqual(a.runtimeRoot, b.runtimeRoot);
    assert.equal(await readFile(join(a.runtimeRoot, 'retain'), 'utf8'), 'old diagnostics');
    assert.equal(JSON.parse(await readFile(data.config.record, 'utf8')).runtimeRoot, b.runtimeRoot);
  } finally {
    first.controller.abort(); second?.controller.abort();
    await Promise.all([first.done.catch(() => {}), second?.done.catch(() => {})]);
    await rm(data.base, { recursive: true, force: true });
  }
});

for (const mode of ['fail', 'waiting']) test(`failed ${mode} startup preserves the previous fixed record`, async () => {
  const data = await fixture(mode);
  const oldRecord = '{"previous":"not replaced"}';
  await writeFile(data.config.record, oldRecord, { mode: 0o600 });
  const running = start(data, { startupTimeoutMs: mode === 'waiting' ? 300 : 3000 });
  try {
    await assert.rejects(running.done, /exited|ready|health|timed out/);
    assert.equal(await readFile(data.config.record, 'utf8'), oldRecord);
    if (mode === 'waiting') {
      const own = await waitForRecord(data.config.runtimeBase);
      assert.equal(await readFile(join(own.runtimeRoot, 'signals'), 'utf8'), 'SIGTERM\n');
    }
  } finally { running.controller.abort(); await running.done.catch(() => {}); await rm(data.base, { recursive: true, force: true }); }
});

test('service refuses a symlink fixed record before launching or touching its target', async () => {
  const data = await fixture();
  const target = join(data.base, 'untouched');
  try {
    await writeFile(target, 'retain', { mode: 0o600 });
    await symlink(target, data.config.record);
    await assert.rejects(start(data).done, /symlink|regular/);
    assert.equal(await readFile(target, 'utf8'), 'retain');
    assert.deepEqual(await readdir(data.config.runtimeBase), []);
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

test('signal aborts a stalled health request, waits for its child, and preserves unrelated listeners', async () => {
  const data = await fixture('blocked');
  const unrelated = net.createServer(socket => socket.end());
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  const running = start(data, { pollIntervalMs: 10 });
  try {
    const own = await waitForRecord(data.config.runtimeBase);
    // Allow the probe to enter the fake host's request that never returns.
    await new Promise(resolve => setTimeout(resolve, 30));
    const stopped = Date.now();
    running.controller.abort(); running.controller.abort();
    assert.equal((await running.done).code, 0);
    assert.ok(Date.now() - stopped < 1000);
    assert.equal(await readFile(join(own.runtimeRoot, 'signals'), 'utf8'), 'SIGTERM\n');
    await assert.rejects(lstat(data.config.record), { code: 'ENOENT' });
    assert.equal(unrelated.listening, true);
    const connection = net.connect(unrelated.address().port, '127.0.0.1');
    await new Promise((resolve, reject) => { connection.once('connect', resolve); connection.once('error', reject); });
    connection.destroy();
  } finally {
    running.controller.abort(); await running.done.catch(() => {});
    await new Promise(resolve => unrelated.close(resolve));
    await rm(data.base, { recursive: true, force: true });
  }
});

test('a mismatched newly generated record cannot replace the previous fixed record', async () => {
  const data = await fixture('wrong-record');
  await writeFile(data.config.record, '{"previous":true}', { mode: 0o600 });
  const running = start(data);
  try {
    await assert.rejects(running.done, /does not match/);
    assert.equal(await readFile(data.config.record, 'utf8'), '{"previous":true}');
  } finally { running.controller.abort(); await running.done.catch(() => {}); await rm(data.base, { recursive: true, force: true }); }
});

test('aborting before preparation never spawns a launcher or publishes a record', async () => {
  const data = await fixture();
  const controller = new AbortController(); controller.abort();
  try {
    const result = await runNativeCodexService(data.config, { launcher: data.launcher, signal: controller.signal, stdio: 'ignore' });
    assert.equal(result.code, 0);
    assert.deepEqual(await readdir(data.config.runtimeBase), []);
    await assert.rejects(lstat(data.config.record), { code: 'ENOENT' });
  } finally { await rm(data.base, { recursive: true, force: true }); }
});

for (const mode of ['sharedCodexHome', 'connectionProfileHome']) test(`service forwards only the explicitly configured ${mode}`, async () => {
  const data = await fixture();
  data.config[mode] = join(data.base, 'explicit-authorized-home');
  const running = start(data);
  try {
    const ready = await running.ready;
    const { args } = JSON.parse(await readFile(join(ready.runtimeRoot, 'captured.json'), 'utf8'));
    const flag = mode === 'sharedCodexHome' ? '--shared-codex-home' : '--connection-profile-home';
    assert.equal(args[args.indexOf(flag) + 1], data.config[mode]);
  } finally { running.controller.abort(); await running.done.catch(() => {}); await rm(data.base, { recursive: true, force: true }); }
});
