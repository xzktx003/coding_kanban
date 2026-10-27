import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(requireWeb.resolve("vite")).href
);
const modulePath = "/src/session-mode/stores/useFollowupSettingsStore.ts";

test("real HMR transfers unsaved preferences and releases old listeners while stale setters reach the successor", async ({
  browser,
}, info) => {
  const cache = await mkdtemp(join(tmpdir(), "followup-preferences-hmr-"));
  const host = Object.values(networkInterfaces())
    .flat()
    .find(
      (address) => address?.family === "IPv4" && !address.internal,
    )?.address;
  if (!host) throw new Error("LAN interface required");
  const server = await createServer({
    configFile: false,
    root: resolve("apps/web"),
    cacheDir: cache,
    optimizeDeps: { noDiscovery: true, include: ["zustand"] },
    server: { host: "0.0.0.0", port: 0, watch: null },
    plugins: [
      {
        name: "isolated-followup-preferences-hmr",
        resolveId(id) {
          if (id === "/fixture-hmr-client.js") return "\0fixture-hmr-client";
        },
        load(id) {
          if (id === "\0fixture-hmr-client")
            return `
        import {useFollowupSettingsStore} from '${modulePath}';
        let unsubscribe;
        function attach(store){
          unsubscribe?.();window.preferences=store;
          const show=()=>{const {mode,enterBehavior,reviewDelivery,persistenceError}=store.getState();document.querySelector('output').textContent=JSON.stringify({mode,enterBehavior,reviewDelivery,persistenceError});};
          unsubscribe=store.subscribe(show);show();window.generation=(window.generation??0)+1;
        }
        attach(useFollowupSettingsStore);
        import.meta.hot.accept('${modulePath}', module=>attach(module.useFollowupSettingsStore));
      `;
        },
        configureServer(dev) {
          dev.middlewares.use((req, res, next) => {
            if (req.url !== "/hmr-preferences") return next();
            res.setHeader("content-type", "text/html");
            res.end(
              '<!doctype html><output></output><script type="module" src="/@vite/client"></script><script type="module" src="/fixture-hmr-client.js"></script>',
            );
          });
        },
      },
    ],
  });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await server.listen();
    const port = (server.httpServer!.address() as { port: number }).port;
    const origin = `http://${host}:${port}`;
    context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
      const add = window.addEventListener.bind(window),
        remove = window.removeEventListener.bind(window);
      const relevant = (type: string, listener: any) =>
        (type === "storage" && listener?.name === "storageChanged") ||
        (type === "focus" && listener?.name === "refresh");
      window.addEventListener = function (type, listener, options) {
        if (relevant(type, listener)) {
          if (!active.has(type)) active.set(type, new Set());
          active.get(type)!.add(listener);
        }
        add(type, listener, options);
      };
      window.removeEventListener = function (type, listener, options) {
        if (relevant(type, listener)) active.get(type)?.delete(listener);
        remove(type, listener, options);
      };
      (window as any).listenerCounts = () =>
        Object.fromEntries([...active].map(([key, set]) => [key, set.size]));
    });
    await page.goto(origin + "/hmr-preferences");
    await page.waitForFunction(() => (window as any).generation === 1);
    await page.evaluate(() => {
      const w = window as any,
        original = Storage.prototype.setItem;
      w.restoreStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.endsWith(".v1.mode"))
          throw new DOMException("HMR quota", "QuotaExceededError");
        original.call(this, key, value);
      };
      w.oldSetMode = w.preferences.getState().setMode;
      w.oldSetMode("steer");
    });
    await expect(page.locator("output")).toContainText("HMR quota");
    for (const generation of [2, 3]) {
      const module = await server.moduleGraph.getModuleByUrl(modulePath);
      expect(module).toBeTruthy();
      await server.reloadModule(module!);
      await page.waitForFunction(
        (generation) => (window as any).generation === generation,
        generation,
      );
      const state = await page.evaluate(() =>
        JSON.parse(document.querySelector("output")!.textContent!),
      );
      expect(state).toMatchObject({
        mode: "steer",
        persistenceError: expect.stringContaining("HMR quota"),
      });
      expect(
        await page.evaluate(() => (window as any).listenerCounts()),
      ).toEqual({ storage: 1, focus: 1 });
    }
    await page.evaluate(() => {
      const w = window as any;
      w.restoreStorage();
      w.oldSetMode("steer");
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(document.querySelector("output")!.textContent!),
        ),
      )
      .toMatchObject({ mode: "steer", persistenceError: null });
    expect(
      await page.evaluate(() =>
        localStorage.getItem("kanban.session.followup-settings.v1.mode"),
      ),
    ).toBe('"steer"');
    await page.evaluate(() => {
      const original = Storage.prototype.getItem;
      (window as any).restorePreferenceReads = () => {
        Storage.prototype.getItem = original;
      };
      Storage.prototype.getItem = function (key) {
        if (key.endsWith(".v1.mode")) throw new Error("HMR read failure");
        return original.call(this, key);
      };
    });
    await server.reloadModule(
      (await server.moduleGraph.getModuleByUrl(modulePath))!,
    );
    await page.waitForFunction(() => (window as any).generation === 4);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(document.querySelector("output")!.textContent!),
        ),
      )
      .toMatchObject({
        mode: "steer",
        persistenceError: expect.stringContaining("HMR read failure"),
      });
    expect(await page.evaluate(() => (window as any).listenerCounts())).toEqual(
      { storage: 1, focus: 1 },
    );
    await page.evaluate(() => {
      (window as any).restorePreferenceReads();
      (window as any).preferences.getState().retryPersistence();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).preferences.getState().persistenceError,
        ),
      )
      .toBeNull();
    await page.reload();
    await page.waitForFunction(() => (window as any).generation === 1);
    await expect(page.locator("output")).toContainText('"mode":"steer"');
    expect(errors).toEqual([]);
    await info.attach("hmr-evidence", {
      body: JSON.stringify({
        origin,
        errors,
        generations: 4,
        activeListeners: { storage: 1, focus: 1 },
        savedMode: "steer",
      }),
      contentType: "application/json",
    });
  } finally {
    await context?.close().catch(() => {});
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
