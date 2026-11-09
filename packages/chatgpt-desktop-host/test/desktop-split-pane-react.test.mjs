import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDesktopLayoutRuntime } from "../src/desktop-layout-core.mjs";
import { createDesktopSplitPaneRuntime } from "../src/desktop-split-pane-core.mjs";

const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const React = require("react");
const jsx = require("react/jsx-runtime");
const { JSDOM } = require("jsdom");
const { act } = React;
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

test("the original Se and df created callback keeps one shared draft and activates its real thread", {
  skip: !process.env.CHATGPT_DESKTOP_CREATED_ROUTE_ORIGINAL_DIR,
}, async t => {
  const directory = process.env.CHATGPT_DESKTOP_CREATED_ROUTE_ORIGINAL_DIR;
  const read = async (name, expected) => {
    const source = await readFile(directory + "/" + name, "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), expected);
    return source;
  };
  const composer = await read("composer-content-b926d24ef280.js", "cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08");
  const initial = await read("app-initial-18b189e867e7.js", "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032");
  const shared = await read("app-shared-601019a330d7.js", "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116");
  console.log("original-created-phase:sources-read");
  function between(source, start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a >= 0 && b > a && source.lastIndexOf(start) === a);
    return source.slice(a, b);
  }
  const pathFunction = between(shared, "function r9e(e){", "function i9e(");
  assert(shared.includes("fet=`/local`"));
  const F = new Function("fet", pathFunction + ";return r9e;")("/local");
  const wl = between(initial, "function WLt(e,t,n,r){", "function GLt(");
  const rl = between(initial, "function RLt(e,{clientThreadId:t,conversationId:n,hostId:r}){", "function zLt(");
  const start = "Se=(0,dR.default)(", a = composer.indexOf(start), z = composer.indexOf("),we=(0,dR.default)", a);
  assert(a >= 0 && z > a && composer.lastIndexOf(start) === a);
  const se = composer.slice(a + start.length, z);
  const Tx = Symbol("original-client-map"), wx = Symbol("original-bindings"), p_ = Symbol(), eRt = Symbol(), Ax = Symbol(), iy = Symbol();
  const state = new Map([[wx, new Map()]]), keyed = new Map(), bindings = [], paths = [], warnings = [];
  const e = {
    get(k, id) { return id === undefined ? state.get(k) : keyed.get(k)?.get(id); },
    set(k, id, value) {
      if (arguments.length === 3) { if (!keyed.has(k)) keyed.set(k, new Map()); keyed.get(k).set(id, value); }
      else state.set(k, typeof id === "function" ? id(state.get(k)) : id);
    },
  };
  // Only storage/services are fixtures; the original WLt/RLt identity producer
  // and Se navigation callback below execute their actual pinned source.
  const noOp = () => {}, $Lt = new Set([(_scope, identity) => bindings.push(identity)]);
  const df = new Function("deps", `"use strict";const {Tx,wx,p_,eRt,Ax,$Lt}=deps;const Sx=e=>'local:'+e,uLt=()=>{},aLt=()=>{},bx=()=>{},RIt=()=>{},OLt=()=>{},P_=()=>{},kc=e=>e,pLt=()=>{},CLt=()=>{};${wl}${rl};return RLt;`)({Tx,wx,p_,eRt,Ax,$Lt});
  const f = hostFixture(t), local = { hostId: "local", conversationId: null, clientThreadId: "client-new-thread:11111111-1111-4111-8111-111111111111" };
  const pendingPath = F(local.clientThreadId), pendingContext = scope => ({
    thread: { clientThreadId: scope.clientThreadId, routeConversationId: null },
    route: { routeKind: "client-local-thread", clientThreadId: scope.clientThreadId, pathname: pendingPath, search: "" },
    composer: { kind: "local", placement: "main", clientThreadId: scope.clientThreadId, conversationId: scope.conversationId },
  });
  f.setOverride(pendingContext(local));
  await act(async () => f.root.render(f.draw(local, null, { pathname: pendingPath, search: "", marker: null })));
  console.log("original-created-phase:local-rendered");
  const first = f.runtime.registry.getSnapshot().selected;
  const oldLease = f.lease(), oldToken = oldLease.getSnapshot();
  const editor = f.dom.window.document.querySelector("[data-native-composer]");
  editor.value = "the original unsent draft";
  const selected = { ...local, hostId: "kanban-shared-cli" };
  f.setOverride(pendingContext(selected));
  await act(async () => f.root.render(f.draw(selected, null, { pathname: pendingPath, search: "", marker: null })));
  console.log("original-created-phase:shared-rendered");
  state.set(iy, { pathname: pendingPath, state: { pendingChatStart: true } });
  const onCreated = new Function("deps", `"use strict";const {e,ue,se,df,oe,My,b,o,bv,s,g_,Fv,ge,x,H,M,i,g,le,te,iy,F,p,d,Ce}=deps;return (${se});`)({
    e, ue: local.clientThreadId, se: () => true, df,
    oe: { threadCreationHostId: selected.hostId }, My: async () => {}, b: { config: {} }, o: local.clientThreadId,
    bv: noOp, s: null, g_: {}, Fv: noOp, ge: undefined, x: undefined, H: {}, M: noOp, i: false, g: null,
    le: true, te: {}, iy, F, p(path, options) { paths.push({ path, options }); }, d: () => true,
    Ce: { warning() { warnings.push(true); } },
  });
  const threadId = "22222222-2222-4222-8222-222222222222";
  await onCreated(threadId);
  console.log("original-created-phase:original-callback-resolved");
  assert.deepEqual(bindings, [{ clientThreadId: local.clientThreadId, conversationId: threadId, hostId: selected.hostId }]);
  assert.equal(warnings.length, 0);assert.equal(paths.length, 1);assert.equal(paths[0].path, F(threadId));assert.equal(paths[0].options.replace, true);
  const created = bindings[0];
  f.setOverride({
    thread: { clientThreadId: created.clientThreadId, routeConversationId: threadId },
    route: { routeKind: "local-thread", hostId: null, conversationId: threadId, pathname: paths[0].path, search: "" },
    composer: { kind: "local", placement: "main", clientThreadId: created.clientThreadId, conversationId: threadId },
  });
  await act(async () => f.root.render(f.draw(created, null, { pathname: paths[0].path, search: "", marker: null })));
  console.log("original-created-phase:created-rendered");
  const after = f.runtime.registry.getSnapshot();
  assert.equal(after.entries.length, 1);
  assert.equal(after.selected.tabKey, first.tabKey);
  assert.equal(after.selected.paneId, first.paneId);
  assert.deepEqual(after.selected.scope, created);
  assert.equal(oldLease.isCurrent(oldToken, local), false);
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), created));
  assert.equal(f.dom.window.document.querySelectorAll("[data-native-composer]").length, 1);
  assert.equal(f.dom.window.document.querySelector("[data-native-transcript]").getAttribute("data-native-transcript"), threadId);
  assert.equal(f.navigations.length, 0, "presenting the actual created result performs no extra resume or send");
  await act(async () => f.root.unmount());f.runtime.dispose();
});

