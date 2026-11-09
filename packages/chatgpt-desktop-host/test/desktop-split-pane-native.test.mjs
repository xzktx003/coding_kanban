import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDesktopLayoutRuntime } from "../src/desktop-layout-core.mjs";
import { createDesktopSplitPaneRuntime } from "../src/desktop-split-pane-core.mjs";

// Original React and scope providers; mocked GI/XI and no native transport.
// This is not a real original GI/XI or native-session acceptance.
const moduleDir = process.env.CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR;
const hashes = {
  "rolldown-runtime-428824ca0286.js":
    "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
  "app-shared-601019a330d7.js":
    "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
  "app-initial-18b189e867e7.js":
    "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032",
};
async function run() {
  assert.ok(moduleDir);
  for (const [member, expected] of Object.entries(hashes))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(moduleDir, member)))
        .digest("hex"),
      expected,
    );
  const require = createRequire(
    new URL("../../../apps/web/package.json", import.meta.url),
  );
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://fixture.invalid/",
    pretendToBeVisual: true,
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "location",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "DOMException",
    "localStorage",
    "sessionStorage",
    "CustomEvent",
    "Event",
    "MouseEvent",
    "MessageChannel",
  ]) {
    if (dom.window[name] !== undefined)
      Object.defineProperty(globalThis, name, {
        value: dom.window[name],
        writable: true,
        configurable: true,
      });
  }
  const attempts = [];
  globalThis.fetch = dom.window.fetch = async () => {
    attempts.push("fetch");
    throw Error("network disabled");
  };
  globalThis.WebSocket = dom.window.WebSocket = class {
    constructor() {
      attempts.push("WebSocket");
      throw Error("network disabled");
    }
  };
  const shared = await import(
    pathToFileURL(join(moduleDir, "app-shared-601019a330d7.js"))
  );
  const initial = await import(
    pathToFileURL(join(moduleDir, "app-initial-18b189e867e7.js"))
  );
  shared.Alt();
  shared.iTt();
  initial.t7n();
  initial.b5n();
  initial.I6n();
  initial.Gcr({}, () => {});
  const React = shared.pWt(),
    jsx = shared.JFt(),
    domClient = shared.GFt(),
    domApi = shared.KFt(),
    Scope = shared.fTt,
    read = shared.oTt;
  const originalLayout = createDesktopLayoutRuntime({
    React,
    jsx,
    enabled: true,
  });
  let scopeReads = 0;
  function useNativeContext(scope) {
    const value = {
      thread: read(initial.B5n).value,
      route: read(initial.p5n).value,
      composer: read(initial.w6n).value,
    };
    if (++scopeReads > 100) throw Error("native scope render loop");
    return value;
  }
  function renderProviders(context, children) {
    return jsx.jsx(Scope, {
      scope: initial.B5n,
      value: context.thread,
      children: jsx.jsx(Scope, {
        scope: initial.p5n,
        value: context.route,
        children: jsx.jsx(Scope, {
          scope: initial.w6n,
          value: context.composer,
          children,
        }),
      }),
    });
  }
  const passive = [];
  const navigations = [];
  let nextNonce = 0;
  function useNavigationContext() {
    const location = shared.Jwt();
    return {
      pathname: location.pathname,
      search: location.search,
      marker: location.state?.__chatgptDesktopPaneNavigation ?? null,
    };
  }
  function activateTarget(request) {
    navigations.push(request);
    return true;
  }
  function MockXI(props) {
    const current = useNativeContext();
    const location = shared.Jwt();
    const params = shared.$wt();
    passive.push({
      thread: current.thread.clientThreadId,
      route: current.route.conversationId,
      composer: current.composer.conversationId,
      pathname: location.pathname,
      routerConversationId: params.conversationId,
      ...props,
    });
    return jsx.jsx("div", { "data-passive": current.route.conversationId });
  }
  const runtime = createDesktopSplitPaneRuntime({
    React,
    jsx,
    enabled: true,
    useNativeContext,
    renderProviders,
    useNavigationContext,
    activateTarget,
    createNavigationNonce: () => `test-navigation-${++nextNonce}`,
    PassiveTranscript: MockXI,
    layoutRuntime: originalLayout,
  });
  let currentLease, latest;
  function Composer() {
    currentLease = originalLayout.useDesktopFooterOwnership();
    return jsx.jsx("textarea", { "data-composer": "" });
  }
  function MockGI(props) {
    const context = useNativeContext();
    const location = shared.Jwt();
    const params = shared.$wt();
    latest = {
      thread: context.thread.clientThreadId,
      route: context.route.conversationId,
      composer: context.composer.conversationId,
      pathname: location.pathname,
      routerConversationId: params.conversationId,
      shouldResume: props.shouldResume,
    };
    return props.renderLayout({
      content: jsx.jsx("div", { "data-active": context.route.conversationId }),
      footer: jsx.jsx(Composer, {}),
    });
  }
  const root = domClient.createRoot(document.getElementById("root"));
  const a = {
    hostId: "local",
    conversationId: "fake-thread-a",
    clientThreadId: "local:fake-a",
  };
  const b = {
    hostId: "local",
    conversationId: "fake-thread-b",
    clientThreadId: "local:fake-b",
  };
  function draw(target, marker = null, retainClientRoute = false) {
    const thread = {
      clientThreadId: target.clientThreadId,
      routeConversationId: retainClientRoute ? null : target.conversationId,
    };
    const route = {
      pathname: `/local/${retainClientRoute ? target.clientThreadId : (target.conversationId ?? target.clientThreadId)}`,
      routeTemplate: "/local/:conversationId",
      search: "",
      routeKind: "local-thread",
      conversationId: target.conversationId,
      hostId: target.hostId,
      projectContext: null,
    };
    if (target.conversationId === null || retainClientRoute) {
      delete route.conversationId;
      route.routeKind = "client-local-thread";
      route.clientThreadId = target.clientThreadId;
    }
    const composer = initial.O6n(
      target.conversationId,
      "main",
      target.conversationId,
      target.clientThreadId,
    );
    const child = jsx.jsx(runtime.DesktopSplitPaneBoundary, {
      component: MockGI,
      originalProps: { showComposer: true, shouldResume: true },
      nativeScope: target,
    });
    const routeContext = {
      outlet: null,
      isDataRoute: false,
      matches: [
        {
          params: {
            conversationId: retainClientRoute
              ? target.clientThreadId
              : target.conversationId,
          },
          pathname: route.pathname,
          pathnameBase: route.pathname,
          route: { path: "/local/:conversationId", id: "local-thread" },
        },
      ],
    };
    const locationContext = {
      navigationType: "POP",
      location: {
        pathname: route.pathname,
        search: "",
        hash: "",
        state: marker ? { __chatgptDesktopPaneNavigation: marker } : null,
        key: "default",
      },
    };
    return jsx.jsx(shared.Owt.Provider, {
      value: locationContext,
      children: jsx.jsx(shared.Mwt.Provider, {
        value: routeContext,
        children: jsx.jsx(Scope, {
          scope: shared.klt,
          value: {},
          children: jsx.jsx(Scope, {
            scope: initial.B5n,
            value: thread,
            children: jsx.jsx(Scope, {
              scope: initial.p5n,
              value: route,
              children: jsx.jsx(Scope, {
                scope: initial.w6n,
                value: composer,
                children: child,
              }),
            }),
          }),
        }),
      }),
    });
  }
  const flush = (fn) => domApi.flushSync(fn);
  flush(() => root.render(draw(a)));
  let state = runtime.registry.getSnapshot();
  const keyA = state.selected.tabKey,
    groupA = state.selected.paneId;
  assert.equal(document.querySelectorAll("[data-composer]").length, 1);
  flush(() => runtime.registry.place(keyA, groupA, "right"));
  state = runtime.registry.getSnapshot();
  const empty =
    state.layout.tree.first.type === "group" &&
    !state.layout.tree.first.keys.length
      ? state.layout.tree.first
      : state.layout.tree.second;
  flush(() => runtime.registry.focusGroup(empty.id));
  flush(() => root.render(draw(b)));
  assert.equal(document.querySelectorAll("[data-composer]").length, 1);
  assert.equal(
    document.querySelector("[data-active]").dataset.active,
    b.conversationId,
  );
  assert.equal(
    document.querySelector("[data-passive]").dataset.passive,
    a.conversationId,
  );
  assert.equal(passive.at(-1).thread, a.clientThreadId);
  assert.equal(passive.at(-1).composer, a.conversationId);
  // The original uses XI as a side chat under the current outer route.
  assert.equal(passive.at(-1).pathname, `/local/${b.conversationId}`);
  assert.equal(passive.at(-1).routerConversationId, b.conversationId);
  assert.equal(passive.at(-1).isReadOnly, true);
  assert.equal(passive.at(-1).retainActiveInterest, false);
  const old = currentLease.getSnapshot();
  assert.ok(old && currentLease.isCurrent(old, b));
  const tabA = document.querySelector(`[data-desktop-split-tab="${keyA}"]`);
  flush(() => tabA.click());
  assert.equal(currentLease.isCurrent(old, b), false);
  assert.equal(navigations.length, 1);
  assert.deepEqual(navigations[0].scope, a);
  assert.equal(document.querySelectorAll("[data-composer]").length, 0);
  assert.notEqual(
    document.querySelector("[data-active]")?.dataset.active,
    a.conversationId,
  );
  flush(() =>
    root.render(draw(a, navigations[0].state.__chatgptDesktopPaneNavigation)),
  );
  assert.equal(document.querySelectorAll("[data-composer]").length, 1);
  assert.equal(
    document.querySelector("[data-active]").dataset.active,
    a.conversationId,
  );
  assert.equal(
    document.querySelector("[data-passive]").dataset.passive,
    b.conversationId,
  );
  assert.deepEqual(latest, {
    thread: a.clientThreadId,
    route: a.conversationId,
    composer: a.conversationId,
    pathname: `/local/${a.conversationId}`,
    routerConversationId: a.conversationId,
    shouldResume: true,
  });
  assert.ok(currentLease.isCurrent(currentLease.getSnapshot(), a));
  const keyB = runtime.registry
    .getSnapshot()
    .entries.find(
      (entry) => entry.scope.conversationId === b.conversationId,
    ).key;
  flush(() =>
    document.querySelector(`[data-desktop-split-tab="${keyB}"]`).click(),
  );
  assert.equal(navigations.length, 2);
  const late = navigations[1];
  flush(() =>
    document.querySelector(`[data-desktop-split-tab="${keyA}"]`).click(),
  );
  assert.equal(late.isCurrent(), false);
  flush(() => root.render(draw(b, late.state.__chatgptDesktopPaneNavigation)));
  assert.equal(
    latest.shouldResume,
    false,
    "a stale original route cannot resume its thread",
  );
  assert.equal(runtime.registry.getSnapshot().selected, null);
  assert.equal(document.querySelectorAll("[data-composer]").length, 0);
  assert.equal(
    navigations.length,
    2,
    "a late route must not trigger navigation",
  );
  const draft = {
    hostId: "local",
    conversationId: null,
    clientThreadId: "cx_fixture",
  };
  flush(() => root.render(draw(draft)));
  assert.equal(
    runtime.registry.getSnapshot().selected.scope.conversationId,
    null,
  );
  assert.equal(document.querySelectorAll("[data-composer]").length, 1);
  assert.ok(currentLease.isCurrent(currentLease.getSnapshot(), draft));
  const draftPane = runtime.registry.getSnapshot().selected.paneId;
  assert.equal(
    document.querySelector(
      `[data-desktop-split-group="${draftPane}"] [aria-label="向右拆分"]`,
    ).disabled,
    true,
  );
  const draftKey = runtime.registry.getSnapshot().selected.tabKey;
  const entryCount = runtime.registry.getSnapshot().entries.length;
  const draftToken = currentLease.getSnapshot();
  const created = { ...draft, conversationId: "created-fixture" };
  flush(() => root.render(draw(created, null, true)));
  assert.equal(runtime.registry.getSnapshot().entries.length, entryCount);
  assert.equal(runtime.registry.getSnapshot().selected.tabKey, draftKey);
  assert.deepEqual(runtime.registry.getSnapshot().selected.scope, created);
  assert.equal(currentLease.isCurrent(draftToken, draft), false);
  assert.ok(currentLease.isCurrent(currentLease.getSnapshot(), created));
  assert.equal(navigations.length, 2);
  assert.deepEqual(attempts, []);
  flush(() => root.unmount());
  runtime.dispose();
  dom.window.close();
  return {
    react: React.version,
    nativeScopes: 3,
    targets: 2,
    composers: 1,
    networkAttempts: attempts.length,
  };
}
if (process.argv.includes("--native-scopes-child")) {
  try {
    process.stdout.write(JSON.stringify(await run()) + "\n");
    process.exit(0);
  } catch (error) {
    process.stderr.write(error.stack + "\n");
    process.exit(1);
  }
} else {
  test(
    "original React and scope providers isolate two synthetic split panes",
    {
      skip:
        !moduleDir &&
        "Set CHATGPT_DESKTOP_TEST_MAC_MODULE_DIR to reviewed Mac modules",
    },
    () => {
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--native-scopes-child"],
        { encoding: "utf8", timeout: 20000 },
      );
      assert.equal(child.status, 0, child.stderr || String(child.error));
      assert.deepEqual(JSON.parse(child.stdout), {
        react: "19.2.7",
        nativeScopes: 3,
        targets: 2,
        composers: 1,
        networkAttempts: 0,
      });
    },
  );
}
