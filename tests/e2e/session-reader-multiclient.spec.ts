import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installSessionUxFixture } from "./session-ux-fixture";

type Snapshot = {
  proxyRecords: Array<{
    httpVersion: string;
    abortForwardedAt?: number;
    method: string;
  }>;
  requests: Array<{
    id: string;
    priority: string;
    receivedAt: number;
    httpVersion: string;
    closedAt?: number;
    status?: number;
    aborted?: boolean;
  }>;
  records: Array<{
    event: string;
    method?: string;
    id?: string;
    pid: number;
    startTicks: string;
    at: number;
    params?: Record<string, unknown>;
  }>;
  alive: Array<{ pid: number; startTicks: string; state: string }>;
};
type GateState = {
  phase: string;
  status?: number;
  error?: string;
  body?: unknown;
};
type Action = {
  method:
    | "raw"
    | "queued"
    | "cancel"
    | "product"
    | "select"
    | "expire"
    | "load-product";
  name?: string;
  id?: string;
  priority?: "interactive" | "background";
  deadlineMs?: number;
};

/**
 * This is a protocol browser gate, complementary to session-preload-priority's
 * real public tabs and 1/8/30/50 coverage. The small DOM entry imports the actual
 * scheduler; product consumers below additionally import codexService/stores.
 * Entry modules and unrelated APIs are fixtures. History is native browser
 * fetch -> owned H2 abort proxy -> H1 app gateway -> channel -> owned fake native.
 */
async function gateway(allowedOrigin: string) {
  const require = createRequire(resolve("apps/server/package.json"));
  const child = spawn(
    process.execPath,
    [
      require.resolve("tsx/cli"),
      resolve("tests/e2e/session-reader-multiclient-server.mts"),
      allowedOrigin,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: undefined },
    },
  );
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  let ready!: (value: {
    origin: string;
    root: string;
    identity: { pid: number; startTicks: string };
  }) => void;
  let rejectReady!: (error: Error) => void;
  const started = new Promise<Parameters<typeof ready>[0]>(
    (resolve, reject) => {
      ready = resolve;
      rejectReady = reject;
    },
  );
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.ready) ready(message);
    else {
      const waiter = pending.get(message.id);
      if (message.error) waiter?.reject(new Error(message.error));
      else waiter?.resolve(message.value);
      pending.delete(message.id);
    }
  });
  child.once("exit", (code) => {
    const error = new Error(`Owned reader gateway exited ${code}: ${stderr}`);
    rejectReady(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    lines.close();
  });
  const metadata = await started;
  let sequence = 0;
  const call = (method: string, target?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, target }) + "\n");
    });
  return {
    ...metadata,
    snapshot: (): Promise<Snapshot> => call("snapshot"),
    release: (id: string) => call("release", id),
    async close() {
      const cleanup: Snapshot = await call("close");
      await exited;
      let sameServerIdentity = false;
      try {
        sameServerIdentity =
          (await readFile(`/proc/${metadata.identity.pid}/stat`, "utf8"))
            .split(") ")
            .at(-1)!
            .split(" ")[19] === metadata.identity.startTicks;
      } catch (error: any) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      }
      return {
        ...cleanup,
        gateway: metadata.identity,
        gatewayStillAlive: sameServerIdentity,
        stderr,
      };
    },
  };
}

