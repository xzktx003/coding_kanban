import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopFooterOwnership } from "../src/desktop-layout-core.mjs";
import { createDesktopSplitPaneRegistry } from "../src/desktop-split-pane-core.mjs";

const a = Object.freeze({
  hostId: "local",
  conversationId: "thread-a",
  clientThreadId: "client-a",
});
const b = Object.freeze({
  hostId: "local",
  conversationId: "thread-b",
  clientThreadId: "client-b",
});
const draft = Object.freeze({
  hostId: "local",
  conversationId: null,
  clientThreadId: "new-client",
});

test("one original draft source follows an explicit host change before creation", () => {
  const f = fixture(), source = {}, owner = {};
  const context = scope => ({
    thread: { clientThreadId: scope.clientThreadId, routeConversationId: null },
    route: { routeKind: "client-local-thread", clientThreadId: scope.clientThreadId,
      pathname: "/local/" + scope.clientThreadId, search: "" },
    composer: { kind: "local", clientThreadId: scope.clientThreadId,
      conversationId: scope.conversationId, draft: "preserved original draft" },
  });
  const key = f.registry.remember(draft, context(draft), { source });
  const releaseLocal = f.registry.commit(owner, key, draft), old = f.claim(owner);
  const shared = { ...draft, hostId: "kanban-shared-cli" };
  const sharedKey = f.registry.remember(shared, context(shared), { source });
  assert.equal(sharedKey, key, "an original host choice must not create a second pending tab");
  assert.equal(f.registry.getSnapshot().entries.length, 1);
  assert.equal(f.registry.getSnapshot().selected, null, "the old host owner is revoked before the new commit");
  assert.equal(old.slot.lease.isCurrent(old.token, draft), false);
  assert.equal(f.registry.getSnapshot().entries[0].context.composer.draft, "preserved original draft");
  const releaseShared = f.registry.commit(owner, key, shared);
  releaseLocal();
  assert.deepEqual(f.registry.getSnapshot().selected.scope, shared);
  const created = { ...shared, conversationId: "created-shared-thread" };
  assert.equal(f.registry.remember(created, context(created), { source }), key);
  assert.equal(f.registry.getSnapshot().selected, null);
  const releaseCreated = f.registry.commit(owner, key, created);
  releaseShared();
  assert.deepEqual(f.registry.getSnapshot().selected.scope, created);
  assert.throws(() => f.registry.remember(draft, context(draft), { source }), { code: "SPLIT_PANE_STALE_SCOPE" });
  assert.throws(() => f.registry.commit(owner, key, shared), { code: "SPLIT_PANE_STALE_SCOPE" });
  assert.deepEqual(f.registry.getSnapshot().selected.scope, created);
  releaseCreated();old.close();f.registry.dispose();
});
function visibleKeys(node) {
  return node.type === "group"
    ? node.keys
    : [...visibleKeys(node.first), ...visibleKeys(node.second)];
}
function fixture() {
  let id = 0;
  const footer = createDesktopFooterOwnership();
  const registry = createDesktopSplitPaneRegistry({
    footerOwnership: footer,
    idFactory: () => `pane-${++id}`,
  });
  function claim(owner) {
    const selected = registry.getSnapshot().selected;
    assert.ok(selected && selected.owner === owner);
    const slot = footer.createSlot();
    const releaseSlot = slot.commit(selected.paneId);
    const releaseTarget = footer.commitTarget(
      { paneId: selected.paneId, tabKey: selected.tabKey, ...selected.scope },
      selected.layoutRevision,
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
  return { registry, footer, claim };
}

test("one committed original GI owns a single selected footer and release revokes it", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, a);
  const state = f.registry.getSnapshot();
  assert.equal(state.selected.owner, owner);
  assert.deepEqual(state.selected.scope, a);
  assert.ok(Object.isFrozen(state));
  const claim = f.claim(owner);
  assert.ok(claim.token);
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), true);
  off();
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), false);
  assert.equal(f.registry.getSnapshot().selected, null);
  assert.equal(
    f.registry.getSnapshot().entries.length,
    1,
    "presentation reference survives native component unmount",
  );
  claim.close();
  f.registry.dispose();
});

