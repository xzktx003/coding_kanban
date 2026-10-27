import assert from "node:assert/strict";
import { test } from "node:test";
import { StdioRpc, RpcError } from "./rpc.js";

const childSource = String.raw`
const readline = require('node:readline');
let guardedWrites = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'echo') setTimeout(() => send({id:m.id,result:m.params}), m.params.delay || 0);
  if (m.method === 'guarded') { guardedWrites++; send({id:m.id,result:'sent'}); }
  if (m.method === 'guard-count') send({id:m.id,result:guardedWrites});
  if (m.method === 'error') send({id:m.id,error:{code:-32601,message:'Method not found'}});
  if (m.method === 'fragment') {
    const text = Buffer.from(JSON.stringify({id:m.id,result:{text:'你好🌍'}})+'\n');
    for (let i=0;i<text.length;i++) process.stdout.write(text.subarray(i,i+1));
  }
  if (m.method === 'request') { send({method:'notice',params:{ready:true}}); send({id:'server-1',method:'ask',params:{threadId:'t'}}); send({id:m.id,result:{}}); }
  if (m.method === 'exit') process.exit(7);
  if (m.method === 'huge') process.stdout.write('x'.repeat(1024));
  if (m.method === 'oversized-reply') {
    const text = JSON.stringify({id:m.id,result:{text:'x'.repeat(2048)}})+'\n';
    for (let i=0;i<text.length;i+=41) process.stdout.write(text.slice(i,i+41));
    send({method:'turn/completed',params:{threadId:'busy',turn:{id:'running',status:'completed'}}});
  }
  if (m.method === 'invalid') { process.stdout.write('not-json\n'); send({id:m.id,result:true}); }
  if (m.method === 'late') setTimeout(() => send({id:m.id,result:'late'}), 100);
  if (m.id === 'server-1' && m.result) send({method:'answered',params:m.result});
});`;

test("stdio RPC multiplexes out-of-order replies, fragmented UTF-8, errors and server requests", async (t) => {
  const received: unknown[] = [];
  const rpc = new StdioRpc({
    command: process.execPath,
    args: ["-e", childSource],
    onNotification: (message) => {
      received.push(message);
    },
    onRequest: async (request) => {
      await rpc.respond(request.id, { accepted: true });
    },
  });
  t.after(() => rpc.close());
  const results = await Promise.all([
    rpc.request("echo", { delay: 25, value: "first" }),
    rpc.request("echo", { value: "second" }),
  ]);
  assert.deepEqual(results, [
    { delay: 25, value: "first" },
    { value: "second" },
  ]);
  assert.deepEqual(await rpc.request("fragment", {}), { text: "你好🌍" });
  await assert.rejects(
    rpc.request("error", {}),
    (error) => error instanceof RpcError && error.code === -32601,
  );
  await rpc.request("request", {});
  await rpc.request("echo", { delay: 20 });
  assert.deepEqual(received, [
    { method: "notice", params: { ready: true } },
    { method: "answered", params: { accepted: true } },
  ]);
  assert.equal(rpc.pendingCount, 0);
});

test("timeouts have unknown delivery, never replay a mutation, and late replies cannot resolve another request", async (t) => {
  const rpc = new StdioRpc({
    command: process.execPath,
    args: ["-e", childSource],
  });
  t.after(() => rpc.close());
  await rpc.request("echo", {});
  await assert.rejects(
    rpc.request("late", {}, { timeoutMs: 10 }),
    /DELIVERY_UNKNOWN/,
  );
  const result = await rpc.request("echo", { delay: 150, value: "correct" });
  assert.deepEqual(result, { delay: 150, value: "correct" });
  assert.equal(rpc.pendingCount, 0);
});

test("a dispatch guard checks again after write queue admission and rejects before any native frame is written", async t => {
  const rpc = new StdioRpc({ command: process.execPath, args: ["-e", childSource] });
  t.after(() => rpc.close());
  await rpc.request("echo", {});
  let valid = true;
  const blocked = rpc.request("guarded", {}, { beforeSend: () => {
    if (!valid) throw new Error("NOT_SENT: release safety changed before dispatch");
  } });
  valid = false;
  await assert.rejects(blocked, /NOT_SENT: release safety changed/);
  assert.equal(await rpc.request("guard-count", {}), 0);
  assert.equal(rpc.pendingCount, 0);
  const sent = rpc.request("guarded", {}, { beforeSend: () => { assert.equal(valid, true); } });
  valid = true;
  assert.equal(await sent, "sent");
  assert.equal(await rpc.request("guard-count", {}), 1);
});

