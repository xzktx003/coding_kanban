import assert from "node:assert/strict";
import { test } from "node:test";
import { Ownership, readHistory, type Rpc } from "./ownership.js";
import { object, type Json, type JsonObject } from "../core/json.js";

function fixture() {
  const calls: Array<{ method: string; params: Json }> = [];
  const state = { loaded: false, blocked: false, background: false, active: false, unknown: false,
    child: false, input: false, goal: false };
  const raw: Rpc = async (method, params): Promise<Json> => {
    calls.push({ method, params });
    if (method === "thread/start") { state.loaded = true; return { thread: { id: "t" } }; }
    if (method === "thread/read") return { thread: { id: object(params).threadId, historyMode: "legacy", turns: [], source: "cli",
      status: { type: state.active ? "active" : "idle" }, ...(state.child ? { parentThreadId: "parent", canAcceptDirectInput: state.input } : {}) } };
    if (method === "thread/loaded/list") return { data: state.loaded ? ["t"] : [], nextCursor: null };
    if (method === "thread/resume") { if (state.blocked) throw new Error("Thread already has an active writer"); state.loaded = true; return { thread: { id: "t" } }; }
    if (method === "thread/backgroundTerminals/list") return { data: state.background ? [{ id: "process" }] : [], nextCursor: null };
    if (method === "thread/goal/get") return { goal: state.goal ? { status: "active" } : null };
    if (method === "thread/unsubscribe") return { status: "unsubscribed" };
    if (method === "turn/start") { if (state.unknown) throw new Error("DELIVERY_UNKNOWN: response lost"); return { turn: { id: "turn" } }; }
    if (method === "turn/interrupt") return {};
    throw new Error(`Unexpected ${method}`);
  };
  return { raw, calls, state };
}

function familyFixture(releaseIdleDescendants = true) {
  const calls: Array<{ method: string; params: Json }> = [];
  const loaded = new Set(["root"]);
  const threads = new Map<string, JsonObject>([
    ["root", { id: "root", source: "cli", status: { type: "idle" } }],
  ]);
  const backgrounds = new Map<string, JsonObject>();
  const goals = new Map<string, Json>();
  let nextCreated = "root";
  let failMutation = false;
  let beforeUnsubscribe: (() => void) | undefined;
  let hook: ((method: string, params: Json) => void | Promise<void>) | undefined;
  const raw: Rpc = async (method, params, options) => {
    if (method === "thread/unsubscribe") { beforeUnsubscribe?.(); options?.beforeSend?.(); }
    calls.push({ method, params });
    const id = String(object(params).threadId);
    let result: Json;
    if (method === "thread/loaded/list") result = { data: [...loaded], nextCursor: null };
    else if (method === "thread/read") {
      const thread = threads.get(id);
      if (!thread) throw new Error("Unknown thread");
      result = { thread: { ...thread } };
    } else if (method === "thread/backgroundTerminals/list") result = backgrounds.get(id) ?? { data: [], nextCursor: null };
    else if (method === "thread/goal/get") result = { goal: goals.get(id) ?? null };
    else if (method === "thread/unsubscribe") result = { status: "unsubscribed" };
    else if (method === "thread/start") { loaded.add(nextCreated); result = { thread: threads.get(nextCreated)! }; }
    else if (method === "thread/resume") { loaded.add(id); result = { thread: threads.get(id)! }; }
    else if (method === "turn/start") {
      if (failMutation) throw new Error("DELIVERY_UNKNOWN: fixture response lost");
      result = { turn: { id: "turn" } };
    } else throw new Error(`Unexpected ${method}`);
    await hook?.(method, params);
    return result;
  };
  const owner = new Ownership(raw, { releaseIdleDescendants });
  owner.queueUpdate(1n, false, []);
  const child = (id: string, parent = "root", type = "idle") => {
    threads.set(id, { id, parentThreadId: parent, source: { subAgent: { thread_spawn: { parent_thread_id: parent } } }, status: { type }, canAcceptDirectInput: true });
    loaded.add(id);
  };
  return {
    calls, loaded, threads, backgrounds, goals, owner, child,
    hook(value: typeof hook) { hook = value; },
    nextCreated(value: string) { nextCreated = value; },
    failMutation(value: boolean) { failMutation = value; },
    beforeUnsubscribe(value: typeof beforeUnsubscribe) { beforeUnsubscribe = value; },
    unsubscribed: () => calls.filter(call => call.method === "thread/unsubscribe").map(call => object(call.params).threadId),
  };
}