for (const cleanupBeforeNavigation of [true, false]) {
  test(`a departed home draft leaves no unusable tab and can reattach (${cleanupBeforeNavigation ? "cleanup first" : "navigation first"})`, () => {
    const f = fixture(), homeOwner = {}, targetOwner = {};
    const releaseHome = f.registry.attach(homeOwner, draft);
    const draftKey = f.registry.getSnapshot().selected.tabKey;
    if (cleanupBeforeNavigation) releaseHome();
    const targetKey = f.registry.remember(a);
    const releaseTarget = f.registry.commit(targetOwner, targetKey, a);
    if (!cleanupBeforeNavigation) releaseHome();
    assert.deepEqual(visibleKeys(f.registry.getSnapshot().layout.tree), [targetKey]);
    assert.equal(f.registry.getSnapshot().selected.owner, targetOwner);
    releaseTarget();
    const releaseReturn = f.registry.attach({}, draft);
    assert.equal(f.registry.getSnapshot().selected.tabKey, draftKey);
    assert.ok(visibleKeys(f.registry.getSnapshot().layout.tree).includes(draftKey));
    releaseReturn();
    f.registry.dispose();
  });
}

test("a hidden draft promoted in the background cannot steal the selected target", () => {
  const f = fixture(), homeOwner = {}, targetOwner = {};
  const releaseHome = f.registry.attach(homeOwner, draft);
  const draftKey = f.registry.getSnapshot().selected.tabKey;
  releaseHome();
  const targetKey = f.registry.remember(b);
  const releaseTarget = f.registry.commit(targetOwner, targetKey, b);
  assert.deepEqual(visibleKeys(f.registry.getSnapshot().layout.tree), [targetKey]);
  assert.equal(f.registry.remember({ ...draft, conversationId: "created-late" }), draftKey);
  assert.deepEqual(visibleKeys(f.registry.getSnapshot().layout.tree), [targetKey]);
  assert.equal(f.registry.getSnapshot().selected.owner, targetOwner);
  releaseTarget();
  f.registry.dispose();
});

test("explicit split and focus revoke old scope immediately; an unmatched GI never owns the footer", () => {
  const f = fixture(),
    ownerA = {},
    ownerB = {};
  const offA = f.registry.attach(ownerA, a),
    keyA = f.registry.getSnapshot().selected.tabKey;
  offA();
  const offB = f.registry.attach(ownerB, b),
    selectedB = f.registry.getSnapshot().selected;
  const keyB = selectedB.tabKey,
    claimB = f.claim(ownerB);
  assert.ok(claimB.token);
  assert.equal(f.registry.place(keyB, selectedB.paneId, "right"), true);
  assert.equal(
    claimB.slot.lease.isCurrent(claimB.token, b),
    false,
    "layout revision synchronously revokes the footer",
  );
  claimB.close();
  const nextB = f.claim(ownerB);
  assert.ok(nextB.token);
  assert.equal(f.registry.focus(keyA), true);
  assert.equal(
    nextB.slot.lease.isCurrent(nextB.token, b),
    false,
    "choosing A revokes B before any async UI work",
  );
  assert.equal(
    f.registry.getSnapshot().selected,
    null,
    "B GI cannot stand in for A",
  );
  const lateA = f.registry.attach(ownerA, a);
  assert.deepEqual(
    f.registry.getSnapshot().selected.scope,
    a,
    "only the owner of the selected group can be eligible",
  );
  const competingA = f.registry.attach({}, a);
  assert.equal(
    f.registry.getSnapshot().selected,
    null,
    "two owners for the selected target fail closed",
  );
  competingA();
  offB();
  assert.deepEqual(f.registry.getSnapshot().selected.scope, a);
  nextB.close();
  const claimA = f.claim(ownerA);
  assert.ok(claimA.token);
  assert.equal(claimA.slot.lease.isCurrent(claimA.token, b), false);
  lateA();
  claimA.close();
  f.registry.dispose();
});

