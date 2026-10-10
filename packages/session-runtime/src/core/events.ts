import { object, type JsonObject } from "./json.js";

export interface SeqEvent {
  readonly seq: number;
  readonly event: string;
  readonly payload: JsonObject;
}

interface BufferedEvent {
  value: SeqEvent;
  bytes: number;
}
interface PendingRequest {
  value: SeqEvent;
  claimed: boolean;
}
export interface SubscriptionOptions {
  since?: number;
  agents?: string;
  snapshots?: boolean;
  /** Internal consumers can avoid retaining unrelated large protocol events. */
  filter?: (event: SeqEvent) => boolean;
  project?: (event: SeqEvent) => SeqEvent;
}
interface HubOptions {
  replayCapacity?: number;
  replayBytes?: number;
  subscriberCapacity?: number;
  subscriberBytes?: number;
}

export function eventNamespace(event: string): string {
  if (event.startsWith("cc-")) return "cc";
  if (event.startsWith("acp-")) return "acp";
  if (event === "fs_change") return "fs";
  return event.split(/[:/]/, 1)[0];
}

function requestKey(payload: JsonObject): string | undefined {
  if (
    typeof payload.threadId !== "string" ||
    !(
      typeof payload.requestId === "string" ||
      Number.isSafeInteger(payload.requestId)
    )
  )
    return;
  return JSON.stringify([payload.threadId, payload.requestId]);
}

