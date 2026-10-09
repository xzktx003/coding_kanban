import type { ServerNotification } from "../bindings";
import type { Thread } from "../bindings/v2";
import type { CCMessage } from "../components/cc/types/messages";
import { useCodexStore } from "../components/codex/stores";
import { isIgnoredTranscriptEvent } from "../components/codex/stores/eventUtils";
import { useCCStore } from "../stores/cc";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { openedSessions } from "./openedSessions";
import {
  cachedTranscriptBaselines,
  cachedTranscriptTimings,
  cacheInvalidatedAt,
} from "./sessionCacheState";

export interface ReadingPosition {
  atBottom: boolean;
  anchor?: string;
  offset: number;
  scrollTop: number;
  format?: "row";
}
export interface TranscriptCache {
  key: string;
  savedAt: number;
  events?: ServerNotification[];
  messages?: CCMessage[];
  thread?: Thread;
  cursor?: string | null;
  bytes?: number;
}
const DB = "kanban.session.transcripts.v1";
const MAX_RECORD_BYTES = 2 * 1024 * 1024,
  MAX_TOTAL_BYTES = 30 * 1024 * 1024;
let database: Promise<IDBDatabase | null> | undefined;
function open() {
  if (!database)
    database = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("transcripts"))
          request.result.createObjectStore("transcripts", { keyPath: "key" });
        if (!request.result.objectStoreNames.contains("budget"))
          request.result.createObjectStore("budget", { keyPath: "key" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  return database;
}
function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readTranscriptCache(
  key: string,
): Promise<TranscriptCache | undefined> {
  try {
    const db = await open();
    if (!db) return;
    const cached = (await requestResult(
      db.transaction("transcripts").objectStore("transcripts").get(key),
    )) as TranscriptCache | undefined;
    if (
      cached?.key === key &&
      Number.isFinite(cached.savedAt) &&
      cached.savedAt > cacheInvalidatedAt(key) &&
      (Array.isArray(cached.events) || Array.isArray(cached.messages))
    ) {
      if (cached.events?.some(isIgnoredTranscriptEvent))
        return {
          ...cached,
          events: cached.events.filter(
            (event) => !isIgnoredTranscriptEvent(event),
          ),
        };
      return cached;
    }
  } catch {
    /* Cache failure never blocks a live conversation. */
  }
}
export async function writeTranscriptCache(source: TranscriptCache) {
  try {
    const db = await open();
    if (!db) return;
    if (source.savedAt <= cacheInvalidatedAt(source.key)) return;
    // Keep a recent window, without duplicating full item bodies in turn boundaries.
    const events = source.events
      ?.filter((event) => !isIgnoredTranscriptEvent(event))
      ?.slice(-600)
      .map((event) =>
        event.method === "turn/completed" || event.method === "turn/started"
          ? ({
              ...event,
              params: {
                ...event.params,
                turn: { ...event.params.turn, items: [] },
              },
            } as ServerNotification)
          : event,
      );
    const record: TranscriptCache = {
      ...source,
      events,
      messages: source.messages
        ?.filter((m) => ["user", "assistant", "result"].includes(m.type))
        .slice(-200),
      ...(source.thread
        ? {
            thread: {
              ...source.thread,
              turns: [],
              status: { type: "notLoaded" },
            },
          }
        : {}),
    };
    const size = () =>
      new TextEncoder().encode(JSON.stringify(record)).byteLength;
    const limit = Math.min(
      MAX_RECORD_BYTES,
      Math.floor(MAX_TOTAL_BYTES / Math.max(1, openedSessions().length)),
    );
    while (
      size() > limit &&
      (record.events?.length ?? 0) + (record.messages?.length ?? 0) > 1
    ) {
      if (record.events?.length)
        record.events.splice(
          0,
          Math.max(1, Math.floor(record.events.length / 4)),
        );
      else if (record.messages?.length)
        record.messages.splice(
          0,
          Math.max(1, Math.floor(record.messages.length / 4)),
        );
    }
    record.bytes = size();
    if (record.bytes > limit) return;
    const tx = db.transaction(["transcripts", "budget"], "readwrite"),
      store = tx.objectStore("transcripts"),
      budget = tx.objectStore("budget");
    const existing = (await requestResult(budget.get(source.key))) as
      | TranscriptCache
      | undefined;
    if (existing && existing.savedAt > source.savedAt) return;
    store.put(record);
    budget.put({
      key: record.key,
      savedAt: record.savedAt,
      bytes: record.bytes,
    });
    const all = (await requestResult(budget.getAll())) as TranscriptCache[];
    let total = all.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
    for (const entry of all.sort((a, b) => a.savedAt - b.savedAt)) {
      if (total <= MAX_TOTAL_BYTES) break;
      if (entry.key === record.key) continue;
      store.delete(entry.key);
      budget.delete(entry.key);
      total -= entry.bytes ?? 0;
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Quota/private mode is best effort; network state is unchanged. */
  }
}
export function getReadingPosition(key: string): ReadingPosition | undefined {
  try {
    const value = JSON.parse(
      localStorage.getItem(`kanban.session.read-position.${key}`) ?? "null",
    );
    if (
      value &&
      typeof value.atBottom === "boolean" &&
      Number.isFinite(value.offset) &&
      Number.isFinite(value.scrollTop)
    )
      return value;
  } catch {
    /* Invalid or unavailable device storage. */
  }
}
export function saveReadingPosition(key: string, position: ReadingPosition) {
  try {
    localStorage.setItem(
      `kanban.session.read-position.${key}`,
      JSON.stringify(position),
    );
  } catch {
    /* Keep in-memory reading position. */
  }
}

/** Hydrates only display data. Pending requests/ownership/runtime status are never cached. */
export function startSessionTranscriptCache() {
  let stopped = false;
  const restoring = new Set<string>();
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const codex = useCodexStore.getState(),
      cc = useCCStore.getState();
    for (const key of dirty) {
      const id = key.slice(key.indexOf(":") + 1);
      const record: TranscriptCache = { key, savedAt: Date.now() };
      if (key.startsWith("codex:")) {
        record.events = codex.events[id];
        record.thread = codex.threads.find((t) => t.id === id);
        record.cursor = useSessionSyncStore.getState().cursors[id];
      } else record.messages = cc.sessionMessagesMap[id];
      if (record.events || record.messages) void writeTranscriptCache(record);
    }
    dirty.clear();
  }
  function changed(
    kind: "codex" | "cc",
    next: Record<string, unknown>,
    prev: Record<string, unknown>,
  ) {
    for (const card of openedSessions())
      if (card.kind === kind && next[card.id] !== prev[card.id])
        dirty.add(`${card.kind}:${card.id}`);
    if (dirty.size && !timer) timer = setTimeout(flush, 500);
  }
  async function restore() {
    for (const card of openedSessions()) {
      const key = `${card.kind}:${card.id}`;
      if (restoring.has(key)) continue;
      restoring.add(key);
      const before =
        card.kind === "codex"
          ? useCodexStore.getState().events[card.id]
          : useCCStore.getState().sessionMessagesMap[card.id];
      const cached = await readTranscriptCache(key);
      if (
        stopped ||
        !cached ||
        !openedSessions().some((c) => c.kind === card.kind && c.id === card.id)
      )
        continue;
      if (
        card.kind === "codex" &&
        cached.events &&
        useCodexStore.getState().events[card.id] === before &&
        !useCodexStore.getState().historyLoadedMap[card.id]
      ) {
        cachedTranscriptBaselines.set(card.id, cached.events);
        const boundary = [...cached.events]
          .reverse()
          .find(
            (e) => e.method === "turn/completed" || e.method === "turn/started",
          );
        if (
          boundary &&
          (boundary.method === "turn/completed" ||
            boundary.method === "turn/started")
        ) {
          const turn = boundary.params.turn;
          cachedTranscriptTimings.set(card.id, {
            turnId: turn.id,
            status: turn.status,
            startedAtMs: (turn.startedAt ?? 0) * 1000,
            durationMs: turn.durationMs,
          });
        }
        useCodexStore.setState((s) => ({
          events: { ...s.events, [card.id]: cached.events! },
          historyLoadedMap: { ...s.historyLoadedMap, [card.id]: true },
          activeThreadIds: s.activeThreadIds.includes(card.id)
            ? s.activeThreadIds
            : [...s.activeThreadIds, card.id],
          ...(cached.thread && !s.threads.some((t) => t.id === card.id)
            ? { threads: [...s.threads, cached.thread] }
            : {}),
        }));
        useSessionSyncStore.setState((s) => ({
          cursors: { ...s.cursors, [card.id]: cached.cursor ?? null },
        }));
      } else if (
        card.kind === "cc" &&
        cached.messages &&
        useCCStore.getState().sessionMessagesMap[card.id] === before
      ) {
        useCCStore.setState((s) => ({
          sessionMessagesMap: {
            ...s.sessionMessagesMap,
            [card.id]: cached.messages!,
          },
          ...(s.activeSessionId === card.id
            ? { messages: cached.messages }
            : {}),
        }));
      }
    }
  }
  const stopCodex = useCodexStore.subscribe((next, prev) => {
    if (next.events !== prev.events) changed("codex", next.events, prev.events);
  });
  const stopCC = useCCStore.subscribe((next, prev) => {
    if (next.sessionMessagesMap !== prev.sessionMessagesMap)
      changed("cc", next.sessionMessagesMap, prev.sessionMessagesMap);
  });
  const stopMembers = useAgentCenterStore.subscribe((next, prev) => {
    if (next.cards !== prev.cards || next.detachedCard !== prev.detachedCard)
      void restore();
  });
  window.addEventListener("pagehide", flush);
  void restore();
  return () => {
    stopped = true;
    flush();
    stopCodex();
    stopCC();
    stopMembers();
    window.removeEventListener("pagehide", flush);
  };
}
