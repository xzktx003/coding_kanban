import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode.ts";

const Fastify = createRequire(new URL("../../apps/server/package.json", import.meta.url))("fastify");

type SseClient = ServerResponse & { bytesWritten: number };

async function startRawSessionRuntime() {
  const clients = new Set<SseClient>();
  const upstreamRequests: string[] = [];
  const server = createServer((request, response) => {
    upstreamRequests.push(request.url ?? "");
    if (!request.url?.startsWith("/api/events")) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.flushHeaders();
    const client = response as SseClient;
    clients.add(client);
    request.on("close", () => clients.delete(client));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    upstreamRequests,
    clients: () => clients.size,
    envelope(seq: number, event: string, payload: unknown) {
      const frame = `data: ${JSON.stringify({ seq, event, payload })}\n\n`;
      for (const client of clients) client.write(frame);
      return Buffer.byteLength(frame);
    },
    async close() {
      for (const client of clients) client.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("chat SSE projection keeps oversized tool output out of the browser EventSource stream", async ({
  page,
}, testInfo) => {
  test.setTimeout(45_000);
  const runtime = await startRawSessionRuntime();
  const attachmentRoot = mkdtempSync(join(tmpdir(), "session-network-memory-"));
  const app = Fastify();
  app.get("/probe", async (_, reply) => {
    reply.type("text/html").send("<!doctype html><title>sse probe</title>");
  });
  registerSessionModeRoutes(app, {
    origin: runtime.origin,
    attachmentRoot,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const gateway = app.listeningOrigin;

  try {
    await page.goto(`${gateway}/probe`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    await page.evaluate(() => {
      const seen: Array<{
        seq: number;
        event: string;
        method?: string;
        deltaLength?: number;
        itemType?: string;
        outputLength?: number;
        text?: string;
      }> = [];
      (window as any).__sessionNetworkProbe = {
        seen,
        eventDataChars: 0,
        largestEventData: 0,
        containsHiddenToolBody: false,
        opened: false,
        done: new Promise<void>((resolve, reject) => {
          const source = new EventSource(
            "/api/session/api/events?view=chat&since=7",
          );
          source.onopen = () => {
            (window as any).__sessionNetworkProbe.opened = true;
          };
          source.onerror = () => reject(new Error("EventSource failed"));
          source.onmessage = (message) => {
            const data = message.data;
            (window as any).__sessionNetworkProbe.eventDataChars += data.length;
            (window as any).__sessionNetworkProbe.largestEventData = Math.max(
              (window as any).__sessionNetworkProbe.largestEventData,
              data.length,
            );
            if (data.includes("hidden-tool-output-marker")) {
              (window as any).__sessionNetworkProbe.containsHiddenToolBody =
                true;
            }
            const envelope = JSON.parse(data);
            const payload = envelope.payload ?? {};
            const params = payload.params ?? {};
            const item = params.item ?? {};
            seen.push({
              seq: envelope.seq,
              event: envelope.event,
              method: payload.method,
              deltaLength:
                typeof params.delta === "string"
                  ? params.delta.length
                  : undefined,
              itemType: item.type,
              outputLength:
                typeof item.aggregatedOutput === "string"
                  ? item.aggregatedOutput.length
                  : undefined,
              text: typeof item.text === "string" ? item.text : undefined,
            });
            if (seen.length === 26) {
              source.close();
              resolve();
            }
          };
        }),
      };
    });

    await expect
      .poll(() => runtime.clients(), { timeout: 5000 })
      .toBeGreaterThan(0);

    const hiddenOutput = `hidden-tool-output-marker:${"x".repeat(4 * 1024 * 1024)}`;
    let upstreamBytes = 0;
    let seq = 1;
    for (let index = 0; index < 12; index++) {
      upstreamBytes += runtime.envelope(seq++, "codex:notification", {
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "network-memory",
          turnId: "turn",
          itemId: `cmd-${index}`,
          delta: hiddenOutput,
        },
      });
      upstreamBytes += runtime.envelope(seq++, "codex:notification", {
        method: "item/completed",
        params: {
          threadId: "network-memory",
          turnId: "turn",
          item: {
            id: `cmd-${index}`,
            type: "commandExecution",
            status: "completed",
            command: `cat huge-${index}.log`,
            aggregatedOutput: hiddenOutput,
            exitCode: 0,
          },
        },
      });
    }
    upstreamBytes += runtime.envelope(seq++, "codex/approval-request", {
      threadId: "network-memory",
      turnId: "turn",
      itemId: "approval",
      requestId: "approval-1",
      reason: "keep approval",
    });
    upstreamBytes += runtime.envelope(seq++, "codex:notification", {
      method: "item/completed",
      params: {
        threadId: "network-memory",
        turnId: "turn",
        item: {
          id: "assistant-final",
          type: "agentMessage",
          text: "final visible answer",
        },
      },
    });

    await page.evaluate(() => (window as any).__sessionNetworkProbe.done);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfterGc = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    await cdp.detach();

    const probe = await page.evaluate(() => {
      const { done: _done, ...rest } = (window as any).__sessionNetworkProbe;
      return rest;
    });
    await testInfo.attach("session-network-memory-metrics.json", {
      body: JSON.stringify({
        upstreamBytes,
        browserDataChars: probe.eventDataChars,
        largestBrowserEventData: probe.largestEventData,
        heapBefore,
        heapAfterGc,
        retainedHeapBytes: heapAfterGc - heapBefore,
      }),
      contentType: "application/json",
    });
    expect(
      runtime.upstreamRequests.filter((request) =>
        request.startsWith("/api/events"),
      ),
    ).toEqual(["/api/events?since=7"]);
    expect(probe.opened).toBe(true);
    expect(probe.seen.map((event: any) => event.seq)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
    expect(probe.seen.at(-2)).toMatchObject({
      event: "codex/approval-request",
    });
    expect(probe.seen.at(-1)).toMatchObject({
      event: "codex:notification",
      method: "item/completed",
      itemType: "agentMessage",
      text: "final visible answer",
    });
    expect(probe.containsHiddenToolBody).toBe(false);
    expect(probe.largestEventData).toBeLessThan(16 * 1024);
    expect(probe.eventDataChars).toBeLessThan(128 * 1024);
    expect(upstreamBytes).toBeGreaterThan(96 * 1024 * 1024);
    expect(heapAfterGc - heapBefore).toBeLessThan(8 * 1024 * 1024);
  } finally {
    await runtime.close();
    await app.close();
    rmSync(attachmentRoot, { recursive: true, force: true });
  }
});

test("chat SSE projection emits a named error for oversized native EventSource frames", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const runtime = await startRawSessionRuntime();
  const attachmentRoot = mkdtempSync(join(tmpdir(), "session-network-error-"));
  const app = Fastify();
  app.get("/probe", async (_, reply) => {
    reply.type("text/html").send("<!doctype html><title>sse probe</title>");
  });
  registerSessionModeRoutes(app, {
    origin: runtime.origin,
    attachmentRoot,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const gateway = app.listeningOrigin;

  try {
    await page.goto(`${gateway}/probe`);
    await page.evaluate(() => {
      (window as any).__sessionProjectionErrorProbe = {
        normalMessages: 0,
        largestNormalMessage: 0,
        containsOversizedBody: false,
        errors: [] as string[],
        done: new Promise<void>((resolve, reject) => {
          const source = new EventSource(
            "/api/session/api/events?view=chat&since=11",
          );
          source.onerror = () => reject(new Error("EventSource failed"));
          source.onmessage = (message) => {
            (window as any).__sessionProjectionErrorProbe.normalMessages += 1;
            (window as any).__sessionProjectionErrorProbe.largestNormalMessage =
              Math.max(
                (window as any).__sessionProjectionErrorProbe
                  .largestNormalMessage,
                message.data.length,
              );
            if (message.data.includes("oversized-native-frame-marker")) {
              (window as any).__sessionProjectionErrorProbe.containsOversizedBody =
                true;
            }
          };
          source.addEventListener("session-projection-error", (event) => {
            (window as any).__sessionProjectionErrorProbe.errors.push(
              (event as MessageEvent).data,
            );
            source.close();
            resolve();
          });
        }),
      };
    });

    await expect
      .poll(() => runtime.clients(), { timeout: 5000 })
      .toBeGreaterThan(0);

    const oversized = `oversized-native-frame-marker:${"x".repeat(17 * 1024 * 1024)}`;
    runtime.envelope(1, "codex:notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "network-error",
        turnId: "turn",
        itemId: "reply",
        delta: oversized,
      },
    });

    await page.evaluate(
      () => (window as any).__sessionProjectionErrorProbe.done,
    );
    const probe = await page.evaluate(() => {
      const { done: _done, ...rest } = (window as any)
        .__sessionProjectionErrorProbe;
      return rest;
    });

    expect(
      runtime.upstreamRequests.filter((request) =>
        request.startsWith("/api/events"),
      ),
    ).toEqual(["/api/events?since=11"]);
    expect(probe.errors).toHaveLength(1);
    expect(probe.errors[0]).toContain(
      "Session event frame exceeds chat projection limit",
    );
    expect(probe.normalMessages).toBe(0);
    expect(probe.largestNormalMessage).toBe(0);
    expect(probe.containsOversizedBody).toBe(false);
  } finally {
    await runtime.close();
    await app.close();
    rmSync(attachmentRoot, { recursive: true, force: true });
  }
});
