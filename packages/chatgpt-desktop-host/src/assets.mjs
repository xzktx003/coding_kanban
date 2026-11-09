import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// These are server-side admission caps, never parameters accepted from HTTP.
const CAPS = Object.freeze({ maxHeaderBytes: 16 * 1024 * 1024, maxAssetBytes: 16 * 1024 * 1024, maxInFlightBytes: 32 * 1024 * 1024, maxQueue: 64 });
const mime = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' });
function fail(code, message) { return Object.assign(new Error(message), { code }); }
const own = (obj, key) => Object.hasOwn(obj, key) ? obj[key] : undefined;
const digest = (body) => createHash('sha256').update(body).digest('hex');
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(k => a[k] === b[k]);

function limits(options) {
  const result = {};
  for (const [key, cap] of Object.entries(CAPS)) {
    const n = options[key] ?? cap;
    if (!Number.isSafeInteger(n) || n < 1 || n > cap) throw fail('ASAR_INVALID_CONFIG', 'Invalid archive budget');
    result[key] = n;
  }
  return result;
}
async function readAt(fd, size, position) {
  const bytes = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const next = await fd.read(bytes, read, size - read, position + read);
    if (!next.bytesRead) throw fail('ASAR_TRUNCATED', 'Archive ended inside declared data');
    read += next.bytesRead;
  }
  return bytes;
}
function memberPath(member) {
  if (typeof member !== 'string' || member.length > 4096 || !member.startsWith('webview/') || /[\\\0%]/u.test(member)) throw fail('ASAR_INVALID_PATH', 'Invalid webview resource path');
  const parts = member.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw fail('ASAR_INVALID_PATH', 'Invalid webview resource path');
  return parts;
}

/**
 * Read a fixed, hash-pinned ASAR without extracting or executing its contents.
 * Only packed webview members are exposed. Each acquired response holds a byte
 * lease until release(), including while a slow client drains its response.
 * There is no body cache. The caller must release on finish, close, and error.
 */
