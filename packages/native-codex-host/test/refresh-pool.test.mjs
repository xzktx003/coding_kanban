import test from "node:test";
import assert from "node:assert/strict";
import { createThreadPool } from "../refresh-prototype/thread-pool.mjs";

const generation = "019aabcd-1234-7890-abcd-000000000001";
const domain = "019aabcd-1234-7890-abcd-000000000002";
const id = (number) =>
  `019aabcd-1234-7890-abcd-${String(number).padStart(12, "0")}`;
const thread = (number, status = "idle") => ({
  threadId: id(number),
  cwd: "/private/project",
  status,
  pendingRequests: 0,
  generation,
});

test("a visible consumer arriving at the native write boundary prevents unsubscribe without claiming an unknown receipt", async () => {
  let pool, sent = 0;
  const value = thread(1);
  pool = createThreadPool({ domain, generation, idleLimit: 0, memoryBudgetBytes: 1000,
    adapter: { idleOnlyUnsubscribe: true, readRss: async () => 100,
      probe: async () => value,
      async unsubscribe(_key, options) {
        pool.setVisible(value.threadId, id(99), true);
        try { options?.beforeSend?.(); }
        catch(error) {
          if(error.code === "NATIVE_NOT_SENT") return {protected:true,retained:true,state:value};
          throw error;
        }
        sent++; return {released:true};
      }
    }
  });
  pool.observe(value);
  await pool.trim();
  assert.equal(sent, 0);
  assert.equal(pool.snapshot().entries[0].error, null);
  assert.equal(pool.snapshot().entries.length, 1);
});
function fixture(options = {}) {
  const states = new Map();
  const released = [];
  let rss = 100;
  let probeHook = () => {};
  const pool = createThreadPool({
    domain,
    generation,
    idleLimit: 10,
    memoryBudgetBytes: 1000,
    adapter: {
      // The adapter may unsubscribe only its own native subscription. It must
      // never unload or interrupt a thread that became active concurrently.
      idleOnlyUnsubscribe: true,
      readRss: async () => rss,
      probe: async (key) => {
        await probeHook(key);
        return states.get(key.threadId);
      },
      unsubscribe: async (key) => {
        released.push(key.threadId);
        return { released: true };
      },
    },
    ...options,
  });
  return {
    pool,
    states,
    released,
    setRss: (value) => {
      rss = value;
    },
    onProbe: (callback) => {
      probeHook = callback;
    },
    add(number, status) {
      const value = thread(number, status);
      states.set(value.threadId, value);
      pool.observe(value);
      return value;
    },
  };
}

test("eleven idle native contexts evict only the least recently used; clients share one entry", async () => {
  const f = fixture();
  for (let n = 10; n < 21; n++) f.add(n);
  f.pool.touch(id(10));
  f.pool.setVisible(id(12), id(101), true);
  f.pool.setVisible(id(12), id(102), true);
  await f.pool.trim();
  assert.deepEqual(f.released, [id(11)]);
  const state = f.pool.snapshot();
  assert.equal(state.entries.length, 10);
  assert.equal(
    state.entries.find((item) => item.threadId === id(12)).visibleConsumers,
    2,
  );
  f.pool.setVisible(id(12), id(101), false);
  assert.equal(
    f.pool.snapshot().entries.find((item) => item.threadId === id(12))
      .visibleConsumers,
    1,
  );
});

test("running, approvals, questions, visible and unknown states remain protected under pressure", async () => {
  const f = fixture({ idleLimit: 1 });
  for (const [n, status] of [
    [10, "active"],
    [11, "waitingApproval"],
    [12, "waitingInput"],
    [13, "unknown"],
    [14, "idle"],
  ])
    f.add(n, status);
  f.pool.setVisible(id(14), id(101), true);
  f.add(15);
  f.add(16);
  f.setRss(2000);
  await f.pool.trim();
  assert.deepEqual(f.released, [id(15), id(16)]);
  assert.equal(f.pool.snapshot().entries.length, 5);
  assert.equal(f.pool.snapshot().pressure, true);
  assert.equal(f.pool.snapshot().warmAdmission, false);
});

