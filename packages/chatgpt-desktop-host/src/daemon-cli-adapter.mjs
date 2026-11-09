/**
 * Research-only attach-only transport for an explicitly registered, owned Linux
 * app-server. This module is not connected to the product startup path.
 *
 * The caller is a trusted server-side launcher. This module never takes a socket,
 * command, account or environment from HTTP or from the CLI's command line.
 * Its private launcher derives its 0600 configuration from its own directory.
 * Desktop startup overrides are deliberately rejected until their semantics can
 * be proved for both new and existing threads.
 * After initialize this transport forwards RPC without authorizing its methods;
 * in particular config/plugin/account writes, thread/resume, remote and cloud
 * requests are not blocked. It must not be connected to a shared daemon until
 * a separate intent-, domain- and method-aware authorization gate is in place.
 */
import { constants, createReadStream } from 'node:fs';
import { lstat, open, readFile, readlink, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseJsonLines, MAX_JSON_LINE_BYTES } from './json-lines.mjs';

const execute = promisify(execFile);
const CLI_SHA256 = '6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const CLI_VERSION_LINE = 'codex-cli 0.166.0-alpha.5.1';
const CONFIG_NAME = 'daemon-cli-adapter.json';
const LAUNCHER_NAME = 'daemon-cli-adapter';
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_QUEUE_BYTES = MAX_JSON_LINE_BYTES + 1;
const CONNECT_TIMEOUT_MS = 10_000;
const INITIALIZE_TIMEOUT_MS = 15_000;
const SUPPORTED_FEATURE = 'features.code_mode_host=true';
const SUPPORTED_APP_TOOLS = /^plugins\.codex-app-tools@openai-bundled\.mcp_servers\.codex_app\.enabled=(?:true|false)$/;
const SUPPORTED_DAEMON_VERSIONS = new Set(['0.166.0-alpha.5.1', '0.166.0']);

