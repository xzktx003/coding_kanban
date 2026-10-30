import test from "node:test";
import assert from "node:assert/strict";
import { SessionManagement } from "./session-management.js";

async function fixture() {
  const state = { account: "account-a" };
  const store = new SessionManagement({ accountScope: async () => state.account });
  const initial = await store.snapshot();
  const target = { namespace: initial.namespaces.codex!, kind: "codex" as const, id: "thread" };
  let seq = 0;
  const apply = (action: any) => store.apply({ operationId: `op-${++seq}`, target, action });
  return { store, target, apply, state };
}
test("pins use exact provider/account/thread identity and stale edits conflict", async () => {
  const f = await fixture();
  await f.apply({ type: "pin", value: true, expectedRevision: 0 });
  await assert.rejects(f.apply({ type: "pin", value: false, expectedRevision: 0 }), /其他设备/);
  f.state.account = "account-b";
  assert.equal((await f.store.snapshot()).entries.length, 0);
  await assert.rejects(f.apply({ type: "pin", value: false, expectedRevision: 1 }), /账号/);
});
test("manual unread defeats a late auto-read and old watermarks cannot read future replies", async () => {
  const f = await fixture();
  await f.apply({ type: "complete", replyId: "first" });
  await f.apply({ type: "read", replyId: "first", manualUnreadRevision: 0 });
  await f.apply({ type: "unread" });
  await assert.rejects(f.apply({ type: "read", replyId: "first", manualUnreadRevision: 0 }), /未读/);
  await f.apply({ type: "complete", replyId: "second" });
  const result = await f.apply({ type: "read", replyId: "first", manualUnreadRevision: 1 });
  assert.deepEqual(result.entries[0].read, ["first"]);
});
test("lost response replay is idempotent and ID reuse cannot change an operation", async () => {
  const f = await fixture();
  const input = { operationId: "lost", target: f.target, action: { type: "unread" as const } };
  const first = await f.store.apply(input), second = await f.store.apply(input);
  assert.equal(first.revision, second.revision);
  await assert.rejects(f.store.apply({ ...input, action: { type: "complete", replyId: "new" } }), /标识/);
});
test("account change while target verification is pending cannot write the former namespace", async () => {
  let account = "before", release!: () => void;
  const verifying = new Promise<void>(resolve => { release = resolve; });
  const store = new SessionManagement({ accountScope: async () => account, verifyTarget: () => verifying });
  const snapshot = await store.snapshot();
  const operation = store.apply({ operationId: "late-pin", target: { namespace: snapshot.namespaces.codex!, kind: "codex", id: "thread" }, action: { type: "pin", value: true, expectedRevision: 0 } });
  await new Promise(resolve => setTimeout(resolve, 0));
  account = "after"; release();
  await assert.rejects(operation, /账号/);
  account = "before";
  assert.equal((await store.snapshot()).entries.length, 0);
});
test("native CAS account change retains an unknown intent without publishing a local read", async () => {
  let account = "a", nativeCalls = 0;
  const store = new SessionManagement({ accountScope: async () => account, nativeRead: async () => { nativeCalls++; account = "b"; } });
  const snapshot = await store.snapshot(), target = { namespace: snapshot.namespaces.codex!, kind: "codex" as const, id: "thread" };
  await store.apply({ operationId: "complete", target, action: { type: "complete", replyId: "reply" } });
  const operation = { operationId: "native-read", target, action: { type: "read" as const, replyId: "reply", manualUnreadRevision: 0, nativeReadRevision: "opaque-r", nativeScope: "captured-scope" } };
  await assert.rejects(store.apply(operation), /账号/);
  account = "a";
  const replay = await store.apply(operation);
  assert.equal(replay.operationStatus, "unknown"); assert.deepEqual(replay.entries[0].read, []); assert.equal(nativeCalls, 1);
});
test("expired server-issued operation windows reject old UUIDs after receipt compaction", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const f = await fixture(), snapshot = await f.store.snapshot();
  const old = { operationId: "old-window", windowId: snapshot.operationWindow.id, target: f.target, action: { type: "unread" as const } };
  await f.store.apply(old);
  t.mock.timers.tick(11 * 60_000);
  const latest = await f.store.snapshot();
  assert.notEqual(latest.operationWindow.id, old.windowId);
  await assert.rejects(f.store.apply(old), /窗口已失效/);
  assert.equal(latest.entries[0].manualUnreadRevision, 1);
});
test("configured native read synchronization cannot be bypassed by omitting the captured revision or scope", async () => {
  let writes = 0;
  const store = new SessionManagement({ accountScope: async () => "account", nativeRead: async () => { writes++; } });
  const snapshot = await store.snapshot(), target = { namespace: snapshot.namespaces.codex!, kind: "codex" as const, id: "thread" };
  await store.apply({ operationId: "seed", target, action: { type: "complete", replyId: "reply" } });
  let index = 0;
  for (const action of [
    { type: "unread" },
    { type: "read", replyId: "reply", manualUnreadRevision: 0 },
    { type: "unread", nativeReadRevision: "captured" },
    { type: "read", replyId: "reply", manualUnreadRevision: 0, nativeScope: "scope" },
  ]) await assert.rejects(store.apply({ operationId: `missing-${index++}`, target, action: action as any }), /原生.*已读|捕获/);
  assert.equal(writes, 0);
  const entry = (await store.snapshot()).entries[0];
  assert.equal(entry.manualUnreadRevision, 0);
  assert.deepEqual(entry.read, []);
  const cc = { namespace: snapshot.namespaces.cc!, kind: "cc" as const, id: "thread" };
  await store.apply({ operationId: "cc-seed", target: cc, action: { type: "complete", replyId: "cc-reply" } });
  const result = await store.apply({ operationId: "cc-read", target: cc, action: { type: "read", replyId: "cc-reply", manualUnreadRevision: 0 } });
  assert.deepEqual(result.entries.find(entry => entry.kind === "cc")!.read, ["cc-reply"]);
  assert.equal(writes, 0);
});
