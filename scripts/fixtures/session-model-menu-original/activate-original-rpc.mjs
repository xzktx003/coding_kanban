// PREPARATION ONLY: no original package is imported or initialized at module load.
// Calling activateOriginalRpcPeer requires a later, explicit execution authorization.
import { AdmissionError, deny, primitiveSnapshot, SYNTHETIC_STATUS_TEXT } from './admission.mjs';
import { assertExecutionPermit, assertOriginalAssetDeclaration } from './activation-contract.mjs';
import { claimsEnvelope, createOwnedTransport } from './owned-transport.mjs';
import { HOST_LF_SOURCE, HOST_EK_SOURCE, HOST_WYE_SOURCE, EXPECTED_FUNCTION_SHA256 } from './original-component-sources.mjs';

const usedPages = new WeakSet();
async function assertOriginalFunction(fn, expectedHash) {
  if (typeof fn !== 'function' || !globalThis.crypto?.subtle) deny('original-function-or-crypto');
  const bytes = new TextEncoder().encode(Function.prototype.toString.call(fn));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedHash) deny('original-function-hash');
}
function compileOriginalHostBodies(targetBase) {
  // Exact Host bodies; the sole external ut is explicitly rebound to the SAME Core.jst RPC runtime.
  // The Host ESM, extension APIs, SDK, auth and actual HTTP callback are never imported here.
  return new Function('ut', `"use strict";let lF,Ek;\n${HOST_WYE_SOURCE}\n${HOST_LF_SOURCE};\n${HOST_EK_SOURCE};\nreturn {holder:lF,http:Ek};`)(targetBase);
}

