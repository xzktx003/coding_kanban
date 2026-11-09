import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDesktopFooterOwnership } from "../src/desktop-layout-core.mjs";
import { createDesktopSelectedPaneRegistry } from "../src/desktop-selected-pane-core.mjs";
import { createDesktopSplitPaneRegistry } from "../src/desktop-split-pane-core.mjs";
import { createBrowserComposerCapability } from "../src/browser-composer-capability.mjs";
import { createDesktopHomeRegistrar } from "../src/desktop-home-registrar.mjs";
const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const React = require("react"),
  { JSDOM } = require("jsdom");
const identity = {
  profileId: "11111111-1111-4111-8111-111111111111",
  generation: "22222222-2222-4222-8222-222222222222",
  viewId: "33333333-3333-4333-8333-333333333333",
};
const draft = {
  hostId: "local",
  conversationId: null,
  clientThreadId: "pending-a",
  isMain: true,
};

for (const [name, createRegistry] of [
  ["single", createDesktopSelectedPaneRegistry],
  ["split", createDesktopSplitPaneRegistry],
]) {
  test(`a committed home composer shares the ${name} pane registry and retains unchanged scope`, async () => {
    const dom = new JSDOM(
      '<!doctype html><body><div id="root"></div><div id="a"></div><div id="b"></div></body>',
      { url: "http://localhost/" },
    );
    const oldWindow = globalThis.window,
      oldDocument = globalThis.document,
      oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = require("react-dom/client");
    const footerOwnership = createDesktopFooterOwnership();
    let next = 0;
    const registry = createRegistry({
      footerOwnership,
      idFactory: () => `pane-${++next}`,
    });
    const Controller = React.createContext(null);
    const controllers = ["a", "b"].map((id) => ({
      isInputActive: true,
      view: {
        dom: dom.window.document.getElementById(id),
        isDestroyed: false,
        editable: true,
      },
    }));
    let modeToken = Object.freeze({});
    const subscribers = new Set();
    const mode = {
      getSnapshot: () => modeToken,
      isCurrent: (t) => t === modeToken && t !== null,
      subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
      hide() {
        modeToken = null;
        for (const fn of [...subscribers]) fn();
      },
      show() {
        modeToken = Object.freeze({});
        for (const fn of [...subscribers]) fn();
      },
    };
    const capability = createBrowserComposerCapability({
      window: dom.window,
      React,
      useComposerController: () => React.useContext(Controller),
      modeActivation: mode,
      documentScope: identity,
    });
    const Home = createDesktopHomeRegistrar({
      React,
      registry,
      footerOwnership,
      Registrar: capability.Registrar,
      enabled: true,
    });
    const root = createRoot(dom.window.document.getElementById("root"));
    const tree = (scope, controller = controllers[0]) =>
      React.createElement(
        Controller.Provider,
        { value: controller },
        React.createElement(Home, { scope }),
      );
    try {
      await React.act(async () => root.render(tree(draft)));
      const first = capability.captureScope();
      assert.ok(first);
      const homeKey = registry.getSnapshot()?.selected?.tabKey;
      assert.equal(capability.getCommittedEditor()?.controller, controllers[0]);
      await React.act(async () => root.render(tree({ ...draft })));
      assert.equal(
        capability.isScopeCurrent(first),
        true,
        "ordinary same-target rerender must not invalidate",
      );
      await React.act(async () =>
        root.render(tree({ ...draft }, controllers[1])),
      );
      assert.equal(
        capability.isScopeCurrent(first),
        false,
        "a different original controller is a new commit",
      );
      assert.equal(capability.getCommittedEditor()?.controller, controllers[1]);
      await React.act(async () =>
        root.render(tree({ ...draft }, controllers[0])),
      );
      const beforeCompeting = capability.captureScope();
      assert.ok(beforeCompeting);
      let offOther;
      await React.act(async () => {
        offOther = registry.attach(
          {},
          { hostId: "local", conversationId: "other", clientThreadId: "other" },
        );
        assert.equal(capability.isScopeCurrent(beforeCompeting), false);
        assert.equal(capability.captureScope(), null);
      });
      await React.act(async () => offOther());
      if (name === "split") {
        assert.equal(
          capability.captureScope(),
          null,
          "removing another owner does not change the selected tab",
        );
        await React.act(async () => registry.focus(homeKey));
      }
      const restored = capability.captureScope();
      assert.ok(restored);
      assert.notEqual(restored, first);
      if (name === "split") {
        const selected = registry.getSnapshot().selected;
        await React.act(async () =>
          registry.commit(selected.owner, selected.tabKey, selected.scope),
        );
        assert.equal(
          capability.isScopeCurrent(restored),
          false,
          "a fresh original scope confirmation revokes the old token",
        );
        assert.ok(
          capability.captureScope(),
          "same-identity selection epoch re-grants the actual home editor",
        );
        let releaseConversation;
        await React.act(async () => {
          releaseConversation = registry.attach(
            {},
            {
              hostId: "local",
              conversationId: "created-conversation-a",
              clientThreadId: draft.clientThreadId,
            },
          );
        });
        assert.equal(
          registry.getSnapshot().selected.tabKey,
          homeKey,
          "native creation retains the draft's pane",
        );
        assert.equal(
          capability.captureScope(),
          null,
          "the finalized native scope retires the old draft owner",
        );
        await React.act(async () => releaseConversation());
      }
      await React.act(async () =>
        root.render(
          tree({ ...draft, clientThreadId: "pending-b" }, controllers[1]),
        ),
      );
      assert.equal(capability.isScopeCurrent(restored), false);
      const second = capability.captureScope();
      assert.ok(
        second,
        "the same home component can own a new draft after its previous native conversation was finalized",
      );
      assert.equal(capability.getCommittedEditor()?.controller, controllers[1]);
      await React.act(async () =>
        root.render(tree({ ...draft, clientThreadId: "" }, controllers[1])),
      );
      assert.equal(capability.isScopeCurrent(second), false);
      assert.equal(capability.captureScope(), null);
      await React.act(async () =>
        root.render(
          tree({ ...draft, conversationId: undefined }, controllers[1]),
        ),
      );
      assert.equal(
        capability.captureScope(),
        null,
        "missing conversation is not a pending identity",
      );
      await React.act(async () =>
        root.render(
          tree({ ...draft, clientThreadId: "pending-b" }, controllers[1]),
        ),
      );
      const third = capability.captureScope();
      assert.ok(third);
      await React.act(async () => {
        mode.hide();
        assert.equal(capability.isScopeCurrent(third), false);
        assert.equal(capability.captureScope(), null);
      });
      await React.act(async () => mode.show());
      assert.ok(capability.captureScope());
      await React.act(async () => root.unmount());
      assert.equal(capability.captureScope(), null);
    } finally {
      await React.act(async () => root.unmount());
      capability.dispose();
      registry.dispose();
      dom.window.close();
      globalThis.window = oldWindow;
      globalThis.document = oldDocument;
      globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    }
  });
}
