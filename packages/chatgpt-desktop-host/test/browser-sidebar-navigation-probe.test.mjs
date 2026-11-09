import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  SIDEBAR_ATTEMPT_STATE_KEY,
  createBrowserSidebarNavigationProbe,
} from "../src/browser-sidebar-navigation-probe.mjs";

function fixture() {
  const doc = {};
  class Element {
    constructor(tagName, attrs = {}) {
      this.tagName = tagName.toUpperCase();
      this.attrs = attrs;
      this.isConnected = true;
      this.ownerDocument = doc;
      this.isContentEditable = false;
    }
    hasAttribute(name) {
      return Object.hasOwn(this.attrs, name);
    }
    getAttribute(name) {
      return this.attrs[name] ?? null;
    }
  }
  class Event {
    constructor(type, path, values = {}) {
      Object.assign(
        this,
        {
          type,
          target: path[0],
          currentTarget: root,
          eventPhase: 3,
          isTrusted: true,
          defaultPrevented: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        },
        values,
      );
      this.path = path;
    }
    composedPath() {
      return [...this.path];
    }
  }
  class MouseEvent extends Event {
    constructor(type, path, values = {}) {
      super(type, path, { button: 0, ...values });
    }
  }
  class KeyboardEvent extends Event {
    constructor(type, path, values = {}) {
      super(type, path, {
        key: "Enter",
        repeat: false,
        isComposing: false,
        ...values,
      });
    }
  }
  const root = new Element("div"),
    row = new Element("div", {
      "data-app-action-sidebar-thread-row": "",
      "data-app-action-sidebar-thread-kind": "local",
    });
  const label = new Element("span"),
    nested = new Element("button");
  const win = {
    document: doc,
    Element,
    Event,
    MouseEvent,
    KeyboardEvent,
    crypto: { randomUUID },
    performance,
    setTimeout,
    clearTimeout,
  };
  const docScope = {
    profileId: randomUUID(),
    generation: randomUUID(),
    viewId: randomUUID(),
  };
  const events = [],
    calls = [],
    subscribers = new Set(),
    token = {};
  let current = true;
  const scopeLease = {
    getSnapshot: () => token,
    isCurrent: (t) => current && t === token,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  const notify = () => {
    for (const fn of subscribers) fn();
  };
  const probe = createBrowserSidebarNavigationProbe({
    window: win,
    documentScope: docScope,
    scopeLease,
    onAttempt: (event) => events.push(event),
  });
  const navigate = probe.wrapNavigation((...args) => {
    calls.push(args);
    return true;
  });
  function dispatch(event, handler) {
    const listener = probe.wrapDelegatedListener(root, handler);
    return listener.call(root, event);
  }
  return {
    win,
    docScope,
    events,
    calls,
    probe,
    root,
    row,
    label,
    nested,
    navigate,
    dispatch,
    Event,
    MouseEvent,
    KeyboardEvent,
    click(values = {}) {
      return new MouseEvent("click", [label, row, root], values);
    },
    key(values = {}) {
      return new KeyboardEvent("keydown", [row, root], values);
    },
    changeScope() {
      current = false;
      notify();
    },
    restoreScope() {
      current = true;
    },
    notify,
  };
}

test("the original provider host/thread and view are carried once through accepted navigation", async () => {
  const f = fixture(),
    threadId = randomUUID(),
    options = { state: { original: "kept" }, replace: false };
  f.dispatch(f.click(), () =>
    f.navigate(threadId, "real-provider-host", options),
  );
  assert.deepEqual(options, { state: { original: "kept" }, replace: false });
  assert.equal(f.events.length, 1);
  const state = f.calls[0][2].state,
    id = state[SIDEBAR_ATTEMPT_STATE_KEY];
  assert.equal(state.original, "kept");
  assert.equal(f.events[0].threadId, threadId);
  assert.equal(f.events[0].hostId, "real-provider-host");
  assert.equal(f.events[0].viewId, f.docScope.viewId);
  assert.equal(f.events[0].attemptId, id);
  assert.equal(
    (
      await f.probe.consumeAttempt({
        state,
        hostId: "real-provider-host",
        threadId,
      })
    ).attemptId,
    id,
  );
  assert.equal(
    await f.probe.consumeAttempt({
      state,
      hostId: "real-provider-host",
      threadId,
    }),
    null,
  );
  f.probe.dispose();
});

test("an omitted original host is resolved only by the matching committed native route", async () => {
  for (const args of ["omitted", "null"]) {
    const f = fixture(),
      threadId = randomUUID();
    f.row.attrs["data-app-action-sidebar-thread-host-id"] = "forged-dom-host";
    f.dispatch(f.click(), () => {
      if (args === "omitted") f.navigate(threadId);
      else f.navigate(threadId, null, { state: { original: "kept" } });
    });
    const forwarded = f.calls[0];
    assert.equal(forwarded[0], threadId);
    assert.equal(forwarded[1], args === "omitted" ? undefined : null);
    const state = forwarded[2]?.state;
    assert.ok(state?.[SIDEBAR_ATTEMPT_STATE_KEY]);
    if (args === "null") assert.equal(state.original, "kept");
    assert.equal(f.events.length, 0, "navigation alone must not invent a host");
    assert.equal(
      await f.probe.consumeAttempt({ state, hostId: undefined, threadId }),
      null,
    );
    assert.equal(
      await f.probe.consumeAttempt({ state, hostId: "local", threadId: randomUUID() }),
      null,
    );
    assert.equal(f.events.length, 0);
    const candidate = await f.probe.consumeAttempt({
      state,
      hostId: "original-route-remote-host",
      threadId,
    });
    assert.ok(candidate);
    assert.equal(candidate.hostId, "original-route-remote-host");
    assert.equal(candidate.threadId, threadId);
    assert.equal(f.events.length, 1);
    assert.strictEqual(f.events[0], candidate);
    assert.equal(
      await f.probe.consumeAttempt({ state, hostId: "local", threadId }),
      null,
    );
    assert.equal(f.events.length, 1);
    f.probe.dispose();
  }
});

test("omitted-host navigation cannot gain authority after scope revocation", async () => {
  const f = fixture(), threadId = randomUUID();
  f.dispatch(f.click(), () => f.navigate(threadId));
  const state = f.calls[0][2]?.state;
  assert.ok(state?.[SIDEBAR_ATTEMPT_STATE_KEY]);
  f.changeScope();
  assert.equal(await f.probe.consumeAttempt({ state, hostId: "local", threadId }), null);
  f.restoreScope();
  assert.equal(await f.probe.consumeAttempt({ state, hostId: "local", threadId }), null);
  assert.equal(f.events.length, 0);
  f.probe.dispose();
});

test("an explicit pane gesture reserves one exact route without navigating before commit", async () => {
  const f = fixture(),
    threadId = randomUUID(),
    nonce = randomUUID(),
    event = f.click();
  const action = f.probe.prepareExplicit({
    event,
    threadId,
    hostId: "local",
    state: { __chatgptDesktopPaneNavigation: nonce },
  });
  assert.ok(action);
  assert.equal(f.events.length, 1);
  assert.equal(action.candidate.threadId, threadId);
  assert.equal(action.state.__chatgptDesktopPaneNavigation, nonce);
  assert.equal(
    action.state[SIDEBAR_ATTEMPT_STATE_KEY],
    action.candidate.attemptId,
  );
  let settled = false;
  const consume = f.probe
    .consumeAttempt({ state: action.state, threadId, hostId: "local" })
    .then((value) => {
      settled = true;
      return value;
    });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(action.commit(), true);
  assert.equal((await consume).attemptId, action.candidate.attemptId);
  assert.equal(action.commit(), false);
  assert.equal(
    f.probe.prepareExplicit({ event, threadId, hostId: "local" }),
    null,
  );
  f.probe.dispose();
});

test("untrusted, modified or retired pane actions cannot reserve a connection", () => {
  const f = fixture(),
    threadId = randomUUID();
  for (const event of [
    f.click({ isTrusted: false }),
    f.click({ metaKey: true }),
    f.key({ repeat: true }),
    f.key({ key: "Escape" }),
  ])
    assert.equal(
      f.probe.prepareExplicit({ event, threadId, hostId: "local" }),
      null,
    );
  assert.equal(
    f.probe.prepareExplicit({
      event: f.click(),
      threadId,
      hostId: "local",
      state: { [SIDEBAR_ATTEMPT_STATE_KEY]: randomUUID() },
    }),
    null,
  );
  f.changeScope();
  assert.equal(
    f.probe.prepareExplicit({ event: f.click(), threadId, hostId: "local" }),
    null,
  );
  assert.equal(f.events.length, 0);
  f.probe.dispose();
});

test("explicit pane keyboard action accepts preventDefault while a prevented click is rejected",async()=>{
  const f=fixture(),threadId=randomUUID();
  const action=f.probe.prepareExplicit({event:f.key({key:" ",defaultPrevented:true,eventPhase:1}),threadId,hostId:"local"});
  assert.ok(action);assert.equal(action.commit(),true);
  assert.ok(await f.probe.consumeAttempt({state:action.state,threadId,hostId:"local"}));
  assert.equal(f.probe.prepareExplicit({event:f.click({defaultPrevented:true}),threadId,hostId:"local"}),null);f.probe.dispose();
});

test("keyboard requires the row itself; DOM attributes never provide thread identity", async () => {
  const f = fixture(),
    threadId = randomUUID();
  f.row.attrs["data-app-action-sidebar-thread-id"] = randomUUID();
  f.row.attrs["data-app-action-sidebar-thread-host-id"] = "forged";
  f.dispatch(f.key({ key: " " }), () =>
    f.navigate(threadId, "real-provider-host"),
  );
  assert.equal(f.events[0].threadId, threadId);
  assert.equal(f.events[0].hostId, "real-provider-host");
  assert.ok(
    await f.probe.consumeAttempt({
      state: f.calls[0][2].state,
      hostId: "real-provider-host",
      threadId,
    }),
  );
  f.probe.dispose();
});

test("untrusted, nested, modified, foreign-root and delayed input fail closed", async () => {
  const f = fixture(),
    threadId = randomUUID();
  const rejected = [
    f.click({ isTrusted: false }),
    new f.MouseEvent("click", [f.nested, f.row, f.root]),
    f.click({ ctrlKey: true }),
    new f.KeyboardEvent("keydown", [f.label, f.row, f.root]),
    f.key({ repeat: true }),
    f.key({ key: "Escape" }),
    f.click({ currentTarget: f.row }),
  ];
  for (const event of rejected)
    f.dispatch(event, () => f.navigate(threadId, "local"));
  f.dispatch(f.click(), () =>
    queueMicrotask(() => f.navigate(threadId, "local")),
  );
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(f.events.length, 0);
  assert.ok(f.calls.every((args) => args[2] === undefined));
  f.probe.dispose();
});

test("an event issues at most one attempt, and only its exact view, host and thread can consume it", async () => {
  const a = fixture(),
    b = fixture(),
    threadId = randomUUID(),
    event = a.click();
  a.dispatch(event, () => {
    a.navigate(threadId, "local");
    a.navigate(randomUUID(), "local");
  });
  a.dispatch(event, () => a.navigate(threadId, "local"));
  assert.equal(a.events.length, 1);
  const state = a.calls[0][2].state;
  assert.equal(
    await b.probe.consumeAttempt({ state, hostId: "local", threadId }),
    null,
  );
  assert.equal(
    await a.probe.consumeAttempt({ state, hostId: "other", threadId }),
    null,
  );
  assert.equal(
    await a.probe.consumeAttempt({
      state,
      hostId: "local",
      threadId: randomUUID(),
    }),
    null,
  );
  assert.ok(await a.probe.consumeAttempt({ state, hostId: "local", threadId }));
  a.probe.dispose();
  b.probe.dispose();
});

test("pending navigation settles safely and same-value scope notifications revoke permanently", async () => {
  const f = fixture(),
    threadId = randomUUID();
  let pending;
  const accepted = f.probe.wrapNavigation((_id, _host, options) => {
    pending = f.probe.consumeAttempt({
      state: options.state,
      hostId: "local",
      threadId,
    });
    return true;
  });
  f.dispatch(f.click(), () => accepted(threadId, "local"));
  assert.ok(await pending);
  const blocked = f.probe.wrapNavigation(() => false);
  f.dispatch(f.click(), () => assert.equal(blocked(threadId, "local"), false));
  f.dispatch(f.click(), () => f.navigate(threadId, "local"));
  const state = f.calls[0][2].state;
  f.notify();
  assert.equal(
    await f.probe.consumeAttempt({ state, hostId: "local", threadId }),
    null,
  );
  f.dispatch(f.click(), () => f.navigate(threadId, "local"));
  assert.equal(f.events.length, 2);
  f.probe.dispose();
});

test("an invalid scope cannot revive a prior attempt when its value becomes valid again", async () => {
  const f = fixture(),
    threadId = randomUUID();
  f.dispatch(f.click(), () => f.navigate(threadId, "local"));
  const state = f.calls[0][2].state;
  f.changeScope();
  assert.equal(
    await f.probe.consumeAttempt({ state, hostId: "local", threadId }),
    null,
  );
  f.restoreScope();
  assert.equal(
    await f.probe.consumeAttempt({ state, hostId: "local", threadId }),
    null,
  );
  f.probe.dispose();
});

test("a cancelled or disposed navigation releases its waiting consumer without an attempt", async () => {
  for (const cancel of ["return-false", "dispose"]) {
    const f = fixture(),
      threadId = randomUUID();
    let pending;
    const navigate = f.probe.wrapNavigation((_id, _host, options) => {
      pending = f.probe.consumeAttempt({
        state: options.state,
        hostId: "local",
        threadId,
      });
      if (cancel === "dispose") f.probe.dispose();
      return cancel !== "return-false";
    });
    f.dispatch(f.click(), () => navigate(threadId, "local"));
    assert.equal(await pending, null);
    assert.equal(f.events.length, 0);
    f.probe.dispose();
  }
});

test("the fixed pending-attempt budget never widens and ordinary navigation still runs", () => {
  const f = fixture();
  for (let index = 0; index < 17; index++)
    f.dispatch(f.click(), () => f.navigate(randomUUID(), "local"));
  assert.equal(f.events.length, 16);
  assert.equal(f.calls.length, 17);
  assert.equal(f.calls[16][2], undefined);
  f.probe.dispose();
});


test("the explicit trusted gesture retains an exact host source token",()=>{
  const f=fixture(),threadId=randomUUID(),sourceToken="A".repeat(43);
  try {
    const action=f.probe.prepareExplicit({event:f.click(),hostId:"local",threadId,sourceToken});
    assert.ok(action);assert.equal(action.candidate.sourceToken,sourceToken);
    action.cancel();
    assert.equal(f.probe.prepareExplicit({event:f.click(),hostId:"local",threadId,sourceToken:"fake"}),null);
  } finally {f.probe.dispose()}
});