function entry(origin: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owned dual page reader gate</title></head>
  <body><output id="selected"></output><pre id="transcript"></pre><pre id="reads"></pre><script type="module">
  import RefreshRuntime from '/@react-refresh';
  import { enqueueSessionRead, readWithDeadline } from '/src/session-mode/services/sessionReadQueue.ts';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => type => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  document.body.innerHTML = '<output id="selected"></output><pre id="transcript"></pre><pre id="reads"></pre>';
  const gateway = ${JSON.stringify(origin)};
  const endpoint = '/api/session/api/codex/thread/turns/list?view=chat';
  const originalFetch = window.fetch.bind(window);
  // Preserve native fetch/AbortSignal. No handler, route.fetch or synthetic
  // history response is involved in this fixed URL substitution.
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    return originalFetch(url.pathname + url.search === endpoint ? gateway + endpoint : input, init);
  };
  const states = {}, controllers = new Map();
  let product;
  const render = () => {
    document.querySelector('#reads').textContent = JSON.stringify(states);
    if (product) {
      const state = product.store.getState();
      document.querySelector('#selected').textContent = state.currentThreadId ?? '';
      document.querySelector('#transcript').textContent = JSON.stringify(state.events[state.currentThreadId] ?? []);
    }
  };
  const track = (name, promise) => {
    states[name] = { phase: 'pending' }; render();
    promise.then(value => {
      states[name] = { phase: 'fulfilled', ...value }; render();
    }, error => {
      states[name] = { phase: 'rejected', error: error?.name ?? String(error) }; render();
    });
  };
  const read = async (id, priority, signal) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-read-priority': priority }, body: JSON.stringify({ threadId: id, cursor: null, limit: 10, sortDirection: 'desc', itemsView: 'full' }), signal });
    return { status: response.status, body: await response.json() };
  };
  const load = path => import(performance.getEntriesByType('resource').findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
  window.readerGate = {
    states,
    async action(action) {
      if (action.method === 'load-product') {
        const [service, store, scope] = await Promise.all([
          load('/src/session-mode/services/codexService.ts'),
          load('/src/session-mode/components/codex/stores/useCodexStore.ts'),
          load('/src/session-mode/services/codexOperationScope.ts'),
        ]);
        product = { service: service.codexService, store: store.useCodexStore, select: id => store.useCodexStore.setState({ currentThreadId: id, currentTurnId: null }), expire: scope.invalidateCodexOperationScope };
        product.store.subscribe(render); render(); return;
      }
      if (action.method === 'cancel') { controllers.get(action.name)?.abort(); return; }
      if (action.method === 'select') { product.select(action.id); return; }
      if (action.method === 'expire') { product.expire(); return; }
      const controller = new AbortController(); controllers.set(action.name, controller);
      const priority = action.priority ?? 'interactive';
      if (action.method === 'raw') track(action.name, read(action.id, priority, controller.signal));
      else if (action.method === 'queued') track(action.name, enqueueSessionRead('recent', action.id, () => readWithDeadline(signal => read(action.id, priority, signal), action.deadlineMs ?? 15000, controller.signal), controller.signal, priority));
      else if (action.method === 'product') track(action.name, product.service.loadThreadHistory(action.id, undefined, { recent: true, background: true, priority, signal: controller.signal, reportScopeChanges: true }));
      else throw new Error('Unexpected action');
    },
    snapshot() {
      if (!product) return { states };
      const state = product.store.getState();
      return { states, currentThreadId: state.currentThreadId, events: state.events, loaded: state.historyLoadedMap, errors: state.historyErrorMap };
    },
  };
  document.body.dataset.readerReady = 'true';
  </script></body></html>`;
}

async function act(page: Page, action: Action) {
  await page.evaluate(
    (action) => (window as any).readerGate.action(action),
    action,
  );
}
async function state(page: Page, name: string): Promise<GateState> {
  return page.evaluate((name) => (window as any).readerGate.states[name], name);
}
function starts(snapshot: Snapshot) {
  return snapshot.records.filter(
    (record) => record.method === "thread/turns/list",
  );
}

async function setup(browser: Browser, baseURL: string, info: TestInfo) {
  const owned = await gateway(new URL(baseURL).origin);
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: string[] = [];
  const consoleErrors: Array<{ page: number; message: string; url: string }> =
    [];
  const apiFixtures: Array<
    Awaited<ReturnType<typeof installSessionUxFixture>>
  > = [];
  try {
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      contexts.push(context);
      pages.push(await context.newPage());
    }
    for (const [index, page] of pages.entries()) {
      page.on("pageerror", (error) =>
        errors.push(`page ${index}: ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          consoleErrors.push({
            page: index,
            message: message.text(),
            url: message.location().url,
          });
      });
      apiFixtures.push(await installSessionUxFixture(page, 1));
      // The shared fixture blocks Agent sockets. The real dev entry also loads
      // Vite's own HMR socket; permit only that exact frontend host/root path
      // so this protocol gate has no deliberate websocket console errors.
      await page.routeWebSocket(
        (url) => url.host === new URL(baseURL).host && url.pathname === "/",
        (socket) => {
          socket.connectToServer();
        },
      );
      await page.route(
        (url) => url.pathname === "/api/session/api/codex/thread/metadata",
        (route) => {
          const id = route.request().postDataJSON().threadId;
          return route.fulfill({
            json: {
              thread: {
                id,
                name: id,
                cwd: "/fixture/reader-gate",
                preview: "",
                createdAt: 1,
                updatedAt: 2,
                modelProvider: "openai",
                status: { type: "idle" },
              },
            },
          });
        },
      );
      // This terminal route permits the browser's own cross-origin request and
      // prevents the unrelated-API fixture from synthesizing history responses.
      await page.route(`${owned.origin}/**`, (route) => route.continue());
      // Keep the real HTTP top-level response/address space. A synthesized
      // document is classified as public by Chromium and would fail PNA even
      // when importing source from its own LAN origin. Replace only the two
      // application entry modules; no production workbench is mounted here.
      await page.route("**/src/initial-workbench-preload.ts", (route) =>
        route.fulfill({ contentType: "text/javascript", body: "export {};" }),
      );
      await page.route("**/src/main.tsx", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: entry(owned.origin).match(
            /<script type="module">([\s\S]*?)<\/script>/,
          )![1],
        }),
      );
      await page.goto(new URL("/__session-reader-multiclient", baseURL).href);
      await expect(page.locator("body")).toHaveAttribute(
        "data-reader-ready",
        "true",
      );
    }
  } catch (error) {
    await Promise.allSettled(contexts.map((context) => context.close()));
    const cleanup = await owned.close();
    await writeFile(
      info.outputPath("setup-failure.json"),
      JSON.stringify(
        { error: String(error), cleanup, errors, consoleErrors },
        null,
        2,
      ),
    );
    throw error;
  }
  const checkpoints: Array<{ name: string; snapshot: Snapshot }> = [];
  const checkpoint = async (name: string) => {
    const snapshot = await owned.snapshot();
    checkpoints.push({ name, snapshot });
    return snapshot;
  };
  return {
    owned,
    pages,
    checkpoint,
    async close() {
      // Close only the exact contexts created here; page abort must reach the
      // owned HTTP gateway before its preClose cancels any remaining readers.
      const pageStates = await Promise.all(
        pages.map((page) =>
          page
            .evaluate(() => (window as any).readerGate.snapshot())
            .catch(() => null),
        ),
      );
      await Promise.all(contexts.map((context) => context.close()));
      const cleanup = await owned.close();
      await writeFile(
        info.outputPath("dual-page-reader-evidence.json"),
        JSON.stringify(
          {
            scope:
              "real browser protocol gate; public tabs remain covered separately by session-preload-priority",
            frontend: baseURL,
            gateway: owned.origin,
            fixtureRoot: owned.root,
            checkpoints,
            pageStates,
            pageErrors: errors,
            consoleErrors,
            unrelatedApiCalls: apiFixtures.map((fixture) => fixture.calls),
            cleanup,
          },
          null,
          2,
        ),
      );
      expect(errors).toEqual([]);
      // Chromium emits a console network diagnostic for an intentional 429.
      // Preserve it as expected HTTP evidence; require zero other errors.
      expect(
        consoleErrors.filter(
          (error) =>
            !(
              error.url.startsWith(owned.origin) &&
              /\b429\b/.test(error.message)
            ),
        ),
      ).toEqual([]);
      expect(cleanup.alive).toEqual([]);
      expect(cleanup.gatewayStillAlive).toBe(false);
      expect(cleanup.stderr).toBe("");
      const live = new Set<string>();
      let peak = 0;
      for (const record of cleanup.records) {
        const key = `${record.pid}:${record.startTicks}`;
        if (record.event === "spawn") live.add(key);
        if (record.event === "exit") live.delete(key);
        peak = Math.max(peak, live.size);
      }
      expect(peak).toBe(1);
      expect([...live]).toEqual([]);
      expect(
        new Set(
          cleanup.records
            .filter((record) => record.event === "method")
            .map((record) => record.method),
        ),
      ).toEqual(new Set(["initialize", "initialized", "thread/turns/list"]));
      expect(
        cleanup.records.filter(
          (record) =>
            record.event === "method" &&
            Object.keys(record.params ?? {}).some((key) =>
              /priority/i.test(key),
            ),
        ),
      ).toEqual([]);
      expect(
        apiFixtures
          .flatMap((fixture) => fixture.calls)
          .filter((call) =>
            /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback))$/.test(
              call.path,
            ),
          ),
      ).toEqual([]);
    },
  };
}

