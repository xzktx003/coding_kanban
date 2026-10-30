import { withoutToolTranscriptEvents } from "./codexTranscriptVisibility";
import type { ServerNotification } from "../bindings";
import {
  isCodexTranscriptDormant,
  isCodexTranscriptVisible,
} from "./codexTranscriptActivity";
import type { Thread } from "../bindings/v2";
import type { CCMessage } from "../components/cc/types/messages";
import { useCodexStore } from "../components/codex/stores";
import { isIgnoredTranscriptEvent } from "../components/codex/stores/eventUtils";
import { useCCStore } from "../stores/cc";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import {
  selectedAgentCard,
  useAgentCenterStore,
} from "../stores/useAgentCenterStore";
import { openedSessions } from "./openedSessions";
import {
  MEMORY_HISTORY_RESTART_CURSOR,
  MEMORY_ITEM_CURSOR,
  transcriptBudgetRecoveryCursor,
} from "./sessionMemoryHistory";
import {
  compactCodexTranscript,
  estimateTranscriptBytes,
  CODEX_TRANSCRIPT_MAX_BYTES,
  CODEX_TRANSCRIPT_MAX_EVENTS,
} from "./codexTranscriptMemoryBudget";
import { mergeThreadHistory } from "../utils/mergeThreadHistory";
import {
  captureNativeExecutionScope,
  currentNativeExecutionTiming,
  isNativeExecutionScopeCurrent,
  reconcileNativeExecutionEvents,
} from "./nativeTurnExecutionProof";
import {
  isCachedTurnExecutionUnverified,
  markCachedTurnExecutionUnverified,
} from "./cachedTurnExecutionView";
import {
  cachedTranscriptBaselines,
  cachedTranscriptTimings,
  cacheInvalidatedAt,
  isTranscriptCacheDisposed,
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

/** Internal JSON byte estimator exported for its serialization contract tests. */
export function cacheSerializedJsonUtf8ByteLength(value: unknown): number {
  let stringContentBytes = 0;
  const serialized = JSON.stringify(value, (_key, current) => {
    let normalized = current;
    if (typeof normalized === "bigint") normalized = normalized.toString();
    if (typeof normalized === "string") {
      stringContentBytes +=
        cacheEscapedJsonStringContentUtf8ByteLength(normalized);
      return "";
    }
    return normalized;
  });
  // Preserve the existing counter's failure for JSON.stringify(undefined); the
  // read/write callers catch this and skip cache restoration/persistence.
  if (serialized === undefined)
    throw new TypeError("Cannot count bytes for undefined JSON serialization");
  return cacheSerializedUtf8ByteLength(serialized) + stringContentBytes;
}

function cacheEscapedJsonStringContentUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes++;
    } else if (code < 0x800) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Count UTF-8 bytes in serialized JSON without allocating an encoded copy. */
export function cacheSerializedUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

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
      // Old clients may have persisted records above today's budget. Bound the
      // actual payload before publishing it to restoration baselines or stores;
      // neither the on-disk byte counter nor a later governor is authoritative.
      const limit = cacheRecordLimit();
      const record = buildCacheRecord(cached, limit);
      if (!record) return;
      record.bytes = cacheSerializedJsonUtf8ByteLength(record);
      if (record.bytes > limit) return;
      return record;
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

/** A shortened cache must recover the gap before its retained window, not
 * continue an opaque cursor belonging to the larger source window. The item
 * anchor also covers a prefix trimmed from within a single native turn. */
function cacheWindowRecoveryCursor(events: ServerNotification[] | undefined) {
  if (!events?.length) return;
  const firstItem = events.find(
    (event) =>
      (event.method === "item/started" || event.method === "item/completed") &&
      !["userMessage", "collabAgentToolCall", "subAgentActivity"].includes(
        event.params.item.type,
      ),
  );
  if (
    firstItem &&
    (firstItem.method === "item/started" ||
      firstItem.method === "item/completed")
  )
    return (
      MEMORY_ITEM_CURSOR +
      encodeURIComponent(
        JSON.stringify({
          turnId: firstItem.params.turnId,
          beforeItemId: firstItem.params.item.id,
        }),
      )
    );
  const firstTurn = events
    .map((event) =>
      "turnId" in event.params
        ? event.params.turnId
        : "turn" in event.params
          ? event.params.turn.id
          : undefined,
    )
    .find((id): id is string => typeof id === "string");
  return MEMORY_HISTORY_RESTART_CURSOR + encodeURIComponent(firstTurn ?? "");
}