function hostFixture(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.invalid/",
    pretendToBeVisual: true,
  });
  const saved = new Map();
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "Event",
    "MouseEvent",
  ]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      writable: true,
      configurable: true,
    });
  }
  const flag = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  t.after(() => {
    dom.window.close();
    for (const [key, value] of saved)
      value
        ? Object.defineProperty(globalThis, key, value)
        : delete globalThis[key];
    flag
      ? Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", flag)
      : delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const originalLayout = createDesktopLayoutRuntime({
    React,
    jsx,
    enabled: true,
  });
  const Target = React.createContext(null);
  const Navigation = React.createContext(null);
  const navigations = [];
  let nextNonce = 0;
  let override;
  function useNativeContext(scope) {
    const value = React.useMemo(
      () => ({
        thread: {
          clientThreadId: scope.clientThreadId,
          routeConversationId: scope.conversationId,
        },
        route: {
          pathname: `/local/${scope.conversationId}`,
          search: "",
          routeKind: "local-thread",
          hostId: scope.hostId,
          conversationId: scope.conversationId,
        },
        composer: {
          kind: "local",
          clientThreadId: scope.clientThreadId,
          conversationId: scope.conversationId,
        },
      }),
      [scope.hostId, scope.conversationId, scope.clientThreadId],
    );
    return override ?? value;
  }
  function renderProviders(context, children) {
    return jsx.jsx(Target.Provider, { value: context, children });
  }
  function LiveProviders({ scope, children }) {
    return renderProviders(useNativeContext(scope), children);
  }
  const observations = [];
  let passiveActions = 0,
    passiveCopyKeys = 0;
  function Passive(props) {
    const target = React.useContext(Target);
    observations.push({ ...props, captured: target.route.conversationId });
    return jsx.jsxs("div", {
      "data-native-passive": props.conversationId,
      onKeyDown: (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "c")
          passiveCopyKeys++;
      },
      children: [
        jsx.jsx("span", { children: "Visible fixture text" }),
        jsx.jsx("button", {
          "data-passive-action": "",
          onPointerDown: () => {
            passiveActions++;
          },
          onClick: () => {
            passiveActions++;
          },
          children: "Original action",
        }),
      ],
    });
  }
  const runtime = createDesktopSplitPaneRuntime({
    React,
    jsx,
    enabled: options.enabled !== false,
    layoutRuntime: originalLayout,
    useNativeContext,
    useNativeTitle: (scope) => options.titles?.[scope.conversationId] ?? null,
    useNavigationContext: () => React.useContext(Navigation),
    activateTarget: (request) => {
      navigations.push({
        ...request,
        preventedOnArrival: request.event.nativeEvent.defaultPrevented,
      });
      return true;
    },
    createNavigationNonce: () => `react-navigation-${++nextNonce}`,
    renderProviders,
    PassiveTranscript: Passive,
  });
  let composerLease,
    mounts = 0,
    unmounts = 0,
    latestGIProps;
  function Composer() {
    composerLease = originalLayout.useDesktopFooterOwnership();
    React.useLayoutEffect(() => { options.onComposerMount?.(); }, []);
    return jsx.jsx("textarea", { "data-native-composer": "" });
  }
  function GI(props) {
    const target = React.useContext(Target);
    latestGIProps = props;
    React.useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    const content = jsx.jsx("div", {
      "data-native-transcript": target?.route.conversationId ?? props.target,
    });
    const footer = props.showComposer !== false && props.isReadOnly !== true
      ? jsx.jsx(Composer, {}) : null;
    return props.renderLayout
      ? props.renderLayout({ content, footer })
      : jsx.jsxs("main", { children: [content, footer] });
  }
  function draw(scope, marker = null, location = null, overrides = {}) {
    return jsx.jsx(Navigation.Provider, {
      value: location ?? {
        pathname: `/local/${scope.conversationId}`,
        search: "",
        marker,
      },
      children: jsx.jsx(LiveProviders, {
        scope,
        children: jsx.jsx(runtime.DesktopSplitPaneBoundary, {
          component: GI,
          originalProps: { showComposer: true, target: scope.conversationId, ...overrides },
          nativeScope: scope,
        }),
      }),
    });
  }
  return {
    runtime,
    root,
    draw,
    dom,
    lease: () => composerLease,
    lifetimes: () => ({ mounts, unmounts }),
    observations,
    passiveActions: () => passiveActions,
    passiveCopyKeys: () => passiveCopyKeys,
    navigations,
    latestGIProps: () => latestGIProps,
    setOverride(value) {
      override = value;
    },
  };
}