export async function activateOriginalRpcPeer(options) {
  const permit = assertExecutionPermit(options.executionPermit);
  const assets = assertOriginalAssetDeclaration(options.originalAssetHashes);
  let { Core, Native, ownerWindow, origin, postToNative, registerNativeEnvelopeHandler, emit, onStop = () => {}, clock } = options;
  if (ownerWindow !== globalThis.window || origin !== globalThis.location?.origin ||
    typeof registerNativeEnvelopeHandler !== 'function' || typeof emit !== 'function' || typeof onStop !== 'function' ||
    typeof postToNative !== 'function' || typeof Core?.Nst !== 'function' || typeof Native?.q5t !== 'function' ||
    typeof Native?.J5t !== 'function' || typeof globalThis.Response !== 'function' ||
    !Function.prototype.toString.call(globalThis.Response).includes('[native code]')) deny('activation-binding');
  if (usedPages.has(ownerWindow)) deny('page-already-used');
  if (Native.K5t !== undefined || Native.G5t !== undefined) deny('native-services-already-initialized');
  usedPages.add(ownerWindow);
  const observation = {
    authorizationId: permit.authorizationId, originalAssetsDeclared: assets,
    coreInitializerCalled: false, nativeInitializerCalled: false, hostBodiesCompiled: false,
    originalPeerConstructed: false, nativeHandshakeInvoked: false, nativeHandshakeResolved: false,
    nativeHandshakeRejected: false, nativeServicesShapeObserved: false,
    callbackCount: 0, syntheticResponseConstructed: false,
    nativeNegativeConversion: 'not-observed-by-peer', originalPollingModified: false,
    reverseServicesReadOrCalled: false, cleanupStarted: false, cleanupComplete: false,
    cleanupErrors: [], lateHandshakeSettlements: 0, tombstoneInstalled: false, tombstoneReleased: false,
  };
  let bridge, adapter, holder, peer, peerMain, nativeHandshake, unregister, disposed = false, responseCtor = Response;
  function recordCleanupError(where, error) {
    const record = { where, name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1024) };
    observation.cleanupErrors.push(record); bridge?.noteCleanup('original-cleanup-error', record);
  }
  function disposeOriginal(reason) {
    if (disposed) return;
    disposed = true; observation.cleanupStarted = true;
    const disposeOne = (label, target) => {
      try {
        const disposer = target?.[Symbol.dispose];
        bridge?.noteCleanup('original-dispose-attempt', { label, hasDisposer: typeof disposer === 'function' });
        if (typeof disposer === 'function') disposer.call(target);
      } catch (error) { recordCleanupError(label, error); }
    };
    // Keep the dispatcher installed until the owned native and peer teardown has finished.
    disposeOne('native-services-value', Native?.K5t);
    disposeOne('native-main-stub', Native?.G5t);
    disposeOne('peer-main-stub', peerMain);
    disposeOne('original-http-adapter', adapter);
    // A bounded tombstone stays installed: already scheduled original microtasks may still post.
    // No original objects, ownerWindow, audit callback or timers are retained by its stopped transport.
    adapter = holder = peer = peerMain = responseCtor = null;
    observation.cleanupComplete = true;
    bridge?.noteCleanup('original-cleanup-complete', { reason });
    Core = Native = ownerWindow = postToNative = registerNativeEnvelopeHandler = emit = null;
  }
  bridge = createOwnedTransport({ origin, ownerWindow, postToNative, emit, clock,
    onConnect(transport) {
      if (disposed || peer !== undefined) deny('peer-connect-lifetime');
      peer = new Core.kst(transport, holder);
      peerMain = peer.getRemoteMain(); // Retained ONLY for Symbol.dispose; no reverse service getter is read.
      observation.originalPeerConstructed = true;
    },
    onStop(detail) {
      disposeOriginal(detail.reason);
      const notify = onStop; onStop = null;
      try {
        if (notify?.({ ...detail, cleanupComplete: observation.cleanupComplete }) !== undefined)
          recordCleanupError('owner-stop-callback', new AdmissionError('owner-stop-must-be-synchronous'));
      } catch (error) { recordCleanupError('owner-stop-callback', error); }
      finally { bridge?.releaseAuditSink(); }
    },
  });
  // Bound to the one same-page prelude callback, not a general MessageEvent listener or external host.
  const consumeNativeEnvelope = message => {
    return bridge.consumeNativeEnvelope(message, { origin, source: ownerWindow });
  };
  const snapshot = () => primitiveSnapshot({ ...observation, disposed, peer: bridge.snapshot() });
  const dispose = (reason = 'owner-disposed') => { bridge.stop(reason); disposeOriginal(reason); };
  const releaseTombstone = () => {
    if (!disposed || !observation.cleanupComplete) deny('tombstone-release-before-dispose');
    if (observation.tombstoneReleased) return;
    try { unregister?.(); } catch (error) { recordCleanupError('dispatcher-unregister', error); throw error; }
    unregister = null; observation.tombstoneInstalled = false; observation.tombstoneReleased = true;
  };
  try {
    Core.Nst(); observation.coreInitializerCalled = true;
    await assertOriginalFunction(Core.kst, EXPECTED_FUNCTION_SHA256['Core.kst']);
    await assertOriginalFunction(Core.jst, EXPECTED_FUNCTION_SHA256['Core.jst']);
    await assertOriginalFunction(Native.J5t, EXPECTED_FUNCTION_SHA256['Native.J5t']);
    if (disposed) deny('activation-ended-during-verification');
    Native.q5t(); observation.nativeInitializerCalled = true;
    const original = compileOriginalHostBodies(Core.jst); observation.hostBodiesCompiled = true;
    adapter = new original.http((requestId, request, signal, uploadProgress) => {
      try {
        bridge.claimUsageCallback(requestId, request, signal, uploadProgress);
        observation.callbackCount++;
        bridge.noteCleanup('usage-callback-claimed', { requestId, callbackCount: observation.callbackCount });
        const response = new responseCtor(null, { status: 401, statusText: SYNTHETIC_STATUS_TEXT });
        observation.syntheticResponseConstructed = true;
        return { response };
      } catch (error) {
        bridge.fail(error instanceof AdmissionError ? error.code : 'synthetic-response-construction');
        throw error;
      }
    });
    holder = new original.holder(Object.freeze({ httpFetch: adapter }));
    unregister = registerNativeEnvelopeHandler({ claims: claimsEnvelope, accept: consumeNativeEnvelope });
    if (typeof unregister !== 'function') deny('dispatcher-unregister-required');
    observation.tombstoneInstalled = true;
    bridge.noteCleanup('original-components-initialized', {
      originalCore: true, originalNativeHandshake: true, originalHostBodies: true,
      externalTargetBinding: 'Host.ut = same-page original Core.jst',
      soleSyntheticCapability: 'httpFetch.fetch GET /wham/usage -> explicit zero-body Response401',
    });
    observation.nativeHandshakeInvoked = true;
    nativeHandshake = Native.J5t();
    if (!(nativeHandshake instanceof Promise)) deny('original-handshake-promise');
    nativeHandshake.then(() => {
      if (disposed) { observation.lateHandshakeSettlements++; return; }
      observation.nativeHandshakeResolved = true;
      const services = Native.K5t, keys = services && Object.keys(services);
      const value = services && Object.getOwnPropertyDescriptor(services, 'httpFetch');
      observation.nativeServicesShapeObserved = !!(keys?.length === 1 && keys[0] === 'httpFetch' &&
        value && Object.hasOwn(value, 'value') && value.value !== null && ['object', 'function'].includes(typeof value.value));
      if (!observation.nativeServicesShapeObserved) { bridge.fail('native-services-result-shape'); return; }
      bridge.noteOriginalHandshakeSettled();
    }, error => {
      if (disposed) { observation.lateHandshakeSettlements++; return; }
      observation.nativeHandshakeRejected = true;
      bridge.noteCleanup('original-handshake-rejected', { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1024) });
      bridge.fail('original-handshake-rejected');
    }).catch(error => {
      if (!disposed) {
        bridge.noteCleanup('original-handshake-observer-error', { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 1024) });
        bridge.fail('original-handshake-observer-error');
      }
    });
    return Object.freeze({ handshake: nativeHandshake, consumeNativeEnvelope, snapshot, dispose, releaseTombstone });
  } catch (error) {
    bridge.fail(error instanceof AdmissionError ? error.code : 'original-activation-error');
    disposeOriginal('activation-failed');
    // Primitive evidence is also synchronously emitted before this rejection reaches the caller.
    throw error;
  }
}
