import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBrowserIsolatedPaneNavigation } from "../src/browser-isolated-pane-navigation.mjs";

function fixture() {
  const document = {};
  class Element {
    constructor() {
      this.isConnected = true;
      this.ownerDocument = document;
    }
  }
  const root = new Element(),
    target = new Element();
  class Event {
    constructor(type, values = {}) {
      Object.assign(
        this,
        {
          type,
          target,
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
    }
    composedPath() {
      return [this.target, root];
    }
  }
  class MouseEvent extends Event {
    constructor(values = {}) {
      super("click", { button: 0, ...values });
    }
  }
  class KeyboardEvent extends Event {
    constructor(values = {}) {
      super("keydown", {
        key: "Enter",
        repeat: false,
        isComposing: false,
        ...values,
      });
    }
  }
  const token = {},
    window = { document, Element, Event, MouseEvent, KeyboardEvent },
    scopeLease = {
      getSnapshot: () => token,
      isCurrent: (value) => value === token,
    };
  const documentScope = {
    profileId: randomUUID(),
    generation: randomUUID(),
    viewId: randomUUID(),
  };
  const navigation = createBrowserIsolatedPaneNavigation({
    window,
    scopeLease,
    documentScope,
  });
  return { navigation, MouseEvent, KeyboardEvent, scopeLease, token };
}
test("a trusted isolated pane action navigates the exact selected thread in the same event stack", async () => {
  const f = fixture(),
    event = new f.MouseEvent({ eventPhase: 1 }),
    threadId = randomUUID(),
    nonce = randomUUID(),
    calls = [];
  const result = f.navigation.activateExplicit({
    event,
    hostId: "local",
    threadId,
    state: { __chatgptDesktopPaneNavigation: nonce },
    isCurrent: () => true,
    navigate: (...args) => {
      calls.push(args);
      return true;
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    threadId,
    "local",
    { state: { __chatgptDesktopPaneNavigation: nonce } },
  ]);
  assert.equal(await result, true);
  assert.equal(
    await f.navigation.activateExplicit({
      event,
      hostId: "local",
      threadId,
      isCurrent: () => true,
      navigate: () => true,
    }),
    false,
  );
  f.navigation.dispose();
});
test("untrusted, changed selection, stale view and invalid keyboard actions do not navigate", async () => {
  const f = fixture(),
    threadId = randomUUID();
  let calls = 0;
  for (const event of [
    new f.MouseEvent({ isTrusted: false }),
    new f.MouseEvent({ metaKey: true }),
    new f.KeyboardEvent({ key: "Escape" }),
    new f.KeyboardEvent({ repeat: true }),
  ])
    assert.equal(
      await f.navigation.activateExplicit({
        event,
        hostId: "local",
        threadId,
        isCurrent: () => true,
        navigate: () => {
          calls++;
          return true;
        },
      }),
      false,
    );
  assert.equal(
    await f.navigation.activateExplicit({
      event: new f.MouseEvent(),
      hostId: "local",
      threadId,
      isCurrent: () => false,
      navigate: () => {
        calls++;
        return true;
      },
    }),
    false,
  );
  f.navigation.dispose();
  assert.equal(
    await f.navigation.activateExplicit({
      event: new f.MouseEvent(),
      hostId: "local",
      threadId,
      isCurrent: () => true,
      navigate: () => {
        calls++;
        return true;
      },
    }),
    false,
  );
  assert.equal(calls, 0);
});

test("keyboard activation is accepted after the pane prevents the browser default", async () => {
  const f = fixture(), calls = [], threadId = randomUUID();
  for (const key of ["Enter", " "]) {
    const result = f.navigation.activateExplicit({event:new f.KeyboardEvent({key,defaultPrevented:true,eventPhase:1}),hostId:"local",threadId,
      isCurrent:()=>true,navigate:(...args)=>{calls.push(args);return true}});
    assert.equal(await result,true);
  }
  assert.equal(calls.length,2);
  assert.equal(await f.navigation.activateExplicit({event:new f.MouseEvent({defaultPrevented:true}),hostId:"local",threadId,
    isCurrent:()=>true,navigate:()=>{calls.push("late");return true}}),false);
  f.navigation.dispose();
});
