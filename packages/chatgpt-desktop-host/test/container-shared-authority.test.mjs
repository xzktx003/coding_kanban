import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createContainerSharedAuthority } from "../src/container-shared-authority.mjs";
import { startContainerDesktopUpstream } from "../src/container-service.mjs";
import { startContainerDesktopService } from "../src/container-host-service.mjs";
const require = createRequire(import.meta.url);
const {
  createNativeSharedThreadIntegration,
} = require("../src/native-shared-thread-integration.cjs");

async function until(predicate) {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw Error("fixture deadline");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

for (const hostId of ["local", "kanban-shared-cli"]) test(`explicit connect preserves daemon result and events for ${hostId}`, async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    epoch = randomUUID(),
    attemptId = randomUUID(),
    daemonGeneration = randomUUID(),
    clientId = randomUUID();
  const sender = { id: 11, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: sender.id, viewId, window, failed: false };
  const binding = {
    hostId: hostId,
    runtimeGeneration: generation,
    daemonGeneration,
    accountRevision: 1,
    projectId: "fixture",
    threadId,
    viewId,
    clientId,
  };
  const writes = [],
    acknowledgements = [],
    events = [];
  let owner, native;
  owner = createContainerSharedAuthority({
    profileId,
    generation,
    verifyContainerSync: () => true,
    verifyOwnedViewSync: (id) => id === viewId,
    sendFrame: (frame) => native.receive(frame),
    sharedThread: {
      resolveBinding: async () => binding,
      verifyViewSync: (scope) =>
        scope.viewId === viewId &&
        scope.threadId === threadId &&
        scope.hostId === hostId,
      verifyBindingSync: (candidate) =>
        JSON.stringify(candidate) === JSON.stringify(binding),
      verifyHistorySync: (candidate) => candidate.threadId === threadId,
      verifyReadSync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: (id) => (id === sender.id ? record : null),
    getOwnedRecord: (candidate) => (candidate === sender ? record : null),
    verifyRuntimeSync: () => true,
    sendToView: (_record, frame) => acknowledgements.push(frame),
    sendFrame: (frame) => owner.receive(frame),
  });
  const nativeOwner = {
    connection: { registerHostEventHandler: () => () => {} },
  };
  const releaseEvents = native.registerHostEvents(
    nativeOwner,
    { getHostId: () => hostId },
    {
      onNotification: (frame) => events.push(frame),
      onRequest: (frame) => {
        events.push(frame);
        return true;
      },
    },
  );
  t.after(() => {
    releaseEvents();
    native.dispose();
    owner.close();
  });
  const request = {
    id: "explicit:1",
    method: "thread/resume",
    params: { threadId },
  };
  await assert.rejects(
    native.exchangeRequest({
      ...request,
      params: { threadId, excludeTurns: true },
    }),
  );
  assert.deepEqual(writes, []);
  assert.equal(
    native.lifecycle(sender, {
      type: "kanban-shared-connect-lifecycle",
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(
    await native.intent(sender, {
      type: "kanban-shared-connect-intent",
      v: 1,
      action: "connect",
      attemptId,
      profileId,
      generation,
      viewId,
      hostId: hostId,
      threadId,
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(writes.length, 0);
  const pending = native.withResume(
    sender,
    hostId,
    { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
    async () => {
      const guarded = await native.guardRequest(hostId, request);
      return native.exchangeRequest(guarded);
    },
  );
  void pending.catch(() => {});
  await until(() => writes.length === 1);
  assert.deepEqual(writes[0], {
    ...request,
    params: { threadId, excludeTurns: true },
  });
  const earlyGoal = {
    method: "thread/goal/cleared",
    params: { threadId },
    emittedAtMs: 42,
  };
  const earlyEvent = {
    method: "item/started",
    params: {
      threadId,
      turnId: "private-turn",
      item: { id: "large", text: "中".repeat(30000) },
    },
    emittedAtMs: 43,
  };
  assert.equal(owner.receiveDaemon(JSON.stringify(earlyGoal)), true);
  assert.equal(owner.receiveDaemon(JSON.stringify(earlyEvent)), true);
  assert.equal(events.length, 0);
  const response = JSON.stringify({
    id: request.id,
    result: {
      thread: { id: threadId, historyMode: "paginated", turns: [] },
      turnsBackwardsCursor: null,
      itemsBackwardsCursor: null,
    },
  });
  assert.equal(owner.receiveDaemon(response), true);
  assert.equal(await pending, response);
  await owner.waitForIdle({ timeoutMs: 1000 });
  assert.deepEqual(events, [earlyGoal, earlyEvent]);
  assert.equal(writes.length, 1);
  const turnEvent = {
    method: "turn/completed",
    params: { threadId, turn: { id: "private-turn", status: "completed" } },
  };
  const approvalEvent = {
    id: 71,
    method: "item/commandExecution/requestApproval",
    params: { threadId, turnId: "private-turn", itemId: "private-item" },
  };
  assert.equal(owner.receiveDaemon(JSON.stringify(turnEvent)), true);
  assert.equal(owner.receiveDaemon(JSON.stringify(approvalEvent)), true);
  await until(() => events.length === 4);
  assert.deepEqual(events, [earlyGoal, earlyEvent, turnEvent, approvalEvent]);
  assert.equal(native.isSharedServerResponse(nativeOwner, { id: 71 }), true);
  assert.equal(owner.receiveDaemon(JSON.stringify(approvalEvent)), true);
  await owner.waitForIdle({ timeoutMs: 200 });
  assert.equal(events.length, 4);
  const otherEvent = {
    method: "turn/completed",
    params: { threadId: randomUUID(), turn: { id: "other" } },
  };
  assert.equal(owner.receiveDaemon(JSON.stringify(otherEvent)), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 4);
  assert.equal(native.isSharedServerResponse(nativeOwner, { id: 71 }), true);
  assert.equal(
    native.lifecycle(sender, {
      type: "kanban-shared-connect-lifecycle",
      sequence: 2,
      epoch: null,
    }),
    true,
  );
  assert.equal(owner.receiveDaemon(JSON.stringify(turnEvent)), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 4);
  assert.equal(
    acknowledgements.some(
      (frame) =>
        frame.type === "kanban-shared-connect-intent-ack" &&
        frame.accepted === true,
    ),
    true,
  );
  await assert.rejects(
    native.withResume(
      sender,
      hostId,
      { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
      async () => {},
    ),
  );
  assert.equal(writes.length, 1);
  native.dispose();
  assert.equal(native.isSharedServerResponse(nativeOwner, { id: 71 }), true);
});

test("the container owner validates view and full runtime identity at the final shared write", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    epoch = randomUUID(),
    attemptId = randomUUID();
  const sender = { id: 4, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 4, viewId, window, failed: false };
  const writes = [];
  let owner,
    native,
    live = true;
  owner = createContainerSharedAuthority({
    profileId,
    generation,
    verifyContainerSync: () => live,
    verifyOwnedViewSync: (id) => id === viewId,
    sendFrame: (frame) => native.receive(frame),
    sharedThread: {
      resolveBinding: async ({ hostId, threadId, viewId }) => ({
        hostId,
        threadId,
        viewId,
        runtimeGeneration: generation,
        daemonGeneration: randomUUID(),
        clientId: randomUUID(),
        projectId: "fixture",
        accountRevision: 1,
      }),
      verifyViewSync: () => true,
      verifyBindingSync: () => true,
      verifyHistorySync: () => true,
      verifyReadSync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: (id) => (id === 4 ? record : null),
    getOwnedRecord: (value) => (value === sender ? record : null),
    verifyRuntimeSync: () => true,
    sendToView: () => {},
    sendFrame: (frame) => owner.receive(frame),
  });
  t.after(() => {
    native.dispose();
    owner.close();
  });
  native.lifecycle(sender, {
    type: "kanban-shared-connect-lifecycle",
    sequence: 1,
    epoch,
  });
  assert.equal(
    await native.intent(sender, {
      type: "kanban-shared-connect-intent",
      v: 1,
      action: "connect",
      attemptId,
      profileId,
      generation,
      viewId,
      hostId: "local",
      threadId,
      sequence: 1,
      epoch,
    }),
    true,
  );
  const result = native.withResume(
    sender,
    "local",
    { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
    async () => {
      const request = await native.guardRequest("local", {
        id: `thread/resume:${randomUUID()}`,
        method: "thread/resume",
        params: { threadId },
      });
      live = false;
      return native.dispatchRequest(request);
    },
  );
  await assert.rejects(result);
  assert.deepEqual(writes, []);
});

test("a revoked native runtime discards a delayed real-response frame", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    threadId = randomUUID();
  let owner,
    native,
    release,
    arrived,
    nativeLive = true;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const delivered = new Promise((resolve) => {
    arrived = resolve;
  });
  const writes = [];
  owner = createContainerSharedAuthority({
    profileId,
    generation,
    verifyContainerSync: () => true,
    verifyOwnedViewSync: () => true,
    sendFrame: async (frame) => {
      if (frame.type === "shared-rpc-chunk") {
        arrived();
        await held;
      }
      native.receive(frame);
    },
    sharedThread: {
      resolveBinding: async () => {
        throw Error("not used");
      },
      verifyViewSync: () => true,
      verifyBindingSync: () => true,
      verifyHistorySync: () => true,
      verifyReadSync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: () => null,
    getOwnedRecord: () => null,
    verifyRuntimeSync: () => nativeLive,
    sendToView: () => {},
    sendFrame: (frame) => owner.receive(frame),
  });
  t.after(() => {
    release();
    native.dispose();
    owner.close();
  });
  const pending = native.exchangeRequest({
    id: "late:1",
    method: "thread/read",
    params: { threadId, includeTurns: false },
  });
  void pending.catch(() => {});
  await until(() => writes.length === 1);
  assert.equal(
    owner.receiveDaemon(
      JSON.stringify({ id: "late:1", result: { thread: { id: threadId } } }),
    ),
    true,
  );
  await delivered;
  nativeLive = false;
  release();
  await assert.rejects(pending);
  assert.equal(writes.length, 1);
});

test("a native runtime revoked while acknowledging the final frame cannot return the result", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    threadId = randomUUID();
  const writes = [];
  let owner,
    native,
    live = true;
  owner = createContainerSharedAuthority({
    profileId,
    generation,
    verifyContainerSync: () => true,
    verifyOwnedViewSync: () => true,
    sendFrame: (frame) => native.receive(frame),
    sharedThread: {
      resolveBinding: async () => {
        throw Error("not used");
      },
      verifyViewSync: () => true,
      verifyBindingSync: () => true,
      verifyHistorySync: () => true,
      verifyReadSync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: () => null,
    getOwnedRecord: () => null,
    verifyRuntimeSync: () => live,
    sendToView: () => {},
    sendFrame: (frame) => {
      owner.receive(frame);
      if (frame.type === "shared-rpc-ack") live = false;
    },
  });
  t.after(() => {
    native.dispose();
    owner.close();
  });
  const pending = native.exchangeRequest({
    id: "late:2",
    method: "thread/read",
    params: { threadId, includeTurns: false },
  });
  void pending.catch(() => {});
  await until(() => writes.length === 1);
  assert.equal(
    owner.receiveDaemon(
      JSON.stringify({ id: "late:2", result: { thread: { id: threadId } } }),
    ),
    true,
  );
  await assert.rejects(pending);
  assert.equal(writes.length, 1);
});

test("shared authority requires explicit trusted callbacks and never exposes generic frames", () => {
  const profileId = randomUUID(),
    generation = randomUUID();
  assert.throws(
    () =>
      createContainerSharedAuthority({
        profileId,
        generation,
        verifyContainerSync: () => true,
        verifyOwnedViewSync: () => true,
        sendFrame: () => {},
        sharedThread: { write: () => {} },
      }),
    { code: "CONTAINER_SHARED_INVALID_CONFIG" },
  );
});

test("JSON-style shared configuration is rejected before starting a container or service", async () => {
  await assert.rejects(startContainerDesktopUpstream({ sharedThread: {} }), {
    code: "CONTAINER_SHARED_INVALID_CONFIG",
  });
  await assert.rejects(startContainerDesktopService({ sharedThread: {} }), {
    code: "CONTAINER_SHARED_INVALID_CONFIG",
  });
});
test("even trusted shared callbacks cannot activate a partial RPC path as a production container", async () => {
  let calls = 0;
  const fn = () => {
    calls++;
    return true;
  };
  const sharedThread = {
    resolveBinding: fn,
    verifyViewSync: fn,
    verifyBindingSync: fn,
    verifyHistorySync: fn,
    verifyReadSync: fn,
    write: fn,
  };
  await assert.rejects(startContainerDesktopUpstream({ sharedThread }), {
    code: "CONTAINER_SHARED_NOT_READY",
  });
  await assert.rejects(startContainerDesktopService({ sharedThread }), {
    code: "CONTAINER_SHARED_NOT_READY",
  });
  assert.equal(calls, 0);
});

test("disconnect waits for the native to acknowledge every outstanding authority reply", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    epoch = randomUUID(),
    attemptId = randomUUID();
  const sender = { id: 4, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 4, viewId, window, failed: false };
  let owner, native, release, started;
  const held = new Promise((resolve) => (release = resolve)),
    sent = new Promise((resolve) => (started = resolve));
  owner = createContainerSharedAuthority({
    profileId,
    generation,
    verifyContainerSync: () => true,
    verifyOwnedViewSync: (id) => id === viewId,
    sendFrame: async (frame) => {
      started();
      await held;
      native.receive(frame);
    },
    sharedThread: {
      resolveBinding: async ({ hostId, threadId, viewId }) => ({
        hostId,
        threadId,
        viewId,
        runtimeGeneration: generation,
        daemonGeneration: randomUUID(),
        clientId: randomUUID(),
        projectId: "fixture",
        accountRevision: 1,
      }),
      verifyViewSync: () => true,
      verifyBindingSync: () => true,
      verifyHistorySync: () => true,
      verifyReadSync: () => true,
      write: () => {},
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: () => record,
    getOwnedRecord: () => record,
    verifyRuntimeSync: () => true,
    sendToView: () => {},
    sendFrame: (frame) => owner.receive(frame),
  });
  t.after(() => {
    release();
    native.dispose();
    owner.close();
  });
  native.lifecycle(sender, {
    type: "kanban-shared-connect-lifecycle",
    sequence: 1,
    epoch,
  });
  const intent = native.intent(sender, {
    type: "kanban-shared-connect-intent",
    v: 1,
    action: "connect",
    attemptId,
    profileId,
    generation,
    viewId,
    hostId: "local",
    threadId,
    sequence: 1,
    epoch,
  });
  await sent;
  assert.equal(owner.isIdle(), false);
  release();
  assert.equal(await intent, true);
  await owner.waitForIdle({ timeoutMs: 1000 });
  assert.equal(owner.isIdle(), true);
});