test("idle loaded descendants allow only the parent subscription to release, with ACK distinct from unload", async () => {
  const f = familyFixture(); f.child("child");
  assert.equal((await f.owner.release("root")).state, "releasing");
  assert.deepEqual(f.unsubscribed(), ["root"]);
  assert.equal((await f.owner.release("root")).state, "releasing");
  f.owner.observe("thread/closed", { threadId: "root" });
  assert.equal((await f.owner.access("root")).state, "releasing");
  f.loaded.delete("root");
  assert.equal((await f.owner.release("root")).state, "readonly");
  assert.ok(f.loaded.has("child"));
  assert.deepEqual(f.unsubscribed(), ["root"]);
});

for (const target of ["root", "child"]) {
  test(`an unfinished ${target} turn fences idle metadata until its exact completion`, async () => {
    const f = familyFixture();
    if (target === "child") f.child("child");
    f.owner.observe("turn/started", { threadId: target, turn: { id: "running" } });
    // Reconnection/status snapshots can lag the authoritative turn lifecycle.
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), []);
    f.owner.observe("turn/completed", { threadId: target, turn: { id: "older", status: "completed" } });
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), []);
    f.owner.observe("turn/completed", { threadId: target, turn: { id: "running", status: "completed" } });
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), ["root"]);
  });
}

test("an accepted running turn is held before its start notification arrives", async () => {
  const f = fixture();
  const owner = new Ownership(async (method, params) => {
    const result = await f.raw(method, params);
    return method === "turn/start" ? { turn: { id: "accepted", status: "inProgress" } } : result;
  });
  owner.queueUpdate(1n, false, []);
  await owner.call("turn/start", { threadId: "t" });
  await owner.release("t");
  assert.ok(!f.calls.some(call => call.method === "thread/unsubscribe"));
  owner.observe("turn/completed", { threadId: "t", turn: { id: "accepted", status: "completed" } });
  await owner.release("t");
  assert.equal(f.calls.filter(call => call.method === "thread/unsubscribe").length, 1);
});

test("a delayed start acknowledgement cannot resurrect an already completed turn", async () => {
  const f = fixture();
  let owner: Ownership;
  owner = new Ownership(async (method, params) => {
    const result = await f.raw(method, params);
    if (method !== "turn/start") return result;
    owner.observe("turn/started", { threadId: "t", turn: { id: "accepted" } });
    owner.observe("turn/completed", { threadId: "t", turn: { id: "accepted", status: "completed" } });
    return { turn: { id: "accepted", status: "inProgress" } };
  });
  owner.queueUpdate(1n, false, []);
  await owner.call("turn/start", { threadId: "t" });
  await owner.release("t");
  assert.equal(f.calls.filter(call => call.method === "thread/unsubscribe").length, 1);
});

test("an unloaded intermediate is read without acquisition and its active grandchild protects the root", async () => {
  const f = familyFixture(); f.child("intermediate"); f.child("grandchild", "intermediate", "active");
  f.loaded.delete("intermediate");
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
  assert.ok(f.calls.some(call => call.method === "thread/read" && object(call.params).threadId === "intermediate"));
  assert.ok(!f.calls.some(call => call.method === "thread/resume" || call.method === "turn/interrupt"));
});

test("an unrelated cyclic family and unrelated streaming deltas do not keep a proven root subscribed", async () => {
  const f = familyFixture(); f.child("other-a", "other-b"); f.child("other-b", "other-a");
  f.hook(method => {
    if (method === "thread/goal/get") f.owner.observe("item/agentMessage/delta", { threadId: "unrelated", delta: "synthetic" });
  });
  assert.equal((await f.owner.release("root")).state, "releasing");
  assert.deepEqual(f.unsubscribed(), ["root"]);
});

