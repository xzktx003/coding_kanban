import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateOptions } from './host.mjs';

const launcherPath = fileURLToPath(new URL('./launcher.mjs', import.meta.url));
const directoryNames = {
  userDataDir: 'u', extensionsDir: 'e', projectDir: 'p', codexHome: 'c', processHome: 'h',
};
const configKeys = new Set([
  'codeServer', 'officialVsix', 'codexCli', 'port', 'brokerPort', 'runtimeBase', 'record',
  'unsafeNoAuth', 'passwordFile', 'sharedCodexHome', 'connectionProfileHome',
]);

function absolute(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value))
    throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}

async function rejectSymlinks(path) {
  let current = sep;
  for (const part of resolve(path).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('service paths must not contain a symlink');
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}

async function readPrivateFile(path, limit) {
  await rejectSymlinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o600)
      throw new Error('service input must be an owned regular 0600 file');
    if (info.size > limit) throw new Error('service input exceeds its size limit');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('service input exceeds its size limit');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

function launchOptions(config, runtimeRoot) {
  return validateOptions({
    ...config, runtimeRoot, bindHost: '127.0.0.1',
    ...Object.fromEntries(Object.entries(directoryNames).map(([key, name]) => [key, join(runtimeRoot, name)])),
    record: join(runtimeRoot, 'record.json'),
  });
}

function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('service config must be a JSON object');
  if (Object.keys(value).some(key => !configKeys.has(key))) throw new Error('unknown native Codex service config option');
  if ('unsafeNoAuth' in value && typeof value.unsafeNoAuth !== 'boolean') throw new Error('unsafeNoAuth must be an explicit boolean');
  if (value.brokerPort == null) throw new Error('service config requires an explicit brokerPort');
  if (value.sharedCodexHome && value.connectionProfileHome) throw new Error('shared Codex home and copied connection profile are mutually exclusive');
  const config = { ...value };
  for (const key of ['codeServer', 'officialVsix', 'codexCli', 'runtimeBase', 'record']) config[key] = absolute(value[key], key);
  // Reuse the launcher's authentication, port, IPC length and login-mode guards.
  // This prospective short name has the same length as mkdtemp's actual suffix.
  const options = launchOptions(config, join(config.runtimeBase, 'r-xxxxxx'));
  return { ...config, port: options.port, brokerPort: options.brokerPort };
}

/** Read only an explicitly selected private config; login reuse is never inferred. */
export async function readServiceConfig(file) {
  const bytes = await readPrivateFile(absolute(file, 'config'), 16 * 1024);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('service config must contain valid JSON'); }
  return validateConfig(value);
}

