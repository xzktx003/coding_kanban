import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSessionThreads,
  orphanedRuntimes,
  planRuntimeReplacement,
  replaceSessionRuntime,
  runtimeLeadsGroup,
} from "./session-runtime-replace.mjs";

const ready = (overrides = {}) => async () => ({
  state: "ready",
  url: "http://127.0.0.1:45678/api/session/health",
  binaryState: "older",
  pid: 123,
  ownedAgents: { cc: { connections: 0, activeTurns: 0, pendingRequests: 0 }, acp: { connections: 0, activePrompts: 0, pendingRequests: 0, uncertainSessions: 0 } },
  ...overrides,
});

test("automatic stale replacement preserves private active turns; explicit maintenance can stop them", async () => {
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
  assert.equal(busy.action, "skip");
  assert.equal(busy.reason, "active-turns");
  assert.deepEqual(busy.active, ["t1", "t2"]);
  const explicit = await planRuntimeReplacement({ status: ready(), listActive: async () => ["t1", "t2"], force: true });
  assert.equal(explicit.action, "replace");
  assert.equal(explicit.reason, "active-turns-stopped");
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

test("an explicit restart replaces the current runtime without probing unrelated builds", async () => {
  const current = await planRuntimeReplacement({
    status: ready({ binaryState: "current", pid: 9 }),
    listActive: async () => [],
    force: true,
  });
  assert.deepEqual(current, {
    action: "replace",
    reason: "forced",
    pid: 9,
    active: [],
  });

  const busy = await planRuntimeReplacement({
    status: ready({ binaryState: "current", pid: 9 }),
    listActive: async () => ["live"],
    force: true,
  });
  assert.equal(busy.action, "replace");
  assert.deepEqual(busy.active, ["live"]);

  const unknown = await planRuntimeReplacement({
    status: ready({ binaryState: "unknown", pid: 9 }),
    listActive: async () => {
      throw new Error("must not probe an unverified build");
    },
    force: true,
  });
  assert.equal(unknown.action, "skip");
  assert.equal(unknown.reason, "unknown-build");
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

test("shared daemon tasks survive replacement and only the runtime pid is signalled", async () => {
  const decision = await planRuntimeReplacement({
    status: ready({ codexBackend: "shared-daemon" }),
    listActive: async () => ["shared-turn"],
  });
  assert.equal(decision.reason, "shared-tasks-preserved");
  assert.equal(decision.codexBackend, "shared-daemon");
  const sent = [];
  await replaceSessionRuntime({
    plan: async () => decision,
    signal: (pid, name) => sent.push([pid, name]),
    alive: () => false,
    wait: async () => {},
    reap: () => [],
    leadsGroup: () => true,
    log: () => {},
  });
  assert.deepEqual(sent, [[123, "SIGTERM"]]);
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
  await assert.rejects(activeSessionThreads({origin:"http://127.0.0.1:45678",fetcher:async()=>({ok:true,json:async()=>({data:[]})})}),/不完整/);
  let cursor = 0;
  await assert.rejects(activeSessionThreads({origin:"http://127.0.0.1:45678",fetcher:async()=>({ok:true,json:async()=>({data:[],nextCursor:`page-${++cursor}`})})}),/页数|未读完/);
});

test("replacement stops the stale runtime gracefully and escalates only if it survives", async () => {
  const sent = [];
  const graceful = await replaceSessionRuntime({
    plan: async () => ({ action: "replace", reason: "idle", pid: 77, active: [] }),
    signal: (pid, name) => sent.push([pid, name]),
    alive: () => false,
    wait: async () => {},
    reap: () => [],
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
    reap: () => [],
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
    reap: () => [],
    log: () => {},
  });
});

test("group leadership is read from pgid and tolerates spaces in the comm field", () => {
  const stat = (pgid) => `7 (code server) S 1 ${pgid} 7 0 -1 4194560`;
  assert.equal(runtimeLeadsGroup(7, () => stat(7)), true);
  assert.equal(runtimeLeadsGroup(7, () => stat(9)), false);
  assert.equal(
    runtimeLeadsGroup(7, () => {
      throw new Error("ESRCH");
    }),
    false,
  );
});

test("group leadership does not grant ownership of other processes", async () => {
  const sent = [];
  await replaceSessionRuntime({
    plan: async () => ({ action: "replace", reason: "idle", pid: 77, active: [] }),
    signal: (pid, name) => sent.push([pid, name]),
    alive: () => false,
    wait: async () => {},
    reap: () => [],
    leadsGroup: () => true,
    log: () => {},
  });
  assert.deepEqual(sent, [[77, "SIGTERM"]]);

  // A runtime that does not lead its group may share it with another service.
  const shared = [];
  await replaceSessionRuntime({
    plan: async () => ({ action: "replace", reason: "idle", pid: 77, active: [] }),
    signal: (pid, name) => shared.push([pid, name]),
    alive: () => false,
    wait: async () => {},
    reap: () => [],
    leadsGroup: () => false,
    log: () => {},
  });
  assert.deepEqual(shared, [[77, "SIGTERM"]]);
});

test("orphan detection claims only this package's own leaked runtimes", () => {
  const root = "/repo";
  const cwd = `${root}/packages/session-runtime`;
  const entry = `${cwd}/dist/main.js`;
  const processes = {
    11: { cwd, argv: ["/bin/node", entry, "--port", "1"] }, // leaked owner
    12: { cwd, argv: ["/bin/node", entry, "--port", "2"] }, // recorded owner
    13: {
      // A child worktree nests inside the root but is an independent service.
      cwd: `${root}/.worktrees/x/packages/session-runtime`,
      argv: ["/bin/node", `${root}/.worktrees/x/packages/session-runtime/dist/main.js`],
    },
    14: { cwd, argv: ["/bin/node", `${cwd}/dist/tools/other.js`] }, // not the runtime
    15: { cwd: `${root}/apps/server`, argv: ["/bin/node", entry] }, // foreign cwd
  };
  assert.deepEqual(
    orphanedRuntimes({
      root,
      keepPid: 12,
      listPids: () => [11, 12, 13, 14, 15, 16],
      readCwd: (pid) => {
        if (!processes[pid]) throw new Error("ESRCH");
        return processes[pid].cwd;
      },
      readCmdline: (pid) => processes[pid].argv.join("\0"),
    }),
    [11],
  );
});

test("same-entrypoint candidates are read-only diagnostics, including when the selected runtime is skipped", async () => {
  const signals = [];
  const ambiguous = await replaceSessionRuntime({
    plan: async () => ({ action: "skip", reason: "unverified-owner" }),
    reap: () => assert.fail("must not reap without a kept owner"),
    signal: (pid, name) => signals.push([pid, name]),
    alive: () => false,
    log: () => {},
  });
  assert.deepEqual(ambiguous.orphans, []);
  assert.deepEqual(signals, []);

  const stubborn = new Set([77]);
  const skipped = await replaceSessionRuntime({
    plan: async () => ({ action: "skip", reason: "already-current", pid: 12 }),
    reap: () => [77],
    signal: (pid, name) => signals.push([pid, name]),
    alive: (pid) => stubborn.has(pid),
    log: () => {},
  });
  assert.deepEqual(skipped.orphans, []);
  assert.deepEqual(skipped.orphanCandidates, [77]);
  assert.deepEqual(signals, []);
});

test("automatic replacement never stops owned Claude/ACP connections or treats missing counts as idle", async () => {
  for (const ownedAgents of [
    { cc: { connections: 1, activeTurns: 0, pendingRequests: 0 }, acp: { connections: 0, activePrompts: 0, pendingRequests: 0, uncertainSessions: 0 } },
    { cc: { connections: 0, activeTurns: 0, pendingRequests: 0 }, acp: { connections: 1, activePrompts: 1, pendingRequests: 1, uncertainSessions: 0 } },
  ]) {
    const decision = await planRuntimeReplacement({ status: ready({ codexBackend: "shared-daemon", ownedAgents }), listActive: async () => ["shared"] });
    assert.equal(decision.action,"skip");
    assert.equal(decision.reason,"owned-agents-connected");
    const explicit = await planRuntimeReplacement({ status: ready({codexBackend:"shared-daemon",ownedAgents}),listActive:async()=>["shared"],force:true });
    assert.equal(explicit.action,"replace");
    assert.equal(explicit.reason,"owned-agents-stopped");
  }
  const missing=await planRuntimeReplacement({status:ready({ownedAgents:undefined}),listActive:async()=>[]});
  assert.equal(missing.action,"skip");assert.equal(missing.reason,"owned-activity-unknown");
});
test("explicit verified maintenance reports unknown activity without inventing an idle state or sweeping another data home",async()=>{
  const decision=await planRuntimeReplacement({status:ready({ownedAgents:undefined}),listActive:async()=>{throw new Error("offline native");},force:true});
  assert.equal(decision.action,"replace");assert.equal(decision.activityUnknown,true);
  const sent=[];
  const result=await replaceSessionRuntime({plan:async()=>decision,reap:()=>[456],signal:(pid,name)=>sent.push([pid,name]),alive:()=>false,log:()=>{}});
  assert.deepEqual(sent,[[123,"SIGTERM"]]);assert.deepEqual(result.orphanCandidates,[456]);
});