export async function openWebviewArchive(options) {
  if (!options || typeof options !== 'object' || !path.isAbsolute(options.asarPath ?? '') || !/^[a-f0-9]{64}$/.test(options.sha256 ?? '')) throw fail('ASAR_INVALID_CONFIG', 'Archive requires an absolute path and SHA-256 pin');
  const caps = limits(options), filename = options.asarPath;
  if (await realpath(filename) !== filename) throw fail('ASAR_INVALID_CONFIG', 'Archive path must be canonical');
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let closed = false, closing, inFlight = 0;
  const waiting = [];
  try {
    const identity = await fd.stat({ bigint: true });
    if (!identity.isFile() || identity.size < 16n || identity.size > 4n * 1024n ** 3n) throw fail('ASAR_INVALID_CONFIG', 'Invalid archive file');
    const checkIdentity = async () => {
      if (closed) throw fail('ASAR_CLOSED', 'Archive is closed');
      let current, link;
      try { [current, link] = await Promise.all([fd.stat({ bigint: true }), lstat(filename, { bigint: true })]); }
      catch { throw fail('ASAR_IDENTITY_CHANGED', 'Archive identity changed'); }
      if (!same(identity, current) || !same(identity, link) || !link.isFile()) throw fail('ASAR_IDENTITY_CHANGED', 'Archive identity changed');
    };
    const wholeHash = createHash('sha256');
    const block = Buffer.allocUnsafe(64 * 1024);
    for (let position = 0; position < Number(identity.size);) {
      const { bytesRead } = await fd.read(block, 0, Math.min(block.length, Number(identity.size) - position), position);
      if (!bytesRead) throw fail('ASAR_TRUNCATED', 'Archive changed during verification');
      wholeHash.update(block.subarray(0, bytesRead)); position += bytesRead;
    }
    if (wholeHash.digest('hex') !== options.sha256) throw fail('ASAR_DIGEST_MISMATCH', 'Archive does not match pinned SHA-256');
    await checkIdentity();
    const prefix = await readAt(fd, 16, 0);
    const headerBytes = prefix.readUInt32LE(12), pickleBytes = prefix.readUInt32LE(4);
    if (headerBytes > caps.maxHeaderBytes) throw fail('ASAR_HEADER_TOO_LARGE', 'Archive header exceeds budget');
    if (prefix.readUInt32LE(0) !== 4 || pickleBytes !== 8 + Math.ceil(headerBytes / 4) * 4 || prefix.readUInt32LE(8) !== pickleBytes - 4 || 8 + pickleBytes > Number(identity.size)) throw fail('ASAR_INVALID_HEADER', 'Invalid archive header');
    let index;
    try { index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readAt(fd, headerBytes, 16))); }
    catch { throw fail('ASAR_INVALID_HEADER', 'Invalid archive index'); }
    const dataStart = 8 + pickleBytes;
    // The bounded header limits retained index bytes. No inherited keys resolve.
    const findMember = (member) => {
      const parts = memberPath(member); let item = index;
      for (const part of parts) {
        item = item && typeof item === 'object' && item.files && typeof item.files === 'object' ? own(item.files, part) : undefined;
        if (!item) throw fail('ASAR_NOT_FOUND', 'Webview member does not exist');
      }
      if (typeof item !== 'object' || item.files || Object.hasOwn(item, 'link') || item.unpacked || !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.offset !== 'string' || !/^(0|[1-9][0-9]*)$/.test(item.offset) || item.integrity?.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/.test(item.integrity?.hash ?? '')) throw fail('ASAR_INVALID_MEMBER', 'Webview member must be packed with a digest');
      if (item.size > caps.maxAssetBytes || item.size > caps.maxInFlightBytes) throw fail('ASAR_ASSET_TOO_LARGE', 'Webview member exceeds byte budget');
      const offset = Number(item.offset), end = dataStart + offset + item.size;
      if (!Number.isSafeInteger(end) || !Number.isSafeInteger(offset) || end > Number(identity.size)) throw fail('ASAR_INVALID_MEMBER', 'Webview member is outside archive');
      return { size: item.size, position: dataStart + offset, hash: item.integrity.hash };
    };
    function drain() {
      while (!closed && waiting.length && inFlight + waiting[0].size <= caps.maxInFlightBytes) {
        const next = waiting.shift(); next.detach(); inFlight += next.size; next.resolve();
      }
    }
    const admission = (size, signal) => {
      if (closed) return Promise.reject(fail('ASAR_CLOSED', 'Archive is closed'));
      if (signal?.aborted) return Promise.reject(fail('ABORT_ERR', 'Resource request aborted'));
      if (!waiting.length && inFlight + size <= caps.maxInFlightBytes) { inFlight += size; return Promise.resolve(); }
      if (waiting.length >= caps.maxQueue) return Promise.reject(fail('ASAR_QUEUE_FULL', 'Resource admission queue is full'));
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) { waiting.splice(index, 1); entry.detach(); reject(fail('ABORT_ERR', 'Resource request aborted')); drain(); }
        };
        const entry = { size, resolve, reject, detach: () => signal?.removeEventListener('abort', onAbort) };
        waiting.push(entry); signal?.addEventListener('abort', onAbort, { once: true });
      });
    };
    return {
      async acquireAsset(member, { signal } = {}) {
        if (closed) throw fail('ASAR_CLOSED', 'Archive is closed');
        const item = findMember(member);
        await admission(item.size, signal);
        let released = false;
        const release = () => { if (!released) { released = true; inFlight -= item.size; drain(); } };
        try {
          if (signal?.aborted) throw fail('ABORT_ERR', 'Resource request aborted');
          await checkIdentity();
          const body = await readAt(fd, item.size, item.position);
          await checkIdentity();
          if (digest(body) !== item.hash) throw fail('ASAR_MEMBER_DIGEST_MISMATCH', 'Webview member digest mismatch');
          if (signal?.aborted) throw fail('ABORT_ERR', 'Resource request aborted');
          return { body, contentType: mime[path.extname(member)] ?? 'application/octet-stream', etag: '"' + item.hash + '"', release };
        } catch (error) { release(); throw error; }
      },
      async close() {
        if (closing) return closing;
        closed = true;
        for (const entry of waiting.splice(0)) { entry.detach(); entry.reject(fail('ASAR_CLOSED', 'Archive is closed')); }
        index = null;
        closing = fd.close(); return closing;
      },
    };
  } catch (error) { closed = true; await fd.close(); throw error; }
}
