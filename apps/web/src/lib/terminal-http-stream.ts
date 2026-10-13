import { v4 as randomUUID } from "uuid";

export const DEFAULT_SHARED_TERMINAL_REPLAY_BYTES = 512 * 1024;
export const MAX_TERMINAL_HTTP_STREAM_LINE_CHARS = 8 * 1024 * 1024;
export const TERMINAL_HTTP_CONTROL_TIMEOUT_MS = 30_000;

export interface StreamTerminalOutputOptions {
  replayBytes?: number;
  signal?: AbortSignal;
  onOpen?: () => void;
  onFrame: (frame: string) => void;
}

interface TerminalStreamReadyEvent {
  type: "ready";
  streamId: string;
}

interface TerminalStreamFrameEvent {
  type: "frame";
  agentSessionId: string;
  subscriptionId: string;
  frame: string;
}

type TerminalStreamEvent = TerminalStreamReadyEvent | TerminalStreamFrameEvent;

type FetchLike = typeof fetch;

type SubscriptionIdFactory = () => string;

interface TerminalHttpStreamHubOptions {
  controlTimeoutMs?: number;
  createSubscriptionId?: SubscriptionIdFactory;
  fetchRef?: FetchLike;
  streamUrl?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
}

interface Subscription {
  agentSessionId: string;
  controlAbortController: AbortController;
  deleteAfterSubscribe: boolean;
  generation: number;
  onAbort?: () => void;
  onFrame: (frame: string) => void;
  onOpen?: () => void;
  opened: boolean;
  postSettled: boolean;
  postStarted: boolean;
  replayBytes: number;
  reject: (error: unknown) => void;
  resolve: () => void;
  serverSubscribed: boolean;
  settled: boolean;
  signal?: AbortSignal;
  subscriptionId: string;
}

interface StreamState {
  abortController: AbortController;
  generation: number;
  ready: Deferred<string>;
  readyTimeout: ReturnType<typeof setTimeout>;
  streamId: string | null;
}

