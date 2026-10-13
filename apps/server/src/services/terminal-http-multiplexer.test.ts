import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ServerResponse } from "node:http";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import {
  TerminalHttpMultiplexer,
  normalizeReplayBytes,
} from "./terminal-http-multiplexer.js";
import type { PtyRuntimeManager } from "./pty-runtime-manager.js";

class FakeResponse extends EventEmitter {
  destroyed = false;
  ended = false;
  writableLength = 0;
  writes: string[] = [];

  constructor(
    private readonly options: { trackWritableLength?: boolean } = {},
  ) {
    super();
  }

  write(data: string): boolean {
    this.writes.push(data);
    if (this.options.trackWritableLength) {
      this.writableLength += Buffer.byteLength(data);
    }
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

function parseLines(response: FakeResponse): unknown[] {
  return response.writes
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function createFakePtyRuntime(scrollback = "seed-output") {
  const listeners = new Map<string, Set<(data: string) => void>>();
  const unsubscribed: string[] = [];
  const released: Array<{ agentSessionId: string; connectionId: string }> = [];
  const ptyRuntimeManager = {
    has(agentSessionId: string) {
      return agentSessionId === "pty-session";
    },
    getScrollback(agentSessionId: string) {
      assert.equal(agentSessionId, "pty-session");
      return scrollback;
    },
    subscribe(agentSessionId: string, listener: (data: string) => void) {
      const set = listeners.get(agentSessionId) ?? new Set();
      set.add(listener);
      listeners.set(agentSessionId, set);
      return () => {
        set.delete(listener);
        unsubscribed.push(agentSessionId);
      };
    },
    releaseTerminalConnection(agentSessionId: string, connectionId: string) {
      released.push({ agentSessionId, connectionId });
    },
  } as unknown as PtyRuntimeManager;

  return {
    emit(agentSessionId: string, data: string) {
      for (const listener of listeners.get(agentSessionId) ?? []) {
        listener(data);
      }
    },
    ptyRuntimeManager,
    released,
    unsubscribed,
  };
}

test("normalizeReplayBytes accepts numbers and numeric strings while rejecting unsafe values", () => {
  assert.equal(normalizeReplayBytes(undefined), undefined);
  assert.equal(normalizeReplayBytes(1024), "1024");
  assert.equal(normalizeReplayBytes("2048"), "2048");
  assert.equal(normalizeReplayBytes(0), null);
  assert.equal(normalizeReplayBytes(-1), null);
  assert.equal(normalizeReplayBytes(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(normalizeReplayBytes("1.5"), null);
  assert.equal(normalizeReplayBytes("not-a-number"), null);
});

test("TerminalHttpMultiplexer streams replay and live fake PTY frames with cleanup", () => {
  const registry = new AgentSessionRegistry();
  const fakePty = createFakePtyRuntime();
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    { maxScrollbackBytes: 1024 },
  );
  const response = new FakeResponse();
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );

  const subscriptionId = randomUUID();
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId,
    }),
    "ok",
  );
  fakePty.emit("pty-session", "live-output");

  const frames = parseLines(response) as Array<{
    type: string;
    streamId?: string;
    subscriptionId?: string;
    agentSessionId?: string;
    frame?: string;
  }>;
  assert.equal(frames[0]!.type, "ready");
  assert.equal(frames[0]!.streamId, streamId);
  assert.equal(frames[1]!.subscriptionId, subscriptionId);
  assert.equal(frames[1]!.agentSessionId, "pty-session");
  assert.match(JSON.parse(frames[1]!.frame!).data, /seed-output/);
  assert.equal(JSON.parse(frames[2]!.frame!).event, "replay-complete");
  assert.equal(frames[3]!.subscriptionId, subscriptionId);
  assert.equal(frames[3]!.frame, "live-output");

  assert.equal(multiplexer.unsubscribe(streamId, subscriptionId), "ok");
  assert.deepEqual(fakePty.unsubscribed, ["pty-session"]);
  assert.equal(fakePty.released.length, 1);
  multiplexer.closeStream(streamId);
});

