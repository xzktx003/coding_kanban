import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createSharedApprovalGate,
} = require("../src/shared-thread-approval.cjs");

function setup() {
  const binding = Object.freeze({
    hostId: "local",
    runtimeGeneration: randomUUID(),
    daemonGeneration: randomUUID(),
    accountRevision: 1,
    projectId: "project",
    threadId: randomUUID(),
    viewId: randomUUID(),
    clientId: randomUUID(),
  });
  const attemptId = randomUUID(),
    itemId = "item-123",
    turnId = randomUUID();
  const request = {
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: { threadId: binding.threadId, turnId, itemId },
  };
  const output = [];
  let live = true,
    writer = (encoded) => output.push(encoded);
  const gate = createSharedApprovalGate({
    verifyBindingSync: (b) =>
      live && JSON.stringify(b) === JSON.stringify(binding),
    verifyHistorySync: () => live,
    write: (s) => writer(s),
  });
  const action = (overrides = {}) => ({
    binding,
    attemptId,
    actionId: randomUUID(),
    requestId: request.id,
    turnId,
    itemId,
    method: request.method,
    decision: "decline",
    signal: new AbortController().signal,
    deadline: performance.now() + 5000,
    ...overrides,
  });
  return {
    binding,
    attemptId,
    request,
    output,
    gate,
    action,
    revoke: () => {
      live = false;
    },
    setWriter: (f) => {
      writer = f;
    },
  };
}

test("one real approval can be observed in two authorized views but is resolved at most once", async () => {
  const f = setup();
  const other = { ...f.binding, viewId: randomUUID(), clientId: randomUUID() };
  const attempt = randomUUID(), writes = [];
  const gate = createSharedApprovalGate({
    verifyBindingSync: (b) => [f.binding, other].some((candidate) => JSON.stringify(candidate) === JSON.stringify(b)),
    verifyHistorySync: () => true,
    write: (encoded) => writes.push(encoded),
  });
  try {
    assert.equal(gate.observe(f.binding, f.attemptId, f.request), true);
    assert.equal(gate.observe(other, attempt, f.request), true);
    const second = f.action({ binding: other, attemptId: attempt });
    const first = f.action();
    const pending = gate.reply(second);
    await assert.rejects(gate.reply(first), { code: "SHARED_APPROVAL_DENIED" });
    assert.deepEqual(writes.map(JSON.parse), [{ id: f.request.id, result: { decision: "decline" } }]);
    assert.equal(gate.observeResolved({ method: "serverRequest/resolved", params: { threadId: f.binding.threadId, requestId: f.request.id } }), true);
    assert.equal((await pending).state, "resolved");
    await assert.rejects(gate.reply(f.action()), { code: "SHARED_APPROVAL_DENIED" });
    assert.equal(writes.length, 1);
  } finally { gate.close(); f.gate.close(); }
});

test("retiring one view revokes only its approval authority and allows a new exact view", async () => {
  const f = setup();
  const other = { ...f.binding, viewId: randomUUID(), clientId: randomUUID() };
  const oldAttempt = randomUUID(), freshAttempt = randomUUID(), writes = [];
  const gate = createSharedApprovalGate({
    verifyBindingSync: (b) => [f.binding, other].some((candidate) => JSON.stringify(candidate) === JSON.stringify(b)),
    verifyHistorySync: () => true,
    write: (encoded) => writes.push(encoded),
  });
  try {
    assert.equal(gate.observe(f.binding, f.attemptId, f.request), true);
    assert.equal(gate.observe(other, oldAttempt, f.request), true);
    assert.equal(gate.retire(oldAttempt), true);
    await assert.rejects(gate.reply(f.action({ binding: other, attemptId: oldAttempt })), { code: "SHARED_APPROVAL_DENIED" });
    assert.equal(gate.observe(other, freshAttempt, f.request), true);
    const pending = gate.reply(f.action({ binding: other, attemptId: freshAttempt }));
    gate.observeResolved({ method: "serverRequest/resolved", params: { threadId: f.binding.threadId, requestId: f.request.id } });
    assert.equal((await pending).state, "resolved");
    assert.equal(writes.length, 1);
  } finally { gate.close(); f.gate.close(); }
});

test("a second view cannot attach approval authority from a different execution domain", () => {
  const f = setup();
  const gate = createSharedApprovalGate({ verifyBindingSync: () => true, verifyHistorySync: () => true, write: () => {} });
  try {
    assert.equal(gate.observe(f.binding, f.attemptId, f.request), true);
    for (const change of [
      { hostId: "different" }, { runtimeGeneration: randomUUID() },
      { daemonGeneration: randomUUID() }, { accountRevision: 2 }, { projectId: "different" },
    ]) {
      const other = { ...f.binding, viewId: randomUUID(), clientId: randomUUID(), ...change };
      assert.equal(gate.observe(other, randomUUID(), f.request), false);
    }
  } finally { gate.close(); f.gate.close(); }
});

