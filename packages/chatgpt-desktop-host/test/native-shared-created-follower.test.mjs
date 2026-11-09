import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNativeSharedThreadCreationRouter, readNativeSharedFirstTurnControl } = require("../src/native-shared-thread-creation-routing.cjs");
const { createNativeSharedThreadRouter } = require("../src/native-shared-thread-routing.cjs");

test("actual start binding adopts original follower via one-use creation context, without empty-thread resume", async () => {
  const profileId = randomUUID(), generation = randomUUID(), viewId = randomUUID(), sender = { isDestroyed: () => false };
  const record = { senderId: 1, viewId, window: { webContents: sender, isDestroyed: () => false } };
  const scope = { hostId: "kanban-shared-cli", runtimeGeneration: generation, daemonGeneration: randomUUID(), accountRevision: 1, projectId: "owned", cwd: "/private/owned", viewId, creationNonce: randomUUID() };
  const threadId = randomUUID(), binding = { hostId: scope.hostId, runtimeGeneration: generation, daemonGeneration: scope.daemonGeneration, accountRevision: 1, projectId: scope.projectId, threadId, viewId, clientId: randomUUID() };
  let resumes = 0, connects = 0, retired = 0, token, first;
  const common = { profileId, generation, getRecord: () => record, getOwnedRecord: s => s === sender ? record : undefined, verifyRuntimeSync: () => true, sendToView: () => {} };
  const existing = createNativeSharedThreadRouter({ ...common, resolveBinding: async () => { resumes++; throw new Error("resume unavailable"); }, verifyBinding: async () => true, verifyBindingSync: () => true,
    authorizeRequest: async () => { resumes++; throw new Error("resume unavailable"); }, onConnected: async () => { connects++; return true; }, onRetired: () => { retired++; } });
  const creation = createNativeSharedThreadCreationRouter({ ...common, resolveCreateScope: async () => scope, authorizeCreate: async () => true, resolveCreatedBinding: async () => binding,
    onBound: (b, _control, t) => { token = t; return existing.adoptCreatedBinding(b, t); } });
  const life = { type: "kanban-shared-connect-lifecycle", sequence: 1, epoch: randomUUID() };
  existing.lifecycle(sender, life); creation.lifecycle(sender, life);
  const attemptId = randomUUID(), clientThreadId = randomUUID();
  await creation.intent(sender, { type: "kanban-shared-create-intent", v: 1, action: "create", profileId, generation, viewId, hostId: scope.hostId, projectId: scope.projectId, cwd: scope.cwd, clientThreadId, attemptId, sequence: life.sequence, epoch: life.epoch });
  await creation.withStart(sender, scope.hostId, { cwd: scope.cwd, workspaceRoots: [scope.cwd], input: [{ type: "text", text: "original" }], __kanbanSharedCreateAttempt: attemptId, __kanbanSharedCreateClient: clientThreadId }, async (_clean, created) => {
    await creation.prepareRequest(scope.hostId, { id: "real-start", method: "thread/start", params: { cwd: scope.cwd } });
    await created(threadId);
    assert.equal(existing.isFollowing(binding, attemptId), true);
    first = creation.getFirstTurnContext(scope.hostId, { method: "turn/start", params: { threadId } });
    assert.ok(first); assert.equal(readNativeSharedFirstTurnControl(binding, first.token).signal.aborted, false);
    assert.equal(readNativeSharedFirstTurnControl({ ...binding, threadId: randomUUID() }, first.token), null);
    assert.equal(readNativeSharedFirstTurnControl(binding, {}), null);
  });
  assert.equal(existing.isFollowing(binding, attemptId), true); assert.equal(resumes, 0); assert.equal(connects, 1);
  assert.equal(readNativeSharedFirstTurnControl(binding, first.token), null);
  assert.equal(creation.getFirstTurnContext(scope.hostId, { method: "turn/start", params: { threadId } }), null);
  await assert.rejects(() => existing.adoptCreatedBinding(binding, token), { code: "SHARED_NAV_INTENT_DENIED" });
  await assert.rejects(() => existing.adoptCreatedBinding(binding, {}), { code: "SHARED_NAV_INTENT_DENIED" });
  existing.lifecycle(sender, { ...life, sequence: 2, epoch: null });
  assert.equal(existing.isFollowing(binding, attemptId), false); assert.equal(retired, 1);
  existing.dispose(); creation.dispose();
});
