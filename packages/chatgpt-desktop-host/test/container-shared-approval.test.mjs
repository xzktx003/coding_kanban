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

test("two authorized views share one manager event and either may resolve an approval exactly once", { timeout: 8000 }, async (t) => {
  const profileId = randomUUID(), generation = randomUUID(), threadId = randomUUID(), daemonGeneration = randomUUID();
  const bindings = Array.from({ length: 2 }, () => ({ hostId: "local", runtimeGeneration: generation, daemonGeneration, accountRevision: 1, projectId: "fixture", threadId, viewId: randomUUID(), clientId: randomUUID() }));
  const senders = bindings.map((_binding, index) => ({ id: 20 + index, isDestroyed: () => false }));
  const records = bindings.map((binding, index) => ({ senderId: senders[index].id, viewId: binding.viewId, window: { webContents: senders[index], isDestroyed: () => false }, failed: false }));
  const writes = [], notifications = [], approvals = [];
  let owner, native;
  owner = createContainerSharedAuthority({
    profileId, generation,
    verifyContainerSync: () => true,
    verifyOwnedViewSync: (id) => bindings.some((binding) => binding.viewId === id),
    sendFrame: (frame) => native.receive(frame),
    sharedThread: {
      resolveBinding: async (scope) => bindings.find((binding) => binding.viewId === scope.viewId),
      verifyViewSync: (scope) => scope.hostId === "local" && scope.threadId === threadId && bindings.some((binding) => binding.viewId === scope.viewId),
      verifyBindingSync: (value) => bindings.some((binding) => JSON.stringify(binding) === JSON.stringify(value)),
      verifyHistorySync: (value) => value.threadId === threadId,
      verifyReadSync: () => true,
      write: (encoded) => writes.push(JSON.parse(encoded)),
    },
  });
  native = createNativeSharedThreadIntegration({
    profileId, generation,
    getRecord: (id) => records.find((record) => record.senderId === id),
    getOwnedRecord: (sender) => records.find((record) => record.window.webContents === sender),
    verifyRuntimeSync: () => true,
    sendToView: () => {}, sendFrame: (frame) => owner.receive(frame),
  });
  const nativeOwner = { connection: { registerHostEventHandler: () => () => {} } };
  const release = native.registerHostEvents(nativeOwner, { getHostId: () => "local" }, {
    onNotification: (frame) => notifications.push(frame),
    onRequest: (frame) => { approvals.push(frame); return true; },
  });
  t.after(() => { release(); native.dispose(); owner.close(); });
  const controls = [];
  for (let index = 0; index < 2; index++) {
    const binding = bindings[index], sender = senders[index], epoch = randomUUID(), attemptId = randomUUID();
    assert.equal(native.lifecycle(sender, { type: "kanban-shared-connect-lifecycle", sequence: 1, epoch }), true);
    assert.equal(await native.intent(sender, { type: "kanban-shared-connect-intent", v: 1, action: "connect", attemptId, profileId, generation, viewId: binding.viewId, hostId: "local", threadId, sequence: 1, epoch }), true);
    const request = { id: `explicit:${index}`, method: "thread/resume", params: { threadId } };
    const pending = native.withResume(sender, "local", { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId }, async () => native.exchangeRequest(await native.guardRequest("local", request)));
    await until(() => writes.some((value) => value.id === request.id));
    assert.equal(owner.receiveDaemon(JSON.stringify({ id: request.id, result: { thread: { id: threadId, historyMode: "paginated", turns: [] }, turnsBackwardsCursor: null, itemsBackwardsCursor: null } })), true);
    await pending;
    controls.push({ sender, binding, attemptId, epoch });
  }
  const delta = { method: "item/agentMessage/delta", params: { threadId, turnId: "turn", itemId: "item", delta: "hello" } };
  const approval = { id: 71, method: "item/commandExecution/requestApproval", params: { threadId, turnId: "turn", itemId: "item" } };
  assert.equal(owner.receiveDaemon(JSON.stringify(delta)), true);
  // Identical consecutive real deltas are distinct events, not duplicate views.
  assert.equal(owner.receiveDaemon(JSON.stringify(delta)), true);
  assert.equal(owner.receiveDaemon(JSON.stringify(approval)), true);
  await owner.waitForIdle({ timeoutMs: 1000 });
  assert.deepEqual(notifications, [delta, delta]);
  assert.deepEqual(approvals, [approval]);
  const action = (control) => ({ type: "kanban-shared-approval-intent", v: 1, action: "approval", actionId: randomUUID(), profileId, generation, viewId: control.binding.viewId, hostId: "local", threadId, requestId: approval.id, itemId: "item", decision: "decline", sequence: 1, epoch: control.epoch });
  const pending = native.approvalIntent(controls[1].sender, action(controls[1]));
  await until(() => writes.length === 3);
  assert.deepEqual(writes[2], { id: 71, result: { decision: "decline" } });
  assert.equal((await native.approvalIntent(controls[0].sender, action(controls[0]))).state, "denied");
  assert.equal(owner.receiveDaemon(JSON.stringify({ method: "serverRequest/resolved", params: { threadId, requestId: approval.id } })), true);
  assert.equal((await pending).state, "resolved");
  assert.equal(writes.length, 3);
});