test("rechecks native state and observation revision immediately before unsubscribe", async () => {
  const f = fixture({ idleLimit: 1 });
  f.add(10);
  f.add(11);
  f.add(12);
  f.onProbe((key) => {
    if (key.threadId === id(10)) f.add(10, "waitingApproval");
    if (key.threadId === id(11)) f.pool.setVisible(id(11), id(101), true);
  });
  await f.pool.trim();
  assert.deepEqual(f.released, [id(12)]);
  assert.equal(
    f.pool.snapshot().entries.find((item) => item.threadId === id(10)).status,
    "waitingApproval",
  );
});

test("pending request protects an otherwise idle thread; stale generations cannot revive readiness", async () => {
  const f = fixture({ idleLimit: 1 });
  f.add(10);
  f.add(11);
  f.pool.observe({ ...thread(10), pendingRequests: 1 });
  assert.throws(
    () => f.pool.observe({ ...thread(10), generation: id(200) }),
    /generation/,
  );
  await f.pool.trim();
  assert.deepEqual(f.released, []);
  f.pool.invalidate();
  assert.equal(f.pool.snapshot().warmAdmission, false);
  assert.throws(() => f.pool.observe(thread(10)), /invalidated/);
  assert.deepEqual(
    f.released,
    [],
    "losing the manager must not stop native work",
  );
});

test("failed or uncertain unsubscribe retains a protected record and stops warm admission", async () => {
  let calls = 0;
  const f = fixture({
    idleLimit: 1,
    adapter: {
      idleOnlyUnsubscribe: true,
      readRss: async () => 100,
      probe: async (key) => thread(Number(key.threadId.slice(-12))),
      unsubscribe: async () => {
        calls++;
        throw new Error("receipt lost");
      },
    },
  });
  f.add(10);
  f.add(11);
  await f.pool.trim();
  await f.pool.trim();
  assert.equal(
    calls,
    1,
    "uncertain native mutations are never retried automatically",
  );
  assert.equal(f.pool.snapshot().entries.length, 2);
  assert.equal(f.pool.snapshot().warmAdmission, false);
});

test("requires safe native unsubscribe, finite budgets, canonical paths and exact scope identity", () => {
  assert.throws(() => fixture({ idleLimit: -1 }), /idleLimit/);
  assert.throws(() => fixture({ memoryBudgetBytes: Infinity }), /memoryBudget/);
  assert.throws(
    () => fixture({ adapter: { idleOnlyUnsubscribe: false } }),
    /unsubscribe/,
  );
  const f = fixture();
  f.add(10);
  assert.throws(
    () => f.pool.observe({ ...thread(10), cwd: "/private/../project" }),
    /canonical/,
  );
  assert.throws(
    () => f.pool.observe({ ...thread(10), cwd: "/other/project" }),
    /cwd/,
  );
  const snapshot = f.pool.snapshot();
  assert.deepEqual(snapshot.entries[0].key, {
    domain,
    generation,
    threadId: id(10),
    cwd: "/private/project",
  });
  assert.equal(JSON.stringify(snapshot).includes("history"), false);
});

test("warm admission waits for measured RSS and stops when all idle slots have visible consumers", async () => {
  const f = fixture({ idleLimit: 1 });
  f.add(10);
  assert.equal(f.pool.snapshot().warmAdmission, false);
  await f.pool.trim();
  assert.equal(f.pool.snapshot().warmAdmission, true);
  f.pool.setVisible(id(10), id(101), true);
  assert.equal(f.pool.snapshot().warmAdmission, false);
  f.pool.setVisible(id(10), id(101), false);
  assert.equal(f.pool.snapshot().warmAdmission, true);
});

