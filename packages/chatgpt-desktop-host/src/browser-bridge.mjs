import { encodeWireValueDetailed, decodeWireValue, WIRE_DEFAULT_LIMITS } from './wire-value.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const GETTERS = ['getInitialSidebarBootstrap', 'getSentryInitOptions', 'getDesktopUserAgent', 'getAppSessionId', 'getBuildFlavor'];
// The native picker and our browser dialog each bound a user's decision to
// 120 seconds. Give that explicit operation 10 seconds of transport grace.
const PROJECT_FOLDER_TIMEOUT_MS = 130_000;
const SNAPSHOT_HEADER = '{"format":"chatgpt-apphost-wire","version":1,"root":';
const SNAPSHOT_NODES = ',"nodes":[';
const error = (code, message) => Object.assign(new Error(message), { code });
const unknownOutcome = (message, causeKind) => Object.assign(error('BRIDGE_OUTCOME_UNKNOWN', message), { causeKind });
function limit(value, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw error('BRIDGE_INVALID_CONFIG', 'Invalid bridge budget');
  return value;
}
function validScope(scope) {
  return scope && Object.keys(scope).length === 3 && ['profileId', 'generation', 'viewId'].every(k => typeof scope[k] === 'string' && UUID.test(scope[k]));
}
function waitsForProjectFolder(frame) {
  if (frame.type !== 'call' || frame.method !== 'sendMessageFromView' || frame.args.length !== 1) return false;
  try {
    const message = frame.args[0];
    if (!message || typeof message !== 'object') return false;
    const type = Object.getOwnPropertyDescriptor(message, 'type');
    if (!type || !Object.hasOwn(type, 'value')) return false;
    if (type.value === 'electron-pick-workspace-root-option') return true;
    if (type.value !== 'electron-add-new-workspace-root-option') return false;
    const root = Object.getOwnPropertyDescriptor(message, 'root');
    return !root || (Object.hasOwn(root, 'value') && root.value == null);
  } catch { return false; }
}

/**
 * Install the fixed preload facade in a new browser document. The transport is
 * already authenticated and bound to one private native view by the server.
 * It carries only versioned messages, never script text, commands or endpoints.
 * Unsupported native file-path/drag operations report browser capability truthfully.
 */