test("split layout keeps one original GI and composer; a target switch waits for its real committed scope", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  let snapshot = f.runtime.registry.getSnapshot();
  const keyA = snapshot.selected.tabKey,
    groupA = snapshot.selected.paneId,
    tokenA = f.lease().getSnapshot();
  assert.ok(tokenA && f.lease().isCurrent(tokenA, a));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  await act(async () => f.runtime.registry.place(keyA, groupA, "right"));
  snapshot = f.runtime.registry.getSnapshot();
  const empty =
    snapshot.layout.tree.first.type === "group" &&
    !snapshot.layout.tree.first.keys.length
      ? snapshot.layout.tree.first
      : snapshot.layout.tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
    "empty group cannot inherit old input",
  );
  assert.equal(f.lease().isCurrent(tokenA, a), false);
  await act(async () => f.root.render(f.draw(b)));
  snapshot = f.runtime.registry.getSnapshot();
  assert.deepEqual(snapshot.selected.scope, b);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-desktop-split-group]").length,
    2,
  );
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-transcript]").length,
    1,
  );
  assert.equal(
    f.dom.window.document.querySelector("[data-native-passive]")?.dataset
      .nativePassive,
    a.conversationId,
  );
  assert.deepEqual(f.observations.at(-1), {
    conversationId: a.conversationId,
    hostId: a.hostId,
    isReadOnly: true,
    retainActiveInterest: false,
    trackReadState: true,
    captured: a.conversationId,
  });
  const tokenB = f.lease().getSnapshot();
  assert.ok(tokenB && f.lease().isCurrent(tokenB, b));
  const tabA = [
    ...f.dom.window.document.querySelectorAll("[data-desktop-split-tab]"),
  ].find((el) => el.dataset.desktopSplitTab === keyA);
  assert.ok(tabA);
  await act(async () => tabA.click());
  assert.equal(f.lease().isCurrent(tokenB, b), false);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  assert.equal(f.navigations.length, 1);
  assert.deepEqual(f.navigations[0].scope, a);
  await act(async () =>
    f.root.render(
      f.draw(a, f.navigations[0].state.__chatgptDesktopPaneNavigation),
    ),
  );
  assert.deepEqual(f.runtime.registry.getSnapshot().selected.scope, a);
  assert.ok(
    f.lease().getSnapshot() && f.lease().isCurrent(f.lease().getSnapshot(), a),
  );
  assert.equal(
    f.dom.window.document.querySelector("[data-native-transcript]")?.dataset
      .nativeTranscript,
    a.conversationId,
  );
  assert.equal(
    f.dom.window.document.querySelector("[data-native-passive]")?.dataset
      .nativePassive,
    b.conversationId,
  );
  assert.equal(f.latestGIProps().target, a.conversationId);
  assert.deepEqual(
    f.lifetimes(),
    { mounts: 1, unmounts: 0 },
    "the native component is not recreated by layout or target changes",
  );
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

for (const [label, overrides] of [
  ["read-only", { isReadOnly: true }],
  ["without composer", { showComposer: false }],
  ["with a native layout", { renderLayout: ({ content }) => content }],
]) {
  test(`an original GI ${label} never changes the active composer owner`, async (t) => {
    const f = hostFixture(t);
    await act(async () => f.root.render(jsx.jsxs(React.Fragment, {
      children: [f.draw(a), f.draw(b, null, null, overrides)],
    })));
    const selected = f.runtime.registry.getSnapshot().selected;
    assert.deepEqual(selected?.scope, a);
    assert.equal(f.dom.window.document.querySelectorAll("[data-native-composer]").length, 1);
    assert.ok(f.lease()?.getSnapshot());
    assert.equal(f.lease().isCurrent(f.lease().getSnapshot(), a), true);
    await act(async () => f.root.unmount());
    f.runtime.dispose();
  });
}

