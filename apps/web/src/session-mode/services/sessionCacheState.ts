import type { ServerNotification } from "../bindings";
import type { TurnTiming } from "../components/codex/stores/types";
/** Kept free of store imports to avoid the store -> service -> cache cycle. */
export const cachedTranscriptBaselines = new Map<
  string,
  ServerNotification[]
>();
export const cachedTranscriptTimings = new Map<string, TurnTiming>();
export function cacheInvalidatedAt(key: string) {
  try {
    return Number(
      localStorage.getItem(`kanban.session.transcript-invalidation.${key}`) ??
        0,
    );
  } catch {
    return 0;
  }
}
export function invalidateTranscriptCache(key: string) {
  const id = key.slice(key.indexOf(":") + 1);
  cachedTranscriptBaselines.delete(id);
  cachedTranscriptTimings.delete(id);
  try {
    localStorage.setItem(
      `kanban.session.transcript-invalidation.${key}`,
      String(Date.now()),
    );
  } catch {
    /* Live rollback remains authoritative. */
  }
}