test("original approval is written once with its actual id and waits for the native resolved event", async () => {
  const f = setup();
  assert.equal(f.gate.observe(f.binding, f.attemptId, f.request), true);
  const p = f.gate.reply(f.action());
  let settled = false;
  p.finally(() => {
    settled = true;
  });
  assert.deepEqual(f.output.map(JSON.parse), [
    { id: 42, result: { decision: "decline" } },
  ]);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(
    f.gate.observeResolved({
      method: "serverRequest/resolved",
      params: { threadId: f.binding.threadId, requestId: 42 },
    }),
    true,
  );
  assert.deepEqual(await p, { state: "resolved" });
  await assert.rejects(f.gate.reply(f.action()), {
    code: "SHARED_APPROVAL_DENIED",
  });
  assert.equal(f.output.length, 1);
  f.gate.close();
});

test("a wrong thread, turn, item, request, owner binding or follow attempt never writes", async () => {
  for (const change of [
    (f) => ({ turnId: randomUUID() }),
    (f) => ({ itemId: "wrong" }),
    (f) => ({ requestId: 43 }),
    (f) => ({ attemptId: randomUUID() }),
    (f) => ({ binding: { ...f.binding, viewId: randomUUID() } }),
    (f) => ({ binding: { ...f.binding, accountRevision: 2 } }),
    (f) => ({ binding: { ...f.binding, daemonGeneration: randomUUID() } }),
    (f) => ({ method: "item/fileChange/requestApproval" }),
  ]) {
    const f = setup();
    f.gate.observe(f.binding, f.attemptId, f.request);
    await assert.rejects(f.gate.reply(f.action(change(f))), {
      code: "SHARED_APPROVAL_DENIED",
    });
    assert.equal(f.output.length, 0);
    f.gate.close();
  }
});

test("unobserved, resolved, revoked, expired, and unoffered decisions fail closed", async () => {
  for (const scenario of [
    "unobserved",
    "resolved",
    "revoked",
    "expired",
    "decision",
  ]) {
    const f = setup();
    if (scenario !== "unobserved")
      f.gate.observe(f.binding, f.attemptId, f.request);
    if (scenario === "resolved")
      f.gate.observeResolved({
        method: "serverRequest/resolved",
        params: { threadId: f.binding.threadId, requestId: 42 },
      });
    if (scenario === "revoked") f.revoke();
    const opts =
      scenario === "expired"
        ? { deadline: performance.now() - 1 }
        : scenario === "decision"
          ? { decision: { arbitrary: "command" } }
          : {};
    await assert.rejects(f.gate.reply(f.action(opts)), {
      code: "SHARED_APPROVAL_DENIED",
    });
    assert.equal(f.output.length, 0);
    f.gate.close();
  }
});

test("unknown write, cancellation and duplicate actions are never retried", async () => {
  {
    const f = setup();
    f.gate.observe(f.binding, f.attemptId, f.request);
    let n = 0;
    f.setWriter(() => {
      n++;
      throw Error("outcome unknown");
    });
    await assert.rejects(f.gate.reply(f.action()), {
      code: "SHARED_APPROVAL_OUTCOME_UNKNOWN",
    });
    await assert.rejects(f.gate.reply(f.action()), {
      code: "SHARED_APPROVAL_DENIED",
    });
    assert.equal(n, 1);
    f.gate.close();
  }
  {
    const f = setup();
    f.gate.observe(f.binding, f.attemptId, f.request);
    const controller = new AbortController();
    const p = f.gate.reply(f.action({ signal: controller.signal }));
    controller.abort();
    await assert.rejects(p, { code: "SHARED_APPROVAL_OUTCOME_UNKNOWN" });
    await assert.rejects(f.gate.reply(f.action()), {
      code: "SHARED_APPROVAL_DENIED",
    });
    assert.equal(f.output.length, 1);
    f.gate.close();
  }
});

test("the original explicit decline remains valid when daemon decision options list cancel", async () => {
  const f = setup();
  f.request.params.availableDecisions = ["accept", "cancel"];
  assert.equal(f.gate.observe(f.binding, f.attemptId, f.request), true);
  const p = f.gate.reply(f.action());
  assert.deepEqual(f.output.map(JSON.parse), [
    { id: 42, result: { decision: "decline" } },
  ]);
  f.gate.observeResolved({
    method: "serverRequest/resolved",
    params: { threadId: f.binding.threadId, requestId: 42 },
  });
  assert.equal((await p).state, "resolved");
  f.gate.close();
});

test("unknown decision kinds are denied even if an upstream lists them", async () => {
  const f = setup();
  f.request.params.availableDecisions = [{ unsupported: { command: "bad" } }];
  f.gate.observe(f.binding, f.attemptId, f.request);
  await assert.rejects(
    f.gate.reply(f.action({ decision: { unsupported: { command: "bad" } } })),
    { code: "SHARED_APPROVAL_DENIED" },
  );
  assert.equal(f.output.length, 0);
  f.gate.close();
});

