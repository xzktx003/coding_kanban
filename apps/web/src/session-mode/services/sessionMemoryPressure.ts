// Chromium may expose a stale performance.memory sample. Track incoming display
// bytes as a second pressure signal without keeping events or payload references.
const WINDOW_MS = 5000;
const BURST_BYTES = 16 * 1024 * 1024;
let windowStartedAt = 0;
let incomingBytes = 0;
let pressureUntil = 0;
export function recordTranscriptTraffic(bytes: number) {
  const now = Date.now();
  if (now - windowStartedAt >= WINDOW_MS || now < windowStartedAt) {
    windowStartedAt = now;
    incomingBytes = 0;
  }
  incomingBytes += bytes;
  if (incomingBytes >= BURST_BYTES) pressureUntil = now + WINDOW_MS;
}
export function hasTranscriptTrafficPressure() {
  return Date.now() < pressureUntil;
}