test("same identity is stable as a tab but new confirmations and stale cleanup cannot reuse an old footer token", () => {
  const f = fixture(),
    owner = {};
  const first = f.registry.attach(owner, a),
    before = f.registry.getSnapshot().selected;
  const claim = f.claim(owner),
    oldToken = claim.token;
  const second = f.registry.attach(owner, { ...a });
  assert.equal(f.registry.getSnapshot().selected.tabKey, before.tabKey);
  assert.equal(claim.slot.lease.isCurrent(oldToken, a), false);
  first();
  assert.equal(f.registry.getSnapshot().selected.owner, owner);
  claim.close();
  const next = f.claim(owner);
  assert.ok(next.token);
  assert.notEqual(next.token, oldToken);
  second();
  next.close();
  f.registry.dispose();
});

test("new-chat identity must be explicit, invalid scope getters are never invoked, and malformed commit revokes", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, draft);
  const active = f.claim(owner);
  assert.ok(active.token);
  let reads = 0;
  const bad = { ...draft };
  Object.defineProperty(bad, "hostId", {
    get() {
      reads++;
      return "local";
    },
  });
  assert.throws(() => f.registry.attach(owner, bad), {
    code: "SPLIT_PANE_INVALID_SCOPE",
  });
  assert.equal(reads, 0);
  assert.equal(active.slot.lease.isCurrent(active.token, draft), false);
  assert.equal(f.registry.getSnapshot().selected, null);
  off();
  active.close();
  f.registry.dispose();
});

test("closing and resizing only alter local layout and do not invoke a native lifecycle", () => {
  const f = fixture(),
    ownerA = {},
    ownerB = {};
  const offA = f.registry.attach(ownerA, a),
    keyA = f.registry.getSnapshot().selected.tabKey;
  offA();
  const offB = f.registry.attach(ownerB, b),
    keyB = f.registry.getSnapshot().selected.tabKey;
  const oldGroup = f.registry.getSnapshot().selected.paneId;
  f.registry.place(keyB, oldGroup, "bottom");
  const branch = f.registry.getSnapshot().layout.tree;
  assert.equal(branch.type, "split");
  assert.equal(f.registry.resize(branch.id, 65), true);
  assert.equal(f.registry.close(keyA), true);
  assert.equal(
    f.registry.getSnapshot().entries.some((entry) => entry.key === keyA),
    false,
  );
  assert.equal(
    f.registry.getSnapshot().entries.some((entry) => entry.key === keyB),
    true,
  );
  offB();
  f.registry.dispose();
});

test("unknown keys and empty groups cannot create a target; disposal unbinds the exact owned layout", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, a);
  const snap = f.registry.getSnapshot(),
    claim = f.claim(owner);
  assert.equal(f.registry.focus("not-registered"), false);
  assert.equal(
    f.registry.place("not-registered", snap.selected.paneId, "left"),
    false,
  );
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), true);
  f.registry.place(snap.selected.tabKey, snap.selected.paneId, "left");
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), false);
  off();
  claim.close();
  f.registry.dispose();
  const other = createDesktopSplitPaneRegistry({
    footerOwnership: f.footer,
    idFactory: () => "new-pane",
  });
  other.dispose();
});

test("a late GI commit cannot change the selected group or claim another target", () => {
  const f = fixture();
  const keyA = f.registry.remember(a);
  const ownerA = {},
    offA = f.registry.commit(ownerA, keyA, a);
  assert.deepEqual(f.registry.getSnapshot().selected.scope, a);
  const keyB = f.registry.remember(b);
  assert.equal(f.registry.getSnapshot().selected, null);
  const ownerB = {},
    offB = f.registry.commit(ownerB, keyB, b);
  assert.deepEqual(f.registry.getSnapshot().selected.scope, b);
  f.registry.focus(keyA);
  assert.deepEqual(f.registry.getSnapshot().selected.scope, a);
  const stale = f.registry.commit({}, keyB, b);
  assert.equal(
    f.registry.getSnapshot().selected.tabKey,
    keyA,
    "a delayed B commit must not focus B",
  );
  stale();
  offB();
  offA();
  f.registry.dispose();
});

