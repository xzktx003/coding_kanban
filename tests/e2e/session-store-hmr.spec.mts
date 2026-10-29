import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(webRequire.resolve("vite")).href
);
const PAYLOAD_CHARS = 2 * 1024 * 1024;

test("Codex store HMR shares one current body while rebinding actions and preserving task state", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "kanban-store-hmr-acceptance-"));
  const source = await readFile(
    "apps/web/src/session-mode/components/codex/stores/useCodexStore.ts",
    "utf8",
  );
  const eventSource = (version: number) => `
export const createEventsSlice=(set)=>({events:{},turnTimingMap:{},probeDefault:${version},probeActionVersion:()=>${version},clearEvents(){set({events:{}});}});
`;
  await Promise.all([
    writeFile(join(root, "useCodexStore.ts"), source),
    writeFile(join(root, "eventsSlice.ts"), eventSource(0)),
    writeFile(
      join(root, "threadsSlice.ts"),
      "export const createThreadsSlice=()=>({threads:[],currentThreadId:null,getCurrentThread:()=>undefined});",
    ),
    writeFile(
      join(root, "queueSlice.ts"),
      "export const createQueueSlice=()=>({queuedMessages:[]});",
    ),
    // The actual module uses real Zustand state/subscribe/set/get semantics.
    // An empty hook wrapper avoids pulling a React renderer into this causal
    // module-lifetime fixture. It does not model full React application HMR.
    writeFile(
      join(root, "zustand.ts"),
      "import {createStore} from 'real-zustand-vanilla';export const create=()=>initializer=>Object.assign(function useBoundStore(){},createStore(initializer));",
    ),
    writeFile(
      join(root, "index.html"),
      '<!doctype html><title>Isolated Codex store HMR</title><script type="module" src="/main.ts"></script>',
    ),
    writeFile(
      join(root, "main.ts"),
      `
import * as owner from './useCodexStore';
window.__probe={generation:0,owners:[],stores:[],beforeFill:[],actions:[],token:Math.random()};
function fill(m){const p=window.__probe;const store=m.useCodexStore;
 if(p.generation){const s=store.getState();const text=s.events.fixture?.[0]?.params.item.text;p.beforeFill.push({chars:text?.length??0,first:text?.charCodeAt(0)??null,current:s.currentThreadId,status:s.turnTimingMap?.fixture?.status,queued:s.queuedMessages?.[0],defaultValue:s.probeDefault});}
 else{store.setState({currentThreadId:'fixture',turnTimingMap:{fixture:{turnId:'live',status:'inProgress'}},queuedMessages:['preserved-queued-item']});localStorage.setItem('fixture-draft','preserved draft');}
 const text=new TextDecoder().decode(new Uint8Array(${PAYLOAD_CHARS}).fill(65+p.generation));
 store.setState({events:{fixture:[{method:'item/completed',params:{threadId:'fixture',turnId:'live',item:{type:'agentMessage',id:'reply',text}}}]}});
 p.actions.push(store.getState().probeActionVersion());p.owners.push(new WeakRef(m));p.stores.push(new WeakRef(store));window.__current=m;
}
fill(owner);if(import.meta.hot)import.meta.hot.accept('./useCodexStore',m=>{window.__probe.generation++;fill(m)});
`,
    ),
  ]);
  const packageDir = dirname(webRequire.resolve("zustand/package.json"));
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: join(root, ".vite-cache"),
    resolve: {
      alias: [
        { find: /^zustand$/, replacement: join(root, "zustand.ts") },
        {
          find: /^real-zustand-vanilla$/,
          replacement: join(packageDir, "esm/vanilla.mjs"),
        },
      ],
    },
    server: {
      host: "0.0.0.0",
      port: 0,
      watch: { ignored: [] },
      fs: { allow: [root, process.cwd()] },
    },
    logLevel: "error",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  const samples: any[] = [];
  let url: string | undefined;
  try {
    await server.listen();
    const addresses = Object.values(networkInterfaces()).flat();
    const host =
      addresses.find(
        (address) =>
          address?.family === "IPv4" &&
          !address.internal &&
          address.address.startsWith("10."),
      )?.address ??
      addresses.find(
        (address) => address?.family === "IPv4" && !address.internal,
      )?.address ??
      "127.0.0.1";
    url = `http://${host}:${(server.httpServer!.address() as { port: number }).port}`;
    const connected = page.waitForEvent("console", {
      predicate: (message) => message.text().includes("[vite] connected"),
      timeout: 10_000,
    });
    await page.goto(url);
    await connected;
    await page.waitForFunction(() => !!(window as any).__current);
    const sample = async () => {
      // Diagnostic GC isolates retained source ownership; production never
      // forces collection. RSS is sampled with native renderer PID identities.
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      const state = await page.evaluate(() => {
        const p = (window as any).__probe;
        return {
          generation: p.generation,
          token: p.token,
          ownerAlive: p.owners.map((ref: WeakRef<any>) => !!ref.deref()),
          retainedChars: p.stores.map(
            (ref: WeakRef<any>) =>
              ref.deref()?.getState().events.fixture?.[0]?.params.item.text
                .length ?? 0,
          ),
          sameStore: p.stores.map(
            (ref: WeakRef<any>) =>
              ref.deref() === (window as any).__current.useCodexStore,
          ),
          uniqueStoreCount: new Set(
            p.stores.map((ref: WeakRef<any>) => ref.deref()).filter(Boolean),
          ).size,
          bodyCodes: p.stores.map(
            (ref: WeakRef<any>) =>
              ref
                .deref()
                ?.getState()
                .events.fixture?.[0]?.params.item.text.charCodeAt(0) ?? null,
          ),
          actions: [...p.actions],
          beforeFill: [...p.beforeFill],
          draft: localStorage.getItem("fixture-draft"),
        };
      });
      const processes = await browserCdp.send("SystemInfo.getProcessInfo");
      samples.push({
        ...heap,
        ...state,
        ...(process.platform === "linux"
          ? sampleRendererRss(processes.processInfo)
          : {}),
      });
    };
    await sample();
    for (let version = 1; version <= 5; version++) {
      // Let the completed watcher notification settle before the next write;
      // each dependency update changes a real action value, not only comments.
      await page.waitForTimeout(400);
      if (version <= 3)
        await writeFile(join(root, "eventsSlice.ts"), eventSource(version));
      else
        await writeFile(
          join(root, "useCodexStore.ts"),
          `${source}\nexport const fixtureDirectGeneration=${version};\n`,
        );
      await expect
        .poll(() => page.evaluate(() => (window as any).__probe.generation), {
          timeout: 10_000,
        })
        .toBe(version);
      await sample();
    }
    const first = samples[0],
      last = samples.at(-1);
    expect(errors).toEqual([]);
    expect(samples.every((sample) => sample.token === first.token)).toBe(true);
    expect(last.sameStore).toEqual(Array(6).fill(true));
    expect(last.uniqueStoreCount).toBe(1);
    expect(last.bodyCodes).toEqual(Array(6).fill(70));
    expect(last.retainedChars).toEqual(Array(6).fill(PAYLOAD_CHARS));
    expect(last.actions).toEqual([0, 1, 2, 3, 3, 3]);
    expect(last.beforeFill).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        chars: PAYLOAD_CHARS,
        first: 65 + index,
        current: "fixture",
        status: "inProgress",
        queued: "preserved-queued-item",
        defaultValue: 0,
      })),
    );
    expect(last.draft).toBe("preserved draft");
    expect(last.backingStorageSize - first.backingStorageSize).toBeLessThan(
      1024 * 1024,
    );
  } finally {
    await writeFile(
      testInfo.outputPath("codex-store-hmr.json"),
      JSON.stringify(
        {
          url,
          scope:
            "Actual store source, real Zustand vanilla, minimal slices and empty React hook wrapper; explicit diagnostic GC, no production HMR",
          errors,
          samples,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("codex-store-hmr.json", {
      path: testInfo.outputPath("codex-store-hmr.json"),
      contentType: "application/json",
    });
    await cdp.detach();
    await browserCdp.detach();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