test("TerminalHttpMultiplexer allows independent subscriptions for the same agent", () => {
  const registry = new AgentSessionRegistry();
  const fakePty = createFakePtyRuntime();
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    { maxScrollbackBytes: 1024 },
  );
  const response = new FakeResponse();
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );
  const firstSubscriptionId = randomUUID();
  const secondSubscriptionId = randomUUID();

  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: firstSubscriptionId,
    }),
    "ok",
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: secondSubscriptionId,
    }),
    "ok",
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: firstSubscriptionId,
    }),
    "ok",
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "other-session",
      subscriptionId: firstSubscriptionId,
    }),
    "conflict",
  );

  const frames = parseLines(response) as Array<{
    type: string;
    subscriptionId?: string;
    agentSessionId?: string;
    frame?: string;
  }>;
  const replayFrames = frames.filter(
    (frame) =>
      frame.type === "frame" && JSON.parse(frame.frame!).event === "replay",
  );
  assert.deepEqual(
    replayFrames.map((frame) => frame.subscriptionId),
    [firstSubscriptionId, secondSubscriptionId],
  );

  assert.equal(multiplexer.unsubscribe(streamId, firstSubscriptionId), "ok");
  assert.deepEqual(fakePty.unsubscribed, ["pty-session"]);
  fakePty.emit("pty-session", "second-still-live");

  const liveFrames = parseLines(response).filter((frame) => {
    const typed = frame as { frame?: string };
    return typed.frame === "second-still-live";
  }) as Array<{ subscriptionId?: string; frame?: string }>;
  assert.deepEqual(
    liveFrames.map((frame) => frame.subscriptionId),
    [secondSubscriptionId],
  );

  multiplexer.closeStream(streamId);
  assert.deepEqual(fakePty.unsubscribed, ["pty-session", "pty-session"]);
  assert.equal(fakePty.released.length, 2);
});

test("TerminalHttpMultiplexer keeps a large legal replay within the default queue budget", () => {
  const registry = new AgentSessionRegistry();
  const largeEscapedReplay = "\\".repeat(512 * 1024);
  const fakePty = createFakePtyRuntime(largeEscapedReplay);
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    { maxScrollbackBytes: 512 * 1024 },
  );
  const response = new FakeResponse({ trackWritableLength: true });
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );

  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: randomUUID(),
    }),
    "ok",
  );

  assert.equal(response.destroyed, false);
  assert.equal(multiplexer.getActiveStreamCount(), 1);
  assert.ok(response.writableLength > 1024 * 1024);

  multiplexer.closeStream(streamId);
});

test("TerminalHttpMultiplexer closes responses during closeAllStreams", () => {
  const registry = new AgentSessionRegistry();
  const fakePty = createFakePtyRuntime();
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    { maxScrollbackBytes: 1024 },
  );
  const response = new FakeResponse();
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: randomUUID(),
    }),
    "ok",
  );

  multiplexer.closeAllStreams();

  assert.equal(response.ended, true);
  assert.equal(response.destroyed, true);
  assert.equal(multiplexer.getActiveStreamCount(), 0);
  assert.deepEqual(fakePty.unsubscribed, ["pty-session"]);
  assert.equal(fakePty.released.length, 1);
});

test("TerminalHttpMultiplexer cleans up when replay closes a slow client", () => {
  const registry = new AgentSessionRegistry();
  const fakePty = createFakePtyRuntime();
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    { maxScrollbackBytes: 1024, maxWritableQueueBytes: 128 },
  );
  const response = new FakeResponse();
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );

  response.writableLength = 129;
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: randomUUID(),
    }),
    "missing-stream",
  );
  assert.equal(response.destroyed, true);
  assert.equal(multiplexer.getActiveStreamCount(), 0);
  assert.deepEqual(fakePty.unsubscribed, ["pty-session"]);
  assert.equal(fakePty.released.length, 1);
});

test("TerminalHttpMultiplexer bounds subscribers and closes slow clients", () => {
  const registry = new AgentSessionRegistry();
  const fakePty = createFakePtyRuntime();
  const multiplexer = new TerminalHttpMultiplexer(
    { registry, ptyRuntimeManager: fakePty.ptyRuntimeManager },
    {
      maxScrollbackBytes: 1024,
      maxSubscriptions: 1,
      maxWritableQueueBytes: 1024,
    },
  );
  const response = new FakeResponse();
  const streamId = multiplexer.createStream(
    response as unknown as ServerResponse,
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "pty-session",
      subscriptionId: randomUUID(),
    }),
    "ok",
  );
  assert.equal(
    multiplexer.subscribe(streamId, {
      agentSessionId: "registry-session",
      subscriptionId: randomUUID(),
    }),
    "too-many",
  );

  response.writableLength = 1025;
  fakePty.emit("pty-session", "after-backpressure");
  assert.equal(response.destroyed, true);
  assert.equal(multiplexer.getActiveStreamCount(), 0);
  assert.deepEqual(fakePty.unsubscribed, ["pty-session"]);
  multiplexer.closeStream(streamId);
});