test("real captured thread, route, and composer data are checked before reuse without evaluating getters", () => {
  const f = fixture();
  const context = {
    thread: {
      clientThreadId: a.clientThreadId,
      routeConversationId: a.conversationId,
    },
    route: {
      routeKind: "local-thread",
      hostId: a.hostId,
      conversationId: a.conversationId,
    },
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
    },
  };
  const key = f.registry.remember(a, context);
  const retained = f.registry
    .getSnapshot()
    .entries.find((entry) => entry.key === key);
  assert.equal(retained.context.thread.clientThreadId, a.clientThreadId);
  assert.ok(Object.isFrozen(retained.context.route));
  let reads = 0;
  const bad = { ...context, route: { ...context.route } };
  Object.defineProperty(bad.route, "hostId", {
    enumerable: true,
    get() {
      reads++;
      return "local";
    },
  });
  assert.throws(() => f.registry.remember(a, bad), {
    code: "SPLIT_PANE_INVALID_CONTEXT",
  });
  assert.equal(reads, 0);
  assert.equal(f.registry.getSnapshot().selected, null);
  f.registry.dispose();
});

test("an original client-local draft route without a conversationId remains valid", () => {
  const f = fixture();
  const context = {
    thread: { clientThreadId: draft.clientThreadId, routeConversationId: null },
    route: {
      routeKind: "client-local-thread",
      clientThreadId: draft.clientThreadId,
      pathname: "/local/new-client",
      search: "",
    },
    composer: {
      kind: "local",
      clientThreadId: draft.clientThreadId,
      conversationId: null,
    },
  };
  const key = f.registry.remember(draft, context);
  assert.equal(
    f.registry.getSnapshot().entries.find((entry) => entry.key === key).scope
      .conversationId,
    null,
  );
  assert.throws(
    () =>
      f.registry.remember(draft, {
        ...context,
        route: { ...context.route, clientThreadId: "wrong-client" },
      }),
    { code: "SPLIT_PANE_INVALID_CONTEXT" },
  );
  f.registry.dispose();
});

test("a created conversation on the same client route accepts the actual original scope", () => {
  const f = fixture();
  const created = { ...draft, conversationId: "created-thread" };
  const context = {
    thread: { clientThreadId: draft.clientThreadId, routeConversationId: null },
    route: {
      routeKind: "client-local-thread",
      clientThreadId: draft.clientThreadId,
      pathname: "/local/new-client",
      search: "",
    },
    composer: {
      kind: "local",
      clientThreadId: draft.clientThreadId,
      conversationId: created.conversationId,
    },
  };
  const key = f.registry.remember(created, context);
  const owner = {};
  const off = f.registry.commit(owner, key, created);
  assert.deepEqual(f.registry.getSnapshot().selected.scope, created);
  assert.throws(
    () =>
      f.registry.remember(created, {
        ...context,
        route: { ...context.route, clientThreadId: "another-client" },
      }),
    { code: "SPLIT_PANE_INVALID_CONTEXT" },
  );
  off();
  f.registry.dispose();
});

test("a pending client is promoted in place and stale draft owners cannot reclaim or reopen it", () => {
  const f = fixture();
  const oldOwner = {},
    newOwner = {},
    source = {};
  const key = f.registry.remember(draft, undefined, { source });
  const oldRelease = f.registry.commit(oldOwner, key, draft);
  const oldLease = f.claim(oldOwner);
  const originalGroup = f.registry.getSnapshot().selected.paneId;
  const created = {
    ...draft,
    hostId: "actual-host",
    conversationId: "created-thread",
  };
  const after = f.registry.remember(created, undefined, { focus: false });
  assert.equal(after, key);
  assert.equal(f.registry.getSnapshot().entries.length, 1);
  assert.equal(f.registry.getSnapshot().layout.activeGroupId, originalGroup);
  assert.equal(
    f.registry.getSnapshot().selected,
    null,
    "the old scope must not be granted the new identity",
  );
  assert.equal(oldLease.slot.lease.isCurrent(oldLease.token, draft), false);
  assert.throws(() => f.registry.commit(oldOwner, key, draft), {
    code: "SPLIT_PANE_STALE_SCOPE",
  });
  oldLease.close();
  const newRelease = f.registry.commit(newOwner, key, created);
  const newLease = f.claim(newOwner);
  assert.ok(newLease.slot.lease.isCurrent(newLease.token, created));
  oldRelease();
  assert.equal(f.registry.getSnapshot().selected.owner, newOwner);
  assert.throws(() => f.registry.remember(draft), {
    code: "SPLIT_PANE_STALE_SCOPE",
  });
  assert.ok(newLease.slot.lease.isCurrent(newLease.token, created));
  assert.equal(f.registry.getSnapshot().selected.owner, newOwner);
  assert.equal(f.registry.close(key), true);
  assert.throws(() => f.registry.remember(draft, undefined, { source }), {
    code: "SPLIT_PANE_STALE_SCOPE",
  });
  assert.throws(() => f.registry.attach(oldOwner, draft), {
    code: "SPLIT_PANE_STALE_SCOPE",
  });
  assert.equal(f.registry.getSnapshot().entries.length, 0);
  newLease.close();
  oldLease.close();
  newRelease();
  f.registry.dispose();
});