test("the shared composer names exactly the committed input target across pane switches", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const first = f.runtime.registry.getSnapshot().selected;
  await act(async () => f.runtime.registry.place(first.tabKey, first.paneId, "right"));
  const tree = f.runtime.registry.getSnapshot().layout.tree;
  const empty = tree.first.type === "group" && !tree.first.keys.length
    ? tree.first : tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  assert.equal(f.dom.window.document.querySelector("[data-desktop-split-input-target]"), null);
  await act(async () => f.root.render(f.draw(b)));
  let targets = f.dom.window.document.querySelectorAll("[data-desktop-split-input-target]");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].textContent, "当前输入目标：会话 2");
  assert.ok(targets[0].closest("[data-chatgpt-desktop-footer]"));
  const tab = f.dom.window.document.querySelector(`[data-desktop-split-tab="${first.tabKey}"]`);
  await act(async () => tab.click());
  assert.equal(f.dom.window.document.querySelector("[data-desktop-split-input-target]"), null);
  assert.equal(f.dom.window.document.querySelectorAll("[data-native-composer]").length, 0);
  const last = f.navigations.at(-1);
  await act(async () => f.root.render(f.draw(a, last.state.__chatgptDesktopPaneNavigation)));
  targets = f.dom.window.document.querySelectorAll("[data-desktop-split-input-target]");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].textContent, "当前输入目标：会话 1");
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("verified native titles label tabs and the single input target without changing its lease", async (t) => {
  const titles = { "thread-a": "Original Alpha", "thread-b": "Original Beta" };
  const f = hostFixture(t, { titles });
  await act(async () => f.root.render(f.draw(a)));
  const keyA = f.runtime.registry.getSnapshot().selected.tabKey;
  await act(async () => f.root.render(f.draw(b)));
  const keyB = f.runtime.registry.getSnapshot().selected.tabKey;
  assert.equal(f.dom.window.document.querySelector(`[data-desktop-split-tab="${keyA}"]`).textContent, "Original Alpha");
  assert.equal(f.dom.window.document.querySelector(`[data-desktop-split-tab="${keyB}"]`).textContent, "Original Beta");
  assert.equal(f.dom.window.document.querySelector("[data-desktop-split-input-target]").textContent, "当前输入目标：Original Beta");
  const token = f.lease().getSnapshot();
  titles["thread-b"] = "Renamed Beta";
  await act(async () => f.root.render(f.draw(b)));
  assert.equal(f.dom.window.document.querySelector("[data-desktop-split-input-target]").textContent, "当前输入目标：Renamed Beta");
  assert.equal(f.lease().getSnapshot(), token);
  assert.ok(f.lease().isCurrent(token, b));
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("passive transcript actions first activate their own target while copy stays available", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  let snapshot = f.runtime.registry.getSnapshot();
  const keyA = snapshot.selected.tabKey;
  await act(async () =>
    f.runtime.registry.place(keyA, snapshot.selected.paneId, "right"),
  );
  snapshot = f.runtime.registry.getSnapshot();
  const empty =
    snapshot.layout.tree.first.type === "group" &&
    !snapshot.layout.tree.first.keys.length
      ? snapshot.layout.tree.first
      : snapshot.layout.tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  await act(async () => f.root.render(f.draw(b)));
  const passive = f.dom.window.document.querySelector("[data-native-passive]");
  assert.equal(passive.dataset.nativePassive, a.conversationId);
  const copy = new f.dom.window.KeyboardEvent("keydown", {
    key: "c",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => passive.dispatchEvent(copy));
  assert.equal(
    copy.defaultPrevented,
    false,
    "the browser can copy selected text",
  );
  assert.equal(f.passiveCopyKeys(), 0, "background native hotkeys do not fire");
  assert.equal(f.navigations.length, 0);
  const textClick = new f.dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => passive.querySelector("span").dispatchEvent(textClick));
  assert.equal(f.navigations.length, 0, "reading text must not navigate");
  assert.equal(
    textClick.defaultPrevented,
    false,
    "text selection remains available",
  );
  const button = passive.querySelector("[data-passive-action]");
  await act(async () =>
    button.dispatchEvent(
      new f.dom.window.Event("pointerdown", { bubbles: true }),
    ),
  );
  assert.equal(
    f.passiveActions(),
    0,
    "the old route cannot handle pointer-down actions",
  );
  const selection = f.dom.window.getSelection();
  const range = f.dom.window.document.createRange();
  range.selectNodeContents(passive.querySelector("span"));
  selection.removeAllRanges();
  selection.addRange(range);
  const selectedClick = new f.dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => button.dispatchEvent(selectedClick));
  assert.equal(
    f.navigations.length,
    0,
    "a text selection does not activate the pane",
  );
  assert.equal(selectedClick.defaultPrevented, true);
  selection.removeAllRanges();
  const actionClick = new f.dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => button.dispatchEvent(actionClick));
  assert.equal(
    f.passiveActions(),
    0,
    "the old route cannot handle a background action",
  );
  assert.equal(f.navigations.length, 1);
  assert.equal(
    f.navigations[0].preventedOnArrival,
    false,
    "the trusted navigation guard sees the original click before cancellation",
  );
  assert.equal(
    actionClick.defaultPrevented,
    true,
    "the original background action remains cancelled",
  );
  assert.deepEqual(f.navigations[0].scope, a);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("disabled runtime passes original GI props without installing a second layout", async (t) => {
  const f = hostFixture(t, { enabled: false });
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-desktop-split-group]").length,
    0,
  );
  assert.equal(f.runtime.registry, null);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("a closed pane is not reopened or resumed by its late original route", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  let snapshot = f.runtime.registry.getSnapshot();
  const keyA = snapshot.selected.tabKey;
  await act(async () =>
    f.runtime.registry.place(keyA, snapshot.selected.paneId, "right"),
  );
  snapshot = f.runtime.registry.getSnapshot();
  const empty =
    snapshot.layout.tree.first.type === "group" &&
    !snapshot.layout.tree.first.keys.length
      ? snapshot.layout.tree.first
      : snapshot.layout.tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  await act(async () => f.root.render(f.draw(b)));
  await act(async () =>
    f.dom.window.document
      .querySelector(`[data-desktop-split-tab="${keyA}"]`)
      .click(),
  );
  const attempt = f.navigations[0];
  await act(async () => f.runtime.registry.close(keyA));
  assert.equal(attempt.isCurrent(), false);
  await act(async () =>
    f.root.render(f.draw(a, attempt.state.__chatgptDesktopPaneNavigation)),
  );
  snapshot = f.runtime.registry.getSnapshot();
  assert.equal(
    snapshot.entries.some((entry) => entry.key === keyA),
    false,
  );
  assert.equal(snapshot.selected, null);
  assert.equal(f.latestGIProps().shouldResume, false);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  assert.equal(f.navigations.length, 1);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("a mismatched original location and native scope never own input or resume", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const lease = f.lease();
  const token = lease.getSnapshot();
  await act(async () =>
    f.root.render(
      f.draw(a, null, { pathname: "/local/other", search: "", marker: null }),
    ),
  );
  assert.equal(lease.isCurrent(token, a), false);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(f.latestGIProps().shouldResume, false);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("a tab drag only moves a known presentation tab and the splitter supports keyboard resizing", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  let state = f.runtime.registry.getSnapshot();
  const keyA = state.selected.tabKey,
    groupA = state.selected.paneId;
  await act(async () => f.runtime.registry.place(keyA, groupA, "right"));
  state = f.runtime.registry.getSnapshot();
  const empty =
    state.layout.tree.first.type === "group" &&
    !state.layout.tree.first.keys.length
      ? state.layout.tree.first
      : state.layout.tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  await act(async () => f.root.render(f.draw(b)));
  const keyB = f.runtime.registry.getSnapshot().selected.tabKey;
  const tabA = f.dom.window.document.querySelector(
    `[data-desktop-split-tab="${keyA}"]`,
  );
  assert.equal(tabA.draggable, true);
  const target = f.dom.window.document.querySelector(
    `[data-desktop-split-group="${empty.id}"]`,
  );
  target.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
    right: 200,
    bottom: 100,
  });
  await act(async () => {
    tabA.dispatchEvent(
      new f.dom.window.Event("dragstart", { bubbles: true, cancelable: true }),
    );
    const drop = new f.dom.window.MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 190,
      clientY: 50,
    });
    target.dispatchEvent(drop);
  });
  state = f.runtime.registry.getSnapshot();
  const groups = (node) =>
    node.type === "group"
      ? [node]
      : [...groups(node.first), ...groups(node.second)];
  assert.equal(
    groups(state.layout.tree).find(
      (group) => group.id === state.layout.activeGroupId,
    ).selected,
    keyA,
  );
  assert.equal(
    state.selected,
    null,
    "dragging alone cannot grant another route's input",
  );
  assert.equal(
    f.navigations.length,
    0,
    "dragging cannot trigger native navigation",
  );
  assert.ok(state.entries.some((entry) => entry.key === keyB));
  const separator = f.dom.window.document.querySelector('[role="separator"]');
  assert.ok(separator);
  const previous = Number(separator.getAttribute("aria-valuenow"));
  await act(async () =>
    separator.dispatchEvent(
      new f.dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowRight",
      }),
    ),
  );
  assert.notEqual(Number(separator.getAttribute("aria-valuenow")), previous);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("an invalid native context hides the old target and recovers only after a fresh matching commit", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const oldLease = f.lease(),
    oldToken = oldLease.getSnapshot();
  assert.ok(oldToken && oldLease.isCurrent(oldToken, a));
  let reads = 0;
  const invalid = {
    thread: { clientThreadId: a.clientThreadId },
    route: { conversationId: a.conversationId },
    composer: {
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
    },
  };
  Object.defineProperty(invalid.route, "hostId", {
    enumerable: true,
    get() {
      reads++;
      return "local";
    },
  });
  f.setOverride(invalid);
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(reads, 0);
  assert.equal(oldLease.isCurrent(oldToken, a), false);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  Object.defineProperty(invalid.route, "pathname", {
    enumerable: true,
    get() {
      reads++;
      return `/local/${a.conversationId}`;
    },
  });
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(
    reads,
    0,
    "route validation must not execute native scope getters",
  );
  f.setOverride(undefined);
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  assert.equal(oldLease.isCurrent(oldToken, a), false);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("an original single-window composer remains usable with an uncloneable File attachment", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const before = f.lease().getSnapshot();
  const file = new Blob(["fixture attachment"]);
  f.setOverride({
    thread: {
      clientThreadId: a.clientThreadId,
      routeConversationId: a.conversationId,
    },
    route: {
      pathname: `/local/${a.conversationId}`,
      search: "",
      routeKind: "local-thread",
      hostId: a.hostId,
      conversationId: a.conversationId,
    },
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
      implicitAttachment: file,
    },
  });
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  assert.equal(f.lease().isCurrent(before, a), false);
  assert.equal(
    f.runtime.registry.getSnapshot().entries[0].context,
    undefined,
    "the File is never retained for a background pane",
  );
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("oversize or otherwise uncloneable original scope keeps the current composer live without a background snapshot", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const oldLease = f.lease(),
    oldToken = oldLease.getSnapshot();
  let reads = 0;
  const originalValue = {
    thread: {
      clientThreadId: a.clientThreadId,
      routeConversationId: a.conversationId,
    },
    route: {
      pathname: `/local/${a.conversationId}`,
      search: "",
      routeKind: "local-thread",
      hostId: a.hostId,
      conversationId: a.conversationId,
    },
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
      draft: "x".repeat(70_000),
      originalCallback() {},
    },
  };
  Object.defineProperty(originalValue.composer, "lazyAttachment", {
    enumerable: true,
    get() {
      reads++;
      return null;
    },
  });
  f.setOverride(originalValue);
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(reads, 0);
  assert.equal(oldLease.isCurrent(oldToken, a), false);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  assert.equal(f.runtime.registry.getSnapshot().entries[0].context, undefined);
  f.setOverride({
    ...originalValue,
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
      originalDate: new Date(0),
    },
  });
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  assert.equal(f.runtime.registry.getSnapshot().entries[0].context, undefined);
  f.setOverride({
    ...originalValue,
    composer: {
      kind: "local",
      clientThreadId: b.clientThreadId,
      conversationId: a.conversationId,
      originalCallback() {},
    },
  });
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(reads, 0);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("a live-only scope cannot be split again or selected from the background", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  let snapshot = f.runtime.registry.getSnapshot();
  const keyA = snapshot.selected.tabKey;
  await act(async () =>
    f.runtime.registry.place(keyA, snapshot.selected.paneId, "right"),
  );
  f.setOverride({
    thread: { clientThreadId: a.clientThreadId },
    route: {
      pathname: `/local/${a.conversationId}`,
      search: "",
      routeKind: "local-thread",
      hostId: a.hostId,
      conversationId: a.conversationId,
    },
    composer: {
      kind: "local",
      clientThreadId: a.clientThreadId,
      conversationId: a.conversationId,
      originalCallback() {},
    },
  });
  await act(async () => f.root.render(f.draw(a)));
  const split = f.dom.window.document.querySelector('[aria-label="向右拆分"]');
  assert.equal(split.disabled, true);
  snapshot = f.runtime.registry.getSnapshot();
  const empty =
    snapshot.layout.tree.first.type === "group" &&
    !snapshot.layout.tree.first.keys.length
      ? snapshot.layout.tree.first
      : snapshot.layout.tree.second;
  await act(async () => f.runtime.registry.focusGroup(empty.id));
  f.setOverride(undefined);
  await act(async () => f.root.render(f.draw(b)));
  const tabA = f.dom.window.document.querySelector(
    `[data-desktop-split-tab="${keyA}"]`,
  );
  assert.equal(tabA.getAttribute("aria-disabled"), "true");
  const lease = f.lease(),
    token = lease.getSnapshot();
  await act(async () => tabA.click());
  assert.equal(f.navigations.length, 0);
  assert.ok(lease.isCurrent(token, b));
  assert.equal(
    f.runtime.registry.getSnapshot().selected.scope.conversationId,
    b.conversationId,
  );
  assert.match(f.dom.window.document.body.textContent, /暂不能分屏/);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("an unpersisted original draft keeps its composer but does not offer an unresolvable split", async (t) => {
  const f = hostFixture(t);
  const draft = {
    hostId: "local",
    conversationId: null,
    clientThreadId: "client-new",
  };
  await act(async () => f.root.render(f.draw(draft)));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), draft));
  assert.equal(
    f.dom.window.document.querySelector('[aria-label="向右拆分"]').disabled,
    true,
  );
  assert.equal(f.navigations.length, 0);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("a committed original client route promotes its draft in place after creation", async (t) => {
  const f = hostFixture(t);
  const draft = {
    hostId: "local",
    conversationId: null,
    clientThreadId: "client-new",
  };
  const created = { ...draft, conversationId: "created-thread" };
  await act(async () => f.root.render(f.draw(draft)));
  const first = f.runtime.registry.getSnapshot().selected;
  const oldLease = f.lease(),
    oldToken = oldLease.getSnapshot();
  f.setOverride({
    thread: { clientThreadId: draft.clientThreadId, routeConversationId: null },
    route: {
      pathname: "/local/client-new",
      search: "",
      routeKind: "client-local-thread",
      clientThreadId: draft.clientThreadId,
    },
    composer: {
      kind: "local",
      clientThreadId: draft.clientThreadId,
      conversationId: created.conversationId,
    },
  });
  await act(async () =>
    f.root.render(
      f.draw(created, null, {
        pathname: "/local/client-new",
        search: "",
        marker: null,
      }),
    ),
  );
  const after = f.runtime.registry.getSnapshot();
  assert.equal(after.entries.length, 1);
  assert.equal(after.selected.tabKey, first.tabKey);
  assert.equal(after.selected.paneId, first.paneId);
  assert.deepEqual(after.selected.scope, created);
  assert.equal(oldLease.isCurrent(oldToken, draft), false);
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), created));
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  assert.equal(f.navigations.length, 0);
  f.setOverride(undefined);
  const nextDraft = {
    hostId: "local",
    conversationId: null,
    clientThreadId: "different-new-client",
  };
  await act(async () => f.root.render(f.draw(nextDraft)));
  assert.deepEqual(f.runtime.registry.getSnapshot().selected.scope, nextDraft);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    1,
  );
  await act(async () => f.root.render(f.draw(draft)));
  assert.equal(f.runtime.registry.getSnapshot().entries.length, 2);
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(
    f.dom.window.document.querySelectorAll("[data-native-composer]").length,
    0,
  );
  assert.equal(f.latestGIProps().shouldResume, false);
  await act(async () => f.root.unmount());
  f.runtime.dispose();
});

