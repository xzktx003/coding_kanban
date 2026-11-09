import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";

const enabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";
const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;

test("home composer remains usable in the default single-pane registry", {
  skip: !(enabled && archivePath) && "Requires pinned archive and isolated browser",
}, async (t) => {
  const archive = await openWebviewArchive({
    asarPath: archivePath,
    sha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  });
  const originals = new Map();
  try {
    for (const [name, sha] of [
      ["app-initial-18b189e867e7.js", "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032"],
      ["app-shared-601019a330d7.js", "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116"],
      ["rolldown-runtime-428824ca0286.js", "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e"],
    ]) {
      const resource = await archive.acquireAsset("webview/assets/" + name);
      try {
        assert.equal(createHash("sha256").update(resource.body).digest("hex"), sha);
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
    "browser-composer-capability-entry.mjs", "browser-composer-capability.mjs",
    "desktop-layout-browser.mjs", "desktop-layout-core.mjs", "desktop-pane-layout.mjs",
    "desktop-selected-pane-core.mjs", "desktop-selected-pane-browser.mjs",
    "desktop-home-registrar.mjs", "wire-value.mjs",
  ]) modules.set(name, await readFile(new URL("../src/" + name, import.meta.url)));

  const { chromium } = await import("../../../node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><div id="editor"></div><script>Object.defineProperty(window,'__chatgptDesktopLayoutEnabled',{value:true})</script><script type="module">
import * as shared from '/assets/app-shared-601019a330d7.js';
import * as original from '/assets/app-initial-18b189e867e7.js';
import {desktopSelectedPaneRegistry as registry} from '/__host/desktop-selected-pane-browser.mjs';
import {initializeComposerCapability,OriginalComposerRegistrar} from '/__host/browser-composer-capability-entry.mjs';
const React=shared.pWt(),ReactDOM=shared.GFt();original.Oc();
const token=Object.freeze({}),mode={getSnapshot:()=>token,isCurrent:x=>x===token,subscribe:()=>()=>{}};
const scope={profileId:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',viewId:'33333333-3333-4333-8333-333333333333'};
const capability=await initializeComposerCapability({window,scope,modeActivation:mode});
const controller=original.Cc(null,{enableCodeBlocks:true,enableRichText:true,enableSelectedTextLinks:true});document.getElementById('editor').append(controller.view.dom);
const root=ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(original.ZUn.Provider,{value:controller},React.createElement(OriginalComposerRegistrar,{homeScope:{hostId:'local',conversationId:null,clientThreadId:'home-client',isMain:true}})));
await new Promise(resolve=>setTimeout(resolve,200));
window.fixture={capability,controller,registry,root};window.fixtureReady=true;
</script>`;
  await context.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname, name = path.split("/").at(-1);
    if (originals.has(name)) return route.fulfill({ status: 200, contentType: "text/javascript", body: originals.get(name) });
    if (path.startsWith("/__host/") && modules.has(name)) return route.fulfill({ status: 200, contentType: "text/javascript", body: modules.get(name) });
    if (path === "/fixture") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:18080/fixture");
  await page.waitForFunction(() => window.fixtureReady === true, null, { timeout: 10000 });
  const result = await page.evaluate(() => {
    const { capability, controller, registry } = window.fixture;
    const selected = registry.getSnapshot(), token = capability.captureScope();
    return {
      selectedHome: selected !== null && capability.isScopeCurrent(token),
      homeToken: token !== null,
      sameEditor: capability.getCommittedEditor()?.controller === controller,
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(result, { selectedHome: true, homeToken: true, sameEditor: true });
});