function problem(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function requireCondition(value, code = 'DAEMON_ADAPTER_IDENTITY_CHANGED') {
  if (!value) throw problem(code);
}
function absolutePath(value) {
  return typeof value === 'string' && value.length > 1 && value.length <= 4096 &&
    isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value) && resolve(value) === value;
}
function getUid() {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') throw problem('DAEMON_ADAPTER_UNSUPPORTED_PLATFORM');
  return process.getuid();
}
function mode(value) { return Number(value.mode) & 0o7777; }
function sameStat(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function fingerprint(s, includeTimestamps = false) {
  const result = { dev:String(s.dev), ino:String(s.ino), uid:Number(s.uid), mode:mode(s) };
  if (includeTimestamps) Object.assign(result, { size:String(s.size), mtimeNs:String(s.mtimeNs), ctimeNs:String(s.ctimeNs) });
  return result;
}
function equals(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function requireOwnerFile(s, uid, { executable = false, privateFile = false } = {}) {
  requireCondition(s.isFile() && (Number(s.uid) === uid || (!privateFile && Number(s.uid) === 0)));
  requireCondition((mode(s) & 0o022) === 0 && (!privateFile || (Number(s.uid) === uid && mode(s) === 0o600)));
  if (executable) requireCondition((mode(s) & 0o111) !== 0);
}
async function directoryIdentity(path, uid, strict = false) {
  const s = await lstat(path, { bigint:true });
  requireCondition(s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === uid);
  requireCondition(strict ? (mode(s) & 0o077) === 0 : (mode(s) & 0o022) === 0);
  requireCondition(await realpath(path) === path);
  return fingerprint(s);
}
async function secureFile(path, uid, { privateFile = false, executable = false, maxBytes = 512 * 1024 * 1024 } = {}) {
  requireCondition(absolutePath(path));
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await descriptor.stat({ bigint:true });
    requireOwnerFile(before, uid, { executable, privateFile });
    requireCondition(before.size <= BigInt(maxBytes));
    const link = await lstat(path, { bigint:true });
    requireCondition(!link.isSymbolicLink() && sameStat(before, link) && await realpath(path) === path);
    return { descriptor, before };
  } catch (error) {
    await descriptor.close();
    throw error;
  }
}
async function shaFile(path, uid, options = {}) {
  const { descriptor, before } = await secureFile(path, uid, options);
  try {
    const hash = createHash('sha256');
    for await (const part of createReadStream(path, { fd:descriptor.fd, autoClose:false })) hash.update(part);
    const after = await descriptor.stat({ bigint:true });
    const link = await lstat(path, { bigint:true });
    requireCondition(sameStat(before, after) && sameStat(before, link));
    return { sha256:hash.digest('hex'), identity:fingerprint(after, true) };
  } finally { await descriptor.close(); }
}
async function privateConfig(path, uid) {
  const { descriptor, before } = await secureFile(path, uid, { privateFile:true, maxBytes:MAX_CONFIG_BYTES });
  try {
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat({ bigint:true });
    const link = await lstat(path, { bigint:true });
    requireCondition(sameStat(before, after) && sameStat(before, link) && bytes.length <= MAX_CONFIG_BYTES);
    return { bytes, identity:fingerprint(after, true), sha256:createHash('sha256').update(bytes).digest('hex') };
  } finally { await descriptor.close(); }
}

/** Only the known desktop invocations are allowed. Desktop config overrides are not silently lost. */
export function classifyDaemonCliArguments(args) {
  if (!Array.isArray(args) || args.some((x) => typeof x !== 'string')) throw problem('DAEMON_ADAPTER_UNSUPPORTED_ARGUMENTS');
  if (args.length === 1 && args[0] === '--version') return { kind:'version' };
  if (args.length === 2 && args[0] === 'app-server' && args[1] === '--analytics-default-enabled') return { kind:'app-server' };
  if (args.length === 6 && args[0] === '-c' && args[1] === SUPPORTED_FEATURE && args[2] === 'app-server' &&
      args[3] === '--analytics-default-enabled' && args[4] === '-c' && SUPPORTED_APP_TOOLS.test(args[5])) {
    throw problem('DAEMON_ADAPTER_UNSUPPORTED_OVERRIDES', 'Desktop CLI overrides are not yet equivalent on the shared daemon');
  }
  throw problem('DAEMON_ADAPTER_UNSUPPORTED_ARGUMENTS');
}

/** The version is derived only from the daemon initialize response. */
export function parseDaemonInitializeVersion(result) {
  if (!result || typeof result !== 'object' || typeof result.userAgent !== 'string') return undefined;
  return /^[A-Za-z][A-Za-z0-9 _.-]{0,127}\/([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(result.userAgent)?.[1];
}

/** An exact allowlist, separate from the pinned desktop CLI executable version. */
export function isSupportedDaemonVersion(version) {
  return typeof version === 'string' && SUPPORTED_DAEMON_VERSIONS.has(version);
}

async function processIdentity(pid, expectedTicks, uid, expectedExeSha, initial = false) {
  requireCondition(Number.isSafeInteger(pid) && pid > 1 && typeof expectedTicks === 'string' && /^\d+$/.test(expectedTicks));
  const proc = `/proc/${pid}`;
  const beforeText = await readFile(`${proc}/stat`, 'utf8');
  const end = beforeText.lastIndexOf(')');
  requireCondition(end > 0);
  const before = beforeText.slice(end + 2).split(' ');
  requireCondition(before[0] !== 'Z' && before[19] === expectedTicks);
  const status = await readFile(`${proc}/status`, 'utf8');
  requireCondition(Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === uid);
  const exe = await readlink(`${proc}/exe`);
  requireCondition(absolutePath(exe) && !exe.endsWith(' (deleted)'));
  const executable = await stat(`${proc}/exe`, { bigint:true });
  requireOwnerFile(executable, uid, { executable:true });
  const args = await readFile(`${proc}/cmdline`);
  requireCondition(args.length > 0 && args.length < 128 * 1024);
  const argv = args.toString('utf8').split('\0').filter(Boolean);
  requireCondition(argv.includes('app-server'));
  if (initial) {
    const hash = createHash('sha256');
    for await (const part of createReadStream(`${proc}/exe`)) hash.update(part);
    requireCondition(hash.digest('hex') === expectedExeSha);
  }
  const afterText = await readFile(`${proc}/stat`, 'utf8');
  const after = afterText.slice(afterText.lastIndexOf(')') + 2).split(' ');
  const executableAfter = await stat(`${proc}/exe`, { bigint:true });
  requireCondition(after[0] !== 'Z' && after[19] === expectedTicks && sameStat(executable, executableAfter));
  return { pid, startTicks:expectedTicks, exe, executable:fingerprint(executableAfter, true), argvSha256:createHash('sha256').update(args).digest('hex') };
}

async function listenerInode(socketPaths, pid) {
  // /proc/net/unix exposes the listening kernel socket inode, which differs from
  // the on-disk inode. Require a unique pathname listener owned by this PID.
  const table = await readFile('/proc/net/unix', 'utf8');
  const matches = [];
  for (const line of table.split('\n').slice(1)) {
    const fields = /^\s*[0-9a-f]+:\s+[0-9a-f]+\s+[0-9a-f]+\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(\d+)\s+(.+)$/i.exec(line);
    if (!fields || !socketPaths.includes(fields[5])) continue;
    if ((parseInt(fields[1], 16) & 0x10000) !== 0 && fields[2] === '0001' && fields[3] === '01') matches.push(fields[4]);
  }
  const unique = [...new Set(matches)];
  requireCondition(unique.length === 1);
  const fdDir = `/proc/${pid}/fd`;
  const names = await readdir(fdDir);
  let found = false;
  for (const name of names) {
    try { if (await readlink(`${fdDir}/${name}`) === `socket:[${unique[0]}]`) found = true; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  requireCondition(found);
  return unique[0];
}
async function socketIdentity(path, pid, uid) {
  requireCondition(absolutePath(path));
  const link = await lstat(path, { bigint:true });
  requireCondition((link.isSocket() || link.isSymbolicLink()) && Number(link.uid) === uid);
  const resolved = await realpath(path);
  requireCondition(absolutePath(resolved));
  const target = await stat(resolved, { bigint:true });
  requireCondition(target.isSocket() && Number(target.uid) === uid && (mode(target) & 0o077) === 0);
  const aliasParent = await directoryIdentity(dirname(path), uid);
  const realParent = await directoryIdentity(dirname(resolved), uid);
  const inode = await listenerInode([...new Set([path, resolved])], pid);
  const linkAfter = await lstat(path, { bigint:true });
  const targetAfter = await stat(resolved, { bigint:true });
  requireCondition(sameStat(link, linkAfter) && sameStat(target, targetAfter) && await realpath(path) === resolved);
  return { path, resolved, link:fingerprint(linkAfter, true), target:fingerprint(targetAfter, true), aliasParent, realParent, listenerInode:inode };
}
async function verifyCli(path, uid, home) {
  const actual = await shaFile(path, uid, { executable:true });
  requireCondition(actual.sha256 === CLI_SHA256, 'DAEMON_ADAPTER_CLI_MISMATCH');
  const result = await execute(path, ['--version'], {
    env:{ HOME:home, PATH:'/usr/bin:/bin', LANG:'C', LC_ALL:'C' },
    timeout:5_000, maxBuffer:4096, encoding:'utf8', windowsHide:true,
  });
  requireCondition(result.stdout === CLI_VERSION_LINE + '\n' && result.stderr.length === 0, 'DAEMON_ADAPTER_CLI_MISMATCH');
  const again = await shaFile(path, uid, { executable:true });
  requireCondition(equals(actual, again), 'DAEMON_ADAPTER_CLI_MISMATCH');
  return actual;
}
function assertConfigShape(config) {
  requireCondition(config && typeof config === 'object' && !Array.isArray(config) && config.format === 1);
  requireCondition(absolutePath(config.adapterDir) && absolutePath(config.cliPath) && absolutePath(config.socketPath) && absolutePath(config.codexHome));
  requireCondition(isSupportedDaemonVersion(config.daemonVersion), 'DAEMON_ADAPTER_UNSUPPORTED_DAEMON_VERSION');
  requireCondition(typeof config.daemonExeSha256 === 'string' && /^[a-f0-9]{64}$/.test(config.daemonExeSha256));
  requireCondition(config.process && config.socket && config.cli && config.codexHomeIdentity && config.adapterDirIdentity);
}

/**
 * Create one profile's launcher and immutable 0600 config in an already-owned,
 * empty private directory. Inputs must originate exclusively in trusted server
 * registration. daemonPid/startTicks/executable hash must be independently
 * captured by that server; this function does not discover or start a daemon.
 */
export async function prepareDaemonCliAdapter({ adapterDir, cliPath, socketPath, daemonPid, daemonStartTicks, daemonExeSha256, daemonVersion, codexHome }) {
  const uid = getUid();
  requireCondition([adapterDir, cliPath, socketPath, codexHome].every(absolutePath), 'DAEMON_ADAPTER_INVALID_CONFIG');
  requireCondition(typeof daemonExeSha256 === 'string' && /^[a-f0-9]{64}$/.test(daemonExeSha256), 'DAEMON_ADAPTER_INVALID_CONFIG');
  requireCondition(isSupportedDaemonVersion(daemonVersion), 'DAEMON_ADAPTER_UNSUPPORTED_DAEMON_VERSION');
  const adapterDirIdentity = await directoryIdentity(adapterDir, uid, true);
  const codexHomeIdentity = await directoryIdentity(codexHome, uid, true);
  const processRecord = await processIdentity(daemonPid, daemonStartTicks, uid, daemonExeSha256, true);
  const socket = await socketIdentity(socketPath, daemonPid, uid);
  const cli = await verifyCli(cliPath, uid, adapterDir);
  requireCondition(equals(processRecord, await processIdentity(daemonPid, daemonStartTicks, uid, daemonExeSha256)));
  requireCondition(equals(socket, await socketIdentity(socketPath, daemonPid, uid)));
  const nodePath = await realpath(process.execPath);
  requireCondition(absolutePath(nodePath) && !/\s/.test(nodePath) && Buffer.byteLength(nodePath) <= 120);
  const nodeInfo = await stat(nodePath, { bigint:true });
  requireOwnerFile(nodeInfo, uid, { executable:true });
  const config = { format:1, adapterDir, cliPath, socketPath, codexHome, daemonVersion, daemonExeSha256,
    process:processRecord, socket, cli, codexHomeIdentity, adapterDirIdentity };
  const configPath = join(adapterDir, CONFIG_NAME);
  const executable = join(adapterDir, LAUNCHER_NAME);
  const moduleUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const launcher = `#!${nodePath}\nimport { runDaemonCliAdapter } from ${JSON.stringify(moduleUrl)};\n` +
    `try { await runDaemonCliAdapter(new URL(${JSON.stringify('./' + CONFIG_NAME)}, import.meta.url), process.argv.slice(2)); } ` +
    `catch (error) { process.stderr.write((typeof error?.code === 'string' && error.code.startsWith('DAEMON_ADAPTER_') ? error.code : 'DAEMON_ADAPTER_FAILED') + '\\n'); process.exitCode = 1; }\n`;
  await writeFile(configPath, JSON.stringify(config) + '\n', { mode:0o600, flag:'wx' });
  await writeFile(executable, launcher, { mode:0o700, flag:'wx' });
  const snapshot = await privateConfig(configPath, uid);
  requireCondition(snapshot.bytes.length > 0 && equals(adapterDirIdentity, await directoryIdentity(adapterDir, uid, true)));
  return Object.freeze({ executable, configPath, daemonVersion });
}

async function verifyBinding(config, configPath, snapshot, uid) {
  const current = await privateConfig(configPath, uid);
  requireCondition(current.sha256 === snapshot.sha256 && equals(current.identity, snapshot.identity));
  requireCondition(equals(config.adapterDirIdentity, await directoryIdentity(config.adapterDir, uid, true)));
  requireCondition(equals(config.codexHomeIdentity, await directoryIdentity(config.codexHome, uid, true)));
  requireCondition(equals(config.process, await processIdentity(config.process.pid, config.process.startTicks, uid, config.daemonExeSha256)));
  requireCondition(equals(config.socket, await socketIdentity(config.socketPath, config.process.pid, uid)));
  const final = await privateConfig(configPath, uid);
  requireCondition(final.sha256 === snapshot.sha256 && equals(final.identity, snapshot.identity));
}
function writeAll(stream, value) {
  return new Promise((resolve, reject) => stream.write(value, (error) => error ? reject(error) : resolve()));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
async function openWebSocket(config) {
  const { default:WebSocket } = await import('ws');
  const socket = new WebSocket('ws://localhost/', {
    createConnection:() => createConnection({ path:config.socketPath }),
    perMessageDeflate:false, maxPayload:MAX_JSON_LINE_BYTES, handshakeTimeout:CONNECT_TIMEOUT_MS,
  });
  await new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); socket.terminate(); reject(problem('DAEMON_ADAPTER_CONNECT_FAILED')); };
    const onClose = () => { cleanup(); reject(problem('DAEMON_ADAPTER_CONNECT_FAILED')); };
    const cleanup = () => { socket.off('open', onOpen); socket.off('error', onError); socket.off('close', onClose); };
    socket.once('open', onOpen); socket.once('error', onError); socket.once('close', onClose);
  });
  return socket;
}
function socketSend(socket, text) {
  return new Promise((resolve, reject) => socket.send(text, { binary:false, compress:false }, (error) => error ? reject(error) : resolve()));
}

/** Attach and forward only; never retries, sends signals, starts or stops a daemon. */
export async function runDaemonCliAdapter(configUrl, args, io = { stdin:process.stdin, stdout:process.stdout }) {
  const action = classifyDaemonCliArguments(args);
  // The owning launcher must scrub these before the interpreter starts; this
  // check also prevents accidental inheritance by an ordinary invocation.
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH']) {
    if (process.env[key]) throw problem('DAEMON_ADAPTER_UNSAFE_ENVIRONMENT');
  }
  const uid = getUid();
  const configPath = fileURLToPath(configUrl);
  requireCondition(absolutePath(configPath) && configPath === join(dirname(configPath), CONFIG_NAME));
  const snapshot = await privateConfig(configPath, uid);
  let config;
  try { config = JSON.parse(snapshot.bytes.toString('utf8')); } catch { throw problem('DAEMON_ADAPTER_INVALID_CONFIG'); }
  assertConfigShape(config);
  requireCondition(config.adapterDir === dirname(configPath));
  await verifyBinding(config, configPath, snapshot, uid);
  const cli = await verifyCli(config.cliPath, uid, config.adapterDir);
  requireCondition(equals(cli, config.cli), 'DAEMON_ADAPTER_CLI_MISMATCH');
  await verifyBinding(config, configPath, snapshot, uid);
  if (action.kind === 'version') { await writeAll(io.stdout, CLI_VERSION_LINE + '\n'); return; }
  const ws = await openWebSocket(config);
  try { await verifyBinding(config, configPath, snapshot, uid); }
  catch (error) { ws.terminate(); throw error; }
  const done = deferred(), initialized = deferred();
  let failed = false, gracefulClose = false, initializeId, initializeAccepted = false, flushing = false;
  let queuedBytes = 0;
  const queue = [];
  const fail = (error) => {
    if (failed || gracefulClose) return;
    failed = true;
    const safeError = error?.code?.startsWith?.('DAEMON_ADAPTER_') ? error : problem('DAEMON_ADAPTER_TRANSPORT_FAILED');
    initialized.reject(safeError); done.reject(safeError);
    ws.terminate();
    if (typeof io.stdin.destroy === 'function') io.stdin.destroy();
  };
  const flush = async () => {
    if (flushing || !initializeAccepted || failed) return;
    flushing = true; ws.pause();
    try {
      while (queue.length && !failed) {
        const next = queue[0];
        await verifyBinding(config, configPath, snapshot, uid);
        await writeAll(io.stdout, next.bytes);
        queue.shift(); queuedBytes -= next.bytes.length;
        if (next.initializeResponse) initialized.resolve();
      }
    } catch (error) { fail(error); }
    finally { flushing = false; if (!failed && !gracefulClose) ws.resume(); }
  };
  ws.on('error', fail);
  ws.on('close', () => { if (!gracefulClose) fail(problem('DAEMON_ADAPTER_CONNECTION_CLOSED')); });
  ws.on('message', (raw, isBinary) => {
    try {
      if (isBinary) throw problem('DAEMON_ADAPTER_INVALID_RESPONSE');
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      if (bytes.length > MAX_JSON_LINE_BYTES) throw problem('DAEMON_ADAPTER_FRAME_TOO_LARGE');
      const text = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
      const parsed = JSON.parse(text);
      requireCondition(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'DAEMON_ADAPTER_INVALID_RESPONSE');
      let isInitResponse = false;
      if (!initializeAccepted && initializeId !== undefined && parsed.id === initializeId && ('result' in parsed || 'error' in parsed)) {
        requireCondition(!('error' in parsed) && parseDaemonInitializeVersion(parsed.result) === config.daemonVersion, 'DAEMON_ADAPTER_DAEMON_VERSION_MISMATCH');
        requireCondition(typeof parsed.result?.codexHome === 'string' && parsed.result.codexHome === config.codexHome, 'DAEMON_ADAPTER_HOME_MISMATCH');
        initializeAccepted = true; isInitResponse = true;
      }
      // Newlines can only be JSON whitespace here, because JSON.parse already
      // rejected raw newlines in strings. Preserve numbers and all other bytes.
      const line = Buffer.from(text.replace(/[\r\n]/g, ' ') + '\n');
      queuedBytes += line.length;
      if (queuedBytes > MAX_QUEUE_BYTES) throw problem('DAEMON_ADAPTER_QUEUE_OVERFLOW');
      queue.push({ bytes:line, initializeResponse:isInitResponse });
      void flush();
    } catch (error) { fail(error); }
  });
  const timeout = setTimeout(() => fail(problem('DAEMON_ADAPTER_INITIALIZE_TIMEOUT')), INITIALIZE_TIMEOUT_MS);
  timeout.unref();
  const consume = (async () => {
    let first = true;
    for await (const line of parseJsonLines(io.stdin)) {
      if (failed) return;
      const value = JSON.parse(line);
      requireCondition(value && typeof value === 'object' && !Array.isArray(value), 'DAEMON_ADAPTER_INVALID_REQUEST');
      if (first) {
        requireCondition(value.method === 'initialize' && (typeof value.id === 'string' || Number.isSafeInteger(value.id)), 'DAEMON_ADAPTER_INITIALIZE_REQUIRED');
        initializeId = value.id; first = false;
      }
      await verifyBinding(config, configPath, snapshot, uid);
      await socketSend(ws, line);
      if (value.method === 'initialize') { await initialized.promise; clearTimeout(timeout); }
    }
    if (first) throw problem('DAEMON_ADAPTER_INITIALIZE_REQUIRED');
    gracefulClose = true;
    ws.close(1000);
    done.resolve();
  })();
  consume.catch(fail);
  try { await done.promise; }
  finally { clearTimeout(timeout); if (!gracefulClose) ws.terminate(); }
}