test("events from the release target during the first loaded query invalidate the entire resource check", async () => {
  const f = familyFixture();
  f.hook(method => {
    if (method === "thread/loaded/list") f.owner.observe("turn/started", { threadId: "root", turn: { id: "new-turn" } });
  });
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
});

test("a child created during loaded enumeration is not absorbed into a later revision baseline", async () => {
  const f = familyFixture(); let created = false;
  f.hook(method => {
    if (method !== "thread/loaded/list" || created) return;
    created = true; f.child("new-child", "root", "active");
    f.owner.observe("thread/started", { thread: f.threads.get("new-child")! });
  });
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
});

test("each descendant preserves active, pending, background, goal, queue, unknown delivery, and first-turn holds", async () => {
  for (const hold of ["active", "status", "pending", "background", "goal", "queue", "uncertain", "firstTurn", "malformed"] as const) {
    const f = familyFixture(); f.child("child");
    if (hold === "active") f.threads.get("child")!.status = { type: "active" };
    if (hold === "status") delete f.threads.get("child")!.status;
    if (hold === "pending") f.owner.pendingRequest("approval", "child");
    if (hold === "background") f.backgrounds.set("child", { data: [{ id: "background" }], nextCursor: null });
    if (hold === "goal") f.goals.set("child", { status: "active" });
    if (hold === "queue") f.owner.queueUpdate(2n, false, ["child"]);
    if (hold === "uncertain") {
      f.failMutation(true);
      await assert.rejects(f.owner.call("turn/start", { threadId: "child" }), /DELIVERY_UNKNOWN/);
    }
    if (hold === "firstTurn") { f.nextCreated("child"); await f.owner.call("thread/start", {}); }
    if (hold === "malformed") f.backgrounds.set("child", {});
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), [], hold);
    if (hold === "background" || hold === "goal" || hold === "malformed") {
      assert.ok(f.calls.some(call => object(call.params).threadId === "child" && call.method === "thread/backgroundTerminals/list"), hold);
    }
  }
});

test("a descendant that becomes busy without a notification is checked again before parent unsubscribe", async () => {
  const f = familyFixture(); f.child("child"); let reads = 0;
  f.hook((method, params) => {
    if (method === "thread/read" && object(params).threadId === "child" && ++reads === 1) {
      f.threads.get("child")!.status = { type: "active" };
    }
  });
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
  assert.ok(reads >= 2);
});

test("runtime invalidation during a release check cannot be overwritten by an old query result", async () => {
  const f = familyFixture(); let invalidated = false;
  f.hook(method => {
    if (method === "thread/loaded/list" && !invalidated) { invalidated = true; f.owner.invalidate(); }
  });
  const access = await f.owner.release("root");
  assert.equal(access.state, "unknown");
  assert.deepEqual(f.unsubscribed(), []);
});

test("a native child source with missing parent identity refuses direct input before resume", async () => {
  const f = familyFixture();
  f.threads.set("child", { id: "child", source: { subAgent: { thread_spawn: {} } }, status: { type: "idle" }, canAcceptDirectInput: true });
  await assert.rejects(f.owner.call("turn/start", { threadId: "child" }), /SUBAGENT_DIRECT_INPUT_DISABLED|SESSION_ACQUIRE_FAILED/);
  assert.deepEqual(f.calls.map(call => call.method), ["thread/read"]);
});

test("child permission revoked after the initial read is verified again before acquisition or turn dispatch", async () => {
  const f = familyFixture(); f.child("child"); let reads = 0;
  f.hook((method, params) => {
    if (method === "thread/read" && object(params).threadId === "child" && ++reads === 1)
      f.threads.get("child")!.canAcceptDirectInput = false;
  });
  await assert.rejects(f.owner.call("turn/start", { threadId: "child" }), /SUBAGENT_DIRECT_INPUT_DISABLED/);
  assert.ok(reads >= 2);
  assert.ok(!f.calls.some(call => call.method === "thread/resume" || call.method === "turn/start"));
});

