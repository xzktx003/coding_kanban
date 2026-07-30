import test from "node:test";
import assert from "node:assert/strict";

import { AgentSessionRegistry } from "./agent-session-registry.js";

function createSession(registry: AgentSessionRegistry) {
  return registry.register({
    workspaceId: "test",
    hostId: "local",
    sourceType: "local",
    agentKind: "copilot",
    displayName: "Awaiting Input Test",
    interactionState: "running",
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInteractionState(
  registry: AgentSessionRegistry,
  sessionId: string,
  expectedState: "running",
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (registry.get(sessionId).interactionState === expectedState) {
      return;
    }

    await wait(10);
  }

  assert.equal(registry.get(sessionId).interactionState, expectedState);
}

type FakeTimeout = NodeJS.Timeout & {
  id: number;
  unrefCalled: boolean;
};

function installFakeTimers(startMs = 1_000) {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = new Map<
    FakeTimeout,
    { callback: () => void; delay: number }
  >();
  let now = startMs;
  let nextHandle = 1;

  Date.now = () => now;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const handle = {
      id: nextHandle++,
      unrefCalled: false,
      unref(this: FakeTimeout) {
        this.unrefCalled = true;
        return this;
      },
    } as unknown as FakeTimeout;
    scheduled.set(handle, {
      callback,
      delay: Number(delay ?? 0),
    });
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
    scheduled.delete(handle as FakeTimeout);
  }) as typeof clearTimeout;

  return {
    scheduled,
    fireTimeout(handle: FakeTimeout) {
      const timeout = scheduled.get(handle);
      assert.ok(timeout, `expected timeout ${handle.id} to be scheduled`);
      assert.equal(handle.unrefCalled, true);
      scheduled.delete(handle);
      now += timeout.delay;
      timeout.callback();
    },
    restore() {
      Date.now = originalNow;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
    setNow(nextNow: number) {
      now = nextNow;
    },
  };
}

test("keeps direct sessions running after screen stays unchanged", async () => {
  const registry = new AgentSessionRegistry();
  const session = createSession(registry);

  const updated = registry.appendOutput(session.id, "first frame\n", "stdout");

  assert.equal(updated.interactionState, "running");
  assert.equal(updated.stateConfidence, "medium");

  await wait(40);
  await waitForInteractionState(registry, session.id, "running");
  assert.equal(registry.get(session.id).stateConfidence, "medium");
});

test("uses configured output entry retention limit for fallback replay", () => {
  const registry = new AgentSessionRegistry(250, 3);
  const session = createSession(registry);

  registry.appendOutput(session.id, "one\n", "stdout");
  registry.appendOutput(session.id, "two\n", "stdout");
  registry.appendOutput(session.id, "three\n", "stdout");
  registry.appendOutput(session.id, "four\n", "stdout");

  assert.equal(registry.getOutputEntryLimit(), 3);
  assert.deepEqual(
    registry.getDetail(session.id).outputEntries.map((entry) => entry.text),
    ["two\n", "three\n", "four\n"],
  );
});

test("user input keeps direct sessions running after inactivity", async () => {
  const registry = new AgentSessionRegistry();
  const session = createSession(registry);

  registry.appendOutput(session.id, "first frame\n", "stdout");
  await wait(10);

  registry.noteUserInput(session.id, "hello");
  assert.equal(registry.get(session.id).interactionState, "running");

  await wait(10);
  assert.equal(registry.get(session.id).interactionState, "running");

  await wait(30);
  await waitForInteractionState(registry, session.id, "running");
});

test("repeated identical terminal redraws still keep sessions running", async () => {
  const registry = new AgentSessionRegistry();
  const session = createSession(registry);

  registry.appendOutput(session.id, "prompt> ", "stdout");
  await wait(25);

  registry.appendOutput(session.id, "\u001b[2K\rprompt> ", "stdout");
  await wait(50);
  await waitForInteractionState(registry, session.id, "running");
});

test("direct sessions do not schedule awaiting-input timers", () => {
  const originalNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  let now = 1_000;
  let nextHandle = 1;
  type FakeTimeout = NodeJS.Timeout & {
    id: number;
    unrefCalled: boolean;
  };
  const scheduled = new Map<
    FakeTimeout,
    { callback: () => void; delay: number }
  >();

  Date.now = () => now;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const handle = {
      id: nextHandle++,
      unrefCalled: false,
      unref(this: FakeTimeout) {
        this.unrefCalled = true;
        return this;
      },
    } as unknown as FakeTimeout;
    scheduled.set(handle, {
      callback,
      delay: Number(delay ?? 0),
    });
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
    scheduled.delete(handle as FakeTimeout);
  }) as typeof clearTimeout;

  try {
    const registry = new AgentSessionRegistry();
    const session = createSession(registry);

    registry.appendOutput(session.id, "prompt> ", "stdout");

    assert.equal(scheduled.size, 0);
    assert.equal(registry.get(session.id).interactionState, "running");
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("identical redraws do not reorder sessions in the board", async () => {
  const registry = new AgentSessionRegistry(60);
  const first = createSession(registry);
  const second = registry.register({
    workspaceId: "test",
    hostId: "local",
    sourceType: "local",
    agentKind: "copilot",
    displayName: "Second Session",
    interactionState: "running",
  });

  registry.appendOutput(first.id, "first prompt> ", "stdout");
  await wait(5);
  registry.appendOutput(second.id, "second prompt> ", "stdout");

  const before = registry.list().items.map((item) => item.id);

  registry.appendOutput(first.id, "\u001b[2K\rfirst prompt> ", "stdout");

  assert.deepEqual(
    registry.list().items.map((item) => item.id),
    before,
  );
});

test("heartbeat updates do not reorder sessions without new output", () => {
  const registry = new AgentSessionRegistry(60);
  const first = registry.register({
    workspaceId: "default",
    hostId: "local",
    sourceType: "local",
    agentKind: "shell",
    displayName: "Session 1",
    interactionState: "running",
  });
  const second = registry.register({
    workspaceId: "default",
    hostId: "local",
    sourceType: "local",
    agentKind: "shell",
    displayName: "Session 2",
    interactionState: "running",
  });

  const before = registry.list().items.map((item) => item.id);

  registry.syncCapturedScreen(second.id, "frame 2");

  assert.deepEqual(before, [first.id, second.id]);
  assert.deepEqual(
    registry.list().items.map((item) => item.id),
    before,
  );
});

test("tmux observe-only sessions stay detached even when screen is unchanged", async () => {
  const registry = new AgentSessionRegistry(20);
  const session = registry.register({
    workspaceId: "tmux",
    hostId: "local-tmux",
    sourceType: "remote-tmux-discovered",
    agentKind: "copilot",
    displayName: "tmux pane",
    controlMode: "observe",
    interactionState: "detached",
  });

  registry.syncCapturedScreen(session.id, "stable frame");
  await wait(50);
  const updated = registry.syncCapturedScreen(session.id, "stable frame");

  assert.equal(updated.interactionState, "detached");
  assert.equal(updated.stateConfidence, "high");
});

test("unchanged controllable tmux refreshes do not prevent idle detection", async () => {
  const idleThresholdMs = 50;
  const idleIntervalMs = 15;
  const registry = new AgentSessionRegistry(
    0,
    100,
    idleThresholdMs,
    idleIntervalMs,
  );
  const session = registry.register({
    workspaceId: "tmux",
    hostId: "local-tmux",
    sourceType: "remote-tmux-discovered",
    agentKind: "codex",
    displayName: "tmux pane",
    controlMode: "control",
    interactionState: "running",
  });
  const states: string[] = [];

  registry.subscribe((snapshot) => {
    const item = snapshot.items.find((entry) => entry.id === session.id);
    if (item) states.push(item.interactionState);
  });

  registry.syncCapturedScreen(session.id, "finished prompt");
  await wait(20);
  registry.syncCapturedScreen(session.id, "finished prompt");
  await wait(20);
  registry.syncCapturedScreen(session.id, "finished prompt");

  await wait(idleThresholdMs + idleIntervalMs + 10);

  assert.equal(registry.get(session.id).interactionState, "idle");
  assert.ok(states.includes("idle"), "subscriber should receive idle state");
});

test("direct sessions do not keep awaiting_input timers after output", () => {
  const registry = new AgentSessionRegistry();
  const session = registry.register({
    workspaceId: "test",
    hostId: "local",
    sourceType: "local",
    agentKind: "copilot",
    displayName: "unref-check",
    interactionState: "running",
  });

  registry.syncCapturedScreen(session.id, "frame-a");

  assert.equal(
    "awaitingInputTimers" in (registry as unknown as Record<string, unknown>),
    false,
  );
});

test("bursty terminal output coalesces session snapshots behind an unref-ed timer", () => {
  const timers = installFakeTimers();

  try {
    const registry = new AgentSessionRegistry(250);
    const snapshots: string[] = [];
    registry.subscribe((snapshot) => {
      snapshots.push(snapshot.items[0]?.outputPreview ?? "<empty>");
    });
    const session = registry.register({
      workspaceId: "test",
      hostId: "local",
      sourceType: "remote-tmux-discovered",
      agentKind: "shell",
      displayName: "snapshot-throttle",
      interactionState: "running",
    });

    assert.deepEqual(snapshots, ["<empty>", "<empty>"]);

    registry.appendOutput(session.id, "frame 1\n", "stdout");
    registry.appendOutput(session.id, "frame 2\n", "stdout");
    registry.appendOutput(session.id, "frame 3\n", "stdout");

    assert.equal(
      snapshots.length,
      2,
      "output bursts should not emit one full snapshot per frame",
    );
    assert.equal(timers.scheduled.size, 1);

    const [timer] = [...timers.scheduled.keys()];
    assert.equal(timer.unrefCalled, true);
    assert.ok(
      timers.scheduled.get(timer)!.delay > 0,
      "trailing snapshot should wait for the throttle window",
    );

    timers.fireTimeout(timer);
    assert.deepEqual(snapshots, ["<empty>", "<empty>", "frame 3"]);
  } finally {
    timers.restore();
  }
});

test("default snapshot coalescing keeps board-wide payloads to about once per second", () => {
  const timers = installFakeTimers();

  try {
    const registry = new AgentSessionRegistry();
    registry.subscribe(() => {});
    const session = registry.register({
      workspaceId: "test",
      hostId: "local",
      sourceType: "remote-tmux-discovered",
      agentKind: "shell",
      displayName: "snapshot-memory-budget",
      interactionState: "running",
    });

    registry.appendOutput(session.id, "frame 1\n", "stdout");

    assert.equal(timers.scheduled.size, 1);
    const [timer] = [...timers.scheduled.keys()];
    assert.ok(
      timers.scheduled.get(timer)!.delay >= 900,
      "default full-board snapshots should be coalesced to roughly 1 Hz",
    );
  } finally {
    timers.restore();
  }
});

test("immediate session updates cancel pending coalesced snapshots and publish the latest state", () => {
  const timers = installFakeTimers();

  try {
    const registry = new AgentSessionRegistry(250);
    const snapshots: string[] = [];
    registry.subscribe((snapshot) => {
      const item = snapshot.items[0];
      snapshots.push(
        item ? `${item.displayName}:${item.outputPreview ?? "<empty>"}` : "",
      );
    });
    const session = registry.register({
      workspaceId: "test",
      hostId: "local",
      sourceType: "remote-tmux-discovered",
      agentKind: "shell",
      displayName: "snapshot-throttle",
      interactionState: "running",
    });

    registry.appendOutput(session.id, "frame 1\n", "stdout");
    assert.equal(
      snapshots.length,
      2,
      "high-frequency output should wait for the trailing snapshot",
    );
    assert.equal(timers.scheduled.size, 1);

    registry.updateSession(session.id, {
      displayName: "snapshot-renamed",
    });

    assert.equal(
      timers.scheduled.size,
      0,
      "immediate updates should cancel pending trailing snapshots",
    );
    assert.equal(snapshots.at(-1), "snapshot-renamed:frame 1");
  } finally {
    timers.restore();
  }
});

test("idle detection transitions running sessions to idle after inactivity", async () => {
  const idleThresholdMs = 50;
  const idleIntervalMs = 20;
  const registry = new AgentSessionRegistry(0, 100, idleThresholdMs, idleIntervalMs);
  const session = createSession(registry);

  registry.appendOutput(session.id, "working...\n", "stdout");
  assert.equal(registry.get(session.id).interactionState, "running");

  const states: string[] = [];
  registry.subscribe((snapshot) => {
    const item = snapshot.items.find((s) => s.id === session.id);
    if (item) states.push(item.interactionState);
  });

  await wait(idleThresholdMs + idleIntervalMs + 10);

  assert.equal(registry.get(session.id).interactionState, "idle");
  assert.equal(registry.get(session.id).stateConfidence, "low");
  assert.ok(states.includes("idle"), "subscriber should receive idle state");
});

test("idle detection does not fire for sessions that keep producing output", async () => {
  const idleThresholdMs = 60;
  const idleIntervalMs = 20;
  const registry = new AgentSessionRegistry(0, 100, idleThresholdMs, idleIntervalMs);
  const session = createSession(registry);

  registry.subscribe(() => {});

  registry.appendOutput(session.id, "frame 1\n", "stdout");
  await wait(30);
  registry.appendOutput(session.id, "frame 2\n", "stdout");
  await wait(30);
  registry.appendOutput(session.id, "frame 3\n", "stdout");
  await wait(30);

  assert.equal(registry.get(session.id).interactionState, "running");
});

test("user input resets session back to running after idle", async () => {
  const idleThresholdMs = 40;
  const idleIntervalMs = 15;
  const registry = new AgentSessionRegistry(0, 100, idleThresholdMs, idleIntervalMs);
  const session = createSession(registry);

  registry.subscribe(() => {});
  registry.appendOutput(session.id, "done\n", "stdout");

  await wait(idleThresholdMs + idleIntervalMs + 10);
  assert.equal(registry.get(session.id).interactionState, "idle");

  registry.noteUserInput(session.id, "next command");
  assert.equal(registry.get(session.id).interactionState, "running");
});