test("native activity arriving inside unsubscribe retains the protected context without claiming release", async () => {
  const released = [];
  const f = fixture({
    idleLimit: 1,
    adapter: {
      idleOnlyUnsubscribe: true,
      readRss: async () => 100,
      probe: async (key) => thread(Number(key.threadId.slice(-12))),
      unsubscribe: async (key) => {
        if (key.threadId === id(10))
          return {
            protected: true,
            retained: true,
            state: thread(10, "active"),
          };
        released.push(key.threadId);
        return { released: true };
      },
    },
  });
  f.add(10);
  f.add(11);
  f.add(12);
  await f.pool.trim();
  assert.deepEqual(released, [id(11)]);
  assert.equal(
    f.pool.snapshot().entries.find((entry) => entry.threadId === id(10)).status,
    "active",
  );
  assert.equal(f.pool.snapshot().warmAdmission, true);
});

test("an uncertain subscription recovers only after a verified retain acknowledgement without retrying eviction", async () => {
  let unsubscribeCalls = 0,
    retainCalls = 0;
  const f = fixture({
    idleLimit: 1,
    adapter: {
      idleOnlyUnsubscribe: true,
      readRss: async () => 100,
      probe: async (key) => thread(Number(key.threadId.slice(-12))),
      unsubscribe: async () => {
        unsubscribeCalls++;
        throw Error("receipt lost");
      },
      retain: async (key) => {
        retainCalls++;
        return { ...thread(Number(key.threadId.slice(-12))), retained: true };
      },
    },
  });
  f.add(10);
  f.add(11);
  await f.pool.trim();
  f.pool.observe(thread(10));
  assert.equal(f.pool.snapshot().warmAdmission, false);
  await f.pool.retain({
    domain,
    generation,
    threadId: id(10),
    cwd: "/private/project",
  });
  assert.equal(retainCalls, 1);
  assert.equal(unsubscribeCalls, 1);
  assert.equal(
    f.pool.snapshot().entries.find((entry) => entry.threadId === id(10)).error,
    null,
  );
});

test("retain returns the newer live state and missing RSS stops admission even after subscription recovery", async () => {
  let missingRss = false;
  const f = fixture({
    adapter: {
      idleOnlyUnsubscribe: true,
      readRss: async () => {
        if (missingRss) throw Error("missing RSS");
        return 100;
      },
      probe: async () => thread(10),
      unsubscribe: async () => ({ released: true }),
      retain: async () => {
        f.pool.observe(thread(10, "active"));
        return { ...thread(10), retained: true };
      },
    },
  });
  f.add(10);
  await f.pool.trim();
  const result = await f.pool.retain({
    domain,
    generation,
    threadId: id(10),
    cwd: "/private/project",
  });
  assert.equal(result.status, "active");
  assert.equal(f.pool.snapshot().entries[0].status, "active");
  missingRss = true;
  await assert.rejects(
    f.pool.retain({
      domain,
      generation,
      threadId: id(10),
      cwd: "/private/project",
    }),
    /missing RSS/,
  );
  assert.equal(f.pool.snapshot().warmAdmission, false);
});

test("a first retain cannot overwrite a newer entry created by a native lifecycle event", async () => {
  let release;
  const ready = new Promise((done) => {
    release = done;
  });
  const pool = createThreadPool({
    domain,
    generation,
    idleLimit: 10,
    memoryBudgetBytes: 1000,
    adapter: {
      idleOnlyUnsubscribe: true,
      probe: async () => thread(60),
      unsubscribe: async () => ({ released: true }),
      readRss: async () => 100,
      retain: async () => {
        await ready;
        return { ...thread(60), retained: true };
      },
    },
  });
  const pending = pool.retain({
    domain,
    generation,
    threadId: id(60),
    cwd: "/private/project",
  });
  await Promise.resolve();
  pool.observe({ ...thread(60, "waitingApproval"), pendingRequests: 1 });
  release();
  const result = await pending;
  assert.equal(result.status, "waitingApproval");
  assert.equal(result.pendingRequests, 1);
});
