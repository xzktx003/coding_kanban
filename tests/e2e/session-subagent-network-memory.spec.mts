import { expect, test, type CDPSession } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { registerSessionSubagentRoutes } from "../../apps/server/src/routes/session-subagents.ts";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const Fastify = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
)("fastify");

test("idle child polling projects native history before browser fetch receives it", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(100_000);
  const output = "hidden-native-child-output:" + "x".repeat(4 * 1024 * 1024);
  const requests: string[] = [];
  let upstreamBytes = 0;
  let rounds = 0;
  const child = {
    id: "idle-child",
    parentThreadId: "idle-root",
    source: { subAgent: {} },
    agentNickname: "Scout",
    agentRole: "reviewer",
    cwd: "/isolated-fixture/project",
    canAcceptDirectInput: true,
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
  };
  const turn = () => ({
    id: `turn-${rounds}`,
    status: "inProgress",
    startedAt: 123,
    items: [
      {
        id: "large-command",
        type: "commandExecution",
        aggregatedOutput: output,
      },
    ],
  });
  const runtime = createServer((request, response) => {
    request.resume();
    const method = (request.url ?? "").replace("/api/codex/", "");
    requests.push(method);
    let data: unknown;
    if (method === "thread/list") {
      rounds++;
      data = { data: [child], nextCursor: null };
    } else if (method === "thread/turns/list") {
      data = { data: [turn()], nextCursor: null };
    } else if (method === "thread/metadata") {
      response.statusCode = 404;
      data = {};
    } else if (method === "thread/read") {
      data = { thread: { ...child, turns: [turn()] } };
    } else {
      response.statusCode = 400;
      data = { error: `Unexpected execution request: ${method}` };
    }
    const body = JSON.stringify(data);
    upstreamBytes += Buffer.byteLength(body);
    response.setHeader("content-type", "application/json");
    response.end(body);
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const runtimeOrigin = `http://127.0.0.1:${(runtime.address() as { port: number }).port}`;
  const app = Fastify();
  app.get("/probe", async (_, reply) => {
    reply
      .type("text/html")
      .send("<!doctype html><title>Passive child metadata probe</title>");
  });
  registerSessionSubagentRoutes(app, {
    origin: () => runtimeOrigin,
    fetch,
    stop: async () => {
      throw new Error("Read-only fixture cannot stop a task");
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const samples: unknown[] = [];
  let pageCdp: CDPSession | undefined;
  let browserCdp: CDPSession | undefined;
  try {
    await app.listen({ host: "0.0.0.0", port: 0 });
    const host =
      Object.values(networkInterfaces())
        .flat()
        .find((address) => address?.family === "IPv4" && !address.internal)
        ?.address ?? "127.0.0.1";
    const gateway = `http://${host}:${(app.server.address() as { port: number }).port}`;
    await page.goto(`${gateway}/probe`);
    pageCdp = await page.context().newCDPSession(page);
    browserCdp = await browser.newBrowserCDPSession();
    const sample = async () => {
      const heap = await pageCdp!.send("Runtime.getHeapUsage");
      const processes = await browserCdp!.send("SystemInfo.getProcessInfo");
      samples.push({
        at: Date.now(),
        heapUsedBytes: heap.usedSize,
        ...(process.platform === "linux"
          ? sampleRendererRss(processes.processInfo)
          : { rendererRssUnavailable: process.platform }),
      });
    };
    await sample();
    await page.evaluate(() => {
      const probe = {
        done: false,
        errors: [] as string[],
        rows: [] as Array<{
          endpoint: string;
          bytes: number;
          at: number;
          threads: unknown[];
          thread?: unknown;
          complete?: boolean;
          errors?: unknown[];
          unavailableIds?: string[];
        }>,
        largestResponseBytes: 0,
        browserBytes: 0,
        hiddenBody: false,
      };
      (window as any).__childMemoryProbe = probe;
      const read = async (endpoint: "snapshot" | "verify") => {
        const response = await fetch(`/api/session/subagents/${endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rootId: "idle-root", threadId: "idle-child" }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const bytes = new TextEncoder().encode(text).byteLength;
        probe.browserBytes += bytes;
        probe.largestResponseBytes = Math.max(
          probe.largestResponseBytes,
          bytes,
        );
        probe.hiddenBody ||= text.includes("hidden-native-child-output:");
        // A failing projection must not turn this diagnostic into a retained body cache.
        if (bytes >= 16 * 1024)
          throw new Error(`Unprojected child response: ${bytes} bytes`);
        probe.rows.push({
          endpoint,
          bytes,
          at: performance.now(),
          ...JSON.parse(text),
        });
      };
      let round = 0;
      const tick = async () => {
        try {
          await read("snapshot");
          round++;
          if (round < 5) setTimeout(() => void tick(), 15_000);
          else {
            await read("verify");
            probe.done = true;
          }
        } catch (error) {
          probe.errors.push(String(error));
          probe.done = true;
        }
      };
      void tick();
    });
    // No interaction, timer acceleration, GC, reload, or real agent is involved.
    await expect
      .poll(
        async () => {
          await sample();
          return page.evaluate(() => (window as any).__childMemoryProbe.done);
        },
        { timeout: 85_000, intervals: [2000] },
      )
      .toBe(true);
    await sample();
    const probe = await page.evaluate(() => (window as any).__childMemoryProbe);
    const metrics = {
      gateway,
      upstreamBytes,
      browserBytes: probe.browserBytes,
      largestResponseBytes: probe.largestResponseBytes,
      responseObservations: probe.rows.map(
        (row: { endpoint: string; bytes: number; at: number }) => ({
          endpoint: row.endpoint,
          bytes: row.bytes,
          at: row.at,
        }),
      ),
      requests,
      samples,
      errors: [...errors, ...probe.errors],
      scope:
        "Five natural 15-second passive polls plus identity verification; page-target heap and all-browser-renderer RSS. This is a transfer regression, not a 30-minute memory stability verdict.",
    };
    writeFileSync(
      testInfo.outputPath("session-subagent-network-memory-metrics.json"),
      JSON.stringify(metrics, null, 2),
    );
    await testInfo.attach("session-subagent-network-memory-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(probe.errors).toEqual([]);
    expect(errors).toEqual([]);
    expect(probe.hiddenBody).toBe(false);
    expect(probe.largestResponseBytes).toBeLessThan(16 * 1024);
    expect(probe.browserBytes).toBeLessThan(64 * 1024);
    expect(upstreamBytes).toBeGreaterThan(24 * 1024 * 1024);
    expect(requests.filter((method) => method === "thread/list")).toHaveLength(
      5,
    );
    expect(
      requests.every((method) =>
        [
          "thread/list",
          "thread/turns/list",
          "thread/metadata",
          "thread/read",
        ].includes(method),
      ),
    ).toBe(true);
    const snapshots = probe.rows.filter(
      (row: any) => row.endpoint === "snapshot",
    );
    expect(snapshots).toHaveLength(5);
    for (let i = 0; i < snapshots.length; i++) {
      const row = snapshots[i];
      expect(row.complete).toBe(true);
      expect(row.errors).toEqual([]);
      expect(row.unavailableIds).toEqual([]);
      expect(row.threads).toEqual([
        {
          ...child,
          turns: [
            { id: `turn-${i + 1}`, status: "inProgress", startedAt: 123 },
          ],
        },
      ]);
      if (i)
        expect(row.at - snapshots[i - 1].at).toBeGreaterThanOrEqual(14_900);
    }
    expect(probe.rows.at(-1).thread).toEqual(snapshots.at(-1).threads[0]);
    expect(probe.rows.at(-1).threads).toEqual(snapshots.at(-1).threads);
    expect(samples.length).toBeGreaterThan(20);
  } finally {
    await pageCdp?.detach();
    await browserCdp?.detach();
    await app.close();
    runtime.closeAllConnections();
    await new Promise<void>((resolve) => runtime.close(() => resolve()));
  }
});
