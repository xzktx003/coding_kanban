import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { openWebviewArchive } from "../src/assets.mjs";

const archivePath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const enabled = process.env.CHATGPT_COMPOSER_CAPABILITY_BROWSER === "1";

test("split controls receive real pointer events above the original header", {
  skip: !(enabled && archivePath) && "Requires pinned archive and isolated browser",
}, async (t) => {
  const archive = await openWebviewArchive({
    asarPath: archivePath,
    sha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  });
  const assets = new Map();
  try {
    for (const [name, sha] of [
      ["app-shared-601019a330d7.js", "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116"],
      ["rolldown-runtime-428824ca0286.js", "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e"],
    ]) {
      const resource = await archive.acquireAsset("webview/assets/" + name);
      try {
        assert.equal(createHash("sha256").update(resource.body).digest("hex"), sha);
        assets.set(name, Buffer.from(resource.body));
      } finally {
        resource.release();
      }
    }
  } finally {
    await archive.close();
  }
  const modules = new Map();
  for (const name of ["desktop-split-pane-core.mjs", "desktop-layout-core.mjs", "desktop-pane-layout.mjs", "wire-value.mjs"]) {
    modules.set(name, await readFile(new URL("../src/" + name, import.meta.url)));
  }
  const { chromium } = await import("../../../node_modules/playwright/index.mjs");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: "block" });
  t.after(() => context.close());
  const html = `<!doctype html><meta charset="utf-8"><style>html,body,#root{width:100%;height:100%;margin:0}</style><div id="root"></div><script type="module">
import * as shared from '/assets/app-shared-601019a330d7.js';
import {createDesktopLayoutRuntime} from '/__host/desktop-layout-core.mjs';
import {createDesktopSplitPaneRuntime} from '/__host/desktop-split-pane-core.mjs';
const React=shared.pWt(),jsx=shared.JFt(),ReactDOM=shared.GFt();
const layout=createDesktopLayoutRuntime({React,jsx,enabled:true});
const a={hostId:'local',conversationId:'thread-a',clientThreadId:'client-a'};
const b={hostId:'local',conversationId:'thread-b',clientThreadId:'client-b'};
const native=scope=>({thread:{clientThreadId:scope.clientThreadId},route:{pathname:'/local/'+scope.conversationId,search:'',routeKind:'local-thread',hostId:scope.hostId,conversationId:scope.conversationId},composer:{clientThreadId:scope.clientThreadId,conversationId:scope.conversationId}});
const runtime=createDesktopSplitPaneRuntime({React,jsx,enabled:true,layoutRuntime:layout,useNativeContext:native,useNavigationContext:()=>({pathname:'/local/thread-a',search:'',marker:null}),activateTarget:()=>true,renderProviders:(_context,children)=>children,PassiveTranscript:()=>null});
function GI(props){return props.renderLayout({content:jsx.jsx('div',{children:'Transcript'}),footer:jsx.jsx('textarea',{'aria-label':'composer'})})}
ReactDOM.createRoot(document.getElementById('root')).render(jsx.jsx(runtime.DesktopSplitPaneBoundary,{component:GI,originalProps:{showComposer:true},nativeScope:a}));
window.fixture={runtime,a,b,native};window.fixtureReady=true;
</script>`;
  await context.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname, name = path.split("/").at(-1);
    if (assets.has(name)) return route.fulfill({ status: 200, contentType: "text/javascript", body: assets.get(name) });
    if (path.startsWith("/__host/") && modules.has(name)) return route.fulfill({ status: 200, contentType: "text/javascript", body: modules.get(name) });
    if (path === "/fixture") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.abort();
  });
  for (const multiple of [false, true]) {
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:18080/fixture");
    await page.waitForFunction(() => window.fixtureReady === true && window.fixture.runtime.registry.getSnapshot().selected !== null);
    if (multiple) {
      await page.evaluate(() => {
        const {runtime,a,b,native}=window.fixture;
        const first=runtime.registry.getSnapshot().selected.tabKey;
        runtime.registry.remember(b,native(b));
        runtime.registry.focus(first);
      });
      await page.waitForFunction(() => window.fixture.runtime.registry.getSnapshot().layout.tree.keys.length === 2);
    }
    const group = page.locator("[data-desktop-split-group]");
    await group.hover();
    const button = page.getByRole("button", { name: "向右拆分" });
    await button.waitFor({ state: "visible" });
    await button.evaluate(element => {
      const rect=element.getBoundingClientRect(),header=document.createElement('header');
      header.id='native-header';header.style.cssText=`position:fixed;z-index:40;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      document.body.append(header);
    });
    const receivesPointer = await button.evaluate(element => {
      const rect=element.getBoundingClientRect(), hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      return hit===element || element.contains(hit);
    });
    assert.equal(receivesPointer, true, `split button hit target with ${multiple ? "multiple" : "one"} tabs`);
    await button.click({ timeout: 2000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-desktop-split-group]').length === 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
