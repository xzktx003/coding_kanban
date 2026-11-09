import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSharedDaemonRpcGate } from "../src/shared-daemon-rpc-gate.mjs";
function fixture() {
  const writes = [],
    identity = { live: true, revision: 1, history: true };
  const binding = {
    hostId: "local",
    runtimeGeneration: randomUUID(),
    daemonGeneration: randomUUID(),
    accountRevision: 1,
    projectId: "fixture-project",
    threadId: randomUUID(),
    viewId: randomUUID(),
    clientId: randomUUID(),
  };
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => identity.live,
    verifyBindingSync: (value) =>
      identity.live && value.accountRevision === identity.revision,
    verifyHistorySync: () => identity.history,
    write: (value) => {
      writes.push(value);
    },
  });
  const control = () => ({
    attemptId: randomUUID(),
    signal: new AbortController().signal,
    deadline: performance.now() + 10000,
  });
  const frame = (id = `thread/resume:${randomUUID()}`) => ({
    id,
    method: "thread/resume",
    params: { threadId: binding.threadId, excludeTurns: true },
  });
  return { gate, writes, identity, binding, control, frame };
}
test("list is bounded, read-only, and cannot silently allow mutating or unknown RPCs", () => {
  const f = fixture();
  try {
    const read = {
      id: 1,
      method: "thread/list",
      params: {
        limit: 100,
        cursor: null,
        sortKey: "updated_at",
        modelProviders: null,
        sourceKinds: ["cli"],
        archived: false,
        useStateDbOnly: true,
      },
    };
    f.gate.write(JSON.stringify(read));
    assert.deepEqual(JSON.parse(f.writes[0]), read);
    for (const value of [
      { id: 2, method: "turn/start", params: {} },
      { id: 3, method: "experimentalFeature/list", params: {} },
      {
        id: 4,
        method: "thread/list",
        params: { limit: 500, useStateDbOnly: true },
      },
      {
        id: 5,
        method: "thread/list",
        params: { limit: 1, useStateDbOnly: false },
      },
    ])
      assert.throws(() => f.gate.write(JSON.stringify(value)), {
        code: "SHARED_DAEMON_DENIED",
      });
  } finally {
    f.gate.close();
  }
});

