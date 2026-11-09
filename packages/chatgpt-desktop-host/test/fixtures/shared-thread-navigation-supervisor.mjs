import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// A failed test retains this private container; only the test may close the
// owned daemon after it has observed completion of the owned fixture turn.
if (process.env.CHATGPT_SHARED_NAV_ISOLATED !== '1') throw Error('isolated fixture required');
await access('/.dockerenv');
const status = await readFile('/proc/self/status', 'utf8'), routes = await readFile('/proc/net/route', 'utf8');
if (!/^NoNewPrivs:\s*1$/m.test(status) || !/^Seccomp:\s*2$/m.test(status) || /\s00000000\s/.test(routes))
  throw Error('network-none isolated fixture required');
const child = spawn(process.execPath, ['--test-isolation=none', '--test', '/work/packages/chatgpt-desktop-host/test/shared-thread-approval-native.test.mjs'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('error', () => { process.stderr.write('PRIVATE_SHARED_NAV_RETAINED: test process failed\n'); setInterval(() => {}, 60000); });
child.on('exit', (code, signal) => {
  if (code === 0 && signal === null) return;
  process.stderr.write('PRIVATE_SHARED_NAV_RETAINED: verify owned task before cleanup\n');
  setInterval(() => {}, 60000);
});
