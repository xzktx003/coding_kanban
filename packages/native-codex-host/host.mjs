import { lstat, realpath, mkdir, readdir, readFile, symlink } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const privateDirectoryKeys = ['userDataDir', 'extensionsDir', 'projectDir', 'codexHome', 'processHome'];
function absolute(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}
function within(root, path) { const rel = relative(root, path); return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); }
export function validateOptions(input) {
  const result = { ...input };
  const sharedCodexHome = input.sharedCodexHome != null;
  for (const key of ['runtimeRoot', 'codeServer', 'officialVsix', 'codexCli', ...privateDirectoryKeys]) result[key] = absolute(input[key], key);
  if (sharedCodexHome) {
    result.sharedCodexHome = absolute(input.sharedCodexHome, 'sharedCodexHome');
  }
  if (!/^\d+$/.test(String(input.port)) || !Number.isInteger(Number(input.port)) || Number(input.port) < 1024 || Number(input.port) > 65535) throw new Error('port must be an integer between 1024 and 65535');
  result.port = Number(input.port);
  result.bindHost = input.bindHost ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(result.bindHost)) throw new Error('bindHost must be 127.0.0.1 or 0.0.0.0');
  if (input.unsafeNoAuth === true && input.passwordFile) throw new Error('passwordFile and unsafeNoAuth are mutually exclusive');
  if (input.unsafeNoAuth !== true) result.passwordFile = absolute(input.passwordFile, 'passwordFile');
  for (const key of privateDirectoryKeys) if (!within(result.runtimeRoot, result[key])) throw new Error(key + ' must be inside runtimeRoot');
  const dirs = [...privateDirectoryKeys.map(key => result[key]), join(result.runtimeRoot, 'tmp')];
  if (sharedCodexHome) {
    for (const path of [result.runtimeRoot, ...privateDirectoryKeys.map(key => result[key]), join(result.runtimeRoot, 'tmp')]) {
      if (path === result.sharedCodexHome || within(path, result.sharedCodexHome) || within(result.sharedCodexHome, path)) throw new Error('shared Codex home must not overlap private runtime directories');
    }
  }
  if (sharedCodexHome && input.connectionProfileHome != null) throw new Error('shared Codex home and copied connection profile are mutually exclusive');
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    if (dirs[i] === dirs[j] || within(dirs[i], dirs[j]) || within(dirs[j], dirs[i])) throw new Error('private directories must be distinct and cannot contain each other');
  }
  if (Boolean(input.cert) !== Boolean(input.certKey)) throw new Error('cert and certKey must be provided together');
  if (input.cert) { result.cert = absolute(input.cert, 'cert'); result.certKey = absolute(input.certKey, 'certKey'); }
  for (const socket of [join(result.codexHome, 'ipc', 'ipc.sock'), join(result.runtimeRoot, 'tmp', 'codex-ipc', `ipc-${process.getuid?.() || 0}.sock`)]) {
    if (Buffer.byteLength(socket) > 103) throw new Error('private native IPC socket path too long; use a shorter runtimeRoot');
  }
  if (input.brokerPort != null) {
    if (!/^\d+$/.test(String(input.brokerPort)) || Number(input.brokerPort) < 1024 || Number(input.brokerPort) > 65535 || Number(input.brokerPort) === result.port) throw new Error('brokerPort must be a distinct integer port');
    result.brokerPort = Number(input.brokerPort);
  }
  if (input.connectionProfileHome != null) result.connectionProfileHome = absolute(input.connectionProfileHome, 'connectionProfileHome');
  return result;
}
async function noSymlink(path) {
  const parts = resolve(path).split(sep).filter(Boolean); let current = sep;
  for (const part of parts) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`symlink directory rejected: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
}
export async function validateDirectories(options) {
  const privatePaths = [options.runtimeRoot, ...privateDirectoryKeys.map(key => options[key]), join(options.runtimeRoot, 'tmp')];
  for (const path of privatePaths) {
    await noSymlink(path);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) throw new Error('all runtime directories must be owned private 0700 directories');
      if (path !== options.runtimeRoot && (await readdir(path)).length !== 0) throw new Error('application and temporary directories must be fresh and empty');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (options.sharedCodexHome) {
    await noSymlink(options.sharedCodexHome);
    let shared;
    try { shared = await lstat(options.sharedCodexHome); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('shared Codex home must already exist'); throw error; }
    if (!shared.isDirectory() || shared.uid !== process.getuid?.()) throw new Error('shared Codex home must be an existing directory owned by the current user');
  }
  await mkdir(options.runtimeRoot, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(options.runtimeRoot);
  if (rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o777) !== 0o700) throw new Error('runtimeRoot must be an owned private 0700 directory');
  const root = await realpath(options.runtimeRoot);
  for (const path of privatePaths.slice(1)) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!within(root, await realpath(path))) throw new Error('application or temporary directory escaped runtimeRoot');
  }
}
const PRIVATE_CODEX_HOME_ENTRIES = new Set(['ipc', 'app-server-control', 'app-server-daemon', 'tmp', '.tmp', 'log', 'cache']);
export async function createSharedCodexHomeView(options) {
  if (!options.sharedCodexHome) return { enabled: false };
  const source = options.sharedCodexHome;
  const target = options.codexHome;
  await noSymlink(source);
  await noSymlink(target);
  const sourceInfo = await lstat(source);
  const targetInfo = await lstat(target);
  if (!sourceInfo.isDirectory() || sourceInfo.uid !== process.getuid?.()) throw new Error('shared Codex home must be an existing directory owned by the current user');
  if (!targetInfo.isDirectory() || targetInfo.uid !== process.getuid?.() || (targetInfo.mode & 0o777) !== 0o700 || (await readdir(target)).length !== 0) throw new Error('private Codex home view must be a fresh owned 0700 directory');
  const entries = await readdir(source);
  if (entries.length > 4096) throw new Error('shared Codex home has too many entries');
  for (const name of entries) {
    if (PRIVATE_CODEX_HOME_ENTRIES.has(name)) continue;
    const sourcePath = join(source, name);
    const sourceEntry = await lstat(sourcePath);
    if (sourceEntry.isSymbolicLink() || (!sourceEntry.isFile() && !sourceEntry.isDirectory()) || sourceEntry.uid !== process.getuid?.()) throw new Error('shared Codex home contains an unsupported entry');
    await symlink(sourcePath, join(target, name), sourceEntry.isDirectory() ? 'dir' : 'file');
  }
  for (const name of PRIVATE_CODEX_HOME_ENTRIES) await mkdir(join(target, name), { mode: 0o700 });
  return { enabled: true, storage: 'linked', ipcIsolated: true };
}
export async function readPasswordFile(file) {
  absolute(file, 'passwordFile'); await noSymlink(file);
  const info = await lstat(file);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error('password file must be an owned private 0600 file');
  if (info.size > 1024) throw new Error('password file is too large');
  const value = (await readFile(file, 'utf8')).replace(/\r?\n$/, '');
  if (value.length < 16 || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('password must be one line between 16 and 256 characters');
  return value;
}
export async function assertFreshOutput(file) {
  absolute(file, 'generated output'); await noSymlink(file);
  try { await lstat(file); throw new Error('generated output already exists; use a fresh runtime and record path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function buildHostArgs(options) {
  return ['--config', join(options.runtimeRoot, 'code-server.yaml'), '--bind-addr', `${options.bindHost}:${options.port}`, '--auth', options.unsafeNoAuth === true ? 'none' : 'password',
    '--user-data-dir', options.userDataDir, '--extensions-dir', options.extensionsDir, '--disable-telemetry', '--disable-update-check',
    '--disable-proxy', '--disable-workspace-trust', '--enable-proposed-api', 'openai.chatgpt',
    ...(options.cert ? ['--cert', options.cert, '--cert-key', options.certKey] : []), options.projectDir];
}
export function assertPortAvailable(port) {
  return new Promise((resolvePromise, reject) => {
    const probe = net.createServer(); probe.once('error', () => reject(new Error(`port ${port} occupied or unavailable; no process was stopped`)));
    probe.listen(port, '0.0.0.0', () => probe.close(resolvePromise));
  });
}
export class OwnedProcesses {
  #children = new Set();
  #stopped = false;
  assertRunning() { if (this.#stopped) throw new Error('owned launcher stopped; refusing further work'); }
  add(child) { if (this.#stopped) { if (child.exitCode === null && child.signalCode == null) child.kill('SIGTERM'); throw new Error('owned launcher stopped; refusing new child'); } this.#children.add(child); child.once('exit', () => this.#children.delete(child)); return child; }
  stop() { this.#stopped = true; for (const child of this.#children) { if (child.exitCode === null && child.signalCode == null) child.kill('SIGTERM'); } this.#children.clear(); }
}
export function buildChildEnv(options, inherited = process.env) {
  const env = {};
  for (const key of ['PATH', 'SHELL', 'LANG', 'LC_ALL', 'TZ', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) if (inherited[key]) env[key] = inherited[key];
  const extensionHostPreload = fileURLToPath(new URL('./companion/preload.cjs', import.meta.url));
  return { ...env, ...options.connectionEnvironment, HOME: options.processHome, CODEX_HOME: options.codexHome, TMPDIR: join(options.runtimeRoot, 'tmp'), TMP: join(options.runtimeRoot, 'tmp'), TEMP: join(options.runtimeRoot, 'tmp'),
    XDG_CONFIG_HOME: join(options.processHome, '.config'), XDG_DATA_HOME: join(options.processHome, '.local', 'share'), XDG_CACHE_HOME: join(options.processHome, '.cache'),
    NODE_OPTIONS: `--require=${JSON.stringify(extensionHostPreload)}`,
    NATIVE_CODEX_COMPANION_CONFIG: join(options.runtimeRoot, 'companion-auth.json') };
}