export function installDesktopBridge({ window: win, scope, bootstrap, transport, contextMenuAdapter, onInternalViewMessage, onFailure = () => {}, maxPending = 64, maxPorts = 16, maxQueuedBytes = 8 * 1024 * 1024, requestTimeoutMs = 10000 }) {
  if (!validScope(scope) || !win || win.electronBridge || !bootstrap || !transport?.send || !transport?.subscribe || (onInternalViewMessage !== undefined && typeof onInternalViewMessage !== 'function')) throw error('BRIDGE_INVALID_CONFIG', 'A new document and fixed native scope are required');
  if (contextMenuAdapter !== undefined && (!contextMenuAdapter || typeof contextMenuAdapter.show !== 'function' || typeof contextMenuAdapter.dispose !== 'function')) throw error('BRIDGE_INVALID_CONFIG', 'Invalid browser menu adapter');
  maxPending = limit(maxPending, 64); maxPorts = limit(maxPorts, 16);
  maxQueuedBytes = limit(maxQueuedBytes, 8 * 1024 * 1024); requestTimeoutMs = limit(requestTimeoutMs, 30000);
  // Raw immutable snapshots remain local until promotion. This fixed pool
  // includes snapshots already promoted to the unchanged 32-write window.
  const portSnapshotBudget = 1024;
  // Preserve room for ordinary calls whenever the old eight-post window had
  // any, while allowing up to 32 outstanding posts under the shared limit.
  const ordinaryReserve = Math.min(8, Math.max(0, maxPending - 8));
  const maxPortPosts = Math.min(32, maxPending - ordinaryReserve);
  scope = Object.freeze({ ...scope });
  const portScopeNode = JSON.stringify(['object', false, Object.entries(scope)]);
  let disposed = false, outgoingSequence = 0, incomingSequence = 0, nextId = 0, nextPort = 0, queuedBytes = 0, sending = false, waitingRequests = 0;
  let retainedPortBytes = 0, inFlightPortPosts = 0, portProduced = 0, portReceived = 0, overlappedPortBytes = 0;
  const portSnapshotCharges = new WeakMap();
  // A snapshot may also appear inside one queued wire frame. Charge that
  // logical input once, and share the same ceiling with deferred native data.
  const heldInputBytes = () => queuedBytes + retainedPortBytes - overlappedPortBytes;
  const waitingPortPosts = [], readyPorts = new Set();
  // The server retains at most eight native outputs until this document has
  // actually forwarded them. Only SDK data is paced; real request receipts
  // remain runnable while the SDK is producing requests faster than native.
  const nativeDataQueue = [], nativeDataOwned = new Set();
  let nativeDataBytes = 0, nativeDataTimer, nativeDataTimerDelay, nativeDataActive, nativeDataCongested = false;
  const setDataTimer = (fn, ms) => (win.setTimeout ?? setTimeout).call(win, fn, ms);
  const clearDataTimer = (id) => (win.clearTimeout ?? clearTimeout).call(win, id);
  const pending = new Map(), ports = new Map(), queue = [], workers = new Map(), themes = new Set(), timeoutRequests = new WeakMap();
  const peakUsage = {rawSnapshots:0,heldLogicalBytes:0,pendingRPC:0,inFlightPortPosts:0,waitingRPC:0};
  const usage = () => ({rawSnapshots:waitingPortPosts.length + inFlightPortPosts,
    heldLogicalBytes:heldInputBytes() + nativeDataBytes,pendingRPC:pending.size,inFlightPortPosts,waitingRPC:waitingRequests});
  function recordUsage() {
    const current = usage();
    for (const key of Object.keys(peakUsage)) peakUsage[key] = Math.max(peakUsage[key], current[key]);
  }
  const shared = new Map(Object.entries(bootstrap.sharedObjects ?? {}));
  let theme = bootstrap.getters?.getSystemThemeVariant ?? 'light', unsubscribe = () => {};
  function stop(reason, report = false) {
    if (disposed) return;
    const timedOutRequest=timeoutRequests.get(reason);
    const diagnostic = report ? Object.freeze({pendingTotal:pending.size,waitingRequests,portPostsInFlight:inFlightPortPosts,waitingPortPosts:waitingPortPosts.length,portCount:ports.size,readyPorts:readyPorts.size,queuedTransportFrames:queue.length,queuedTransportBytes:queuedBytes,retainedPortBytes,overlappedPortBytes,portProduced,portReceived,nativeDeferred:nativeDataOwned.size,nativeDeferredBytes:nativeDataBytes,...(timedOutRequest ? {timedOutRequest} : {})}) : undefined;
    disposed = true; unsubscribe(); win.removeEventListener('message', connectPort);
    try { contextMenuAdapter?.dispose(); } catch { /* Continue releasing native ports even if local UI cleanup fails. */ }
    const unsent = reason?.code === 'BRIDGE_OUTCOME_UNKNOWN' ? error('BRIDGE_NOT_SENT', 'Desktop request was not submitted before its connection ended') : reason;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(call.dispatched ? reason : unsent); }
    for (const call of queue) if (!call.admitted) { clearTimeout(call.timer); call.reject(unsent); }
    if (nativeDataTimer !== undefined) clearDataTimer(nativeDataTimer);
    nativeDataTimer = undefined; nativeDataTimerDelay = undefined;
    for (const entry of nativeDataOwned) entry.reject(reason);
    nativeDataOwned.clear(); nativeDataQueue.length = 0; nativeDataActive = undefined; nativeDataBytes = 0;
    for (const entry of waitingPortPosts) retainedPortBytes -= entry.bytes;
    pending.clear(); queue.length = 0; waitingRequests = 0; waitingPortPosts.length = 0; readyPorts.clear(); queuedBytes = 0; overlappedPortBytes = 0;
    for (const port of ports.values()) port.close(); ports.clear(); workers.clear(); themes.clear(); shared.clear();
    transport.close?.();
    if (report) onFailure(reason, diagnostic);
  }
  async function drain() {
    if (sending || disposed) return;
    sending = true;
    try {
      while (!disposed && queue.length) {
        const entry = queue[0];
        if (!entry.admitted) {
          if (pending.size >= maxPending) break;
          waitingRequests--; entry.admitted = true; pending.set(entry.id, entry); recordUsage();
        }
        queue.shift();
        // Register before calling send: a synchronous/fast response must find
        // its exact request. No encoded FIFO member is skipped or replayed.
        entry.dispatched = true;
        await transport.send(entry.encoded);
        if (!disposed) {
          queuedBytes -= entry.bytes;
          if (entry.snapshotCharge?.overlaps) {
            overlappedPortBytes -= entry.snapshotCharge.bytes;
            entry.snapshotCharge.overlaps = false;
          }
        }
      }
    } catch { stop(unknownOutcome('Connection ended; delivery must be reconciled before another send', 'send_failure'), true); }
    finally { sending = false; }
  }
  function enqueue(frame, call, portSnapshot) {
    if (disposed) throw error('BRIDGE_CLOSED', 'Desktop bridge is closed');
    let encoded, bytes;
    try {
      const seq = ++outgoingSequence;
      if (portSnapshot) {
        if (frame.type !== 'portPost' || frame.portId !== portSnapshot.portId ||
            !Number.isSafeInteger(seq) || !Number.isSafeInteger(frame.id)) throw Error();
        if (portSnapshot.optimized) {
          // The original data snapshot is immutable and already codec-validated.
          // Keep its node indices and append a fresh root and scope, rather than
          // decoding and reconstructing its (possibly multi-megabyte) graph.
          const snapshot = portSnapshot.encoded;
          const split = snapshot.indexOf(SNAPSHOT_NODES, SNAPSHOT_HEADER.length);
          if (!snapshot.startsWith(SNAPSHOT_HEADER) || !snapshot.endsWith(']}') ||
              split < 0 || !Number.isSafeInteger(portSnapshot.nodeCount) ||
              portSnapshot.nodeCount < 0 || portSnapshot.nodeCount > WIRE_DEFAULT_LIMITS.maxNodes) throw Error();
          const count = portSnapshot.nodeCount;
          const root = snapshot.slice(SNAPSHOT_HEADER.length, split);
          const nodes = snapshot.slice(split + SNAPSHOT_NODES.length, -2);
          const rootRef = JSON.stringify(['r', count]);
          const frameStart = '["object",false,[["v",1],["scope",["r",' + (count + 1) +
            ']],["seq",' + seq + '],["type","portPost"],["portId",' + JSON.stringify(frame.portId) + '],["data",';
          const frameEnd = '],["id",' + frame.id + ']]]';
          const extra = rootRef + (count ? ',' : '') + frameStart + frameEnd + ',' + portScopeNode;
          bytes = portSnapshot.bytes + new TextEncoder().encode(extra).length;
          if (bytes > WIRE_DEFAULT_LIMITS.maxEncodedBytes) throw Error();
          encoded = SNAPSHOT_HEADER + rootRef + SNAPSHOT_NODES + nodes + (count ? ',' : '') +
            frameStart + root + frameEnd + ',' + portScopeNode + ']}';
        } else {
          // Near any codec limit retain the original path and its exact errors.
          const result = encodeWireValueDetailed({ v: 1, scope, seq, type: 'portPost', portId: frame.portId,
            data: decodeWireValue(portSnapshot.encoded), id: frame.id });
          encoded = result.encoded; bytes = result.encodedBytes;
        }
      } else {
        const result = encodeWireValueDetailed({ v: 1, scope, seq, ...frame });
        encoded = result.encoded; bytes = result.encodedBytes;
      }
    }
    catch { const failure = error('BRIDGE_UNSUPPORTED_VALUE', 'Desktop message cannot be represented within its budget'); stop(failure, true); throw failure; }
    const snapshotCharge = portSnapshot && portSnapshotCharges.get(portSnapshot);
    const overlap = snapshotCharge?.retained ? snapshotCharge.bytes : 0;
    if (heldInputBytes() + nativeDataBytes + bytes - overlap > maxQueuedBytes) {
      const failure = Object.assign(error('BRIDGE_QUEUE_FULL', 'Desktop transport byte budget exceeded'), { limitKind: 'queued_bytes' }); stop(failure, true); throw failure;
    }
    const admitted = waitingRequests === 0 && pending.size < maxPending;
    if (!admitted && waitingRequests >= 256) {
      const failure = error('BRIDGE_PENDING_LIMIT', 'Desktop waiting request budget exceeded'); stop(failure, true); throw failure;
    }
    const entry = { ...call, id: frame.id, seq: outgoingSequence, type:frame.type, method:frame.type==='call'?frame.method:null, portId: frame.portId, encoded, bytes, snapshotCharge, admitted, dispatched: false };
    if (overlap) { snapshotCharge.overlaps = true; overlappedPortBytes += overlap; }
    if (admitted) pending.set(frame.id, entry); else waitingRequests++;
    queuedBytes += bytes; queue.push(entry); recordUsage(); void drain();
  }
  function request(frame, portSnapshot) {
    if (disposed) return Promise.reject(error('BRIDGE_CLOSED', 'Desktop bridge is closed'));
    // enqueue reserves at most 64 requests in FIFO order. Further requests
    // retain the original 256 encoded-RPC waiting slots. Raw snapshots have
    // their own fixed pool and are not encoded or assigned seq/id until pumped.
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const deadline = waitsForProjectFolder(frame) ? PROJECT_FOLDER_TIMEOUT_MS : requestTimeoutMs;
      const timer = setTimeout(() => {
        const queueAhead=queue.findIndex(entry=>entry.id===id), entry=pending.get(id)??queue[queueAhead];
        const reason=unknownOutcome('Desktop reply timed out; reconcile the original operation before retrying', 'request_timeout');
        // Fixed transport metadata only: never retain arguments, encoded data,
        // port identity, or the original error in the failure snapshot.
        if(entry)timeoutRequests.set(reason,Object.freeze({id:entry.id,seq:entry.seq,type:entry.type,method:entry.method,
          dispatched:entry.dispatched,admitted:entry.admitted,queued:queueAhead>=0,queueAhead:queueAhead>=0?queueAhead:null}));
        stop(reason,true);
      }, deadline);
      try { enqueue({ ...frame, id }, { resolve, reject, timer }, portSnapshot); }
      catch (failure) { clearTimeout(timer); pending.delete(id); reject(failure); }
    });
  }
  const call = (method, ...args) => request({ type: 'call', method, args });
  const fire = (method, ...args) => { void call(method, ...args).catch(() => {}); };
  function pumpPorts() {
    // FIFO delivery, with up to 32 outstanding acknowledgements. Waiting plus
    // in-flight snapshots share the fixed raw pool and original byte budget. Never
    // retry a native write.
    while (!disposed && inFlightPortPosts < maxPortPosts && waitingPortPosts.length && waitingRequests < 256) {
      const index = waitingPortPosts.findIndex(entry => readyPorts.has(entry.portId));
      if (index < 0) break;
      const entry = waitingPortPosts.splice(index, 1)[0];
      const port = ports.get(entry.portId);
      inFlightPortPosts++; recordUsage();
      void request({ type: 'portPost', portId: entry.portId }, entry.snapshot).catch(failure => {
        // A closed port can reject writes already in transit. Its close event
        // is authoritative for that port and must not dispose other ports.
        if (ports.get(entry.portId) === port) stop(failure, true);
      }).finally(() => {
        retainedPortBytes -= entry.bytes;
        const charge = portSnapshotCharges.get(entry.snapshot);
        if (charge) {
          charge.retained = false;
          if (charge.overlaps) {
            if (!disposed) overlappedPortBytes -= charge.bytes;
            charge.overlaps = false;
          }
        }
        inFlightPortPosts--; pumpPorts();
      });
    }
    scheduleNativeData();
  }
  function scheduleNativeData() {
    if (disposed) return;
    if (waitingPortPosts.length >= 16) nativeDataCongested = true;
    else if (waitingPortPosts.length <= 8) nativeDataCongested = false;
    // The eight-slot native reader is shared across owned documents. A partial
    // local window may fill the rest of that reader with another document, so
    // admitted SDK data must retain bounded progress even under input pressure.
    const work = nativeDataActive || nativeDataQueue.length;
    if (!work) {
      if (nativeDataTimer !== undefined) clearDataTimer(nativeDataTimer);
      nativeDataTimer = undefined; nativeDataTimerDelay = undefined;
      return;
    }
    const delay = nativeDataActive ? 0 : nativeDataCongested ? 8 : 0;
    if (nativeDataTimer !== undefined) {
      if (nativeDataTimerDelay === delay) return;
      clearDataTimer(nativeDataTimer);
    }
    nativeDataTimerDelay = delay;
    nativeDataTimer = setDataTimer(flushNativeData, delay);
  }
  function flushNativeData() {
    nativeDataTimer = undefined; nativeDataTimerDelay = undefined;
    if (disposed) return;
    const completedHandoff = nativeDataActive !== undefined;
    if (nativeDataActive) {
      const entry = nativeDataActive; nativeDataActive = undefined;
      nativeDataOwned.delete(entry); nativeDataBytes -= entry.bytes;
      entry.resolve();
    }
    if (waitingPortPosts.length >= 16) nativeDataCongested = true;
    else if (waitingPortPosts.length <= 8) nativeDataCongested = false;
    // Under pressure the zero-delay completion turn only confirms the prior
    // actual port handoff. The next item waits a fresh eight-millisecond tick;
    // this cannot become an unpaced zero-delay producer loop.
    const entry = !nativeDataCongested || !completedHandoff
      ? nativeDataQueue.shift() : undefined;
    if (entry) {
      try {
        if (ports.get(entry.portId) !== entry.port) throw error('BRIDGE_INVALID_MESSAGE', 'Native output port changed');
        entry.port.postMessage(entry.data);
        entry.data = undefined;
        // Confirmation follows a separate event-loop turn, never just the
        // WebSocket callback or enqueueing the local MessagePort operation.
        nativeDataActive = entry;
      } catch (failure) { stop(failure, true); return; }
    }
    scheduleNativeData();
  }
  function deliverNativeData(frame, encoded) {
    const port = ports.get(frame.portId);
    if (!port) throw error('BRIDGE_INVALID_MESSAGE', 'Unknown desktop port');
    const bytes = new TextEncoder().encode(encoded).length;
    if (nativeDataOwned.size >= 8 || heldInputBytes() + nativeDataBytes + bytes > maxQueuedBytes)
      throw Object.assign(error('BRIDGE_QUEUE_FULL', 'Native delivery window exceeded'), { limitKind: nativeDataOwned.size >= 8 ? 'native_output_count' : 'native_output_bytes' });
    let resolve, reject;
    const done = new Promise((yes, no) => { resolve = yes; reject = no; });
    void done.catch(() => {});
    const entry = {portId:frame.portId,port,data:frame.data,bytes,resolve,reject};
    nativeDataOwned.add(entry); nativeDataQueue.push(entry); nativeDataBytes += bytes; recordUsage();
    scheduleNativeData();
    return done;
  }
  function registerPort(port, name, portId) {
    if (ports.size >= maxPorts || ports.has(portId)) throw error('BRIDGE_PORT_LIMIT', 'Desktop port budget exceeded');
    ports.set(portId, port);
    const opened = name ? request({ type: 'openPort', portId, name }) : Promise.resolve();
    void opened.then(() => { if (!disposed && ports.get(portId) === port) { readyPorts.add(portId); pumpPorts(); } })
      .catch(failure => { if (ports.get(portId) === port) stop(failure, true); });
    port.addEventListener('message', event => {
      if (disposed || ports.get(portId) !== port) return;
      portProduced++;
      let snapshot, size;
      try {
        // Reserve precisely the extra nodes, graph depth, and decoded bytes of
        // the fixed frame root + UUID scope. Borderline values use the former
        // codec path so its limit and failure behavior remain authoritative.
        const reserveBytes = 166 + (typeof portId === 'string' ? new TextEncoder().encode(portId).length : 0);
        let result, optimized = typeof portId === 'string';
        try {
          if (!optimized) result = encodeWireValueDetailed(event.data);
          else result = encodeWireValueDetailed(event.data, {
              maxNodes: WIRE_DEFAULT_LIMITS.maxNodes - 10,
              maxDepth: WIRE_DEFAULT_LIMITS.maxDepth - 1,
              maxDecodedBytes: WIRE_DEFAULT_LIMITS.maxDecodedBytes - reserveBytes,
            });
        } catch (failure) {
          if (!optimized || failure?.code !== 'limit') throw failure;
          result = encodeWireValueDetailed(event.data);
          optimized = false;
        }
        size = result.encodedBytes;
        snapshot = Object.freeze({ portId, encoded: result.encoded, nodeCount: result.nodeCount, optimized, bytes: size });
        // Exactly the original standalone snapshot bytes remain charged until
        // the corresponding native acknowledgement or port cleanup.
        if (heldInputBytes() + nativeDataBytes + size > maxQueuedBytes) throw Object.assign(error('BRIDGE_QUEUE_FULL', 'Desktop port producer exceeded its budget'), { limitKind: 'snapshot_bytes' });
        if (waitingPortPosts.length + inFlightPortPosts >= portSnapshotBudget) throw Object.assign(error('BRIDGE_QUEUE_FULL', 'Desktop port producer exceeded its budget'), { limitKind: 'waiting_count' });
        retainedPortBytes += size;
      } catch (failure) { stop(failure, true); return; }
      portSnapshotCharges.set(snapshot, {bytes:size,retained:true,overlaps:false});
      waitingPortPosts.push({ portId, snapshot, bytes: size }); recordUsage(); pumpPorts();
    });
    port.addEventListener('messageerror', () => {
      if (ports.get(portId) === port) stop(error('BRIDGE_INVALID_MESSAGE', 'Invalid desktop port message'), true);
    });
    port.start();
    return opened;
  }
  function connectPort(event) {
    if (event.source !== win || event.data?.type !== 'connect-app-host') return;
    const port = event.data.port;
    if (!port || typeof port.postMessage !== 'function' || typeof port.addEventListener !== 'function') { stop(error('BRIDGE_INVALID_MESSAGE', 'Missing AppHost MessagePort'), true); return; }
    const id = 'app-host-' + ++nextPort;
    try { void registerPort(port, 'app-host', id).catch(failure => { if (ports.get(id) === port) stop(failure, true); }); }
    catch (failure) { port.close(); stop(failure, true); }
  }
  function receive(encoded) {
    if (disposed) return;
    try {
      const frame = decodeWireValue(encoded);
      if (!frame || frame.v !== 1 || !validScope(frame.scope) || !Object.keys(scope).every(k => frame.scope[k] === scope[k]) || frame.seq !== incomingSequence + 1) throw error('BRIDGE_SCOPE_CHANGED', 'Desktop connection identity or sequence changed');
      incomingSequence = frame.seq;
      switch (frame.type) {
        case 'return': case 'throw': {
          const entry = pending.get(frame.id);
          if (!entry || !entry.dispatched) throw error('BRIDGE_INVALID_MESSAGE', 'Unexpected desktop response');
          pending.delete(frame.id); clearTimeout(entry.timer);
          if (frame.type === 'return') entry.resolve(frame.value);
          else entry.reject(error('BRIDGE_NATIVE_ERROR', 'Desktop operation failed'));
          void drain();
          pumpPorts();
          break;
        }
        case 'portMessage': {
          portReceived++;
          return deliverNativeData(frame, encoded);
        }
        case 'portClosed': {
          const port = ports.get(frame.portId);
          if (!port) throw error('BRIDGE_INVALID_MESSAGE', 'Unknown desktop port');
          // Dropping an already encoded member would leave a seq/id hole;
          // forwarding it after authoritative close would violate port scope.
          if (queue.some(entry => entry.portId === frame.portId) || [...nativeDataOwned].some(entry => entry.portId === frame.portId)) {
            stop(unknownOutcome('Desktop port closed before queued handoff; reconcile dispatched operations', 'port_closed_queued'), true);
            break;
          }
          ports.delete(frame.portId); readyPorts.delete(frame.portId);
          for (let index = waitingPortPosts.length - 1; index >= 0; index--) {
            if (waitingPortPosts[index].portId === frame.portId) {
              retainedPortBytes -= waitingPortPosts[index].bytes;
              waitingPortPosts.splice(index, 1);
            }
          }
          port.close(); pumpPorts(); break;
        }
        case 'viewMessage': {
          if (onInternalViewMessage?.(frame.data) === true) break;
          if (frame.data?.type === 'shared-object-updated') {
            if (frame.data.value === undefined) shared.delete(frame.data.key); else shared.set(frame.data.key, frame.data.value);
          }
          win.dispatchEvent(new win.MessageEvent('message', { data: frame.data, source: null })); break;
        }
        case 'theme': {
          if (frame.value !== 'light' && frame.value !== 'dark') throw error('BRIDGE_INVALID_MESSAGE', 'Unknown desktop theme');
          theme = frame.value; for (const listener of themes) listener(); break;
        }
        case 'workerMessage': { for (const listener of workers.get(frame.workerId) ?? []) listener(frame.data); break; }
        case 'gitPort': {
          if (frame.closed) { win.postMessage({ type: 'codex_desktop:git-worker-port', requestId: frame.requestId, closed: true }, win.location.origin); break; }
          const channel = new win.MessageChannel();
          void registerPort(channel.port1, undefined, frame.portId).catch(failure => stop(failure, true));
          win.postMessage({ type: 'codex_desktop:git-worker-port', requestId: frame.requestId, closed: false }, win.location.origin, [channel.port2]); break;
        }
        default: throw error('BRIDGE_INVALID_MESSAGE', 'Unknown desktop message');
      }
    } catch (failure) { stop(failure, true); return false; }
    return !disposed;
  }
  const facade = {
    windowType: bootstrap.windowType,
    getPreloadStartedAtMs: () => win.performance.timeOrigin,
    getSharedObjectSnapshotValue: key => shared.get(key),
    getSystemThemeVariant: () => theme,
    subscribeToSystemThemeVariant: listener => { themes.add(listener); return () => themes.delete(listener); },
    getPathForFile: () => null,
    startFileDrag: () => false,
    isDeviceCheckSupported: () => false,
    isIntelMacBuild: () => false,
    sendMessageFromView: async message => {
      if (message?.type === 'shared-object-set') shared.set(message.key, message.value);
      await call('sendMessageFromView', message);
    },
    startLinkDrag: value => fire('startLinkDrag', value),
    acknowledgeChunkedMessage: (transferId, sequence) => fire('acknowledgeChunkedMessage', transferId, sequence),
    connectGitWorker: value => call('connectGitWorker', value),
    sendWorkerMessageFromView: (worker, message) => call('sendWorkerMessageFromView', worker, message),
    showContextMenu: async (items, position) => {
      if (disposed) throw error('BRIDGE_CLOSED', 'Desktop bridge is closed');
      if (contextMenuAdapter === undefined) return call('showContextMenu', items, position);
      try {
        const result = await contextMenuAdapter.show(items, position);
        if (disposed) throw error('BRIDGE_CLOSED', 'Desktop bridge is closed');
        if (!result || Object.keys(result).length !== 1 || !Object.hasOwn(result, 'id') ||
            (result.id !== null && (typeof result.id !== 'string' || result.id.length > 256))) throw Error();
        return {id:result.id};
      } catch {
        if (disposed) throw error('BRIDGE_CLOSED', 'Desktop bridge is closed');
        throw error('BRIDGE_MENU_UNAVAILABLE', 'Browser context menu is unavailable');
      }
    },
    getFastModeRolloutMetrics: value => call('getFastModeRolloutMetrics', value),
    triggerSentryTestError: () => Promise.reject(error('BRIDGE_UNSUPPORTED_OPERATION', 'Diagnostic crash injection is unavailable')),
    subscribeToWorkerMessages: (worker, listener) => {
      const set = workers.get(worker) ?? new Set();
      if (!set.size) fire('workerSubscribe', worker);
      set.add(listener); workers.set(worker, set);
      return () => { set.delete(listener); if (!set.size && workers.has(worker)) { workers.delete(worker); fire('workerUnsubscribe', worker); } };
    },
  };
  for (const name of GETTERS) facade[name] = () => structuredClone(bootstrap.getters?.[name]);
  Object.defineProperty(win, 'electronBridge', { value: Object.freeze(facade), configurable: false });
  Object.defineProperty(win, 'codexWindowType', { value: bootstrap.windowType, configurable: false });
  win.addEventListener('message', connectPort);
  unsubscribe = transport.subscribe(receive);
  return {
    dispose: () => stop(error('BRIDGE_CLOSED', 'Desktop bridge is closed')),
    // Own host handle only: no SDK facade, protocol, bodies, or identities.
    getResourceUsage: () => Object.freeze({...usage(),peakRawSnapshots:peakUsage.rawSnapshots,
      peakHeldLogicalBytes:peakUsage.heldLogicalBytes,peakPendingRPC:peakUsage.pendingRPC,
      peakInFlightPortPosts:peakUsage.inFlightPortPosts,peakWaitingRPC:peakUsage.waitingRPC,
      portProduced,portReceived,disposed}),
  };
}
