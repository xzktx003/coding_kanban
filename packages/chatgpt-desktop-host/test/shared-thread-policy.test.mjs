import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createSharedThreadPolicy,
  createTrustedSendIntentRegistry,
} from "../src/shared-thread-policy.mjs";

function fixture(overrides = {}) {
  const binding = {
    hostId: "local",
    runtimeGeneration: randomUUID(),
    daemonGeneration: randomUUID(),
    accountRevision: 2,
    projectId: "fixture-project",
    threadId: randomUUID(),
    viewId: randomUUID(),
    clientId: randomUUID(),
  };
  const writes = [];
  const registry = createTrustedSendIntentRegistry();
  const gate = createSharedThreadPolicy({
    binding,
    intents: registry,
    verifyIdentity: async () => true,
    inspectAttachment: async () => "attached",
    inspectHistory: async () => ({
      threadId: binding.threadId,
      historyMode: "paginated",
      turnsListAvailable: true,
      appHostTailHydration: true,
      experimentalEnabled: true,
    }),
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      writes.push(frame);
      return Promise.resolve({
        id: frame.id,
        result:
          frame.method === "thread/resume"
            ? {
                thread: {
                  id: frame.params.threadId,
                  historyMode: "paginated",
                  turns: [],
                },
                turnsBackwardsCursor: null,
                itemsBackwardsCursor: null,
              }
            : {},
      });
    },
    ...overrides,
  });
  const control = () => ({
    signal: new AbortController().signal,
    deadline: performance.now() + 5000,
  });
  const read = (method, params, id = 1) =>
    JSON.stringify({ id, method, params });
  const turn = (text = "private fixture") =>
    JSON.stringify({
      id: 17,
      method: "turn/start",
      params: {
        threadId: binding.threadId,
        input: [{ type: "text", text, text_elements: [] }],
      },
    });
  return { binding, gate, registry, writes, control, read, turn };
}

test("only bounded metadata and paginated thread reads in the bound domain are accepted", async () => {
  const f = fixture();
  await f.gate.read(
    f.read("thread/read", {
      threadId: f.binding.threadId,
      includeTurns: false,
    }),
    f.control(),
  );
  await f.gate.read(
    f.read(
      "thread/turns/list",
      {
        threadId: f.binding.threadId,
        limit: 5,
        sortDirection: "desc",
        itemsView: "summary",
      },
      2,
    ),
    f.control(),
  );
  assert.deepEqual(
    f.writes.map((frame) => frame.method),
    ["thread/read", "thread/turns/list"],
  );
  for (const frame of [
    f.read("thread/read", { threadId: randomUUID(), includeTurns: false }),
    f.read("thread/read", { threadId: f.binding.threadId, includeTurns: true }),
    f.read("thread/turns/list", {
      threadId: f.binding.threadId,
      limit: 101,
      itemsView: "summary",
    }),
    f.read("thread/turns/list", {
      threadId: f.binding.threadId,
      limit: 1,
      itemsView: "full",
    }),
    f.read("thread/turns/list", {
      threadId: f.binding.threadId,
      limit: 1,
      itemsView: "summary",
      path: "/other",
    }),
  ])
    await assert.rejects(f.gate.read(frame, f.control()), {
      code: "SHARED_POLICY_DENIED",
    });
  assert.equal(f.writes.length, 2);
});

