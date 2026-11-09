"use strict";

function assertSafeLaunch(args, env) {
  const forbidden = /^--(?:remote-debugging(?:-[a-z-]+)?|remote-allow-origins|inspect(?:-brk|-port)?|js-flags|disable-web-security|unsafely-treat-insecure-origin-as-secure)(?:=|$)/i;
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || forbidden.test(value))) throw Error('Unsafe runtime switch');
  for (const name of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RENDERER_URL','ELECTRON_RUN_AS_NODE','ELECTRON_EXTRA_LAUNCH_ARGS','LD_PRELOAD','LD_LIBRARY_PATH']) {
    if (env[name]) throw Error('Unsafe inherited runtime environment');
  }
}

function recoveryStatusFrame({message,registry,profileId,generation,provisionalCount,queuedIpcBytes,ready}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!message || Object.keys(message).sort().join(',') !== 'nonce,type,v' || message.v !== 1 ||
      message.type !== 'recoveryStatus' || !uuid.test(message.nonce ?? '') ||
      !uuid.test(profileId ?? '') || !uuid.test(generation ?? '') ||
      !Number.isSafeInteger(provisionalCount) || provisionalCount < 0 || provisionalCount > 16 ||
      !Number.isSafeInteger(queuedIpcBytes) || queuedIpcBytes < 0 || typeof ready !== 'boolean' ||
      typeof registry?.recoveryStatus !== 'function') throw Error('Invalid recovery status query');
  const views = registry.recoveryStatus();
  if (!views || Object.keys(views).sort().join(',') !== 'destroying,live,pending' ||
      ['live','pending','destroying'].some(key => !Number.isSafeInteger(views[key]) || views[key] < 0 || views[key] > 16)) throw Error('Invalid recovery status');
  return {v:1,type:'recoveryStatus',nonce:message.nonce,profileId,generation,
    views:{live:views.live,pending:views.pending,destroying:views.destroying},
    provisional:provisionalCount,pendingOutput:queuedIpcBytes !== 0,ready};
}

/** Owns only windows created for a client; a pending create is cancellable. */
function createViewRegistry({dispose, maxViews = 16}) {
  const live = new Map(), pending = new Map(), destroying = new Map();
  async function create(id, make) {
    if (live.has(id) || pending.has(id) || destroying.has(id) || live.size + pending.size >= maxViews) throw Error("View unavailable");
    let finish;
    const token = {cancelled:false, cleanupError:null, done:new Promise(resolve => { finish = resolve; })};
    pending.set(id,token);
    try {
      let value;
      try { value = await make(); }
      catch (error) {
        if (token.cancelled && error?.code !== 'PRIVATE_CLEANUP_FAILED') return null;
        if (token.cancelled) token.cleanupError = error;
        throw error;
      }
      if (token.cancelled) {
        try { await dispose(value); } catch (error) { token.cleanupError = error; throw error; }
        return null;
      }
      live.set(id,value); return value;
    } finally { pending.delete(id); finish(token.cleanupError); }
  }
  function destroy(id) {
    if (destroying.has(id)) return destroying.get(id);
    const token = pending.get(id);
    if (token) token.cancelled = true;
    const operation = (async () => {
      if (token) { const error = await token.done; if (error) throw error; }
      const value = live.get(id);
      if (value !== undefined) { await dispose(value); if (live.get(id) === value) live.delete(id); }
    })();
    destroying.set(id,operation);
    operation.finally(() => { if (destroying.get(id) === operation) destroying.delete(id); }).catch(() => {});
    return operation;
  }
  function forget(id,value) { if (live.get(id) === value) live.delete(id); }
  function cancelAll() {
    for (const token of pending.values()) token.cancelled = true;
    return Promise.allSettled([...live.keys(),...pending.keys()].map(destroy));
  }
  function recoveryStatus() {
    return Object.freeze({live:live.size,pending:pending.size,destroying:destroying.size});
  }
  return { create, destroy, cancelAll, forget, recoveryStatus, get:id => live.get(id), has:id => live.has(id) };
}
module.exports = {createViewRegistry,assertSafeLaunch,recoveryStatusFrame};