test("two page schedulers prioritize interaction and finish queued background reads within three foreground admissions", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(45000);
  const gate = await setup(browser, baseURL!, info);
  const [a, b] = gate.pages;
  const targets = [
    "fair-a0",
    "fair-a1",
    "fair-b0",
    "fair-fa1",
    "fair-fa2",
    "fair-fa3",
    "fair-fb1",
    "fair-fb2",
    "fair-fb3",
  ];
  try {
    await act(a, {
      method: "queued",
      name: "fair-a0",
      id: "fair-a0",
      priority: "background",
    });
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).map((record) => record.id),
      )
      .toEqual(["fair-a0"]);
    await act(a, {
      method: "queued",
      name: "fair-a1",
      id: "fair-a1",
      priority: "background",
    });
    await act(b, {
      method: "queued",
      name: "fair-b0",
      id: "fair-b0",
      priority: "background",
    });
    await expect
      .poll(async () =>
        (await gate.owned.snapshot()).requests.some(
          (request) => request.id === "fair-b0",
        ),
      )
      .toBe(true);
    for (const page of [a, b])
      for (const index of [1, 2, 3]) {
        const id = `fair-f${page === a ? "a" : "b"}${index}`;
        await act(page, {
          method: "queued",
          name: id,
          id,
          priority: "interactive",
        });
      }
    await expect
      .poll(
        async () =>
          (await gate.owned.snapshot()).requests.filter(
            (request) => request.priority === "interactive",
          ).length,
      )
      .toBe(4);
    const before = await gate.checkpoint(
      "both browser schedulers queued foreground and background behind the one owned reader",
    );
    expect(before.requests.some((request) => request.id === "fair-a1")).toBe(
      false,
    );
    const startedAt = Date.now();
    const order = ["fair-a0"];
    for (let index = 0; index < targets.length; index++) {
      await gate.owned.release(order[index]);
      if (index + 1 < targets.length) {
        await expect
          .poll(async () => starts(await gate.owned.snapshot()).length)
          .toBe(index + 2);
        const observed = await gate.owned.snapshot();
        order.push(starts(observed)[index + 1].id!);
        expect(observed.alive.length).toBeLessThanOrEqual(1);
      }
    }
    for (const id of targets) {
      await expect
        .poll(
          async () =>
            (
              await state(
                id.startsWith("fair-b") || id.startsWith("fair-fb") ? b : a,
                id,
              )
            ).phase,
        )
        .toBe("fulfilled");
      const result = await state(
        id.startsWith("fair-b") || id.startsWith("fair-fb") ? b : a,
        id,
      );
      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).toContain(`recent page ${id}`);
    }
    expect(order[1]).toMatch(/^fair-f/);
    expect(order.indexOf("fair-b0")).toBeLessThanOrEqual(4);
    expect(order.indexOf("fair-a1")).toBeLessThanOrEqual(8);
    expect(new Set(order)).toEqual(new Set(targets));
    expect(Date.now() - startedAt).toBeLessThan(15000);
    const final = await gate.checkpoint(
      "all backgrounds completed with the original single-reader budget",
    );
    // For every waiting background, count actual native foreground admissions
    // after its HTTP arrival. This measures the shared channel, across pages.
    for (const id of ["fair-b0", "fair-a1"]) {
      const arrival = final.requests.find((request) => request.id === id)!;
      const start = starts(final).find((record) => record.id === id)!;
      const sinceLastBackground = starts(final).filter(
        (record) => record.at >= arrival.receivedAt && record.at < start.at,
      );
      const lastBackground = sinceLastBackground.findLastIndex(
        (record) => !record.id!.startsWith("fair-f"),
      );
      expect(
        sinceLastBackground.slice(lastBackground + 1).length,
      ).toBeLessThanOrEqual(3);
    }
  } finally {
    await gate.close();
  }
});

