// Run only inside an explicitly owned, network-none test container. This is a
// real Chromium event test with original React DOM, an extracted original
// provider/row callback and a synthetic app. It is not a full native GUI,
// daemon, login, or authorization test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const originalHash =
  "3212418ea362dbd6ca22a4f02319511dbeee19a3482ae45f40923d9a9ce856eb";
const originalPath = "/fixture/initialize-app-host-services.js";
const probePath =
  "/work/packages/chatgpt-desktop-host/src/browser-sidebar-navigation-probe.mjs";
const rootProbePath =
  "/work/packages/chatgpt-desktop-host/src/browser-react-root-probe.mjs";
const digest = (input) => createHash("sha256").update(input).digest("hex");
const original = await readFile(originalPath);
const probe = await readFile(probePath);
const rootProbe = await readFile(rootProbePath);
const shared = await readFile("/fixture/app-shared.js");
const runtime = await readFile("/fixture/rolldown-runtime.js");
const initial = await readFile("/fixture/app-initial.js");
const appMain = await readFile("/fixture/app-main.js");
assert.equal(digest(original), originalHash);
assert.equal(
  digest(shared),
  "02dd01d1e7c076ec44f10bb8446976f07be9eb007d1c32445adf5cda13221116",
);
assert.equal(
  digest(runtime),
  "f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e",
);
assert.equal(
  digest(initial),
  "244653d55e434b27618a848bef14d6d6781569bf58e8656cf644445113ffc032",
);
assert.equal(
  digest(appMain),
  "3e108c15c5e59d4b07884ddaa016cd11d4ab375f2f3f4a562b554b34e75aefa7",
);
assert.ok(appMain.length < 512 * 1024);
assert.ok(original.length < 512 * 1024);
const source = original.toString("utf8");
const start = source.indexOf("function R_(){");
const end = source.indexOf("function z_(", start);
assert.ok(start >= 0 && end > start);
const providerSource = source.slice(start, end);
const originalMarker = "navigateToLocalConversation:_";
assert.equal(providerSource.split(originalMarker).length, 2);
const instrumentedProvider = providerSource.replace(
  originalMarker,
  "navigateToLocalConversation:probe.wrapNavigation(_)",
);
const initialText = initial.toString("utf8"),
  rowStart = initialText.indexOf("function xja("),
  rowEnd = initialText.indexOf("function ", rowStart + 12);
assert.ok(rowStart >= 0 && rowEnd > rowStart);
const originalRow = initialText.slice(rowStart, rowEnd);
const rootCall = "(0,u.createRoot)(d)";
assert.equal(appMain.toString("utf8").split(rootCall).length, 2);

