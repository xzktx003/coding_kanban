import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";
import { decodeWireValue, encodeWireValue } from "../src/wire-value.mjs";

const enabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";
const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const profileId = "11111111-1111-4111-8111-111111111111",
  generation = "22222222-2222-4222-8222-222222222222",
  viewId = "33333333-3333-4333-8333-333333333333";
const path = `/chatgpt-desktop/${profileId}/${generation}/webview/index.html`,
  entry = "./assets/index-5a9cde31.js";
const bootstrap = encodeWireValue({
  v: 1,
  type: "bootstrap",
  scope: { profileId, generation, viewId },
  bootstrap: {
    windowType: "electron",
    getters: { getBuildFlavor: "stable", getSystemThemeVariant: "light" },
    sharedObjects: {},
  },
});
const parentHtml = `<!doctype html><meta charset="utf-8"><style>html,body,#host{height:100%;margin:0}iframe{width:100%;height:680px;border:0}</style><div id="host"></div><script type="module">
import {installDesktopSurfaceHost} from '/__host/surface-host-bridge.mjs';const frame=document.createElement('iframe');frame.src='${path}';const host=installDesktopSurfaceHost({window,frame,profileId:'${profileId}',generation:'${generation}'});host.confirmActive(true);document.getElementById('host').append(frame);window.fixture={frame,host};
</script>`;
const childHtml = `<!doctype html><meta charset="utf-8"><div id="root"></div><div id="editor"></div><script type="module">
import {encodeWireValue,decodeWireValue} from './__host/wire-value.mjs';
window.sentFrames=[];window.lifecycleFrames=[];window.pendingLifecycleAcks=[];window.holdLifecycleAcks=false;window.originalStarted=false;
const viewScope=${JSON.stringify({ profileId, generation, viewId })};
window.WebSocket=class extends EventTarget {constructor(){super();window.fixtureSocket=this;this.readyState=0;this.bufferedAmount=0;this.inSeq=0;setTimeout(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));this.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(bootstrap)}}))},0)}deliver(payload){this.dispatchEvent(new MessageEvent('message',{data:encodeWireValue({v:1,scope:viewScope,seq:++this.inSeq,...payload})}))}send(value){const call=decodeWireValue(value),msg=call.args?.[0];if(call.method==='sendMessageFromView'&&msg?.type==='kanban-project-folder-lifecycle'){const record={sequence:msg.sequence,epoch:msg.epoch,acknowledged:false};window.lifecycleFrames.push(record);const finish=()=>{if(this.readyState!==1)return;this.deliver({type:'viewMessage',data:{type:'kanban-project-folder-lifecycle-ack',sequence:msg.sequence,epoch:msg.epoch}});this.deliver({type:'return',id:call.id,value:undefined});record.acknowledged=true};if(window.holdLifecycleAcks)window.pendingLifecycleAcks.push(finish);else queueMicrotask(finish)}else window.sentFrames.push(value)}close(){this.readyState=3;this.dispatchEvent(new Event('close'))}};
</script><script id="chatgpt-host-manifest" type="application/json">${JSON.stringify({ version: 2, profileId, generation, entry })}</script><script type="module" src="./__host/browser-entry.mjs"></script>`;
const indexJs = `import * as shared from './app-shared-601019a330d7.js';import * as original from './app-initial-18b189e867e7.js';
import {DesktopSelectedPaneBoundary} from '../__host/desktop-selected-pane-browser.mjs';import {OriginalComposerRegistrar} from '../__host/browser-composer-capability-entry.mjs';
window.originalStarted=true;window.indexSawBridge=!!window.electronBridge&&window.__chatgptDesktopLayoutEnabled===true;
const React=shared.pWt(),ReactDOM=shared.GFt();original.Oc();const controller=original.Cc(null,{enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true});document.getElementById('editor').append(controller.view.dom);
const nativeScope={hostId:'local',conversationId:'thread-a',clientThreadId:'client-a'};const stableFooter=React.createElement(original.ZUn.Provider,{value:controller},React.createElement(OriginalComposerRegistrar,{scope:{...nativeScope,isMain:true}}));
window.commitCount=0;function CommitProbe(){React.useLayoutEffect(()=>{window.commitCount++});return null}function GI({renderLayout}){return renderLayout({content:React.createElement(CommitProbe),footer:stableFooter})}
const root=ReactDOM.createRoot(document.getElementById('root'));let showHome=false;const render=()=>root.render(showHome?React.createElement(original.ZUn.Provider,{value:controller},React.createElement(React.Fragment,null,React.createElement(CommitProbe),React.createElement(OriginalComposerRegistrar,{homeScope:{hostId:'local',conversationId:null,clientThreadId:'fixture-home',isMain:true}}))):React.createElement(DesktopSelectedPaneBoundary,{component:GI,originalProps:{showComposer:true},nativeScope}));render();
const results=[];await new Promise(resolve=>setTimeout(resolve,200));window.childFixture={controller,results,rerenderSame:render,enterHome(){showHome=true;render()},openPaste(){controller.view.focus();window.electronBridge.showContextMenu([{id:'paste',label:'paste',role:'paste'}],{x:20,y:20}).then(x=>results.push(x),e=>results.push({error:e.code}))}};window.fixtureReady=true;`;

