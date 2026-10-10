/** Runs in an isolated Node process because the SDK caches its CLI home at module scope.
 * Keep this JavaScript source independent of TS loaders and dist paths. */
export const HISTORY_WORKER_SOURCE = String.raw`
const sdk = await import(process.argv[1]);
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const constants = (await import('node:fs')).constants;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hasContinuation(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const info = await handle.stat();
    if (!info.isFile()) return false;
    const length = Math.min(info.size, 65536);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, info.size - length);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (info.size > length) {
      const newline = text.indexOf('\n');
      if (newline < 0) return false;
      text = text.slice(newline + 1);
    }
    // Read only the same 64 KiB metadata tail used by listSessions. Never parse
    // or retain user/assistant bodies while recovering continuation metadata.
    for (const line of text.split('\n')) {
      if (!/"type"\s*:\s*"continued-in"/.test(line)) continue;
      try {
        const row = JSON.parse(line);
        if (row.type === 'continued-in' && uuid.test(row.continuedInSessionId)) return true;
      } catch { /* A concurrently appended partial metadata line is not a marker. */ }
    }
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally { await handle?.close(); }
}

async function includeContinuedParents(rows) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.claude'), 'projects');
  const seen = new Set(rows.map(row => row.sessionId));
  let projects;
  try { projects = await fs.opendir(root); }
  catch (error) { if (error.code === 'ENOENT') return rows; throw error; }
  let directories = 0, files = 0;
  for await (const project of projects) {
    if (!project.isDirectory()) continue;
    if (++directories > 10000) throw new Error('Claude metadata exceeds directory budget');
    let entries;
    try { entries = await fs.opendir(path.join(root, project.name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for await (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      if (++files > 100000) throw new Error('Claude metadata exceeds transcript budget');
      const id = entry.name.slice(0, -6);
      if (!uuid.test(id) || seen.has(id)) continue;
      if (!await hasContinuation(path.join(root, project.name, entry.name))) continue;
      // New SDK lists hide continued-in parents; getSessionInfo intentionally
      // still returns their metadata without loading history or resuming them.
      const info = await sdk.getSessionInfo(id);
      if (info) { rows.push(info); seen.add(id); }
    }
  }
  return rows;
}

try {
  const method = process.argv[2];
  let result = await sdk[method](...JSON.parse(process.argv[3]));
  if (method === 'listSessions') result = await includeContinuedParents(result);
  process.stdout.write(JSON.stringify(result ?? null));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
`;
