import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createSharedThreadNavigationAssetAdapter } from "../../src/shared-thread-navigation-assets.mjs";
import { openWebviewArchive } from "../../src/assets.mjs";

const originalHashes = Object.freeze({
  "app-shared-601019a330d7.js":
    "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
  "rolldown-runtime-428824ca0286.js":
    "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
  "pending-request-item-panel-cef204561ca3.js":
    "2a3129cf4465d9d024e07f7d83b7d0c6a6e0cec913babcb68efb523d5434dbd1",
  "composer-approval-request-card-d675d8437483.js":
    "5bc377b6b150b89e381bda58eaf7bdf82fff4a3c034eadfb90207bf2867ac959",
  "auto-review-approval-nudge-state-f22d731ec445.js":
    "2e89e0ef739edaddb257ce1c58c49e1054bad895e033ecbab063aa728ebc202a",
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fail = () =>
  Object.assign(
    new Error("Approval browser fixture requires an isolated container"),
    { code: "APPROVAL_GUI_ISOLATION_REQUIRED" },
  );
// Isolated Chromium renders the actual pinned original React approval card and
// exact pending-item callbacks. Desktop bootstrap, lifecycle ACK and the
// renderer transport are fixture stubs; the supplied submit callback is the
// actual private native/authority/daemon chain. Never use a real user daemon.
export async function runOriginalApprovalBrowser({
  scope,
  approval,
  epoch,
  sender,
  nativeRouter,
  viewMessages,
  beforeClick,
} = {}) {
  if (process.env.CHATGPT_APPROVAL_GUI_ISOLATED !== "1") throw fail();
  try {
    await access("/.dockerenv");
    const status = await readFile("/proc/self/status", "utf8");
    const routes = await readFile("/proc/net/route", "utf8");
    if (
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      !/^Seccomp:\s+2$/m.test(status) ||
      routes.trim().split("\n").length !== 1
    )
      throw fail();
  } catch {
    throw fail();
  }
  const assetDir = process.env.CHATGPT_APPROVAL_GUI_ASSET_DIR;
  const executablePath = process.env.CHATGPT_APPROVAL_GUI_CHROMIUM;
  const asarPath = process.env.CHATGPT_APPROVAL_GUI_MAC_ASAR;
  if (
    !assetDir ||
    !executablePath ||
    !asarPath ||
    !scope ||
    !approval ||
    !epoch ||
    !sender ||
    !nativeRouter ||
    !Array.isArray(viewMessages)
  )
    throw fail();
  const originals = new Map();
  for (const [name, expected] of Object.entries(originalHashes)) {
    const bytes = await readFile(join(assetDir, name));
    assert.equal(sha(bytes), expected, `unexpected pinned original ${name}`);
    originals.set(name, bytes);
  }
  const pendingName = "pending-request-item-panel-cef204561ca3.js";
  const adapter = createSharedThreadNavigationAssetAdapter({
    archiveSha256:
      "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  });
  const pending = adapter.adapt({
    member: `webview/assets/${pendingName}`,
    body: originals.get(pendingName),
  }).body;
  originals.set(pendingName, pending);
  const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module">
import * as shared from '/assets/app-shared-601019a330d7.js';
import * as originalPanel from '/assets/pending-request-item-panel-cef204561ca3.js';
import * as initial from '/assets/app-initial-18b189e867e7.js';
import {createBrowserSharedThreadNavigation} from '/host/browser-shared-thread-navigation.mjs';
const scope=${JSON.stringify(scope)}, epoch=${JSON.stringify(epoch)}, approval=${JSON.stringify(approval)};
const React=shared.pWt(), ReactDOM=shared.GFt();shared.ZTt();shared.bjt();shared.blt();shared.GV();initial.Gcr({},()=>{});
const queryClient=new shared.XTt({defaultOptions:{queries:{enabled:false,retry:false}}});
const token={},subs=new Set(),lease={getSnapshot:()=>token,isCurrent:x=>x===token,subscribe(fn){subs.add(fn);return()=>subs.delete(fn)}};
let first=true;const wrapWindow={document,crypto:{randomUUID:()=>first?(first=false,epoch):crypto.randomUUID()},addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};
const sendMessage=frame=>{
 if(frame.type==='kanban-shared-connect-lifecycle') { if(frame.sequence!==1||frame.epoch!==epoch)throw Error('unexpected fixture lifecycle');queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'kanban-shared-connect-lifecycle-ack',sequence:frame.sequence,epoch:frame.epoch}})));return; }
 if(frame.type==='kanban-shared-approval-intent') return fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(frame)}).then(async response=>{if(!response.ok)throw Error('fixture transport failed');const message=await response.json();window.receipts.push(message);window.dispatchEvent(new MessageEvent('message',{data:message}));});
 throw Error('unexpected fixture frame');
};
const nav=createBrowserSharedThreadNavigation({window:wrapWindow,documentScope:scope,scopeLease:lease,sendMessage,timeoutMs:15000},{createProbe:()=>({dispose(){}}),createRoot:()=>({active:true,restored:true,value:null})});
Object.defineProperty(globalThis,'__kanbanSharedThreadNavigation',{value:nav});await nav.ready();
const S=approval.id,r=approval.threadId,i=approval.hostId;
window.receipts=[];window.trustedClicks=[];document.addEventListener('click',event=>{if(event.target.closest('button'))window.trustedClicks.push(event.isTrusted)},true);
window.wrong=()=>{const x=nav.beginApproval({hostId:i,threadId:r,requestId:S,itemId:'wrong-item'});return x.send(S,'decline').then(()=>false,()=>true)};
let tree=React.createElement(originalPanel.PendingRequestItemPanel,{conversationId:r,hostId:i,cwd:approval.cwd,pendingRequest:{type:'approval',item:{type:'exec',callId:approval.itemId,approvalRequestId:S,cmd:[approval.command],cwd:approval.cwd,output:null}}});
tree=React.createElement(shared.fTt,{scope:shared.klt,value:{}},tree);tree=React.createElement(shared.WV.Provider,{value:shared.VV()},tree);tree=React.createElement(shared.mTt,{queryClient},tree);tree=React.createElement(shared.ylt,{client:queryClient},tree);tree=React.createElement(shared.yjt,{locale:'en',messages:{}},tree);
ReactDOM.createRoot(document.getElementById('root')).render(tree);window.fixtureReady=true;
</script>`;
  const hostModules = new Map();
  for (const name of [
    "browser-shared-thread-navigation.mjs",
    "browser-sidebar-navigation-probe.mjs",
    "browser-react-root-probe.mjs",
  ])
    hostModules.set(
      name,
      await readFile(new URL(`../../src/${name}`, import.meta.url)),
    );
  const archive = await openWebviewArchive({
    asarPath,
    sha256: "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
  });
  let submitted, serverError;
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://fixture.invalid").pathname;
      if (request.method === "GET" && path === "/")
        return response
          .writeHead(200, { "content-type": "text/html" })
          .end(html);
      if (request.method === "GET" && path.startsWith("/assets/")) {
        const bytes = originals.get(path.slice(8));
        if (bytes)
          return response
            .writeHead(200, { "content-type": "text/javascript" })
            .end(bytes);
        const asset = await archive.acquireAsset(`webview${path}`);
        let released = false;
        const release = () => {
          if (!released) {
            released = true;
            asset.release();
          }
        };
        response.once("close", release);
        return response
          .writeHead(200, {
            "content-type": path.endsWith(".css")
              ? "text/css"
              : "text/javascript",
          })
          .end(asset.body, release);
      }
      if (request.method === "GET" && path.startsWith("/host/")) {
        const bytes = hostModules.get(path.slice(6));
        if (bytes)
          return response
            .writeHead(200, { "content-type": "text/javascript" })
            .end(bytes);
      }
      if (request.method === "POST" && path === "/submit") {
        let size = 0;
        const parts = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 65536) throw Error("oversized fixture");
          parts.push(chunk);
        }
        const frame = JSON.parse(Buffer.concat(parts).toString());
        const state = await nativeRouter.approvalIntent(sender, frame);
        const reply = viewMessages.findLast(
          (x) =>
            x.type === "kanban-shared-approval-result" &&
            x.actionId === frame.actionId,
        );
        assert.ok(reply);
        assert.equal(reply.state, state.state);
        if (frame.itemId === approval.itemId) {
          assert.equal(submitted, undefined);
          submitted = frame;
        }
        return response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(reply));
      }
      return response.writeHead(404).end();
    } catch (error) {
      serverError = error;
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.fixtureReady === true, {
      timeout: 10000,
    });
    assert.equal(
      await page.evaluate(() => window.wrong()),
      true,
      "wrong item must be denied",
    );
    if (beforeClick) await beforeClick();
    await page.getByRole("button", { name: /^Deny/ }).click();
    await page.waitForFunction(
      () => window.receipts.some((x) => x.state === "resolved"),
      null,
      {
        timeout: 15000,
      },
    );
    assert.deepEqual(await page.evaluate(() => window.trustedClicks), [true]);
    assert.deepEqual(
      await page.evaluate(() => window.receipts.map((x) => x.state)),
      ["denied", "resolved"],
    );
    assert.ok(submitted);
    assert.equal(serverError, undefined);
    assert.deepEqual(pageErrors, []);
    await context.close();
    return Object.freeze({
      action: submitted,
      originalApprovalPanel: true,
      originalPendingCallbacks: true,
      trustedClick: true,
      syntheticLifecycleAndHostTransport: true,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    await archive.close();
  }
}
