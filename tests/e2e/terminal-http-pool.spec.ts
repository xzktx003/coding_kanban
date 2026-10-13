import {
  createServer,
  request as httpRequest,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { expect, test } from "@playwright/test";

test("eight HTTP fallback terminals share one connection and leave input APIs available", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(45_000);
  if (!baseURL)
    throw new Error("The fixture needs the configured frontend URL");
  const source = new URL(baseURL);
  const sessions = Array.from({ length: 8 }, (_, index) => ({
    id: `pool-terminal-${index}`,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: `Pool Terminal ${index}`,
    connectionState: "online",
    interactionState: "running",
    outputPreview: "ready",
  }));
  const snapshot = {
    items: sessions,
    activeAgentSessionId: sessions[0].id,
    updatedAt: new Date().toISOString(),
  };
  const streams = new Set<ServerResponse>();
  const subscriptions = new Map<string, string>();
  const inputs: Array<{ id: string; input: string }> = [];
  let multiplex: ServerResponse | undefined;
  let nextStreamId = 0;
  let currentStreamId = "";
  let peakStreams = 0;
  const writeFrame = (
    response: ServerResponse,
    id: string,
    frame: string,
    shared: boolean,
    subscriptionId?: string,
  ) => {
    response.write(
      `${JSON.stringify(shared ? { type: "frame", subscriptionId, agentSessionId: id, frame } : frame)}\n`,
    );
  };
  const replay = (
    response: ServerResponse,
    id: string,
    shared: boolean,
    subscriptionId?: string,
  ) => {
    writeFrame(
      response,
      id,
      JSON.stringify({
        __agentOrchestrator: "terminal-control",
        event: "replay",
        data: `${id} ready\r\n`,
      }),
      shared,
      subscriptionId,
    );
    writeFrame(
      response,
      id,
      JSON.stringify({
        __agentOrchestrator: "terminal-control",
        event: "replay-complete",
      }),
      shared,
      subscriptionId,
    );
  };
  // A real HTTP/1 server is required: page.route().fulfill() bypasses the
  // browser connection pool and cannot reproduce six long streams blocking input.
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname;
    if (!path.startsWith("/api/")) {
      const upstream = (
        source.protocol === "https:" ? httpsRequest : httpRequest
      )(
        new URL(request.url ?? "/", source),
        {
          rejectUnauthorized: false,
          headers: { ...request.headers, host: source.host },
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
        },
      );
      upstream.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
      return;
    }
    const json = (body: unknown, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const legacy = path.match(
      /^\/api\/agent-sessions\/([^/]+)\/terminal-stream$/,
    );
    if (path === "/api/terminal-stream" || legacy) {
      response.writeHead(200, {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      });
      response.flushHeaders();
      streams.add(response);
      peakStreams = Math.max(peakStreams, streams.size);
      if (legacy) replay(response, legacy[1], false);
      else {
        multiplex = response;
        currentStreamId = `fixture-${++nextStreamId}`;
        response.write(
          `${JSON.stringify({ type: "ready", streamId: currentStreamId })}\n`,
        );
      }
      response.on("close", () => {
        streams.delete(response);
        if (multiplex === response) {
          multiplex = undefined;
          subscriptions.clear();
        }
      });
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const subscription = path.match(
      /^\/api\/terminal-stream\/([^/]+)\/subscriptions(?:\/([^/]+))?$/,
    );
    if (subscription) {
      if (!multiplex || subscription[1] !== currentStreamId)
        return json({ code: "TERMINAL_STREAM_NOT_FOUND" }, 404);
      if (request.method === "DELETE") subscriptions.delete(subscription[2]);
      else {
        const { agentSessionId, subscriptionId } = JSON.parse(body);
        subscriptions.set(subscriptionId, agentSessionId);
        replay(multiplex, agentSessionId, true, subscriptionId);
      }
      return json({ ok: true });
    }
    if (path === "/api/agent-sessions") return json(snapshot);
    if (path === "/api/ssh-hosts") return json({ hosts: [] });
    if (path.endsWith("-summary"))
      return json({ available: false, updatedAt: null });
    const stdin = path.match(/^\/api\/agent-sessions\/([^/]+)\/stdin$/);
    if (stdin) inputs.push({ id: stdin[1], input: JSON.parse(body).input });
    return json({ ok: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture has no port");
  try {
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.routeWebSocket("**/*", (socket) =>
      socket.close({ code: 1011, reason: "fixture requires HTTP fallback" }),
    );
    await page.goto(`http://127.0.0.1:${address.port}/?mode=terminal`);
    await page.locator(".grid-card").first().dblclick();
    await page
      .locator('[data-testid^="focus-page-tab-"][aria-pressed="true"]')
      .click();
    await page.getByRole("menuitemradio", { name: /八屏/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".terminal-view-live")).toHaveCount(8);
    await expect
      .poll(() => subscriptions.size === 8 || streams.size >= 6, {
        timeout: 15_000,
      })
      .toBe(true);
    const status = await page.evaluate(() =>
      fetch("/api/health", { signal: AbortSignal.timeout(1500) }).then(
        (response) => response.status,
      ),
    );
    expect(status).toBe(200);
    await expect.poll(() => subscriptions.size, { timeout: 15_000 }).toBe(8);
    expect(streams.size).toBe(1);
    expect(peakStreams).toBe(1);

    // Keep all eight screens redrawing while input travels over ordinary POSTs.
    const outputTimer = setInterval(() => {
      if (!multiplex) return;
      for (const [subscriptionId, agentSessionId] of subscriptions) {
        writeFrame(
          multiplex,
          agentSessionId,
          `\x1b[H${agentSessionId} ${"working ".repeat(64)}\r\n`,
          true,
          subscriptionId,
        );
      }
    }, 15);
    try {
      const textarea = page.locator(
        '[data-active-terminal-pane="true"] .xterm-helper-textarea',
      );
      await textarea.focus();
      await page.keyboard.type("available-input");
      await expect
        .poll(() => inputs.map((item) => item.input).join(""))
        .toContain("available-input");
      expect(
        new Set(
          inputs
            .filter((item) => /available|[a-z-]/.test(item.input))
            .map((item) => item.id),
        ).size,
      ).toBe(1);
      await page.locator(".focus-exit-btn").click();
      await expect.poll(() => streams.size).toBe(0);
      expect(subscriptions.size).toBe(0);
      // Re-entering must create a fresh single stream, with no old subscribers.
      await page.locator(".grid-card").first().dblclick();
      await expect.poll(() => subscriptions.size).toBe(8);
      expect(streams.size).toBe(1);
      await page.locator(".focus-exit-btn").click();
      await expect.poll(() => streams.size).toBe(0);
    } finally {
      clearInterval(outputTimer);
    }
  } finally {
    for (const response of streams) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
