import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBrowserSharedThreadNavigation } from "../src/browser-shared-thread-navigation.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const events = new Set(),
    subscribers = new Set(),
    sent = [];
  const win = {
    document: {},
    crypto: { randomUUID },
    setTimeout,
    clearTimeout,
    addEventListener: (name, fn) => events.add(fn),
    removeEventListener: (name, fn) => events.delete(fn),
  };
  const scope = {
    profileId: randomUUID(),
    generation: randomUUID(),
    viewId: randomUUID(),
  };
  let token = {};
  const lease = {
    getSnapshot: () => token,
    isCurrent: (value) => value === token && value != null,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  const navigation = createBrowserSharedThreadNavigation(
    {
      window: win,
      documentScope: scope,
      scopeLease: lease,
      sendMessage: (frame) => {
        sent.push(frame);
      },
      timeoutMs: 1000,
    },
    {
      createProbe: () => ({
        dispose() {},
        wrapDelegatedListener: (_r, fn) => fn,
        wrapNavigation: (fn) => fn,
      }),
      createRoot: () => ({ active: true, restored: true, value: {} }),
    },
  );
  const emit = (data) => {
    for (const fn of events) fn({ source: null, data });
  };
  const life = sent[0];
  emit({
    type: "kanban-shared-connect-lifecycle-ack",
    sequence: life.sequence,
    epoch: life.epoch,
  });
  return {
    navigation,
    sent,
    scope,
    life,
    emit,
    retire() {
      token = null;
      for (const fn of subscribers) fn();
    },
    close() {
      navigation.dispose();
    },
  };
}

test("explicit approval captures the current view before delay and resolves only on matching native receipt", async () => {
  const f = fixture();
  await f.navigation.ready();
  const request = {
    hostId: "local",
    threadId: randomUUID(),
    requestId: 42,
    itemId: "fixture-item",
  };
  const action = f.navigation.beginApproval(request);
  const p = action.send(42, "decline");
  await tick();
  const sent = f.sent.find((x) => x.type === "kanban-shared-approval-intent");
  assert.ok(sent);
  assert.equal(sent.requestId, 42);
  assert.equal(sent.itemId, request.itemId);
  assert.equal(sent.sequence, f.life.sequence);
  assert.equal(sent.epoch, f.life.epoch);
  f.emit({
    type: "kanban-shared-approval-result",
    actionId: randomUUID(),
    sequence: sent.sequence,
    epoch: sent.epoch,
    state: "resolved",
  });
  let done = false;
  p.then(() => (done = true));
  await tick();
  assert.equal(done, false);
  f.emit({
    type: "kanban-shared-approval-result",
    actionId: sent.actionId,
    sequence: sent.sequence,
    epoch: sent.epoch,
    state: "resolved",
  });
  await p;
  await assert.rejects(action.send(42, "decline"));
  assert.equal(
    f.sent.filter((x) => x.type === "kanban-shared-approval-intent").length,
    1,
  );
  f.close();
});

test("a delayed approval captured before a view epoch change cannot send", async () => {
  const f = fixture();
  await f.navigation.ready();
  const action = f.navigation.beginApproval({
    hostId: "local",
    threadId: randomUUID(),
    requestId: 42,
    itemId: "x",
  });
  f.retire();
  await assert.rejects(action.send(42, "decline"));
  assert.equal(
    f.sent.filter((x) => x.type === "kanban-shared-approval-intent").length,
    0,
  );
  f.close();
});

test("retirement after a dispatched approval reports unknown and never replays", async () => {
  const f = fixture();
  await f.navigation.ready();
  const action = f.navigation.beginApproval({
    hostId: "local",
    threadId: randomUUID(),
    requestId: 42,
    itemId: "x",
  });
  const p = action.send(42, "decline");
  await tick();
  f.retire();
  await assert.rejects(p, { code: "SHARED_APPROVAL_OUTCOME_UNKNOWN" });
  await assert.rejects(action.send(42, "decline"));
  assert.equal(
    f.sent.filter((x) => x.type === "kanban-shared-approval-intent").length,
    1,
  );
  f.close();
});
