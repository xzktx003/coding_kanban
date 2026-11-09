import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserInputScope } from "../src/browser-input-scope.mjs";

const documentScope = {
  profileId: "ba493746-92e0-4f21-9085-776433bbcb30",
  generation: "6014e074-2275-415b-8211-1a5776a05425",
  viewId: "74d49baa-dcd3-486b-8422-08f8bfa799c0",
};
const a = {
  hostId: "local",
  conversationId: "thread-A",
  clientThreadId: "client-A",
};
const b = {
  hostId: "remote",
  conversationId: "thread-B",
  clientThreadId: "client-B",
};

test("only one committed native input owner can grant a local editing scope", () => {
  const scope = createBrowserInputScope(documentScope);
  assert.equal(scope.capture(), null);
  const first = scope.register(a),
    captured = scope.capture();
  assert.deepEqual(captured.target, a);
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.target));
  assert.equal(scope.isCurrent(captured), true);
  const second = scope.register(b);
  assert.equal(scope.capture(), null);
  assert.equal(scope.isCurrent(captured), false);
  first.dispose();
  const current = scope.capture();
  assert.deepEqual(current.target, b);
  first.dispose();
  assert.equal(
    scope.isCurrent(current),
    true,
    "late old cleanup cannot clear a new owner",
  );
  second.dispose();
  assert.equal(scope.capture(), null);
});

test("target switches and same-value revisions invalidate pending clipboard work", () => {
  const scope = createBrowserInputScope(documentScope),
    owner = scope.register(a);
  const before = scope.capture();
  owner.update(b);
  assert.equal(scope.isCurrent(before), false);
  const atB = scope.capture();
  owner.update({ ...b });
  assert.equal(
    scope.isCurrent(atB),
    false,
    "a new native confirmation is a new revision",
  );
  assert.equal(scope.isCurrent(scope.capture()), true);
  scope.dispose();
  assert.equal(scope.capture(), null);
  assert.equal(scope.isCurrent(before), false);
  assert.throws(() => owner.update(a), { code: "INPUT_SCOPE_CLOSED" });
});

test("a different document, copied token or forged target never passes the captured identity", () => {
  const first = createBrowserInputScope(documentScope),
    second = createBrowserInputScope(documentScope);
  first.register(a);
  second.register(a);
  const token = first.capture();
  assert.equal(second.isCurrent(token), false);
  assert.equal(first.isCurrent({ ...token }), false);
  assert.equal(first.isCurrent({ ...token, target: b }), false);
  assert.equal(first.isCurrent(null), false);
  first.dispose();
  second.dispose();
});

test("invalid target metadata revokes its prior owner before rejecting", () => {
  const scope = createBrowserInputScope(documentScope),
    owner = scope.register(a),
    before = scope.capture();
  assert.throws(() => owner.update({ ...a, hostId: "" }), {
    code: "INPUT_SCOPE_INVALID_TARGET",
  });
  assert.equal(scope.isCurrent(before), false);
  assert.equal(scope.capture(), null);
  owner.update(b);
  assert.deepEqual(scope.capture().target, b);
  owner.dispose();
});

test("validates metadata without invoking accessors and bounds concurrent owners", () => {
  let read = 0;
  assert.throws(
    () => createBrowserInputScope({ ...documentScope, viewId: "bad" }),
    { code: "INPUT_SCOPE_INVALID_DOCUMENT" },
  );
  const scope = createBrowserInputScope(documentScope);
  const malicious = { ...a };
  Object.defineProperty(malicious, "conversationId", {
    get() {
      read++;
      return "value";
    },
    enumerable: true,
  });
  assert.throws(() => scope.register(malicious), {
    code: "INPUT_SCOPE_INVALID_TARGET",
  });
  assert.equal(read, 0);
  assert.throws(() => scope.register({ ...a, extra: "not metadata" }), {
    code: "INPUT_SCOPE_INVALID_TARGET",
  });
  const owners = Array.from({ length: 16 }, () => scope.register(a));
  assert.throws(() => scope.register(a), { code: "INPUT_SCOPE_OWNER_LIMIT" });
  assert.equal(scope.capture(), null);
  owners.forEach((owner) => owner.dispose());
  scope.dispose();
  assert.throws(() => scope.register(a), { code: "INPUT_SCOPE_CLOSED" });
});

test("an explicit new-chat null remains a distinct local draft target", () => {
  const scope = createBrowserInputScope(documentScope);
  const draft = {
    hostId: "local",
    conversationId: null,
    clientThreadId: "pending-client-A",
  };
  const owner = scope.register(draft),
    first = scope.capture();
  assert.deepEqual(first.target, draft);
  owner.update({ ...draft });
  assert.equal(scope.isCurrent(first), false);
  const pending = scope.capture();
  owner.update({ ...a, clientThreadId: draft.clientThreadId });
  assert.equal(scope.isCurrent(pending), false);
  assert.equal(scope.capture().target.conversationId, a.conversationId);
  owner.dispose();
});

test("a new draft still requires actual host and client identity and an explicit conversation field", () => {
  const scope = createBrowserInputScope(documentScope);
  for (const invalid of [
    { hostId: "local", clientThreadId: "pending" },
    { hostId: "local", conversationId: undefined, clientThreadId: "pending" },
    { hostId: null, conversationId: null, clientThreadId: "pending" },
    { hostId: "local", conversationId: null, clientThreadId: null },
    { hostId: "local", conversationId: null, clientThreadId: "" },
  ])
    assert.throws(() => scope.register(invalid), {
      code: "INPUT_SCOPE_INVALID_TARGET",
    });
  assert.equal(scope.capture(), null);
});
