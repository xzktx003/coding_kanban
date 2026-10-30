// Explicit isolated native-HTTP acceptance. Never proxies APIs or starts a model/task service.
// Raw CDP preserves all Network callbacks with one fixed debugger-body cache budget.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { sampleRendererRss } from "../../../scripts/session-renderer-memory.mjs";
const require = createRequire(resolve("packages/session-runtime/package.json"));
const WebSocket = require("ws"); // Declared dependency, also supported on Node 20.19.
const { attachSessionMemoryHmrProxy } = await import(
  "./session-memory-hmr-proxy.mjs"
);
const switches = require(
  resolve(
    "node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js",
  ),
).chromiumSwitches(false);
const { installSessionUxFixture } = require(
    resolve("tests/e2e/session-ux-fixture.ts"),
  ),
  { liveStream } = require(resolve("tests/e2e/session-sse-fixture.ts"));
const frontend = new URL(process.env.MEMORY_FRONTEND_ORIGIN!),
  binary = process.env.PROBE_CHROME_BIN!;
assert.ok(["http:", "https:"].includes(frontend.protocol));
assert.ok(
  !frontend.username &&
    !frontend.password &&
    frontend.pathname === "/" &&
    !frontend.search &&
    !frontend.hash,
  "Source must be an explicit origin without credentials or path",
);
assert.ok(binary?.startsWith("/"));
const minutes = Number(process.env.SESSION_NATIVE_HTTP_MEMORY_MINUTES ?? 0);
assert.ok(
  minutes === 30 ||
    (process.env.SESSION_NATIVE_HTTP_MEMORY_SMOKE === "1" &&
      minutes > 0 &&
      minutes <= 1),
  "Explicit 30 minutes or labelled <=1 minute smoke required",
);
assert.equal(
  process.platform,
  "linux",
  "Exact renderer RSS acceptance requires Linux",
);
const modes = ["capped"];
const output = process.env.SESSION_NATIVE_HTTP_MEMORY_OUTPUT;
assert.ok(output?.startsWith("/"), "Explicit absolute fresh output required");
await mkdir(output, { recursive: false });
const freeze = process.env.SESSION_NATIVE_HTTP_MEMORY_FREEZE;
assert.ok(
  freeze?.startsWith("/"),
  "Explicit immutable frontend freeze required",
);
const sha = (data: any) => createHash("sha256").update(data).digest("hex");
const driverSha = sha(await readFile(new URL(import.meta.url)));
function ticks(stat: string) {
  return stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/)[19];
}
const sourceRecordPath = process.env.SESSION_NATIVE_HTTP_MEMORY_SOURCE_RECORD;
assert.ok(
  sourceRecordPath?.startsWith("/"),
  "Explicit source listener ownership record required",
);
async function sourceIdentity() {
  const record = JSON.parse(await readFile(sourceRecordPath!, "utf8"));
  assert.equal(record.lanUrl, frontend.origin);
  assert.equal(record.run, freeze);
  assert.equal(
    record.nativeHttpFixture,
    false,
    "Memory source must not inject another workload/API fixture",
  );
  assert.equal(
    record.fixtureHtmlInits,
    false,
    "Memory source must have no foreign HTML fixture initialization",
  );
  assert.equal(record.apiProxy, false);
  assert.equal(record.watcher, false);
  assert.equal(record.hmr, true);
  assert.ok(
    typeof record.launcherPath === "string" &&
      record.launcherPath.startsWith("/"),
    "Actual clean source launcher must be recorded",
  );
  assert.ok(
    Number.isSafeInteger(record.pid) &&
      record.pid > 0 &&
      /^\d+$/.test(record.startTicks),
  );
  assert.equal(
    ticks(await readFile(`/proc/${record.pid}/stat`, "utf8")),
    record.startTicks,
    "Frozen listener identity changed",
  );
  return {
    pid: record.pid,
    startTicks: record.startTicks,
    launcherPath: record.launcherPath,
    launcherSha256: sha(await readFile(record.launcherPath)),
    nativeHttpFixture: false,
    fixtureHtmlInits: false,
    apiProxy: false,
    watcher: false,
    hmr: true,
  };
}
async function verifySources() {
  const manifest = await readFile(join(freeze!, "source-manifest.json")),
    configuration = await readFile(
      join(freeze!, "configuration-manifest.json"),
    );
  const workspaceDependency = await readFile(
    join(freeze!, "workspace-dependency-manifest.json"),
  );
  const rows = JSON.parse(String(manifest)),
    config = JSON.parse(String(configuration)),
    dependencies = JSON.parse(String(workspaceDependency));
  assert.ok(
    Array.isArray(dependencies) && dependencies.length > 0,
    "Actual workspace dependencies must be frozen too",
  );
  for (const row of dependencies) {
    assert.ok(
      typeof row.path === "string" &&
        !row.path.startsWith("/") &&
        !row.path.split("/").includes("..") &&
        /^[a-f0-9]{64}$/.test(row.sha256),
    );
    assert.equal(
      sha(await readFile(join(freeze!, "packages/shared", row.path))),
      row.sha256,
      "Frozen workspace dependency changed: " + row.path,
    );
    assert.equal(
      sha(await readFile(resolve("packages/shared", row.path))),
      row.sha256,
      "Working dependency differs: " + row.path,
    );
  }
  assert.ok(Array.isArray(rows) && rows.length > 0);
  for (const row of rows) {
    assert.ok(
      typeof row.path === "string" &&
        !row.path.startsWith("/") &&
        !row.path.split("/").includes("..") &&
        /^[a-f0-9]{64}$/.test(row.sha256),
    );
    assert.equal(
      sha(await readFile(join(freeze!, "web", row.path))),
      row.sha256,
      "Frozen source changed: " + row.path,
    );
    assert.equal(
      sha(await readFile(resolve("apps/web", row.path))),
      row.sha256,
      "Working frontend differs: " + row.path,
    );
  }
  for (const row of config) {
    assert.ok(
      typeof row.path === "string" &&
        !row.path.startsWith("/") &&
        !row.path.split("/").includes("..") &&
        /^[a-f0-9]{64}$/.test(row.sha256),
    );
    assert.equal(
      sha(await readFile(resolve(row.path))),
      row.sha256,
      "Configuration changed: " + row.path,
    );
  }
  return {
    frontend: frontend.origin,
    freeze,
    files: rows.length,
    workspaceDependencyFiles: dependencies.length,
    workspaceDependencyManifestSha256: sha(workspaceDependency),
    manifestSha256: sha(manifest),
    configurationSha256: sha(configuration),
    driverSha256: driverSha,
    sourceListener: await sourceIdentity(),
    consumedHarnessInputs: await Promise.all(
      [
        "tests/e2e/session-native-http-memory.spec.mts",
        "tests/e2e/session-ux-fixture.ts",
        "tests/e2e/session-sse-fixture.ts",
        "tests/e2e/session-management-fixture.ts",
        "apps/server/src/routes/session-management.ts",
        "apps/server/src/routes/session-client-control.ts",
        "packages/shared/src/session-tabs.ts",
        "packages/shared/src/session-projects.ts",
        "scripts/session-renderer-memory.mjs",
        "tests/e2e/helpers/session-memory-hmr-proxy.mjs",
        "packages/session-runtime/package.json",
        "node_modules/.pnpm/playwright-core@1.58.2/node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js",
      ].map(async (path) => ({
        path,
        sha256: sha(await readFile(resolve(path))),
      })),
    ),
  };
}
const sourcesBefore = await verifySources();
await writeFile(
  join(output!, "sources-before.json"),
  JSON.stringify(sourcesBefore, null, 2),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cancelled = false;
process.once("SIGTERM", () => {
  cancelled = true;
});
function glob(pattern: string | RegExp) {
  if (pattern instanceof RegExp) return pattern;
  return new RegExp(
    "^" +
      pattern
        .split("**")
        .map((p) =>
          p
            .split("*")
            .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
        )
        .join(".*") +
      "$",
  );
}
async function fixtureServer() {
  const routes: Array<{ match: RegExp; handler: any }> = [],
    inits: string[] = [],
    closeCallbacks: Function[] = [];
  const proxyErrors: string[] = [];
  const traffic = {
    apiRequests: 0,
    apiBytes: 0,
    sourceRequests: 0,
    sourceBytes: 0,
    nativeSseBytes: 0,
    nativeSseChunks: 0,
    nativeSseRequests: 0,
  };
  const requests: Record<string, number> = {};
  const emitted = { count: 0, jsonBytes: 0, frameBytes: 0 };
  let sseUpstream = "";
  const duck: any = {
    addInitScript: async (fn: Function, arg?: any) => {
      if (arg?.origin && !sseUpstream) sseUpstream = arg.origin;
      inits.push(
        `(()=>{const __name=(fn,name)=>fn;return (${fn.toString()})(${arg === undefined ? "undefined" : JSON.stringify(arg)});})();`,
      );
    },
    once: (event: string, fn: Function) => {
      assert.equal(event, "close");
      closeCallbacks.push(fn);
    },
    routeWebSocket: async () => {},
    route: async (pattern: any, handler: any) =>
      routes.push({ match: glob(pattern), handler }),
  };
  const fixture = await installSessionUxFixture(duck, 3);
  for (const thread of fixture.threads)
    (thread as any).turns = Array.from({ length: 8 }, (_, i) => ({
      id: `${thread.id}-${i}`,
      status: "completed",
      startedAt: i + 1,
      durationMs: 1,
      items: [
        {
          type: "agentMessage",
          id: `answer-${i}`,
          text: `${thread.id} answer ${i}\n${"history ".repeat(8000)}`,
        },
      ],
    }));
  await duck.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, async (route: any) =>
    route.fulfill({
      json: {
        data: fixture.threads.map((t) => ({ ...t, turns: [] })),
        nextCursor: null,
      },
    }),
  );
  const cards = fixture.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await duck.route("**/api/session/tabs", (route: any) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await duck.addInitScript(
    ({ cards }: any) => {
      localStorage.setItem(
        "kanban.session.settings-storage",
        JSON.stringify({ version: 13, state: { warmFollowedSessions: true } }),
      );
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
      localStorage.setItem(
        "kanban.session.layout-storage",
        JSON.stringify({
          version: 0,
          state: {
            isSidebarOpen: false,
            isRightPanelOpen: false,
            view: "agent",
          },
        }),
      );
    },
    { cards },
  );
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, origin);
      requests[req.method + " " + url.pathname] =
        (requests[req.method + " " + url.pathname] ?? 0) + 1;
      if (url.pathname === "/native-http-events") {
        assert.ok(sseUpstream, "Missing stock EventSource origin");
        traffic.nativeSseRequests++;
        const upstream = httpRequest(
          new URL("/events" + url.search, sseUpstream),
          { method: "GET" },
          (response) => {
            res.writeHead(response.statusCode ?? 200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
            });
            res.flushHeaders();
            response.on("data", (c) => {
              traffic.nativeSseBytes += c.length;
              traffic.nativeSseChunks++;
              if (!res.write(c)) response.pause();
            });
            res.on("drain", () => response.resume());
            response.once("end", () => res.end());
            response.on("error", (e) => {
              proxyErrors.push(String(e));
              res.destroy(e);
            });
          },
        );
        upstream.on("error", (e) => {
          if (!res.destroyed) proxyErrors.push(String(e));
          res.destroy();
        });
        res.on("close", () => upstream.destroy());
        upstream.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        traffic.apiRequests++;
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const c of req) {
          size += c.length;
          if (size > 2 * 1024 * 1024)
            throw new Error("Fixture request over budget");
          chunks.push(Buffer.from(c));
        }
        const body = Buffer.concat(chunks).toString("utf8");
        let matched = false;
        for (const entry of [...routes].reverse()) {
          entry.match.lastIndex = 0;
          if (!entry.match.test(url.href)) continue;
          matched = true;
          let fulfilled = false;
          await entry.handler({
            request: () => ({
              url: () => url.href,
              method: () => req.method,
              postDataJSON: () => (body ? JSON.parse(body) : null),
            }),
            fulfill: async (v: any) => {
              fulfilled = true;
              const payload =
                  v.json === undefined
                    ? (v.body ?? "")
                    : JSON.stringify(v.json),
                bytes = Buffer.isBuffer(payload)
                  ? payload
                  : Buffer.from(payload);
              traffic.apiBytes += bytes.length;
              res.writeHead(v.status ?? 200, {
                "content-type":
                  v.contentType ??
                  (v.json === undefined ? "text/plain" : "application/json"),
                "cache-control": "no-store",
                ...v.headers,
              });
              res.end(bytes);
            },
          });
          if (!fulfilled)
            throw new Error(
              "Stock fixture did not fulfill its matched request",
            );
          break;
        }
        if (!matched)
          throw new Error("Unmatched API request; never proxy to a formal API");
        return;
      }
      traffic.sourceRequests++;
      const target = new URL(url.pathname + url.search, frontend),
        request = target.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = request(
        target,
        {
          method: "GET",
          headers: {
            accept: req.headers.accept ?? "*/*",
            "accept-encoding": "identity",
          },
          ...(target.protocol === "https:"
            ? { rejectUnauthorized: false }
            : {}),
        },
        (response) => {
          const headers = { ...response.headers };
          delete headers.connection;
          delete headers["transfer-encoding"];
          if (String(headers["content-type"]).includes("text/html")) {
            const chunks: Buffer[] = [];
            response.on("data", (c) => chunks.push(Buffer.from(c)));
            response.once("end", () => {
              let html = Buffer.concat(chunks).toString("utf8");
              html = html.replace(
                /<head[^>]*>/i,
                (head) => head + `<script>${inits.join("\n")}</script>`,
              );
              delete headers["content-length"];
              traffic.sourceBytes += Buffer.byteLength(html);
              res.writeHead(response.statusCode ?? 200, headers);
              res.end(html);
            });
          } else {
            res.writeHead(response.statusCode ?? 200, headers);
            response.on("data", (c) => {
              traffic.sourceBytes += c.length;
            });
            response.pipe(res);
          }
        },
      );
      upstream.on("error", (e) => {
        proxyErrors.push(String(e));
        if (!res.headersSent) res.writeHead(502);
        res.end("Owned source proxy unavailable");
      });
      req.on("aborted", () => upstream.destroy());
      upstream.end();
    } catch (e) {
      proxyErrors.push(String(e));
      if (!res.headersSent) res.writeHead(500);
      res.end("Owned fixture failure");
    }
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  origin = `http://${frontend.hostname}:${(server.address() as any).port}`;
  const hmrProxy = attachSessionMemoryHmrProxy({
    server,
    sourceOrigin: frontend.origin,
    proxyOrigin: origin,
    verifySource: async (signal: AbortSignal) => {
      if (signal.aborted) throw new Error("HMR source verification aborted");
      assert.deepEqual(
        await sourceIdentity(),
        sourcesBefore.sourceListener,
        "Owned HMR source identity changed",
      );
      if (signal.aborted) throw new Error("HMR source verification aborted");
    },
  });
  const stream = await liveStream(duck, origin);
  await duck.addInitScript(
    ({ origin }: any) => {
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          const parsed = new URL(String(url), location.href);
          super(
            parsed.pathname.endsWith("/api/events")
              ? origin + "/native-http-events" + parsed.search
              : url,
            options,
          );
        }
      };
    },
    { origin },
  );
  const stockEmit = stream.emit;
  stream.emit = (seq: number, payload: any) => {
    const bytes = Buffer.byteLength(
      JSON.stringify({ seq, event: "codex:notification", payload }),
    );
    emitted.count++;
    emitted.jsonBytes += bytes;
    emitted.frameBytes += bytes + 8;
    stockEmit(seq, payload);
  };
  return {
    origin,
    fixture,
    stream,
    traffic,
    requests,
    emitted,
    proxyErrors,
    hmrProxy,
    async close() {
      await stream.close();
      for (const c of closeCallbacks) c();
      await hmrProxy.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
for (const mode of modes) {
  if (cancelled) break;
  const owned = await fixtureServer(),
    home = await mkdtemp(join(tmpdir(), "kanban-actual-page-raw-"));
  const args = [
    ...switches,
    "--enable-unsafe-swiftshader",
    "--headless",
    "--hide-scrollbars",
    "--mute-audio",
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${home}`,
    "--no-startup-window",
  ];
  const browser = spawn(binary, args, { stdio: "ignore" });
  assert.ok(browser.pid);
  const ownedStartTicks = ticks(
    await readFile(`/proc/${browser.pid}/stat`, "utf8"),
  );
  assert.ok(/^\d+$/.test(ownedStartTicks!));
  const samples: any[] = [],
    errors: string[] = [],
    eventCounts: Record<string, number> = {},
    audio = { created: 0, active: new Set<string>(), peakActive: 0 },
    streamSequence = {
      last: 0,
      count: 0,
      gaps: 0,
      duplicates: 0,
      jsonBytes: 0,
    };
  const networkBytes = { dataLength: 0, encodedDataLength: 0 };
  const tabSwitches: any[] = [];
  let ws: any,
    pending = new Map<number, any>(),
    id = 0,
    sid = "",
    cycles = 0,
    unreadChecks = 0;
  const result: any = {
    mode,
    minutes,
    binary,
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
    ownedBrowserPid: browser.pid,
    ownedBrowserStartTicks: ownedStartTicks,
    args,
    browserVersion: execFileSync(binary, ["--version"], {
      encoding: "utf8",
    }).trim(),
    frontend: frontend.origin,
    proxy: owned.origin,
    networkAgentEnabled: mode !== "none",
    observerBodyCacheBudget:
      mode === "capped"
        ? {
            maxTotalBufferSize: 4 * 1024 * 1024,
            maxResourceBufferSize: 1024 * 1024,
          }
        : mode === "network"
          ? "Chrome default"
          : "disabled",
    experimentalDriverSha256: driverSha,
    sourcesBefore,
    stockThresholds: {
      heapLowRiseBytes: 64 * 1024 * 1024,
      heapPeakBytes: 256 * 1024 * 1024,
      rssLowRiseBytes: 128 * 1024 * 1024,
      rssPeakBytes: 768 * 1024 * 1024,
      firstWindowSeconds: [90, 300],
      lastWindowSeconds: 180,
    },
    runtimeEvaluateUserGesture: true,
    naturalGC: true,
    formalAcceptance: false,
    samples,
  };
  try {
    let active = "";
    for (let i = 0; i < 200; i++) {
      try {
        active = await readFile(join(home, "DevToolsActivePort"), "utf8");
        break;
      } catch {}
      await sleep(50);
    }
    assert.ok(active, "Owned Chrome did not publish CDP");
    const [port, path] = active.trim().split("\n");
    ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((r, j) => {
      ws!.onopen = () => r();
      ws!.onerror = j;
    });
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(String(data));
      if (m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error
          ? p.reject(new Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
        return;
      }
      eventCounts[m.method] = (eventCounts[m.method] ?? 0) + 1;
      if (m.method === "Network.dataReceived") {
        networkBytes.dataLength += m.params.dataLength;
        networkBytes.encodedDataLength += m.params.encodedDataLength;
      }
      if (m.method === "Network.eventSourceMessageReceived") {
        streamSequence.jsonBytes += Buffer.byteLength(m.params.data);
        const n = Number(
          /^\{\"seq\":(\d+),/.exec(String(m.params.data).slice(0, 80))?.[1],
        );
        if (Number.isSafeInteger(n) && n > 0) {
          if (n <= streamSequence.last) streamSequence.duplicates++;
          else if (n !== streamSequence.last + 1) streamSequence.gaps++;
          streamSequence.last = n;
          streamSequence.count++;
        }
      }
      if (m.method === "Runtime.exceptionThrown")
        errors.push(
          String(
            m.params.exceptionDetails?.exception?.description ??
              m.params.exceptionDetails?.text,
          ).slice(0, 1000),
        );
      if (m.method === "WebAudio.contextCreated") {
        audio.created++;
        if (m.params.context.contextState !== "closed")
          audio.active.add(m.params.context.contextId);
        audio.peakActive = Math.max(audio.peakActive, audio.active.size);
      }
      if (
        m.method === "WebAudio.contextChanged" &&
        m.params.context.contextState === "closed"
      )
        audio.active.delete(m.params.context.contextId);
      if (m.method === "WebAudio.contextWillBeDestroyed")
        audio.active.delete(m.params.contextId);
    };
    const send = (method: string, params: any = {}, sessionId?: string) =>
      new Promise<any>((resolve, reject) => {
        const key = ++id,
          timer = setTimeout(() => {
            pending.delete(key);
            reject(new Error("CDP deadline: " + method));
          }, 30000);
        pending.set(key, { resolve, reject, timer });
        ws!.send(
          JSON.stringify({
            id: key,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    const evaluate = async (fn: Function, arg?: any) => {
      const r = await send(
        "Runtime.evaluate",
        {
          expression: `(()=>{const __name=(fn,name)=>fn;return (${fn.toString()})(${arg === undefined ? "undefined" : JSON.stringify(arg)});})()`,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
        sid,
      );
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    };
    const target = await send("Target.createTarget", { url: "about:blank" });
    sid = (
      await send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      })
    ).sessionId;
    await send("Runtime.enable", {}, sid);
    await send("Page.enable", {}, sid);
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
      sid,
    );
    await send("WebAudio.enable", {}, sid);
    if (mode !== "none")
      await send(
        "Network.enable",
        mode === "capped"
          ? {
              maxTotalBufferSize: 4 * 1024 * 1024,
              maxResourceBufferSize: 1024 * 1024,
            }
          : {},
        sid,
      );
    await send("Page.navigate", { url: owned.origin + "/?mode=session" }, sid);
    const readyUntil = Date.now() + 60000;
    while (Date.now() < readyUntil) {
      try {
        if (
          await evaluate(async () => {
            const p = "/src/session-mode/components/codex/stores/index.ts";
            const url =
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === p)?.name ?? p;
            const { useCodexStore } = await import(url);
            return (
              ["ux-0", "ux-1", "ux-2"].every(
                (k) => useCodexStore.getState().events[k]?.length,
              ) &&
              !!document.querySelector('[data-codex-transcript-shell="ux-0"]')
            );
          })
        )
          break;
      } catch {}
      await sleep(100);
    }
    assert.ok(
      Date.now() < readyUntil,
      "Actual page failed warm-body prerequisites",
    );
    await evaluate(async () => {
      const module = (p: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
        );
      const { useCodexStore, useApprovalStore } = await module(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useSessionDraftStore } = await module(
        "/src/session-mode/stores/useSessionDraftStore.ts",
      );
      const { useSessionAttentionStore } = await module(
        "/src/session-mode/stores/useSessionAttentionStore.ts",
      );
      const { estimateTranscriptBytes } = await module(
        "/src/session-mode/services/codexTranscriptMemoryBudget.ts",
      );
      const { openEventStream } = await module(
        "/src/session-mode/lib/eventStream.ts",
      );
      const appSequence = {
        last: 0,
        count: 0,
        gaps: 0,
        duplicates: 0,
        unexpected: 0,
      };
      const unsubscribe = openEventStream({
        label: "native-http-memory-scalar-proof",
        onEvent: (event: any) => {
          if (event.event !== "codex:notification") {
            appSequence.unexpected++;
            return;
          }
          if (event.seq <= appSequence.last) appSequence.duplicates++;
          else if (event.seq !== appSequence.last + 1) appSequence.gaps++;
          appSequence.last = event.seq;
          appSequence.count++;
        },
      });
      (window as any).__idleMemory = {
        appSequence,
        unsubscribe,
        codex: useCodexStore,
        approvals: useApprovalStore,
        drafts: useSessionDraftStore,
        attention: useSessionAttentionStore,
        estimateTranscriptBytes,
      };
      useSessionDraftStore
        .getState()
        .setText("memory-fixture-draft", "keep my unsent draft");
      useApprovalStore.setState({
        pendingApprovals: [
          {
            type: "commandExecution",
            requestId: "memory-fixture-approval",
            threadId: "ux-1",
            turnId: "running",
            itemId: "command",
          },
        ],
      });
    });
    const start = Date.now();
    let sequence = 0;
    const select = async (key: string) => {
      const position = await evaluate((key: string) => {
        const tab = document.querySelector(
          `[data-tab-key="codex:${key}"]`,
        ) as HTMLElement;
        if (!tab) throw new Error("Missing exact tab " + key);
        tab.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = tab.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + 12 };
      }, key);
      await send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", ...position, button: "left", clickCount: 1 },
        sid,
      );
      await send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", ...position, button: "left", clickCount: 1 },
        sid,
      );
      const deadline = Date.now() + 2000;
      while (
        !(await evaluate(
          (key: string) =>
            document
              .querySelector(`[data-tab-key="codex:${key}"]`)
              ?.getAttribute("aria-selected") === "true",
          key,
        )) &&
        Date.now() < deadline
      )
        await sleep(10);
      assert.ok(Date.now() < deadline, "Native input did not select exact tab");
      tabSwitches.push({
        cycle: cycles,
        target: key,
        seconds: (Date.now() - start) / 1000,
      });
    };
    while (!cancelled && Date.now() - start < minutes * 60000) {
      const target = owned.fixture.threads[cycles % 2] as any,
        turn = {
          id: `soak-${cycles}`,
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
          durationMs: 1,
          items: [
            {
              type: "agentMessage",
              id: `answer-${cycles}`,
              text: `soak reply ${cycles}: ${"bounded final ".repeat(1200)}`,
            },
          ],
        };
      target.turns.push(turn);
      owned.stream.emit(++sequence, {
        method: "turn/started",
        params: {
          threadId: target.id,
          turn: { ...turn, status: "inProgress", items: [] },
        },
      });
      for (let i = 0; i < 30; i++)
        owned.stream.emit(++sequence, {
          method: "item/agentMessage/delta",
          params: {
            threadId: target.id,
            turnId: turn.id,
            itemId: `answer-${cycles}`,
            delta: `${cycles}:${i}:${"delta ".repeat(1000)}`,
          },
        });
      owned.stream.emit(++sequence, {
        method: "turn/completed",
        params: { threadId: target.id, turn },
      });
      if (cycles % 40 === 20) await select("ux-1");
      if (cycles % 40 === 21) await select("ux-0");
      await sleep(2000);
      const heap = await send("Runtime.getHeapUsage", {}, sid),
        dom = await send("Memory.getDOMCounters", {}, sid),
        processes = await send("SystemInfo.getProcessInfo");
      const memory = sampleRendererRss(processes.processInfo);
      const state = await evaluate(() => {
        const w = (window as any).__idleMemory,
          s = w.codex.getState();
        return {
          appSequence: { ...w.appSequence },
          unread: Object.fromEntries(
            ["codex:ux-0", "codex:ux-1"].map((k) => [
              k,
              w.attention.getState().receipts[k],
            ]),
          ),
          reactMeasures: performance
            .getEntriesByType("measure")
            .filter(
              (e: any) =>
                e.detail?.devtools?.track === "Components ⚛" ||
                e.detail?.devtools?.trackGroup === "Scheduler ⚛",
            ).length,
          bodyBytes: Object.fromEntries(
            Object.entries(s.events).map(([k, v]) => [
              k,
              w.estimateTranscriptBytes(v),
            ]),
          ),
          draft: w.drafts.getState().drafts["memory-fixture-draft"]?.text,
          approvals: w.approvals.getState().pendingApprovals.length,
        };
      });
      assert.deepEqual(state.appSequence, {
        last: sequence,
        count: sequence,
        gaps: 0,
        duplicates: 0,
        unexpected: 0,
      });
      assert.ok(
        state.unread["codex:" + target.id]?.completed?.some(
          (r: any) => r.id === turn.id,
        ),
        "Exact production completion receipt missing for " +
          target.id +
          "/" +
          turn.id,
      );
      assert.equal(state.reactMeasures, 0);
      assert.equal(state.draft, "keep my unsent draft");
      assert.equal(state.approvals, 1);
      assert.ok(audio.active.size <= 1 && audio.peakActive <= 1);
      if (cycles % 40 >= 16 && cycles % 40 < 20 && Date.now() - start > 90000) {
        assert.ok(
          Object.values(state.bodyBytes).every(
            (v) => Number(v) <= 8 * 1024 * 1024,
          ),
        );
        assert.ok(
          Object.entries(state.bodyBytes).reduce(
            (n, [key, v]) => (key === "ux-0" ? n : n + Number(v)),
            0,
          ) <=
            16 * 1024 * 1024,
        );
      }
      if (cycles % 2 === 1 && cycles % 40 !== 21) {
        const receipt = state.unread["codex:ux-1"];
        assert.ok(
          receipt?.completed?.some((r: any) => r.id === "soak-" + cycles),
          "Background completion receipt missing",
        );
        assert.ok(
          !receipt.read.includes("soak-" + cycles),
          "Background unread was cleared without visibility",
        );
        unreadChecks++;
      }
      samples.push({
        seconds: (Date.now() - start) / 1000,
        cycle: cycles,
        hostLoadAverage: loadavg(),
        heapBytes: heap.usedSize,
        backingStorageBytes: heap.backingStorageSize,
        documents: dom.documents,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
        ...memory,
        ...state,
        audioContexts: {
          created: audio.created,
          active: audio.active.size,
          peakActive: audio.peakActive,
        },
      });
      if (cycles % 30 === 0)
        console.log(JSON.stringify({ mode, cycle: cycles, ...samples.at(-1) }));
      cycles++;
    }
    if (cancelled) throw new Error("Owned diagnostic explicitly canceled");
    result.unreadChecks = unreadChecks;
    assert.ok(
      unreadChecks > 0,
      "Must observe a fresh background unread completion",
    );
    result.measuredSeconds = (Date.now() - start) / 1000;
    result.tabSwitches = tabSwitches;
    result.requests = owned.requests;
    result.emitted = owned.emitted;
    result.networkBytes = networkBytes;
    const first =
        minutes === 30
          ? samples.filter((s) => s.seconds >= 90 && s.seconds < 300)
          : samples.slice(0, 1),
      last =
        minutes === 30
          ? samples.filter((s) => s.seconds > minutes * 60 - 180)
          : samples.slice(-1);
    assert.ok(
      first.length && last.length,
      "Both original sampling windows must exist",
    );
    const identity = JSON.stringify(
      samples[0].rendererProcesses.map((p: any) => ({
        pid: p.pid,
        startTicks: p.startTicks,
      })),
    );
    assert.ok(
      samples.every(
        (s) =>
          JSON.stringify(
            s.rendererProcesses.map((p: any) => ({
              pid: p.pid,
              startTicks: p.startTicks,
            })),
          ) === identity,
      ),
      "Renderer identity changed",
    );
    result.thresholdResults = {
      heapLowRiseBytes:
        Math.min(...last.map((s) => s.heapBytes)) -
        Math.min(...first.map((s) => s.heapBytes)),
      heapPeakBytes: Math.max(...samples.map((s) => s.heapBytes)),
      rssLowRiseBytes:
        Math.min(...last.map((s) => s.rendererRssBytes)) -
        Math.min(...first.map((s) => s.rendererRssBytes)),
      rssPeakBytes: Math.max(...samples.map((s) => s.rendererRssBytes)),
      firstSamples: first.length,
      lastSamples: last.length,
    };
    assert.ok(result.thresholdResults.heapLowRiseBytes < 64 * 1024 * 1024);
    assert.ok(result.thresholdResults.heapPeakBytes < 256 * 1024 * 1024);
    assert.ok(result.thresholdResults.rssLowRiseBytes < 128 * 1024 * 1024);
    assert.ok(result.thresholdResults.rssPeakBytes < 768 * 1024 * 1024);
    if (minutes === 30) {
      assert.ok(result.measuredSeconds >= 1800);
      assert.ok(
        cycles >= 850,
        "Unchanged 2-second workload needs at least 850 full cycles",
      );
    }
    const lastTarget = "ux-" + ((cycles - 1) % 2);
    await select(lastTarget);
    const finalUiStarted = Date.now();
    const readFinalUi = async () =>
      evaluate(
        ({ key, cycle }: any) => {
          const w = (window as any).__idleMemory,
            receipt = w.attention.getState().receipts["codex:" + key],
            shell = document.querySelector(
              `[data-codex-transcript-shell="${key}"]`,
            ) as HTMLElement,
            reply = shell?.querySelector(
              `.codex-assistant[data-owner-thread="${key}"][data-owner-turn="soak-${cycle}"]`,
            ) as HTMLElement,
            viewport = shell?.querySelector(
              '[data-slot="scroll-area-viewport"]',
            ) as HTMLElement,
            replyRect = reply?.getBoundingClientRect(),
            viewportRect = viewport?.getBoundingClientRect(),
            editors = [
              ...document.querySelectorAll(
                '.session-native-editor-slot [contenteditable="true"],.session-native-editor-slot textarea',
              ),
            ].filter(
              (e: any) =>
                e.getBoundingClientRect().width &&
                e.getBoundingClientRect().height &&
                !e.disabled &&
                e.getAttribute("aria-disabled") !== "true",
            );
          return {
            key,
            selected: document
              .querySelector(`[data-tab-key="codex:${key}"]`)
              ?.getAttribute("aria-selected"),
            latestReplyPresent: !!reply?.innerText.includes(
              "soak reply " + cycle + ":",
            ),
            latestReplyIntersectsViewport:
              !!replyRect &&
              !!viewportRect &&
              Math.min(
                replyRect.bottom,
                viewportRect.bottom,
                window.innerHeight,
              ) > Math.max(replyRect.top, viewportRect.top, 0) &&
              Math.min(replyRect.right, viewportRect.right, window.innerWidth) >
                Math.max(replyRect.left, viewportRect.left, 0),
            replyGeometry: replyRect
              ? {
                  x: replyRect.x,
                  y: replyRect.y,
                  width: replyRect.width,
                  height: replyRect.height,
                }
              : null,
            viewportGeometry: viewportRect
              ? {
                  x: viewportRect.x,
                  y: viewportRect.y,
                  width: viewportRect.width,
                  height: viewportRect.height,
                }
              : null,
            composerOwner: editors[0]
              ?.closest(".session-codex-composer")
              ?.getAttribute("data-owner-thread"),
            visibleComposerOwners: [
              ...document.querySelectorAll(
                ".session-codex-composer[data-owner-thread]",
              ),
            ]
              .filter(
                (e: any) =>
                  e.getBoundingClientRect().width &&
                  e.getBoundingClientRect().height,
              )
              .map((e) => e.getAttribute("data-owner-thread")),
            editableComposers: editors.length,
            draft: w.drafts.getState().drafts["memory-fixture-draft"]?.text,
            approval: w.approvals
              .getState()
              .pendingApprovals.some(
                (p: any) => p.requestId === "memory-fixture-approval",
              ),
            latestCompletion: receipt?.completed?.some(
              (r: any) => r.id === "soak-" + cycle,
            ),
            unreadOther:
              w.attention.getState().receipts[
                "codex:ux-" + (key === "ux-0" ? 1 : 0)
              ],
            appSequence: { ...w.appSequence },
          };
        },
        { key: lastTarget, cycle: cycles - 1 },
      );
    result.finalUi = await readFinalUi();
    while (
      (result.finalUi.selected !== "true" ||
        !result.finalUi.latestReplyPresent ||
        !result.finalUi.latestReplyIntersectsViewport ||
        result.finalUi.editableComposers !== 1 ||
        result.finalUi.composerOwner !== lastTarget) &&
      Date.now() - finalUiStarted < 10000
    ) {
      await sleep(100);
      result.finalUi = await readFinalUi();
    }
    result.finalUiSettlementSeconds = (Date.now() - finalUiStarted) / 1000;
    assert.equal(result.finalUi.selected, "true");
    assert.equal(result.finalUi.latestReplyPresent, true);
    assert.equal(result.finalUi.latestReplyIntersectsViewport, true);
    assert.equal(result.finalUi.composerOwner, lastTarget);
    assert.deepEqual(result.finalUi.visibleComposerOwners, [lastTarget]);
    assert.equal(result.finalUi.editableComposers, 1);
    assert.equal(result.finalUi.draft, "keep my unsent draft");
    assert.equal(result.finalUi.approval, true);
    assert.equal(result.finalUi.latestCompletion, true);
    result.actualHmr = owned.hmrProxy.snapshot();
    assert.equal(result.actualHmr.attempts, 1, "HMR must open once without reconnecting");
    assert.equal(result.actualHmr.connected, 1, "HMR must complete one upstream and downstream handshake");
    assert.equal(result.actualHmr.active, 1, "HMR must remain open through the measured run");
    assert.equal(result.actualHmr.closed, 0, "HMR must not close before owned browser teardown");
    assert.ok(result.actualHmr.frames.connected >= 1, "Vite HMR connected frame was not received");
    assert.ok(result.actualHmr.frames.ping >= 1, "Vite HMR ping was not received");
    assert.ok(result.actualHmr.fromClient.ping >= 1, "Vite client heartbeat ping was not received");
    assert.ok(result.actualHmr.active >= 1, "Vite HMR must remain active through the measured window");
    assert.equal(audio.created, 1);
    assert.equal(audio.peakActive, 1);
    const idleStarted = Date.now();
    while (audio.active.size && Date.now() - idleStarted < 35000)
      await sleep(100);
    assert.equal(
      audio.active.size,
      0,
      "Audio context must naturally close within 35s",
    );
    result.audioIdle = {
      seconds: (Date.now() - idleStarted) / 1000,
      created: audio.created,
      active: audio.active.size,
      peakActive: audio.peakActive,
    };
    assert.equal(
      sha(await readFile(binary)),
      result.binarySha256,
      "Chrome binary changed during run",
    );
    result.sourcesAfter = await verifySources();
    assert.deepEqual(result.sourcesAfter, sourcesBefore);
    assert.equal(
      sha(await readFile(new URL(import.meta.url))),
      driverSha,
      "Driver changed during run",
    );
    result.cycles = cycles;
    result.errors = errors;
    result.proxyErrors = owned.proxyErrors;
    result.eventCounts = eventCounts;
    result.traffic = owned.traffic;
    result.streamOpens = owned.stream.opens();
    result.taskWrites = owned.fixture.calls.filter(
      (c) =>
        /^\/api\/(?:codex|claude|acp)\//.test(c.path) &&
        !/\/(?:read|list|context|preflight|resolve)$/.test(c.path),
    );
    assert.equal(result.taskWrites.length, 0);
    assert.equal(errors.length, 0);
    assert.equal(owned.proxyErrors.length, 0);
    result.streamSequence = streamSequence;
    assert.equal(owned.stream.opens(), 1);
    assert.equal(owned.traffic.nativeSseRequests, 1);
    assert.ok(owned.traffic.nativeSseBytes >= owned.emitted.frameBytes);
    assert.equal(streamSequence.jsonBytes, owned.emitted.jsonBytes);
    if (mode !== "none") {
      assert.equal(streamSequence.last, sequence);
      assert.equal(streamSequence.count, sequence);
      assert.equal(streamSequence.gaps, 0);
      assert.equal(streamSequence.duplicates, 0);
    }
    result.formalAcceptance = minutes === 30;
    result.completed = true;
    await send("Browser.close").catch(() => {});
  } catch (error) {
    result.completed = false;
    result.error = String(error);
    console.error(mode, error);
    process.exitCode = 1;
  } finally {
    result.actualHmrBeforeCleanup = owned.hmrProxy.snapshot();
    result.cycles = cycles;
    result.errors = errors;
    result.proxyErrors = owned.proxyErrors;
    result.eventCounts = eventCounts;
    result.traffic = owned.traffic;
    await writeFile(
      join(output!, `${mode}.json`),
      JSON.stringify(result, null, 2),
    );
    if (ws?.readyState === 1) ws.close();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Diagnostic closed"));
    }
    pending.clear();
    if (browser.exitCode === null) {
      await Promise.race([
        new Promise((r) => browser.once("exit", r)),
        sleep(2000),
      ]);
      if (browser.exitCode === null) {
        assert.equal(
          ticks(await readFile(`/proc/${browser.pid}/stat`, "utf8")),
          ownedStartTicks,
          "Refuse signal after owned browser PID changed",
        );
        browser.kill("SIGTERM");
        await new Promise((r) => browser.once("exit", r));
      }
    }
    await owned.close();
    result.actualHmrAfterCleanup = owned.hmrProxy.snapshot();
    await rm(home, { recursive: true, force: true });
    const capturedRenderers = [
      ...new Map(
        samples
          .flatMap((s) => s.rendererProcesses)
          .map((p: any) => [p.pid + "/" + p.startTicks, p]),
      ).values(),
    ] as any[];
    const remainingRenderers = async () => {
      const remaining = [];
      for (const p of capturedRenderers) {
        try {
          if (
            ticks(await readFile(`/proc/${p.pid}/stat`, "utf8")) ===
            p.startTicks
          )
            remaining.push({ pid: p.pid, startTicks: p.startTicks });
        } catch (e) {
          if ((e as any).code !== "ENOENT") throw e;
        }
      }
      return remaining;
    };
    const cleanupDeadline = Date.now() + 5000;
    let remaining = await remainingRenderers();
    while (remaining.length && Date.now() < cleanupDeadline) {
      await sleep(100);
      remaining = await remainingRenderers();
    }
    result.cleanup = {
      capturedRendererCount: capturedRenderers.length,
      remainingOwnedRenderers: remaining,
      ownedBrowserExited:
        browser.exitCode !== null || browser.signalCode !== null,
      ownedProfileRemoved: true,
      ownedHttpClosed: true,
      ownedSseClosed: true,
    };
    assert.equal(result.cleanup.ownedBrowserExited, true);
    assert.deepEqual(
      remaining,
      [],
      "Captured renderer still exists after owned Browser.close",
    );
    await writeFile(
      join(output!, `${mode}.json`),
      JSON.stringify(result, null, 2),
    );
  }
}