test("a queued child send cannot use permission read before another operation released the keyed lock", async () => {
  const f = familyFixture(); f.child("child");
  let releaseFirst!: () => void, firstStarted!: () => void, queuedRead!: () => void;
  const release = new Promise<void>(resolve => { releaseFirst = resolve; });
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const read = new Promise<void>(resolve => { queuedRead = resolve; });
  let writes = 0;
  f.hook(async (method, params) => {
    if (method === "thread/read" && object(params).threadId === "child" && writes === 1) queuedRead();
    if (method === "turn/start" && ++writes === 1) { firstStarted(); await release; }
  });
  const first = f.owner.call("turn/start", { threadId: "child" });
  await started;
  const second = f.owner.call("turn/start", { threadId: "child" });
  await read;
  f.threads.get("child")!.canAcceptDirectInput = false;
  releaseFirst();
  await first;
  await assert.rejects(second, /SUBAGENT_DIRECT_INPUT_DISABLED/);
  assert.equal(writes, 1);
});

test("runtime invalidation while reading input permissions prevents resume and turn dispatch", async () => {
  const f = familyFixture();
  f.hook(method => { if (method === "thread/read") f.owner.invalidate(); });
  await assert.rejects(f.owner.call("turn/start", { threadId: "root" }), /SESSION_ACQUIRE_FAILED/);
  assert.ok(!f.calls.some(call => call.method === "thread/resume" || call.method === "turn/start"));
});

test("an unverified native version retains loaded descendants and a child is never an unsubscribe target", async () => {
  const f = familyFixture(false); f.child("child");
  const retained = await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
  assert.match(String(retained.reason), /当前 Codex 版本.*安全释放验收/);
  f.owner.setIdleDescendantRelease(true);
  assert.equal((await f.owner.release("root")).state, "releasing");
  await f.owner.release("child");
  assert.deepEqual(f.unsubscribed(), ["root"]);
});

test("identical queue heartbeats do not starve release but a busy interval invalidates the safety check", async () => {
  for (const busy of [false, true]) {
    const f = familyFixture(); let sequence = 1n;
    f.hook(method => {
      if (method !== "thread/goal/get") return;
      if (busy) f.owner.queueUpdate(++sequence, true, []);
      f.owner.queueUpdate(++sequence, false, []);
    });
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), busy ? [] : ["root"]);
  }
});

test("known pending or uncertain descendants remain protected even when not in loaded/list", async () => {
  for (const hold of ["pending", "uncertain"] as const) {
    const f = familyFixture(); f.child("child");
    if (hold === "pending") f.owner.pendingRequest("approval", "child");
    else {
      f.failMutation(true);
      await assert.rejects(f.owner.call("turn/start", { threadId: "child" }), /DELIVERY_UNKNOWN/);
    }
    f.loaded.delete("child"); f.threads.get("child")!.status = { type: "notLoaded" };
    await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), [], hold);
  }
});

test("new descendant creation during the final loaded query also invalidates parent release", async () => {
  const f = familyFixture(); let queries = 0;
  f.hook(method => {
    if (method !== "thread/loaded/list" || ++queries !== 2) return;
    f.child("late-child", "root", "active");
    f.owner.observe("thread/started", { thread: f.threads.get("late-child")! });
  });
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), []);
});

test("a new child event or pending request immediately before transport dispatch leaves the parent owned and sends no unsubscribe", async () => {
  for (const change of ["child", "pending", "unseenPending", "runtime"] as const) {
    const f = familyFixture(); f.child("child");
    f.beforeUnsubscribe(() => {
      if (change === "child") f.owner.observe("turn/started", { threadId: "child", turn: { id: "busy" } });
      if (change === "pending") f.owner.pendingRequest("approval", "child");
      if (change === "unseenPending") { f.child("new-child"); f.owner.pendingRequest("approval", "new-child"); }
      if (change === "runtime") f.owner.invalidate();
    });
    const access = await f.owner.release("root");
    assert.deepEqual(f.unsubscribed(), [], change);
    assert.equal(access.state, change === "runtime" ? "unknown" : "owned", change);
    assert.match(String(access.reason), change === "runtime" ? /运行连接已断开/ : /状态发生变化/, change);
  }
});

