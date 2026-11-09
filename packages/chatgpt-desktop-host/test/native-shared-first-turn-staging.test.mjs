import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  createNativeSharedThreadCreationRouter,
  readNativeSharedFirstTurnControl,
} = require("../src/native-shared-thread-creation-routing.cjs");
const { createNativeSharedThreadSendRouter } = require("../src/native-shared-thread-send-routing.cjs");

const createDenied = { code: "SHARED_CREATE_INTENT_DENIED" };
const sendDenied = { code: "SHARED_SEND_INTENT_DENIED" };
const isDenied = error => ["SHARED_CREATE_INTENT_DENIED", "SHARED_SEND_INTENT_DENIED"].includes(error?.code);

function fixture(t, { authorizeSend: sendHook } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clock = 1000, runtime = true, bindingCurrent = true;
  const profileId = randomUUID(), generation = randomUUID(), sender = { isDestroyed: () => false };
  let record = { senderId: 1, viewId: randomUUID(), window: { webContents: sender, isDestroyed: () => false } };
  const scope = { hostId: "kanban-shared-cli", runtimeGeneration: generation, daemonGeneration: randomUUID(), accountRevision: 1,
    projectId: "owned-project", cwd: "/private/owned-project", viewId: record.viewId, creationNonce: randomUUID() };
  const binding = Object.freeze({ hostId: scope.hostId, runtimeGeneration: generation, daemonGeneration: scope.daemonGeneration,
    accountRevision: 1, projectId: scope.projectId, threadId: randomUUID(), viewId: record.viewId, clientId: randomUUID() });
  const life = { type: "kanban-shared-connect-lifecycle", sequence: 1, epoch: randomUUID() };
  const message = { type: "kanban-shared-create-intent", v: 1, action: "create", profileId, generation, viewId: record.viewId,
    hostId: scope.hostId, projectId: scope.projectId, cwd: scope.cwd, clientThreadId: randomUUID(), attemptId: randomUUID(),
    sequence: life.sequence, epoch: life.epoch };
  const input = [{ type: "text", text: "original captured first message" }];
  const params = { input, cwd: scope.cwd, workspaceRoots: [scope.cwd], model: "captured-model", reasoningEffort: "high",
    __kanbanSharedCreateAttempt: message.attemptId, __kanbanSharedCreateClient: message.clientThreadId };
  const createWrites = [], sendWrites = [], bindings = [], messages = [];
  const owner = { profileId, generation, getRecord: id => id === record.senderId ? record : null,
    getOwnedRecord: s => s === sender ? record : null, verifyRuntimeSync: () => runtime,
    sendToView: (_record, m) => messages.push(m), now: () => clock };
  const creation = createNativeSharedThreadCreationRouter({ ...owner,
    resolveCreateScope: () => scope,
    authorizeCreate: (actualScope, frame, control) => { createWrites.push({ actualScope, frame, control }); return true; },
    resolveCreatedBinding: (_scope, id) => { assert.equal(id, binding.threadId); return binding; },
    onBound: b => { bindings.push(b); return true; } });
  const senderRouter = createNativeSharedThreadSendRouter({ ...owner, verifyBindingSync: b => bindingCurrent && b.threadId === binding.threadId,
    resolveBinding: () => binding, getFirstTurnControlSync: readNativeSharedFirstTurnControl,
    authorizeSend: (b, frame, control) => { sendWrites.push({ binding: b, frame, control }); return sendHook ? sendHook(b, frame, control) : true; } });
  const startFrame = () => ({ id: "create:1", method: "thread/start", params: { cwd: scope.cwd, model: "captured-model",
    config: { model_reasoning_effort: "high" } } });
  const firstFrame = (patch = {}, id = "first:1") => ({ id, method: "turn/start", params: {
    threadId: binding.threadId, input: [{ type: "text", text: "original captured first message" }],
    model: "captured-model", effort: "high", ...patch } });
  function advance(ms) { clock += ms; t.mock.timers.tick(ms); }
  async function arm() {
    assert.equal(creation.lifecycle(sender, life), true);
    assert.equal(senderRouter.lifecycle(sender, life), true);
    assert.equal(await creation.intent(sender, message), true);
    assert.equal(messages[0]?.accepted, true);
  }
  async function bind(created) {
    await creation.prepareRequest(scope.hostId, startFrame());
    await created(binding.threadId);
    assert.equal(bindings.length, 1);
  }
  async function prepare(frame = firstFrame()) {
    const first = creation.getFirstTurnContext(scope.hostId, frame);
    return first ? senderRouter.prepareFirstTurn(first.binding, frame, first.token) : senderRouter.prepareRequest(scope.hostId, frame);
  }
  function cleanup() { creation.dispose(); senderRouter.dispose(); }
  t.after(cleanup);
  return { creation, senderRouter, sender, scope, binding, life, message, params, createWrites, sendWrites, bindings,
    arm, bind, prepare, firstFrame, startFrame, advance, now: () => clock,
    revokeRuntime: () => { runtime = false; }, revokeBinding: () => { bindingCurrent = false; },
    replaceRecord: () => { record = { ...record }; } };
}