test(
  "actual v2 entry installs bridge, initializes pinned modules, then starts the same-origin surface",
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
      }),
      originals = new Map();
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
      "browser-entry.mjs",
      "browser-bridge.mjs",
      "wire-value.mjs",
      "surface-host-bridge.mjs",
      "surface-activation.mjs",
      "browser-surface-controller.mjs",
      "browser-project-folder-picker.mjs",
      "browser-context-menu.mjs",
      "browser-rich-editor.mjs",
      "browser-composer-capability.mjs",
      "browser-composer-capability-entry.mjs",
      "desktop-layout-browser.mjs",
      "desktop-layout-core.mjs",
      "desktop-pane-layout.mjs",
      "desktop-selected-pane-core.mjs",
      "desktop-selected-pane-browser.mjs",
      "browser-isolated-pane-navigation.mjs",
      "desktop-home-registrar.mjs",
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
      const url = new URL(route.request().url()),
        name = url.pathname.split("/").at(-1);
      if (originals.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: originals.get(name),
        });
      if (url.pathname.includes("/__host/") && modules.has(name))
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: modules.get(name),
        });
      if (name === "index-5a9cde31.js")
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: indexJs,
        });
      if (url.pathname === "/parent")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: parentHtml,
        });
      if (url.pathname === path)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: childHtml,
        });
      return route.abort();
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:18080/parent");
    await page.waitForFunction(
      () => window.fixture?.frame.contentWindow?.fixtureReady === true,
      null,
      { timeout: 10000 },
    );
    const frame = page.frames().find((f) => f.url().endsWith(path));
    assert.ok(frame);
    assert.equal(await frame.evaluate(() => window.indexSawBridge), true);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18080",
    });
    await frame.locator("#editor [contenteditable=true]").focus();
    await frame.evaluate(async () => {
      await navigator.clipboard.writeText("v2-entry-fixture");
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
      "v2-entry-fixture",
    );
    assert.equal(await frame.evaluate(() => window.sentFrames.length), 0);
    // Synthetic home scope, but the real pinned Gac, controller context,
    // entry and bridge. Actual home-scope provenance is checked separately.
    const previousHomeCommit = await frame.evaluate(() => window.commitCount);
    await frame.evaluate(() => window.childFixture.enterHome());
    await frame.waitForFunction(
      (previous) => window.commitCount > previous,
      previousHomeCommit,
    );
    await frame.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    async function beginDelayedPaste(value) {
      await frame.evaluate(() => {
        window.childFixture.results.length = 0;
        delete navigator.clipboard.read;
        delete window.releaseRead;
      });
      await frame.locator("#editor [contenteditable=true]").focus();
      await frame.evaluate(async (text) => {
        await navigator.clipboard.writeText(text);
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
      }, value);
      const before = await frame.evaluate(() =>
        window.childFixture.controller.view.state.doc.toJSON(),
      );
      await frame.getByRole("menuitem", { name: "paste", exact: true }).click();
      await frame.waitForFunction(
        () => typeof window.releaseRead === "function",
      );
      return before;
    }
    await beginDelayedPaste("after-rerender");
    const previousCommit = await frame.evaluate(() => window.commitCount);
    await frame.evaluate(() => window.childFixture.rerenderSame());
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
      "v2-entry-fixtureafter-rerender",
    );
    const beforeConfirm = await beginDelayedPaste("never-committed");
    const invalidated = await page.evaluate(() => {
      const { frame, host } = window.fixture,
        lease = frame.contentWindow.__kanbanDesktopSurfaceActivation,
        token = lease.getSnapshot();
      host.confirmActive(true);
      return token !== null && !lease.isCurrent(token);
    });
    assert.equal(invalidated, true);
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
    assert.equal(await frame.evaluate(() => window.sentFrames.length), 0);
    assert.deepEqual(errors, []);
    const top = await context.newPage();
    top.setDefaultTimeout(10000);
    const topErrors = [];
    top.on("pageerror", (error) => topErrors.push(error.message));
    await top.goto("http://127.0.0.1:18080" + path);
    await top.waitForFunction(() => window.fixtureReady === true, null, {
      timeout: 10000,
    });
    await top.evaluate(() => window.childFixture.openPaste());
    await top.waitForFunction(() => window.childFixture.results.length === 1);
    assert.deepEqual(await top.evaluate(() => window.childFixture.results[0]), {
      error: "BRIDGE_MENU_UNAVAILABLE",
    });
    assert.equal(await top.evaluate(() => window.sentFrames.length), 0);
    assert.equal(
      await top.evaluate(
        () => window.childFixture.controller.view.state.doc.textContent,
      ),
      "",
    );
    async function nativeMessage(target, payload) {
      await target.evaluate(
        (frame) => window.fixtureSocket.deliver(frame),
        payload,
      );
    }
    async function outgoing(target, index) {
      await target.waitForFunction(
        (count) => window.sentFrames.length >= count,
        index + 1,
      );
      return decodeWireValue(
        await target.evaluate((i) => window.sentFrames[i], index),
      );
    }
    async function ack(target, id) {
      await nativeMessage(target, {
        type: "return",
        id,
        value: undefined,
      });
    }
    async function currentLifecycle(target, after = -1) {
      await target.waitForFunction((previous) => {
        const current = window.lifecycleFrames.at(-1);
        return current?.acknowledged === true && current.sequence > previous;
      }, after);
      return target.evaluate(() => window.lifecycleFrames.at(-1));
    }
    const open = (requestId, epoch) => ({
      type: "kanban-project-folder-open",
      requestId,
      epoch,
      allowMultiple: false,
      roots: ["/tmp/home", "/work"],
    });
    assert.equal((await currentLifecycle(top)).epoch, null);
    const staleEpoch = "88888888-8888-4888-8888-888888888888";
    const topRequest = "44444444-4444-4444-8444-444444444444";
    await nativeMessage(top, {
      type: "viewMessage",
      data: open(topRequest, staleEpoch),
    });
    assert.equal(await top.locator("[data-project-folder-picker]").count(), 0);
    const inactiveCancel = await outgoing(top, 0);
    assert.equal(inactiveCancel.method, "sendMessageFromView");
    assert.deepEqual(inactiveCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: topRequest,
        epoch: staleEpoch,
        action: "cancel",
      },
    ]);
    await ack(top, inactiveCancel.id);

    const firstRequest = "55555555-5555-4555-8555-555555555555";
    const firstLifecycle = await currentLifecycle(frame);
    const firstEpoch = firstLifecycle.epoch;
    assert.match(firstEpoch, /^[a-f0-9-]{36}$/);
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(firstRequest, firstEpoch),
    });
    await frame
      .getByRole("textbox", { name: "文件夹路径" })
      .fill("/work/example");
    await frame.getByRole("button", { name: "选择", exact: true }).click();
    const selected = await outgoing(frame, 0);
    assert.equal(selected.method, "sendMessageFromView");
    assert.deepEqual(selected.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: firstRequest,
        epoch: firstEpoch,
        action: "select",
        paths: ["/work/example"],
      },
    ]);
    await ack(frame, selected.id);
    await nativeMessage(frame, {
      type: "viewMessage",
      data: {
        type: "kanban-project-folder-done",
        requestId: firstRequest,
        epoch: firstEpoch,
      },
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );

    const hiddenRequest = "66666666-6666-4666-8666-666666666666";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(hiddenRequest, firstEpoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      1,
    );
    await page.evaluate(() => window.fixture.host.confirmActive(false));
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    const hiddenCancel = await outgoing(frame, 1);
    assert.deepEqual(hiddenCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: hiddenRequest,
        epoch: firstEpoch,
        action: "cancel",
      },
    ]);
    await ack(frame, hiddenCancel.id);
    const hiddenLifecycle = await currentLifecycle(
      frame,
      firstLifecycle.sequence,
    );
    assert.equal(hiddenLifecycle.epoch, null);
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(hiddenRequest, firstEpoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    assert.equal(await frame.evaluate(() => window.sentFrames.length), 2);
    await page.evaluate(() => window.fixture.host.confirmActive(true));
    const nextEpoch = (await currentLifecycle(frame, hiddenLifecycle.sequence))
      .epoch;
    assert.match(nextEpoch, /^[a-f0-9-]{36}$/);
    assert.notEqual(nextEpoch, firstEpoch);
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(hiddenRequest, firstEpoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    const firstLateRequest = "99999999-9999-4999-8999-999999999999";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(firstLateRequest, firstEpoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    const lateCancel = await outgoing(frame, 2);
    assert.deepEqual(lateCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: firstLateRequest,
        epoch: firstEpoch,
        action: "cancel",
      },
    ]);
    await ack(frame, lateCancel.id);
    const newRequest = "77777777-7777-4777-8777-777777777777";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(newRequest, nextEpoch),
    });
    await nativeMessage(frame, {
      type: "viewMessage",
      data: {
        type: "kanban-project-folder-done",
        requestId: hiddenRequest,
        epoch: firstEpoch,
      },
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      1,
    );
    await frame.getByRole("button", { name: "取消", exact: true }).click();
    const freshCancel = await outgoing(frame, 3);
    assert.deepEqual(freshCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: newRequest,
        epoch: nextEpoch,
        action: "cancel",
      },
    ]);
    await ack(frame, freshCancel.id);
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );

    await frame.evaluate(() => {
      window.holdLifecycleAcks = true;
    });
    await page.evaluate(() => {
      window.fixture.host.confirmActive(false);
      window.fixture.host.confirmActive(true);
    });
    await frame.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 0)),
    );
    assert.ok(
      (await frame.evaluate(() => window.pendingLifecycleAcks.length)) >= 2,
    );
    const unconfirmed = await frame.evaluate(() =>
      window.lifecycleFrames.at(-1),
    );
    assert.match(unconfirmed.epoch, /^[a-f0-9-]{36}$/);
    const earlyRequest = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(earlyRequest, unconfirmed.epoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    const earlyCancel = await outgoing(frame, 4);
    assert.deepEqual(earlyCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: earlyRequest,
        epoch: unconfirmed.epoch,
        action: "cancel",
      },
    ]);
    await ack(frame, earlyCancel.id);
    await frame.evaluate(() => {
      while (window.pendingLifecycleAcks.length > 1)
        window.pendingLifecycleAcks.shift()();
    });
    const beforeLatestAck = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(beforeLatestAck, unconfirmed.epoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      0,
    );
    const beforeLatestCancel = await outgoing(frame, 5);
    assert.deepEqual(beforeLatestCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: beforeLatestAck,
        epoch: unconfirmed.epoch,
        action: "cancel",
      },
    ]);
    await ack(frame, beforeLatestCancel.id);
    await frame.evaluate(() => {
      window.holdLifecycleAcks = false;
      window.pendingLifecycleAcks.shift()();
    });
    assert.equal(
      (await currentLifecycle(frame, hiddenLifecycle.sequence)).sequence,
      unconfirmed.sequence,
    );
    const readyRequest = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await nativeMessage(frame, {
      type: "viewMessage",
      data: open(readyRequest, unconfirmed.epoch),
    });
    assert.equal(
      await frame.locator("[data-project-folder-picker]").count(),
      1,
    );
    await frame.getByRole("button", { name: "取消", exact: true }).click();
    const readyCancel = await outgoing(frame, 6);
    assert.deepEqual(readyCancel.args, [
      {
        type: "kanban-project-folder-reply",
        requestId: readyRequest,
        epoch: unconfirmed.epoch,
        action: "cancel",
      },
    ]);
    await ack(frame, readyCancel.id);
    assert.deepEqual(errors, []);
    assert.deepEqual(topErrors, []);
  },
);