test("a lost unsubscribe receipt is reconciled through loaded/list without repeating the release request", async () => {
  const f = familyFixture();
  f.hook(method => { if (method === "thread/unsubscribe") throw new Error("DELIVERY_UNKNOWN: unsubscribe response lost"); });
  const access = await f.owner.release("root");
  assert.equal(access.state, "releasing");
  assert.deepEqual(f.unsubscribed(), ["root"]);
  await f.owner.release("root");
  assert.deepEqual(f.unsubscribed(), ["root"]);
  f.loaded.delete("root");
  assert.equal((await f.owner.release("root")).state, "readonly");
  assert.deepEqual(f.unsubscribed(), ["root"]);
});

test("reading history never resumes; new empty threads survive until the first accepted turn", async () => {
  const f = fixture(); const owner = new Ownership(f.raw);
  assert.deepEqual(object(await readHistory(f.raw, "t")).thread, { id: "t", historyMode: "legacy", turns: [], source: "cli", status: { type: "idle" } });
  assert.deepEqual(f.calls.map(c => c.method), ["thread/read", "thread/read"]);
  owner.queueUpdate(1n, false, []);
  await owner.call("thread/start", {});
  await owner.sweep("t");
  assert.equal((await owner.access("t")).state, "owned");
  assert.ok(!f.calls.some(c => c.method === "thread/unsubscribe"));
  await owner.call("turn/start", { threadId: "t" });
  await owner.sweep("t");
  assert.equal((await owner.access("t")).state, "releasing");
});

test("external writers and forbidden child input are rejected before the mutation is sent", async () => {
  const f = fixture(); const owner = new Ownership(f.raw);
  f.state.blocked = true;
  await assert.rejects(owner.call("turn/start", { threadId: "t", input: ["original"] }), /SESSION_OWNED_ELSEWHERE/);
  assert.equal((await owner.access("t")).state, "external");
  assert.equal(f.calls.filter(c => c.method === "turn/start").length, 0);
  f.calls.length = 0; f.state.child = true;
  await assert.rejects(owner.call("turn/start", { threadId: "t" }), /SUBAGENT_DIRECT_INPUT_DISABLED/);
  assert.deepEqual(f.calls.map(c => c.method), ["thread/read"]);
  f.state.blocked = false;
  await owner.call("turn/interrupt", { threadId: "t", turnId: "turn" });
  assert.ok(f.calls.some(c => c.method === "turn/interrupt"));
});

test("release waits for authoritative loaded state and no active resource or stale queue permits unload", async () => {
  let now = 0;
  for (const hold of ["queue", "background", "active", "goal", "pending", "unknown"] as const) {
    const f = fixture(); const owner = new Ownership(f.raw, { now: () => now });
    await owner.call("turn/start", { threadId: "t" });
    owner.queueUpdate(1n, false, []);
    if (hold === "queue") now += 10_001;
    else if (hold === "pending") owner.pendingRequest(1, "t");
    else if (hold === "unknown") { f.state.unknown = true; await assert.rejects(owner.call("turn/start", { threadId: "t" }), /DELIVERY_UNKNOWN/); }
    else f.state[hold] = true;
    await owner.release("t");
    assert.equal(f.calls.filter(c => c.method === "thread/unsubscribe").length, 0, hold);
  }
  const f = fixture(); const owner = new Ownership(f.raw);
  owner.queueUpdate(1n, false, []);
  await owner.call("turn/start", { threadId: "t" });
  assert.equal((await owner.release("t")).state, "releasing");
  assert.equal((await owner.release("t")).state, "releasing");
  assert.equal(f.calls.filter(c => c.method === "thread/unsubscribe").length, 1);
  owner.observe("thread/closed", { threadId: "t" });
  assert.equal((await owner.access("t")).state, "releasing");
  f.state.loaded = false;
  assert.equal((await owner.release("t")).state, "readonly");
});