test("split, resize and explicit merge preserve the same original composer and unsent draft", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const doc = f.dom.window.document;
  const composer = doc.querySelector('[data-native-composer]');
  composer.value = '未发送草稿 remains in the original composer';
  await act(async () => doc.querySelector('[aria-label="向右拆分"]').click());
  assert.ok(doc.querySelector('[data-native-composer]') === composer, 'splitting must not remount the original composer');
  assert.equal(composer.value, '未发送草稿 remains in the original composer');
  const divider = doc.querySelector('[role="separator"]');
  await act(async () => divider.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true, cancelable:true})));
  assert.ok(doc.querySelector('[data-native-composer]') === composer);
  const groups = [...doc.querySelectorAll('[data-desktop-split-group]')];
  const source = groups.find(group => group.querySelector('[data-desktop-split-tab]'));
  const target = groups.find(group => !group.querySelector('[data-desktop-split-tab]'));
  const menu = source.querySelector('[aria-label="移动或合并窗格"]');
  assert.ok(menu);
  await act(async () => { menu.value = `merge:${target.dataset.desktopSplitGroup}`; menu.dispatchEvent(new f.dom.window.Event('change', {bubbles:true})); });
  assert.equal(doc.querySelectorAll('[data-desktop-split-group]').length, 1);
  assert.ok(doc.querySelector('[data-native-composer]') === composer);
  assert.equal(composer.value, '未发送草稿 remains in the original composer');
  assert.equal(f.navigations.length, 0);
  assert.deepEqual(f.lifetimes(), {mounts:1, unmounts:0});
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  await act(async () => f.root.unmount()); f.runtime.dispose();
});

