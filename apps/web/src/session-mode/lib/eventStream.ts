import { buildEventUrl } from "@session/hooks/runtime";
export interface EventEnvelope {
  seq: number;
  event: string;
  payload: unknown;
}
interface Subscriber {
  agents?: string[];
  onOpen?: () => void;
  onEvent: (event: EventEnvelope) => void;
  label?: string;
}
const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence: number | null = null;
let retry = 500;
let connected = false;
export const isEventStreamConnected = () => connected;
function namespace(event: string) {
  return event === "fs_change"
    ? "fs"
    : event.startsWith("cc-")
      ? "cc"
      : event.split(/[:/]/)[0];
}
function invoke(callback: (() => void) | undefined) {
  try {
    callback?.();
  } catch (error) {
    console.warn("Session event subscriber failed", error);
  }
}
function connect() {
  if (!subscribers.size) return;
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
    retry = 500;
    for (const subscriber of [...subscribers]) invoke(subscriber.onOpen);
  };
  next.onmessage = (event) => {
    if (source !== next) return;
    try {
      const envelope = JSON.parse(event.data) as EventEnvelope;
      if (
        typeof envelope.seq !== "number" ||
        typeof envelope.event !== "string"
      )
        return;
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
      console.warn("Invalid session event frame", error);
    }
  };
  next.onerror = () => {
    if (source !== next) return;
    next.close();
    connected = false;
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
