import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_TERMINAL_HTTP_STREAM_LINE_CHARS,
  TerminalHttpStreamHub,
} from "./terminal-http-stream.js";

function makeNdjsonStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
    },
  });
  return {
    stream,
    write(value: unknown) {
      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    writeRaw(value: string) {
      controller.enqueue(encoder.encode(value));
    },
    close() {
      controller.close();
    },
  };
}

function makeManualByteStream() {
  const encoder = new TextEncoder();
  const reads: Array<{
    resolve: (value: ReadableStreamReadResult<Uint8Array>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let canceled = false;
  const reader: ReadableStreamDefaultReader<Uint8Array> = {
    read() {
      return new Promise<ReadableStreamReadResult<Uint8Array>>(
        (resolve, reject) => {
          reads.push({ resolve, reject });
        },
      );
    },
    cancel() {
      canceled = true;
      return Promise.resolve();
    },
    releaseLock() {},
    get closed() {
      return Promise.resolve(undefined);
    },
  } as ReadableStreamDefaultReader<Uint8Array>;
  return {
    body: {
      getReader() {
        return reader;
      },
    } as ReadableStream<Uint8Array>,
    push(value: unknown) {
      const read = reads.shift();
      assert.ok(read, "expected pending read");
      read.resolve({
        done: false,
        value: encoder.encode(`${JSON.stringify(value)}\n`),
      });
    },
    close() {
      const read = reads.shift();
      assert.ok(read, "expected pending read");
      read.resolve({ done: true, value: undefined });
    },
    get canceled() {
      return canceled;
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeIdFactory(ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `subscription-${index}`;
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  return init?.body ? JSON.parse(String(init.body)) : {};
}

describe("TerminalHttpStreamHub", () => {
  it("shares one GET across eight independent subscriptions and isolates frames", async () => {
    const ndjson = makeNdjsonStream();
    const fetchCalls: Array<{ url: string; method: string; body?: unknown }> =
      [];
    const fetchRef: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      fetchCalls.push({
        url: String(input),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET") {
        return new Response(ndjson.stream, { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(
        Array.from({ length: 8 }, (_, index) => `sub-${index}`),
      ),
      fetchRef,
    });
    const received = new Map<string, string[]>();
    const opened: string[] = [];
    const promises = Array.from({ length: 8 }, (_, index) => {
      const agentSessionId = `agent-${index}`;
      const subscriptionId = `sub-${index}`;
      received.set(subscriptionId, []);
      return hub.streamTerminalOutput(agentSessionId, {
        replayBytes: 123,
        onOpen: () => opened.push(subscriptionId),
        onFrame: (frame) => received.get(subscriptionId)!.push(frame),
      });
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    assert.equal(fetchCalls.filter((call) => call.method === "GET").length, 1);
    assert.equal(fetchCalls.filter((call) => call.method === "POST").length, 8);
    assert.deepEqual(
      fetchCalls
        .filter((call) => call.method === "POST")
        .map((call) => call.body),
      Array.from({ length: 8 }, (_, index) => ({
        agentSessionId: `agent-${index}`,
        replayBytes: 123,
        subscriptionId: `sub-${index}`,
      })),
    );
    assert.deepEqual(opened.sort(), [
      "sub-0",
      "sub-1",
      "sub-2",
      "sub-3",
      "sub-4",
      "sub-5",
      "sub-6",
      "sub-7",
    ]);

    ndjson.write({
      type: "frame",
      agentSessionId: "agent-3",
      subscriptionId: "sub-3",
      frame: "three",
    });
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-7",
      subscriptionId: "sub-7",
      frame: "seven",
    });
    await flush();

    assert.deepEqual(received.get("sub-3"), ["three"]);
    assert.deepEqual(received.get("sub-7"), ["seven"]);
    assert.deepEqual(received.get("sub-0"), []);

    ndjson.close();
    await Promise.all(promises);
  });

  it("calls onOpen before the first frame when replay arrives before POST returns", async () => {
    const ndjson = makeNdjsonStream();
    let resolvePost!: () => void;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      return new Promise<Response>((resolve) => {
        resolvePost = () =>
          resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-replay"]),
      fetchRef,
    });
    const events: string[] = [];
    const promise = hub.streamTerminalOutput("agent-1", {
      onOpen: () => events.push("open"),
      onFrame: (frame) => events.push(`frame:${frame}`),
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-1",
      subscriptionId: "sub-replay",
      frame: "replay",
    });
    await flush();

    assert.deepEqual(events, ["open", "frame:replay"]);
    resolvePost();
    await flush();
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-1",
      subscriptionId: "sub-replay",
      frame: "after-post",
    });
    await flush();
    assert.deepEqual(events, ["open", "frame:replay", "frame:after-post"]);

    ndjson.close();
    await promise;
  });

  it("gives late subscribers for the same agent their own replay subscription", async () => {
    const ndjson = makeNdjsonStream();
    const postBodies: unknown[] = [];
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      if (init.method === "POST") postBodies.push(parseBody(init));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-first", "sub-late"]),
      fetchRef,
    });
    const firstFrames: string[] = [];
    const lateFrames: string[] = [];
    const first = hub.streamTerminalOutput("agent-same", {
      replayBytes: 111,
      onFrame: (frame) => firstFrames.push(frame),
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    const late = hub.streamTerminalOutput("agent-same", {
      replayBytes: 222,
      onFrame: (frame) => lateFrames.push(frame),
    });
    await flush();
    await flush();

    assert.deepEqual(postBodies, [
      {
        agentSessionId: "agent-same",
        replayBytes: 111,
        subscriptionId: "sub-first",
      },
      {
        agentSessionId: "agent-same",
        replayBytes: 222,
        subscriptionId: "sub-late",
      },
    ]);

    ndjson.write({
      type: "frame",
      agentSessionId: "agent-same",
      subscriptionId: "sub-first",
      frame: "first-only",
    });
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-same",
      subscriptionId: "sub-late",
      frame: "late-replay",
    });
    await flush();

    assert.deepEqual(firstFrames, ["first-only"]);
    assert.deepEqual(lateFrames, ["late-replay"]);

    ndjson.close();
    await Promise.all([first, late]);
  });

  it("does not let an old DELETE remove a re-added same-agent subscription", async () => {
    const ndjson = makeNdjsonStream();
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchRef: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(input),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET") return new Response(ndjson.stream, { status: 200 });
      if (method === "DELETE") return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-old", "sub-new"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const oldAbort = new AbortController();
    const old = hub.streamTerminalOutput("agent-same", {
      signal: oldAbort.signal,
      onFrame: () => {},
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    oldAbort.abort();
    await assert.rejects(old, /aborted/i);
    const newFrames: string[] = [];
    const newer = hub.streamTerminalOutput("agent-same", {
      onFrame: (frame) => newFrames.push(frame),
    });
    await flush();
    await flush();

    assert.ok(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith("/subscriptions/sub-old"),
      ),
    );
    assert.ok(
      calls.some(
        (call) =>
          call.method === "POST" &&
          (call.body as { subscriptionId?: string }).subscriptionId ===
            "sub-new",
      ),
    );

    ndjson.write({
      type: "frame",
      agentSessionId: "agent-same",
      subscriptionId: "sub-new",
      frame: "new-live",
    });
    await flush();
    assert.deepEqual(newFrames, ["new-live"]);

    ndjson.close();
    await Promise.all([keep, newer]);
  });

  it("ignores late frames from an old stream generation", async () => {
    const oldStream = makeManualByteStream();
    const newStream = makeManualByteStream();
    const streams = [oldStream, newStream];
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) {
        const next = streams.shift();
        assert.ok(next, "expected stream response");
        return { ok: true, body: next.body } as Response;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-reused", "sub-reused"]),
      fetchRef,
    });
    const firstAbort = new AbortController();
    const first = hub.streamTerminalOutput("agent-1", {
      signal: firstAbort.signal,
      onFrame: () => {},
    });

    await flush();
    oldStream.push({ type: "ready", streamId: "stream-old" });
    await flush();
    await flush();
    firstAbort.abort();
    await assert.rejects(first, /aborted/i);

    const frames: string[] = [];
    const second = hub.streamTerminalOutput("agent-1", {
      onFrame: (frame) => frames.push(frame),
    });
    await flush();
    newStream.push({ type: "ready", streamId: "stream-new" });
    await flush();
    await flush();

    oldStream.push({
      type: "frame",
      agentSessionId: "agent-1",
      subscriptionId: "sub-reused",
      frame: "old-late",
    });
    await flush();
    assert.deepEqual(frames, []);
    assert.equal(oldStream.canceled, true);

    newStream.push({
      type: "frame",
      agentSessionId: "agent-1",
      subscriptionId: "sub-reused",
      frame: "new-live",
    });
    await flush();
    assert.deepEqual(frames, ["new-live"]);

    newStream.close();
    await second;
  });

  it("closes the shared stream when a subscription POST response is lost", async () => {
    const ndjson = makeNdjsonStream();
    let streamSignal: AbortSignal | undefined;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) {
        streamSignal = init?.signal as AbortSignal | undefined;
        return new Response(ndjson.stream, { status: 200 });
      }
      const body = parseBody(init);
      if (body.subscriptionId === "sub-lost") {
        throw new Error("lost response");
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-lost"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const lost = hub.streamTerminalOutput("agent-lost", { onFrame: () => {} });
    const keepRejected = assert.rejects(keep, /lost response/);
    const lostRejected = assert.rejects(lost, /lost response/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    await keepRejected;
    await lostRejected;
    assert.equal(streamSignal?.aborted, true);
  });

  it("isolates terminal-session 404 to the failed subscription", async () => {
    const ndjson = makeNdjsonStream();
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      const body = parseBody(init);
      if (body.subscriptionId === "sub-missing") {
        return new Response(
          JSON.stringify({
            code: "TERMINAL_SESSION_NOT_FOUND",
            error: "终端不存在",
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-good", "sub-missing"]),
      fetchRef,
    });
    const goodFrames: string[] = [];
    const good = hub.streamTerminalOutput("agent-good", {
      onFrame: (frame) => goodFrames.push(frame),
    });
    const missing = hub.streamTerminalOutput("agent-missing", {
      onFrame: () => {},
    });
    const missingRejected = assert.rejects(missing, /终端不存在/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    await missingRejected;
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-good",
      subscriptionId: "sub-good",
      frame: "still-live",
    });
    await flush();
    assert.deepEqual(goodFrames, ["still-live"]);

    ndjson.close();
    await good;
  });

  it("fails all subscribers when the control plane reports stream-not-found", async () => {
    const ndjson = makeNdjsonStream();
    let streamSignal: AbortSignal | undefined;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) {
        streamSignal = init?.signal as AbortSignal | undefined;
        return new Response(ndjson.stream, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "TERMINAL_STREAM_NOT_FOUND",
          error: "共享流失效",
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-1", "sub-2"]),
      fetchRef,
    });
    const first = hub.streamTerminalOutput("agent-1", { onFrame: () => {} });
    const second = hub.streamTerminalOutput("agent-2", { onFrame: () => {} });
    const firstRejected = assert.rejects(first, /共享流失效/);
    const secondRejected = assert.rejects(second, /共享流失效/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();

    await firstRejected;
    await secondRejected;
    assert.equal(streamSignal?.aborted, true);
  });

  it("times out subscribers waiting for the initial shared-stream ready", async () => {
    const fetchRef: typeof fetch = async () => new Promise<Response>(() => {});
    const hub = new TerminalHttpStreamHub({
      controlTimeoutMs: 1,
      createSubscriptionId: makeIdFactory(["sub-timeout"]),
      fetchRef,
    });
    const promise = hub.streamTerminalOutput("agent-1", { onFrame: () => {} });
    const rejected = assert.rejects(promise, /ready 超时/);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rejected;
  });

  it("closes the shared stream when a pending subscription POST times out", async () => {
    const ndjson = makeNdjsonStream();
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      const body = parseBody(init);
      if (body.subscriptionId === "sub-hang") {
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      controlTimeoutMs: 1,
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-hang"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const hanging = hub.streamTerminalOutput("agent-hang", {
      onFrame: () => {},
    });
    const keepRejected = assert.rejects(keep, /订阅请求超时/);
    const hangingRejected = assert.rejects(hanging, /订阅请求超时/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await keepRejected;
    await hangingRejected;
  });

  it("closes the current shared stream when DELETE fails", async () => {
    const ndjson = makeNdjsonStream();
    let streamSignal: AbortSignal | undefined;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) {
        streamSignal = init?.signal as AbortSignal | undefined;
        return new Response(ndjson.stream, { status: 200 });
      }
      if (init.method === "DELETE") {
        return new Response(JSON.stringify({ error: "delete failed" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-delete"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const deleteAbort = new AbortController();
    const deleted = hub.streamTerminalOutput("agent-delete", {
      signal: deleteAbort.signal,
      onFrame: () => {},
    });
    const keepRejected = assert.rejects(keep, /delete failed/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();
    deleteAbort.abort();

    await assert.rejects(deleted, /aborted/i);
    await keepRejected;
    assert.equal(streamSignal?.aborted, true);
  });

  it("aborts pending control requests when the shared stream ends", async () => {
    const ndjson = makeNdjsonStream();
    let postSignal: AbortSignal | undefined;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      postSignal = init.signal as AbortSignal | undefined;
      return new Promise<Response>(() => {});
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-pending"]),
      fetchRef,
    });
    const promise = hub.streamTerminalOutput("agent-1", { onFrame: () => {} });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    assert.equal(postSignal?.aborted, false);

    ndjson.close();
    await promise;
    assert.equal(postSignal?.aborted, true);
  });

  it("deletes a canceled subscription after POST headers return but before the body is consumed", async () => {
    const ndjson = makeNdjsonStream();
    let postBodyController!: ReadableStreamDefaultController<Uint8Array>;
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchRef: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(input),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET") return new Response(ndjson.stream, { status: 200 });
      if (method === "POST") {
        const body = parseBody(init);
        if (body.subscriptionId === "sub-cancel") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                postBodyController = controller;
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-cancel"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const cancelAbort = new AbortController();
    const canceled = hub.streamTerminalOutput("agent-cancel", {
      signal: cancelAbort.signal,
      onFrame: () => {},
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();
    cancelAbort.abort();
    await assert.rejects(canceled, /aborted/i);
    await flush();
    assert.equal(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith("/subscriptions/sub-cancel"),
      ),
      false,
    );

    postBodyController.close();
    await flush();
    await flush();
    assert.equal(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith("/subscriptions/sub-cancel"),
      ),
      true,
    );

    ndjson.close();
    await keep;
  });

  it("waits for a canceled pending subscription POST before deleting while the stream stays alive", async () => {
    const ndjson = makeNdjsonStream();
    let resolveCanceledPost!: () => void;
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchRef: typeof fetch = async (input, init) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(input),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "GET") return new Response(ndjson.stream, { status: 200 });
      if (method === "POST") {
        const body = parseBody(init);
        if (body.subscriptionId === "sub-cancel") {
          return new Promise<Response>((resolve) => {
            resolveCanceledPost = () =>
              resolve(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
              );
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-keep", "sub-cancel"]),
      fetchRef,
    });
    const keep = hub.streamTerminalOutput("agent-keep", { onFrame: () => {} });
    const cancelAbort = new AbortController();
    const canceled = hub.streamTerminalOutput("agent-cancel", {
      signal: cancelAbort.signal,
      onFrame: () => {},
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();
    cancelAbort.abort();
    await assert.rejects(canceled, /aborted/i);
    await flush();

    assert.equal(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith("/subscriptions/sub-cancel"),
      ),
      false,
    );

    resolveCanceledPost();
    await flush();
    await flush();
    assert.equal(
      calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.url.endsWith("/subscriptions/sub-cancel"),
      ),
      true,
    );

    ndjson.close();
    await keep;
  });

  it("aborts the shared GET immediately when the final observer cancels", async () => {
    const ndjson = makeNdjsonStream();
    let streamSignal: AbortSignal | undefined;
    let deleteRequested = false;
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) {
        streamSignal = init?.signal as AbortSignal | undefined;
        return new Response(ndjson.stream, { status: 200 });
      }
      if (init.method === "DELETE") {
        deleteRequested = true;
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-1"]),
      fetchRef,
    });
    const abort = new AbortController();
    const promise = hub.streamTerminalOutput("agent-1", {
      signal: abort.signal,
      onFrame: () => {},
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    await flush();
    abort.abort();

    await assert.rejects(promise, /aborted/i);
    await flush();
    assert.equal(deleteRequested, true);
    assert.equal(streamSignal?.aborted, true);
  });

  it("accepts a large escaped replay frame below the shared line limit", async () => {
    const ndjson = makeNdjsonStream();
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-large"]),
      fetchRef,
    });
    let receivedLength = 0;
    const promise = hub.streamTerminalOutput("agent-1", {
      onFrame: (frame) => {
        receivedLength = frame.length;
      },
    });

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    const largeControlText = "\0".repeat(512 * 1024);
    ndjson.write({
      type: "frame",
      agentSessionId: "agent-1",
      subscriptionId: "sub-large",
      frame: largeControlText,
    });
    await flush();

    assert.equal(receivedLength, largeControlText.length);
    ndjson.close();
    await promise;
  });

  it("rejects oversized incomplete NDJSON lines", async () => {
    const ndjson = makeNdjsonStream();
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-1"]),
      fetchRef,
    });
    const promise = hub.streamTerminalOutput("agent-1", { onFrame: () => {} });
    const rejected = assert.rejects(promise, /单帧超过安全上限/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    ndjson.writeRaw("x".repeat(MAX_TERMINAL_HTTP_STREAM_LINE_CHARS + 1));

    await rejected;
  });

  it("rejects oversized complete NDJSON lines", async () => {
    const ndjson = makeNdjsonStream();
    const fetchRef: typeof fetch = async (_input, init) => {
      if (!init?.method) return new Response(ndjson.stream, { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const hub = new TerminalHttpStreamHub({
      createSubscriptionId: makeIdFactory(["sub-1"]),
      fetchRef,
    });
    const promise = hub.streamTerminalOutput("agent-1", { onFrame: () => {} });
    const rejected = assert.rejects(promise, /单帧超过安全上限/);

    await flush();
    ndjson.write({ type: "ready", streamId: "stream-1" });
    await flush();
    ndjson.writeRaw(
      `${JSON.stringify({
        type: "frame",
        agentSessionId: "agent-1",
        subscriptionId: "sub-1",
        frame: "x".repeat(MAX_TERMINAL_HTTP_STREAM_LINE_CHARS),
      })}\n`,
    );

    await rejected;
  });
});
