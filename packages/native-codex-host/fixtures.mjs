import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { buildChildEnv } from './host.mjs';
// Only creates local threads. No turn/start, resume, approval or model call is sent.
export async function createFixtureThreads(options, owned) {
  owned.assertRunning();
  const log = await open(join(options.runtimeRoot, 'fixture-app-server.log'), 'a', 0o600);
  owned.assertRunning();
  const child = owned.add(spawn(options.codexCli, ['app-server', '--listen', 'stdio://'], { env: buildChildEnv(options), cwd: options.projectDir, stdio: ['pipe', 'pipe', log.fd] }));
  const pending = new Map(); let nextId = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  });
  const rejectPending = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.on('error', rejectPending); child.on('exit', () => rejectPending(new Error('owned fixture app-server exited')));
  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`fixture ${method} timed out`)); }, 15000);
      pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  try {
    await request('initialize', { clientInfo: { name: 'isolated_native_prototype', title: 'Isolated Native Prototype', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const threads = [];
    for (let i = 0; i < 2; i++) {
      owned.assertRunning();
      const result = await request('thread/start', { cwd: options.projectDir, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false, persistExtendedHistory: true });
      if (!result?.thread?.id) throw new Error('thread/start returned no thread identity');
      threads.push({ id: result.thread.id, path: result.thread.path, cwd: result.thread.cwd, model: result.model, turns: result.thread.turns?.length ?? 0 });
    }
    return { appServerPid: child.pid, threads };
  } finally {
    lines.close(); child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); });
    await log.close();
  }
}
