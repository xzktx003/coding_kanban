// Display ownership only. Never changes native task ownership, approvals or drafts.
const IDLE_MS = 60_000;
const entries = new Map<
  string,
  {
    consumers: number;
    preparedConsumers: number;
    unusedAt: number;
    dormant: boolean;
    restoreNeeded: boolean;
    reclaimedAt: number;
    lastBytes: number;
  }
>();
const releaseListeners = new Set<(id: string) => void>();
const visibilityListeners = new Set<(id: string) => void>();
const warmListeners = new Set<{
  listener: (id: string) => void;
  accepts: (id: string) => boolean;
}>();

export function trackCodexTranscript(id: string) {
  if (!entries.has(id))
    entries.set(id, {
      consumers: 0,
      preparedConsumers: 0,
      unusedAt: Date.now(),
      dormant: false,
      restoreNeeded: false,
      reclaimedAt: 0,
      lastBytes: 0,
    });
}
export function retainCodexTranscript(id: string) {
  trackCodexTranscript(id);
  const entry = entries.get(id)!;
  entry.consumers++;
  // A visible lifetime may allocate again even if its history read fails.
  // Keep restoration required, but allow that new body to expire on departure.
  entry.dormant = false;
  for (const listener of visibilityListeners) listener(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.consumers === 0) {
      entry.unusedAt = Date.now();
      for (const listener of visibilityListeners) listener(id);
    }
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
export function markCodexTranscriptDormant(id: string, bytes = 0) {
  const entry = entries.get(id);
  if (!entry || entry.consumers) return;
  entry.dormant = true;
  entry.restoreNeeded = true;
  entry.reclaimedAt = Date.now();
  entry.lastBytes = bytes;
  for (const listener of releaseListeners) listener(id);
}
export function isCodexTranscriptDormant(id: string) {
  const entry = entries.get(id);
  return !!entry?.dormant && entry.consumers === 0;
}
export function isCodexTranscriptVisible(id: string) {
  return (entries.get(id)?.consumers ?? 0) > 0;
}
/** Rich renderer commit only; previews and history transport are separate facts. */
export function retainPreparedCodexTranscript(id: string) {
  trackCodexTranscript(id);
  const entry = entries.get(id)!;
  entry.preparedConsumers++;
  for (const listener of visibilityListeners) listener(id);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.preparedConsumers = Math.max(0, entry.preparedConsumers - 1);
    for (const listener of visibilityListeners) listener(id);
  };
}
export function isCodexTranscriptPrepared(id: string) {
  const entry = entries.get(id);
  return !!entry && !entry.dormant && entry.preparedConsumers > 0;
}
export function needsCodexTranscriptRestore(id: string) {
  return entries.get(id)?.restoreNeeded ?? false;
}
export function acknowledgeCodexTranscriptRestore(id: string) {
  const entry = entries.get(id);
  if (entry && !entry.dormant) entry.restoreNeeded = false;
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
export function codexTranscriptRetentionMetadata(id: string) {
  const entry = entries.get(id);
  return entry
    ? {
        visible: entry.consumers > 0,
        lastUsed: entry.unusedAt,
        dormant: entry.dormant,
        reclaimedAt: entry.reclaimedAt,
        lastBytes: entry.lastBytes,
      }
    : undefined;
}
export function onCodexTranscriptVisibilityChanged(
  listener: (id: string) => void,
) {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}
export function onCodexTranscriptWarmRestore(
  listener: (id: string) => void,
  accepts: (id: string) => boolean,
) {
  const registration = { listener, accepts };
  warmListeners.add(registration);
  return () => {
    warmListeners.delete(registration);
  };
}
export function hasCodexTranscriptWarmReader(id: string) {
  return [...warmListeners].some(({ accepts }) => accepts(id));
}
export function requestCodexTranscriptWarmRestore(id: string) {
  const entry = entries.get(id);
  if (!entry?.dormant || entry.consumers) return;
  const readers = [...warmListeners].filter(({ accepts }) => accepts(id));
  // An observed subagent or late retained link can have no followed-page
  // reader. Keep it dormant so unrelated native deltas cannot refill it.
  if (!readers.length) return;
  entry.dormant = false;
  entry.unusedAt = Date.now();
  for (const { listener } of readers) listener(id);
}
