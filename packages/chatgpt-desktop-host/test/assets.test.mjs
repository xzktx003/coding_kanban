import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, rename, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openWebviewArchive } from '../src/assets.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function archive(entries, modify = (x) => x) {
  const index = { files: {} }, bodies = [];
  let offset = 0;
  for (const [member, value] of Object.entries(entries)) {
    const body = Buffer.from(value), parts = member.split('/');
    let parent = index;
    for (const part of parts.slice(0, -1)) parent = (parent.files[part] ??= { files: {} });
    parent.files[parts.at(-1)] = { size: body.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: hash(body) } };
    offset += body.length; bodies.push(body);
  }
  const json = Buffer.from(JSON.stringify(modify(index)));
  const headerLength = 8 + Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(8 + headerLength);
  [4, headerLength, headerLength - 4, json.length].forEach((n, i) => header.writeUInt32LE(n, i * 4));
  json.copy(header, 16);
  return Buffer.concat([header, ...bodies]);
}
async function fixture(t, bytes, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chatgpt-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const asarPath = path.join(dir, 'app.asar');
  await writeFile(asarPath, bytes);
  const open = (extra = {}) => openWebviewArchive({ asarPath, sha256: hash(bytes), ...options, ...extra });
  return { dir, asarPath, open };
}

test('serves only verified packed webview members, with MIME and a disposable byte lease', async (t) => {
  const f = await fixture(t, archive({ 'webview/index.html': '<main>Codex</main>', 'webview/assets/a.js': 'export{}', 'secret.json': '{}' }));
  const store = await f.open(); t.after(() => store.close());
  const lease = await store.acquireAsset('webview/index.html');
  assert.equal(lease.body.toString(), '<main>Codex</main>');
  assert.equal(lease.contentType, 'text/html; charset=utf-8');
  assert.equal(lease.etag, '"' + hash(lease.body) + '"');
  lease.release(); lease.release();
  const script = await store.acquireAsset('webview/assets/a.js');
  assert.equal(script.contentType, 'text/javascript; charset=utf-8'); script.release();
  for (const member of ['secret.json', '../webview/index.html', 'webview/../secret.json', '/webview/index.html', 'webview\\index.html', 'webview//index.html', 'webview/%2e%2e/secret.json', 'webview/a\0b', 'webview/./index.html']) {
    await assert.rejects(store.acquireAsset(member), { code: 'ASAR_INVALID_PATH' });
  }
  await assert.rejects(store.acquireAsset('webview/absent'), { code: 'ASAR_NOT_FOUND' });
});

test('requires a caller-pinned whole archive hash before accepting the index', async (t) => {
  const f = await fixture(t, archive({ 'webview/index.html': 'hello' }));
  await assert.rejects(f.open({ sha256: '0'.repeat(64) }), { code: 'ASAR_DIGEST_MISMATCH' });
  await assert.rejects(f.open({ sha256: undefined }), { code: 'ASAR_INVALID_CONFIG' });
});

test('checks member hashes even when the whole archive hash is trusted', async (t) => {
  const bytes = archive({ 'webview/a.js': 'abc' }); bytes[bytes.length - 1] ^= 1;
  const f = await fixture(t, bytes), store = await f.open(); t.after(() => store.close());
  await assert.rejects(store.acquireAsset('webview/a.js'), { code: 'ASAR_MEMBER_DIGEST_MISMATCH' });
});

test('rejects external, linked, directory and out-of-bounds members', async (t) => {
  for (const change of [x => { x.unpacked = true; }, x => { x.link = 'secret'; }, x => { x.files = {}; }, x => { x.offset = '999999999'; }, x => { x.offset = '-1'; }, x => { x.size = -1; }, x => { delete x.integrity; }]) {
    const f = await fixture(t, archive({ 'webview/a.js': 'abc' }, x => { change(x.files.webview.files['a.js']); return x; }));
    const store = await f.open(); t.after(() => store.close());
    await assert.rejects(store.acquireAsset('webview/a.js'));
  }
});

test('bounds headers and members before allocating their advertised bodies', async (t) => {
  const f = await fixture(t, archive({ 'webview/a.js': 'abc' }));
  await assert.rejects(f.open({ maxHeaderBytes: 10 }), { code: 'ASAR_HEADER_TOO_LARGE' });
  const store = await f.open({ maxAssetBytes: 2 }); t.after(() => store.close());
  await assert.rejects(store.acquireAsset('webview/a.js'), { code: 'ASAR_ASSET_TOO_LARGE' });
  for (const invalid of [0, -1, Infinity, 16 * 1024 * 1024 + 1]) {
    await assert.rejects(f.open({ maxAssetBytes: invalid }), { code: 'ASAR_INVALID_CONFIG' });
  }
});

test('keeps a byte lease until the response finishes and applies bounded FIFO admission', async (t) => {
  const f = await fixture(t, archive({ 'webview/a': 'aaaa', 'webview/b': 'bbbb' }));
  const store = await f.open({ maxInFlightBytes: 4, maxQueue: 1 }); t.after(() => store.close());
  const first = await store.acquireAsset('webview/a');
  let resolved = false;
  const queued = store.acquireAsset('webview/b').then(x => { resolved = true; return x; });
  await new Promise(r => setImmediate(r)); assert.equal(resolved, false);
  await assert.rejects(store.acquireAsset('webview/b'), { code: 'ASAR_QUEUE_FULL' });
  first.release(); const second = await queued;
  assert.equal(second.body.toString(), 'bbbb'); second.release();
});

test('cancels waiting requests and closes its own handle without hanging the queue', async (t) => {
  const f = await fixture(t, archive({ 'webview/a': 'aaaa' }));
  const store = await f.open({ maxInFlightBytes: 4 });
  const first = await store.acquireAsset('webview/a');
  const controller = new AbortController();
  const queued = store.acquireAsset('webview/a', { signal: controller.signal });
  controller.abort(); await assert.rejects(queued, { code: 'ABORT_ERR' });
  const onClose = store.acquireAsset('webview/a');
  const rejection = assert.rejects(onClose, { code: 'ASAR_CLOSED' });
  await store.close(); await rejection;
  first.release(); await store.close();
  await assert.rejects(store.acquireAsset('webview/a'), { code: 'ASAR_CLOSED' });
});

test('fails closed after file contents or path identity change', async (t) => {
  for (const replace of [false, true]) {
    const bytes = archive({ 'webview/a': 'aaaa' });
    const f = await fixture(t, bytes), store = await f.open(); t.after(() => store.close());
    if (replace) {
      const other = path.join(f.dir, 'other.asar'); await writeFile(other, bytes); await rename(other, f.asarPath);
    } else {
      const before = await stat(f.asarPath);
      const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
      await writeFile(f.asarPath, changed);
      // Same-tick writes can retain coarse filesystem timestamps. Advance the
      // fixture's mtime deterministically to exercise the identity guard.
      await utimes(f.asarPath, before.atime, new Date(before.mtimeMs + 2000));
    }
    await assert.rejects(store.acquireAsset('webview/a'), { code: 'ASAR_IDENTITY_CHANGED' });
  }
});