test("explicit move, merge and tab reordering only rearrange known panes without navigating", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const keyA = f.runtime.registry.getSnapshot().selected.tabKey;
  await act(async () => f.root.render(f.draw(b)));
  const keyB = f.runtime.registry.getSnapshot().selected.tabKey;
  const doc = f.dom.window.document;
  await act(async () => doc.querySelector('[aria-label="向右拆分"]').click());
  let groups = [...doc.querySelectorAll('[data-desktop-split-group]')];
  const source = groups.find(group => group.querySelector(`[data-desktop-split-tab="${keyB}"]`));
  const target = groups.find(group => group.querySelector(`[data-desktop-split-tab="${keyA}"]`));
  const menu = source.querySelector('[aria-label="移动或合并窗格"]');
  assert.ok(menu);
  await act(async () => { menu.value = `move:${target.dataset.desktopSplitGroup}`; menu.dispatchEvent(new f.dom.window.Event('change', {bubbles:true})); });
  assert.equal(doc.querySelectorAll('[data-desktop-split-group]').length, 1);
  let tree = f.runtime.registry.getSnapshot().layout.tree;
  assert.deepEqual(tree.keys, [keyA, keyB]);
  const tabA = doc.querySelector(`[data-desktop-split-tab="${keyA}"]`), tabB = doc.querySelector(`[data-desktop-split-tab="${keyB}"]`);
  await act(async () => tabB.dispatchEvent(new f.dom.window.Event('dragstart', {bubbles:true, cancelable:true})));
  await act(async () => tabA.dispatchEvent(new f.dom.window.MouseEvent('drop', {bubbles:true, cancelable:true})));
  tree = f.runtime.registry.getSnapshot().layout.tree;
  assert.deepEqual(tree.keys, [keyB, keyA]);
  assert.equal(f.navigations.length, 0);
  assert.equal(doc.querySelectorAll('[data-native-composer]').length, 1);
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), b));
  await act(async () => f.root.unmount()); f.runtime.dispose();
});