test("late queue snapshots and events during resource checks cannot release a newly busy thread", async () => {
  const f = fixture(); let owner: Ownership;
  const raw: Rpc = async (method, params): Promise<Json> => {
    const result = await f.raw(method, params);
    if (method === "thread/goal/get") owner.observe("turn/started", { threadId: "t" });
    return result;
  };
  owner = new Ownership(raw);
  owner.queueUpdate(100000000000000000001n, false, []);
  assert.equal(owner.queueUpdate(100000000000000000000n, true, ["t"]), false);
  await owner.call("turn/start", { threadId: "t" });
  await owner.release("t");
  assert.ok(!f.calls.some(c => c.method === "thread/unsubscribe"));
});

test("concurrent execution acquires once and serializes mutations; timeout never retries", async () => {
  const f = fixture(); let active = 0, maximum = 0;
  const raw: Rpc = async (method, params): Promise<Json> => {
    if (method === "turn/start") { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; }
    return f.raw(method, params);
  };
  const owner = new Ownership(raw);
  await Promise.all([owner.call("turn/start", { threadId: "t" }), owner.call("turn/start", { threadId: "t" })]);
  assert.equal(maximum, 1);
  assert.equal(f.calls.filter(c => c.method === "thread/resume").length, 1);
  f.state.unknown = true;
  await assert.rejects(owner.call("turn/start", { threadId: "t" }), /DELIVERY_UNKNOWN/);
  assert.equal(f.calls.filter(c => c.method === "turn/start").length, 3);
});

test("loaded descendants, malformed resources and repeated pagination cursors prevent unsafe release", async () => {
  for (const variant of ["child", "malformed", "cursor"] as const) {
    const f = fixture();
    const raw: Rpc = async (method, params): Promise<Json> => {
      if (method === "thread/loaded/list" && f.state.loaded && variant === "child") return { data: ["t", "child"], nextCursor: null };
      if (method === "thread/read" && object(params).threadId === "child") return { thread: { id: "child", parentThreadId: "t" } };
      if (method === "thread/backgroundTerminals/list" && variant === "malformed") return {};
      if (method === "thread/loaded/list" && f.state.loaded && variant === "cursor") return { data: ["t"], nextCursor: "repeat" };
      return f.raw(method, params);
    };
    const owner = new Ownership(raw); owner.queueUpdate(1n, false, []);
    await owner.call("thread/start", {});
    // First accepted turn clears the empty-thread guard without introducing release ambiguity.
    if (variant !== "cursor") await owner.call("turn/start", { threadId: "t" });
    await owner.release("t");
    assert.ok(!f.calls.some(c => c.method === "thread/unsubscribe"), variant);
  }
});

test("paginated history preserves full turns and model metadata, handles empty new threads, and rejects looping cursors", async () => {
  const calls: string[] = [];
  const raw: Rpc = async (method, params): Promise<Json> => {
    calls.push(method);
    if (method === "thread/read") return { thread: { id: "t", historyMode: "paginated", model: "model", turns: [] } };
    return object(params).cursor === null ? { data: [{ id: "a", items: [{ type: "userMessage" }] }], nextCursor: "next" }
      : { data: [{ id: "b", items: [] }], nextCursor: null };
  };
  const thread = object(object(await readHistory(raw, "t")).thread);
  assert.equal(thread.model, "model");
  assert.deepEqual((thread.turns as JsonObject[]).map(t => t.id), ["a", "b"]);
  assert.deepEqual(calls, ["thread/read", "thread/turns/list", "thread/turns/list"]);
  await assert.rejects(readHistory(async (method, params) => method === "thread/read" ? raw(method, params)
    : { data: [], nextCursor: "loop" }, "t"), /repeated.*cursor/i);
  const empty = await readHistory(async (method, params) => {
    if (method === "thread/read") return raw(method, params);
    throw new Error("not materialized yet before first user message");
  }, "t");
  assert.deepEqual(object(object(empty).thread).turns, []);
});
