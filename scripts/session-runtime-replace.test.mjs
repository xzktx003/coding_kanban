import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSessionThreads,
  planRuntimeReplacement,
  replaceSessionRuntime,
} from "./session-runtime-replace.mjs";

const ready = (overrides = {}) => async () => ({
  state: "ready",
  url: "http://127.0.0.1:45678/api/session/health",
  binaryState: "older",
  pid: 123,
  ...overrides,
});

test("a stale runtime is replaced, and active turns are stopped rather than blocking", async () => {
  const idle = await planRuntimeReplacement({
    status: ready(),
    listActive: async () => [],
  });
  assert.deepEqual(idle, {
    action: "replace",
    reason: "idle",
    pid: 123,
    active: [],
  });
  const busy = await planRuntimeReplacement({
    status: ready(),
    listActive: async () => ["t1", "t2"],
  });
  assert.equal(busy.action, "replace");
  assert.equal(busy.reason, "active-turns-stopped");
  // The caller must be able to tell the user exactly what it is ending.
  assert.deepEqual(busy.active, ["t1", "t2"]);
});

test("nothing is replaced without proof that this repository owns a stale runtime", async () => {
  const cases = [
    [{ state: "disabled" }, "disabled"],
    [{ state: "unavailable", error: "HTTP 503" }, "unavailable"],
    [{ state: "ready", url: "http://127.0.0.1:1/x", binaryState: "older" }, "unverified-owner"],
    [{ state: "ready", url: "http://127.0.0.1:1/x", binaryState: "current", pid: 5 }, "already-current"],
    [{ state: "ready", url: "http://127.0.0.1:1/x", binaryState: "unknown", pid: 5 }, "unknown-build"],
  ];
  for (const [result, reason] of cases) {
    const plan = await planRuntimeReplacement({
      status: async () => result,
      listActive: async () => {
        throw new Error("must not probe");
      },
    });
    assert.equal(plan.action, "skip", reason);
    assert.equal(plan.reason, reason);
  }
});

test("an unreadable thread list is never treated as an idle runtime", async () => {
  const plan = await planRuntimeReplacement({
    status: ready(),
    listActive: async () => {
      throw new Error("upstream refused");
    },
  });
  assert.equal(plan.action, "skip");
  assert.equal(plan.reason, "active-unknown");
});

test("active discovery pages through the list and rejects looping or malformed cursors", async () => {
  const pages = [
    { data: [{ id: "a", status: { type: "active", activeFlags: [] } }], nextCursor: "p2" },
    { data: [{ id: "b", status: { type: "idle" } }], nextCursor: null },
  ];
  let page = 0;
  const active = await activeSessionThreads({
    origin: "http://127.0.0.1:45678",
    fetcher: async () => ({ ok: true, json: async () => pages[page++] }),
  });
  assert.deepEqual(active, ["a"]);
  await assert.rejects(
    activeSessionThreads({
      origin: "http://127.0.0.1:45678",
      fetcher: async () => ({ ok: true, json: async () => ({ data: [], nextCursor: "loop" }) }),
    }),
    /游标无效或重复/,
  );
  await assert.rejects(
    activeSessionThreads({
      origin: "http://127.0.0.1:45678",
      fetcher: async () => ({ ok: false, status: 503 }),
    }),
    /HTTP 503/,
  );
});

test("replacement stops the stale runtime gracefully and escalates only if it survives", async () => {
  const sent = [];
  const graceful = await replaceSessionRuntime({
    plan: async () => ({ action: "replace", reason: "idle", pid: 77, active: [] }),
    signal: (pid, name) => sent.push([pid, name]),
    alive: () => false,
    wait: async () => {},
    log: () => {},
  });
  assert.equal(graceful.stopped, true);
  assert.deepEqual(sent, [[77, "SIGTERM"]]);

  const stubborn = [];
  await replaceSessionRuntime({
    plan: async () => ({ action: "replace", reason: "idle", pid: 88, active: [] }),
    signal: (pid, name) => stubborn.push([pid, name]),
    alive: () => true,
    wait: async () => {},
    log: () => {},
  });
  assert.deepEqual(stubborn, [
    [88, "SIGTERM"],
    [88, "SIGKILL"],
  ]);
});

test("a skipped plan never signals any process", async () => {
  await replaceSessionRuntime({
    plan: async () => ({ action: "skip", reason: "already-current" }),
    signal: () => assert.fail("must not signal"),
    alive: () => false,
    log: () => {},
  });
});