test("the bound thread can hydrate one exact turn through bounded native item pages", async () => {
  const turnId = randomUUID(), frames = [];
  const f = fixture({
    dispatch(encoded) {
      const frame = JSON.parse(encoded); frames.push(frame);
      return Promise.resolve({ id: frame.id, result: {
        data: [{ turnId, item: { id: 'item-1', type: 'userMessage', content: [] }, startedAtMs: null, completedAtMs: null }],
        nextCursor: 'next-page', backwardsCursor: null,
      } });
    },
  });
  const params = { threadId: f.binding.threadId, turnId, limit: 100, cursor: { type: 'item', itemId: 'item-0' }, sortDirection: 'desc' };
  const result = await f.gate.read(f.read('thread/items/list', params, 20), f.control());
  assert.equal(result.result.data[0].turnId, turnId);
  assert.deepEqual(frames, [{ id: 20, method: 'thread/items/list', params }]);
  for (const [i, bad] of [
    { ...params, threadId: randomUUID() }, { ...params, turnId: null },
    { ...params, turnId: 'wrong\nturn' },
    { ...params, limit: 101 }, { ...params, limit: 0 },
    { ...params, cursor: { type: 'item', itemId: 'item-0', path: '/private' } },
    { ...params, cursor: 'x'.repeat(4097) }, { ...params, sortDirection: 'sideways' },
    { ...params, extra: true },
  ].entries())
    await assert.rejects(f.gate.read(f.read('thread/items/list', bad, 21 + i), f.control()), { code: 'SHARED_POLICY_DENIED' });
  assert.equal(frames.length, 1);
});

test("a malformed or cross-turn item page is never returned as a valid history page", async () => {
  const turnId = randomUUID(); let returned;
  const f = fixture({ dispatch: (encoded) => Promise.resolve({ id: JSON.parse(encoded).id, result: returned }) });
  const params = { threadId: f.binding.threadId, turnId, limit: 1, cursor: null, sortDirection: 'asc' };
  for (const [i, value] of [
    { data: [{ turnId: randomUUID(), item: { id: 'other', type: 'userMessage' } }], nextCursor: null, backwardsCursor: null },
    { data: [{ turnId, item: { id: 'a' } }, { turnId, item: { id: 'b' } }], nextCursor: null, backwardsCursor: null },
    { data: [], nextCursor: 'x'.repeat(4097), backwardsCursor: null },
    { data: [], nextCursor: 'previous', backwardsCursor: null },
    { data: [], nextCursor: null },
  ].entries()) {
    returned = value;
    await assert.rejects(f.gate.read(f.read('thread/items/list', { ...params, cursor: i === 3 ? 'previous' : null }, 50 + i), f.control()), { code: 'SHARED_UPSTREAM_UNAVAILABLE' });
  }
});

test("unlisted, write-capable and apparent read methods are denied without dispatch", async () => {
  const f = fixture();
  for (const method of [
    "thread/subscribe",
    "thread/resume",
    "turn/start",
    "thread/queue/add",
    "account/login/start",
    "account/read",
    "config/read",
    "config/value/write",
    "plugin/list",
    "plugin/install",
    "experimentalFeature/list",
    "experimentalFeature/enablement/set",
    "fs/readFile",
    "unknown/method",
  ]) {
    await assert.rejects(
      f.gate.read(
        f.read(method, { threadId: f.binding.threadId }),
        f.control(),
      ),
      { code: "SHARED_POLICY_DENIED" },
    );
  }
  assert.equal(f.writes.length, 0);
});

test("viewer data or a forged object cannot authorize a send", async () => {
  const f = fixture();
  for (const intent of ["viewer-token", {}, { token: "viewer-token" }, null])
    await assert.rejects(f.gate.send(intent, f.control()), {
      code: "SHARED_INTENT_DENIED",
    });
  assert.equal(f.writes.length, 0);
});

test("one trusted captured send is bound to the exact thread, view, domain and bytes", async () => {
  const f = fixture();
  const intent = f.registry.captureUserSend(
    f.binding,
    f.turn("one captured message"),
  );
  const result = await f.gate.send(intent, f.control());
  assert.deepEqual(result, { id: 17, result: {} });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].params.input[0].text, "one captured message");
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  for (const key of [
    "hostId",
    "daemonGeneration",
    "runtimeGeneration",
    "accountRevision",
    "projectId",
    "threadId",
    "viewId",
    "clientId",
  ]) {
    const other = {
      ...f.binding,
      [key]: key === "accountRevision" ? 3 : randomUUID(),
    };
    const wrongIntent = f.registry.captureUserSend(
      other,
      JSON.stringify({
        id: 17,
        method: "turn/start",
        params: {
          threadId: other.threadId,
          input: [{ type: "text", text: "wrong target", text_elements: [] }],
        },
      }),
    );
    await assert.rejects(f.gate.send(wrongIntent, f.control()), {
      code: "SHARED_INTENT_DENIED",
    });
  }
  assert.equal(f.writes.length, 1);
});

