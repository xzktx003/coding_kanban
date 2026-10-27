import { AdmissionError, boundedClone, deny, LIMITS, primitiveSnapshot, recordValues, UUID } from './admission.mjs';
import { ClosedWirePolicy } from './wire-policy.mjs';

// Claimed messages never fall through to a second dispatcher, even after stop.
export function claimsEnvelope(value) {
  if (value === null || typeof value !== 'object') return false;
  const d = Object.getOwnPropertyDescriptors(value), type = d.type?.value, message = d.message?.value;
  return typeof type === 'string' && (type.startsWith('vscode-capn-rpc-') ||
    type === 'log-message' && message === 'sa_server_request_failed');
}

export function createOwnedTransport(options) {
  let { origin, ownerWindow, postToNative, onConnect, emit, onStop = () => {},
    clock = { now: () => performance.now(), setTimeout: (f, n) => setTimeout(f, n), clearTimeout: h => clearTimeout(h) } } = options;
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || !url.port ||
    !ownerWindow || typeof postToNative !== 'function' || typeof onConnect !== 'function' || typeof emit !== 'function') deny('owned-origin-or-binding');
  const policy = new ClosedWirePolicy(), queue = [], ledger = [];
  let state = 'installed', sessionId = null, pending = null, firstFatal = null, stopReason = null;
  let transportFrames = 0, ledgerBytes = 0, lateDrops = 0, handshakeSettled = false, emittedCount = 0;
  let ledgerFailure = null, auditSinkReleased = false, totalTimer, handshakeTimer, usageTimer;
  function entry(kind, fields = {}) {
    if (auditSinkReleased) return true;
    if (ledgerFailure || ledger.length >= LIMITS.maxEntries) return false;
    const record = primitiveSnapshot({ sequence: ledger.length + 1, time: clock.now(), kind, ...fields });
    const bytes = new TextEncoder().encode(JSON.stringify(record)).length;
    if (ledgerBytes + bytes > LIMITS.maxLedgerBytes) return false;
    ledgerBytes += bytes; ledger.push(record);
    // Copy before the external audit sink: it cannot mutate the internal evidence.
    try {
      if (emit(primitiveSnapshot(record)) !== undefined) deny('ledger-emitter-must-be-synchronous');
      emittedCount++;
    } catch (error) {
      ledgerFailure = { code: error instanceof AdmissionError ? error.code : 'ledger-emitter-failed', sequence: record.sequence };
      firstFatal ??= { ...ledgerFailure, where: 'ledger-emission' };
      return false;
    }
    return true;
  }
  function log(kind, fields) { if (!entry(kind, fields)) deny(ledgerFailure?.code ?? 'ledger-bound'); }
  function stop(reason, { fatal = false, detail } = {}) {
    if (state === 'stopped') return;
    if (fatal && !firstFatal) firstFatal = { code: reason, ...detail };
    stopReason = reason; state = 'stopped'; policy.dispose();
    for (const h of [totalTimer, handshakeTimer, usageTimer]) if (h !== undefined) clock.clearTimeout(h);
    totalTimer = handshakeTimer = usageTimer = undefined;
    entry('stopped', { reason, fatal, queueDropped: queue.length, firstFatal }); queue.length = 0;
    if (pending) { const { reject } = pending; pending = null; reject(new AdmissionError(reason)); }
    const notify = onStop; onStop = null; onConnect = null; postToNative = null; ownerWindow = null;
    // emit remains only until the activation coordinator has disposed original RPC.
    try { notify?.({ reason, fatal: fatal || firstFatal !== null, firstFatal: primitiveSnapshot(firstFatal) }); }
    catch (error) { entry('owned-stop-callback-error', { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1024) }); }
  }
  function fatal(error, where) {
    const code = error instanceof AdmissionError ? error.code : 'owned-transport-error';
    entry('denied', { where, code, name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1024) });
    stop(code, { fatal: true, detail: { where } }); return false;
  }
  function counted() { if (++transportFrames > LIMITS.maxTransportFrames) deny('transport-frame-bound'); }
  const transport = {
    encodingLevel: 'jsonCompatibleWithBytes',
    send(value) {
      if (state === 'stopped') { lateDrops++; entry('late-peer-send-dropped'); return; }
      try {
        counted(); const frame = boundedClone(value); log('peer-wire-attempt', { frame }); const result = policy.toNative(frame);
        if (result.action === 'drop') { log('peer-wire-dropped', { result }); return; }
        const envelope = { type: 'vscode-capn-rpc-message', sessionId, message: frame };
        log('peer-wire-delivery', { result, envelope });
        const output = postToNative(envelope, origin);
        if (output !== undefined) deny('post-must-be-synchronous');
        policy.confirmPosted(result);
        log('peer-wire-posted', { result });
      } catch (error) { fatal(error, 'peer-send'); }
    },
    receive() {
      if (state === 'stopped') return Promise.reject(new AdmissionError(stopReason));
      if (queue.length) return Promise.resolve(queue.shift());
      if (pending) { fatal(new AdmissionError('multiple-receivers'), 'peer-receive'); return Promise.reject(new AdmissionError('multiple-receivers')); }
      return new Promise((resolve, reject) => { pending = { resolve, reject }; });
    },
    abort() { if (state !== 'stopped') fatal(new AdmissionError('original-rpc-transport-abort'), 'peer-abort'); },
  };
  function acceptEnvelope(value, meta) {
    if (state === 'stopped') { lateDrops++; entry('late-native-envelope-dropped'); return false; }
    try {
      if (meta?.origin !== origin || meta?.source !== ownerWindow) deny('origin-or-window-identity');
      const d = Object.getOwnPropertyDescriptor(value ?? {}, 'type'), isLog = d?.value === 'log-message';
      const message = boundedClone(value, { maxBytes: isLog ? LIMITS.maxDiagnosticBytes : LIMITS.maxWireBytes });
      log('native-envelope-received', { origin: meta.origin, sourceMatches: true, message });
      if (message.type === 'log-message') {
        const classification = policy.classifyWarning(message); log('original-warning-classified', { classification }); return true;
      }
      if (message.type === 'vscode-capn-rpc-connect') {
        counted(); recordValues(message, ['type', 'sessionId']);
        if (state !== 'installed' || sessionId !== null) deny('duplicate-connect');
        if (typeof message.sessionId !== 'string' || !UUID.test(message.sessionId)) deny('session-id');
        sessionId = message.sessionId; state = 'connected'; log('owned-session-bound', { sessionId }); onConnect(transport); return true;
      }
      if (message.type === 'vscode-capn-rpc-message') {
        counted(); recordValues(message, ['type', 'sessionId', 'message']);
        if (state !== 'connected' || message.sessionId !== sessionId) deny('session-identity');
        const frame = message.message, result = policy.fromNative(frame); log('native-wire-admitted', { result });
        if (result.kind === 'native-abort') { stop('native-abort', { fatal: true, detail: { where: 'native-wire' } }); return true; }
        if (result.kind === 'usage-fetch') usageTimer = clock.setTimeout(() => stop('one-read-window-ended'), LIMITS.oneReadMs);
        if (pending) { const { resolve } = pending; pending = null; resolve(frame); }
        else { if (queue.length >= LIMITS.maxQueuedFrames) deny('transport-queue-bound'); queue.push(frame); }
        return true;
      }
      deny('envelope-type-denied');
    } catch (error) { return fatal(error, 'native-envelope'); }
  }
  totalTimer = clock.setTimeout(() => stop('total-bridge-deadline'), LIMITS.totalMs);
  handshakeTimer = clock.setTimeout(() => stop('services-handshake-deadline'), LIMITS.handshakeMs);
  return Object.freeze({
    acceptEnvelope,
    consumeNativeEnvelope(message, meta) {
      if (!claimsEnvelope(message)) return false;
      acceptEnvelope(message, meta); return true;
    },
    claimUsageCallback(...args) { if (state === 'stopped') deny('owner-stopped'); return policy.claimUsageCallback(...args); },
    noteOriginalHandshakeSettled() {
      if (state === 'stopped') return;
      try {
        handshakeSettled = true;
        if (handshakeTimer !== undefined) clock.clearTimeout(handshakeTimer);
        handshakeTimer = undefined; log('original-services-promise-resolved');
      } catch (error) { fatal(error, 'handshake-observation'); }
    },
    noteCleanup(kind, fields = {}) { entry(kind, fields); },
    releaseAuditSink() { auditSinkReleased = true; emit = null; },
    fail(code) { fatal(new AdmissionError(code), 'activation'); },
    stop: reason => stop(reason),
    snapshot: () => primitiveSnapshot({ state, sessionId, firstFatal, stopReason, queueLength: queue.length,
      hasPendingReceiver: pending !== null, transportFrames, ledgerBytes, emittedCount, ledgerFailure, auditSinkReleased,
      lateDrops, handshakeSettled, nativeNegativeConversion: 'not-observed-by-peer', policy: policy.snapshot(), ledger }),
  });
}