test('production execution proof runs at actual resume write and observes the original reply once',()=>{
 const f=fixture(),seen=[],writes=[];f.gate.close();let allowed=false;
 const gate=createSharedDaemonRpcGate({verifyReadSync:()=>true,verifyBindingSync:()=>true,verifyHistorySync:()=>true,write:text=>writes.push(text),
  executionDomain:{beforeResumeWriteSync:(binding,frame)=>{seen.push(['before',binding.clientId,frame.id]);return allowed;},observeResumeReplySync:(binding,request,reply)=>{seen.push(['reply',binding.clientId,request.id,reply.id]);return true;}}});
 try{
  const first=f.frame('proof-denied');assert.equal(gate.registerConnect(f.binding,first,f.control()),true);assert.throws(()=>gate.write(JSON.stringify(first)));assert.equal(writes.length,0);
  allowed=true;const next=f.frame('proof-allowed');assert.equal(gate.registerConnect(f.binding,next,f.control()),true);gate.write(JSON.stringify(next));
  const reply=JSON.stringify({id:next.id,error:{code:-32600,message:'original own native error'}});assert.equal(gate.receive(reply),reply);assert.equal(writes.length,1);assert.equal(seen.filter(x=>x[0]==='reply').length,1);
 }finally{gate.close();}
});
test("bounded native turn item pages are allowed only after final read guard and retain exact parameters", () => {
  const f = fixture(), turnId = randomUUID();
  try {
    const frame = { id: 10, method: 'thread/items/list', params: { threadId: f.binding.threadId, turnId, limit: 100, cursor: { type: 'item', itemId: 'item-0' }, sortDirection: 'desc' } };
    f.gate.write(JSON.stringify(frame));
    assert.deepEqual(JSON.parse(f.writes[0]), frame);
    const response = JSON.stringify({ id: 10, result: { data: [{ turnId, item: { id: 'item-1', type: 'userMessage', content: [] }, startedAtMs: null, completedAtMs: null }], nextCursor: null, backwardsCursor: null } });
    assert.equal(f.gate.receive(response), response);
    for (const [i, params] of [
      { ...frame.params, turnId: null }, { ...frame.params, limit: 101 },
      { ...frame.params, turnId: 'wrong\nturn' },
      { ...frame.params, cursor: { type: 'item', itemId: 'item', extra: true } },
      { ...frame.params, cursor: 'x'.repeat(4097) }, { ...frame.params, sortDirection: 'invalid' },
      { ...frame.params, path: '/private' },
    ].entries())
      assert.throws(() => f.gate.write(JSON.stringify({ ...frame, id: 20 + i, params })), { code: 'SHARED_DAEMON_DENIED' });
    f.identity.live = false;
    assert.throws(() => f.gate.write(JSON.stringify({ ...frame, id: 30 })), { code: 'SHARED_DAEMON_DENIED' });
    assert.equal(f.writes.length, 1);
  } finally { f.gate.close(); }
});
test("cross-turn or oversized item pages fail closed and do not expose a partial result", () => {
  const f = fixture(), turnId = randomUUID();
  try {
    for (const [i, result] of [
      { data: [{ turnId: randomUUID(), item: { id: 'other' } }], nextCursor: null, backwardsCursor: null },
      { data: [{ turnId, item: { id: 'a' } }, { turnId, item: { id: 'b' } }], nextCursor: null, backwardsCursor: null },
      { data: [], nextCursor: 'x'.repeat(4097), backwardsCursor: null },
      { data: [], nextCursor: 'previous', backwardsCursor: null },
      { data: [], nextCursor: null },
    ].entries()) {
      const id = 40 + i;
      f.gate.write(JSON.stringify({ id, method: 'thread/items/list', params: { threadId: f.binding.threadId, turnId, limit: 1, cursor: i === 3 ? 'previous' : null } }));
      assert.throws(() => f.gate.receive(JSON.stringify({ id, result })), { code: 'SHARED_DAEMON_DENIED' });
    }
  } finally { f.gate.close(); }
});
test("the server-side item read guard rejects another thread before actual dispatch", () => {
  const threadId = randomUUID(), turnId = randomUUID(), writes = [];
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: (frame) => frame.params.threadId === threadId,
    verifyBindingSync: () => true, verifyHistorySync: () => true,
    write: (encoded) => writes.push(encoded),
  });
  try {
    assert.throws(() => gate.write(JSON.stringify({ id: 81, method: 'thread/items/list', params: { threadId: randomUUID(), turnId, limit: 1 } })), { code: 'SHARED_DAEMON_DENIED' });
    assert.equal(writes.length, 0);
  } finally { gate.close(); }
});
test("a connection authorization is exact, one-use, and checked synchronously at the real write", () => {
  const f = fixture();
  try {
    const request = f.frame(),
      control = f.control();
    assert.equal(f.gate.registerConnect(f.binding, request, control), true);
    f.gate.write(JSON.stringify(request));
    assert.deepEqual(JSON.parse(f.writes[0]), request);
    assert.throws(() => f.gate.write(JSON.stringify(request)), {
      code: "SHARED_DAEMON_DENIED",
    });
    const another = f.frame();
    assert.equal(f.gate.registerConnect(f.binding, another, f.control()), true);
    f.identity.revision++;
    assert.throws(() => f.gate.write(JSON.stringify(another)), {
      code: "SHARED_DAEMON_DENIED",
    });
    assert.equal(f.writes.length, 1);
  } finally {
    f.gate.close();
  }
});
test("changed params or an aborted registration cannot dispatch or later replay", () => {
  const f = fixture();
  try {
    const first = f.frame(),
      controller = new AbortController(),
      control = {
        attemptId: randomUUID(),
        signal: controller.signal,
        deadline: performance.now() + 10000,
      };
    f.gate.registerConnect(f.binding, first, control);
    controller.abort();
    assert.throws(() => f.gate.write(JSON.stringify(first)), {
      code: "SHARED_DAEMON_DENIED",
    });
    const next = f.frame();
    f.gate.registerConnect(f.binding, next, f.control());
    assert.throws(
      () =>
        f.gate.write(
          JSON.stringify({
            ...next,
            params: { ...next.params, cwd: "/override" },
          }),
        ),
      { code: "SHARED_DAEMON_DENIED" },
    );
    assert.throws(() => f.gate.write(JSON.stringify(next)), {
      code: "SHARED_DAEMON_DENIED",
    });
    assert.equal(f.writes.length, 0);
  } finally {
    f.gate.close();
  }
});
test("a mismatched method consumes the grant and cannot be followed by the correct request", () => {
  const f = fixture();
  try {
    const request = f.frame();
    f.gate.registerConnect(f.binding, request, f.control());
    assert.throws(
      () => f.gate.write(JSON.stringify({ ...request, method: "thread/read" })),
      { code: "SHARED_DAEMON_DENIED" },
    );
    assert.throws(() => f.gate.write(JSON.stringify(request)), {
      code: "SHARED_DAEMON_DENIED",
    });
    assert.equal(f.writes.length, 0);
  } finally {
    f.gate.close();
  }
});
test("scope revocation during the synchronous write is reported as unknown and never replayed", () => {
  const f = fixture(),
    controller = new AbortController(),
    writes = [];
  f.gate.close();
  const gate = createSharedDaemonRpcGate({
    verifyReadSync: () => true,
    verifyBindingSync: () => true,
    verifyHistorySync: () => true,
    write: (value) => {
      writes.push(value);
      controller.abort();
    },
  });
  try {
    const request = f.frame(),
      control = {
        attemptId: randomUUID(),
        signal: controller.signal,
        deadline: performance.now() + 10000,
      };
    assert.equal(gate.registerConnect(f.binding, request, control), true);
    assert.throws(() => gate.write(JSON.stringify(request)), {
      code: "SHARED_DAEMON_OUTCOME_UNKNOWN",
    });
    const next = f.frame();
    assert.equal(gate.registerConnect(f.binding, next, f.control()), false);
    assert.equal(writes.length, 1);
  } finally {
    gate.close();
  }
});
test("connect is unavailable when bounded history capability cannot be verified or changes before write", () => {
  const f = fixture();
  try {
    f.identity.history = false;
    assert.equal(
      f.gate.registerConnect(f.binding, f.frame(), f.control()),
      false,
    );
    f.identity.history = true;
    const request = f.frame();
    assert.equal(f.gate.registerConnect(f.binding, request, f.control()), true);
    f.identity.history = false;
    assert.throws(() => f.gate.write(JSON.stringify(request)), {
      code: "SHARED_DAEMON_DENIED",
    });
    assert.equal(f.writes.length, 0);
  } finally {
    f.gate.close();
  }
});
test("revoking pagination capability while resume is in flight makes the outcome unknown and prevents replay", () => {
  const f = fixture();
  try {
    const request = f.frame();
    assert.equal(f.gate.registerConnect(f.binding, request, f.control()), true);
    f.gate.write(JSON.stringify(request));
    f.identity.history = false;
    const reply = JSON.stringify({ id: request.id, result: {
      thread: { id: f.binding.threadId, historyMode: 'paginated', turns: [] },
      turnsBackwardsCursor: null, itemsBackwardsCursor: null,
    } });
    assert.throws(() => f.gate.receive(reply), { code: 'SHARED_DAEMON_OUTCOME_UNKNOWN' });
    f.identity.history = true;
    assert.equal(f.gate.registerConnect(f.binding, f.frame(), f.control()), false);
    assert.equal(f.writes.length, 1);
  } finally { f.gate.close(); }
});
test("a resumed result must carry the real paginated projection before reaching native", () => {
  const f = fixture();
  try {
    const request = f.frame();
    f.gate.registerConnect(f.binding, request, f.control());
    f.gate.write(JSON.stringify(request));
    const good = {
      id: request.id,
      result: {
        thread: { id: f.binding.threadId, historyMode: "paginated", turns: [] },
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      },
    };
    assert.deepEqual(JSON.parse(f.gate.receive(JSON.stringify(good))), good);
    const next = f.frame();
    f.gate.registerConnect(f.binding, next, f.control());
    f.gate.write(JSON.stringify(next));
    assert.throws(
      () =>
        f.gate.receive(
          JSON.stringify({
            id: next.id,
            result: {
              thread: {
                id: f.binding.threadId,
                historyMode: "full",
                turns: [],
              },
            },
          }),
        ),
      { code: "SHARED_DAEMON_OUTCOME_UNKNOWN" },
    );
  } finally {
    f.gate.close();
  }
});
