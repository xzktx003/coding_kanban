import { test, expect } from "@playwright/test";
import Fastify from "fastify";
import { writeFile, readFile } from "node:fs/promises";

test("website payload memory in a browser without a network-body inspector", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const vite = process.env.PLAYWRIGHT_BASE_URL!,
    app = Fastify();
  const browserCDP = await browser.newBrowserCDPSession();
  const errors: unknown[] = [];
  const heapChunks: string[] = [];
  let contextId = "",
    sessionId = "",
    id = 0;
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >();
  browserCDP.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === "HeapProfiler.addHeapSnapshotChunk")
      heapChunks.push(message.params.chunk);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description?.slice(
          0,
          2000,
        ) ?? message.params.exceptionDetails.text,
      );
    const wait = pending.get(message.id);
    if (wait) {
      pending.delete(message.id);
      message.error
        ? wait.reject(Error(message.error.message))
        : wait.resolve(message.result);
    }
  });
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      void browserCDP
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id: next, method, params }),
        })
        .catch(reject);
    });
  try {
    const source = await (
        await fetch(
          vite +
            "/src/session-mode/components/codex/presentation/NativeWebsitePreview.tsx",
        )
      ).text(),
      react = source.match(/from "([^"]+react\.js[^"]*)"/)?.[1];
    const main = await (await fetch(vite + "/src/main.tsx")).text(),
      client = main.match(/from "([^"]+react-dom_client\.js[^"]*)"/)?.[1];
    if (!react || !client)
      throw Error("Missing authoritative React dependency URL");
    app.get(
      "/api/session/api/codex/website-preview/capabilities",
      async () => ({ supported: true }),
    );
    app.post("/api/session/api/codex/website-preview", async (req) => {
      const index = Number(
        new URL((req.body as any).url).pathname.split("/").at(-1),
      );
      const bytes = Buffer.alloc(2 * 1024 * 1024);
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ).copy(bytes);
      bytes[bytes.length - 1] = index;
      return {
        status: "ready",
        title: `Image ${index}`,
        description: null,
        image: {
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
          width: 1,
          height: 1,
        },
      };
    });
    app.get("/memory", async (_req, reply) =>
      reply.type("text/html")
        .send(`<!doctype html><link rel=stylesheet href=/src/session-mode/components/codex/presentation/native-markdown.css?direct><style>.session-mode{--codex-secondary:#282a23;--codex-text:#ccc;--codex-link:#a9c5de;--vscode-font-family:system-ui}body{background:#20211d;color:#ccc}</style><div class="session-mode"><div id=root></div></div><script type=module>
  import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
  const {installReactPerformanceRetention}=await import('/src/lib/react-performance-retention.ts');installReactPerformanceRetention(performance,true);
  const rm=await import(${JSON.stringify(react)}),dm=await import(${JSON.stringify(client)}),R=rm.default??rm,{NativeWebsitePreview}=await import('/src/session-mode/components/codex/presentation/NativeWebsitePreview.tsx');await import('/src/session-mode/lib/i18n.ts');
  window.urlCounts={created:0,revoked:0};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=x=>{window.urlCounts.created++;return create(x)};URL.revokeObjectURL=x=>{window.urlCounts.revoked++;revoke(x)};
  window.root=(dm.default??dm).createRoot(document.getElementById('root'));window.root.render(R.createElement('div',{},...Array.from({length:120},(_,i)=>R.createElement(NativeWebsitePreview,{key:i,href:'https://example.com/memory/'+i},R.createElement('a',{id:'image-'+i,href:'https://example.com/memory/'+i,style:{marginRight:8}},'Image '+i)))));window.previewReady=true;
  </script>`),
    );
    app.get("/*", async (req, reply) => {
      const upstream = await fetch(vite + req.raw.url);
      return reply
        .code(upstream.status)
        .type(upstream.headers.get("content-type") ?? "text/plain")
        .send(Buffer.from(await upstream.arrayBuffer()));
    });
    await app.listen({ host: "0.0.0.0", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw Error("listener");
    const origin = `http://${new URL(vite).hostname}:${address.port}`;
    ({ browserContextId: contextId } = await browserCDP.send(
      "Target.createBrowserContext",
    ));
    const { targetId } = await browserCDP.send("Target.createTarget", {
      url: "about:blank",
      browserContextId: contextId,
    });
    ({ sessionId } = await browserCDP.send("Target.attachToTarget", {
      targetId,
      flatten: false,
    }));
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Runtime.runIfWaitingForDebugger");
    await send("Page.navigate", { url: origin + "/memory" });
    const evaluate = async (expression: string) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw Error(
          result.exceptionDetails.exception?.description ??
            "Browser evaluation failed",
        );
      return result.result?.value;
    };
    await expect
      .poll(() => evaluate("window.previewReady===true"), { timeout: 30000 })
      .toBe(true);
    const sample = async () => {
      await send("HeapProfiler.collectGarbage");
      await send("HeapProfiler.collectGarbage");
      await new Promise((r) => setTimeout(r, 1000));
      await send("HeapProfiler.collectGarbage");
      const heap = await send("Runtime.getHeapUsage"),
        { processInfo } = await browserCDP.send("SystemInfo.getProcessInfo");
      const renderers = await Promise.all(
        processInfo
          .filter((p: any) => p.type === "renderer")
          .map(async (p: any) => {
            try {
              return {
                pid: p.id,
                rss:
                  Number(
                    /VmRSS:\s+(\d+)/u.exec(
                      await readFile(`/proc/${p.id}/status`, "utf8"),
                    )?.[1] ?? 0,
                  ) * 1024,
              };
            } catch {
              return { pid: p.id, rss: null };
            }
          }),
      );
      return { ...heap, renderers };
    };
    const show = async (i: number) => {
      await evaluate(`document.getElementById('image-${i}').focus()`);
      await expect
        .poll(() =>
          evaluate(
            `document.querySelector('.codex-native-website-preview h3')?.textContent`,
          ),
        )
        .toBe(`Image ${i}`);
      await expect
        .poll(() =>
          evaluate(
            "(()=>{const image=document.querySelector('.codex-native-slack-body img');return !!image&&image.complete&&image.naturalWidth===1;})()",
          ),
        )
        .toBe(true);
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
    };
    // Wait for the actual capability negotiation before opening the first rich trigger.
    await new Promise((r) => setTimeout(r, 500));
    await show(0);
    const baseline = await sample();
    for (let i = 1; i < 40; i++) await show(i);
    await evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const after = await sample();
    for (let i = 40; i < 80; i++) await show(i);
    await evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const second = await sample();
    for (let i = 80; i < 120; i++) await show(i);
    await evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const third = await sample();
    await writeFile(
      info.outputPath("raw-browser-memory.json"),
      JSON.stringify(
        {
          baseline,
          after,
          second,
          third,
          diagnostic: await evaluate(
            "({urls:window.urlCounts,entries:performance.getEntries().filter(e=>e.entryType==='measure'||e.entryType==='mark').map(e=>({name:e.name,entryType:e.entryType,keys:Object.keys(e.detail??{}),devtools:e.detail?.devtools}))})",
          ),
          boundary:
            "Isolated unmanaged CDP browser context, actual HTTP through production frontend transport; Network domain never enabled, no HTTP-body inspector buffer. Test-only GC, renderer RSS recorded separately.",
        },
        null,
        2,
      ),
    );
    if (process.env.CODEX_WEBSITE_HEAP_SNAPSHOT === "1") {
      await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      await writeFile(
        info.outputPath("retention.heapsnapshot"),
        heapChunks.join(""),
      );
      heapChunks.length = 0;
    }
    const screenshot = await send("Page.captureScreenshot");
    await writeFile(
      info.outputPath("raw-browser-cards.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    expect(after.usedSize - baseline.usedSize).toBeLessThan(42 * 1024 * 1024);
    expect(after.backingStorageSize - baseline.backingStorageSize).toBeLessThan(
      42 * 1024 * 1024,
    );
    expect(
      second.backingStorageSize - baseline.backingStorageSize,
    ).toBeLessThan(42 * 1024 * 1024);
    expect(third.backingStorageSize - baseline.backingStorageSize).toBeLessThan(
      42 * 1024 * 1024,
    );
    expect(third.usedSize - baseline.usedSize).toBeLessThan(42 * 1024 * 1024);
    expect(third.renderers.length).toBe(1);
    expect(third.renderers[0].rss - after.renderers[0].rss).toBeLessThan(
      42 * 1024 * 1024,
    );
    expect(
      await evaluate("window.urlCounts.created-window.urlCounts.revoked"),
    ).toBe(0);
  } finally {
    await writeFile(
      info.outputPath("raw-browser-errors.json"),
      JSON.stringify(errors, null, 2),
    );
    if (contextId)
      await browserCDP.send("Target.disposeBrowserContext", {
        browserContextId: contextId,
      });
    await app.close();
  }
});
