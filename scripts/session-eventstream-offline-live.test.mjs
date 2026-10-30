import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { chromium } from "../node_modules/playwright/index.mjs";
import { createRuntime } from "../packages/session-runtime/dist/server.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const webRoot = join(root, "apps/web");
const webRequire = createRequire(join(webRoot, "package.json"));
const { build } = webRequire("vite");

async function unusedPort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitFor(read, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw Object.assign(new Error("LIVE_EVENTSTREAM_STATE_TIMEOUT"), { last });
}

test("real HTTP EventSource is closed offline and reopens on online from the retained cursor", {
  skip: process.env.SESSION_EVENTSTREAM_OFFLINE_LIVE_RUN === "1"
    ? false
    : "opt in with SESSION_EVENTSTREAM_OFFLINE_LIVE_RUN=1 to launch Chromium and a real HTTP/SSE runtime",
}, async (t) => {
  const dataHome = await mkdtemp(join(tmpdir(), "kanban-eventstream-offline-"));
  const webPort = await unusedPort();
  const runtimePort = await unusedPort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  let runtime;
  let staticServer;
  let browser;
  let context;
  let bundle;
  t.after(async () => {
    const failures = [];
    for (const close of [
      () => context?.close(),
      () => browser?.close(),
      () => !staticServer ? Promise.resolve() : new Promise((resolveClose, reject) => staticServer.close((error) => error ? reject(error) : resolveClose())),
      () => runtime?.app.close(),
      () => rm(dataHome, { recursive: true, force: true }),
    ]) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "offline acceptance cleanup failed");
  });

  const fixturePath = join(webRoot, "test-fixtures/session-eventstream-offline.ts");
  await build({
    configFile: false,
    root: webRoot,
    mode: "production",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [{
      name: "offline-live-runtime-url",
      load(id) {
        return id === "\0offline-live-runtime-url"
          ? "export const buildEventUrl = (path) => window.__eventStreamBase + path;"
          : null;
      },
      generateBundle(_options, outputBundle) {
        bundle = Object.values(outputBundle).find((item) => item.type === "chunk" && item.isEntry)?.code;
      },
    }],
    resolve: { alias: [
      { find: "@session/hooks/runtime", replacement: "\0offline-live-runtime-url" },
      { find: "@session", replacement: join(webRoot, "src/session-mode") },
    ] },
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry: fixturePath, formats: ["es"], fileName: "client" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  console.log("offline-live: fixture bundle ready");
  assert.ok(bundle, "Vite build emitted the actual eventStream fixture bundle");

  runtime = await createRuntime({
    dataHome,
    instance: `eventstream-offline-${randomUUID()}`,
  });
  console.log("offline-live: runtime created");
  await runtime.app.listen({ host: "127.0.0.1", port: runtimePort });
  console.log("offline-live: runtime listening");
  runtime.hub.publish("codex/request-user-input", {
    threadId: "offline-fixture-thread",
    requestId: "fixture-pending-approval",
    turnId: "offline-fixture-turn",
    itemId: "offline-fixture-item",
    requestToken: "offline-fixture-token",
    type: "text",
  });
  const baselineSubscribers = runtime.hub.subscriberCount;

  staticServer = createHttpServer((request, response) => {
    if (new URL(request.url, webOrigin).pathname === "/api/events") {
      const upstream = httpRequest({ host: "127.0.0.1", port: runtimePort, path: request.url, method: "GET" }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, {
          "content-type": upstreamResponse.headers["content-type"] ?? "text/plain",
          "cache-control": upstreamResponse.headers["cache-control"] ?? "no-cache",
          connection: "keep-alive",
        });
        upstreamResponse.pipe(response);
      });
      response.on("close", () => upstream.destroy());
      upstream.on("error", () => response.destroy());
      upstream.end();
      return;
    }
    if (request.url === "/client.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(bundle);
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><label>Draft <input id="draft" value="preserved fixture draft"></label><script>window.__eventStreamBase=${JSON.stringify(webOrigin)}</script><script type="module" src="/client.js"></script>`);
      return;
    }
    response.writeHead(404).end();
  });
  staticServer.listen(webPort, "127.0.0.1");
  await once(staticServer, "listening");
  console.log("offline-live: static fixture listening");

  browser = await chromium.launch({ headless: true });
  console.log("offline-live: browser launched");
  context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    const records = [];
    window.EventSource = new Proxy(NativeEventSource, {
      construct(Target, args, NewTarget) {
        const source = Reflect.construct(Target, args, NewTarget);
        const record = { url: source.url, source, opens: 0, errors: 0 };
        source.addEventListener("open", () => record.opens++);
        source.addEventListener("error", () => record.errors++);
        records.push(record);
        return source;
      },
    });
    Object.assign(window, { __nativeEventSourceRecords: records });
  });
  const page = await context.newPage();
  const observedApiRequests = [];
  const apiResponses = [];
  const pageRequests = [];
  page.on("request", (request) => {
    pageRequests.push({ method: request.method(), url: request.url() });
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) observedApiRequests.push({ method: request.method(), path: url.pathname });
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/")) apiResponses.push({ status: response.status(), path: url.pathname });
  });
  page.on("requestfailed", (request) => apiResponses.push({ failure: request.failure()?.errorText, path: new URL(request.url()).pathname }));
  await page.goto(webOrigin, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("offline-live: page loaded");
  try {
    await page.waitForFunction(() => !!window.__eventStreamOfflineFixture, undefined, { timeout: 5000 });
  } catch (error) {
    throw Object.assign(new Error(`Fixture module did not initialize: ${JSON.stringify({ pageRequests, apiResponses, pageErrors })}`), { cause: error });
  }
  try {
    await page.waitForFunction(() => window.__eventStreamOfflineFixture.isConnected() === true, undefined, { timeout: 5000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      connected: window.__eventStreamOfflineFixture?.isConnected(),
      sources: window.__nativeEventSourceRecords?.map((record) => ({ url: record.url, readyState: record.source.readyState, opens: record.opens, errors: record.errors })),
      online: navigator.onLine,
    }));
    throw Object.assign(new Error(`Initial EventSource did not open: ${JSON.stringify({ diagnostics, apiResponses, pageErrors })}`), { cause: error });
  }
  const initial = await waitFor(async () => ({
    subscribers: runtime.hub.subscriberCount,
    fixture: await page.evaluate(() => ({
      connected: window.__eventStreamOfflineFixture.isConnected(),
      events: window.__eventStreamOfflineFixture.state.receivedSeq,
      eventNames: window.__eventStreamOfflineFixture.state.receivedEvents,
      pendingApprovals: window.__eventStreamOfflineFixture.state.pendingApprovals.length,
      source: window.__nativeEventSourceRecords.at(-1)?.source.readyState ?? null,
      sourceCount: window.__nativeEventSourceRecords.length,
    })),
  }), (state) => state.subscribers === baselineSubscribers + 1 && state.fixture.events.length >= 2 && state.fixture.pendingApprovals === 1);
  console.log("offline-live: initial", JSON.stringify({ subscribers: initial.subscribers, fixture: initial.fixture, eventRequests: observedApiRequests.length, apiResponses }));
  const cursor = initial.fixture.events.at(-1);

  await context.setOffline(true);
  const offline = await waitFor(async () => ({
    subscribers: runtime.hub.subscriberCount,
    onlineHint: await page.evaluate(() => navigator.onLine),
    fixtureConnected: await page.evaluate(() => window.__eventStreamOfflineFixture.isConnected()),
    source: await page.evaluate(() => window.__nativeEventSourceRecords.at(-1)?.source.readyState ?? null),
  }), (state) => state.subscribers === baselineSubscribers && state.onlineHint === false);
  runtime.hub.publish("codex:notification", { kind: "offline-gap-fixture" });
  await context.setOffline(false);
  const online = await waitFor(async () => ({
    subscribers: runtime.hub.subscriberCount,
    fixture: await page.evaluate(() => ({
      connected: window.__eventStreamOfflineFixture.isConnected(),
      events: window.__eventStreamOfflineFixture.state.receivedSeq,
      eventNames: window.__eventStreamOfflineFixture.state.receivedEvents,
      pendingApprovals: window.__eventStreamOfflineFixture.state.pendingApprovals.length,
      draft: document.querySelector("#draft").value,
      sourceCount: window.__nativeEventSourceRecords.length,
      sourceUrl: window.__nativeEventSourceRecords.at(-1)?.url ?? "",
      sourceReadyState: window.__nativeEventSourceRecords.at(-1)?.source.readyState ?? null,
    })),
  }), (state) => state.subscribers === baselineSubscribers + 1 && state.fixture.connected && state.fixture.events.length >= 5, 10000);
  const forbiddenWrites = observedApiRequests.filter((request) => request.method !== "GET" || request.path !== "/api/events");
  assert.equal(initial.fixture.source, 1, "native EventSource was OPEN before offline");
  assert.equal(initial.fixture.pendingApprovals, 1);
  assert.equal(offline.fixtureConnected, false);
  assert.equal(offline.source, 2, "native EventSource is CLOSED offline");
  assert.equal(offline.subscribers, baselineSubscribers, "server released the browser SSE subscription offline");
  assert.equal(online.fixture.sourceCount, 2, "online made one replacement native EventSource");
  assert.match(online.fixture.sourceUrl, new RegExp(`view=chat.*since=${cursor}`));
  assert.equal(online.fixture.sourceReadyState, 1, "replacement EventSource is OPEN");
  assert.deepEqual(online.fixture.events, [cursor, cursor, cursor + 1, cursor + 1, cursor + 1]);
  assert.deepEqual(online.fixture.eventNames, [
    "codex/user-input-snapshot",
    "codex/pending-requests-snapshot",
    "codex:notification",
    "codex/user-input-snapshot",
    "codex/pending-requests-snapshot",
  ]);
  assert.equal(online.fixture.pendingApprovals, 1);
  assert.equal(online.fixture.draft, "preserved fixture draft");
  assert.deepEqual(forbiddenWrites, []);
  assert.deepEqual(pageErrors, []);
  console.log("offline-live: result", JSON.stringify({
    baselineRuntimeSubscribers: baselineSubscribers,
    initial: { runtimeSubscribers: initial.subscribers, nativeReadyState: initial.fixture.source, seq: initial.fixture.events, eventNames: initial.fixture.eventNames, pendingApprovals: initial.fixture.pendingApprovals, eventSourceCount: initial.fixture.sourceCount },
    offline: { runtimeSubscribers: offline.subscribers, navigatorOnline: offline.onlineHint, connected: offline.fixtureConnected, nativeReadyState: offline.source },
    online: { runtimeSubscribers: online.subscribers, nativeReadyState: online.fixture.sourceReadyState, eventSourceCount: online.fixture.sourceCount, url: online.fixture.sourceUrl, seq: online.fixture.events, eventNames: online.fixture.eventNames, pendingApprovals: online.fixture.pendingApprovals, draftPreserved: online.fixture.draft === "preserved fixture draft" },
    apiRequests: observedApiRequests,
    nonReadOnlyRequests: forbiddenWrites,
  }));
});
