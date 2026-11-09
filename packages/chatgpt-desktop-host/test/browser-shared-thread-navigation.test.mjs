import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createBrowserSharedThreadNavigation } from "../src/browser-shared-thread-navigation.mjs";
import {
  createBrowserSidebarNavigationProbe,
  SIDEBAR_ATTEMPT_STATE_KEY,
} from "../src/browser-sidebar-navigation-probe.mjs";

const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
function fixture({ initial = true } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "http://localhost/",
  });
  const win = dom.window,
    listeners = new Set(),
    sent = [],
    attempts = new Map();
  const scope = {
    profileId: randomUUID(),
    generation: randomUUID(),
    viewId: randomUUID(),
  };
  let token = initial ? {} : null,
    onAttempt;
  const lease = {
    getSnapshot: () => token,
    isCurrent: (x) => x !== null && x === token,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const createProbe = ({ onAttempt: callback }) => {
    onAttempt = callback;
    return {
      wrapDelegatedListener: (_root, fn) => fn,
      wrapNavigation: (fn) => fn,
      prepareExplicit({ event, hostId, threadId, state, sourceToken }) {
        if (event !== "trusted") return null;
        const candidate = {
          v: 1,
          action: "connect",
          attemptId: randomUUID(),
          ...scope,
          hostId,
          threadId,
          ...(sourceToken === undefined ? {} : { sourceToken }),
        };
        let committed = false,
          cancelled = false;
        attempts.set(candidate.attemptId, candidate);
        onAttempt(candidate);
        return {
          candidate,
          state: { ...state, id: candidate.attemptId },
          commit() {
            if (cancelled || committed) return false;
            committed = true;
            return true;
          },
          cancel() {
            cancelled = true;
            attempts.delete(candidate.attemptId);
          },
        };
      },
      async consumeAttempt({ state, hostId, threadId }) {
        const value = attempts.get(state?.id);
        attempts.delete(state?.id);
        return value?.hostId === hostId && value?.threadId === threadId
          ? value
          : null;
      },
      dispose() {},
    };
  };
  const navigation = createBrowserSharedThreadNavigation(
    {
      window: win,
      documentScope: scope,
      scopeLease: lease,
      sendMessage: (frame) => sent.push(frame),
      timeoutMs: 500,
    },
    { createProbe },
  );
  function message(value) {
    win.dispatchEvent(new win.MessageEvent("message", { data: value }));
  }
  function lifecycleAck(
    frame = sent.findLast((x) => x.type === "kanban-shared-connect-lifecycle"),
  ) {
    message({
      type: "kanban-shared-connect-lifecycle-ack",
      sequence: frame.sequence,
      epoch: frame.epoch,
    });
  }
  function attempt() {
    const candidate = {
      v: 1,
      action: "connect",
      attemptId: randomUUID(),
      ...scope,
      hostId: "local",
      threadId: randomUUID(),
    };
    attempts.set(candidate.attemptId, candidate);
    onAttempt(candidate);
    return candidate;
  }
  function intentAck(frame, accepted = true) {
    message({
      type: "kanban-shared-connect-intent-ack",
      attemptId: frame.attemptId,
      sequence: frame.sequence,
      epoch: frame.epoch,
      accepted,
    });
  }
  return {
    win,
    scope,
    sent,
    navigation,
    lifecycleAck,
    intentAck,
    attempt,
    inactive() {
      token = null;
      for (const fn of listeners) fn();
    },
    activate() {
      token = {};
      for (const fn of listeners) fn();
    },
    close() {
      navigation.dispose();
      dom.window.close();
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a matching route waits for both native lifecycle and the exact accepted intent ACK", async () => {
  const f = fixture();
  try {
    const first = f.sent[0];
    assert.equal(first.type, "kanban-shared-connect-lifecycle");
    f.lifecycleAck(first);
    await f.navigation.ready();
    const value = f.attempt();
    let result = "pending";
    const request = f.navigation
      .consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: value.threadId,
      })
      .then((x) => {
        result = x;
      });
    await tick();
    const sent = f.sent.find((x) => x.type === "kanban-shared-connect-intent");
    assert.ok(sent);
    assert.equal(result, "pending");
    f.intentAck({ ...sent, attemptId: randomUUID() });
    await tick();
    assert.equal(result, "pending");
    f.intentAck(sent);
    await request;
    assert.equal(result, value.attemptId);
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: value.threadId,
      }),
      null,
    );
  } finally {
    f.close();
  }
});
test("refresh, hidden state and a different thread never produce a connection attempt", async () => {
  const f = fixture({ initial: false });
  try {
    f.lifecycleAck();
    await f.navigation.ready();
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: randomUUID() },
        hostId: "local",
        threadId: randomUUID(),
      }),
      null,
    );
    assert.equal(
      f.sent.filter((x) => x.type === "kanban-shared-connect-intent").length,
      0,
    );
    f.activate();
    f.lifecycleAck();
    await tick();
    const value = f.attempt();
    await tick();
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: randomUUID(),
      }),
      null,
    );
    f.inactive();
    f.lifecycleAck();
    await tick();
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: value.threadId,
      }),
      null,
    );
  } finally {
    f.close();
  }
});
test("a late intent ACK after scope revocation cannot release a pending route", async () => {
  const f = fixture();
  try {
    f.lifecycleAck();
    await f.navigation.ready();
    const value = f.attempt();
    await tick();
    const sent = f.sent.find((x) => x.type === "kanban-shared-connect-intent");
    const pending = f.navigation.consumeRoute({
      state: { id: value.attemptId },
      hostId: value.hostId,
      threadId: value.threadId,
    });
    f.inactive();
    f.intentAck(sent);
    assert.equal(await pending, null);
  } finally {
    f.close();
  }
});
test("a native intent ACK received before the route effect remains available exactly once", async () => {
  const f = fixture();
  try {
    f.lifecycleAck();
    await f.navigation.ready();
    const value = f.attempt();
    await tick();
    const sent = f.sent.find((x) => x.type === "kanban-shared-connect-intent");
    f.intentAck(sent);
    await tick();
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: value.threadId,
      }),
      value.attemptId,
    );
    assert.equal(
      await f.navigation.consumeRoute({
        state: { id: value.attemptId },
        hostId: value.hostId,
        threadId: value.threadId,
      }),
      null,
    );
  } finally {
    f.close();
  }
});