test("initial original GI commit never mounts a second passive renderer for the same scope", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(f.observations.some(item => item.conversationId === a.conversationId), false,
    'the current native scope must not be re-provided as a passive transcript while its first owner commits');
  assert.equal(f.dom.window.document.querySelectorAll('[data-native-transcript]').length, 1);
  assert.equal(f.dom.window.document.querySelectorAll('[data-native-composer]').length, 1);
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  await act(async () => f.root.unmount()); f.runtime.dispose();
});

test("same-target native metadata settlement preserves the original composer instance", async (t) => {
  let mounts = 0;
  const f = hostFixture(t, {onComposerMount() {
    assert.equal(++mounts, 1, 'same-target metadata refresh remounted the original composer');
  }});
  await act(async () => f.root.render(f.draw(a)));
  const doc = f.dom.window.document;
  const composer = doc.querySelector('[data-native-composer]');
  composer.value = 'pending original draft';
  const oldLease = f.lease(), oldToken = oldLease.getSnapshot();
  const context = f.runtime.registry.getSnapshot().entries[0].context;
  f.setOverride({...context,thread:{...context.thread,metadataLoaded:true}});
  await act(async () => f.root.render(f.draw(a)));
  assert.equal(doc.querySelector('[data-native-composer]'), composer,
    'metadata changing inside the same verified native target must not unmount its composer');
  assert.equal(composer.value, 'pending original draft');
  assert.deepEqual(f.lifetimes(), {mounts:1,unmounts:0});
  assert.equal(oldLease.isCurrent(oldToken, a), false, 'the fresh capture must still revoke the preceding input lease');
  assert.ok(f.lease().isCurrent(f.lease().getSnapshot(), a));
  await act(async () => f.root.unmount());f.runtime.dispose();
});

