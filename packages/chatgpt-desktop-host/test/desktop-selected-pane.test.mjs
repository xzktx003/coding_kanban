import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopSelectedPaneRegistry } from "../src/desktop-selected-pane-core.mjs";
import { createDesktopFooterOwnership } from "../src/desktop-layout-core.mjs";

const scope = Object.freeze({
  hostId: "local",
  conversationId: "thread-a",
  clientThreadId: "client-a",
});
function fixture() {
  const footerOwnership = createDesktopFooterOwnership();
  let id = 0;
  const registry = createDesktopSelectedPaneRegistry({
    footerOwnership,
    idFactory: () => `pane-${++id}`,
  });
  function claim(identity = scope) {
    const snapshot = registry.getSnapshot();
    assert.ok(snapshot);
    const slot = footerOwnership.createSlot(),
      releaseSlot = slot.commit(snapshot.paneId);
    const releaseTarget = footerOwnership.commitTarget(
      { paneId: snapshot.paneId, tabKey: snapshot.tabKey, ...identity },
      snapshot.layoutRevision,
    );
    return {
      slot,
      token: slot.lease.getSnapshot(),
      close() {
        releaseTarget();
        releaseSlot();
      },
    };
  }
  return { registry, footerOwnership, claim };
}

test("one committed native page gets an independent pane binding without granting footer ownership itself", () => {
  const f = fixture(),
    owner = {},
    release = f.registry.attach(owner, scope),
    snapshot = f.registry.getSnapshot();
  assert.equal(snapshot.owner, owner);
  assert.ok(Object.isFrozen(snapshot));
  const slot = f.footerOwnership.createSlot(),
    off = slot.commit(snapshot.paneId);
  assert.equal(
    slot.lease.getSnapshot(),
    null,
    "the original boundary must still commit its native target",
  );
  off();
  const claim = f.claim();
  assert.ok(claim.token);
  claim.close();
  off();
  release();
  assert.equal(f.registry.getSnapshot(), null);
  f.registry.dispose();
});

test("competing or invalid main pages revoke all old footer leases and never pick the first page", () => {
  const f = fixture(),
    a = {},
    b = {},
    releaseA = f.registry.attach(a, scope),
    claim = f.claim();
  const releaseB = f.registry.attach(b, {
    ...scope,
    conversationId: "thread-b",
  });
  assert.equal(f.registry.getSnapshot(), null);
  assert.equal(claim.slot.lease.isCurrent(claim.token, scope), false);
  releaseB();
  assert.equal(f.registry.getSnapshot().owner, a);
  const invalid = f.registry.attach(b, { ...scope, clientThreadId: undefined });
  assert.equal(f.registry.getSnapshot(), null);
  invalid();
  assert.equal(f.registry.getSnapshot().owner, a);
  claim.close();
  releaseA();
  f.registry.dispose();
});

test("same-owner confirmation and assigned-thread changes revoke previous claims; stale cleanup cannot remove a replacement", () => {
  const f = fixture(),
    owner = {},
    old = f.registry.attach(owner, scope),
    claim = f.claim();
  const next = f.registry.attach(owner, { ...scope });
  assert.equal(claim.slot.lease.isCurrent(claim.token, scope), false);
  claim.close();
  old();
  assert.equal(f.registry.getSnapshot().owner, owner);
  next();
  const draft = f.registry.attach(owner, { ...scope, conversationId: null });
  assert.ok(f.registry.getSnapshot());
  const pending = f.claim({ ...scope, conversationId: null });
  assert.ok(pending.token);
  const assigned = f.registry.attach(owner, scope);
  assert.equal(
    pending.slot.lease.isCurrent(pending.token, {
      ...scope,
      conversationId: null,
    }),
    false,
  );
  draft();
  assert.equal(f.registry.getSnapshot().owner, owner);
  assigned();
  pending.close();
  claim.close();
  f.registry.dispose();
});

test("malformed descriptors are not read and cleanup releases the exact layout binding", () => {
  const f = fixture(),
    owner = {};
  let reads = 0;
  const invalid = { ...scope };
  Object.defineProperty(invalid, "hostId", {
    get() {
      reads++;
      return "local";
    },
  });
  const off = f.registry.attach(owner, invalid);
  assert.equal(reads, 0);
  assert.equal(f.registry.getSnapshot(), null);
  off();
  f.registry.dispose();
  assert.throws(() => f.registry.attach(owner, scope), {
    code: "SELECTED_PANE_CLOSED",
  });
  let fresh = 0;
  const again = createDesktopSelectedPaneRegistry({
    footerOwnership: f.footerOwnership,
    idFactory: () => `fresh-pane-${++fresh}`,
  });
  const release = again.attach({}, scope);
  assert.ok(again.getSnapshot());
  release();
  again.dispose();
});
