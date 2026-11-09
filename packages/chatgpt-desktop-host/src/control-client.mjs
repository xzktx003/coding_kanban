import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';
import { parseJsonLines } from './json-lines.mjs';
import { encodeWireValue, decodeWireValue } from './wire-value.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CLIENT_TYPES = new Set(['call', 'openPort', 'portPost', 'closePort']);
const HOST_TYPES = new Set(['return', 'throw', 'portMessage', 'portClosed', 'viewMessage', 'theme', 'workerMessage', 'gitPort']);
const BROKER_ERRORS = new Set(['CONTROL_QUEUE_FULL', 'CONTROL_PROTOCOL_ERROR', 'CONTROL_UPSTREAM_ERROR', 'CONTROL_HANDSHAKE_TIMEOUT']);
const CALLS = new Set(['sendMessageFromView', 'startLinkDrag', 'acknowledgeChunkedMessage', 'connectGitWorker', 'sendWorkerMessageFromView', 'showContextMenu', 'getFastModeRolloutMetrics', 'workerSubscribe', 'workerUnsubscribe']);
const failure = (code, message) => Object.assign(new Error(message), { code });
const sameScope = (a, b) => a && Object.keys(a).length === 3 && Object.keys(b).every(k => a[k] === b[k]);
function rejectBrokerError(frame) {
  if (frame?.type !== 'error') return;
  if (typeof frame !== 'object' || Array.isArray(frame) || frame.v !== 1 || Object.keys(frame).length !== 3 || !['v', 'type', 'code'].every(key => Object.hasOwn(frame, key)) || !BROKER_ERRORS.has(frame.code)) throw failure('CONTROL_INVALID_FRAME', 'Unsupported desktop control error');
  throw failure(frame.code, 'Desktop control reported an error');
}
function receivedIdentityFailure(frame, scope, expectedSeq) {
  const value = frame?.scope;
  const scopeShapeMatches = !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 3 && Object.keys(scope).every(key => Object.hasOwn(value, key));
  return Object.assign(failure('CONTROL_IDENTITY_CHANGED', 'Desktop frame identity or sequence changed'), {
    controlMeta: Object.freeze({
      direction: 'native_to_gateway', expectedSeq,
      actualSeq: Number.isSafeInteger(frame?.seq) ? frame.seq : null,
      versionMatches: frame?.v === 1,
      profileMatches: value?.profileId === scope.profileId,
      generationMatches: value?.generation === scope.generation,
      viewMatches: value?.viewId === scope.viewId,
      scopeShapeMatches, frameType: HOST_TYPES.has(frame?.type) ? frame.type : 'other',
    }),
  });
}

/** A bounded hello and fixed metadata query; it never creates a desktop view. */
export async function readDesktopProjectPersistence({ profile, verifyProfile, timeoutMs = 3000 }) {
  if (!profile || !UUID.test(profile.id ?? '') || !UUID.test(profile.generation ?? '') ||
      !isAbsolute(profile.controlSocketPath ?? '') || /[\0-\x1f]/u.test(profile.controlSocketPath) ||
      !Number.isSafeInteger(profile.pid) || profile.pid < 1 || !/^[0-9]{1,30}$/.test(profile.startTicks ?? '') ||
      typeof verifyProfile !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw failure('CONTROL_INVALID_CONFIG', 'Invalid private control binding');
  profile = Object.freeze({ ...profile });
  let socket, timer, finished = false;
  const operation = async () => {
    if (!await verifyProfile()) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop profile identity changed');
    if (finished) throw failure('CONTROL_TIMEOUT', 'Desktop handshake timed out');
    socket = createConnection({ path: profile.controlSocketPath, highWaterMark: 16 * 1024 });
    socket.on('error', () => {});
    const lines = parseJsonLines(socket, { maxLineBytes: 16 * 1024, maxChunkBytes: 16 * 1024 });
    await new Promise((resolve, reject) => socket.write(encodeWireValue({ v: 1, type: 'hello', profileId: profile.id, generation: profile.generation }) + '\n', err => err ? reject(failure('CONTROL_DISCONNECTED', 'Desktop handshake ended')) : resolve()));
    const next = await lines.next();
    if (next.done) throw failure('CONTROL_DISCONNECTED', 'Desktop handshake ended');
    const hello = decodeWireValue(next.value); rejectBrokerError(hello);
    if (hello?.v !== 1 || hello.type !== 'hello' || hello.profileId !== profile.id || hello.generation !== profile.generation || hello.pid !== profile.pid || hello.startTicks !== profile.startTicks || !await verifyProfile())
      throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop runtime identity does not match its profile');
    if (finished) throw failure('CONTROL_TIMEOUT', 'Desktop handshake timed out');
    await new Promise((resolve, reject) => socket.write(encodeWireValue({ v: 1, type: 'projectPersistenceStatus' }) + '\n', err => err ? reject(failure('CONTROL_DISCONNECTED', 'Desktop metadata query ended')) : resolve()));
    const result = await lines.next();
    if (result.done) throw failure('CONTROL_DISCONNECTED', 'Desktop metadata query ended');
    const metadata = decodeWireValue(result.value); rejectBrokerError(metadata);
    if (metadata?.v !== 1 || metadata.type !== 'projectPersistenceStatus' || !await verifyProfile())
      throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop metadata binding changed');
    return new Set(['disabled', 'waiting', 'active', 'unsupported', 'error']).has(metadata.state) ? metadata.state : 'unknown';
  };
  try {
    return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(failure('CONTROL_TIMEOUT', 'Desktop handshake timed out')), timeoutMs); })]);
  } finally { finished = true; clearTimeout(timer); socket?.destroy(); }
}