const html = `<!doctype html><meta charset="utf-8">
<div id="root"></div>
<script type="module">
import { createBrowserSidebarNavigationProbe, SIDEBAR_ATTEMPT_STATE_KEY } from '/probe.mjs';
import { createRootWithDelegateProbe } from '/root-probe.mjs';
import { GFt } from '/assets/app-shared-601019a330d7.js';
const scope={profileId:crypto.randomUUID(),generation:crypto.randomUUID(),viewId:crypto.randomUUID()};
const token={},subscribers=new Set(),scopeLease={getSnapshot:()=>token,isCurrent:t=>t===token,
 subscribe(f){subscribers.add(f);return ()=>subscribers.delete(f)}};
const threadId=crypto.randomUUID(), hostId='real-provider-host', events=[], calls=[], traces=[];
const probe=createBrowserSidebarNavigationProbe({window,documentScope:scope,scopeLease,onAttempt:x=>events.push(x)});
const navKey={},otherKey={},store={set(k,v){if(k===navKey)window.provider=v},get(){return {cancel(){}}}};
const react={useRef:()=>({current:undefined}),useLayoutEffect:f=>f()};
const hooks={c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))};
const underlying=(...args)=>{calls.push(args)};
const build=new Function('H_','Y','J','ge','Ln','wt','Oo','U_','x','V_','zp','Jd','z_','$c','probe',
 'return ('+${JSON.stringify(instrumentedProvider)}+')');
const install=build(hooks,()=>store,{},()=>({pathname:'/',search:'',hash:'',state:null}),()=> '/',
 ()=>()=>{},()=>underlying,react,x=>x,()=>true,{},otherKey,()=>{},navKey,probe);
install();
let delayed=false,omitHost=false;
function navigate(e){traces.push({type:e?.type,phase:e?.eventPhase,trusted:e?.isTrusted,defaultPrevented:e?.defaultPrevented,target:e?.target?.id,currentWindowEvent:window.event===e});queueMicrotask(()=>traces.push({microtask:true,phase:e?.eventPhase,currentWindowEvent:window.event===e}));const call=()=>window.provider.navigateToLocalConversation(threadId,omitHost?undefined:hostId,{state:{original:'kept'}});if(delayed)queueMicrotask(call);else call();}
const originalRow=new Function('return ('+${JSON.stringify(originalRow)}+')')();
const behavior=originalRow({onSelect:e=>navigate(e.nativeEvent)});
const elem=(type,props)=>({$$typeof:Symbol.for('react.transitional.element'),type,key:null,props,_owner:null});
const root=document.getElementById('root'), originalAdd=root.addEventListener;
const executeOriginalCall=new Function('u','d','capture','return capture((0,u.createRoot),d)');
const setup=executeOriginalCall(GFt(),root,(createRoot,root)=>createRootWithDelegateProbe({window,root,probe,createRoot}));
setup.value.render(elem('div',{children:[elem('div',{id:'row',role:'button',tabIndex:0,
 'data-app-action-sidebar-thread-row':'','data-app-action-sidebar-thread-kind':'local',
 'data-app-action-sidebar-thread-id':'00000000-0000-0000-0000-000000000000','data-app-action-sidebar-thread-host-id':'forged-dom-host',
 onClick:e=>{if(!e.target.closest('button'))behavior.onClick(e)},onKeyDown:behavior.onKeyDown,
 children:[elem('span',{id:'label',children:'Local thread'}),elem('button',{id:'nested',onClick:e=>navigate(e.nativeEvent),children:'Other action'})]}),
 elem('button',{id:'outside',onClick:e=>navigate(e.nativeEvent),children:'Outside'})]}));
window.fixture={scope,threadId,hostId,events,calls,traces,rootHookActive:setup.active,
 rootRestored:!Object.hasOwn(root,'addEventListener')&&root.addEventListener===originalAdd,attemptKey:SIDEBAR_ATTEMPT_STATE_KEY,
 reset(){events.length=0;calls.length=0;traces.length=0;delayed=false;omitHost=false},setDelayed(v){delayed=v},setOmitHost(v){omitHost=v},
 consume(state){return probe.consumeAttempt({state,threadId,hostId})},
 notify(){for(const f of subscribers)f()},dispose(){probe.dispose()},
 remount(){setup.value.unmount();const nextProbe=createBrowserSidebarNavigationProbe({window,documentScope:{profileId:crypto.randomUUID(),generation:crypto.randomUUID(),viewId:crypto.randomUUID()},scopeLease,onAttempt:()=>{}});
 const next=createRootWithDelegateProbe({window,root,probe:nextProbe,createRoot:GFt().createRoot});const result={active:next.active,restored:next.restored};next.value.unmount();nextProbe.dispose();return result}};
</script>`;

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/") {
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(html);
    return;
  }
  if (request.url === "/probe.mjs") {
    response
      .writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(probe);
    return;
  }
  if (request.url === "/root-probe.mjs") {
    response
      .writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(rootProbe);
    return;
  }
  if (request.url === "/assets/app-shared-601019a330d7.js") {
    response
      .writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(shared);
    return;
  }
  if (request.url === "/assets/rolldown-runtime-428824ca0286.js") {
    response
      .writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      })
      .end(runtime);
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve, reject) =>
  server.listen(0, "0.0.0.0", resolve).once("error", reject),
);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/playwright/chrome-headless-shell-linux64/chrome-headless-shell",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
    ],
  });
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {
    waitUntil: "load",
  });
  await page.waitForFunction(() => Boolean(window.fixture));
  assert.deepEqual(
    await page.evaluate(() => ({
      active: fixture.rootHookActive,
      restored: fixture.rootRestored,
    })),
    { active: true, restored: true },
  );
  await page.locator("#label").waitFor();
  const snapshot = () =>
    page.evaluate(() => ({
      events: window.fixture.events,
      calls: window.fixture.calls,
      traces: window.fixture.traces,
      scope: window.fixture.scope,
      threadId: window.fixture.threadId,
      hostId: window.fixture.hostId,
      key: window.fixture.attemptKey,
    }));
  const reset = () => page.evaluate(() => window.fixture.reset());
  async function accepted(label) {
    const s = await snapshot();
    assert.equal(
      s.events.length,
      1,
      `${label}: candidate ${JSON.stringify({ calls: s.calls, traces: s.traces, errors })}`,
    );
    assert.equal(s.calls.length, 1, `${label}: original provider`);
    assert.equal(
      s.events[0].threadId,
      s.threadId,
      `${label}: original provider thread`,
    );
    assert.equal(
      s.events[0].hostId,
      s.hostId,
      `${label}: original provider host`,
    );
    assert.equal(s.events[0].viewId, s.scope.viewId, `${label}: document view`);
    const nativeEvent = s.traces.find((trace) => trace.type);
    assert.equal(nativeEvent?.trusted, true);
    assert.equal(nativeEvent?.defaultPrevented, label !== "mouse");
    const state = s.calls[0][2].state;
    assert.equal(state.original, "kept");
    assert.equal(state[s.key], s.events[0].attemptId);
    const consumed = await page.evaluate(
      (state) => window.fixture.consume(state),
      state,
    );
    assert.equal(consumed?.attemptId, s.events[0].attemptId);
    assert.equal(
      await page.evaluate((state) => window.fixture.consume(state), state),
      null,
    );
    return state;
  }
  await page.locator("#label").click();
  await accepted("mouse");
  await reset();
  await page.evaluate(() => window.fixture.setOmitHost(true));
  await page.locator("#label").click();
  const hostless = await snapshot();
  assert.equal(hostless.events.length, 0, "hostless click has not resolved the route");
  assert.equal(hostless.calls.length, 1);
  assert.equal(hostless.calls[0][1], undefined);
  const hostlessState = hostless.calls[0][2].state;
  assert.ok(hostlessState[hostless.key]);
  const resolved = await page.evaluate((state) => window.fixture.consume(state), hostlessState);
  assert.equal(resolved?.threadId, hostless.threadId);
  assert.equal(resolved?.hostId, hostless.hostId);
  assert.equal(resolved?.attemptId, hostlessState[hostless.key]);
  assert.equal((await snapshot()).events.length, 1);
  assert.equal(await page.evaluate((state) => window.fixture.consume(state), hostlessState), null);
  await reset();
  await page.locator("#row").focus();
  await page.keyboard.press("Enter");
  await accepted("Enter");
  await reset();
  await page.locator("#row").focus();
  await page.keyboard.press("Space");
  await accepted("Space");
  await reset();
  await page.locator("#nested").click();
  assert.equal((await snapshot()).events.length, 0, "nested action");
  assert.equal((await snapshot()).calls.length, 1);
  await reset();
  await page.locator("#outside").click();
  assert.equal((await snapshot()).events.length, 0, "outside row");
  assert.equal((await snapshot()).calls.length, 1);
  await reset();
  await page.evaluate(() => document.querySelector("#row").click());
  assert.equal((await snapshot()).events.length, 0, "programmatic click");
  assert.equal((await snapshot()).calls.length, 1);
  await reset();
  await page.evaluate(() => window.fixture.setDelayed(true));
  await page.locator("#label").click();
  await page.waitForFunction(() => window.fixture.calls.length === 1);
  const delayed = await snapshot();
  assert.equal(delayed.events.length, 0, "asynchronous navigation");
  assert.ok(
    delayed.traces.some(
      (trace) =>
        trace.microtask && trace.phase === 3 && trace.currentWindowEvent,
    ),
    "eventPhase and window.event remain populated at the microtask checkpoint",
  );
  await reset();
  await page.locator("#label").click();
  const candidate = await snapshot();
  const second = await context.newPage();
  await second.goto(`http://127.0.0.1:${server.address().port}/`);
  await second.waitForFunction(() => Boolean(window.fixture));
  assert.equal(
    await second.evaluate(
      (state) => window.fixture.consume(state),
      candidate.calls[0][2].state,
    ),
    null,
    "other view",
  );
  await page.evaluate(() => window.fixture.notify());
  assert.equal(
    await page.evaluate(
      (state) => window.fixture.consume(state),
      candidate.calls[0][2].state,
    ),
    null,
    "same-value scope revision",
  );
  assert.deepEqual(
    await page.evaluate(() => window.fixture.remount()),
    { active: false, restored: true },
    "the original React root retains its listener registration marker after unmount",
  );
  assert.deepEqual(errors, []);
  assert.equal(digest(await readFile(originalPath)), originalHash);
  assert.equal(digest(await readFile(probePath)), digest(probe));
  assert.equal(digest(await readFile(rootProbePath)), digest(rootProbe));
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "trusted-mouse",
        "trusted-hostless-mouse-resolved-route",
        "trusted-enter",
        "trusted-space",
        "nested",
        "outside",
        "programmatic",
        "async",
        "cross-view",
        "scope-revision",
        "react-remount-denied",
      ],
      originalBytes: original.length,
      originalSha256: originalHash,
      probeSha256: digest(probe),
      rootProbeSha256: digest(rootProbe),
      appMainSha256: digest(appMain),
      appSharedSha256: digest(shared),
      boundary:
        "Chromium with original React 19.2.7, extracted original provider/row callback and synthetic app; no native GUI, daemon, account, or RPC",
    }),
  );
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