function boundedEvents(
  events: ServerNotification[] | undefined,
  limit: number,
): { events: ServerNotification[]; recoveryCursor?: string } | undefined {
  if (!events) return;
  const visible = stripTurnItemBodies(
    withoutToolTranscriptEvents(events).filter(
      (event) => !isIgnoredTranscriptEvent(event),
    ),
  );
  const window = visible.slice(-CACHE_RECORD_EVENT_LIMIT);
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
  });
  if (!compacted.events.length) return;
  return {
    events: compacted.events,
    recoveryCursor:
      transcriptBudgetRecoveryCursor(compacted) ??
      (window.length < visible.length
        ? cacheWindowRecoveryCursor(compacted.events)
        : undefined),
  };
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
  const bounded = boundedEvents(source.events, limit);
  let events = bounded?.events;
  let cursor = bounded?.recoveryCursor ?? source.cursor;
  let messages = boundedMessages(source.messages, limit);
  const candidate = (): TranscriptCache => ({
    ...base,
    ...(events?.length ? { events } : { events: undefined }),
    ...(messages?.length ? { messages } : { messages: undefined }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  let record = candidate();
  while (
    estimateTranscriptBytes(record) > limit * CACHE_RECORD_ESTIMATE_RATIO &&
    ((events?.length ?? 0) > 0 || (messages?.length ?? 0) > 0)
  ) {
    if ((events?.length ?? 0) >= (messages?.length ?? 0)) {
      events = events?.slice(Math.max(1, Math.floor(events.length / 4)));
      cursor = cacheWindowRecoveryCursor(events) ?? cursor;
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
    // JSON is used only to estimate bytes. IndexedDB persists the original
    // structured-clone record, including exact native bigint hook counters.
    record.bytes = cacheSerializedJsonUtf8ByteLength(record);
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
  let restoreRunning = false;
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
    if (restoreRunning || stopped || isTranscriptCacheDisposed()) return;
    restoreRunning = true;
    try {
      while (!stopped && !isTranscriptCacheDisposed()) {
        // Re-evaluate after each bounded IDB read so a newly selected view does
        // not wait for the whole original followed order. Only one restore runs.
        const candidates = openedSessions().filter(
          (card) =>
            !restoring.has(`${card.kind}:${card.id}`) &&
            !(card.kind === "codex" && isCodexTranscriptDormant(card.id)),
        );
        const selected = selectedAgentCard(useAgentCenterStore.getState());
        const card =
          candidates.find(
            (card) => card.kind === selected?.kind && card.id === selected.id,
          ) ??
          candidates.find(
            (card) =>
              card.kind === "codex" && isCodexTranscriptVisible(card.id),
          ) ??
          candidates[0];
        if (!card) break;
        const key = `${card.kind}:${card.id}`;
        restoring.add(key);
        const before =
          card.kind === "codex"
            ? useCodexStore.getState().events[card.id]
            : useCCStore.getState().sessionMessagesMap[card.id];
        const sourceScope = captureNativeExecutionScope();
        const cached = await readTranscriptCache(key);
        // Cache disposal can precede React's effect cleanup during hot replacement.
        // A late IndexedDB result must not repopulate the retired module's maps.
        if (stopped || isTranscriptCacheDisposed()) return;
        if (!isNativeExecutionScopeCurrent(sourceScope)) continue;
        if (
          (card.kind === "codex" && isCodexTranscriptDormant(card.id)) ||
          !cached ||
          !openedSessions().some(
            (c) => c.kind === card.kind && c.id === card.id,
          )
        )
          continue;
        if (
          card.kind === "codex" &&
          cached.events &&
          useCodexStore.getState().events[card.id] === before &&
          !useCodexStore.getState().historyLoadedMap[card.id]
        ) {
          const execution = useCodexStore.getState();
          const verified = currentNativeExecutionTiming(
            card.id,
            execution.turnTimingMap[card.id],
          );
          const projected = reconcileNativeExecutionEvents(
            card.id,
            cached.events,
            verified,
            execution.threadStatusMap[card.id]?.type === "active",
          );
          // Native events that arrived before cache hydration started remain
          // newer than this device snapshot too; never overwrite their items.
          const merged = before?.length
            ? mergeThreadHistory(projected, [], before as ServerNotification[])
            : projected;
          const bounded = compactCodexTranscript(merged, {
            maxBytes: CODEX_TRANSCRIPT_MAX_BYTES,
            targetBytes: CODEX_TRANSCRIPT_MAX_BYTES / 2,
            maxEvents: CODEX_TRANSCRIPT_MAX_EVENTS,
            targetEvents: CODEX_TRANSCRIPT_MAX_EVENTS / 2,
            activeTurnId:
              verified?.status === "inProgress" ? verified.turnId : undefined,
          });
          if (bounded.estimatedBytes > CODEX_TRANSCRIPT_MAX_BYTES) continue;
          let restoredEvents = bounded.events;
          // Only the latest cache-only ending is provisional. Genuine older
          // interruptions remain visible; no protocol status or busy flag is
          // changed to express this display uncertainty.
          let latestLifecycle: ServerNotification | undefined;
          for (let index = restoredEvents.length - 1; index >= 0; index--) {
            const event = restoredEvents[index];
            if (
              (event.method === "turn/started" ||
                event.method === "turn/completed") &&
              event.params.threadId === card.id
            ) {
              latestLifecycle = event;
              break;
            }
          }
          const latestId =
            latestLifecycle &&
            (latestLifecycle.method === "turn/started" ||
              latestLifecycle.method === "turn/completed")
              ? latestLifecycle.params.turn.id
              : undefined;
          if (
            latestId &&
            (!verified ||
              (verified.turnId === latestId &&
                verified.status === "inProgress" &&
                execution.threadStatusMap[card.id]?.type !== "active"))
          ) {
            restoredEvents = restoredEvents.map((event) => {
              if (
                event.method === "turn/completed" &&
                event.params.threadId === card.id &&
                event.params.turn.id === latestId &&
                event.params.turn.status === "interrupted" &&
                !isCachedTurnExecutionUnverified(event)
              ) {
                const projected = { ...event, params: { ...event.params } };
                markCachedTurnExecutionUnverified(projected);
                return projected;
              }
              return event;
            });
          }
          const recoveryCursor = transcriptBudgetRecoveryCursor(bounded);
          cachedTranscriptBaselines.set(card.id, restoredEvents);
          const boundary = [...restoredEvents]
            .reverse()
            .find(
              (e) =>
                e.method === "turn/completed" || e.method === "turn/started",
            );
          if (
            boundary &&
            (boundary.method === "turn/completed" ||
              boundary.method === "turn/started")
          ) {
            const turn = boundary.params.turn;
            cachedTranscriptTimings.set(
              card.id,
              verified?.turnId === turn.id
                ? verified
                : {
                    turnId: turn.id,
                    status: turn.status,
                    startedAtMs: (turn.startedAt ?? 0) * 1000,
                    durationMs: turn.durationMs,
                  },
            );
          }
          useCodexStore.setState((s) => ({
            events: { ...s.events, [card.id]: restoredEvents },
            historyLoadedMap: { ...s.historyLoadedMap, [card.id]: true },
            activeThreadIds: s.activeThreadIds.includes(card.id)
              ? s.activeThreadIds
              : [...s.activeThreadIds, card.id],
            ...(cached.thread && !s.threads.some((t) => t.id === card.id)
              ? { threads: [...s.threads, cached.thread] }
              : {}),
          }));
          useSessionSyncStore.setState((s) => ({
            cursors: {
              ...s.cursors,
              [card.id]: recoveryCursor ?? cached.cursor ?? null,
            },
          }));
          if (restoredEvents.some(isCachedTurnExecutionUnverified))
            window.dispatchEvent(
              new CustomEvent("session-cached-execution-pending", {
                detail: card.id,
              }),
            );
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
    } finally {
      restoreRunning = false;
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
    if (
      next.cards !== prev.cards ||
      next.detachedCard !== prev.detachedCard ||
      next.currentAgentCardId !== prev.currentAgentCardId ||
      next.currentAgentCardKind !== prev.currentAgentCardKind
    )
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
