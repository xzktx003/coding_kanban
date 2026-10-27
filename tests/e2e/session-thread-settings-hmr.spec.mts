import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(requireWeb.resolve("vite")).href
);
const modulePath = "/src/session-mode/stores/useThreadModelStore.ts";
const database = "kanban.session.thread-models.v1";
const thread = "hmr-thread";
const observations = new WeakMap<Page, unknown[]>();
const inputs = [
  "apps/web/src/session-mode/stores/useThreadModelStore.ts",
  "apps/web/src/session-mode/stores/threadModelPersistence.ts",
];
const manifest = async () =>
  Object.fromEntries(
    await Promise.all(
      inputs.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
async function fixture(browser: Browser, info: TestInfo, secure = true) {
  const before = await manifest(),
    cache = await mkdtemp(join(tmpdir(), "thread-settings-hmr-"));
  const host = Object.values(networkInterfaces())
    .flat()
    .find((a) => a?.family === "IPv4" && !a.internal)?.address;
  if (!host) throw new Error("LAN interface required");
  let https;
  if (secure) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(cache, "key.pem"),
        "-out",
        join(cache, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
        "-addext",
        `subjectAltName=IP:${host},DNS:localhost`,
      ],
      { stdio: "ignore" },
    );
    https = {
      key: await readFile(join(cache, "key.pem")),
      cert: await readFile(join(cache, "cert.pem")),
    };
  }
  const variant = process.env.THREAD_SETTINGS_HMR_VARIANT ?? "current";
  if (!["current", "reuse-controller"].includes(variant))
    throw new Error("Unknown HMR test variant");
  const served: Record<string, string> = {};
  const server = await createServer({
    configFile: false,
    root: resolve("apps/web"),
    cacheDir: cache,
    resolve: { alias: { "@session": resolve("apps/web/src/session-mode") } },
    optimizeDeps: {
      noDiscovery: true,
      include: ["zustand", "zustand/middleware"],
    },
    server: { host: "0.0.0.0", port: 0, watch: null, https },
    plugins: [
      {
        name: "thread-settings-hmr-observer",
        enforce: "pre",
        resolveId(id) {
          if (id === "/thread-hmr-client.js") return "\0thread-hmr-client";
        },
        load(id) {
          if (id === "\0thread-hmr-client")
            return `
     import * as api from '${modulePath}';
     let unsub;function attach(value){unsub?.();window.api=value;const show=()=>document.querySelector('output').textContent=JSON.stringify(value.useThreadModelStore.getState());unsub=value.useThreadModelStore.subscribe(show);show();window.generation=(window.generation??0)+1;}
     attach(api);import.meta.hot.accept('${modulePath}',value=>attach(value));`;
        },
        transform(code, id) {
          if (id.split("?")[0] !== resolve(inputs[0])) return;
          if (variant === "reuse-controller") {
            const current =
              "const controller = createThreadModelController({}, previous);";
            if (!code.includes(current))
              throw new Error("Negative fixture constructor anchor changed");
            code = code.replace(
              current,
              "const controller = previous ?? createThreadModelController();",
            );
          }
          const reducer =
            /function reduceIntent\([\s\S]*?\): ThreadModelEntry \| undefined \{/;
          if (!reducer.test(code))
            throw new Error("Reducer observation anchor changed");
          code =
            `const __threadHmrGeneration=((globalThis as any).__threadHmrGeneration??0)+1;(globalThis as any).__threadHmrGeneration=__threadHmrGeneration;\n` +
            code.replace(
              reducer,
              (match) =>
                match +
                `\n(globalThis as any).__threadReduceCalls??={};(globalThis as any).__threadReduceCalls[__threadHmrGeneration]=((globalThis as any).__threadReduceCalls[__threadHmrGeneration]??0)+1;\n`,
            );
          served[id] = createHash("sha256").update(code).digest("hex");
          return code;
        },
        configureServer(dev) {
          dev.middlewares.use((req, res, next) => {
            if (req.url !== "/thread-hmr") return next();
            res.setHeader("content-type", "text/html");
            res.end(
              '<!doctype html><output></output><script type="module" src="/@vite/client"></script><script type="module" src="/thread-hmr-client.js"></script>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port,
    origin = `${secure ? "https" : "http"}://${host}:${port}`;
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors: string[] = [];
  let apiRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    apiRequests++;
    return route.abort();
  });
  await page.addInitScript((database) => {
    const counts = {
      focus: new Set(),
      visibilitychange: new Set(),
      channels: new Set(),
    };
    for (const [target, type, name] of [
      [window, "focus", "refresh"],
      [document, "visibilitychange", "visibleRefresh"],
    ] as const) {
      const add = target.addEventListener.bind(target),
        remove = target.removeEventListener.bind(target);
      (target as any).addEventListener = (
        kind: string,
        listener: any,
        options: any,
      ) => {
        if (kind === type && listener?.name === name)
          counts[type].add(listener);
        add(kind, listener, options);
      };
      (target as any).removeEventListener = (
        kind: string,
        listener: any,
        options: any,
      ) => {
        if (kind === type && listener?.name === name)
          counts[type].delete(listener);
        remove(kind, listener, options);
      };
    }
    const Native = BroadcastChannel;
    window.BroadcastChannel = class extends Native {
      constructor(name: string) {
        super(name);
        if (name === database) counts.channels.add(this);
      }
      close() {
        counts.channels.delete(this);
        super.close();
      }
    };
    (window as any).settingsListeners = () =>
      Object.fromEntries(
        Object.entries(counts).map(([key, set]) => [key, set.size]),
      );
  }, database);
  try {
    await page.goto(origin + "/thread-hmr");
    await page.waitForFunction(() => (window as any).generation === 1);
    await page.evaluate(async (thread) => {
      const a = (window as any).api;
      a.setThreadModelRuntimeScope("runtime-a");
      await a.ensureThreadModelSettings(thread);
      a.hydrateThreadModel(thread, {
        model: "baseline",
        modelProvider: "openai",
        reasoningEffort: "low",
      });
      await a.flushThreadModelSettings(thread);
    }, thread);
  } catch (error) {
    await context.close().catch(() => {});
    await server.close();
    await rm(cache, { recursive: true, force: true });
    throw error;
  }
  observations.set(page, []);
  return {
    page,
    async hot() {
      const generation = await page.evaluate(() => (window as any).generation);
      await server.reloadModule(
        (await server.moduleGraph.getModuleByUrl(modulePath))!,
      );
      await page.waitForFunction(
        (next) => (window as any).generation === next,
        generation + 1,
      );
    },
    async close() {
      const after = await manifest();
      const evidence = {
        title: info.title,
        origin,
        variant,
        before,
        after,
        served,
        errors,
        apiRequests,
        observations: observations.get(page),
        finalState: await page.evaluate(() =>
          (window as any).api.useThreadModelStore.getState(),
        ),
      };
      const output = resolve(
        process.env.THREAD_SETTINGS_HMR_EVIDENCE_DIR ??
          `.dev-runtime/session-thread-settings-hmr-20261027/${variant}-evidence`,
      );
      await mkdir(output, { recursive: true });
      const file = join(
        output,
        createHash("sha256").update(info.title).digest("hex").slice(0, 16) +
          ".json",
      );
      await writeFile(file, JSON.stringify(evidence, null, 2));
      await info.attach("thread-settings-hmr-evidence", {
        path: file,
        contentType: "application/json",
      });
      await context.close().catch(() => {});
      await server.close();
      await rm(cache, { recursive: true, force: true });
      expect(errors).toEqual([]);
      expect(apiRequests).toBe(0);
      expect(after).toEqual(before);
    },
  };
}
const entry = (page: Page) =>
  page.evaluate(
    (thread) =>
      (window as any).api.useThreadModelStore.getState().threads[thread],
    thread,
  );
async function assertCurrentReducer(page: Page) {
  const observed = await page.evaluate(() => {
    const w = window as any;
    return {
      generation: w.__threadHmrGeneration,
      reducerCalls: w.__threadReduceCalls,
      listeners: w.settingsListeners(),
    };
  });
  observations.get(page)!.push(observed);
  expect(observed.reducerCalls?.[observed.generation] ?? 0).toBeGreaterThan(0);
  expect(observed.listeners).toEqual({
    focus: 1,
    visibilitychange: 1,
    channels: 1,
  });
}
async function reloadSaved(page: Page) {
  await page.reload();
  await page.waitForFunction(() => (window as any).generation === 1);
  await page.evaluate(async (thread) => {
    await (window as any).api.ensureThreadModelSettings(thread);
  }, thread);
}

test("unsaved settings survive real HMR and old setter calls use the new reducer with one observer", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info);
  try {
    await f.page.evaluate(
      ({ thread, database }) => {
        const w = window as any,
          put = IDBObjectStore.prototype.put;
        w.restorePut = () => {
          IDBObjectStore.prototype.put = put;
        };
        IDBObjectStore.prototype.put = function (value, key) {
          if (
            this.transaction.db.name === database &&
            this.name === "threads" &&
            value.id === thread
          )
            throw new DOMException("HMR settings quota", "QuotaExceededError");
          return key === undefined
            ? put.call(this, value)
            : put.call(this, value, key);
        };
        w.oldChange = w.api.changeThreadModel;
        w.oldChange(thread, { model: "chosen-hmr", reasoningEffort: "high" });
      },
      { thread, database },
    );
    await expect
      .poll(() =>
        f.page.evaluate(
          (thread) =>
            (window as any).api.useThreadModelStore.getState().storage[thread],
          thread,
        ),
      )
      .toMatchObject({
        status: "error",
        error: expect.stringContaining("HMR settings quota"),
      });
    await f.hot();
    expect(await entry(f.page)).toMatchObject({
      model: "chosen-hmr",
      reasoningEffort: "high",
      pending: true,
    });
    await f.page.evaluate(
      (thread) => (window as any).oldChange(thread, { serviceTier: "fast" }),
      thread,
    );
    await assertCurrentReducer(f.page);
    await f.page.evaluate(async (thread) => {
      const w = window as any;
      w.restorePut();
      await w.api.retryThreadModelSettings(thread);
      await w.api.flushThreadModelSettings(thread);
    }, thread);
    expect(await entry(f.page)).toMatchObject({
      model: "chosen-hmr",
      reasoningEffort: "high",
      serviceTier: "fast",
    });
    await reloadSaved(f.page);
    expect(await entry(f.page)).toMatchObject({
      model: "chosen-hmr",
      reasoningEffort: "high",
      serviceTier: "fast",
    });
  } finally {
    await f.close();
  }
});

test("a committed IndexedDB edit with delayed completion survives HMR and retains a later edit", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info);
  try {
    await f.page.evaluate(
      ({ thread, database }) => {
        const w = window as any,
          d = Object.getOwnPropertyDescriptor(
            IDBTransaction.prototype,
            "oncomplete",
          )!;
        w.holdComplete = true;
        Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
          ...d,
          set(handler) {
            d.set!.call(this, function (this: IDBTransaction, event: Event) {
              if (
                w.holdComplete &&
                this.db.name === database &&
                this.objectStoreNames.length === 1 &&
                this.objectStoreNames.contains("threads")
              ) {
                w.holdComplete = false;
                w.committedAckHeld = true;
                w.releaseAck = () => handler.call(this, event);
                return;
              }
              handler.call(this, event);
            });
          },
        });
        w.api.changeThreadModel(thread, { model: "committed-before-ack" });
      },
      { thread, database },
    );
    await f.page.waitForFunction(
      () => (window as any).committedAckHeld === true,
    );
    await f.page.evaluate((thread) => {
      const w = window as any;
      w.oldFlush = w.api.flushThreadModelSettings;
      w.oldCapturedSelection = w.api.captureThreadModelSelection(thread);
    }, thread);
    await f.hot();
    await f.page.evaluate(
      (thread) =>
        (window as any).api.changeThreadModel(thread, { serviceTier: "fast" }),
      thread,
    );
    await assertCurrentReducer(f.page);
    await f.page.evaluate(async (thread) => {
      const w = window as any;
      w.releaseAck();
      await w.oldFlush(thread, w.oldCapturedSelection);
      await w.api.flushThreadModelSettings(thread);
    }, thread);
    expect(await entry(f.page)).toMatchObject({
      model: "committed-before-ack",
      serviceTier: "fast",
    });
    await reloadSaved(f.page);
    expect(await entry(f.page)).toMatchObject({
      model: "committed-before-ack",
      serviceTier: "fast",
    });
  } finally {
    await f.close();
  }
});

test("scope revocation across HMR rejects queued native observation and stale read or ACK callbacks", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info);
  try {
    await f.page.evaluate(
      async ({ thread, database }) => {
        const w = window as any;
        w.oldRead = w.api.captureThreadModelRead(thread);
        w.oldSelection = w.api.captureThreadModelSelection(thread);
        w.oldHydrate = w.api.hydrateThreadModel;
        w.oldAck = w.api.ackThreadModelSettings;
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(database);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction("threads", "readwrite"),
              store = tx.objectStore("threads");
            let keep = true,
              started = false;
            const done = new Promise<void>((resolve) => {
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
            });
            w.releaseLock = () => {
              keep = false;
              return done;
            };
            const pump = () => {
              const req = store.get("__hmr_lock__");
              req.onsuccess = () => {
                if (!started) {
                  started = true;
                  resolve();
                }
                if (keep) pump();
              };
            };
            pump();
          };
        });
        w.api.hydrateThreadModel(
          thread,
          { model: "queued-obsolete-native", modelProvider: "openai" },
          { readToken: w.oldRead },
        );
      },
      { thread, database },
    );
    await expect
      .poll(() => entry(f.page))
      .toMatchObject({ model: "queued-obsolete-native" });
    await f.hot();
    await f.page.evaluate((thread) => {
      const w = window as any;
      w.api.setThreadModelRuntimeScope("runtime-b");
      w.oldHydrate(thread, { model: "late-native" }, { readToken: w.oldRead });
      w.oldAck(thread, { model: "late-ack" }, w.oldRead);
    }, thread);
    await f.page.evaluate(async (thread) => {
      const w = window as any;
      await w.releaseLock();
      await w.api.flushThreadModelSettings(thread);
    }, thread);
    expect(await entry(f.page)).toMatchObject({ model: "baseline" });
    expect(
      await f.page.evaluate(() => {
        try {
          (window as any).api.assertThreadModelSelectionCurrent(
            (window as any).oldSelection,
          );
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await f.page.evaluate(async (thread) => {
      const a = (window as any).api;
      a.hydrateThreadModel(
        thread,
        { model: "fresh-native", modelProvider: "openai" },
        { readToken: a.captureThreadModelRead(thread) },
      );
      await a.flushThreadModelSettings(thread);
    }, thread);
    expect(await entry(f.page)).toMatchObject({ model: "fresh-native" });
    await assertCurrentReducer(f.page);
  } finally {
    await f.close();
  }
});

test("HTTP LAN can edit, flush and restore settings without secure-context randomUUID", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info, false);
  try {
    expect(await f.page.evaluate(() => window.isSecureContext)).toBe(false);
    await f.page.evaluate(async (thread) => {
      const a = (window as any).api;
      a.changeThreadModel(thread, {
        model: "http-lan-choice",
        reasoningEffort: "high",
      });
      await a.flushThreadModelSettings(thread);
    }, thread);
    expect(await entry(f.page)).toMatchObject({
      model: "http-lan-choice",
      reasoningEffort: "high",
    });
    await reloadSaved(f.page);
    expect(await entry(f.page)).toMatchObject({
      model: "http-lan-choice",
      reasoningEffort: "high",
    });
  } finally {
    await f.close();
  }
});
