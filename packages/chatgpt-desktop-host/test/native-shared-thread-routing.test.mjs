import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
const require = createRequire(import.meta.url);
const {
  createNativeSharedThreadRouter,
} = require("../src/native-shared-thread-routing.cjs");
function fixture() {
  const profileId = randomUUID(),
    generation = randomUUID(),
    records = new Map(),
    owned = new WeakMap(),
    sent = [],
    authorized = [];
  function view(id) {
    const sender = { id, isDestroyed: () => false },
      window = { webContents: sender, isDestroyed: () => false };
    const record = {
      viewId: randomUUID(),
      senderId: id,
      window,
      failed: false,
    };
    records.set(id, record);
    owned.set(sender, record);
    return { record, sender };
  }
  const a = view(1),
    b = view(2),
    identity = { live: true, revision: 1 };
  let authorizer = async (binding, frame, control) => {
    authorized.push({ binding, frame, control });
    return true;
  };
  const router = createNativeSharedThreadRouter({
    profileId,
    generation,
    getRecord: (id) => records.get(id),
    getOwnedRecord: (sender) => owned.get(sender),
    verifyRuntimeSync: () => identity.live,
    resolveBinding: async (record, { hostId, threadId }) => ({
      hostId,
      threadId,
      projectId: "private-project",
      viewId: record.viewId,
      clientId: randomUUID(),
      runtimeGeneration: generation,
      daemonGeneration: randomUUID(),
      accountRevision: identity.revision,
    }),
    verifyBinding: async (binding) =>
      identity.live && binding.accountRevision === identity.revision,
    verifyBindingSync: (binding) =>
      identity.live && binding.accountRevision === identity.revision,
    authorizeRequest: (...args) => authorizer(...args),
    sendToView: (record, message) => sent.push({ record, message }),
  });
  function activate(view, sequence = 1) {
    const epoch = randomUUID();
    assert.equal(
      router.lifecycle(view.sender, {
        type: "kanban-shared-connect-lifecycle",
        sequence,
        epoch,
      }),
      true,
    );
    return epoch;
  }
  async function intent(view, epoch, sequence = 1, expected = true) {
    const threadId = randomUUID(),
      attemptId = randomUUID(),
      hostId = "local";
    const message = {
      type: "kanban-shared-connect-intent",
      v: 1,
      action: "connect",
      attemptId,
      profileId,
      generation,
      viewId: view.record.viewId,
      hostId,
      threadId,
      sequence,
      epoch,
    };
    assert.equal(await router.intent(view.sender, message), expected);
    return message;
  }
  return {
    profileId,
    generation,
    a,
    b,
    router,
    sent,
    identity,
    authorized,
    activate,
    intent,
    setAuthorizer(fn) {
      authorizer = fn;
    },
  };
}
test("the exact owned view and thread bind one intent to the original RPC id and minimal resume", async () => {
  const f = fixture(),
    epoch = f.activate(f.a),
    intent = await f.intent(f.a, epoch),
    id = `thread/resume:${randomUUID()}`;
  try {
    const params = {
      conversationId: intent.threadId,
      model: null,
      __kanbanSharedConnectAttempt: intent.attemptId,
    };
    const output = await f.router.withResume(
      f.a.sender,
      "local",
      params,
      async (clean) => {
        assert.equal(
          Object.hasOwn(clean, "__kanbanSharedConnectAttempt"),
          false,
        );
        return f.router.guardRequest("local", {
          id,
          method: "thread/resume",
          params: {
            threadId: intent.threadId,
            cwd: "/other",
            config: { secret: true },
            permissions: { x: true },
          },
          trace: "original",
        });
      },
    );
    assert.deepEqual(output, {
      id,
      method: "thread/resume",
      params: { threadId: intent.threadId, excludeTurns: true },
      trace: "original",
    });
    assert.equal(f.authorized.length, 1);
    assert.equal(f.authorized[0].frame.id, id);
    await assert.rejects(
      f.router.withResume(f.a.sender, "local", params, () => {}),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
    await assert.rejects(
      f.router.guardRequest("local", {
        id,
        method: "thread/resume",
        params: { threadId: intent.threadId },
      }),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
  } finally {
    f.router.dispose();
  }
});
test("cross-view or wrong-thread intent and automatic resume are denied", async () => {
  const f = fixture(),
    epoch = f.activate(f.a);
  f.activate(f.b);
  const intent = await f.intent(f.a, epoch);
  try {
    await assert.rejects(
      f.router.withResume(
        f.b.sender,
        "local",
        {
          conversationId: intent.threadId,
          __kanbanSharedConnectAttempt: intent.attemptId,
        },
        () => {},
      ),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
    await assert.rejects(
      f.router.withResume(
        f.a.sender,
        "local",
        {
          conversationId: randomUUID(),
          __kanbanSharedConnectAttempt: intent.attemptId,
        },
        () => {},
      ),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
    await assert.rejects(
      f.router.withResume(
        f.a.sender,
        "local",
        { conversationId: intent.threadId },
        () => {},
      ),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
    assert.equal(f.authorized.length, 0);
  } finally {
    f.router.dispose();
  }
});
test("scope revocation while the authorization handoff waits blocks the late original RPC", async () => {
  const f = fixture(),
    epoch = f.activate(f.a),
    intent = await f.intent(f.a, epoch);
  let release;
  f.setAuthorizer(
    (_binding, _frame, control) =>
      new Promise((resolve) => {
        release = () => resolve(true);
        control.signal.addEventListener("abort", () => resolve(false), {
          once: true,
        });
      }),
  );
  try {
    const pending = f.router.withResume(
      f.a.sender,
      "local",
      {
        conversationId: intent.threadId,
        __kanbanSharedConnectAttempt: intent.attemptId,
      },
      () =>
        f.router.guardRequest("local", {
          id: `thread/resume:${randomUUID()}`,
          method: "thread/resume",
          params: { threadId: intent.threadId },
        }),
    );
    for (let i = 0; i < 20 && !release; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(release);
    f.router.retire(f.a.sender);
    release();
    await assert.rejects(pending, { code: "SHARED_NAV_INTENT_DENIED" });
  } finally {
    f.router.dispose();
  }
});
test("account revisions and duplicate IDs revoke old intents without retry", async () => {
  const f = fixture(),
    epoch = f.activate(f.a),
    first = await f.intent(f.a, epoch);
  try {
    f.identity.revision++;
    await assert.rejects(
      f.router.withResume(
        f.a.sender,
        "local",
        {
          conversationId: first.threadId,
          __kanbanSharedConnectAttempt: first.attemptId,
        },
        () => {},
      ),
      { code: "SHARED_NAV_INTENT_DENIED" },
    );
    const second = await f.intent(f.a, epoch),
      id = `thread/resume:${randomUUID()}`;
    const run = (message) =>
      f.router.withResume(
        f.a.sender,
        "local",
        {
          conversationId: message.threadId,
          __kanbanSharedConnectAttempt: message.attemptId,
        },
        () =>
          f.router.guardRequest("local", {
            id,
            method: "thread/resume",
            params: { threadId: message.threadId },
          }),
      );
    await run(second);
    const third = await f.intent(f.a, epoch);
    await assert.rejects(run(third), { code: "SHARED_NAV_INTENT_DENIED" });
    assert.equal(f.authorized.length, 1);
  } finally {
    f.router.dispose();
  }
});
test("retired but unresolved native manager calls remain counted, and late completions are rejected", async () => {
  const f = fixture(),
    pending = [],
    releases = [];
  let epoch = f.activate(f.a);
  try {
    for (let i = 0; i < 16; i++) {
      const intent = await f.intent(f.a, epoch, i + 1);
      const call = f.router.withResume(
        f.a.sender,
        "local",
        {
          conversationId: intent.threadId,
          __kanbanSharedConnectAttempt: intent.attemptId,
        },
        () => new Promise((resolve) => releases.push(resolve)),
      );
      call.catch(() => {});
      pending.push(call);
      for (let j = 0; j < 20 && releases.length <= i; j++)
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(releases.length, i + 1);
      epoch = f.activate(f.a, i + 2);
    }
    await f.intent(f.a, epoch, 17, false);
    releases[0]({ status: "late" });
    await assert.rejects(pending[0], { code: "SHARED_NAV_INTENT_DENIED" });
    await f.intent(f.a, epoch, 17, true);
  } finally {
    for (const release of releases) release({});
    f.router.dispose();
  }
});
test("a per-view original request is registered and dispatched exactly once through the final daemon gate", async () => {
  const f = fixture(),
    writes = [],
    epoch = f.activate(f.a),
    intent = await f.intent(f.a, epoch);
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => true,
    verifyBindingSync: (b) =>
      f.identity.live && b.accountRevision === f.identity.revision,
    verifyHistorySync: () => true,
    write: (encoded) => {
      writes.push(JSON.parse(encoded));
    },
  });
  f.setAuthorizer((binding, frame, control) =>
    gate.registerConnect(binding, frame, control),
  );
  try {
    const id = `thread/resume:${randomUUID()}`;
    await f.router.withResume(
      f.a.sender,
      "local",
      {
        conversationId: intent.threadId,
        __kanbanSharedConnectAttempt: intent.attemptId,
      },
      async () => {
        const frame = await f.router.guardRequest("local", {
          id,
          method: "thread/resume",
          params: { threadId: intent.threadId, config: { ignored: true } },
        });
        gate.write(JSON.stringify(frame));
        const response = {
          id,
          result: {
            thread: {
              id: intent.threadId,
              historyMode: "paginated",
              turns: [],
            },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          },
        };
        assert.deepEqual(
          JSON.parse(gate.receive(JSON.stringify(response))),
          response,
        );
      },
    );
    assert.deepEqual(writes, [
      {
        id,
        method: "thread/resume",
        params: { threadId: intent.threadId, excludeTurns: true },
      },
    ]);
    assert.throws(() => gate.write(JSON.stringify(writes[0])), {
      code: "SHARED_DAEMON_DENIED",
    });
  } finally {
    gate.close();
    f.router.dispose();
  }
});