test("explicit pane navigation awaits its exact ACK and checks the selection at dispatch", async () => {
  const f = fixture();
  try {
    f.lifecycleAck();
    await f.navigation.ready();
    const threadId = randomUUID(),
      nonce = randomUUID(),
      calls = [];
    let selected = true;
    const pending = f.navigation.activateExplicit({
      event: "trusted",
      hostId: "local",
      threadId,
      state: { pane: nonce },
      isCurrent: () => selected,
      navigate: (...args) => {
        calls.push(args);
        return true;
      },
    });
    await tick();
    const sent = f.sent.find((x) => x.type === "kanban-shared-connect-intent");
    assert.ok(sent);
    assert.equal(calls.length, 0);
    f.intentAck(sent);
    assert.equal(await pending, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], threadId);
    assert.equal(calls[0][1], "local");
    assert.equal(calls[0][2].state.pane, nonce);
    const pendingStale = f.navigation.activateExplicit({
      event: "trusted",
      hostId: "local",
      threadId,
      state: { pane: randomUUID() },
      isCurrent: () => selected,
      navigate: () => {
        calls.push("late");
        return true;
      },
    });
    await tick();
    const latest = f.sent
      .filter((x) => x.type === "kanban-shared-connect-intent")
      .at(-1);
    selected = false;
    f.intentAck(latest);
    assert.equal(await pendingStale, false);
    assert.equal(calls.length, 1);
  } finally {
    f.close();
  }
});