test("an explicit send is the only route to minimal resume, with a fresh identity check before turn/start", async () => {
  let checks = 0;
  const f = fixture({
    inspectAttachment: async () => "must-resume",
    verifyIdentity: async () => {
      checks++;
      return true;
    },
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await f.gate.send(intent, f.control());
  assert.deepEqual(
    f.writes.map((frame) => frame.method),
    ["thread/resume", "turn/start"],
  );
  assert.deepEqual(f.writes[0].params, {
    threadId: f.binding.threadId,
    excludeTurns: true,
  });
  assert.ok(checks >= 2);
});

test("a send that requires resume cannot bypass the bounded history prerequisites", async () => {
  const f = fixture({
    inspectAttachment: async () => "must-resume",
    inspectHistory: async () => ({
      threadId: f.binding.threadId,
      historyMode: "legacy",
      turnsListAvailable: true,
      appHostTailHydration: true,
      experimentalEnabled: true,
    }),
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_HISTORY_UNSUPPORTED",
  });
  assert.deepEqual(f.writes, []);
});

test("a malformed bounded resume response never dispatches the subsequent turn", async () => {
  let f;
  f = fixture({
    inspectAttachment: async () => "must-resume",
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      f.writes.push(frame);
      return Promise.resolve({
        id: frame.id,
        result: {
          thread: {
            id: frame.params.threadId,
            historyMode: "legacy",
            turns: [],
          },
        },
      });
    },
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_OUTCOME_UNKNOWN",
  });
  assert.deepEqual(
    f.writes.map((frame) => frame.method),
    ["thread/resume"],
  );
});

test("scope invalidation between explicit resume and send prevents the turn", async () => {
  let f;
  f = fixture({
    inspectAttachment: async () => "must-resume",
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      f.writes.push(frame);
      f.gate.accountChanged();
      return Promise.resolve({ id: frame.id, result: {} });
    },
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.send(intent, f.control()));
  assert.deepEqual(
    f.writes.map((frame) => frame.method),
    ["thread/resume"],
  );
  await assert.rejects(f.gate.send(intent, f.control()));
});

test("even a same-value account notification revokes delayed reads before their actual write", async () => {
  let release, reached;
  const entered = new Promise((done) => {
    reached = done;
  });
  const held = new Promise((done) => {
    release = done;
  });
  const f = fixture({
    verifyIdentity: async () => {
      reached();
      await held;
      return true;
    },
  });
  const pending = f.gate.read(
    f.read("thread/read", {
      threadId: f.binding.threadId,
      includeTurns: false,
    }),
    f.control(),
  );
  const rejected = assert.rejects(pending, { code: "SHARED_SCOPE_REVOKED" });
  await entered;
  f.gate.accountChanged();
  release();
  await rejected;
  assert.equal(f.writes.length, 0);
});

test("a missing or changed daemon identity revokes the gate before dispatch", async () => {
  const f = fixture({ verifyIdentity: async () => false });
  await assert.rejects(
    f.gate.read(
      f.read("thread/read", {
        threadId: f.binding.threadId,
        includeTurns: false,
      }),
      f.control(),
    ),
    { code: "SHARED_SCOPE_REVOKED" },
  );
  assert.equal(f.writes.length, 0);
});

test("a dispatched write with unknown receipt cannot be resent using the same intent", async () => {
  const f = fixture({
    dispatch: () => {
      throw new Error("possibly delivered");
    },
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_OUTCOME_UNKNOWN",
  });
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
});

test("concurrent attempts cannot reuse the same trusted send intent", async () => {
  let reached, release;
  const entered = new Promise((done) => {
      reached = done;
    }),
    held = new Promise((done) => {
      release = done;
    });
  const f = fixture({
    verifyIdentity: async () => {
      reached();
      await held;
      return true;
    },
  });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  const first = f.gate.send(intent, f.control());
  await entered;
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  release();
  await first;
  assert.equal(f.writes.length, 1);
});

test("an already canceled request never starts an identity probe or a write", async () => {
  let probes = 0;
  const f = fixture({
    verifyIdentity: async () => {
      probes++;
      return true;
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.gate.read(
      f.read("thread/read", {
        threadId: f.binding.threadId,
        includeTurns: false,
      }),
      { signal: controller.signal, deadline: performance.now() + 5000 },
    ),
    { code: "SHARED_REQUEST_CANCELED" },
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(probes, 0);
  assert.equal(f.writes.length, 0);
});

test("a concurrent duplicate request id cannot steal the first pending response", async () => {
  let entered, release;
  const reached = new Promise((done) => {
      entered = done;
    }),
    held = new Promise((done) => {
      release = done;
    });
  const f = fixture({
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      f.writes.push(frame);
      entered();
      return held.then(() => ({ id: frame.id, result: {} }));
    },
  });
  const first = f.gate.read(
    f.read(
      "thread/read",
      { threadId: f.binding.threadId, includeTurns: false },
      44,
    ),
    f.control(),
  );
  await reached;
  await assert.rejects(
    f.gate.read(
      f.read(
        "thread/read",
        { threadId: f.binding.threadId, includeTurns: false },
        44,
      ),
      f.control(),
    ),
    { code: "SHARED_REQUEST_ID_USED" },
  );
  release();
  await first;
  assert.equal(f.writes.length, 1);
});

test("a read result is discarded if the native identity changes before it returns", async () => {
  let checks = 0;
  const f = fixture({ verifyIdentity: async () => ++checks === 1 });
  await assert.rejects(
    f.gate.read(
      f.read("thread/read", {
        threadId: f.binding.threadId,
        includeTurns: false,
      }),
      f.control(),
    ),
    { code: "SHARED_SCOPE_REVOKED" },
  );
  assert.equal(f.writes.length, 1);
});

test("a turn receipt after identity change is unknown and the intent stays consumed", async () => {
  let checks = 0;
  const f = fixture({ verifyIdentity: async () => ++checks <= 2 });
  const intent = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_OUTCOME_UNKNOWN",
  });
  await assert.rejects(f.gate.send(intent, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  assert.equal(f.writes.length, 1);
});

test("a readonly snapshot exceeding the chat response budget is not returned", async () => {
  const f = fixture({
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      return Promise.resolve({
        id: frame.id,
        result: { text: "x".repeat(16 * 1024 * 1024) },
      });
    },
  });
  await assert.rejects(
    f.gate.read(
      f.read("thread/read", {
        threadId: f.binding.threadId,
        includeTurns: false,
      }),
      f.control(),
    ),
    { code: "SHARED_READ_BUDGET_EXCEEDED" },
  );
});

test("a trusted activation connects once with bounded native metadata and no config overrides", async () => {
  const f = fixture();
  const intent = f.registry.captureUserConnect(f.binding);
  const response = await f.gate.connect(intent, f.control());
  assert.ok(response.result);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].method, "thread/resume");
  assert.deepEqual(f.writes[0].params, {
    threadId: f.binding.threadId,
    excludeTurns: true,
  });
  await assert.rejects(f.gate.connect(intent, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  assert.equal(f.writes.length, 1);
});

test("connect rejects missing or malformed original AppHost pagination cursors", async () => {
  for (const cursors of [
    {},
    { turnsBackwardsCursor: null },
    { turnsBackwardsCursor: 123, itemsBackwardsCursor: null },
    { turnsBackwardsCursor: null, itemsBackwardsCursor: {} },
  ]) {
    let f;
    f = fixture({
      dispatch: (encoded) => {
        const frame = JSON.parse(encoded);
        f.writes.push(frame);
        return Promise.resolve({
          id: frame.id,
          result: {
            thread: {
              id: frame.params.threadId,
              historyMode: "paginated",
              turns: [],
            },
            ...cursors,
          },
        });
      },
    });
    const receipt = f.registry.captureUserConnect(f.binding);
    await assert.rejects(f.gate.connect(receipt, f.control()), {
      code: "SHARED_OUTCOME_UNKNOWN",
    });
    assert.equal(f.writes.length, 1);
    await assert.rejects(f.gate.connect(receipt, f.control()), {
      code: "SHARED_INTENT_DENIED",
    });
  }
});

test("legacy, unknown, unpaged or unverified AppHost history cannot silently connect", async () => {
  for (const extra of [
    { historyMode: "legacy" },
    { historyMode: undefined },
    { turnsListAvailable: false },
    { appHostTailHydration: false },
    { experimentalEnabled: false },
    { threadId: randomUUID() },
  ]) {
    let f;
    f = fixture({
      inspectHistory: async () => ({
        threadId: f.binding.threadId,
        historyMode: "paginated",
        turnsListAvailable: true,
        appHostTailHydration: true,
        experimentalEnabled: true,
        ...extra,
      }),
    });
    const receipt = f.registry.captureUserConnect(f.binding);
    await assert.rejects(f.gate.connect(receipt, f.control()), {
      code: "SHARED_HISTORY_UNSUPPORTED",
    });
    assert.equal(f.writes.length, 0);
  }
});

test("connection and send intents cannot be substituted or forged by a viewer", async () => {
  const f = fixture();
  for (const receipt of ["viewer-token", {}, null])
    await assert.rejects(f.gate.connect(receipt, f.control()), {
      code: "SHARED_INTENT_DENIED",
    });
  const send = f.registry.captureUserSend(f.binding, f.turn());
  await assert.rejects(f.gate.connect(send, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  const connect = f.registry.captureUserConnect(f.binding);
  await assert.rejects(f.gate.send(connect, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  assert.equal(f.writes.length, 0);
});

test("a connection intent is bound to the exact view, account, daemon and thread", async () => {
  const f = fixture();
  for (const key of [
    "hostId",
    "daemonGeneration",
    "runtimeGeneration",
    "accountRevision",
    "projectId",
    "threadId",
    "viewId",
    "clientId",
  ]) {
    const other = {
      ...f.binding,
      [key]: key === "accountRevision" ? 3 : randomUUID(),
    };
    const receipt = f.registry.captureUserConnect(other);
    await assert.rejects(f.gate.connect(receipt, f.control()), {
      code: "SHARED_INTENT_DENIED",
    });
  }
  assert.equal(f.writes.length, 0);
});

test("account changes and cancellation prevent a captured connect from writing", async () => {
  let entered, release;
  const reached = new Promise((done) => {
      entered = done;
    }),
    held = new Promise((done) => {
      release = done;
    });
  const f = fixture({
    verifyIdentity: async () => {
      entered();
      await held;
      return true;
    },
  });
  const receipt = f.registry.captureUserConnect(f.binding);
  const pending = f.gate.connect(receipt, f.control());
  const rejected = assert.rejects(pending, { code: "SHARED_SCOPE_REVOKED" });
  await reached;
  f.gate.accountChanged();
  release();
  await rejected;
  await assert.rejects(f.gate.connect(receipt, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  assert.equal(f.writes.length, 0);
});

test("an unknown connect receipt cannot trigger a second native resume", async () => {
  let calls = 0;
  const f = fixture({
    dispatch: () => {
      calls++;
      throw new Error("receipt lost");
    },
  });
  const receipt = f.registry.captureUserConnect(f.binding);
  await assert.rejects(f.gate.connect(receipt, f.control()), {
    code: "SHARED_OUTCOME_UNKNOWN",
  });
  await assert.rejects(f.gate.connect(receipt, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
  assert.equal(calls, 1);
});

test("an oversized connect response stays unknown and is never replayed", async () => {
  const f = fixture({
    dispatch: (encoded) => {
      const frame = JSON.parse(encoded);
      return Promise.resolve({
        id: frame.id,
        result: { text: "x".repeat(16 * 1024 * 1024) },
      });
    },
  });
  const receipt = f.registry.captureUserConnect(f.binding);
  await assert.rejects(f.gate.connect(receipt, f.control()), {
    code: "SHARED_OUTCOME_UNKNOWN",
  });
  await assert.rejects(f.gate.connect(receipt, f.control()), {
    code: "SHARED_INTENT_DENIED",
  });
});