test("two pages share the exact 17-request cap; queued and in-flight browser abort release only owned readers", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(45000);
  const gate = await setup(browser, baseURL!, info);
  const [a, b] = gate.pages;
  const ids = Array.from({ length: 17 }, (_, index) => `cap-${index}`);
  try {
    // Raw native fetch intentionally bypasses the page-local scheduler here:
    // proving 17 gateway admissions requires more than the page worker budget.
    for (const [index, id] of ids.entries()) {
      await act(index % 2 ? b : a, {
        method: "raw",
        name: id,
        id,
        priority: "background",
      });
      await expect
        .poll(async () => (await gate.owned.snapshot()).requests.length)
        .toBe(index + 1);
    }
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).map((record) => record.id),
      )
      .toEqual(["cap-0"]);
    await act(b, { method: "raw", name: "over-cap", id: "cap-over" });
    await expect
      .poll(async () => (await state(b, "over-cap")).status)
      .toBe(429);
    expect((await state(b, "over-cap")).body).toEqual({
      error: "CHAT_HISTORY_BUSY",
    });
    const full = await gate.checkpoint(
      "17 outstanding real HTTP reads; 18th returns unchanged CHAT_HISTORY_BUSY 429",
    );
    expect(
      full.requests.filter((request) => request.status === 429),
    ).toHaveLength(1);
    expect(full.alive).toHaveLength(1);
    expect(
      new Set(full.requests.map((request) => request.httpVersion)),
    ).toEqual(new Set(["1.1"]));
    expect(
      new Set(full.proxyRecords.map((request) => request.httpVersion)),
    ).toEqual(new Set(["2.0"]));
    const ownedReader = full.alive[0];
    await act(b, { method: "cancel", name: "cap-1" });
    await expect
      .poll(async () => (await state(b, "cap-1")).phase)
      .toBe("rejected");
    await expect
      .poll(
        async () =>
          (await gate.owned.snapshot()).requests.find(
            (request) => request.id === "cap-1",
          )?.aborted,
      )
      .toBe(true);
    await act(b, { method: "raw", name: "replacement", id: "cap-replacement" });
    await expect
      .poll(async () =>
        (await gate.owned.snapshot()).requests.some(
          (request) => request.id === "cap-replacement",
        ),
      )
      .toBe(true);
    expect((await state(b, "replacement")).phase).toBe("pending");
    await act(a, {
      method: "raw",
      name: "over-cap-again",
      id: "cap-over-again",
    });
    await expect
      .poll(async () => (await state(a, "over-cap-again")).status)
      .toBe(429);
    await act(a, { method: "cancel", name: "cap-0" });
    await expect
      .poll(async () => (await state(a, "cap-0")).phase)
      .toBe("rejected");
    await expect
      .poll(async () => starts(await gate.owned.snapshot()).length)
      .toBe(2);
    const cancelled = await gate.checkpoint(
      "queued cancel did not launch native; active cancel exited exact PID and freed its slot",
    );
    expect(
      cancelled.alive.some(
        (identity) =>
          identity.pid === ownedReader.pid &&
          identity.startTicks === ownedReader.startTicks,
      ),
    ).toBe(false);
    expect(starts(cancelled).some((record) => record.id === "cap-1")).toBe(
      false,
    );
    expect(
      cancelled.records.some(
        (record) =>
          record.event === "exit" &&
          record.pid === ownedReader.pid &&
          record.startTicks === ownedReader.startTicks,
      ),
    ).toBe(true);
    expect(
      cancelled.proxyRecords.filter((record) => record.abortForwardedAt),
    ).toHaveLength(2);
    for (const id of [...ids.slice(2), "cap-replacement"])
      await gate.owned.release(id);
    for (let index = 2; index < ids.length; index++)
      await expect
        .poll(async () => (await state(index % 2 ? b : a, ids[index])).status)
        .toBe(200);
    await expect
      .poll(async () => (await state(b, "replacement")).status)
      .toBe(200);
    const final = await gate.checkpoint(
      "all uncancelled reads completed; neither over-cap request nor queued cancellation launched native",
    );
    expect(starts(final).map((record) => record.id)).toHaveLength(17);
    expect(
      starts(final).filter((record) =>
        ["cap-1", "cap-over", "cap-over-again"].includes(record.id!),
      ),
    ).toEqual([]);
    expect(
      final.requests.filter((request) => request.status === 429),
    ).toHaveLength(2);
  } finally {
    await gate.close();
  }
});