function realProbeFixture() {
  const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
  const win = dom.window, listeners = new Set(), sent = [], calls = [];
  const scope = { profileId: randomUUID(), generation: randomUUID(), viewId: randomUUID() };
  let token = {}, probe;
  const lease = {
    getSnapshot: () => token,
    isCurrent: (value) => value !== null && value === token,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  class Element {
    constructor(attrs = {}) { this.attrs = attrs; this.tagName = "DIV"; this.ownerDocument = win.document; this.isConnected = true; this.isContentEditable = false; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    getAttribute(name) { return this.attrs[name] ?? null; }
  }
  const root = new Element(), row = new Element({
    "data-app-action-sidebar-thread-row": "",
    "data-app-action-sidebar-thread-kind": "local",
    "data-app-action-sidebar-thread-host-id": "forged-dom-host",
  }), label = new Element();
  class Event {
    constructor() { Object.assign(this, { type: "click", target: label, currentTarget: root, eventPhase: 3, isTrusted: true, defaultPrevented: false, button: 0 }); }
    composedPath() { return [label, row, root]; }
  }
  class MouseEvent extends Event {}
  class KeyboardEvent extends Event {}
  const probeWindow = { document: win.document, Element, Event, MouseEvent, KeyboardEvent,
    crypto: { randomUUID }, performance, setTimeout, clearTimeout };
  const navigation = createBrowserSharedThreadNavigation({ window: win, documentScope: scope, scopeLease: lease,
    sendMessage: frame => sent.push(frame), timeoutMs: 500 }, {
    createProbe(options) { probe = createBrowserSidebarNavigationProbe({ ...options, window: probeWindow }); return probe; },
  });
  const navigate = navigation.wrapNavigation((...args) => { calls.push(args); return true; });
  function message(data) { win.dispatchEvent(new win.MessageEvent("message", { data })); }
  function lifecycleAck() { const frame = sent.findLast(x => x.type === "kanban-shared-connect-lifecycle"); message({ type: "kanban-shared-connect-lifecycle-ack", sequence: frame.sequence, epoch: frame.epoch }); }
  function intentAck(frame) { message({ type: "kanban-shared-connect-intent-ack", attemptId: frame.attemptId, sequence: frame.sequence, epoch: frame.epoch, accepted: true }); }
  return { navigation, sent, calls, lifecycleAck, intentAck,
    click(threadId) { return probe.wrapDelegatedListener(root, () => navigate(threadId)).call(root, new MouseEvent()); },
    inactive() { token = null; for (const fn of [...listeners]) fn(); },
    close() { navigation.dispose(); win.close(); },
  };
}

test("an original hostless sidebar click takes the unchanged private navigation path", async () => {
  const f=realProbeFixture(),threadId=randomUUID();try {
    f.lifecycleAck();await f.navigation.ready();assert.equal(f.click(threadId),true);
    assert.deepEqual(f.calls,[[threadId]]);
    assert.equal(f.sent.filter(x=>x.type==="kanban-shared-connect-intent").length,0);
  }finally{f.close()}
});

test("a late ACK for an explicit shared click cannot navigate after mode revocation", async () => {
  const f=fixture(),threadId=randomUUID(),calls=[];try {
    f.lifecycleAck();await f.navigation.ready();
    const waiting=f.navigation.activateExplicit({event:"trusted",hostId:"kanban-shared-cli",threadId,sourceToken:"A".repeat(43),isCurrent:()=>true,navigate:(...args)=>{calls.push(args);return true}});
    await tick();const frame=f.sent.find(x=>x.type==="kanban-shared-connect-intent");assert.ok(frame);
    f.inactive();f.intentAck(frame);assert.equal(await waiting,false);assert.equal(calls.length,0);
  }finally{f.close()}
});

test("an explicit shared-source click forwards the exact host token before navigating", async () => {
  const f=fixture();try {
    f.lifecycleAck();await f.navigation.ready();
    const threadId=randomUUID(),sourceToken="A".repeat(43),calls=[];
    const pending=f.navigation.activateExplicit({event:"trusted",hostId:"local",threadId,sourceToken,isCurrent:()=>true,navigate:(...args)=>{calls.push(args);return true}});
    await tick();
    const sent=f.sent.findLast(x=>x.type==="kanban-shared-connect-intent");
    assert.ok(sent);assert.equal(sent.threadId,threadId);assert.equal(sent.sourceToken,sourceToken);assert.equal(calls.length,0);
    f.intentAck(sent);assert.equal(await pending,true);assert.equal(calls.length,1);
  } finally {f.close()}
});
