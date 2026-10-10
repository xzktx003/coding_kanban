import { withoutToolTranscriptEvents } from "./codexTranscriptVisibility";
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
  compactCodexTranscript,
  estimateTranscriptBytes,
} from "./codexTranscriptMemoryBudget";
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
const CACHE_RECORD_EVENT_LIMIT = 600;
const CACHE_RECORD_MESSAGE_LIMIT = 200;
const CACHE_RECORD_TOOL_TEXT_LIMIT = 16 * 1024;
const CACHE_RECORD_ACTIVE_TOOL_GROUPS = 64;
const CACHE_RECORD_ESTIMATE_RATIO = 0.85;
let database: Promise<IDBDatabase | null> | undefined;
const textEncoder = new TextEncoder();
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
      if (cached.events)
        return {
          ...cached,
          ...(cached.thread ? { thread: { ...cached.thread, turns: [] } } : {}),
          events: withoutToolTranscriptEvents(cached.events).filter(
            (event) => !isIgnoredTranscriptEvent(event),
          ),
        };
      return cached;
    }
  } catch {
    /* Cache failure never blocks a live conversation. */
  }
}

type PendingWrite = {
  record: TranscriptCache;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type WriteState = {
  running?: Promise<void>;
  pending?: PendingWrite;
};
const transcriptWrites = new Map<string, WriteState>();

function pendingWrite(record: TranscriptCache): PendingWrite {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { record, promise, resolve, reject };
}

export function writeTranscriptCache(source: TranscriptCache): Promise<void> {
  if (source.savedAt <= cacheInvalidatedAt(source.key))
    return Promise.resolve();
  const limit = cacheRecordLimit();
  const record = buildCacheRecord(source, limit);
  if (!record) return Promise.resolve();
  const state = transcriptWrites.get(record.key) ?? {};
  transcriptWrites.set(record.key, state);
  if (state.running) {
    if (state.pending) {
      state.pending.record = record;
      return state.pending.promise;
    }
    state.pending = pendingWrite(record);
    return state.pending.promise;
  }
  state.running = drainTranscriptWrites(record.key, state, record);
  return state.running;
}

async function drainTranscriptWrites(
  key: string,
  state: WriteState,
  record: TranscriptCache,
) {
  let current = record;
  let pending: PendingWrite | undefined;
  for (;;) {
    try {
      await writeTranscriptCacheNow(current);
      pending?.resolve();
    } catch (error) {
      pending?.reject(error);
    }
    pending = state.pending;
    if (!pending) {
      state.running = undefined;
      transcriptWrites.delete(key);
      return;
    }
    state.pending = undefined;
    current = pending.record;
    if (current.key !== key) return;
  }
}

function cacheRecordLimit() {
  return Math.min(
    MAX_RECORD_BYTES,
    Math.floor(MAX_TOTAL_BYTES / Math.max(1, openedSessions().length)),
  );
}

function stripTurnItemBodies(events: ServerNotification[]) {
  return events.map((event) =>
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
}

function boundedEvents(
  events: ServerNotification[] | undefined,
  limit: number,
): ServerNotification[] | undefined {
  if (!events) return;
  const window = stripTurnItemBodies(
    withoutToolTranscriptEvents(events).filter(
      (event) => !isIgnoredTranscriptEvent(event),
    ),
  ).slice(-CACHE_RECORD_EVENT_LIMIT);
  const estimatedLimit = Math.max(
    0,
    Math.floor(limit * CACHE_RECORD_ESTIMATE_RATIO),
  );
  const compacted = compactCodexTranscript(window, {
    maxBytes: estimatedLimit,
    targetBytes: Math.floor(estimatedLimit * 0.8),
    maxEvents: CACHE_RECORD_EVENT_LIMIT,
    targetEvents: Math.floor(CACHE_RECORD_EVENT_LIMIT * 0.75),
    activeTurnId: null,
    toolTextLimit: CACHE_RECORD_TOOL_TEXT_LIMIT,
    maxActiveToolGroups: CACHE_RECORD_ACTIVE_TOOL_GROUPS,
  }).events;
  return compacted.length ? compacted : undefined;
}

function boundedMessages(
  messages: CCMessage[] | undefined,
  limit: number,
): CCMessage[] | undefined {
  let bounded = messages
    ?.filter((m) => ["user", "assistant", "result"].includes(m.type))
    .slice(-CACHE_RECORD_MESSAGE_LIMIT);
  while (
    bounded?.length &&
    estimateTranscriptBytes(bounded) > limit * CACHE_RECORD_ESTIMATE_RATIO
  ) {
    bounded = bounded.slice(Math.max(1, Math.floor(bounded.length / 4)));
  }
  return bounded?.length ? bounded : undefined;
}

function buildCacheRecord(source: TranscriptCache, limit: number) {
  const base: TranscriptCache = {
    ...source,
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
  let events = boundedEvents(source.events, limit);
  let messages = boundedMessages(source.messages, limit);
  const candidate = (): TranscriptCache => ({
    ...base,
    ...(events?.length ? { events } : { events: undefined }),
    ...(messages?.length ? { messages } : { messages: undefined }),
  });
  let record = candidate();
  while (
    estimateTranscriptBytes(record) > limit * CACHE_RECORD_ESTIMATE_RATIO &&
    ((events?.length ?? 0) > 0 || (messages?.length ?? 0) > 0)
  ) {
    if ((events?.length ?? 0) >= (messages?.length ?? 0)) {
      events = events?.slice(Math.max(1, Math.floor(events.length / 4)));
    } else {
      messages = messages?.slice(Math.max(1, Math.floor(messages.length / 4)));
    }
    record = candidate();
  }
  if (estimateTranscriptBytes(record) > limit * CACHE_RECORD_ESTIMATE_RATIO)
    return;
  return record;
}

async function writeTranscriptCacheNow(record: TranscriptCache) {
  try {
    const db = await open();
    if (!db) return;
    if (record.savedAt <= cacheInvalidatedAt(record.key)) return;
    const limit = cacheRecordLimit();
    const serialized = JSON.stringify(record);
    record.bytes = textEncoder.encode(serialized).byteLength;
    if (record.bytes > limit) return;
    const tx = db.transaction(["transcripts", "budget"], "readwrite"),
      store = tx.objectStore("transcripts"),
      budget = tx.objectStore("budget");
    const existing = (await requestResult(budget.get(record.key))) as
      | TranscriptCache
      | undefined;
    if (existing && existing.savedAt > record.savedAt) return;
    if (record.savedAt <= cacheInvalidatedAt(record.key)) return;
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
