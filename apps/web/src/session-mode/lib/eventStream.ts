import { buildEventUrl } from "@session/hooks/runtime";
import { useSessionSyncStore } from "../stores/useSessionSyncStore";
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
let repairReconnectAt = -Infinity;
let repairTimer: ReturnType<typeof setTimeout> | null = null;
function requestRepair() {
  if (repairTimer || !subscribers.size) return;
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
  if (!subscribers.size) return;
  if (timer) clearTimeout(timer);
  timer = null;
  source?.close();
  connected = false;
  const next = new EventSource(
    buildEventUrl(
      `/api/events${sequence === null ? "" : `?since=${sequence}`}`,
    ),
  );
  source = next;
  next.onopen = () => {
    if (source !== next) return;
    connected = true;
    useSessionSyncStore.setState({ connection: "connected" });
    retry = 500;
    for (const subscriber of [...subscribers]) invoke(subscriber.onOpen);
  };
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
    useSessionSyncStore.setState({ connection: "reconnecting" });
    source = null;
    if (!subscribers.size) return;
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 10_000);
  };
}
function restart() {
  sequence = null;
  if (timer) clearTimeout(timer);
  timer = null;
  connect();
}
/** One shared browser SSE connection avoids HTTP/1 connection exhaustion in grids. */
export function openEventStream(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  if (subscribers.size === 1) {
    window.addEventListener("session-runtime-restarted", restart);
    connect();
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
    if (timer) clearTimeout(timer);
    timer = null;
    source?.close();
    source = null;
    sequence = null;
    if (repairTimer) clearTimeout(repairTimer);
    repairTimer = null;
    repairReconnectAt = -Infinity;
    connected = false;
    retry = 500;
  };
}

/** Reconcile pending RPCs without resending any user response. */
export function reconcileEventStream() {
  if (timer) clearTimeout(timer);
  timer = null;
  connect();
}
