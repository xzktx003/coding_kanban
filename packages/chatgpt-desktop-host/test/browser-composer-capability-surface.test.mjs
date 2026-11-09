import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";

const enabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";
const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const profileId = "11111111-1111-4111-8111-111111111111",
  generation = "22222222-2222-4222-8222-222222222222",
  viewId = "33333333-3333-4333-8333-333333333333";
const childPath = `/chatgpt-desktop/${profileId}/${generation}/webview/index.html`;
const parentHtml = `<!doctype html><meta charset="utf-8"><section id="mode"></section><script type="module">
import {installDesktopSurfaceHost} from '/__host/surface-host-bridge.mjs';
const frame=document.createElement('iframe');frame.src='${childPath}';const host=installDesktopSurfaceHost({window,frame,profileId:'${profileId}',generation:'${generation}'});host.confirmActive(true);document.getElementById('mode').append(frame);window.parentFixture={frame,host};
</script>`;
const childHtml = `<!doctype html><meta charset="utf-8"><div id="root"></div><div id="editor"></div><script>Object.defineProperty(window,'__chatgptDesktopLayoutEnabled',{value:true})</script><script type="module">
import {connectDesktopSurfaceHost} from '/__host/surface-host-bridge.mjs';
import {createBrowserSurfaceController} from '/__host/browser-surface-controller.mjs';
import {installDesktopBridge} from '/__host/browser-bridge.mjs';
import {initializeComposerCapability,OriginalComposerRegistrar} from '/__host/browser-composer-capability-entry.mjs';
const scope={profileId:'${profileId}',generation:'${generation}',viewId:'${viewId}'};const surface=connectDesktopSurfaceHost({window,document,scope});
let cap,sent=0;const local=createBrowserSurfaceController({window,scope,modeActivation:surface,initializeCapability:async options=>(cap=await initializeComposerCapability(options))});
const bridge=installDesktopBridge({window,scope,contextMenuAdapter:local.contextMenuAdapter,bootstrap:{windowType:'electron',getters:{getBuildFlavor:'stable',getSystemThemeVariant:'light',getInitialSidebarBootstrap:{projects:[]}},sharedObjects:{}},transport:{send:async()=>{sent++},subscribe:()=>()=>{}}});
window.addEventListener('pagehide',()=>{bridge.dispose();surface.dispose()});
await local.initialize();
const [shared,original,layout,{createDesktopPaneLayout}]=await Promise.all([import('/assets/app-shared-601019a330d7.js'),import('/assets/app-initial-18b189e867e7.js'),import('/__host/desktop-layout-browser.mjs'),import('/__host/desktop-pane-layout.mjs')]);
const React=shared.pWt(),ReactDOM=shared.GFt();original.Oc();
const panes=createDesktopPaneLayout({idFactory:()=> 'pane-1'});panes.open('tab-a');layout.desktopFooterOwnership.bindPaneLayout(panes);
const controller=original.Cc(null,{enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true});document.getElementById('editor').append(controller.view.dom);
const nativeScope={hostId:'local',conversationId:'thread-a',clientThreadId:'client-a'};
const stableFooter=React.createElement(original.ZUn.Provider,{value:controller},React.createElement(OriginalComposerRegistrar,{scope:{...nativeScope,isMain:true}}));
window.commitCount=0;function CommitProbe(){React.useLayoutEffect(()=>{window.commitCount++});return null}function GI({renderLayout}){return renderLayout({content:React.createElement(CommitProbe),footer:stableFooter})}
const root=ReactDOM.createRoot(document.getElementById('root'));const snapshot=panes.getSnapshot();const render=()=>root.render(React.createElement(layout.DesktopPaneOwnershipProvider,{paneId:snapshot.activeGroupId,tabKey:'tab-a',layoutRevision:snapshot.revision},React.createElement(layout.DesktopLayoutBoundary,{component:GI,originalProps:{},nativeScope})));render();
const results=[];await new Promise(resolve=>setTimeout(resolve,200));window.childFixture={cap,controller,results,rerenderSame:render,getSent:()=>sent,openPaste(){controller.view.focus();window.electronBridge.showContextMenu([{id:'paste',label:'paste',role:'paste'}],{x:20,y:20}).then(result=>results.push(result),error=>results.push({error:error.code}))}};window.fixtureReady=true;
</script>`;

