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