test("one captured first turn survives slow original preprocessing after timely creation, without renewing create or write", async t => {
  const f = fixture(t); await f.arm();
  await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
    await f.bind(created);
    f.advance(34_000);
    const result = await f.prepare();
    assert.equal(result.shared, false);
    assert.deepEqual(result.frame, f.firstFrame());
    assert.equal(f.createWrites.length, 1);
    assert.equal(f.sendWrites.length, 1);
    assert.equal(f.sendWrites[0].control.deadline, f.now() + 30_000);
    assert.equal(f.createWrites[0].control.deadline, 31_000);
    await assert.rejects(() => f.prepare(f.firstFrame({}, "first:retry")), sendDenied);
  });
});

for (const phase of ["unclaimed", "unbound"]) {
  test("the original create expires at thirty seconds while " + phase, async t => {
    const f = fixture(t); await f.arm();
    if (phase === "unclaimed") {
      f.advance(30_000);
      let invoked = 0;
      await assert.rejects(() => f.creation.withStart(f.sender, f.scope.hostId, f.params, () => { invoked++; }), createDenied);
      assert.equal(invoked, 0); assert.equal(f.createWrites.length, 0);
    } else {
      await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
        await f.creation.prepareRequest(f.scope.hostId, f.startFrame());
        f.advance(30_000);
        await assert.rejects(() => created(f.binding.threadId), createDenied);
        assert.equal(f.bindings.length, 0);
        await assert.rejects(() => f.prepare(), sendDenied);
      });
    }
  });
}

for (const delay of [0, 34_000]) for (const [name, patch] of [
  ["text", { input: [{ type: "text", text: "changed after authorization" }] }],
  ["model", { model: "different-model" }],
  ["effort", { effort: "low" }],
]) {
  test("a staged first turn cannot replace the captured " + name + " after " + delay + "ms", async t => {
    const f = fixture(t); await f.arm();
    await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
      await f.bind(created); f.advance(delay);
      await assert.rejects(() => f.prepare(f.firstFrame(patch)), isDenied);
      assert.equal(f.sendWrites.length, 0);
    });
  });
}

test("mutating the original caller after binding cannot replace the immutable first-message snapshot", async t => {
  const f = fixture(t); await f.arm();
  await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (clean, created) => {
    await f.bind(created);
    clean.input[0].text = "later UI draft";
    clean.model = "later-model";
    clean.reasoningEffort = "low";
    f.advance(34_000);
    const result = await f.prepare();
    assert.deepEqual(result.frame, f.firstFrame());
    assert.equal(f.sendWrites.length, 1);
  });
});

for (const [name, revoke] of [
  ["new lifecycle epoch", f => { f.creation.lifecycle(f.sender, { ...f.life, sequence: 2, epoch: randomUUID() }); }],
  ["hidden lifecycle", f => { f.creation.lifecycle(f.sender, { ...f.life, sequence: 2, epoch: null }); }],
  ["view retirement", f => { f.creation.retire(f.sender); }],
  ["replaced owned record", f => { f.replaceRecord(); }],
  ["account/runtime revocation", f => { f.revokeRuntime(); }],
  ["binding revocation", f => { f.revokeBinding(); }],
]) {
  test("a staged first turn is revoked by " + name, async t => {
    const f = fixture(t); await f.arm();
    await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
      await f.bind(created); f.advance(34_000); revoke(f);
      await assert.rejects(() => f.prepare(), isDenied);
      assert.equal(f.sendWrites.length, 0);
    });
  });
}

for (const throws of [false, true]) {
  test("a detached first turn cannot run after its original callback " + (throws ? "throws" : "returns"), async t => {
    const f = fixture(t); await f.arm();
    let captured;
    const intentional = new Error("original callback failed");
    const invoke = f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
      await f.bind(created);
      captured = f.creation.getFirstTurnContext(f.scope.hostId, f.firstFrame());
      assert.ok(captured);
      if (throws) throw intentional;
      return "original result";
    });
    if (throws) await assert.rejects(invoke, error => error === intentional);
    else assert.equal(await invoke, "original result");
    f.advance(34_000);
    await assert.rejects(() => f.senderRouter.prepareFirstTurn(captured.binding, f.firstFrame(), captured.token), sendDenied);
    assert.equal(f.sendWrites.length, 0);
  });
}

test("the actual first-frame authorization still has thirty seconds and cannot be retried after an unknown result", async t => {
  let completeAuthorization;
  const f = fixture(t, { authorizeSend: () => new Promise(resolve => { completeAuthorization = resolve; }) });
  await f.arm();
  await f.creation.withStart(f.sender, f.scope.hostId, f.params, async (_clean, created) => {
    await f.bind(created); f.advance(34_000);
    const pending = f.prepare();
    let outcome = "pending";
    pending.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    const rejected = assert.rejects(pending, sendDenied);
    assert.equal(f.sendWrites.length, 1);
    f.advance(30_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    try { assert.equal(outcome, "rejected", "an absent authorization reply must not outlive the actual write phase"); }
    finally { completeAuthorization(true); }
    await rejected;
    await assert.rejects(() => f.prepare(f.firstFrame({}, "first:retry")), sendDenied);
    assert.equal(f.sendWrites.length, 1);
  });
});