test("oversized approval decision metadata is not retained or writable", async () => {
  const f = setup();
  f.request.params.proposedExecpolicyAmendment = ["x".repeat(65536)];
  assert.equal(f.gate.observe(f.binding, f.attemptId, f.request), false);
  await assert.rejects(f.gate.reply(f.action()), {
    code: "SHARED_APPROVAL_DENIED",
  });
  assert.equal(f.output.length, 0);
  f.gate.close();
});

test("native policy amendments must match the exact daemon proposal", async () => {
  for (const [field, good, bad] of [
    [
      "proposedExecpolicyAmendment",
      {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["git", "status"],
        },
      },
      {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["git", "push"],
        },
      },
    ],
    [
      "proposedNetworkPolicyAmendments",
      {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { host: "fixture.local", action: "allow" },
        },
      },
      {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { host: "other.local", action: "allow" },
        },
      },
    ],
  ]) {
    const f = setup();
    f.request.params[field] =
      field === "proposedExecpolicyAmendment"
        ? ["git", "status"]
        : [{ host: "fixture.local", action: "allow" }];
    f.gate.observe(f.binding, f.attemptId, f.request);
    await assert.rejects(f.gate.reply(f.action({ decision: bad })), {
      code: "SHARED_APPROVAL_DENIED",
    });
    const pending = f.gate.reply(f.action({ decision: good }));
    assert.deepEqual(JSON.parse(f.output[0]), {
      id: 42,
      result: { decision: good },
    });
    f.gate.observeResolved({
      method: "serverRequest/resolved",
      params: { threadId: f.binding.threadId, requestId: 42 },
    });
    assert.equal((await pending).state, "resolved");
    f.gate.close();
  }
});

test("two callbacks for the same item remain bound to their distinct original request IDs", async () => {
  const f = setup();
  const second = {
    ...f.request,
    id: 43,
    params: { ...f.request.params, approvalId: "distinct" },
  };
  assert.equal(f.gate.observe(f.binding, f.attemptId, f.request), true);
  assert.equal(f.gate.observe(f.binding, f.attemptId, second), true);
  const pending = f.gate.reply(
    f.action({ requestId: 43, decision: "decline" }),
  );
  assert.deepEqual(f.output.map(JSON.parse), [
    { id: 43, result: { decision: "decline" } },
  ]);
  assert.equal(
    f.gate.observeResolved({
      method: "serverRequest/resolved",
      params: { threadId: randomUUID(), requestId: 43 },
    }),
    false,
  );
  let done = false;
  pending.then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  f.gate.observeResolved({
    method: "serverRequest/resolved",
    params: { threadId: f.binding.threadId, requestId: 43 },
  });
  await pending;
  f.gate.close();
});

test("file change approvals preserve the original decision and exact request", async () => {
  const f = setup();
  f.request.method = "item/fileChange/requestApproval";
  f.gate.observe(f.binding, f.attemptId, f.request);
  const p = f.gate.reply(
    f.action({ method: f.request.method, decision: "accept" }),
  );
  assert.deepEqual(f.output.map(JSON.parse), [
    { id: 42, result: { decision: "accept" } },
  ]);
  f.gate.observeResolved({
    method: "serverRequest/resolved",
    params: { threadId: f.binding.threadId, requestId: 42 },
  });
  await p;
  f.gate.close();
});

test("a reentrant resolved event cannot outrun the final identity check after socket write", async () => {
  const f = setup();
  f.gate.observe(f.binding, f.attemptId, f.request);
  f.setWriter(() => {
    f.gate.observeResolved({
      method: "serverRequest/resolved",
      params: { threadId: f.binding.threadId, requestId: 42 },
    });
    f.revoke();
  });
  await assert.rejects(f.gate.reply(f.action()), {
    code: "SHARED_APPROVAL_OUTCOME_UNKNOWN",
  });
  await assert.rejects(f.gate.reply(f.action()), {
    code: "SHARED_APPROVAL_DENIED",
  });
  f.gate.close();
});

test("readable approval notifications do not confer reply authority after write proof is revoked",async()=>{
 const f=setup();let writable=false,readable=true;const writes=[];
 const same=b=>JSON.stringify(b)===JSON.stringify(f.binding);
 const gate=createSharedApprovalGate({verifyBindingSync:b=>writable&&same(b),verifyHistorySync:b=>readable&&same(b),write:encoded=>writes.push(encoded)});
 try{
  assert.equal(gate.observe(f.binding,f.attemptId,f.request),true);
  await assert.rejects(gate.reply(f.action({decision:'accept'})),{code:'SHARED_APPROVAL_DENIED'});assert.deepEqual(writes,[]);
  readable=false;assert.equal(gate.observe(f.binding,randomUUID(),{...f.request,id:43}),false);
  assert.equal(gate.observe({...f.binding,viewId:randomUUID()},randomUUID(),f.request),false);
 }finally{gate.close();f.gate.close();}
});