test("a pending pane switch never duplicates the still-mounted current native scope", async (t) => {
  const f = hostFixture(t);
  await act(async () => f.root.render(f.draw(a)));
  const keyA = f.runtime.registry.getSnapshot().selected.tabKey;
  await act(async () => f.root.render(f.draw(b)));
  const before = f.observations.filter(item => item.conversationId === b.conversationId).length;
  const tabA = f.dom.window.document.querySelector(`[data-desktop-split-tab="${keyA}"]`);
  await act(async () => tabA.click());
  assert.equal(f.runtime.registry.getSnapshot().selected, null);
  assert.equal(f.observations.filter(item => item.conversationId === b.conversationId).length, before,
    'old GI stays mounted while navigating; never mount a second provider tree for its same identity');
  assert.equal(f.dom.window.document.querySelectorAll('[data-native-composer]').length, 0);
  assert.equal(f.navigations.length, 1);
  await act(async () => f.root.unmount()); f.runtime.dispose();
});


function pointerEvent(win,type,values={}) {
 const event=new win.Event(type,{bubbles:true,cancelable:true});
 for(const [key,value]of Object.entries({button:0,pointerId:7,clientX:0,clientY:0,...values}))Object.defineProperty(event,key,{value});
 return event;
}

test("nested pointer resizing affects one axis and lost pointer capture ends the resize",async(t)=>{
 const f=hostFixture(t);await act(async()=>f.root.render(f.draw(a)));const doc=f.dom.window.document;
 const initialComposer=doc.querySelector('[data-native-composer]');initialComposer.value="nested unsent draft";
 await act(async()=>doc.querySelector('[aria-label="向右拆分"]').click());
 await act(async()=>doc.querySelector('[data-desktop-split-active] [aria-label="向下拆分"]').click());
 const root=f.runtime.registry.getSnapshot().layout.tree;assert.equal(root.direction,"horizontal");assert.equal(root.second.direction,"vertical");
 const divider=doc.querySelector('[role="separator"][aria-orientation="horizontal"]');assert.ok(divider);
 divider.parentElement.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
 const captures=[],releases=[];divider.setPointerCapture=id=>captures.push(id);divider.releasePointerCapture=id=>releases.push(id);
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"pointerdown")));
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"pointermove",{clientY:180})));
 let tree=f.runtime.registry.getSnapshot().layout.tree;assert.equal(tree.ratio,50);assert.equal(tree.second.ratio,30);
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"lostpointercapture")));
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"pointermove",{clientY:510})));
 tree=f.runtime.registry.getSnapshot().layout.tree;assert.equal(tree.second.ratio,30,"lost capture cannot keep a stale drag alive");
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"pointerdown",{pointerId:8})));
 await act(async()=>divider.dispatchEvent(pointerEvent(f.dom.window,"pointerup",{pointerId:8,clientY:240})));
 assert.deepEqual(captures,[7,8]);assert.deepEqual(releases,[8]);assert.equal(f.runtime.registry.getSnapshot().layout.tree.second.ratio,40);
 assert.equal(doc.querySelectorAll('[data-native-composer]').length,1);assert.equal(doc.querySelector('[data-native-composer]'),initialComposer);assert.equal(initialComposer.value,"nested unsent draft");assert.ok(f.lease().isCurrent(f.lease().getSnapshot(),a));assert.equal(f.navigations.length,0);
 await act(async()=>f.root.unmount());f.runtime.dispose();
});

for(const closeCurrent of [false,true]) test(`closing an entire multi-tab pane is local and preserves exact composer ownership (${closeCurrent?"active":"background"})`,async(t)=>{
 const f=hostFixture(t),c={hostId:"local",conversationId:"thread-c",clientThreadId:"client-c"};
 await act(async()=>f.root.render(f.draw(a)));const keyA=f.runtime.registry.getSnapshot().selected.tabKey;
 await act(async()=>f.root.render(f.draw(b)));const keyB=f.runtime.registry.getSnapshot().selected.tabKey;
 const doc=f.dom.window.document;await act(async()=>doc.querySelector('[aria-label="向右拆分"]').click());
 const closing=f.runtime.registry.getSnapshot().selected.paneId;
 await act(async()=>f.root.render(f.draw(c)));const keyC=f.runtime.registry.getSnapshot().selected.tabKey;
 if(!closeCurrent)await act(async()=>f.root.render(f.draw(a)));
 const composer=doc.querySelector('[data-native-composer]');composer.value="original unsent draft";const oldToken=f.lease().getSnapshot();
 const pane=doc.querySelector(`[data-desktop-split-group="${closing}"]`),close=pane.querySelector('[aria-label="关闭窗格"]');assert.ok(close);
 await act(async()=>close.click());
 const state=f.runtime.registry.getSnapshot();assert.equal(doc.querySelectorAll('[data-desktop-split-group]').length,1);assert.deepEqual(state.entries.map(x=>x.key),[keyA]);
 assert.equal(state.entries.some(x=>x.key===keyB||x.key===keyC),false);assert.equal(f.lease().isCurrent(oldToken,closeCurrent?c:a),false);assert.equal(f.navigations.length,0);
 if(closeCurrent){assert.equal(doc.querySelectorAll('[data-native-composer]').length,0);assert.equal(state.selected,null);}
 else {assert.equal(doc.querySelector('[data-native-composer]'),composer);assert.equal(composer.value,"original unsent draft");assert.ok(f.lease().isCurrent(f.lease().getSnapshot(),a));}
 await act(async()=>f.root.unmount());f.runtime.dispose();
});
