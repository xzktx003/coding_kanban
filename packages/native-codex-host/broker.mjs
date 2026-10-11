import { readFile, lstat } from 'node:fs/promises';
import http from 'node:http';
import { isAbsolute } from 'node:path';
import control from './companion/control.cjs';
export async function brokerRequest(recordPath, operation, body) {
  if (!isAbsolute(recordPath)) throw new Error('explicit absolute runtime record path required');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  const authPath = record.brokerAuthFile; const info = await lstat(authPath);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error('broker auth file must be owned and mode 0600');
  const auth = JSON.parse(await readFile(authPath, 'utf8'));
  if (!Number.isInteger(auth.port) || auth.port < 1024 || auth.port > 65535 || auth.port !== record.brokerPort) throw new Error('broker port mismatch');
  if (operation !== 'status' && operation !== 'open') throw new Error('unsupported broker operation');
  if (operation === 'open') control.validateOpen(body, auth.threads);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: auth.port, method: operation === 'status' ? 'GET' : 'POST', path: `/${operation}`,
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' }, timeout: 20000 }, response => {
      let value = ''; response.on('data', chunk => { value += chunk; if (Buffer.byteLength(value) > 65536) { response.destroy(); reject(new Error('broker response too large')); } });
      response.on('error', reject); response.on('end', () => {
        try { const parsed = JSON.parse(value); response.statusCode === 200 ? resolve({ ...parsed, brokerScope: 'first-listener-instance' }) : reject(new Error(parsed.error || `broker HTTP ${response.statusCode}`)); } catch (error) { reject(error); }
      });
    });
    request.on('error', () => reject(new Error('local companion unavailable; open the isolated browser host to activate it')));
    request.on('timeout', () => request.destroy(new Error('companion timeout')));
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [flag, record, operation, threadId, column] = process.argv.slice(2);
  try {
    if (flag !== '--record' || !record) throw new Error('usage: broker.mjs --record /absolute/runtime.json status|open [threadId column]');
    console.log(JSON.stringify(await brokerRequest(record, operation, operation === 'open' ? { threadId, column: Number(column) } : undefined), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
