import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const modules = {
  cache: "apps/web/src/session-mode/services/sessionCacheState.ts",
  recent: "apps/web/src/session-mode/components/codex/composer/recentView.ts",
  locale: "apps/web/src/session-mode/lib/i18n.ts",
};

for (const kind of ["cache", "recent", "locale"] as const) {
  test(`session ${kind} releases replaced module resources through real Vite HMR`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(45_000);
    const root = await mkdtemp(join(tmpdir(), "session-hmr-retention-"));
    const sources = Object.fromEntries(
      await Promise.all(
        Object.entries(modules).map(async ([name, path]) => [
          name,
          await readFile(path, "utf8"),
        ]),
      ),
    );
    await Promise.all(
      Object.entries(sources).map(([name, source]) =>
        writeFile(join(root, `${name}.ts`), source),
      ),
    );
    await writeFile(
      join(root, "stores.ts"),
      `
const sets={recent:new Set(),locale:new Set()};
const states={recent:{cards:[{id:'first'},{id:'second'}],currentAgentCardId:'first'},locale:{locale:'en'}};
window.__hmrProbe={updates:{cache:0,recent:0,locale:0},calls:{recent:0,locale:0},live:{recent:0,locale:0},maps:[],timings:[],owners:[],token:Math.random()};
function store(kind){return {getState:()=>states[kind],subscribe(fn){sets[kind].add(fn);window.__hmrProbe.live[kind]=sets[kind].size;return()=>{sets[kind].delete(fn);window.__hmrProbe.live[kind]=sets[kind].size;}}};}
export const useAgentCenterStore=store('recent');
export const useLocaleStore=store('locale');
window.__fire=(kind)=>{const before={...states[kind]};if(kind==='recent')states.recent.currentAgentCardId=before.currentAgentCardId==='first'?'second':'first';else states.locale.locale=before.locale==='en'?'zh':'en';for(const fn of sets[kind]){window.__hmrProbe.calls[kind]++;fn(states[kind],before);}return states[kind];};
`,
    );
    await writeFile(
      join(root, "i18next.ts"),
      `const i18n={isInitialized:false,language:'en',use(){return this},init(options){this.isInitialized=true;this.language=options.lng;return Promise.resolve()},changeLanguage(language){this.language=language;return Promise.resolve()}};window.__i18n=i18n;export default i18n;`,
    );
    await writeFile(
      join(root, "react-i18next.ts"),
      "export const initReactI18next={};",
    );
    await writeFile(
      join(root, "locales.ts"),
      "export const localeLabels={en:'English',zh:'中文'};export const localeResources={en:{},zh:{}};",
    );
    await writeFile(
      join(root, "main.ts"),
      `
import * as cache from './cache';import * as recent from './recent';import {initializeSessionI18n} from './locale';
void initializeSessionI18n();
function fill(m){const p=window.__hmrProbe;const text=new TextDecoder().decode(new Uint8Array(4*1024*1024).fill(65+p.updates.cache));m.cachedTranscriptBaselines.set('fixture',[{method:'item/agentMessage/delta',params:{threadId:'fixture',delta:text}}]);m.cachedTranscriptTimings.set('fixture',{turnId:'turn',status:'inProgress',startedAtMs:123,durationMs:null});p.owners.push(new WeakRef(m));p.maps.push(new WeakRef(m.cachedTranscriptBaselines));p.timings.push(new WeakRef(m.cachedTranscriptTimings));window.__currentCache=m;}
fill(cache);window.__recent=recent;
if(import.meta.hot){import.meta.hot.accept('./cache',m=>{window.__hmrProbe.updates.cache++;fill(m)});import.meta.hot.accept('./recent',m=>{window.__hmrProbe.updates.recent++;window.__recent=m});import.meta.hot.accept('./locale',m=>{void m.initializeSessionI18n();window.__hmrProbe.updates.locale++});}
`,
    );
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><title>Isolated session HMR</title><script type="module" src="/main.ts"></script>',
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: join(root, ".vite-cache"),
      resolve: {
        alias: {
          "@session/stores/useAgentCenterStore": join(root, "stores.ts"),
          "@session/stores/settings/useLocaleStore": join(root, "stores.ts"),
          "@session/locales": join(root, "locales.ts"),
          i18next: join(root, "i18next.ts"),
          "react-i18next": join(root, "react-i18next.ts"),
        },
      },
      server: {
        host: "0.0.0.0",
        port: 0,
        watch: { ignored: [] },
        fs: { allow: [root] },
      },
      logLevel: "error",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    const browserCdp = await browser.newBrowserCDPSession();
    const samples: any[] = [];
    try {
      await server.listen();
      const host =
        Object.values(networkInterfaces())
          .flat()
          .find((address) => address?.family === "IPv4" && !address.internal)
          ?.address ?? "127.0.0.1";
      const url = `http://${host}:${(server.httpServer.address() as { port: number }).port}`;
      const connected = page.waitForEvent("console", {
        predicate: (message) => message.text().includes("[vite] connected"),
        timeout: 10_000,
      });
      await page.goto(url);
      await connected;
      await page.waitForFunction(() => !!(window as any).__currentCache);
      const token = await page.evaluate(() => (window as any).__hmrProbe.token);
      await page.evaluate(() => {
        localStorage.setItem("draft-fixture", "keep draft");
        localStorage.setItem("history-fixture", "keep history");
      });
      const sample = async () => {
        // Causal HMR diagnostic only. Production never forces garbage collection.
        await cdp.send("HeapProfiler.collectGarbage");
        const heap = await cdp.send("Runtime.getHeapUsage");
        const state = await page.evaluate(() => {
          const p = (window as any).__hmrProbe;
          return {
            token: p.token,
            updates: { ...p.updates },
            live: { ...p.live },
            calls: { ...p.calls },
            disposed: p.owners.map(
              (r: any) => r.deref()?.isTranscriptCacheDisposed() ?? null,
            ),
            entries: p.maps.map((r: any) => r.deref()?.size ?? null),
            timings: p.timings.map((r: any) => r.deref()?.size ?? null),
            currentChars: (
              window as any
            ).__currentCache.cachedTranscriptBaselines.get("fixture")?.[0]
              .params.delta.length,
            draft: localStorage.getItem("draft-fixture"),
            history: localStorage.getItem("history-fixture"),
          };
        });
        const processInfo = await browserCdp.send("SystemInfo.getProcessInfo");
        samples.push({
          at: Date.now(),
          ...heap,
          ...state,
          ...(process.platform === "linux"
            ? sampleRendererRss(processInfo.processInfo)
            : {}),
        });
      };
      await sample();
      for (let version = 1; version <= 5; version++) {
        await writeFile(
          join(root, `${kind}.ts`),
          `${sources[kind]}\n// isolated fixture replacement ${version}\n`,
        );
        await expect
          .poll(
            () =>
              page.evaluate(
                (kind) => (window as any).__hmrProbe.updates[kind],
                kind,
              ),
            { timeout: 5000 },
          )
          .toBe(version);
        if (kind !== "cache")
          await page.evaluate((kind) => (window as any).__fire(kind), kind);
        await sample();
      }
      const result = {
        kind,
        url,
        sourcePath: modules[kind],
        sourceSha256: createHash("sha256").update(sources[kind]).digest("hex"),
        errors,
        samples,
        scope:
          "Actual source copied into isolated Vite with store/i18n stubs; five real HMR replacements; explicit GC diagnostic, not production or long-term RSS evidence.",
      };
      await writeFile(
        testInfo.outputPath("session-hmr-retention.json"),
        JSON.stringify(result, null, 2),
      );
      await testInfo.attach("session-hmr-retention.json", {
        body: JSON.stringify(result),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      for (const state of samples) {
        expect(state.token).toBe(token);
        expect(state.currentChars).toBe(4 * 1024 * 1024);
        expect(state.draft).toBe("keep draft");
        expect(state.history).toBe("keep history");
      }
      if (kind === "cache") {
        for (const state of samples) {
          expect(
            state.entries
              .slice(0, -1)
              .every((size: number | null) => size === 0 || size === null),
          ).toBe(true);
          expect(
            state.timings
              .slice(0, -1)
              .every((size: number | null) => size === 0 || size === null),
          ).toBe(true);
          expect(
            state.disposed
              .slice(0, -1)
              .every(
                (value: boolean | null) => value === true || value === null,
              ),
          ).toBe(true);
          expect(state.disposed.at(-1)).toBe(false);
          expect(state.entries.at(-1)).toBe(1);
          expect(state.timings.at(-1)).toBe(1);
        }
        expect(
          samples.at(-1).backingStorageSize - samples[0].backingStorageSize,
        ).toBeLessThan(8 * 1024 * 1024);
      } else {
        for (const state of samples) expect(state.live[kind]).toBe(1);
        expect(samples.at(-1).calls[kind]).toBe(5);
        if (kind === "recent")
          expect(
            await page.evaluate(() =>
              (window as any).__recent
                .recentViewedCards()
                .map((card: any) => card.id),
            ),
          ).toEqual(["second"]);
        else
          expect(
            await page.evaluate(() => (window as any).__i18n.language),
          ).toBe("zh");
      }
    } finally {
      await Promise.allSettled([cdp.detach(), browserCdp.detach()]);
      try {
        await server.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
}
