// Warm bodies share the governor's existing 16 MiB low water mark. This is not
// another cache allowance: visible bodies are charged before background pages.
export const WARM_TRANSCRIPT_MAX_BYTES = 16 * 1024 * 1024;
export const WARM_TRANSCRIPT_RESTORE_BYTES = WARM_TRANSCRIPT_MAX_BYTES * 0.75;
export const WARM_TRANSCRIPT_RESTORE_COOLDOWN_MS = 60_000;

export interface WarmTranscriptCandidate {
  id: string;
  bytes: number;
  lastUsed: number;
  visible: boolean;
  expired: boolean;
  blocked: boolean;
  dormant: boolean;
  reclaimedAt: number;
  lastBytes?: number;
}

/** Metadata-only admission. No event arrays, closures or native authority live here. */
export function planWarmTranscriptRetention(
  candidates: WarmTranscriptCandidate[],
  options: { now: number; pressure?: boolean; warm?: boolean },
) {
  let bytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  const evict: string[] = [];
  const warm: string[] = [];
  for (const entry of candidates
    .filter(
      (entry) =>
        !entry.visible && !entry.dormant && entry.expired && !entry.blocked,
    )
    .sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (
      options.warm !== false &&
      !options.pressure &&
      bytes <= WARM_TRANSCRIPT_MAX_BYTES
    )
      break;
    evict.push(entry.id);
    bytes -= entry.bytes;
  }
  if (
    options.warm === false ||
    options.pressure ||
    bytes > WARM_TRANSCRIPT_RESTORE_BYTES
  )
    return { evict, warm };
  for (const entry of candidates
    .filter(
      (entry) =>
        entry.dormant &&
        !entry.visible &&
        !entry.blocked &&
        options.now - entry.reclaimedAt >= WARM_TRANSCRIPT_RESTORE_COOLDOWN_MS,
    )
    .sort((a, b) => b.lastUsed - a.lastUsed)) {
    // A reclaimed page may have grown remotely. Admission reserves its previous
    // size (at least 64 KiB); the real result still passes normal byte limits.
    const forecast = Math.max(64 * 1024, entry.lastBytes ?? 0);
    if (bytes + forecast > WARM_TRANSCRIPT_RESTORE_BYTES) continue;
    bytes += forecast;
    warm.push(entry.id);
    // Recheck the measured body before admitting the next reclaimed page.
    // Remote growth must not make dozens of small stale forecasts a burst.
    break;
  }
  return { evict, warm };
}
