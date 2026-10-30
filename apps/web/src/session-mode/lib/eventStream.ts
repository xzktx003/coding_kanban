import { buildEventUrl } from "@session/hooks/runtime";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
import {
  beginConnectionCheck,
  connectionCheckFailed,
  connectionCheckSucceeded,
  scheduleConnectionRetry,
  SessionSyncError,
} from "../services/sessionConnectionDiagnostics";
export interface EventEnvelope {
  seq: number;
  event: string;
  payload: unknown;
}
interface Subscriber {
  agents?: string[];
  onOpen?: () => void;
  onResync?: () => void;
  onEvent: (event: EventEnvelope) => void;
  label?: string;
}
const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence: number | null = null;
let retry = 500;
let connected = false;
let paused = false;
let offline = false;
let repairReconnectAt = -Infinity;
let repairTimer: ReturnType<typeof setTimeout> | null = null;
function requestRepair() {
  if (paused || repairTimer || !subscribers.size) return;
  repairTimer = setTimeout(() => {
    repairTimer = null;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber.onResync?.();
      } catch (error) {
        console.warn("Session recovery failed", error);
      }
    }
    if (Date.now() - repairReconnectAt >= 15000) {
      repairReconnectAt = Date.now();
      connect();
    }
  }, 250);
}
export const isEventStreamConnected = () => connected;
function namespace(event: string) {
  return event === "fs_change"
    ? "fs"
    : event === "acp-message"
      ? "acp"
      : event.startsWith("cc-")
        ? "cc"
        : event.split(/[:/]/)[0];
}
function invoke(callback: (() => void) | undefined) {
  try {
    callback?.();
  } catch (error) {
    console.warn("Session event subscriber failed", error);
    requestRepair();
  }
}
function connect() {
  if (paused || offline || !subscribers.size) return;
  if (timer) clearTimeout(timer);
  timer = null;
  source?.close();
  connected = false;
  beginConnectionCheck("events");
  const next = new EventSource(
    buildEventUrl(
      `/api/events?view=chat${sequence === null ? "" : `&since=${sequence}`}`,
    ),
  );
  source = next;
  next.onopen = () => {
    if (source !== next) return;
    connected = true;
    connectionCheckSucceeded("events");
    useSessionSyncStore.setState({
      connection: "connected",
      connectionError: null,
    });
    retry = 500;
    for (const subscriber of [...subscribers]) invoke(subscriber.onOpen);
  };
  next.addEventListener?.("session-projection-error", () => {
    if (source !== next) return;
    paused = true;
    connected = false;
    connectionCheckFailed("events", new SessionSyncError("response"));
    next.close();
    source = null;
    if (timer) clearTimeout(timer);
    if (repairTimer) clearTimeout(repairTimer);
    timer = null;
    repairTimer = null;
    useSessionSyncStore.setState({
      connection: "paused",
      connectionError:
        "收到的会话数据过大或格式异常，已暂停实时接收以保护页面。任务状态待核对。",
    });
  });
  next.onmessage = (event) => {
    if (source !== next) return;
    try {
      const envelope = JSON.parse(event.data) as EventEnvelope;
      if (
        !Number.isSafeInteger(envelope.seq) ||
        envelope.seq < 0 ||
        typeof envelope.event !== "string"
      ) {
        requestRepair();
        return;
      }
      const snapshot =
        envelope.event === "codex/user-input-snapshot" ||
        envelope.event === "codex/pending-requests-snapshot";
      // Snapshots carry the server's current cursor after all replay. A lower
      // cursor proves that this stream belongs to a new runtime. Keeping the
      // old maximum would discard every new event until it caught up, even
      // though EventSource looks connected and HTTP requests succeed.
      if (snapshot && sequence !== null && envelope.seq < sequence) {
        window.dispatchEvent(new Event("session-runtime-restarted"));
        requestRepair();
        return;
      }
      // The atomic pending-question snapshot follows replay at the current
      // cursor. It may share the last replayed sequence; it is reconciliation,
      // not a duplicate historical event.
      if (
        envelope.event !== "codex/user-input-snapshot" &&
        envelope.event !== "codex/pending-requests-snapshot" &&
        sequence !== null &&
        envelope.seq <= sequence
      )
        return;
      if (!snapshot && sequence !== null && envelope.seq > sequence + 1)
        requestRepair();
      sequence = Math.max(sequence ?? 0, envelope.seq);
      for (const subscriber of [...subscribers]) {
        if (
          subscriber.agents?.length &&
          !subscriber.agents.includes(namespace(envelope.event))
        )
          continue;
        invoke(() => subscriber.onEvent(envelope));
      }
    } catch (error) {
      requestRepair();
      console.warn("Invalid session event frame", error);
    }
  };
  next.onerror = () => {
    if (source !== next) return;
    next.close();
    requestRepair();
    connected = false;
    connectionCheckFailed("events", new SessionSyncError("network"));
    useSessionSyncStore.setState({ connection: "reconnecting" });
    source = null;
    if (!subscribers.size) return;
    timer = setTimeout(connect, retry);
    scheduleConnectionRetry("events", retry);
    retry = Math.min(retry * 2, 10_000);
  };
}
function restart() {
  paused = false;
  sequence = null;
  // The runtime-reset event already opens a new stream. A pending repair must
  // still notify readers, but must not immediately replace this fresh stream.
  repairReconnectAt = Date.now();
  if (timer) clearTimeout(timer);
  if (repairTimer) clearTimeout(repairTimer);
  timer = null;
  repairTimer = null;
  source?.close();
  source = null;
  connected = false;
  connect();
}
function handleOffline() {
  if (offline) return;
  offline = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (repairTimer) clearTimeout(repairTimer);
  repairTimer = null;
  source?.close();
  source = null;
  connected = false;
  if (!subscribers.size || paused) return;
  connectionCheckFailed("events", new SessionSyncError("network"));
  useSessionSyncStore.setState({ connection: "reconnecting" });
}
function handleOnline() {
  if (!offline) return;
  offline = false;
  if (paused || !subscribers.size) return;
  if (timer) clearTimeout(timer);
  timer = null;
  connect();
}
/** One shared browser SSE connection avoids HTTP/1 connection exhaustion in grids. */
export function openEventStream(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  if (subscribers.size === 1) {
    window.addEventListener("session-runtime-restarted", restart);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    offline = false;
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      handleOffline();
    else connect();
  } else if (connected)
    queueMicrotask(() => {
      if (subscribers.has(subscriber)) invoke(subscriber.onOpen);
    });
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    subscribers.delete(subscriber);
    if (subscribers.size) return;
    window.removeEventListener("session-runtime-restarted", restart);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
    if (timer) clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    sequence = null;
    if (repairTimer) clearTimeout(repairTimer);
    repairTimer = null;
    repairReconnectAt = -Infinity;
    connected = false;
    paused = false;
    offline = false;
    retry = 500;
  };
}

/** Reconcile pending RPCs without resending any user response. */
export function reconcileEventStream() {
  if (timer) clearTimeout(timer);
  timer = null;
  connect();
}

/** Explicit recovery skips oversized replay; readonly history recovers visible messages. */
export function retryEventStream() {
  restart();
}
