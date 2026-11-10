// Chromium may expose a stale performance.memory sample. Track incoming display
// bytes as a second pressure signal without keeping events or payload references.
const WINDOW_MS = 5000;
const BURST_BYTES = 16 * 1024 * 1024;
let windowStartedAt = 0;
let incomingBytes = 0;
let pressureUntil = 0;
const listeners = new Set<() => void>();

/** Notify owners once when incoming traffic first crosses the existing budget. */
export function subscribeTranscriptTrafficPressure(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordTranscriptTraffic(bytes: number) {
  const now = Date.now();
  if (now - windowStartedAt >= WINDOW_MS || now < windowStartedAt) {
    windowStartedAt = now;
    incomingBytes = 0;
  }
  incomingBytes += bytes;
  if (incomingBytes >= BURST_BYTES) {
    const wasUnderPressure = now < pressureUntil;
    pressureUntil = now + WINDOW_MS;
    if (!wasUnderPressure) for (const listener of [...listeners]) listener();
  }
}
export function hasTranscriptTrafficPressure() {
  return Date.now() < pressureUntil;
}