test("different clients and different completed conversations are not merged", () => {
  const f = fixture();
  const createdA = { ...draft, conversationId: "created-a" };
  const createdB = { ...draft, conversationId: "created-b" };
  const other = {
    hostId: "local",
    clientThreadId: "different-client",
    conversationId: null,
  };
  const first = f.registry.remember(createdA);
  const second = f.registry.remember(createdB);
  const third = f.registry.remember(other);
  assert.equal(new Set([first, second, third]).size, 3);
  assert.equal(f.registry.getSnapshot().entries.length, 3);
  f.registry.dispose();
});

test("background promotion never changes the explicitly selected conversation", () => {
  const f = fixture();
  const draftKey = f.registry.remember(draft, undefined, { source: {} });
  const bKey = f.registry.remember(b);
  const bOwner = {};
  const off = f.registry.commit(bOwner, bKey, b);
  const pane = f.registry.getSnapshot().selected.paneId;
  const promoted = f.registry.remember(
    { ...draft, conversationId: "created-in-background" },
    undefined,
    { focus: true },
  );
  assert.equal(promoted, draftKey);
  assert.equal(f.registry.getSnapshot().selected.owner, bOwner);
  assert.equal(f.registry.getSnapshot().selected.tabKey, bKey);
  assert.equal(f.registry.getSnapshot().selected.paneId, pane);
  off();
  f.registry.dispose();
});

test("a reused React owner may commit the real target while its old cleanup stays harmless", () => {
  const f = fixture();
  const owner = {};
  const key = f.registry.remember(draft, undefined, { source: owner });
  const oldRelease = f.registry.commit(owner, key, draft);
  const created = { ...draft, conversationId: "created-thread" };
  assert.equal(f.registry.remember(created), key);
  const newRelease = f.registry.commit(owner, key, created);
  oldRelease();
  assert.equal(f.registry.getSnapshot().selected.owner, owner);
  assert.deepEqual(f.registry.getSnapshot().selected.scope, created);
  assert.throws(() => f.registry.commit(owner, key, draft), {
    code: "SPLIT_PANE_STALE_SCOPE",
  });
  assert.equal(f.registry.getSnapshot().selected.owner, owner);
  newRelease();
  f.registry.dispose();
});

test("pending draft sources are bounded and each confirmed source is retired", () => {
  const f = fixture();
  const sources = Array.from({ length: 32 }, () => ({}));
  for (const source of sources)
    f.registry.remember(draft, undefined, { source });
  assert.throws(() => f.registry.remember(draft, undefined, { source: {} }), {
    code: "SPLIT_PANE_SOURCE_LIMIT",
  });
  const key = f.registry.remember({
    ...draft,
    conversationId: "created-thread",
  });
  assert.equal(f.registry.close(key), true);
  for (const source of sources)
    assert.throws(() => f.registry.remember(draft, undefined, { source }), {
      code: "SPLIT_PANE_STALE_SCOPE",
    });
  f.registry.dispose();
});