/**
 * Connect only to a server-validated private desktop profile. No process launch,
 * endpoint fallback, request replay, or raw IPC/evaluation operation is provided.
 * verifyProfile must revalidate the complete original profile, not just its ID.
 * File identity checks and peer hello are point-in-time checks, not an atomic
 * protection against an owner concurrently changing its own files/processes.
 */
export async function connectDesktopControl({ profile, viewId, verifyProfile, signal, timeoutMs = 10000 }) {
  if (!profile || !UUID.test(profile.id ?? '') || !UUID.test(profile.generation ?? '') || !UUID.test(viewId ?? '') || !isAbsolute(profile.controlSocketPath ?? '') || /[\0-\x1f]/u.test(profile.controlSocketPath) || !Number.isSafeInteger(profile.pid) || profile.pid < 1 || !/^[0-9]{1,30}$/.test(profile.startTicks ?? '') || typeof verifyProfile !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw failure('CONTROL_INVALID_CONFIG', 'Invalid private control binding');
  profile = Object.freeze({ ...profile });
  if (signal?.aborted) throw failure('ABORT_ERR', 'Desktop connection aborted');
  const initialIdentity = await verifyProfile();
  if (signal?.aborted) throw failure('ABORT_ERR', 'Desktop connection aborted');
  if (!initialIdentity) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop profile identity changed');
  const socket = createConnection({ path: profile.controlSocketPath, highWaterMark: 64 * 1024 });
  // The async iterator owns socket errors; this listener also covers errors before
  // that iterator starts, without retaining or exposing native error payloads.
  socket.on('error', () => {});
  let closed = false, queuedBytes = 0, sentSequence = 0, receivedSequence = 0;
  let batchRunning = false, batchScheduled = false;
  const sendQueue = [], outstanding = new Set();
  let closeReason;
  const scope = Object.freeze({ profileId: profile.id, generation: profile.generation, viewId });
  const abort = () => close(failure('ABORT_ERR', 'Desktop connection aborted'));
  function settle(entry, reason) {
    if (entry.settled) return;
    entry.settled = true;
    queuedBytes -= entry.frame.bytes;
    // A verifier may never settle after an abort. Release the encoded payload
    // even while its small, already-settled batch entry is still retained.
    entry.frame = null;
    outstanding.delete(entry);
    if (reason) entry.reject(reason); else entry.resolve();
  }
  function close(reason) {
    if (closed) return;
    closed = true; closeReason = reason; signal?.removeEventListener('abort', abort); socket.destroy(reason);
    const unsent = reason ?? failure('CONTROL_CLOSED', 'Desktop control is closed');
    for (const entry of outstanding) settle(entry, entry.dispatched ? failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop write outcome is unknown') : unsent);
    sendQueue.length = 0;
  }
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  socket.once('close', () => close(failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop connection ended; pending operations must be reconciled')));
  const lines = parseJsonLines(socket, { maxLineBytes: MAX_BYTES });
  async function readHandshake() {
    let timer;
    try {
      return await Promise.race([
        lines.next().then(next => {
          if (next.done) throw failure('CONTROL_DISCONNECTED', 'Desktop handshake ended');
          const frame = decodeWireValue(next.value);
          rejectBrokerError(frame);
          return frame;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => { const reason = failure('CONTROL_TIMEOUT', 'Desktop handshake timed out'); close(reason); reject(reason); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function write(encoded) {
    if (closed) throw closeReason ?? failure('CONTROL_CLOSED', 'Desktop control is closed');
    if (!await verifyProfile()) { const reason = failure('CONTROL_IDENTITY_CHANGED', 'Desktop profile identity changed'); close(reason); throw reason; }
    if (closed) throw closeReason ?? failure('CONTROL_CLOSED', 'Desktop control is closed');
    await new Promise((resolve, reject) => socket.write(encoded + '\n', 'utf8', err => err ? reject(failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop write outcome is unknown')) : resolve()));
  }
  function scheduleBatch() {
    if (closed || batchRunning || batchScheduled || sendQueue.length === 0) return;
    batchScheduled = true;
    queueMicrotask(() => { batchScheduled = false; void flushBatch(); });
  }
  async function flushBatch() {
    if (closed || batchRunning || sendQueue.length === 0) return;
    batchRunning = true;
    // Fix membership before the fresh identity check: later arrivals need the
    // next check. The encoded strings and sizes cannot change after admission.
    const batch = sendQueue.splice(0, 8);
    try {
      if (!await verifyProfile()) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop profile identity changed');
      if (closed) return;
      // No await between these writes; every member shares only this check and
      // retains its own completion/unknown outcome and the existing byte budget.
      const written = batch.map(entry => new Promise(resolve => {
        if (closed || entry.settled) { resolve(); return; }
        entry.dispatched = true;
        try {
          socket.write(entry.frame.encoded + '\n', 'utf8', err => {
            if (err) close(failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop write outcome is unknown'));
            else settle(entry);
            resolve();
          });
        } catch {
          close(failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop write outcome is unknown'));
          resolve();
        }
      }));
      await Promise.all(written);
    } catch (reason) { close(reason); }
    finally { batchRunning = false; scheduleBatch(); }
  }
  try {
    await write(encodeWireValue({ v: 1, type: 'hello', profileId: profile.id, generation: profile.generation }));
    const hello = await readHandshake();
    if (hello?.v !== 1 || hello.type !== 'hello' || hello.profileId !== profile.id || hello.generation !== profile.generation || hello.pid !== profile.pid || hello.startTicks !== profile.startTicks) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop runtime identity does not match its profile');
    await write(encodeWireValue({ v: 1, type: 'createView', viewId }));
    const reply = await readHandshake();
    if (reply?.v !== 1 || reply.type !== 'bootstrap' || !sameScope(reply.scope, scope) || reply.bootstrap?.windowType !== 'electron' || !reply.bootstrap.getters || !reply.bootstrap.sharedObjects) throw failure('CONTROL_INVALID_BOOTSTRAP', 'Desktop view bootstrap is invalid');
    if (!await verifyProfile()) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop profile identity changed');
    let consuming = false;
    const frames = {
      async *[Symbol.asyncIterator]() {
        if (consuming) throw failure('CONTROL_ALREADY_CONSUMED', 'Desktop frames have one consumer');
        consuming = true;
        try {
          while (!closed) {
            const next = await lines.next();
            if (next.done) { if (!closed) throw failure('CONTROL_OUTCOME_UNKNOWN', 'Desktop connection ended; pending operations must be reconciled'); break; }
            const frame = decodeWireValue(next.value);
            rejectBrokerError(frame);
            if (frame?.v !== 1 || !sameScope(frame.scope, scope) || frame.seq !== receivedSequence + 1) throw receivedIdentityFailure(frame, scope, receivedSequence + 1);
            if (!HOST_TYPES.has(frame.type)) throw failure('CONTROL_INVALID_FRAME', 'Unsupported desktop frame');
            receivedSequence = frame.seq; yield next.value;
          }
        } catch (reason) { close(reason); throw reason; }
        finally { close(); }
      },
    };
    return {
      scope, bootstrap: reply.bootstrap, frames,
      sendFrame(encoded) {
        if (closed) return Promise.reject(closeReason ?? failure('CONTROL_CLOSED', 'Desktop control is closed'));
        let bytes, frame;
        try {
          if (typeof encoded !== 'string') throw failure('CONTROL_INVALID_FRAME', 'Desktop frame must be encoded text');
          bytes = Buffer.byteLength(encoded, 'utf8');
          if (bytes > MAX_BYTES || queuedBytes + bytes > MAX_BYTES) throw failure('CONTROL_QUEUE_FULL', 'Desktop send queue exceeds byte budget');
          frame = decodeWireValue(encoded);
          if (frame?.v !== 1 || !sameScope(frame.scope, scope) || frame.seq !== sentSequence + 1) throw failure('CONTROL_IDENTITY_CHANGED', 'Desktop frame identity or sequence changed');
          if (!CLIENT_TYPES.has(frame.type) || frame.type === 'call' && (!CALLS.has(frame.method) || !Array.isArray(frame.args))) throw failure('CONTROL_INVALID_FRAME', 'Unsupported desktop operation');
          sentSequence = frame.seq; queuedBytes += bytes;
        } catch (reason) { close(reason); return Promise.reject(reason); }
        return new Promise((resolve, reject) => {
          const entry = { frame: Object.freeze({ encoded, bytes, seq: frame.seq }), resolve, reject, dispatched: false, settled: false };
          outstanding.add(entry); sendQueue.push(entry); scheduleBatch();
        });
      },
      close: () => close(),
    };
  } catch (reason) { close(reason); throw reason; }
}
