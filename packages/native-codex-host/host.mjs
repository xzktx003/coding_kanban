import { lstat, realpath, mkdir, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep, join } from 'node:path';
import net from 'node:net';
const directoryKeys = ['userDataDir', 'extensionsDir', 'projectDir', 'codexHome', 'processHome'];
function absolute(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`${name} must be an absolute path`);
  return resolve(value);
}
function within(root, path) { const rel = relative(root, path); return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel); }
export function validateOptions(input) {
  const result = { ...input };
  for (const key of ['runtimeRoot', 'codeServer', 'officialVsix', 'codexCli', ...directoryKeys]) result[key] = absolute(input[key], key);
  if (!/^\d+$/.test(String(input.port)) || !Number.isInteger(Number(input.port)) || Number(input.port) < 1024 || Number(input.port) > 65535) throw new Error('port must be an integer between 1024 and 65535');
  result.port = Number(input.port);
  if (input.unsafeNoAuth === true && input.passwordFile) throw new Error('passwordFile and unsafeNoAuth are mutually exclusive');
  if (input.unsafeNoAuth !== true) result.passwordFile = absolute(input.passwordFile, 'passwordFile');
  for (const key of directoryKeys) if (!within(result.runtimeRoot, result[key])) throw new Error(`${key} must be inside runtimeRoot`);
  const dirs = [...directoryKeys.map(key => result[key]), join(result.runtimeRoot, 'tmp')];
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
  const paths = [options.runtimeRoot, ...directoryKeys.map(key => options[key]), join(options.runtimeRoot, 'tmp')];
  for (const path of paths) {
    await noSymlink(path);
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700) throw new Error('all runtime directories must be owned private 0700 directories');
      if (path !== options.runtimeRoot && (await readdir(path)).length !== 0) throw new Error('application and temporary directories must be fresh and empty');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(options.runtimeRoot, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(options.runtimeRoot);
  if (rootStat.uid !== process.getuid?.() || (rootStat.mode & 0o777) !== 0o700) throw new Error('runtimeRoot must be an owned private 0700 directory');
  const root = await realpath(options.runtimeRoot);
  for (const path of paths.slice(1)) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!within(root, await realpath(path))) throw new Error('application or temporary directory escaped runtimeRoot');
  }
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
  return ['--config', join(options.runtimeRoot, 'code-server.yaml'), '--bind-addr', `0.0.0.0:${options.port}`, '--auth', options.unsafeNoAuth === true ? 'none' : 'password',
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
  return { ...env, HOME: options.processHome, CODEX_HOME: options.codexHome, TMPDIR: join(options.runtimeRoot, 'tmp'), TMP: join(options.runtimeRoot, 'tmp'), TEMP: join(options.runtimeRoot, 'tmp'),
    XDG_CONFIG_HOME: join(options.processHome, '.config'), XDG_DATA_HOME: join(options.processHome, '.local', 'share'), XDG_CACHE_HOME: join(options.processHome, '.cache'),
    NATIVE_CODEX_COMPANION_CONFIG: join(options.runtimeRoot, 'companion-auth.json') };
}
