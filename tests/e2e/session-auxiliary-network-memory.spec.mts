import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type ServerResponse } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { registerSessionModeRoutes } from "../../apps/server/src/routes/session-mode.ts";
const Fastify = createRequire(
  new URL("../../apps/server/package.json", import.meta.url),
)("fastify");

test("native EventSource receives bounded Claude/ACP tools while exact approvals, source IDs, sequences and final replies survive", async ({
  page,
}, testInfo) => {
  test.setTimeout(45000);
  const lanHost = process.env.SESSION_ACCEPTANCE_LAN_HOST;
  if (!lanHost)
    throw new Error(
      "SESSION_ACCEPTANCE_LAN_HOST must be the existing reachable LAN host",
    );
  const clients = new Set<ServerResponse>();
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (!request.url?.startsWith("/api/events")) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.flushHeaders();
    clients.add(response);
    request.on("close", () => clients.delete(response));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const port = (upstream.address() as { port: number }).port;
  const gateway = Fastify();
  gateway.get("/probe", (_, reply) =>
    reply
      .type("text/html")
      .send("<!doctype html><title>auxiliary network probe</title>"),
  );
  registerSessionModeRoutes(gateway, { origin: `http://127.0.0.1:${port}` });
  await gateway.listen({ host: "0.0.0.0", port: 0 });
  const gatewayPort = (gateway.server.address() as { port: number }).port,
    url = `http://${lanHost}:${gatewayPort}/probe`;
  let upstreamBytes = 0;
  const send = (seq: number, event: string, payload: unknown) => {
    const frame = `data: ${JSON.stringify({ seq, event, payload })}\n\n`;
    upstreamBytes += Buffer.byteLength(frame);
    for (const client of clients) client.write(frame);
  };
  try {
    await page.goto(url);
    await page.evaluate(() => {
      const state = {
        opened: false,
        bytes: 0,
        largest: 0,
        seq: [] as number[],
        sources: [] as number[],
        truncated: 0,
        acpApproval: false,
        ccApproval: false,
        ccImage: false,
        acpImage: false,
        final: false,
        failed: "",
      };
      (window as any).__auxNetwork = state;
      const source = new EventSource(
        "/api/session/api/events?view=chat&since=0",
      );
      source.onopen = () => (state.opened = true);
      source.onerror = () => (state.failed = "EventSource failed");
      source.addEventListener(
        "session-projection-error",
        () =>
          (state.failed =
            "projection rejected a supported bounded source frame"),
      );
      source.onmessage = (event) => {
        state.bytes += new TextEncoder().encode(event.data).byteLength;
        state.largest = Math.max(
          state.largest,
          new TextEncoder().encode(event.data).byteLength,
        );
        const envelope = JSON.parse(event.data),
          payload = envelope.payload;
        state.seq.push(envelope.seq);
        if (payload.historySourceId)
          state.sources.push(payload.historySourceId);
        if (payload.truncated || payload.update?.truncated) state.truncated++;
        if (envelope.event === "acp-message" && payload.kind === "permission")
          state.acpApproval =
            payload.requestId === "acp-approval" &&
            payload.options[0].optionId === "allow_once";
        if (envelope.event === "cc-permission-request")
          state.ccApproval =
            payload.requestId === "cc-approval" &&
            payload.toolInput.command === "pwd";
        if (envelope.event === "cc-message" && payload.uuid === "cc-image") {
          state.ccImage =
            payload.truncated === true &&
            payload.historyDetail?.itemId === "cc-image" &&
            payload.historyImages?.[0]?.mimeType === "image/gif" &&
            payload.message.content[0].text === "keep image question" &&
            !JSON.stringify(payload).includes("base64");
        }
        if (
          envelope.event === "acp-message" &&
          payload.historySourceId === 108
        ) {
          state.acpImage =
            payload.update.truncated === true &&
            payload.update.historyDetail?.itemId === "source-108" &&
            payload.update.historyImages?.[0]?.mimeType === "image/gif" &&
            !JSON.stringify(payload).includes("base64");
        }
        if (envelope.event === "cc-message" && payload.uuid === "final") {
          state.final =
            payload.message.content[0].text === "final answer preserved";
          source.close();
        }
      };
    });
    // Fastify flushes the streaming response with its first projected frame.
    // Wait for the real upstream subscription before sending that first frame.
    await expect.poll(() => clients.size).toBe(1);
    const large = "tool body " + "x".repeat(4 * 1024 * 1024);
    let seq = 1;
    for (let n = 0; n < 8; n++) {
      send(seq++, "acp-message", {
        kind: "update",
        connectionId: "connection",
        agentId: "fixture",
        sessionId: "acp-one",
        historySourceId: 100 + n,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: `tool-${n}`,
          title: "Read source",
          status: "completed",
          rawOutput: large,
        },
      });
      send(seq++, "cc-message", {
        type: "user",
        uuid: `cc-tool-${n}`,
        session_id: "cc-one",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: `tool-${n}`,
              content: large,
              is_error: false,
            },
          ],
        },
      });
    }
    const giantGif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64",
    );
    giantGif.writeUInt16LE(10000, 6);
    giantGif.writeUInt16LE(5000, 8);
    const image = giantGif.toString("base64");
    send(seq++, "cc-message", {
      type: "user",
      uuid: "cc-image",
      session_id: "cc-one",
      message: {
        role: "user",
        content: [
          { type: "text", text: "keep image question" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/gif", data: image },
          },
        ],
      },
    });
    send(seq++, "acp-message", {
      kind: "update",
      connectionId: "connection",
      agentId: "fixture",
      sessionId: "acp-one",
      historySourceId: 108,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", mimeType: "image/gif", data: image },
      },
    });
    send(seq++, "acp-message", {
      kind: "permission",
      connectionId: "connection",
      agentId: "fixture",
      sessionId: "acp-one",
      requestId: "acp-approval",
      options: [{ optionId: "allow_once", name: "Allow once" }],
    });
    send(seq++, "cc-permission-request", {
      sessionId: "cc-one",
      requestId: "cc-approval",
      toolName: "Bash",
      toolInput: { command: "pwd" },
    });
    send(seq++, "cc-message", {
      type: "assistant",
      uuid: "final",
      session_id: "cc-one",
      message: { content: [{ type: "text", text: "final answer preserved" }] },
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__auxNetwork.final), {
        timeout: 10000,
      })
      .toBe(true);
    const result = await page.evaluate(() => (window as any).__auxNetwork);
    expect(result.opened).toBe(true);
    expect(result.failed).toBe("");
    expect(result.seq).toEqual(Array.from({ length: 21 }, (_, n) => n + 1));
    expect(result.sources).toEqual(
      Array.from({ length: 9 }, (_, n) => 100 + n),
    );
    expect(result.truncated).toBe(18);
    expect(result.ccImage).toBe(true);
    expect(result.acpImage).toBe(true);
    expect(result.acpApproval).toBe(true);
    expect(result.ccApproval).toBe(true);
    expect(result.largest).toBeLessThan(200 * 1024);
    expect(result.bytes).toBeLessThan(3 * 1024 * 1024);
    expect(upstreamBytes).toBeGreaterThan(64 * 1024 * 1024);
    expect(requests).toEqual(["/api/events?since=0"]);
    const metricsPath = testInfo.outputPath("auxiliary-network-metrics.json");
    mkdirSync(dirname(metricsPath), { recursive: true });
    writeFileSync(
      metricsPath,
      JSON.stringify(
        {
          url,
          upstreamBytes,
          ...result,
          scope:
            "native HTTP -> production gateway -> browser EventSource; short transport test, not long RSS acceptance",
        },
        null,
        2,
      ),
    );
    await testInfo.attach("auxiliary-network-metrics", {
      path: metricsPath,
      contentType: "application/json",
    });
  } finally {
    for (const client of clients) client.end();
    upstream.closeAllConnections();
    await Promise.all([
      gateway.close(),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});
