import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createUnixServer } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseDaemonInitializeVersion, prepareDaemonCliAdapter } from '../src/daemon-cli-adapter.mjs';

const nativeBin = process.env.CHATGPT_DESKTOP_ADAPTER_NATIVE_BIN;
// An optional second, separately pinned fixture exercises the desktop alpha CLI
// against the stable daemon binary, without attaching to a running daemon.
const stableDaemonBin = process.env.CHATGPT_DESKTOP_ADAPTER_DAEMON_BIN;
const daemonBin = stableDaemonBin || nativeBin;
const pinnedSha = '6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const stableDaemonSha = 'b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8';
const expectedDaemonSha = stableDaemonBin ? stableDaemonSha : pinnedSha;
const expectedDaemonVersion = stableDaemonBin ? '0.166.0' : '0.166.0-alpha.5.1';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(25); }
  throw new Error(`fixture deadline: ${label}`);
}
async function startTicks(pid) {
  const s = await readFile(`/proc/${pid}/stat`, 'utf8');
  const parts = s.slice(s.lastIndexOf(')') + 2).split(' ');
  assert.notEqual(parts[0], 'Z'); return parts[19];
}
async function exitOf(child) {
  if (child.exitCode !== null || child.signalCode !== null) return { code:child.exitCode, signal:child.signalCode };
  return await new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}
async function stopOwnChild(child, ticks) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  assert.equal(await startTicks(child.pid), ticks);
  child.kill('SIGTERM');
  await Promise.race([exitOf(child), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    assert.equal(await startTicks(child.pid), ticks);
    child.kill('SIGKILL'); await exitOf(child);
  }
}
class Rpc {
  constructor(executable, cwd, env) {
    this.child = spawn(executable, ['app-server','--analytics-default-enabled'], { cwd, env, stdio:['pipe','pipe','pipe'] });
    this.next = 0; this.pending = new Map(); this.events = []; this.stderr = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (part) => { this.stderr = (this.stderr + part).slice(-4096); });
    this.lines = createInterface({ input:this.child.stdout });
    this.lines.on('line', (line) => {
      let value; try { value = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(value.id);
      if (pending && ('result' in value || 'error' in value)) { this.pending.delete(value.id); pending(value); }
      else this.events.push(value);
    });
  }
  notify(method, params) { this.child.stdin.write(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }) + '\n'); }
  async request(method, params, timeout = 15_000) {
    const id = ++this.next;
    const result = new Promise((resolve) => this.pending.set(id, resolve));
    this.child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    let timer;
    try {
      return await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`fixture RPC deadline: ${method} (${this.stderr.slice(0,200)})`)), timeout); })]);
    } finally { clearTimeout(timer); this.pending.delete(id); }
  }
  async close() { this.child.stdin.end(); return await exitOf(this.child); }
}
const success = (response) => { assert.ok(response && 'result' in response && !('error' in response), 'fixture RPC failed'); return response.result; };

