import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeComposerCapability,
  OriginalComposerRegistrar,
} from "../src/browser-composer-capability-entry.mjs";

test("browser capability entry is inert until an explicit valid bootstrap", async () => {
  assert.equal(OriginalComposerRegistrar({ scope: null }), null);
  await assert.rejects(initializeComposerCapability(null), {
    code: "COMPOSER_ENTRY_INVALID_CONFIG",
  });
});

const browserEnabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";
const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
test(
  "original composer provider is bound to the committed layout footer and native scope",
  {
    skip:
      !(browserEnabled && archivePath) &&
      "Requires pinned Mac archive and isolated browser",
  },
  async (t) => {
    const { openWebviewArchive } = await import("../src/assets.mjs");
    const { createHash } = await import("node:crypto");
    const { readFile } = await import("node:fs/promises");
    const { chromium } =
      await import("../../../node_modules/playwright/index.mjs");
    const archive = await openWebviewArchive({
      asarPath: archivePath,
      sha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    const originals = new Map();
    try {
      for (const [name, expected] of [
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
        const resource = await archive.acquireAsset("webview/assets/" + name);
        try {
          assert.equal(
            createHash("sha256").update(resource.body).digest("hex"),
            expected,
          );
          originals.set(name, Buffer.from(resource.body));
        } finally {
          resource.release();
        }
      }
    } finally {
      await archive.close();
    }
    const modules = new Map();
    for (const name of [
      "browser-composer-capability-entry.mjs",
      "browser-composer-capability.mjs",
      "desktop-layout-browser.mjs",
      "desktop-layout-core.mjs",
      "desktop-pane-layout.mjs",
      "desktop-selected-pane-core.mjs",
      "desktop-selected-pane-browser.mjs",
      "desktop-home-registrar.mjs",
    ])
      modules.set(
        name,
        await readFile(new URL("../src/" + name, import.meta.url)),
      );
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
    t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block" });
    t.after(() => context.close());
    const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><div id="editors"></div><script>Object.defineProperty(window,'__chatgptDesktopLayoutEnabled',{value:true})</script><script type="module">
import * as shared from '/assets/app-shared-601019a330d7.js';
import * as original from '/assets/app-initial-18b189e867e7.js';
import * as layout from '/__host/desktop-layout-browser.mjs';
import {createDesktopPaneLayout} from '/__host/desktop-pane-layout.mjs';
import {initializeComposerCapability,OriginalComposerRegistrar} from '/__host/browser-composer-capability-entry.mjs';
const React=shared.pWt(),ReactDOM=shared.GFt();original.Oc();
const mode=(()=>{let token=Object.freeze({}),listeners=new Set();return {getSnapshot:()=>token,isCurrent:value=>value===token&&value!==null,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},hide(){token=null;for(const f of [...listeners])f()},show(){token=Object.freeze({});for(const f of [...listeners])f()}}})();
const documentScope={profileId:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',viewId:'33333333-3333-4333-8333-333333333333'};
const capability=await initializeComposerCapability({window,scope:documentScope,modeActivation:mode});
const panes=createDesktopPaneLayout({idFactory:()=> 'pane-1'});panes.open('tab-a');layout.desktopFooterOwnership.bindPaneLayout(panes);
const controllers=['a','b','pending'].map(()=>original.Cc(null,{enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true}));for(const c of controllers)document.getElementById('editors').append(c.view.dom);
let index=0;const scopes=['a','b'].map(x=>({hostId:'local',conversationId:'thread-'+x,clientThreadId:'client-'+x}));scopes.push({hostId:'local',conversationId:null,clientThreadId:'pending-client'});const tabs=['tab-a','tab-b','tab-pending'];
function OriginalGI({renderLayout}){const footer=React.createElement(original.ZUn.Provider,{value:controllers[index]},React.createElement(OriginalComposerRegistrar,{scope:{...scopes[index],isMain:true}}));return renderLayout({content:null,footer})}
const root=ReactDOM.createRoot(document.getElementById('root'));
function render(){const snapshot=panes.getSnapshot();root.render(React.createElement(layout.DesktopPaneOwnershipProvider,{paneId:snapshot.activeGroupId,tabKey:tabs[index],layoutRevision:snapshot.revision},React.createElement(layout.DesktopLayoutBoundary,{component:OriginalGI,originalProps:{},nativeScope:scopes[index]})))}
const settle=()=>new Promise(resolve=>setTimeout(resolve,100));render();await settle();window.fixture={capability,mode,panes,controllers,render,settle,selectB(){index=1;panes.open('tab-b');render()},selectPending(){index=2;panes.open('tab-pending');render()}};window.fixtureReady=true;
</script>`;
    await context.route("**/*", (route) => {
      const path = new URL(route.request().url()).pathname,
        name = path.split("/").at(-1);
      if (originals.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: originals.get(name),
        });
      if (path.startsWith("/__host/") && modules.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: modules.get(name),
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:18080/fixture");
    await page.waitForFunction(() => window.fixtureReady === true, {
      timeout: 10000,
    });
    const result = await page.evaluate(async () => {
      const f = window.fixture,
        cap = f.capability,
        first = cap.captureScope();
      const firstMatch =
        first !== null &&
        cap.getCommittedEditor()?.controller === f.controllers[0];
      f.selectB();
      const switchSync =
        !cap.isScopeCurrent(first) && cap.captureScope() === null;
      await f.settle();
      const second = cap.captureScope(),
        secondMatch =
          second !== null &&
          cap.getCommittedEditor()?.controller === f.controllers[1];
      f.selectPending();
      const pendingSwitchSync =
        !cap.isScopeCurrent(second) && cap.captureScope() === null;
      await f.settle();
      const pending = cap.captureScope();
      const pendingMatch =
        pending !== null &&
        cap.getCommittedEditor()?.controller === f.controllers[2];
      f.mode.hide();
      const hiddenSync =
        !cap.isScopeCurrent(pending) && cap.captureScope() === null;
      f.mode.show();
      await f.settle();
      const resumed = cap.captureScope() !== null;
      cap.dispose();
      return {
        firstMatch,
        switchSync,
        secondMatch,
        pendingSwitchSync,
        pendingMatch,
        hiddenSync,
        resumed,
        closed: cap.captureScope() === null,
      };
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(result, {
      firstMatch: true,
      switchSync: true,
      secondMatch: true,
      pendingSwitchSync: true,
      pendingMatch: true,
      hiddenSync: true,
      resumed: true,
      closed: true,
    });
  },
);
