import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { openWebviewArchive } from "../src/assets.mjs";

const asarPath = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const endpoint = process.env.CHATGPT_DESKTOP_TEST_BROWSER_CDP_WS;

test("v4 Git summary actions accept real mouse, touch and keyboard without hover", {
  skip: !(asarPath && endpoint) && "Requires pinned archive and isolated browser",
}, async (t) => {
  const archive = await openWebviewArchive({
    asarPath,
    sha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  });
  const assets = new Map();
  try {
    for (const [member, expected] of [
      ["app-shared-601019a330d7.js", "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116"],
      ["rolldown-runtime-428824ca0286.js", "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e"],
      ["fd9b7fd80db1.css", "8cceab6badac2458d888405f0d0cbdd1b40bfefb2ba33eb74f577b4158c9d3b3"],
    ]) {
      const resource = await archive.acquireAsset("webview/assets/" + member);
      try {
        assert.equal(createHash("sha256").update(resource.body).digest("hex"), expected);
        assets.set(member, Buffer.from(resource.body));
      } finally { resource.release(); }
    }
  } finally { await archive.close(); }
  const modules = new Map();
  for (const name of ["desktop-split-pane-core.mjs", "desktop-layout-core.mjs", "desktop-pane-layout.mjs", "wire-value.mjs"])
    modules.set(name, await readFile(new URL("../src/" + name, import.meta.url)));
  const { chromium } = await import("../../../node_modules/playwright/index.mjs");
  const browser = await chromium.connectOverCDP(endpoint);
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, hasTouch: true, serviceWorkers: "block" });
  t.after(() => context.close());
  // Pinned original summary slots/classes, including the hover-gated action
  // overlay and the separate change counters. This is a CSS/event fixture;
  // real original-menu/native acceptance is recorded separately.
  const row = (id, disabled = false) => `<div id="${id}" data-slot="thread-summary-panel-item" class="group group/summary-panel-item relative isolate flex w-full items-center gap-2">
<button data-slot="thread-summary-panel-item-trigger" class="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-start after:absolute after:inset-0"><span class="flex-1">Changes</span><span data-counts>+2 -2</span></button>
<span data-slot="thread-summary-panel-item-actions" class="flex h-5 shrink-0 items-center absolute inset-y-0 end-0 my-auto pointer-events-none opacity-0 group-focus-within/summary-panel-item:pointer-events-auto group-focus-within/summary-panel-item:opacity-100 group-hover/summary-panel-item:pointer-events-auto group-hover/summary-panel-item:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto has-[[aria-expanded=true]]:opacity-100"><button aria-label="Git actions" ${disabled ? "disabled" : ""} class="relative flex size-6 items-center justify-center" aria-expanded="false">Git</button></span></div>`;
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/fd9b7fd80db1.css"><style>html,body{margin:0;height:100%}main{display:flex;height:80%;width:100%}#root{flex:1;min-width:0}#summary,#outside{width:280px;margin:20px}[data-slot=thread-summary-panel-item]{min-height:36px}</style>
<main data-codex-history-swipe-page="true"><div id="root"></div><section id="summary">${row("inside")}${row("disabled", true)}</section></main><section id="outside">${row("outside-row")}</section>
<script type="module">
import * as shared from '/assets/app-shared-601019a330d7.js';
import {createDesktopLayoutRuntime} from '/__host/desktop-layout-core.mjs';
import {createDesktopSplitPaneRuntime} from '/__host/desktop-split-pane-core.mjs';
const React=shared.pWt(),jsx=shared.JFt(),ReactDOM=shared.GFt(),a={hostId:'local',conversationId:'fixture',clientThreadId:'fixture-client'};
const native=()=>({thread:{clientThreadId:a.clientThreadId},route:{pathname:'/local/fixture',search:'',routeKind:'local-thread',hostId:'local',conversationId:'fixture'},composer:{clientThreadId:a.clientThreadId,conversationId:'fixture'}});
const layout=createDesktopLayoutRuntime({React,jsx,enabled:true});
const runtime=createDesktopSplitPaneRuntime({React,jsx,enabled:true,layoutRuntime:layout,useNativeContext:native,useNavigationContext:()=>({pathname:'/local/fixture',search:'',marker:null}),activateTarget:()=>true,renderProviders:(_context,children)=>children,PassiveTranscript:()=>null});
function GI(props){return props.renderLayout({content:jsx.jsx('div',{children:'Transcript'}),footer:jsx.jsx('textarea',{'aria-label':'composer'})})}
ReactDOM.createRoot(document.getElementById('root')).render(jsx.jsx(runtime.DesktopSplitPaneBoundary,{component:GI,originalProps:{showComposer:true},nativeScope:a}));
window.accepted=[];document.querySelector('#inside button[aria-label="Git actions"]').addEventListener('click',e=>{window.accepted.push({trusted:e.isTrusted,pointerType:e.pointerType});e.currentTarget.setAttribute('aria-expanded','true');document.getElementById('menu')?.remove();const menu=document.createElement('div');menu.id='menu';menu.setAttribute('role','menu');menu.textContent='Commit';document.querySelector('#summary').append(menu);});
window.fixtureReady=true;
</script>`;
  await context.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname, name = path.split("/").at(-1);
    if (assets.has(name)) return route.fulfill({ status: 200, contentType: name.endsWith(".css") ? "text/css" : "text/javascript", body: assets.get(name) });
    if (path.startsWith("/__host/") && modules.has(name)) return route.fulfill({ status: 200, contentType: "text/javascript", body: modules.get(name) });
    if (path === "/fixture") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:18080/fixture");
  await page.waitForFunction(() => window.fixtureReady && document.querySelector('[data-desktop-split-group]'));
  assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#outside [data-slot="thread-summary-panel-item-actions"]')).opacity), "0", "scope must not change other original surfaces");
  const button = page.locator('#inside button[aria-label="Git actions"]');
  await button.click({ timeout: 2000 });
  await page.getByRole("menu", { name: "" }).waitFor({ state: "visible" });
  await button.tap({ timeout: 2000 });
  await button.press("Enter");
  const result = await page.evaluate(() => {
    const button = document.querySelector('#inside button[aria-label="Git actions"]'), rect = button.getBoundingClientRect(), counts = document.querySelector('#inside [data-counts]').getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
    return { accepted: window.accepted, hit: hit === button || button.contains(hit), noOverlap: counts.right <= rect.left, counts: document.querySelector('#inside [data-counts]').textContent };
  });
  assert.deepEqual(result.accepted.map(x => x.trusted), [true, true, true]);
  assert.equal(result.accepted[0].pointerType, "mouse");
  assert.equal(result.accepted[1].pointerType, "touch");
  assert.equal(result.hit, true);
  assert.equal(result.noOverlap, true);
  assert.equal(result.counts, "+2 -2");
  const disabled = page.locator('#disabled button[aria-label="Git actions"]');
  assert.equal(await disabled.isEnabled(), false);
  await assert.rejects(disabled.click({ timeout: 250 }), /not enabled|Timeout/);
  assert.equal(await page.evaluate(() => window.accepted.length), 3);
  assert.deepEqual(errors, []);
});
