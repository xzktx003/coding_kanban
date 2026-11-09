import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
const require = createRequire(import.meta.url);
const {
  createNativeSharedThreadIntegration,
} = require("../src/native-shared-thread-integration.cjs");
const {
  createSharedThreadAuthorityWire,
} = require("../src/shared-thread-authority-wire.cjs");
const {
  createSharedThreadAuthorityServer,
} = require("../src/shared-thread-authority-channel.cjs");
const {
  createDynamicToolsRouter,
} = require("../src/dynamic-tools-routing.cjs");

test("per-view native integration routes lifecycle, attempt and original RPC through the host authority", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    epoch = randomUUID(),
    attemptId = randomUUID();
  const sender = { id: 4, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 4, viewId, window, failed: false },
    writes = [],
    messages = [];
  let integration, authority, hostWire;
  const live = { value: true };
  hostWire = createSharedThreadAuthorityWire({
    side: "host",
    sendFrame: (frame) => integration.receive(frame),
  });
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => live.value,
    verifyBindingSync: () => live.value,
    verifyHistorySync: () => live.value,
    write: (encoded) => {
      const frame = JSON.parse(encoded);
      writes.push(frame);
      queueMicrotask(() => authority.receiveDaemon(JSON.stringify({ id: frame.id, result: {
        thread: { id: threadId, historyMode: "paginated", turns: [] },
        turnsBackwardsCursor: null, itemsBackwardsCursor: null,
      }})));
    },
  });
  authority = createSharedThreadAuthorityServer({
    socket: hostWire.stream,
    profileId,
    generation,
    resolveBinding: async ({ hostId, threadId, viewId }) => ({
      hostId,
      threadId,
      viewId,
      runtimeGeneration: generation,
      daemonGeneration: randomUUID(),
      clientId: randomUUID(),
      projectId: "test",
      accountRevision: 1,
    }),
    verifyViewSync: () => live.value,
    verifyBindingSync: () => live.value,
    verifyReadSync: () => live.value,
    verifyHistorySync: () => live.value,
    gate,
  });
  integration = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: (id) => (id === 4 ? record : null),
    getOwnedRecord: (value) => (value === sender ? record : null),
    verifyRuntimeSync: () => live.value,
    sendToView: (_record, frame) => messages.push(frame),
    sendFrame: (frame) => hostWire.receive(frame),
  });
  t.after(() => {
    integration.dispose();
    authority.close();
    hostWire.close();
  });
  const dynamic = createDynamicToolsRouter({
    getRecord: (id) => (id === 4 ? record : null),
    getOwnedRecord: (value) => (value === sender ? record : null),
    withResume: integration.withResume,
  });
  assert.equal(
    integration.lifecycle(sender, {
      type: "kanban-shared-connect-lifecycle",
      sequence: 1,
      epoch,
    }),
    true,
  );
  assert.equal(
    await integration.intent(sender, {
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
  assert.equal(messages.at(-1).accepted, true);
  const manager = dynamic
    .bindManagers(
      {
        open: () => ({
          status: "ready",
          manager: {
            async resumeConversation(params) {
              const frame = await integration.guardRequest("local", {
                id: `thread/resume:${randomUUID()}`,
                method: "thread/resume",
                params: { threadId: params.conversationId },
              });
              return JSON.parse(await integration.exchangeRequest(frame));
            },
          },
        }),
      },
      sender,
    )
    .open("local").manager;
  const result = await manager.resumeConversation({
      conversationId: threadId,
      __kanbanSharedConnectAttempt: attemptId,
    });
  assert.equal(result.result.thread.id, threadId);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].params, { threadId, excludeTurns: true });
  await assert.rejects(
    manager.resumeConversation({
      conversationId: threadId,
      __kanbanSharedConnectAttempt: attemptId,
    }),
  );
  integration.retire(sender);
  assert.equal(
    await integration.intent(sender, {
      type: "kanban-shared-connect-intent",
      v: 1,
      action: "connect",
      attemptId: randomUUID(),
      profileId,
      generation,
      viewId,
      hostId: "local",
      threadId,
      sequence: 1,
      epoch,
    }),
    false,
  );
});

test("view retirement cancels a pending host binding on the same channel", async (t) => {
  const profileId = randomUUID(),
    generation = randomUUID(),
    viewId = randomUUID(),
    threadId = randomUUID(),
    epoch = randomUUID(),
    attemptId = randomUUID();
  const sender = { id: 4, isDestroyed: () => false },
    window = { webContents: sender, isDestroyed: () => false },
    record = { senderId: 4, viewId, window, failed: false },
    frames = [];
  let integration, hostWire, started, release;
  const received = new Promise((resolve) => (started = resolve)),
    hold = new Promise((resolve) => (release = resolve));
  hostWire = createSharedThreadAuthorityWire({
    side: "host",
    sendFrame: (frame) => integration.receive(frame),
  });
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => true,
    verifyBindingSync: () => true,
    verifyHistorySync: () => true,
    write: () => {},
  });
  const authority = createSharedThreadAuthorityServer({
    socket: hostWire.stream,
    profileId,
    generation,
    resolveBinding: async (request) => {
      started();
      await hold;
      return {
        ...request,
        runtimeGeneration: generation,
        daemonGeneration: randomUUID(),
        clientId: randomUUID(),
        projectId: "test",
        accountRevision: 1,
      };
    },
    verifyViewSync: () => true,
    verifyBindingSync: () => true,
    gate,
  });
  integration = createNativeSharedThreadIntegration({
    profileId,
    generation,
    getRecord: () => record,
    getOwnedRecord: () => record,
    verifyRuntimeSync: () => true,
    sendToView: () => {},
    sendFrame: (frame) => {
      frames.push(frame);
      hostWire.receive(frame);
    },
  });
  t.after(() => {
    release();
    integration.dispose();
    authority.close();
    hostWire.close();
  });
  integration.lifecycle(sender, {
    type: "kanban-shared-connect-lifecycle",
    sequence: 1,
    epoch,
  });
  const pending = integration.intent(sender, {
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
  await received;
  integration.retire(sender);
  assert.equal(await pending, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    frames.filter((frame) => frame.type === "shared-cancel-binding").length,
    1,
  );
  release();
  await new Promise((resolve) => setImmediate(resolve));
});