interface FailedResponseDetails {
  code?: string;
  message: string;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function defaultCreateSubscriptionId(): string {
  return randomUUID();
}

function resolveReplayBytes(replayBytes?: number): number {
  return replayBytes && Number.isSafeInteger(replayBytes) && replayBytes > 0
    ? replayBytes
    : DEFAULT_SHARED_TERMINAL_REPLAY_BYTES;
}

async function parseFailedResponseDetails(
  response: Response,
): Promise<FailedResponseDetails> {
  const fallback = `Request failed: ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  const text = (await response.text()).trim();
  if (!text) return { message: fallback };
  if (!contentType.includes("application/json")) return { message: text };
  try {
    const payload = JSON.parse(text) as { code?: unknown; error?: unknown };
    return {
      code: typeof payload.code === "string" ? payload.code : undefined,
      message:
        typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : fallback,
    };
  } catch {
    return { message: fallback };
  }
}

async function parseFailedResponseMessage(response: Response): Promise<string> {
  return (await parseFailedResponseDetails(response)).message;
}

async function consumeResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  await response.arrayBuffer().catch(() => undefined);
}

function createControlTimer(
  callback: () => void,
  timeoutMs: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(callback, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

function clearTimer(timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer);
}

function parseTerminalStreamEvent(line: string): TerminalStreamEvent {
  if (line.length > MAX_TERMINAL_HTTP_STREAM_LINE_CHARS) {
    throw new Error("终端共享流单帧超过安全上限");
  }

  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new Error("终端共享流返回了无效 JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("终端共享流返回了无效事件");
  }
  const record = value as Record<string, unknown>;
  if (record.type === "ready" && typeof record.streamId === "string") {
    return { type: "ready", streamId: record.streamId };
  }
  if (
    record.type === "frame" &&
    typeof record.agentSessionId === "string" &&
    typeof record.subscriptionId === "string" &&
    typeof record.frame === "string"
  ) {
    return {
      type: "frame",
      agentSessionId: record.agentSessionId,
      subscriptionId: record.subscriptionId,
      frame: record.frame,
    };
  }
  throw new Error("终端共享流返回了未知事件");
}

export class TerminalHttpStreamHub {
  readonly #controlTimeoutMs: number;
  readonly #createSubscriptionId: SubscriptionIdFactory;
  readonly #fetchRef: FetchLike;
  readonly #streamUrl: string;
  #generation = 0;
  #pendingControlSubscriptions = new Set<Subscription>();
  #stream: StreamState | null = null;
  #subscriptions = new Map<string, Subscription>();

  constructor(options: TerminalHttpStreamHubOptions = {}) {
    this.#controlTimeoutMs =
      options.controlTimeoutMs && options.controlTimeoutMs > 0
        ? options.controlTimeoutMs
        : TERMINAL_HTTP_CONTROL_TIMEOUT_MS;
    this.#createSubscriptionId =
      options.createSubscriptionId ?? defaultCreateSubscriptionId;
    this.#fetchRef =
      options.fetchRef ?? ((input, init) => globalThis.fetch(input, init));
    this.#streamUrl = options.streamUrl ?? "/api/terminal-stream";
  }

  streamTerminalOutput(
    agentSessionId: string,
    options: StreamTerminalOutputOptions,
  ): Promise<void> {
    if (options.signal?.aborted) {
      return Promise.reject(makeAbortError());
    }

    const stream = this.#ensureStream();
    const subscriberDeferred = deferred<void>();
    const subscription: Subscription = {
      agentSessionId,
      controlAbortController: new AbortController(),
      deleteAfterSubscribe: false,
      generation: stream.generation,
      onFrame: options.onFrame,
      onOpen: options.onOpen,
      opened: false,
      postSettled: false,
      postStarted: false,
      replayBytes: resolveReplayBytes(options.replayBytes),
      reject: subscriberDeferred.reject,
      resolve: () => subscriberDeferred.resolve(undefined),
      serverSubscribed: false,
      settled: false,
      signal: options.signal,
      subscriptionId: this.#createUniqueSubscriptionId(),
    };

    this.#subscriptions.set(subscription.subscriptionId, subscription);

    if (options.signal) {
      subscription.onAbort = () => {
        this.#releaseSubscription(subscription, makeAbortError());
      };
      options.signal.addEventListener("abort", subscription.onAbort, {
        once: true,
      });
    }

    this.#subscribeOnServer(subscription, stream).catch((error: unknown) => {
      if (
        this.#subscriptions.get(subscription.subscriptionId) === subscription
      ) {
        this.#releaseSubscription(subscription, error);
      }
    });

    return subscriberDeferred.promise;
  }

  #createUniqueSubscriptionId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const subscriptionId = this.#createSubscriptionId();
      if (!this.#subscriptions.has(subscriptionId)) {
        return subscriptionId;
      }
    }
    throw new Error("无法生成唯一终端订阅 ID");
  }

  #ensureStream(): StreamState {
    if (this.#stream) {
      return this.#stream;
    }

    const stream: StreamState = {
      abortController: new AbortController(),
      generation: ++this.#generation,
      ready: deferred<string>(),
      readyTimeout: undefined as unknown as ReturnType<typeof setTimeout>,
      streamId: null,
    };
    stream.readyTimeout = createControlTimer(() => {
      this.#failStream(stream, new Error("终端共享流 ready 超时"));
    }, this.#controlTimeoutMs);
    this.#stream = stream;
    void this.#runStream(stream);
    return stream;
  }

  async #subscribeOnServer(
    subscription: Subscription,
    stream: StreamState,
  ): Promise<void> {
    const streamId = await stream.ready.promise;
    if (!this.#isCurrentSubscription(subscription, stream)) {
      return;
    }

    subscription.postStarted = true;
    this.#pendingControlSubscriptions.add(subscription);
    const timeout = createControlTimer(() => {
      const error = new Error("终端共享流订阅请求超时");
      subscription.controlAbortController.abort();
      this.#failStream(stream, error);
    }, this.#controlTimeoutMs);

    const finishPost = () => {
      clearTimer(timeout);
      subscription.postSettled = true;
      this.#pendingControlSubscriptions.delete(subscription);
    };
    const deleteCanceledSubscription = async () => {
      if (this.#stream !== stream || !subscription.deleteAfterSubscribe) return;
      await this.#deleteSubscriptionFromServer(
        streamId,
        subscription.subscriptionId,
      ).catch((error: unknown) => {
        this.#failStream(stream, error);
      });
    };

    let response: Response;
    try {
      try {
        response = await this.#fetchRef(
          `${this.#streamUrl}/${encodeURIComponent(streamId)}/subscriptions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentSessionId: subscription.agentSessionId,
              replayBytes: subscription.replayBytes,
              subscriptionId: subscription.subscriptionId,
            }),
            signal: subscription.controlAbortController.signal,
          },
        );
      } catch (error) {
        finishPost();
        this.#failStream(stream, error);
        throw error;
      }

      if (!this.#isCurrentSubscription(subscription, stream)) {
        await consumeResponseBody(response);
        finishPost();
        await deleteCanceledSubscription();
        return;
      }

      if (response.status === 404) {
        const details = await parseFailedResponseDetails(response);
        const error = new Error(details.message);
        finishPost();
        if (details.code === "TERMINAL_STREAM_NOT_FOUND") {
          this.#failStream(stream, error);
        }
        throw error;
      }
      if (!response.ok) {
        const message = await parseFailedResponseMessage(response);
        finishPost();
        throw new Error(message);
      }

      await consumeResponseBody(response);
      finishPost();
      if (!this.#isCurrentSubscription(subscription, stream)) {
        await deleteCanceledSubscription();
        return;
      }
      subscription.serverSubscribed = true;
      this.#openSubscription(subscription);
    } catch (error) {
      finishPost();
      throw error;
    }
  }

  async #runStream(stream: StreamState): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await this.#fetchRef(this.#streamUrl, {
        headers: { Accept: "application/x-ndjson" },
        signal: stream.abortController.signal,
      });
      if (!response.ok) {
        throw new Error(await parseFailedResponseMessage(response));
      }
      if (!response.body) {
        throw new Error("浏览器不支持终端共享流式响应");
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let readyObserved = false;

      const consumeLines = (final = false) => {
        if (this.#stream !== stream) return;
        const lines = pending.split("\n");
        const trailing = lines.pop() ?? "";
        pending = final ? "" : trailing;
        if (final && trailing) {
          lines.push(trailing);
        }

        for (const line of lines) {
          if (this.#stream !== stream) return;
          if (!line) continue;
          const event = parseTerminalStreamEvent(line);
          if (event.type === "ready") {
            if (readyObserved) continue;
            readyObserved = true;
            clearTimer(stream.readyTimeout);
            stream.streamId = event.streamId;
            stream.ready.resolve(event.streamId);
            continue;
          }
          if (!readyObserved) {
            throw new Error("终端共享流在 ready 前返回输出");
          }
          this.#dispatchFrame(stream, event);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (this.#stream !== stream) return;
        if (done) {
          pending += decoder.decode();
          consumeLines(true);
          if (!readyObserved) {
            throw new Error("终端共享流未返回 ready 事件");
          }
          this.#completeStream(stream);
          return;
        }

        pending += decoder.decode(value, { stream: true });
        consumeLines();
        if (pending.length > MAX_TERMINAL_HTTP_STREAM_LINE_CHARS) {
          throw new Error("终端共享流单帧超过安全上限");
        }
      }
    } catch (error) {
      if (
        stream.abortController.signal.aborted &&
        this.#stream !== stream &&
        this.#subscriptions.size === 0
      ) {
        stream.ready.reject(makeAbortError());
        return;
      }
      this.#failStream(stream, error);
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }

  #dispatchFrame(stream: StreamState, event: TerminalStreamFrameEvent): void {
    if (this.#stream !== stream) return;
    const subscription = this.#subscriptions.get(event.subscriptionId);
    if (!subscription) return;
    if (subscription.generation !== stream.generation) return;
    if (subscription.agentSessionId !== event.agentSessionId) return;
    if (!this.#openSubscription(subscription)) return;
    if (subscription.settled) return;
    try {
      subscription.onFrame(event.frame);
    } catch (error) {
      this.#releaseSubscription(subscription, error);
    }
  }

  #openSubscription(subscription: Subscription): boolean {
    if (subscription.settled) return false;
    if (subscription.opened) return true;
    subscription.opened = true;
    try {
      subscription.onOpen?.();
      return !subscription.settled;
    } catch (error) {
      this.#releaseSubscription(subscription, error);
      return false;
    }
  }

  #isCurrentSubscription(
    subscription: Subscription,
    stream: StreamState,
  ): boolean {
    return (
      this.#stream === stream &&
      this.#subscriptions.get(subscription.subscriptionId) === subscription &&
      subscription.generation === stream.generation &&
      !subscription.settled
    );
  }

  #releaseSubscription(subscription: Subscription, error?: unknown): void {
    if (subscription.settled) return;
    subscription.settled = true;
    if (subscription.signal && subscription.onAbort) {
      subscription.signal.removeEventListener("abort", subscription.onAbort);
    }

    if (this.#subscriptions.get(subscription.subscriptionId) === subscription) {
      this.#subscriptions.delete(subscription.subscriptionId);
    }

    const stream = this.#stream;
    const streamId = stream?.streamId;
    if (stream && streamId && subscription.serverSubscribed) {
      void this.#deleteSubscriptionFromServer(
        streamId,
        subscription.subscriptionId,
      ).catch((deleteError: unknown) => {
        this.#failStream(stream, deleteError);
      });
    } else if (
      streamId &&
      subscription.postStarted &&
      !subscription.postSettled
    ) {
      subscription.deleteAfterSubscribe = true;
    }

    this.#stopStreamIfIdle();

    if (error) subscription.reject(error);
    else subscription.resolve();
  }

  #releaseDetachedSubscription(
    subscription: Subscription,
    error?: unknown,
  ): void {
    if (subscription.settled) return;
    subscription.settled = true;
    subscription.controlAbortController.abort();
    if (subscription.signal && subscription.onAbort) {
      subscription.signal.removeEventListener("abort", subscription.onAbort);
    }
    if (error) subscription.reject(error);
    else subscription.resolve();
  }

  async #deleteSubscriptionFromServer(
    streamId: string,
    subscriptionId: string,
  ): Promise<void> {
    const abortController = new AbortController();
    const timeout = createControlTimer(() => {
      abortController.abort();
    }, this.#controlTimeoutMs);
    try {
      const response = await this.#fetchRef(
        `${this.#streamUrl}/${encodeURIComponent(streamId)}/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { method: "DELETE", signal: abortController.signal },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(await parseFailedResponseMessage(response));
      }
      await consumeResponseBody(response);
    } finally {
      clearTimer(timeout);
    }
  }

  #abortPendingControls(stream: StreamState): void {
    for (const subscription of Array.from(this.#pendingControlSubscriptions)) {
      if (subscription.generation === stream.generation) {
        subscription.controlAbortController.abort();
      }
    }
  }

  #completeStream(stream: StreamState): void {
    if (this.#stream !== stream) return;
    this.#stream = null;
    clearTimer(stream.readyTimeout);
    this.#abortPendingControls(stream);
    const subscriptions = Array.from(this.#subscriptions.values()).filter(
      (subscription) => subscription.generation === stream.generation,
    );
    for (const subscription of subscriptions) {
      this.#subscriptions.delete(subscription.subscriptionId);
      this.#releaseDetachedSubscription(subscription);
    }
  }

  #failStream(stream: StreamState, error: unknown): void {
    if (this.#stream !== stream) return;
    this.#stream = null;
    clearTimer(stream.readyTimeout);
    stream.ready.reject(error);
    stream.abortController.abort();
    this.#abortPendingControls(stream);
    const subscriptions = Array.from(this.#subscriptions.values()).filter(
      (subscription) => subscription.generation === stream.generation,
    );
    for (const subscription of subscriptions) {
      this.#subscriptions.delete(subscription.subscriptionId);
      this.#releaseDetachedSubscription(subscription, error);
    }
  }

  #stopStreamIfIdle(): void {
    if (this.#subscriptions.size > 0) return;
    const stream = this.#stream;
    if (!stream) return;
    this.#stream = null;
    clearTimer(stream.readyTimeout);
    stream.abortController.abort();
    this.#abortPendingControls(stream);
  }
}

export const terminalHttpStreamHub = new TerminalHttpStreamHub();

export function streamSharedTerminalOutput(
  agentSessionId: string,
  options: StreamTerminalOutputOptions,
): Promise<void> {
  return terminalHttpStreamHub.streamTerminalOutput(agentSessionId, options);
}
