import { expect, test, type CDPSession } from "@playwright/test";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntime } from "../../packages/session-runtime/src/server.ts";
import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode.ts";

const Fastify = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
)("fastify");

function lanHost(baseURL?: string): string {
  const configured =
    process.env.HTTPS_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? baseURL;
  if (configured) {
    const host = new URL(configured).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return host;
  }
  const address = Object.values(networkInterfaces())
    .flat()
    .find((value) => value?.family === "IPv4" && !value.internal)?.address;
  if (!address)
    throw new Error("Native runtime browser regression requires a LAN address");
  return address;
}

test("real TypeScript runtime HTTP and hub preserve chat projection through the Node gateway to native EventSource", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const home = mkdtempSync(join(tmpdir(), "session-ts-browser-"));
  for (const dir of [
    ".codex",
    ".claude",
    ".config",
    ".local/share",
    "empty-bin",
    "attachments",
  ])
    mkdirSync(join(home, dir), { recursive: true });
  const env = {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    SESSION_DATA_HOME: home,
    PATH: join(home, "empty-bin"),
    DO_NOT_TRACK: "1",
  };
  const instance = "typescript-native-browser-regression";
  const upstreamRequests: string[] = [];
  const runtime = await createRuntime({ dataHome: home, instance, env });
  const app = Fastify({ forceCloseConnections: true });
  let cdp: CDPSession | undefined;
  try {
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const runtimeAddress = runtime.app.server.address();
    if (!runtimeAddress || typeof runtimeAddress === "string")
      throw new Error("Runtime did not bind a TCP port");
    const origin = `http://127.0.0.1:${runtimeAddress.port}`;
    const contract = JSON.parse(
      readFileSync(
        new URL(
          "../../packages/session-runtime/route-contract.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(contract).toHaveLength(208);
    const missing = contract.filter(
      (route: { method: string; path: string }) =>
        !runtime.app.hasRoute({
          method: route.method as "GET",
          url: route.path,
        }),
    );
    expect(missing).toEqual([]); // Surface audit is supplemental to real HTTP and event behavior below.
    app.get("/probe", async (_request: unknown, reply: any) =>
      reply
        .type("text/html")
        .send(
          "<!doctype html><title>TypeScript runtime native SSE probe</title>",
        ),
    );
    registerSessionModeRoutes(app, {
      origin,
      attachmentRoot: join(home, "attachments"),
      fetch: async (input, init) => {
        const target = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (
          target.origin !== origin ||
          !["/health", "/api/settings", "/api/events"].includes(target.pathname)
        )
          throw new Error(`Unexpected runtime request: ${target.pathname}`);
        upstreamRequests.push(
          `${init?.method ?? "GET"} ${target.pathname}${target.search}`,
        );
        return globalThis.fetch(input, init); // Real loopback HTTP; no fake response or protocol implementation.
      },
    });
    await app.listen({ host: "0.0.0.0", port: 0 });
    const gatewayAddress = app.server.address();
    if (!gatewayAddress || typeof gatewayAddress === "string")
      throw new Error("Gateway did not bind a TCP port");
    const gateway = `http://${lanHost(testInfo.project.use.baseURL)}:${gatewayAddress.port}`;
    await page.goto(`${gateway}/probe`);
    await expect(page).toHaveTitle("TypeScript runtime native SSE probe");

    const http = await page.evaluate(async () => {
      const healthResponse = await fetch("/api/session/health");
      const health = await healthResponse.json();
      const originalResponse = await fetch("/api/session/api/settings");
      const original = await originalResponse.json();
      const changed = {
        ...original,
        tsIntegrationMarker: "isolated persisted HTTP settings",
      };
      const saved = await fetch("/api/session/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changed),
      });
      const restored = await (await fetch("/api/session/api/settings")).json();
      return {
        healthStatus: healthResponse.status,
        settingsStatus: originalResponse.status,
        savedStatus: saved.status,
        health,
        restored,
      };
    });
    expect(http.healthStatus).toBe(200);
    expect(http.settingsStatus).toBe(200);
    expect(http.savedStatus).toBe(200);
    expect(http.health).toMatchObject({
      status: "ok",
      runtime: "typescript",
      instance,
    });
    expect(http.restored.tsIntegrationMarker).toBe(
      "isolated persisted HTTP settings",
    );
    expect((await runtime.settings.read()).tsIntegrationMarker).toBe(
      "isolated persisted HTTP settings",
    );

    cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    const subscribersBeforeBrowser = runtime.hub.subscriberCount;
    await page.evaluate(() => {
      const probe = {
        opened: false,
        closed: false,
        error: "",
        dataChars: 0,
        largestDataChars: 0,
        hiddenBodyReceived: false,
        seen: [] as any[],
      };
      const source = new EventSource(
        "/api/session/api/events?view=chat&agents=codex",
      );
      (window as any).__tsRuntimeProbe = probe;
      (window as any).__tsRuntimeEventSource = source;
      source.onopen = () => {
        probe.opened = true;
      };
      source.onerror = () => {
        probe.error = "Native EventSource disconnected";
        source.close();
      };
      source.onmessage = (message) => {
        probe.dataChars += message.data.length;
        probe.largestDataChars = Math.max(
          probe.largestDataChars,
          message.data.length,
        );
        probe.hiddenBodyReceived ||= message.data.includes(
          "ts-hidden-tool-output-marker",
        );
        // Retain only small verification fields; wire assertions run on raw MessageEvent.data first.
        const envelope = JSON.parse(message.data),
          payload = envelope.payload ?? {},
          params = payload.params ?? {},
          item = params.item ?? {};
        probe.seen.push({
          seq: envelope.seq,
          event: envelope.event,
          method: payload.method,
          threadId: params.threadId ?? payload.threadId,
          turnId: params.turnId ?? payload.turnId,
          itemId: item.id ?? params.itemId ?? payload.itemId,
          requestId: payload.requestId,
          requestToken: payload.requestToken,
          instance: payload.instance,
          itemType: item.type,
          text: item.text,
          output: item.aggregatedOutput,
        });
        if (probe.seen.length === 26) {
          source.close();
          probe.closed = true;
        }
      };
    });
    // Fastify forwards its stream headers together with the first body chunk.
    await expect
      .poll(() => runtime.hub.subscriberCount)
      .toBeGreaterThan(subscribersBeforeBrowser);
    const hiddenOutput = `ts-hidden-tool-output-marker:${"x".repeat(4 * 1024 * 1024)}`;
    const publishedSequences: number[] = [];
    let upstreamBytes = 0;
    const publish = (event: string, payload: any) => {
      const envelope = runtime.hub.publish(event, payload);
      publishedSequences.push(envelope.seq);
      upstreamBytes += Buffer.byteLength(
        `data: ${JSON.stringify(envelope)}\n\n`,
      );
    };
    for (let index = 0; index < 12; index++) {
      publish("codex:notification", {
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "ts-network-memory",
          turnId: "turn-1",
          itemId: `cmd-${index}`,
          delta: hiddenOutput,
        },
      });
      publish("codex:notification", {
        method: "item/completed",
        params: {
          threadId: "ts-network-memory",
          turnId: "turn-1",
          item: {
            id: `cmd-${index}`,
            type: "commandExecution",
            status: "completed",
            command: `cat fixture-${index}.log`,
            aggregatedOutput: hiddenOutput,
            exitCode: 0,
          },
        },
      });
      // Respect the real runtime's bounded subscriber queue while keeping identical 96 MiB work.
      await expect
        .poll(() =>
          page.evaluate(() => ({
            count: (window as any).__tsRuntimeProbe.seen.length,
            error: (window as any).__tsRuntimeProbe.error,
          })),
        )
        .toEqual({ count: (index + 1) * 2, error: "" });
      expect(runtime.hub.replayByteLength).toBeLessThanOrEqual(
        32 * 1024 * 1024,
      );
    }
    const approval = {
      threadId: "ts-network-memory",
      turnId: "turn-1",
      itemId: "approval-item",
      requestId: "approval-1",
      requestToken: "request-generation-1",
      instance,
      reason: "Approval stays interactive",
    };
    publish("codex/approval-request", approval);
    publish("codex:notification", {
      method: "item/completed",
      params: {
        threadId: "ts-network-memory",
        turnId: "turn-1",
        item: {
          id: "assistant-final",
          type: "agentMessage",
          text: "final visible TypeScript runtime answer",
        },
      },
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__tsRuntimeProbe.closed))
      .toBe(true);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfterGc = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    await cdp.detach();
    cdp = undefined;
    const probe = await page.evaluate(() => (window as any).__tsRuntimeProbe);
    expect(probe.error).toBe("");
    expect(probe.opened).toBe(true);
    expect(probe.seen.map((event: any) => event.seq)).toEqual(
      publishedSequences,
    );
    expect(publishedSequences).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(probe.seen.at(-2)).toMatchObject({
      event: "codex/approval-request",
      threadId: approval.threadId,
      turnId: approval.turnId,
      itemId: approval.itemId,
      requestId: approval.requestId,
      requestToken: approval.requestToken,
      instance,
    });
    expect(probe.seen.at(-1)).toMatchObject({
      event: "codex:notification",
      method: "item/completed",
      threadId: "ts-network-memory",
      turnId: "turn-1",
      itemId: "assistant-final",
      itemType: "agentMessage",
      text: "final visible TypeScript runtime answer",
    });
    expect(probe.hiddenBodyReceived).toBe(false);
    expect(probe.largestDataChars).toBeLessThan(16 * 1024);
    expect(probe.dataChars).toBeLessThan(128 * 1024);
    expect(upstreamBytes).toBeGreaterThan(96 * 1024 * 1024);
    expect(heapAfterGc - heapBefore).toBeLessThan(8 * 1024 * 1024);
    expect(runtime.hub.pendingCount).toBe(1);
    expect(
      upstreamRequests.filter((request) => request.includes("/api/events")),
    ).toEqual(["GET /api/events", "GET /api/events?agents=codex"]);

    // Reconnect after all sequences: the real hub sends durable request snapshots over HTTP/SSE.
    const replay = await page.evaluate(
      async () =>
        new Promise<any[]>((resolve, reject) => {
          const source = new EventSource(
            "/api/session/api/events?view=chat&agents=codex&since=26",
          );
          (window as any).__tsRuntimeReplaySource = source;
          const seen: any[] = [];
          const timer = setTimeout(() => {
            source.close();
            reject(new Error("Request snapshot timed out"));
          }, 5000);
          source.onerror = () => {
            clearTimeout(timer);
            source.close();
            reject(new Error("Replay EventSource failed"));
          };
          source.onmessage = (message) => {
            seen.push(JSON.parse(message.data));
            if (seen.length === 2) {
              clearTimeout(timer);
              source.close();
              resolve(seen);
            }
          };
        }),
    );
    expect(
      replay.map((event) => ({ event: event.event, seq: event.seq })),
    ).toEqual([
      { event: "codex/user-input-snapshot", seq: 26 },
      { event: "codex/pending-requests-snapshot", seq: 26 },
    ]);
    expect(replay[1].payload.requests).toHaveLength(1);
    expect(replay[1].payload.requests[0]).toMatchObject({
      event: "codex/approval-request",
      payload: approval,
    });
    expect(
      upstreamRequests.filter((request) => request.includes("/api/events")),
    ).toEqual([
      "GET /api/events",
      "GET /api/events?agents=codex",
      "GET /api/events?agents=codex&since=26",
    ]);
    const metricsPath = testInfo.outputPath(
      "typescript-runtime-native-network-metrics.json",
    );
    writeFileSync(
      metricsPath,
      JSON.stringify(
        {
          runtime: "typescript",
          gateway,
          protocol: "HTTP",
          port: gatewayAddress.port,
          contractRoutes: contract.length,
          upstreamBytes,
          browserDataChars: probe.dataChars,
          largestBrowserEventData: probe.largestDataChars,
          sequences: publishedSequences,
          approvalIdentityPreserved: true,
          pendingSnapshotCount: replay[1].payload.requests.length,
          heapBefore,
          heapAfterGc,
          retainedHeapBytes: heapAfterGc - heapBefore,
          runtimeReplayBytes: runtime.hub.replayByteLength,
          measurementBoundary:
            "Browser probe, real HTTP and native EventSource; GC deltas exclude Node/runtime RSS and are not a whole-app memory claim.",
        },
        null,
        2,
      ),
    );
    await testInfo.attach("typescript-runtime-native-network-metrics.json", {
      path: metricsPath,
      contentType: "application/json",
    });
  } finally {
    await page
      .evaluate(() => {
        (window as any).__tsRuntimeEventSource?.close();
        (window as any).__tsRuntimeReplaySource?.close();
      })
      .catch(() => {});
    await cdp?.detach().catch(() => {});
    // Only objects created by this test are closed; no formal service PID or user CLI is touched.
    const cleanup = await Promise.allSettled([
      app.close(),
      runtime.app.close(),
    ]);
    rmSync(home, { recursive: true, force: true });
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
});