async function checkFixedRecord(path) {
  await rejectSymlinks(path);
  const parent = await lstat(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.()) throw new Error('record parent must be an owned directory');
  try { await readPrivateFile(path, 256 * 1024); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function publishRecord(path, bytes, assertRunning) {
  const temporary = join(dirname(path), `.native-record-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await checkFixedRecord(path);
    assertRunning();
    await rename(temporary, path);
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function cancelResponseBody(response, signal) {
  if (!response.body) return;
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    response.body.cancel().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Keep one launcher alive. The external service manager owns restart policy. */
export async function runNativeCodexService(input, {
  signal, launcher = launcherPath, env = process.env, stdio = 'inherit',
  startupTimeoutMs = 120_000, pollIntervalMs = 100, onReady,
} = {}) {
  if (signal?.aborted) return { code: 0, signal: null };
  const config = validateConfig(input);
  await checkFixedRecord(config.record);
  await rejectSymlinks(config.runtimeBase);
  await mkdir(config.runtimeBase, { mode: 0o700, recursive: true });
  const base = await lstat(config.runtimeBase);
  if (!base.isDirectory() || base.uid !== process.getuid?.() || (base.mode & 0o7777) !== 0o700)
    throw new Error('runtimeBase must be an owned private 0700 directory');
  if (signal?.aborted) return { code: 0, signal: null };
  const runtimeRoot = await mkdtemp(join(config.runtimeBase, 'r-'));
  const options = launchOptions(config, runtimeRoot);
  for (const name of Object.values(directoryNames)) await mkdir(join(runtimeRoot, name), { mode: 0o700 });
  if (signal?.aborted) return { code: 0, signal: null };
  const fields = {
    'runtime-root': runtimeRoot, 'code-server': options.codeServer, 'official-vsix': options.officialVsix,
    'codex-cli': options.codexCli, port: options.port, 'broker-port': options.brokerPort, 'bind-host': '127.0.0.1',
    'user-data-dir': options.userDataDir, 'extensions-dir': options.extensionsDir, 'project-dir': options.projectDir,
    'codex-home': options.codexHome, 'process-home': options.processHome, record: options.record,
    ...(options.passwordFile ? { 'password-file': options.passwordFile } : {}),
    ...(options.sharedCodexHome ? { 'shared-codex-home': options.sharedCodexHome } : {}),
    ...(options.connectionProfileHome ? { 'connection-profile-home': options.connectionProfileHome } : {}),
  };
  const args = [absolute(launcher, 'launcher'), ...Object.entries(fields).flatMap(([key, value]) => [`--${key}`, String(value)]),
    '--auto-open-new-chats', ...(options.unsafeNoAuth === true ? ['--unsafe-no-auth'] : [])];
  // The launcher supports env fallbacks. Do not let those add a login import,
  // certificate, refresh service, or another directory absent from this config.
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('NATIVE_CODEX_')));
  const child = spawn(process.execPath, args, { env: childEnv, stdio });
  let finished = null;
  const completion = new Promise(resolve => {
    child.once('error', error => { finished = { code: 1, signal: null, error }; resolve(finished); });
    child.once('exit', (code, exitSignal) => { finished = { code: code ?? 1, signal: exitSignal }; resolve(finished); });
  });
  let stopRequested = false;
  const stop = () => {
    if (stopRequested) return;
    stopRequested = true;
    if (!finished) child.kill(signal?.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
  };
  const assertRunning = () => {
    if (signal?.aborted || stopRequested) throw new Error('native Codex service stopped before readiness');
    if (finished) throw new Error('native Codex launcher exited before readiness');
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  try {
    const deadline = Date.now() + startupTimeoutMs;
    let published = false;
    while (!published) {
      if (signal?.aborted) return { ...(await completion), code: 0 };
      assertRunning();
      if (Date.now() >= deadline) throw new Error('native Codex host health readiness timed out');
      let bytes;
      try { bytes = await readPrivateFile(options.record, 256 * 1024); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (bytes) {
        let record;
        try { record = JSON.parse(bytes.toString('utf8')); }
        catch { throw new Error('launcher runtime record contains invalid JSON'); }
        if (record.runtimeRoot !== runtimeRoot || record.launcherPid !== child.pid || record.port !== config.port ||
            record.brokerPort !== config.brokerPort || record.protocol !== 'http')
          throw new Error('launcher runtime record does not match this service launch');
        let healthy = false;
        try {
          const probeSignal = AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now())));
          const requestSignal = signal ? AbortSignal.any([signal, probeSignal]) : probeSignal;
          const response = await fetch(`http://127.0.0.1:${config.port}/healthz`, {
            signal: requestSignal, redirect: 'error',
          });
          healthy = response.status === 200;
          await cancelResponseBody(response, requestSignal);
        } catch (error) {
          healthy = false;
          if (signal?.aborted) continue;
          if (error.name !== 'TypeError' && error.name !== 'TimeoutError' && error.name !== 'AbortError') throw error;
        }
        if (healthy) {
          assertRunning();
          await publishRecord(config.record, bytes, assertRunning);
          published = true;
        }
      }
      if (!published) await delay(pollIntervalMs, undefined, { signal }).catch(error => { if (!signal?.aborted) throw error; });
    }
    onReady?.({ runtimeRoot, record: config.record });
    const result = await completion;
    if (result.error) throw result.error;
    return signal?.aborted ? { ...result, code: 0 } : result;
  } finally {
    signal?.removeEventListener('abort', stop);
    stop();
    await completion;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const stopInt = () => abort.abort('SIGINT');
  const stopTerm = () => abort.abort('SIGTERM');
  process.on('SIGINT', stopInt); process.on('SIGTERM', stopTerm);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('usage: node service.mjs --config /absolute/private-service.json');
    const config = await readServiceConfig(process.argv[3]);
    const result = await runNativeCodexService(config, {
      signal: abort.signal, onReady: ({ record }) => console.log(JSON.stringify({ ready: true, record })),
    });
    process.exitCode = result.code;
  } catch (error) {
    if (!abort.signal.aborted) { console.error(error.message); process.exitCode = 1; }
  } finally {
    process.off('SIGINT', stopInt); process.off('SIGTERM', stopTerm);
  }
}
