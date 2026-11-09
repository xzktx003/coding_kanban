/**
 * Fixture-only AppHost metadata probe for one captured browser view.
 *
 * The pinned upstream session allocates a positive import ID for each outgoing
 * push/stream/pipe, in transport order, starting at 1. The services result
 * supplies a negative export ID for its settings object. We keep only those
 * scalar IDs in memory and report aggregate fixed-method outcomes. This is a
 * protocol-derived association, not a semantic acknowledgement by the UI.
 * Never retain arguments, results, error messages, credentials or frame bodies.
 * An unobserved frame invalidates every subsequent inferred association.
 */
export function createAccountAppHostProbe({ maxPorts = 16, maxPending = 1000 } = {}) {
  if (!Number.isSafeInteger(maxPorts) || maxPorts < 1 || maxPorts > 32 ||
      !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 4096) {
    throw Error('invalid probe budget');
  }
  const blank = () => ({ started: 0, pulled: 0, resolved: 0, rejected: 0, pending: 0, maxMs: 0 });
  const phase = () => ({ readAll: blank(), read: blank(), write: blank() });
  const stats = { reliable: true, reason: null, servicesResolved: 0, before: phase(), after: phase() };
  const ports = new Map();
  let pending = 0;

  function fail(reason) {
    if (stats.reliable) { stats.reliable = false; stats.reason = reason; }
  }
  function field(v, ref, key) {
    if (!Array.isArray(ref) || ref.length !== 2 || ref[0] !== 'r' ||
        !Number.isSafeInteger(ref[1]) || ref[1] < 0) return undefined;
    const node = v.nodes[ref[1]];
    if (!Array.isArray(node) || !['object', 'array'].includes(node[0]) || !Array.isArray(node[2])) return undefined;
    return node[2].find(x => Array.isArray(x) && x[0] === key)?.[1];
  }
  function arrayLength(v, ref) {
    if (!Array.isArray(ref) || ref[0] !== 'r' || !Number.isSafeInteger(ref[1]) || ref[1] < 0) return -1;
    const node = v.nodes[ref[1]];
    return Array.isArray(node) && node[0] === 'array' && Number.isSafeInteger(node[1]) ? node[1] : -1;
  }

  function observe(direction, v, atPhase, now) {
    if (!stats.reliable) return;
    try {
      if (!['sent', 'received'].includes(direction) || !['before', 'after'].includes(atPhase) ||
          !Number.isFinite(now) || !v || v.format !== 'chatgpt-apphost-wire' || v.version !== 1 ||
          !Array.isArray(v.nodes) || v.nodes.length > 100000) { fail('gap'); return; }
      const get = key => field(v, v.root, key);
      const type = get('type'), port = get('portId');
      if (typeof port !== 'string' || !/^app-host-[1-9][0-9]*$/.test(port)) return;
      if (direction === 'sent' && type === 'openPort' && get('name') === 'app-host') {
        if (ports.has(port)) { fail('protocol'); return; }
        if (ports.size >= maxPorts) { fail('budget'); return; }
        ports.set(port, { next: 1, settings: null, pending: new Map() }); return;
      }
      if ((direction === 'sent' && type === 'closePort') || (direction === 'received' && type === 'portClosed')) {
        const state = ports.get(port);
        if (state?.pending.size) fail('closed');
        if (state) ports.delete(port);
        return;
      }
      if (!((direction === 'sent' && type === 'portPost') ||
            (direction === 'received' && type === 'portMessage'))) return;
      const state = ports.get(port);
      if (!state) { fail('gap'); return; }
      const data = get('data'), op = field(v, data, '0'), ref = field(v, data, '1');
      if (direction === 'sent' && ['push', 'stream', 'pipe'].includes(op)) {
        const id = state.next++;
        if (!Number.isSafeInteger(id)) { fail('budget'); return; }
        if (op !== 'push' || field(v, ref, '0') !== 'pipeline') return;
        const base = field(v, ref, '1'), path = field(v, ref, '2'), pathLength = arrayLength(v, path);
        const name = field(v, path, '0'), args = field(v, ref, '3');
        let kind = null;
        if (base === 0 && pathLength === 1 && name === 'services') kind = 'services';
        else if (state.settings !== null && base === state.settings && pathLength === 1 &&
                 (name === 'readAll' || (['read', 'write'].includes(name) &&
                   field(v, args, '0') === 'conversationDetailMode'))) kind = name;
        if (!kind) return;
        if (pending >= maxPending) { fail('budget'); return; }
        state.pending.set(id, { kind, phase: atPhase, start: now, pulled: false }); pending++;
        if (kind !== 'services') stats[atPhase][kind].started++;
        return;
      }
      if (direction === 'sent' && op === 'pull' && Number.isSafeInteger(ref) && ref >= 0) {
        const item = state.pending.get(ref);
        if (!item) return;
        if (item.pulled) { fail('protocol'); return; }
        item.pulled = true;
        if (item.kind !== 'services') stats[item.phase][item.kind].pulled++;
        return;
      }
      if (direction === 'received' && ['resolve', 'reject'].includes(op) && Number.isSafeInteger(ref) && ref >= 0) {
        const item = state.pending.get(ref);
        if (!item) return;
        if (!item.pulled || now < item.start) { fail('protocol'); return; }
        state.pending.delete(ref); pending--;
        if (item.kind === 'services') {
          if (op !== 'resolve') { fail('services'); return; }
          const value = field(v, data, '2'), settings = field(v, value, 'settings');
          const exported = field(v, settings, '1');
          if (arrayLength(v, settings) !== 2 || field(v, settings, '0') !== 'export' ||
              !Number.isSafeInteger(exported) || exported >= 0 ||
              (state.settings !== null && state.settings !== exported)) {
            fail('services'); return;
          }
          state.settings = exported; stats.servicesResolved++; return;
        }
        const target = stats[item.phase][item.kind];
        target[op === 'resolve' ? 'resolved' : 'rejected']++;
        target.maxMs = Math.max(target.maxMs, now - item.start);
      }
    } catch { fail('gap'); }
  }
  function snapshot() {
    const result = structuredClone(stats);
    for (const state of ports.values()) for (const item of state.pending.values()) {
      if (item.kind !== 'services') result[item.phase][item.kind].pending++;
    }
    if (!result.reliable) for (const which of ['before', 'after']) {
      for (const kind of ['readAll', 'read', 'write']) result[which][kind].pending = null;
    }
    return result;
  }
  return Object.freeze({ observe, gap: () => fail('gap'), snapshot });
}