test("same-page product consumers coalesce; one cancelled consumer leaves the other and a separate page valid", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(60000);
  const gate = await setup(browser, baseURL!, info);
  const [a, b] = gate.pages;
  try {
    await Promise.all(
      [a, b].map((page) => act(page, { method: "load-product" })),
    );
    await act(a, {
      method: "product",
      name: "consumer-a1",
      id: "consumer-shared",
    });
    await expect
      .poll(async () => starts(await gate.owned.snapshot()).length)
      .toBe(1);
    await act(a, {
      method: "product",
      name: "consumer-a2",
      id: "consumer-shared",
    });
    await act(b, {
      method: "product",
      name: "consumer-b1",
      id: "consumer-shared",
    });
    await expect
      .poll(async () => (await gate.owned.snapshot()).requests.length)
      .toBe(2);
    await act(a, { method: "cancel", name: "consumer-a1" });
    await expect
      .poll(async () => (await state(a, "consumer-a1")).phase)
      .toBe("rejected");
    expect((await state(a, "consumer-a2")).phase).toBe("pending");
    const joined = await gate.checkpoint(
      "two consumers in page A share one HTTP read; page B has its own queued HTTP read",
    );
    expect(joined.requests).toHaveLength(2);
    expect(joined.requests.some((request) => request.aborted)).toBe(false);
    expect(starts(joined)).toHaveLength(1);
    await gate.owned.release("consumer-shared");
    for (const [page, name] of [
      [a, "consumer-a2"],
      [b, "consumer-b1"],
    ] as const)
      await expect
        .poll(async () => (await state(page, name)).phase)
        .toBe("fulfilled");
    const final = await gate.checkpoint(
      "the remaining same-page consumer and independent other-page consumer both completed",
    );
    expect(starts(final)).toHaveLength(2);
    expect(
      final.requests.every(
        (request) => request.status === 200 && !request.aborted,
      ),
    ).toBe(true);
    for (const page of [a, b]) {
      const published = await page.evaluate(() =>
        (window as any).readerGate.snapshot(),
      );
      expect(published.loaded["consumer-shared"]).toBe(true);
      expect(JSON.stringify(published.events["consumer-shared"])).toContain(
        "recent page consumer-shared",
      );
    }
    // Coalescing is page-local. This deliberately does not claim cross-page
    // transport coalescing; the shared gateway serializes both actual reads.
  } finally {
    await gate.close();
  }
});

