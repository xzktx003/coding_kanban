import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { build } = createRequire(requireWeb.resolve("vite/package.json"))(
  "esbuild",
);

/** Exact transport module; isolate URL/diagnostic/store dependencies, never EventSource. */
async function fixture() {
  const bundle = await build({
    stdin: {
      contents: `import { openEventStream } from ${JSON.stringify(resolve("apps/web/src/session-mode/lib/eventStream.ts"))};
        const probe = window.__backgroundProbe = { count: 0, last: 0, opens: 0, largest: 0, stop: null };
        probe.stop = openEventStream({ agents: ['codex'], onOpen() { probe.opens++; },
          onEvent(event) { probe.count++; probe.last = event.seq; probe.largest = Math.max(probe.largest, JSON.stringify(event).length); } });`,
      resolveDir: process.cwd(),
      sourcefile: "background-eventstream-probe.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    define: { "import.meta.hot": "undefined" },
    plugins: [
      {
        name: "transport-probe-dependencies",
        setup(builder: any) {
          builder.onResolve(
            {
              filter:
                /(?:hooks\/runtime|useSessionSyncStore|sessionConnectionDiagnostics)$/,
            },
            (args: any) => ({ path: args.path, namespace: "probe" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "probe" }, (args: any) => ({
            contents: args.path.includes("hooks/runtime")
              ? `export const buildEventUrl = path => '/api/session' + path;`
              : args.path.includes("useSessionSyncStore")
                ? `export const useSessionSyncStore = { setState(value) { window.__connection = value.connection; } };`
                : `export class SessionSyncError extends Error {};
         export const beginConnectionCheck = () => {}; export const connectionCheckFailed = () => {};
         export const connectionCheckSucceeded = () => {}; export const scheduleConnectionRetry = () => {};`,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const streams = new Set<ServerResponse>();
  const requests: string[] = [];
  let bytes = 0;
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url?.startsWith("/api/session/api/events")) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.flushHeaders();
      streams.add(response);
      request.on("close", () => streams.delete(response));
      return;
    }
    if (request.url === "/probe.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(bundle.outputFiles[0].text);
      return;
    }
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Background SSE probe</title><script>
        // Transparent instrumentation: constructor returns an actual Chromium native EventSource.
        window.__nativeSources=[];
        const NativeEventSource=window.EventSource;
        window.EventSource=new Proxy(NativeEventSource,{construct(Target,args){const source=new Target(...args);window.__nativeSources.push(source);return source;}});
        window.__isNative=source=>source instanceof NativeEventSource;
      </script><script type="module" src="/probe.js"></script>`);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "0.0.0.0", done));
  const host =
    process.env.PLAYWRIGHT_FIXTURE_HOST ??
    Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)
      ?.address;
  if (!host) {
    server.close();
    throw new Error(
      "A LAN interface or explicit PLAYWRIGHT_FIXTURE_HOST is required",
    );
  }
  const origin = `http://${host}:${(server.address() as { port: number }).port}`;
  return {
    origin,
    requests,
    connections: () =>
      requests.filter((path) => path.startsWith("/api/session/api/events")),
    send(seq: number) {
      const frame = `data: ${JSON.stringify({ seq, event: "codex:notification", payload: { method: "item/agentMessage/delta", params: { threadId: "fixture-thread", turnId: "fixture-turn", itemId: "fixture-item", delta: "x".repeat(1024) } } })}\n\n`;
      bytes += Buffer.byteLength(frame);
      for (const stream of streams) stream.write(frame);
    },
    bytes: () => bytes,
    async close() {
      for (const stream of streams) stream.end();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function hide(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
  });
}
async function wake(
  page: import("@playwright/test").Page,
  trigger: "visibilitychange" | "pageshow" | "focus",
) {
  await page.evaluate((trigger) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    if (trigger === "visibilitychange")
      document.dispatchEvent(new Event(trigger));
    else
      window.dispatchEvent(
        trigger === "pageshow"
          ? new PageTransitionEvent(trigger, { persisted: true })
          : new Event(trigger),
      );
  }, trigger);
}

for (const trigger of ["visibilitychange", "pageshow", "focus"] as const) {
  test(`background SSE stays live and ${trigger} repairs silent CLOSED with the original cursor`, async ({
    page,
  }, info) => {
    const f = await fixture();
    try {
      await page.goto(f.origin);
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__backgroundProbe?.opens),
        )
        .toBe(1);
      await hide(page);
      for (let seq = 1; seq <= 12; seq++) f.send(seq);
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).__backgroundProbe?.count),
        )
        .toBe(12);
      expect(f.connections()).toHaveLength(1);
      expect(
        await page.evaluate(() => ({
          ready: (window as any).__nativeSources[0].readyState,
          native: (window as any).__isNative(
            (window as any).__nativeSources[0],
          ),
        })),
      ).toEqual({ ready: 1, native: true });
      await wake(page, trigger);
      await page.waitForTimeout(100);
      expect(f.connections()).toHaveLength(1); // Healthy OPEN must never be replaced by foregrounding.
      await hide(page);
      // Native close is deliberately silent: there is no error callback or automatic browser retry.
      await page.evaluate(() => (window as any).__nativeSources[0].close());
      expect(
        await page.evaluate(
          () => (window as any).__nativeSources[0].readyState,
        ),
      ).toBe(2);
      await wake(page, trigger);
      await expect
        .poll(() => f.connections().length, { timeout: 2000 })
        .toBe(2);
      expect(
        new URL(f.connections()[1], f.origin).searchParams.get("since"),
      ).toBe("12");
      f.send(13);
      await expect
        .poll(() => page.evaluate(() => (window as any).__backgroundProbe.last))
        .toBe(13);
      expect(
        f.requests.filter((path) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))/.test(
            path,
          ),
        ),
      ).toEqual([]);
      const sample = await page.evaluate(() => ({
        count: (window as any).__backgroundProbe.count,
        largest: (window as any).__backgroundProbe.largest,
        native: (window as any).__nativeSources.every(
          (window as any).__isNative,
        ),
      }));
      expect(sample).toMatchObject({ count: 13, native: true });
      expect(sample.largest).toBeLessThan(2048);
      await info.attach("background-http-evidence", {
        body: JSON.stringify({
          ...sample,
          bytes: f.bytes(),
          connections: f.connections(),
          boundary:
            "Native HTTP/EventSource with synthetic visibility events. Counter-only probe retains no message body; no forced GC, physical mobile suspension or memory plateau claim.",
        }),
        contentType: "application/json",
      });
    } finally {
      await page
        .evaluate(() => (window as any).__backgroundProbe?.stop?.())
        .catch(() => {});
      await f.close();
    }
  });
}
