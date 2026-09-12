import { expect, test } from "@playwright/test";

test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
});

test("mobile terminal falls back to the same HTTPS origin when WSS never opens", async ({
  page,
  request,
}) => {
  const marker = `https-fallback-${Date.now()}`;
  const launchResponse = await request.post("/api/agent-launch/pty", {
    data: {
      workspaceId: "default",
      displayName: `HTTPS fallback E2E ${Date.now()}`,
      agentKind: "shell",
      command: `printf '${marker}\\n'; sleep 15`,
      workingDirectory: process.cwd(),
    },
  });
  expect(launchResponse.ok()).toBeTruthy();
  const sessionId = ((await launchResponse.json()) as { id: string }).id;

  try {
    await request.post("/api/agent-sessions/focus", {
      data: { agentSessionId: sessionId },
    });
    await page.routeWebSocket(
      /\/ws\/agent-sessions\/[^/]+\/terminal(?:\?|$)/,
      async (socket) => {
        await socket.close({ code: 1011, reason: "force HTTPS fallback" });
      },
    );

    const streamResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/agent-sessions/${sessionId}/terminal-stream`) &&
        response.status() === 200,
      { timeout: 10_000 },
    );

    await page.goto("/?view=mobile");
    await streamResponse;

    await expect(
      page.locator(".mobile-terminal-surface .xterm-rows"),
    ).toContainText(marker, { timeout: 10_000 });
    await expect(page.locator(".terminal-connection-feedback")).toHaveCount(0);
  } finally {
    await request.delete(`/api/agent-sessions/${sessionId}`);
  }
});
