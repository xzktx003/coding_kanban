import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { createDynamicToolsRouter } = createRequire(import.meta.url)("../src/dynamic-tools-routing.cjs");

function fixture(withStart, withSend) {
  const sender = { isDestroyed: () => false }, record = { senderId: 1, failed: false, window: { webContents: sender, isDestroyed: () => false } };
  const router = createDynamicToolsRouter({ getRecord: () => record, getOwnedRecord: s => s === sender ? record : undefined, withStart, withSend });
  return { sender, router };
}

test("owned original shared start waits for actual creation binding before original callback and first turn", async () => {
  const events = [], f = fixture(async (sender, host, params, invoke) => {
    assert.equal(sender, f.sender); assert.equal(host, "kanban-shared-cli"); assert.equal(params.__kanbanSharedCreateAttempt, "captured");
    return invoke({ ...params, clean: true }, async id => { await Promise.resolve(); events.push(`bound:${id}`); });
  });
  const manager = { async startConversation(params, opts) { events.push("native-start"); assert.equal(params.clean, true); await opts.afterConversationCreated("actual-native-uuid"); events.push("native-first-turn"); return "accepted"; } };
  const wrapped = f.router.bindManagers({ open: () => ({ status: "ready", manager }) }, f.sender).open("kanban-shared-cli").manager;
  assert.equal(await wrapped.startConversation({ __kanbanSharedCreateAttempt: "captured" }, { afterConversationCreated: async id => { events.push(`original-callback:${id}`); } }), "accepted");
  assert.deepEqual(events, ["native-start", "bound:actual-native-uuid", "original-callback:actual-native-uuid", "native-first-turn"]);
});

test("actual original turn coordinator send keeps message/options/callbacks and removes only its one-use send marker", async () => {
  const events = [], callbacks = {}, messageContext = { prompt: "original", __kanbanSharedSendAttempt: "captured-send", addedFiles: [] };
  const input = { conversationId: "actual-thread", message: { text: "original", context: messageContext }, options: { selected: true } };
  let f;
  f = fixture(undefined, (sender, host, params, invoke) => {
    assert.equal(sender, f.sender); assert.equal(host, "kanban-shared-cli"); assert.equal(params.__kanbanSharedSendAttempt, "captured-send");
    events.push("guarded-send"); return invoke({ conversationId: params.conversationId });
  });
  const coordinator = { async sendMessage(value, observedCallbacks) {
    assert.equal(f.router.selectWindow().webContents, f.sender);
    assert.equal(observedCallbacks, callbacks); assert.equal(value.options, input.options);
    assert.deepEqual(value.message.context, { prompt: "original", addedFiles: [] });
    events.push("original-send"); return "accepted";
  }, getStableValue() { return this; } };
  const manager = { async getTurnCoordinator() { return coordinator; } };
  const wrappedManager = f.router.bindManagers({ open: () => ({ status: "ready", manager }) }, f.sender).open("kanban-shared-cli").manager;
  const boundCoordinator = await wrappedManager.getTurnCoordinator();
  assert.equal(await boundCoordinator.sendMessage(input, callbacks), "accepted");
  assert.equal(boundCoordinator.getStableValue(), coordinator); assert.equal(input.message.context, messageContext);
  assert.equal(messageContext.__kanbanSharedSendAttempt, "captured-send"); assert.deepEqual(events, ["guarded-send", "original-send"]);
});

test("ordinary original turn coordinator is unchanged for another host", async () => {
  const f = fixture(undefined, () => { throw Error("shared only"); }), coordinator = { sendMessage() { return "local"; } };
  const manager = { getTurnCoordinator() { return coordinator; } };
  const wrapped = f.router.bindManagers({ open: () => ({ status: "ready", manager }) }, f.sender).open("local").manager;
  assert.equal(wrapped.getTurnCoordinator(), coordinator); assert.equal(wrapped.getTurnCoordinator().sendMessage(), "local");
});

test("private original creation keeps original params and callback identity", async () => {
  let called = 0; const f = fixture(() => { called++; throw new Error("shared path"); });
  const callback = () => {}, params = { input: [] }, opts = { afterConversationCreated: callback };
  const manager = { startConversation(p, o) { assert.equal(p, params); assert.equal(o, opts); return "private"; } };
  const wrapped = f.router.bindManagers({ open: () => ({ status: "ready", manager }) }, f.sender).open("local").manager;
  assert.equal(wrapped.startConversation(params, opts), "private"); assert.equal(called, 0);
});

test("original creation callback dup and dispose remain owned by the original lifetime", async () => {
  const events = [], callback = () => { events.push("original"); };
  callback.dup = () => { events.push("dup"); const copy = () => events.push("original-dup"); copy[Symbol.dispose] = () => events.push("dispose-dup"); return copy; };
  const f = fixture((_s, _h, p, invoke) => invoke(p, async () => { events.push("bound"); }));
  const manager = { async startConversation(_p, o) { const copy = o.afterConversationCreated.dup(); try { await copy("actual"); } finally { copy[Symbol.dispose](); } } };
  const wrapped = f.router.bindManagers({ open: () => ({ status: "ready", manager }) }, f.sender).open("kanban-shared-cli").manager;
  await wrapped.startConversation({}, { afterConversationCreated: callback });
  assert.deepEqual(events, ["dup", "bound", "original-dup", "dispose-dup"]);
});
