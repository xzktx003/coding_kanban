/* Fixed companion for an owned app:// document. No client code is evaluated. */
(() => {
  'use strict';
  const control = window.__kanbanOwnedControl;
  const bridge = window.electronBridge;
  if (!control || !bridge) throw Error('Private desktop preload is unavailable');
  const ports = new Map(), workers = new Map();
  const awaiting = [], waiting = [], encoder = new TextEncoder();
  let disposed = false, appHostOpen = false, nextGitPort = 0, awaitingBytes = 0, waitingBytes = 0, pumping = false;
  const methods = new Set(['sendMessageFromView', 'startLinkDrag', 'acknowledgeChunkedMessage',
    'connectGitWorker', 'sendWorkerMessageFromView', 'showContextMenu', 'getFastModeRolloutMetrics']);
  // Bound the IPC backlog before cloning it into the main process. The wire
  // codec performs its own exact encoded/decoded limits after receipt.
  function estimate(root, diagnostic) {
    const fail = (kind, message) => { diagnostic.kind = kind; throw Error(message); };
    const seen = new WeakSet(), stack = [[root,0]];
    let bytes = 0, nodes = 0;
    while (stack.length) {
      const [value,depth] = stack.pop();
      if (++nodes > 1000000 || depth > 128) fail('value_budget', 'Value budget exceeded');
      bytes += 16;
      if (typeof value === 'string') {
        if (value.length > 8 * 1024 * 1024) fail('value_budget', 'String budget exceeded');
        bytes += encoder.encode(value).byteLength;
      } else if (typeof value === 'bigint') {
        const text = String(value); if (text.length > 16384) fail('value_budget', 'BigInt budget exceeded'); bytes += text.length;
      } else if (value && typeof value === 'object' && !seen.has(value)) {
        seen.add(value); bytes += 32;
        const tag = Object.prototype.toString.call(value);
        if (tag === '[object ArrayBuffer]') bytes += value.byteLength;
        else if (ArrayBuffer.isView(value)) stack.push([value.buffer,depth+1]);
        else if (tag === '[object Date]' || tag === '[object RegExp]') bytes += 64;
        else if (tag === '[object Map]') {
          if (bytes + value.size * 32 > 8 * 1024 * 1024) fail('value_budget', 'Map budget exceeded');
          for (const [key,item] of value) stack.push([key,depth+1],[item,depth+1]);
        } else if (tag === '[object Set]') {
          if (bytes + value.size * 16 > 8 * 1024 * 1024) fail('value_budget', 'Set budget exceeded');
          for (const item of value) stack.push([item,depth+1]);
        }
        else if (tag === '[object Object]' || Array.isArray(value)) {
          if (Array.isArray(value)) bytes += value.length * 8;
          if (bytes > 8 * 1024 * 1024) fail('value_budget', 'Array budget exceeded');
          const keys = Reflect.ownKeys(value);
          if (bytes + keys.length * 32 > 8 * 1024 * 1024) fail('value_budget', 'Property budget exceeded');
          for (const key of keys) {
            if (typeof key !== 'string') fail('unsupported_value', 'Unsupported key');
            const descriptor = Object.getOwnPropertyDescriptor(value,key);
            if (!descriptor || !descriptor.enumerable) continue;
            if (!Object.hasOwn(descriptor,'value')) fail('unsupported_value', 'Accessor is unsupported');
            stack.push([key,depth+1],[descriptor.value,depth+1]);
          }
        } else fail('unsupported_value', 'Unsupported value');
      } else if (typeof value === 'symbol' || typeof value === 'function') fail('unsupported_value', 'Unsupported value');
      if (bytes > 8 * 1024 * 1024) fail('value_budget', 'Byte budget exceeded');
    }
    return bytes;
  }
  function overflow(kind) {
    if (disposed) return;
    disposed = true;
    awaiting.length = 0; waiting.length = 0; awaitingBytes = 0; waitingBytes = 0;
    for (const unsubscribe of workers.values()) unsubscribe();
    workers.clear(); for (const port of ports.values()) port.close(); ports.clear();
    control.emit({type:'overflow',kind});
  }
  function pump() {
    if (pumping || disposed) return;
    pumping = true;
    try {
      while (!disposed && awaiting.length < 64 && waiting.length) {
        const entry = waiting.shift(); waitingBytes -= entry.bytes;
        awaiting.push(entry.bytes); awaitingBytes += entry.bytes;
        control.emit(entry.frame);
      }
    } catch { overflow('emit_error'); }
    finally { pumping = false; }
  }
  const emit = frame => {
    if (disposed) return;
    const diagnostic = {kind:'estimate_error'};
    let stage = 'estimate_error';
    try {
      const bytes = estimate(frame, diagnostic);
      // Official producers can emit a synchronous burst before the renderer
      // gets a chance to receive main-process ACKs. Keep the actual IPC window
      // at 64; at most 256 local snapshots wait under the same total byte cap.
      if (waiting.length >= 256) return overflow('awaiting_count');
      if (awaitingBytes + waitingBytes + bytes > 8 * 1024 * 1024) return overflow('awaiting_bytes');
      stage = 'emit_error';
      const snapshot = awaiting.length >= 64 || waiting.length || pumping ? structuredClone(frame) : frame;
      waiting.push({frame:snapshot,bytes}); waitingBytes += bytes; pump();
    } catch { overflow(stage === 'estimate_error' ? diagnostic.kind : stage); }
  };
  function attachPort(id, port) {
    if (ports.size >= 16 || ports.has(id)) throw Error('Port budget exceeded');
    ports.set(id, port);
    port.addEventListener('message', event => emit({type:'portMessage', portId:id, data:event.data}));
    port.addEventListener('messageerror', () => { port.close(); ports.delete(id); emit({type:'portClosed', portId:id}); });
    port.addEventListener('close', () => { if (ports.get(id) === port) { ports.delete(id); emit({type:'portClosed',portId:id}); } });
    port.start();
  }
  const onMessage = event => {
    if (disposed) return;
    if (event.source === window && event.data?.type === 'codex_desktop:git-worker-port') {
      const {requestId, closed} = event.data;
      if (closed) { emit({type:'gitPort', requestId, closed:true}); return; }
      const port = event.ports?.[0];
      if (!port) return;
      const portId = 'git-' + ++nextGitPort;
      try { attachPort(portId,port); emit({type:'gitPort', requestId, portId, closed:false}); }
      catch { port.close(); }
    } else if (event.source === null && event.data !== undefined) {
      emit({type:'viewMessage', data:event.data});
    }
  };
  window.addEventListener('message', onMessage);
  const stopTheme = bridge.subscribeToSystemThemeVariant?.(() => emit({type:'theme', value:bridge.getSystemThemeVariant()}));
  control.subscribe(async frame => {
    if (disposed) return;
    if (frame?.type === 'ack') {
      if (!awaiting.length) return overflow('unexpected_ack');
      awaitingBytes -= awaiting.shift(); pump(); return;
    }
    if (frame?.type === 'dispose') {
      disposed = true; stopTheme?.();
      awaiting.length = 0; waiting.length = 0; awaitingBytes = 0; waitingBytes = 0;
      for (const unsubscribe of workers.values()) unsubscribe();
      workers.clear(); for (const port of ports.values()) port.close(); ports.clear();
      window.removeEventListener?.('message', onMessage); return;
    }
    try {
      if (!frame || !Number.isSafeInteger(frame.id) || frame.id < 1) throw Error('Invalid request');
      let value;
      if (frame.type === 'call') {
        if (!Array.isArray(frame.args) || frame.args.length > 8) throw Error('Invalid arguments');
        if (frame.method === 'workerSubscribe') {
          const worker = frame.args[0];
          if (typeof worker !== 'string' || worker.length < 1 || worker.length > 128 || /[\x00-\x1f\x7f]/.test(worker) || workers.has(worker)) throw Error('Invalid worker');
          workers.set(worker, bridge.subscribeToWorkerMessages(worker, data => emit({type:'workerMessage',workerId:worker,data})));
        } else if (frame.method === 'workerUnsubscribe') {
          const worker = frame.args[0], unsubscribe = workers.get(worker);
          if (unsubscribe) { workers.delete(worker); unsubscribe(); }
        } else {
          if (!methods.has(frame.method) || typeof bridge[frame.method] !== 'function') throw Error('Unsupported desktop operation');
          value = await bridge[frame.method](...frame.args);
        }
      } else if (frame.type === 'openPort') {
        if (frame.name !== 'app-host' || appHostOpen || typeof frame.portId !== 'string' || !/^app-host-[1-9][0-9]*$/.test(frame.portId)) throw Error('Invalid AppHost port');
        const pair = new MessageChannel();
        try {
          window.postMessage({type:'connect-app-host', port:pair.port2},window.location.origin,[pair.port2]);
          window.postMessage({type:'kanban-owned:app-host-port',id:frame.id,portId:frame.portId},window.location.origin,[pair.port1]);
          appHostOpen = true;
          return; // The main process acknowledges only after it owns port1.
        } catch (error) { pair.port1.close(); pair.port2.close(); throw error; }
      } else if (frame.type === 'portPost') {
        const port = ports.get(frame.portId);
        if (!port) throw Error('Unknown port');
        port.postMessage(frame.data);
      } else if (frame.type === 'closePort') {
        const port = ports.get(frame.portId);
        if (!port) throw Error('Unknown port');
        ports.delete(frame.portId); port.close();
      } else throw Error('Unsupported frame');
      emit({type:'return',id:frame.id,value});
    } catch { emit({type:'throw',id:frame?.id}); }
  });
})();