const pendingEvents = new Set([
  "codex/request-user-input",
  "codex/approval-request",
  "codex/permissions-request",
  "codex/elicitation-request",
]);

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class EventSubscription implements AsyncIterableIterator<SeqEvent> {
  private queue: BufferedEvent[] = [];
  private bytes = 0;
  private waiting?: {
    resolve: (value: IteratorResult<SeqEvent>) => void;
    reject: (error: Error) => void;
  };
  private closed = false;
  private failure?: Error;

  constructor(
    private initialBacklog: readonly SeqEvent[],
    readonly accepts: (event: string) => boolean,
    private readonly capacity: number,
    private readonly byteLimit: number,
    private readonly detach: () => void,
    private readonly filter?: (event: SeqEvent) => boolean,
    private readonly project?: (event: SeqEvent) => SeqEvent,
  ) {}

  get backlog(): readonly SeqEvent[] {
    return this.initialBacklog;
  }

  takeBacklog(): readonly SeqEvent[] {
    const backlog = this.initialBacklog;
    this.initialBacklog = [];
    return backlog;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<SeqEvent> {
    return this;
  }

  next(): Promise<IteratorResult<SeqEvent>> {
    if (this.failure) return Promise.reject(this.failure);
    const head = this.queue.shift();
    if (head) {
      this.bytes -= head.bytes;
      return Promise.resolve({ done: false, value: head.value });
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiting)
      return Promise.reject(
        new Error("Concurrent reads on event subscription"),
      );
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  push(event: BufferedEvent): void {
    if (
      this.closed ||
      !this.accepts(event.value.event) ||
      (this.filter && !this.filter(event.value))
    )
      return;
    if (this.project) {
      const value = this.project(event.value);
      event = { value, bytes: Buffer.byteLength(JSON.stringify(value)) };
    }
    if (this.waiting) {
      const waiter = this.waiting;
      this.waiting = undefined;
      waiter.resolve({ done: false, value: event.value });
      return;
    }
    if (
      this.queue.length >= this.capacity ||
      this.bytes + event.bytes > this.byteLimit
    ) {
      this.close(
        new Error(
          "Event subscriber lagged; reconnect with the last processed sequence",
        ),
      );
      return;
    }
    this.queue.push(event);
    this.bytes += event.bytes;
  }

  close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    this.queue = [];
    this.bytes = 0;
    this.initialBacklog = [];
    this.detach();
    if (this.waiting) {
      const waiter = this.waiting;
      this.waiting = undefined;
      if (error) waiter.reject(error);
      else waiter.resolve({ done: true, value: undefined });
    }
  }

  async return(): Promise<IteratorResult<SeqEvent>> {
    this.close();
    return { done: true, value: undefined };
  }
}

/** One synchronous publication boundary gives replay and live subscribers a total order. */
export class EventHub {
  private sequence = 0;
  private buffer: BufferedEvent[] = [];
  private bufferBytes = 0;
  private pending = new Map<string, PendingRequest>();
  private subscribers = new Set<EventSubscription>();
  private readonly limits: Required<HubOptions>;

  constructor(options: HubOptions = {}) {
    this.limits = {
      replayCapacity: 2048,
      replayBytes: 32 * 1024 * 1024,
      subscriberCapacity: 1024,
      subscriberBytes: 32 * 1024 * 1024,
      ...options,
    };
    for (const limit of Object.values(this.limits)) {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Invalid event buffer limit");
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
  get pendingCount(): number {
    return this.pending.size;
  }
  get replayByteLength(): number {
    return this.bufferBytes;
  }
  get cursor(): number {
    return this.sequence;
  }

  publish(event: string, payload: JsonObject): SeqEvent {
    if (!Number.isSafeInteger(this.sequence + 1))
      throw new Error("Event sequence exhausted");
    // Snapshot caller-owned values so later mutation cannot alter approval identities or replay.
    const encoded = JSON.stringify({ seq: this.sequence + 1, event, payload });
    const value = freeze(JSON.parse(encoded) as SeqEvent);
    this.sequence++;
    this.updatePending(value);
    const stored = { value, bytes: Buffer.byteLength(encoded) };
    this.buffer.push(stored);
    this.bufferBytes += stored.bytes;
    while (
      this.buffer.length > this.limits.replayCapacity ||
      this.bufferBytes > this.limits.replayBytes
    ) {
      this.bufferBytes -= this.buffer.shift()!.bytes;
    }
    for (const subscriber of this.subscribers) subscriber.push(stored);
    return value;
  }

  private updatePending(value: SeqEvent): void {
    if (pendingEvents.has(value.event)) {
      const key = requestKey(value.payload);
      if (key) {
        const previous = this.pending.get(key);
        // An identical re-announcement must not permit a second reply.
        const claimed =
          previous?.value.payload.requestToken === value.payload.requestToken &&
          previous.claimed;
        this.pending.set(key, { value, claimed: Boolean(claimed) });
      }
      return;
    }
    if (value.event !== "codex:notification") return;
    const params = object(value.payload.params);
    const method = value.payload.method;
    if (method === "serverRequest/resolved") {
      const key = requestKey(params);
      if (key) this.pending.delete(key);
      return;
    }
    const threadClosed =
      method === "thread/closed" || method === "thread/deleted";
    const turnCompleted = method === "turn/completed";
    const turnFailed = method === "error" && params.willRetry === false;
    if (!threadClosed && !turnCompleted && !turnFailed) return;
    const turnId = turnCompleted ? object(params.turn).id : params.turnId;
    for (const [key, request] of this.pending) {
      if (
        request.value.payload.threadId === params.threadId &&
        (threadClosed || request.value.payload.turnId === turnId)
      )
        this.pending.delete(key);
    }
  }

  claimReply(
    request: JsonObject,
    id: string | number,
    event: string,
    kind: string,
  ): boolean {
    const key = requestKey(request);
    const live = key ? this.pending.get(key) : undefined;
    if (
      !live ||
      live.claimed ||
      request.requestId !== id ||
      live.value.event !== event ||
      live.value.payload.type !== kind ||
      (request.type !== undefined && request.type !== kind)
    )
      return false;
    for (const field of ["turnId", "itemId", "requestToken"]) {
      if ((request[field] ?? null) !== (live.value.payload[field] ?? null))
        return false;
    }
    live.claimed = true;
    return true;
  }

  invalidatePending(namespace: string): void {
    for (const [key, request] of this.pending) {
      if (eventNamespace(request.value.event) === namespace)
        this.pending.delete(key);
    }
    if (namespace === "codex") {
      this.publish("codex/user-input-snapshot", { requests: [] });
      this.publish("codex/pending-requests-snapshot", { requests: [] });
    }
  }

  subscribe(options: SubscriptionOptions = {}): EventSubscription {
    if (
      options.since !== undefined &&
      (!Number.isSafeInteger(options.since) || options.since < 0)
    )
      throw new Error("Invalid event cursor");
    const namespaces = new Set(
      options.agents
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const accepts = (name: string) =>
      !namespaces.size || namespaces.has(eventNamespace(name));
    const backlog =
      options.since === undefined
        ? []
        : this.buffer
            .filter(
              (e) =>
                e.value.seq > options.since! &&
                accepts(e.value.event) &&
                (!options.filter || options.filter(e.value)),
            )
            .map((e) => e.value);
    if (options.snapshots && accepts("codex/pending-requests-snapshot")) {
      const pending = [...this.pending.values()]
        .map((e) => e.value)
        .sort((a, b) => a.seq - b.seq);
      const questions = pending.filter(
        (e) => e.event === "codex/request-user-input",
      );
      if (options.since !== undefined || questions.length)
        backlog.push({
          seq: this.sequence,
          event: "codex/user-input-snapshot",
          payload: { requests: questions.map((e) => e.payload) },
        });
      if (options.since !== undefined || pending.length)
        backlog.push({
          seq: this.sequence,
          event: "codex/pending-requests-snapshot",
          payload: {
            requests: pending.map((e) => ({
              event: e.event,
              payload: e.payload,
            })),
          },
        });
    }
    const subscription = new EventSubscription(
      (options.filter ? backlog.filter(options.filter) : backlog).map(
        (event) => (options.project ? options.project(event) : event),
      ),
      accepts,
      this.limits.subscriberCapacity,
      this.limits.subscriberBytes,
      () => this.subscribers.delete(subscription),
      options.filter,
      options.project,
    );
    this.subscribers.add(subscription);
    return subscription;
  }

  close(): void {
    for (const subscriber of this.subscribers) subscriber.close();
    this.pending.clear();
    this.buffer = [];
    this.bufferBytes = 0;
  }
}
