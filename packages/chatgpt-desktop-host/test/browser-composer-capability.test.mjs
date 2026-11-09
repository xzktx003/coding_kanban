import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";
import { createBrowserComposerCapability } from "../src/browser-composer-capability.mjs";

const enabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";
const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const browserOnly = {
  skip:
    !(enabled && archivePath) &&
    "Requires the explicitly supplied pinned Mac archive and an isolated browser",
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("rejects invalid capability configuration", () => {
  assert.throws(() => createBrowserComposerCapability({}), {
    code: "COMPOSER_CAPABILITY_INVALID_CONFIG",
  });
  assert.throws(() => createBrowserComposerCapability(null), {
    code: "COMPOSER_CAPABILITY_INVALID_CONFIG",
  });
});

const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><div id="editors"></div><script type="module">
import * as original from '/assets/app-initial-18b189e867e7.js';
import * as shared from '/assets/app-shared-601019a330d7.js';
import {createBrowserComposerCapability} from '/capability.mjs';
original.Oc(); original.dO();
const React=shared.pWt(), ReactDOM=shared.GFt(), root=ReactDOM.createRoot(document.getElementById('root'));
const documentScope={profileId:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',viewId:'33333333-3333-4333-8333-333333333333'};
const options={enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true};
const controllers=['a','b'].map(()=>original.Cc(null,options));
for (const c of controllers) document.getElementById('editors').append(c.view.dom);
const targets=[{hostId:'local',conversationId:'thread-a',clientThreadId:'client-a',isMain:true},{hostId:'local',conversationId:'thread-b',clientThreadId:'client-b',isMain:true}];
function lease(expected=null) {let token=Object.freeze({}),listeners=new Set(),match=expected;return {
 getSnapshot:()=>token,isCurrent:(candidate,binding)=>candidate===token&&token!==null&&(!match||match(binding)),
 subscribe:callback=>{listeners.add(callback);return()=>listeners.delete(callback)},
 rotate(){token=Object.freeze({});for(const callback of [...listeners])callback()},
 sameNotification(){for(const callback of [...listeners])callback()},
 hide(){token=null;for(const callback of [...listeners])callback()},
 setMatch(next){match=next;this.rotate()},
};}
const mode=lease(),pane=lease(),brokenPane=Object.freeze({getSnapshot:()=>brokenPaneToken,isCurrent:()=>true,subscribe:()=>undefined});
const brokenPaneToken=Object.freeze({});
const runtime=createBrowserComposerCapability({window,React,useComposerController:original.fO,documentScope,modeActivation:mode});
let selected=0,show=true,second=false,allowPane=true,paneBroken=false,currentScope=targets[0];
const render=()=>root.render(React.createElement(React.Fragment,null,...(show?[React.createElement(original.ZUn.Provider,{key:'a',value:controllers[selected]},React.createElement(runtime.Registrar,{scope:currentScope,paneLease:allowPane?(paneBroken?brokenPane:pane):null}))]:[]),...(second?[React.createElement(original.ZUn.Provider,{key:'b',value:controllers[1]},React.createElement(runtime.Registrar,{scope:targets[1],paneLease:pane}))]:[])));
const settle=()=>new Promise(resolve=>setTimeout(resolve,50));
window.fixture={runtime,controllers,targets,mode,pane,render,settle,
 select(index){selected=index;currentScope=targets[index];render()},
 setScope(scope){currentScope=scope;render()},
 missingPane(value){allowPane=!value;render()},brokenPane(value){paneBroken=value;render()},
 multiple(value){second=value;render()},mounted(value){show=value;render()},
 token:()=>runtime.captureScope(),
 current:token=>runtime.isScopeCurrent(token),
 editor:()=>runtime.getCommittedEditor(),
};
render();await settle();window.fixtureReady=true;
</script>`;

let browser, assets;
if (enabled && archivePath) {
  test.before(async () => {
    const archive = await openWebviewArchive({
      asarPath: archivePath,
      sha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    assets = new Map();
    try {
      for (const [name, sha] of [
        [
          "app-initial-18b189e867e7.js",
          "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032",
        ],
        [
          "app-shared-601019a330d7.js",
          "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
        ],
        [
          "rolldown-runtime-428824ca0286.js",
          "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
        ],
      ]) {
        const asset = await archive.acquireAsset(`webview/assets/${name}`);
        try {
          assert.equal(hash(asset.body), sha);
          assets.set(name, Buffer.from(asset.body));
        } finally {
          asset.release();
        }
      }
    } finally {
      await archive.close();
    }
    const { chromium } =
      await import("../../../node_modules/playwright/index.mjs");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
  });
  test.after(async () => browser?.close());
}

async function fixture(t) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  const adapter = await readFile(
    new URL("../src/browser-composer-capability.mjs", import.meta.url),
  );
  await context.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname,
      name = path.split("/").at(-1);
    if (assets.has(name))
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: assets.get(name),
      });
    if (path === "/capability.mjs")
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: adapter,
      });
    if (path === "/fixture")
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: html,
      });
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:18080/fixture");
  await page.waitForFunction(() => window.fixtureReady === true);
  return page;
}

test(
  "original provider commits exact controller and revokes old scopes synchronously",
  browserOnly,
  async (t) => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      let first = f.token();
      const initial =
        first !== null &&
        f.current(first) &&
        f.editor()?.controller === f.controllers[0];
      f.mode.hide();
      const hidden = !f.current(first) && f.token() === null;
      f.mode.rotate();
      const beforeCommit = f.token() === null;
      await f.settle();
      const second = f.token();
      const reactivated =
        second !== null && second !== first && f.current(second);
      f.select(1);
      await f.settle();
      const switched = f.token(),
        switchedCorrect =
          !f.current(second) &&
          switched !== null &&
          f.editor()?.controller === f.controllers[1];
      f.pane.rotate();
      const reconfirmSync = !f.current(switched);
      await f.settle();
      const reconfirmed = f.token(),
        newRevision = reconfirmed !== null && reconfirmed !== switched;
      f.pane.hide();
      const paneSync = !f.current(reconfirmed) && f.token() === null;
      f.pane.rotate();
      await f.settle();
      const afterPane = f.token();
      f.multiple(true);
      await f.settle();
      const ambiguous =
        !f.current(afterPane) && f.token() === null && f.editor() === null;
      f.multiple(false);
      await f.settle();
      const afterRemoval = f.token() !== null;
      const beforeSame = f.token();
      f.pane.sameNotification();
      const sameSync = !f.current(beforeSame) && f.token() === null;
      f.render();
      await f.settle();
      const afterSame = f.token() !== null;
      return {
        initial,
        hidden,
        beforeCommit,
        reactivated,
        switchedCorrect,
        reconfirmSync,
        newRevision,
        paneSync,
        ambiguous,
        afterRemoval,
        sameSync,
        afterSame,
      };
    });
    assert.deepEqual(
      result,
      Object.fromEntries(Object.keys(result).map((key) => [key, true])),
    );
  },
);

test(
  "incomplete or wrong leases, missing commit, disconnected view, and disposal fail closed",
  browserOnly,
  async (t) => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      let old = f.token();
      f.missingPane(true);
      await f.settle();
      const paneAbsent = f.token() === null && !f.current(old);
      f.missingPane(false);
      await f.settle();
      const ready = f.token() !== null;
      f.brokenPane(true);
      await f.settle();
      const brokenSubscription = f.token() === null;
      f.brokenPane(false);
      await f.settle();
      f.pane.setMatch(() => false);
      await f.settle();
      const wrongScope = f.token() === null;
      f.pane.setMatch(() => true);
      await f.settle();
      old = f.token();
      f.setScope({
        ...f.targets[0],
        conversationId: null,
        clientThreadId: null,
      });
      await f.settle();
      const invalidScope = f.token() === null && !f.current(old);
      f.setScope({ ...f.targets[0], isMain: false });
      await f.settle();
      const inactiveFooter = f.token() === null;
      f.setScope(f.targets[0]);
      await f.settle();
      old = f.token();
      f.controllers[0].view.dom.remove();
      const disconnected = f.token() === null && !f.current(old);
      document.getElementById("editors").append(f.controllers[0].view.dom);
      const noResurrection = f.token() === null;
      f.render();
      await f.settle();
      const afterCommit = f.token() !== null;
      f.runtime.dispose();
      return {
        paneAbsent,
        ready,
        brokenSubscription,
        wrongScope,
        invalidScope,
        inactiveFooter,
        disconnected,
        noResurrection,
        afterCommit,
        disposed: f.token() === null,
      };
    });
    assert.deepEqual(
      result,
      Object.fromEntries(Object.keys(result).map((key) => [key, true])),
    );
  },
);

test(
  "pane ownership must match the exact committed original footer scope",
  browserOnly,
  async (t) => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const f = window.fixture;
      const matches = (scope, name) =>
        Object.isFrozen(scope) &&
        Object.keys(scope).sort().join(",") ===
          "clientThreadId,conversationId,hostId" &&
        scope.hostId === "local" &&
        scope.conversationId === "thread-" + name &&
        scope.clientThreadId === "client-" + name;
      f.pane.setMatch((scope) => matches(scope, "a"));
      await f.settle();
      const first = f.token(),
        correctA =
          first !== null && f.editor()?.controller === f.controllers[0];
      f.select(1);
      await f.settle();
      const deniedStale =
        !f.current(first) && f.token() === null && f.editor() === null;
      f.pane.setMatch((scope) => matches(scope, "b"));
      await f.settle();
      const correctB =
        f.token() !== null && f.editor()?.controller === f.controllers[1];
      return { correctA, deniedStale, correctB };
    });
    assert.deepEqual(result, {
      correctA: true,
      deniedStale: true,
      correctB: true,
    });
  },
);

test(
  "pending chat keeps its explicit null conversation id and requires a client thread identity",
  browserOnly,
  async (t) => {
    const page = await fixture(t);
    const result = await page.evaluate(async () => {
      const f = window.fixture,
        pending = { ...f.targets[0], conversationId: null };
      f.pane.setMatch(
        (scope) =>
          Object.isFrozen(scope) &&
          scope.hostId === "local" &&
          scope.conversationId === null &&
          scope.clientThreadId === "client-a",
      );
      f.setScope(pending);
      await f.settle();
      const first = f.token(),
        pendingAllowed =
          first !== null && f.editor()?.controller === f.controllers[0];
      f.setScope({ ...pending, clientThreadId: null });
      await f.settle();
      const noIdentityRejected = !f.current(first) && f.token() === null;
      const missing = { ...pending };
      delete missing.conversationId;
      f.setScope(missing);
      await f.settle();
      const missingRejected = f.token() === null;
      return { pendingAllowed, noIdentityRejected, missingRejected };
    });
    assert.deepEqual(result, {
      pendingAllowed: true,
      noIdentityRejected: true,
      missingRejected: true,
    });
  },
);