test("a per-view explicit approval writes the original response once and waits for daemon resolution", async (t) => {
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
    hostId: "local",
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
        scope.hostId === "local",
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
    { getHostId: () => "local" },
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
      hostId: "local",
      threadId,
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(writes.length, 0);
  const pending = native.withResume(
    sender,
    "local",
    { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
    async () => {
      const guarded = await native.guardRequest("local", request);
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
  const action = {
    type: "kanban-shared-approval-intent",
    v: 1,
    action: "approval",
    actionId: randomUUID(),
    profileId,
    generation,
    viewId,
    hostId: "local",
    threadId,
    requestId: 71,
    itemId: "private-item",
    decision: "decline",
    sequence: 1,
    epoch,
  };
  const wrong = await native.approvalIntent(sender, {
    ...action,
    itemId: "other",
  });
  assert.equal(wrong.state, "denied");
  assert.equal(writes.length, 1);
  assert.deepEqual(
    acknowledgements.find((x) => x.type === "kanban-shared-approval-result"),
    {
      type: "kanban-shared-approval-result",
      actionId: action.actionId,
      sequence: 1,
      epoch,
      state: "denied",
    },
  );
  const waiting = native.approvalIntent(sender, action);
  let done = false;
  waiting.then(() => {
    done = true;
  });
  await until(() => writes.length === 2);
  assert.deepEqual(writes[1], { id: 71, result: { decision: "decline" } });
  assert.equal(done, false);
  const repeated = await native.approvalIntent(sender, {
    ...action,
    actionId: randomUUID(),
  });
  assert.equal(repeated.state, "denied");
  assert.equal(
    owner.receiveDaemon(
      JSON.stringify({
        method: "serverRequest/resolved",
        params: { threadId, requestId: 71 },
      }),
    ),
    true,
  );
  assert.equal((await waiting).state, "resolved");
  assert.equal(writes.length, 2);
  await until(() => events.some((x) => x.method === "serverRequest/resolved"));
  assert.equal(native.isSharedServerResponse(nativeOwner, { id: 71 }), true);
  assert.equal(
    (await native.approvalIntent(sender, { ...action, actionId: randomUUID() }))
      .state,
    "denied",
  );
});

test("stale and cross-view explicit approval intents do not write", async (t) => {
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
    hostId: "local",
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
        scope.hostId === "local",
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
    { getHostId: () => "local" },
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
      hostId: "local",
      threadId,
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(writes.length, 0);
  const pending = native.withResume(
    sender,
    "local",
    { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
    async () => {
      const guarded = await native.guardRequest("local", request);
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
  const action = {
    type: "kanban-shared-approval-intent",
    v: 1,
    action: "approval",
    actionId: randomUUID(),
    profileId,
    generation,
    viewId,
    hostId: "local",
    threadId,
    requestId: 71,
    itemId: "private-item",
    decision: "decline",
    sequence: 1,
    epoch,
  };
  for (const change of [
    { viewId: randomUUID() },
    { threadId: randomUUID() },
    { hostId: "other" },
    { requestId: 72 },
    { itemId: "other" },
    { generation: randomUUID() },
    { sequence: 2 },
    { epoch: randomUUID() },
  ]) {
    assert.equal(
      (
        await native.approvalIntent(sender, {
          ...action,
          ...change,
          actionId: randomUUID(),
        })
      ).state,
      "denied",
    );
  }
  assert.equal(
    (await native.approvalIntent({ id: 11, isDestroyed: () => false }, action))
      .state,
    "denied",
  );
  assert.equal(
    native.lifecycle(sender, {
      type: "kanban-shared-connect-lifecycle",
      sequence: 2,
      epoch: null,
    }),
    true,
  );
  assert.equal(
    (await native.approvalIntent(sender, { ...action, actionId: randomUUID() }))
      .state,
    "denied",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
});

test("view retirement after a write yields unknown and prevents a retry", async (t) => {
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
    hostId: "local",
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
        scope.hostId === "local",
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
    { getHostId: () => "local" },
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
      hostId: "local",
      threadId,
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(writes.length, 0);
  const pending = native.withResume(
    sender,
    "local",
    { conversationId: threadId, __kanbanSharedConnectAttempt: attemptId },
    async () => {
      const guarded = await native.guardRequest("local", request);
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
  const action = {
    type: "kanban-shared-approval-intent",
    v: 1,
    action: "approval",
    actionId: randomUUID(),
    profileId,
    generation,
    viewId,
    hostId: "local",
    threadId,
    requestId: 71,
    itemId: "private-item",
    decision: "decline",
    sequence: 1,
    epoch,
  };
  const waiting = native.approvalIntent(sender, action);
  await until(() => writes.length === 2);
  assert.equal(
    native.lifecycle(sender, {
      type: "kanban-shared-connect-lifecycle",
      sequence: 2,
      epoch: null,
    }),
    true,
  );
  assert.equal((await waiting).state, "unknown");
  assert.equal(
    (await native.approvalIntent(sender, { ...action, actionId: randomUUID() }))
      .state,
    "denied",
  );
  assert.equal(writes.length, 2);
});