test(
  "same-origin parent mode and iframe document leases revoke the original composer immediately",
  {
    skip:
      !(enabled && archivePath) &&
      "Requires pinned archive and isolated browser",
  },
  async (t) => {
    const archive = await openWebviewArchive({
      asarPath: archivePath,
      sha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    const originals = new Map();
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
        const asset = await archive.acquireAsset("webview/assets/" + name);
        try {
          assert.equal(
            createHash("sha256").update(asset.body).digest("hex"),
            sha,
          );
          originals.set(name, Buffer.from(asset.body));
        } finally {
          asset.release();
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
      "surface-host-bridge.mjs",
      "surface-activation.mjs",
      "browser-rich-editor.mjs",
      "browser-context-menu.mjs",
      "browser-surface-controller.mjs",
      "browser-bridge.mjs",
      "wire-value.mjs",
    ])
      modules.set(
        name,
        await readFile(new URL("../src/" + name, import.meta.url)),
      );
    const { chromium } =
      await import("../../../node_modules/playwright/index.mjs");
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
    t.after(() => browser.close());
    const context = await browser.newContext({ serviceWorkers: "block" });
    t.after(() => context.close());
    await context.route("**/*", (route) => {
      const path = new URL(route.request().url()).pathname,
        name = path.split("/").at(-1);
      if (originals.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: originals.get(name),
        });
      if (path.includes("/__host/") && modules.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: modules.get(name),
        });
      if (path === "/parent")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: parentHtml,
        });
      if (path === childPath)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: childHtml,
        });
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:18080/parent");
    await page.waitForFunction(
      () => window.parentFixture?.frame.contentWindow?.fixtureReady === true,
      null,
      { timeout: 10000 },
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    const frame = page
      .frames()
      .find((value) => value.url().endsWith(childPath));
    assert.ok(frame);
    await frame.locator("#editor [contenteditable=true]").focus();
    await frame.evaluate(async () => {
      await navigator.clipboard.writeText("baseline");
      window.childFixture.openPaste();
    });
    await frame.getByRole("menuitem", { name: "paste", exact: true }).click();
    await frame.waitForFunction(() => window.childFixture.results.length === 1);
    assert.deepEqual(
      await frame.evaluate(() => window.childFixture.results[0]),
      { id: "paste" },
    );
    assert.equal(
      await frame.evaluate(
        () => window.childFixture.controller.view.state.doc.textContent,
      ),
      "baseline",
    );
    assert.equal(await frame.evaluate(() => window.childFixture.getSent()), 0);
    async function beginDelayedPaste(text) {
      await frame.evaluate(() => {
        window.childFixture.results.length = 0;
        delete navigator.clipboard.read;
        delete window.releaseRead;
      });
      await frame.locator("#editor [contenteditable=true]").focus();
      await frame.evaluate(async (value) => {
        await navigator.clipboard.writeText(value);
        const read = navigator.clipboard.read.bind(navigator.clipboard);
        Object.defineProperty(navigator.clipboard, "read", {
          configurable: true,
          value: async () => {
            const result = await read();
            await new Promise((resolve) => {
              window.releaseRead = resolve;
            });
            return result;
          },
        });
        window.childFixture.openPaste();
      }, text);
      const before = await frame.evaluate(() =>
        window.childFixture.controller.view.state.doc.toJSON(),
      );
      await frame.getByRole("menuitem", { name: "paste", exact: true }).click();
      await frame.waitForFunction(
        () => typeof window.releaseRead === "function",
      );
      return before;
    }
    await beginDelayedPaste("still-current");
    const previousCommit = await frame.evaluate(() => window.commitCount);
    await frame.evaluate(() => {
      window.childFixture.rerenderSame();
    });
    await frame.waitForFunction(
      (previous) => window.commitCount > previous,
      previousCommit,
      { timeout: 5000 },
    );
    await frame.evaluate(() => window.releaseRead());
    await frame.waitForFunction(() => window.childFixture.results.length === 1);
    assert.deepEqual(
      await frame.evaluate(() => window.childFixture.results[0]),
      { id: "paste" },
    );
    assert.equal(
      await frame.evaluate(
        () => window.childFixture.controller.view.state.doc.textContent,
      ),
      "baselinestill-current",
    );

    const beforeConfirm = await beginDelayedPaste("must-not-insert-confirm");
    const reconfirmed = await page.evaluate(() => {
      const { frame, host } = window.parentFixture,
        cap = frame.contentWindow.childFixture.cap,
        token = cap.captureScope();
      host.confirmActive(true);
      return (
        token !== null &&
        !cap.isScopeCurrent(token) &&
        cap.captureScope() === null
      );
    });
    assert.equal(reconfirmed, true);
    await frame.evaluate(() => window.releaseRead());
    await frame.waitForFunction(() => window.childFixture.results.length === 1);
    assert.deepEqual(
      await frame.evaluate(() => window.childFixture.results[0]),
      { error: "BRIDGE_MENU_UNAVAILABLE" },
    );
    assert.deepEqual(
      await frame.evaluate(() =>
        window.childFixture.controller.view.state.doc.toJSON(),
      ),
      beforeConfirm,
    );
    await page.waitForFunction(
      () =>
        window.parentFixture.frame.contentWindow.childFixture.cap.captureScope() !==
        null,
      null,
      { timeout: 5000 },
    );

    const before = await beginDelayedPaste("must-not-insert-hidden");
    const first = await page.evaluate(() => {
      const { frame, host } = window.parentFixture,
        child = frame.contentWindow,
        cap = child.childFixture.cap,
        token = cap.captureScope();
      window.saved = { cap, token, doc: frame.contentDocument };
      const correct =
        token !== null &&
        cap.getCommittedEditor()?.controller === child.childFixture.controller;
      host.confirmActive(false);
      const section = document.getElementById("mode");
      section.hidden = true;
      section.inert = true;
      return {
        correct,
        hiddenSync: !cap.isScopeCurrent(token) && cap.captureScope() === null,
      };
    });
    assert.deepEqual(first, { correct: true, hiddenSync: true });
    await frame.evaluate(() => window.releaseRead());
    await frame.waitForFunction(() => window.childFixture.results.length === 1);
    assert.deepEqual(
      await frame.evaluate(() => window.childFixture.results[0]),
      { error: "BRIDGE_MENU_UNAVAILABLE" },
    );
    assert.deepEqual(
      await frame.evaluate(() =>
        window.childFixture.controller.view.state.doc.toJSON(),
      ),
      before,
    );
    assert.equal(await frame.evaluate(() => window.childFixture.getSent()), 0);
    await page.evaluate(() => {
      const section = document.getElementById("mode");
      section.hidden = false;
      section.inert = false;
      window.parentFixture.host.confirmActive(true);
    });
    await page.waitForFunction(
      () =>
        window.parentFixture.frame.contentWindow.childFixture.cap.captureScope() !==
        null,
      null,
      { timeout: 5000 },
    );
    const beforeReload = await page.evaluate(() => {
      const { frame } = window.parentFixture,
        cap = frame.contentWindow.childFixture.cap;
      window.saved = {
        cap,
        token: cap.captureScope(),
        doc: frame.contentDocument,
      };
      frame.contentWindow.location.reload();
      return true;
    });
    assert.equal(beforeReload, true);
    await page.waitForFunction(
      () => {
        const p = window.parentFixture;
        return (
          p.frame.contentDocument !== window.saved.doc &&
          p.frame.contentWindow?.fixtureReady === true
        );
      },
      null,
      { timeout: 10000 },
    );
    const replaced = await page.evaluate(() => {
      const { cap, token } = window.saved,
        child = window.parentFixture.frame.contentWindow;
      return {
        oldRevoked: !cap.isScopeCurrent(token) && cap.captureScope() === null,
        newActive: child.childFixture.cap.captureScope() !== null,
      };
    });
    assert.deepEqual(replaced, { oldRevoked: true, newActive: true });
    assert.deepEqual(errors, []);
  },
);