test("late product history cannot switch the selected target or refill an expired scope; deadline abort also frees the reader", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(60000);
  const gate = await setup(browser, baseURL!, info);
  const [a, b] = gate.pages;
  try {
    await act(a, { method: "load-product" });
    await act(a, { method: "select", id: "stale-current" });
    await gate.owned.release("stale-current");
    await act(a, { method: "product", name: "current", id: "stale-current" });
    await expect
      .poll(async () => (await state(a, "current")).phase)
      .toBe("fulfilled");
    await expect(a.locator("#transcript")).toContainText(
      "recent page stale-current",
    );
    const currentText = await a.locator("#transcript").textContent();
    await act(a, { method: "select", id: "stale-old" });
    await act(a, { method: "product", name: "old", id: "stale-old" });
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).some(
          (record) => record.id === "stale-old",
        ),
      )
      .toBe(true);
    await act(a, { method: "select", id: "stale-current" });
    await gate.owned.release("stale-old");
    await expect
      .poll(async () => (await state(a, "old")).phase)
      .toBe("fulfilled");
    await expect(a.locator("#selected")).toHaveText("stale-current");
    await expect(a.locator("#transcript")).toHaveText(currentText!);
    await act(a, { method: "product", name: "expired", id: "stale-expired" });
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).some(
          (record) => record.id === "stale-expired",
        ),
      )
      .toBe(true);
    await act(a, { method: "expire" });
    await gate.owned.release("stale-expired");
    await expect
      .poll(async () => (await state(a, "expired")).phase)
      .toBe("rejected");
    const product = await a.evaluate(() =>
      (window as any).readerGate.snapshot(),
    );
    expect(product.loaded["stale-expired"]).not.toBe(true);
    expect(product.events["stale-expired"] ?? []).toEqual([]);
    await expect(a.locator("#selected")).toHaveText("stale-current");
    await expect(a.locator("#transcript")).toHaveText(currentText!);
    await gate.checkpoint(
      "actual codexService kept old history in its target and rejected the revoked-scope response",
    );
    await act(b, {
      method: "queued",
      name: "deadline",
      id: "deadline-owned",
      deadlineMs: 1000,
    });
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).some(
          (record) => record.id === "deadline-owned",
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => (await state(b, "deadline")).error)
      .toBe("TimeoutError");
    await act(a, {
      method: "raw",
      name: "after-deadline",
      id: "deadline-next",
    });
    await expect
      .poll(async () =>
        starts(await gate.owned.snapshot()).some(
          (record) => record.id === "deadline-next",
        ),
      )
      .toBe(true);
    const expired = await gate.checkpoint(
      "production readWithDeadline aborted real fetch and the next reader acquired the original slot",
    );
    const timeoutReader = starts(expired).find(
      (record) => record.id === "deadline-owned",
    )!;
    expect(
      expired.alive.some(
        (identity) =>
          identity.pid === timeoutReader.pid &&
          identity.startTicks === timeoutReader.startTicks,
      ),
    ).toBe(false);
    await gate.owned.release("deadline-next");
    await expect
      .poll(async () => (await state(a, "after-deadline")).status)
      .toBe(200);
  } finally {
    await gate.close();
  }
});
