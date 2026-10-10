// Display ownership only. Never changes native task ownership, approvals or drafts.
const IDLE_MS = 60_000;
const entries = new Map<
  string,
  {
    consumers: number;
    unusedAt: number;
    dormant: boolean;
    restoreNeeded: boolean;
  }
>();
const releaseListeners = new Set<(id: string) => void>();

export function trackCodexTranscript(id: string) {
  if (!entries.has(id))
    entries.set(id, {
      consumers: 0,
      unusedAt: Date.now(),
      dormant: false,
      restoreNeeded: false,
    });
}
export function retainCodexTranscript(id: string) {
  trackCodexTranscript(id);
  const entry = entries.get(id)!;
  entry.consumers++;
  // A visible lifetime may allocate again even if its history read fails.
  // Keep restoration required, but allow that new body to expire on departure.
  entry.dormant = false;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.consumers === 0) entry.unusedAt = Date.now();
  };
}
export function expiredCodexTranscripts() {
  const now = Date.now();
  return [...entries]
    .filter(
      ([, e]) => !e.consumers && !e.dormant && now - e.unusedAt >= IDLE_MS,
    )
    .map(([id]) => id);
}
export function markCodexTranscriptDormant(id: string) {
  const entry = entries.get(id);
  if (!entry || entry.consumers) return;
  entry.dormant = true;
  entry.restoreNeeded = true;
  for (const listener of releaseListeners) listener(id);
}
export function isCodexTranscriptDormant(id: string) {
  const entry = entries.get(id);
  return !!entry?.dormant && entry.consumers === 0;
}
export function needsCodexTranscriptRestore(id: string) {
  return entries.get(id)?.restoreNeeded ?? false;
}
export function acknowledgeCodexTranscriptRestore(id: string) {
  const entry = entries.get(id);
  if (entry?.consumers) entry.restoreNeeded = false;
}
export function forgetCodexTranscript(id: string) {
  if (!entries.get(id)?.consumers) entries.delete(id);
}
export function trackedCodexTranscripts() {
  return entries.keys();
}
export function onCodexTranscriptReleased(listener: (id: string) => void) {
  releaseListeners.add(listener);
  return () => {
    releaseListeners.delete(listener);
  };
}