test('two attach-only adapters share one private real app-server; a closing client does not stop its turn',
  { skip:!nativeBin, timeout:75_000 }, async () => {
    assert.equal(resolve(nativeBin), nativeBin);
    assert.equal(createHash('sha256').update(await readFile(nativeBin)).digest('hex'), pinnedSha);
    assert.equal(resolve(daemonBin), daemonBin);
    assert.equal(createHash('sha256').update(await readFile(daemonBin)).digest('hex'), expectedDaemonSha);
    const base = await mkdtemp(join(tmpdir(), 'desktop-daemon-adapter-'));
    const home = join(base, 'home'), codexHome = join(home, '.codex'), project = join(base, 'project'), adapterDir = join(base, 'adapter');
    for (const path of [home,codexHome,project,adapterDir]) await mkdir(path, { mode:0o700 });
    const socketPath = join(base, 'daemon.sock');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let providerCount = 0, providerSeen = false;
    const provider = createServer(async (request, response) => {
      try {
        const pieces = []; for await (const piece of request) pieces.push(piece);
        assert.equal(request.url, '/v1/responses');
        assert.ok(Buffer.concat(pieces).length < 5_000_000);
        providerCount++; providerSeen = true;
        await gate;
        response.writeHead(200, { 'content-type':'text/event-stream', 'cache-control':'no-cache' });
        for (const event of [
          { type:'response.created', response:{ id:'fixture-response' } },
          { type:'response.output_item.done', item:{ type:'message', id:'fixture-message', role:'assistant', content:[{ type:'output_text', text:'PRIVATE_ADAPTER_OK' }] } },
          { type:'response.completed', response:{ id:'fixture-response', usage:{ input_tokens:1, output_tokens:1, total_tokens:2 } } },
        ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch { response.destroy(); }
    });
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const port = provider.address().port;
    await writeFile(join(codexHome, 'config.toml'), `model="fixture"\nmodel_provider="fixture"\napproval_policy="never"\nsandbox_mode="read-only"\n[model_providers.fixture]\nname="private fixture"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nrequest_max_retries=0\nstream_max_retries=0\n`, { mode:0o600 });
    const env = { HOME:home, CODEX_HOME:codexHome, XDG_CONFIG_HOME:join(home,'.config'), TMPDIR:base, PATH:'/usr/bin:/bin', NO_PROXY:'localhost,127.0.0.1', RUST_LOG:'error' };
    let daemon, ticks, a, b;
    try {
      const oldUmask = process.umask(0o077);
      try { daemon = spawn(daemonBin, ['app-server','--listen',`unix://${socketPath}`], { cwd:project, env, stdio:['ignore','ignore','pipe'] }); }
      finally { process.umask(oldUmask); }
      daemon.stderr.resume();
      ticks = await startTicks(daemon.pid);
      await until(async () => { try { return (await stat(socketPath)).isSocket(); } catch { return false; } }, 'private daemon socket');
      assert.equal((await stat(socketPath)).mode & 0o077, 0);
      const baseRegistration = { cliPath:nativeBin, socketPath, daemonPid:daemon.pid, daemonStartTicks:ticks,
        daemonExeSha256:expectedDaemonSha, daemonVersion:expectedDaemonVersion, codexHome };
      const negativeDir = join(base, 'adapter-negative'); await mkdir(negativeDir, { mode:0o700 });
      await assert.rejects(prepareDaemonCliAdapter({ ...baseRegistration, adapterDir:negativeDir, daemonVersion:'0.166.1' }), { code:'DAEMON_ADAPTER_UNSUPPORTED_DAEMON_VERSION' });
      await assert.rejects(prepareDaemonCliAdapter({ ...baseRegistration, adapterDir:negativeDir, daemonStartTicks:'0' }), { code:'DAEMON_ADAPTER_IDENTITY_CHANGED' });
      const otherSocketPath = join(base, 'other.sock'); let otherConnections = 0;
      const other = createUnixServer(() => { otherConnections++; });
      await new Promise((resolve) => other.listen(otherSocketPath, resolve)); await chmod(otherSocketPath, 0o600);
      try {
        await assert.rejects(prepareDaemonCliAdapter({ ...baseRegistration, adapterDir:negativeDir, socketPath:otherSocketPath }), { code:'DAEMON_ADAPTER_IDENTITY_CHANGED' });
        assert.equal(otherConnections, 0);
      } finally { await new Promise((resolve) => other.close(resolve)); }
      // The correct executable and socket still cannot authorize a daemon whose
      // initialize response reports a different supported version.
      const mismatchDir = join(base, 'adapter-version-mismatch'); await mkdir(mismatchDir, { mode:0o700 });
      const mismatchVersion = stableDaemonBin ? '0.166.0-alpha.5.1' : '0.166.0';
      const mismatch = await prepareDaemonCliAdapter({ ...baseRegistration, adapterDir:mismatchDir, daemonVersion:mismatchVersion });
      const mismatchClient = spawn(mismatch.executable, ['app-server','--analytics-default-enabled'], { cwd:project, env, stdio:['pipe','pipe','pipe'] });
      const mismatchOutput = [], mismatchErrors = [];
      mismatchClient.stdout.on('data', (part) => mismatchOutput.push(part));
      mismatchClient.stderr.on('data', (part) => mismatchErrors.push(part));
      mismatchClient.stdin.write(JSON.stringify({ id:1, method:'initialize', params:{ clientInfo:{ name:'version_mismatch_fixture', title:null, version:'1' }, capabilities:{ experimentalApi:true } } }) + '\n');
      assert.equal((await exitOf(mismatchClient)).code, 1);
      assert.equal(Buffer.concat(mismatchOutput).length, 0);
      assert.match(Buffer.concat(mismatchErrors).toString(), /DAEMON_ADAPTER_DAEMON_VERSION_MISMATCH/);
      const adapter = await prepareDaemonCliAdapter({ ...baseRegistration, adapterDir });
      // HTTP-style environment values cannot select the daemon or executable.
      const adapterEnv = { ...env, CODEX_APP_SERVER_WS_URL:'ws://127.0.0.1:9', SESSION_CODEX_DAEMON_SOCKET:'/invalid/not-used.sock' };
      const version = spawn(adapter.executable, ['--version'], { cwd:project, env, stdio:['ignore','pipe','pipe'] });
      const output = []; for await (const part of version.stdout) output.push(part);
      assert.deepEqual(await exitOf(version), { code:0, signal:null });
      assert.equal(Buffer.concat(output).toString(), 'codex-cli 0.166.0-alpha.5.1\n');
      const rejected = spawn(adapter.executable, ['-c','features.code_mode_host=true','app-server','--analytics-default-enabled','-c','plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled=false'], { cwd:project, env, stdio:['ignore','ignore','pipe'] });
      const errors = []; for await (const part of rejected.stderr) errors.push(part);
      assert.equal((await exitOf(rejected)).code, 1);
      assert.match(Buffer.concat(errors).toString(), /DAEMON_ADAPTER_UNSUPPORTED_OVERRIDES/);
      a = new Rpc(adapter.executable, project, adapterEnv); b = new Rpc(adapter.executable, project, adapterEnv);
      for (const [name, client] of [['a',a],['b',b]]) {
        const init = success(await client.request('initialize', { clientInfo:{ name:`private_adapter_${name}`, title:null, version:'1' }, capabilities:{ experimentalApi:true, requestAttestation:false } }));
        assert.equal(init.codexHome, codexHome);
        assert.equal(parseDaemonInitializeVersion(init), expectedDaemonVersion);
        client.notify('initialized');
      }
      const created = success(await a.request('thread/start', { cwd:project, model:'fixture', approvalPolicy:'never', sandbox:'read-only' }));
      const threadId = created.thread.id; assert.equal(typeof threadId, 'string');
      for (const client of [a,b]) {
        assert.equal(success(await client.request('thread/read', { threadId, includeTurns:false })).thread.id, threadId);
        success(await client.request('thread/list', { limit:20 }));
      }
      const started = success(await a.request('turn/start', { threadId, input:[{ type:'text', text:'Return the fixed fixture token.', text_elements:[] }] }));
      const turnId = started.turn.id;
      await until(() => providerSeen, 'provider receives owned turn');
      const observed = success(await b.request('thread/read', { threadId, includeTurns:false }));
      assert.equal(observed.thread.status.type, 'active');
      // Explicit resume is a writer-capable operation, not a read-only subscription.
      assert.equal(success(await b.request('thread/resume', { threadId, excludeTurns:true })).thread.id, threadId);
      assert.deepEqual(await a.close(), { code:0, signal:null });
      assert.equal(await startTicks(daemon.pid), ticks);
      release();
      await until(() => b.events.some((event) => event.method === 'turn/completed' && event.params?.turn?.id === turnId), 'exact completion event', 20_000);
      assert.equal(success(await b.request('thread/read', { threadId, includeTurns:false })).thread.status.type, 'idle');
      assert.equal(providerCount, 1);
      // Every send must fail closed if the fixed 0600 config permissions change.
      await chmod(adapter.configPath, 0o640);
      b.notify('thread/list', { limit:1 });
      const bExit = await Promise.race([exitOf(b.child), delay(10_000).then(() => { throw new Error('identity-change did not close adapter'); })]);
      assert.equal(bExit.code, 1);
      assert.equal(await startTicks(daemon.pid), ticks);
      assert.match(b.stderr, /DAEMON_ADAPTER_IDENTITY_CHANGED/);
    } finally {
      release?.();
      if (a?.child && a.child.exitCode === null && a.child.signalCode === null) { a.child.stdin.end(); await Promise.race([exitOf(a.child),delay(2_000)]); }
      if (b?.child && b.child.exitCode === null && b.child.signalCode === null) { b.child.stdin.end(); await Promise.race([exitOf(b.child),delay(2_000)]); }
      if (daemon && ticks) await stopOwnChild(daemon, ticks);
      provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve));
      await rm(base, { recursive:true, force:true });
    }
  });
