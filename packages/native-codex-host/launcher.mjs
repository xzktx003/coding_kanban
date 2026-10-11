import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open, stat, chmod } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { validateOptions, validateDirectories, buildHostArgs, buildChildEnv, assertPortAvailable, OwnedProcesses, readPasswordFile, assertFreshOutput } from './host.mjs';
import { createFixtureThreads } from './fixtures.mjs';
import { buildCompanionVsix } from './vsix.mjs';
const args = process.argv.slice(2); const input = {};
const fields = { 'runtime-root': 'runtimeRoot', 'code-server': 'codeServer', 'official-vsix': 'officialVsix', 'codex-cli': 'codexCli', port: 'port', 'broker-port': 'brokerPort', 'user-data-dir': 'userDataDir', 'extensions-dir': 'extensionsDir', 'project-dir': 'projectDir', 'codex-home': 'codexHome', 'process-home': 'processHome', cert: 'cert', 'cert-key': 'certKey', record: 'record', 'threads-file': 'threadsFile', 'password-file': 'passwordFile' };
let createThreads = false; let autoOpenFixtures = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--create-threads') { createThreads = true; continue; }
  if (args[i] === '--auto-open-fixtures') { autoOpenFixtures = true; continue; }
  if (args[i] === '--unsafe-no-auth') { input.unsafeNoAuth = true; continue; }
  const field = fields[args[i].replace(/^--/, '')];
  if (!args[i].startsWith('--') || !field || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('unknown or missing launcher argument');
  input[field] = args[++i];
}
for (const [key, field] of Object.entries(fields)) input[field] ??= process.env[`NATIVE_CODEX_${key.toUpperCase().replaceAll('-', '_')}`];
const options = validateOptions(input);
if (!options.brokerPort) throw new Error('explicit broker-port required');
if (!options.record || !isAbsolute(options.record)) throw new Error('explicit absolute ignored record path required');
const owned = new OwnedProcesses(); let stopping = false;
const stop = () => { if (!stopping) { stopping = true; owned.stop(); } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
async function run(command, argv, logPath) {
  owned.assertRunning();
  const log = await open(logPath, 'a', 0o600);
  try {
    owned.assertRunning();
    const child = owned.add(spawn(command, argv, { env: buildChildEnv(options), cwd: options.projectDir, stdio: ['ignore', log.fd, log.fd] }));
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('isolated extension install failed; see install.log'))); });
    owned.assertRunning();
  } finally { await log.close(); }
}
try {
  owned.assertRunning();
  const password = options.unsafeNoAuth === true ? null : await readPasswordFile(options.passwordFile);
  await assertPortAvailable(options.port); await assertPortAvailable(options.brokerPort);
  for (const name of ['code-server.yaml', 'companion-auth.json', 'threads.json', 'native-codex-companion.vsix', 'install.log', 'host.log', 'fixture-app-server.log', 'companion-ready.json']) await assertFreshOutput(join(options.runtimeRoot, name));
  await assertFreshOutput(options.record);
  await validateDirectories(options);
  owned.assertRunning();
  for (const file of [options.codeServer, options.codexCli, options.officialVsix, ...(options.cert ? [options.cert, options.certKey] : [])]) if (!(await stat(file)).isFile()) throw new Error('configured tool or input must be a file');
  await mkdir(join(options.runtimeRoot, 'tmp'), { mode: 0o700, recursive: true });
  owned.assertRunning();
  await writeFile(join(options.runtimeRoot, 'code-server.yaml'), `auth: ${password === null ? 'none' : 'password'}\n${password === null ? '' : `password: ${JSON.stringify(password)}\n`}disable-telemetry: true\ndisable-update-check: true\n`, { mode: 0o600, flag: 'wx' });
  const fixture = createThreads ? await createFixtureThreads(options, owned) : { threads: JSON.parse(await readFile(options.threadsFile, 'utf8')).threads };
  owned.assertRunning();
  const threads = fixture.threads.map(thread => typeof thread === 'string' ? thread : thread.id);
  const { default: control } = await import('./companion/control.cjs');
  for (const id of threads) control.threadUri(id, threads);
  if (autoOpenFixtures) control.validateFixturePanels(threads.slice(0, 2));
  const authFile = join(options.runtimeRoot, 'companion-auth.json');
  owned.assertRunning();
  await writeFile(authFile, JSON.stringify({ port: options.brokerPort, token: randomBytes(32).toString('hex'), threads, autoOpenFixtures }), { mode: 0o600, flag: 'wx' }); await chmod(authFile, 0o600);
  await writeFile(join(options.runtimeRoot, 'threads.json'), JSON.stringify(fixture, null, 2), { mode: 0o600, flag: 'wx' });
  const installArgs = ['--config', join(options.runtimeRoot, 'code-server.yaml'), '--user-data-dir', options.userDataDir, '--extensions-dir', options.extensionsDir,
    '--install-extension', options.officialVsix, '--force'];
  await run(options.codeServer, installArgs, join(options.runtimeRoot, 'install.log'));
  // Install our own VSIX separately so code-server registers it in its extension index.
  const companionVsix = join(options.runtimeRoot, 'native-codex-companion.vsix');
  const companionBytes = await buildCompanionVsix(); owned.assertRunning();
  await writeFile(companionVsix, companionBytes, { mode: 0o600, flag: 'wx' });
  const companionArgs = [...installArgs]; companionArgs[companionArgs.indexOf('--install-extension') + 1] = companionVsix;
  await run(options.codeServer, companionArgs, join(options.runtimeRoot, 'install.log'));
  await mkdir(join(options.userDataDir, 'User'), { recursive: true });
  await writeFile(join(options.userDataDir, 'User', 'settings.json'), JSON.stringify({ 'chatgpt.openOnStartup': false, 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none' }, null, 2), { mode: 0o600 });
  const hostLog = await open(join(options.runtimeRoot, 'host.log'), 'a', 0o600);
  owned.assertRunning();
  const child = owned.add(spawn(options.codeServer, buildHostArgs(options), { env: buildChildEnv(options), cwd: options.projectDir, stdio: ['ignore', hostLog.fd, hostLog.fd] }));
  const hostCompletion = new Promise(resolve => child.once('exit', code => { process.exitCode = stopping ? 0 : (code ?? 1); resolve(); }));
  child.once('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
  const lanAddresses = Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal).map(item => item.address);
  const record = { startedAt: new Date().toISOString(), launcherPid: process.pid, hostPid: child.pid, port: options.port, brokerPort: options.brokerPort,
    protocol: options.cert ? 'https' : 'http', authentication: password === null ? 'none' : 'password', lanUrls: lanAddresses.map(address => `${options.cert ? 'https' : 'http'}://${address}:${options.port}`),
    runtimeRoot: options.runtimeRoot, userDataDir: options.userDataDir, extensionsDir: options.extensionsDir, projectDir: options.projectDir,
    codexHome: options.codexHome, processHome: options.processHome, tempDir: join(options.runtimeRoot, 'tmp'), ipcSocket: join(options.codexHome, 'ipc', 'ipc.sock'),
    brokerAuthFile: authFile, threads: fixture.threads, fixtureAppServerPid: fixture.appServerPid, fixtureAppServerStopped: createThreads,
    officialVsix: options.officialVsix, officialVsixSha256: createHash('sha256').update(await readFile(options.officialVsix)).digest('hex') };
  await mkdir(dirname(options.record), { recursive: true });
  owned.assertRunning();
  await writeFile(options.record, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ hostPid: child.pid, port: options.port, brokerPort: options.brokerPort, lanUrls: record.lanUrls, record: options.record }));
  await hostCompletion;
  await hostLog.close();
} catch (error) { const wasStopping = stopping; stop(); console.error(error.message); process.exitCode = wasStopping ? 0 : 1; }
