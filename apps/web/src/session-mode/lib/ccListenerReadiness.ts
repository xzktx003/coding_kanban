export const CC_LISTENER_READY_EVENT = 'cc-session-listener-ready';
export const CC_PERMISSION_LISTENER_READY_EVENT = 'cc-permission-listener-ready';

const listeners = new Map<string, Set<object>>();
const readyListeners = new WeakSet<object>();
const keyFor = (event: string, sessionId: string) => JSON.stringify([event, sessionId]);

/** Readiness belongs to a live subscription, including signals emitted before a waiter mounts. */
export function isCCListenerReady(event: string, sessionId: string): boolean {
  const entries = listeners.get(keyFor(event, sessionId));
  return entries ? [...entries].some((entry) => readyListeners.has(entry)) : false;
}

export function registerCCListener(event: string, sessionId: string) {
  const key = keyFor(event, sessionId);
  const token = {};
  const entries = listeners.get(key) ?? new Set<object>();
  entries.add(token);
  listeners.set(key, entries);
  let closed = false;
  return {
    ready() {
      if (closed) return;
      readyListeners.add(token);
      window.dispatchEvent(new CustomEvent(event, { detail: { sessionId } }));
    },
    close() {
      closed = true;
      readyListeners.delete(token);
      entries.delete(token);
      if (!entries.size) listeners.delete(key);
    },
  };
}