test("guarded requests that timeout or are cancelled while queued report NOT_SENT and never execute their dispatch guard", async t => {
  const rpc = new StdioRpc({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] });
  t.after(() => rpc.close());
  // This fixture never reads stdin, so the first large frame holds the write
  // queue. It is our own Node process, with no native Agent or real session.
  void rpc.request("hold", { data: "x".repeat(1024 * 1024) }, { timeoutMs: 5000 }).catch(() => undefined);
  await Promise.resolve();
  let dispatched = 0;
  await assert.rejects(rpc.request("guarded", {}, { timeoutMs: 20, beforeSend: () => { dispatched++; } }), /NOT_SENT/);
  const controller = new AbortController();
  const cancelled = rpc.request("guarded", {}, { signal: controller.signal, beforeSend: () => { dispatched++; } });
  controller.abort();
  await assert.rejects(cancelled, /NOT_SENT/);
  assert.equal(dispatched, 0);
});

test("process death rejects every pending request and does not spawn a replacement", async (t) => {
  const rpc = new StdioRpc({
    command: process.execPath,
    args: ["-e", childSource],
  });
  t.after(() => rpc.close());
  const outcomes = await Promise.allSettled([
    rpc.request("never", {}),
    rpc.request("exit", {}),
  ]);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "rejected");
    if (outcome.status === "rejected")
      assert.match(outcome.reason.message, /DELIVERY_UNKNOWN/);
  }
  await assert.rejects(rpc.request("echo", {}), /unavailable/);
  assert.equal(rpc.pendingCount, 0);
});

test("malformed lines are bounded diagnostics; an unknown oversized frame quarantines transport without stopping its process", async (t) => {
  const diagnostics: string[] = [];
  const rpc = new StdioRpc({
    command: process.execPath,
    args: ["-e", childSource],
    maxFrameBytes: 256,
    onDiagnostic: (message) => {
      diagnostics.push(message);
    },
  });
  t.after(() => rpc.close());
  assert.equal(await rpc.request("invalid", {}), true);
  assert.equal(diagnostics.length, 1);
  await assert.rejects(rpc.request("huge", {}), /DELIVERY_UNKNOWN.*frame/i);
  assert.equal(rpc.pendingCount, 0);
  assert.equal(rpc.available, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(rpc.child.exitCode, null);
  assert.equal(rpc.child.signalCode, null);
});

test("an oversized response is rejected without losing the next turn completion or other requests", async t => {
  const notifications: unknown[] = [];
  const rpc = new StdioRpc({ command: process.execPath, args: ["-e", childSource], maxFrameBytes: 256,
    onNotification: event => notifications.push(event) });
  t.after(() => rpc.close());
  const pid = rpc.child.pid;
  await assert.rejects(rpc.request("oversized-reply", {}), /frame exceeded.*native process retained/);
  assert.deepEqual(await rpc.request("echo", { value: "after oversized history" }), { value: "after oversized history" });
  assert.equal(rpc.available, true);
  assert.equal(rpc.child.pid, pid);
  assert.equal(rpc.child.exitCode, null);
  assert.deepEqual(notifications, [{ method: "turn/completed", params: { threadId: "busy", turn: { id: "running", status: "completed" } } }]);
  assert.equal(rpc.pendingCount, 0);
});

test("missing executables reject immediately and signal pre-aborted calls as not sent", async (t) => {
  const rpc = new StdioRpc({
    command: "/nonexistent/kanban-test-command",
    args: [],
  });
  t.after(() => rpc.close());
  await assert.rejects(rpc.request("echo", {}), /NOT_SENT|DELIVERY_UNKNOWN/);
  const running = new StdioRpc({
    command: process.execPath,
    args: ["-e", childSource],
  });
  t.after(() => running.close());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    running.request("echo", {}, { signal: controller.signal }),
    /NOT_SENT/,
  );
});