test("invalidated native context revokes old footer before retaining visible layout", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, a),
    claim = f.claim(owner);
  assert.ok(claim.token);
  f.registry.invalidate();
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), false);
  assert.equal(f.registry.getSnapshot().selected, null);
  assert.equal(f.registry.getSnapshot().entries.length, 1);
  off();
  claim.close();
  f.registry.dispose();
});

test("captured nested route data are detached from later changes to the original provider value", () => {
  const f = fixture();
  const project = { hostId: "local", projectId: "project-a" };
  const context = {
    thread: {
      clientThreadId: a.clientThreadId,
      routeConversationId: a.conversationId,
    },
    route: {
      routeKind: "local-thread",
      hostId: a.hostId,
      conversationId: a.conversationId,
      projectContext: project,
    },
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
    },
  };
  const key = f.registry.remember(a, context);
  project.projectId = "project-b";
  const retained = f.registry
    .getSnapshot()
    .entries.find((entry) => entry.key === key);
  assert.equal(retained.context.route.projectContext.projectId, "project-a");
  f.registry.dispose();
});

test("an invalid owner cannot create or select a different presentation target", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, a),
    before = f.registry.getSnapshot();
  assert.throws(() => f.registry.attach(null, b), {
    code: "SPLIT_PANE_INVALID_OWNER",
  });
  const after = f.registry.getSnapshot();
  assert.equal(after.layout, before.layout);
  assert.equal(after.entries.length, 1);
  assert.equal(after.selected.scope.conversationId, a.conversationId);
  off();
  f.registry.dispose();
});

test("over-budget captured scope revokes input and never retains an oversized background snapshot", () => {
  const f = fixture(),
    owner = {},
    off = f.registry.attach(owner, a),
    claim = f.claim(owner);
  const oversized = {
    thread: { clientThreadId: a.clientThreadId },
    route: {
      conversationId: a.conversationId,
      hostId: a.hostId,
      extra: "x".repeat(70000),
    },
    composer: {
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
    },
  };
  assert.throws(() => f.registry.remember(a, oversized), {
    code: "SPLIT_PANE_INVALID_CONTEXT",
  });
  assert.equal(claim.slot.lease.isCurrent(claim.token, a), false);
  assert.equal(f.registry.getSnapshot().selected, null);
  assert.equal(f.registry.getSnapshot().entries[0].context, undefined);
  off();
  claim.close();
  f.registry.dispose();
});


test("closing a multi-tab pane retires exactly its local owners and revokes stale footer claims",()=>{
 const f=fixture(),ownerA={},ownerB={},ownerC={};
 const offA=f.registry.attach(ownerA,a),keyA=f.registry.getSnapshot().selected.tabKey;
 const offB=f.registry.attach(ownerB,b),keyB=f.registry.getSnapshot().selected.tabKey;
 f.registry.place(keyB,f.registry.getSnapshot().selected.paneId,"right");
 const closing=f.registry.getSnapshot().selected.paneId;
 const c={hostId:"local",conversationId:"thread-c",clientThreadId:"client-c"};
 const offC=f.registry.attach(ownerC,c),keyC=f.registry.getSnapshot().selected.tabKey;
 const claimC=f.claim(ownerC);assert.ok(claimC.token);
 assert.equal(f.registry.closeGroup(closing),true);
 assert.equal(claimC.slot.lease.isCurrent(claimC.token,c),false);
 assert.deepEqual(visibleKeys(f.registry.getSnapshot().layout.tree),[keyA]);
 assert.deepEqual(f.registry.getSnapshot().entries.map(x=>x.key),[keyA]);
 assert.equal(f.registry.getSnapshot().entries.some(x=>x.key===keyB||x.key===keyC),false);
 const after=f.registry.getSnapshot();offB();offC();assert.equal(f.registry.getSnapshot(),after,"late closed owners cannot mutate remaining pane");
 assert.deepEqual(after.selected.scope,a);claimC.close();
 f.registry.closeGroup(after.layout.activeGroupId);assert.equal(f.registry.getSnapshot().selected,null);assert.equal(f.registry.getSnapshot().entries.length,0);
 offA();f.registry.dispose();
});
