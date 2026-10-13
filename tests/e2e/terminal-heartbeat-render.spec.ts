import { expect, test, type WebSocketRoute } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

test("terminal heartbeats skip unchanged cards while output and search remain live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Observe completed React work, without changing the application components.
  await page.addInitScript(() => {
    const counts = { commits: 0, cards: 0 };
    type Fiber = {
      type?: { name?: string };
      flags: number;
      memoizedProps?: { session?: { id: string } };
      child: Fiber | null;
      sibling: Fiber | null;
    };
    const lastCardProps = new Map<string, unknown>();
    const visit = (fiber: Fiber | null) => {
      while (fiber) {
        if (
          ["AgentGridCard", "AgentGridCardView"].includes(
            fiber.type?.name ?? "",
          ) &&
          (fiber.flags & 1) !== 0
        ) {
          const id = fiber.memoizedProps?.session?.id;
          // A parent bailout can reuse a child fiber with its old flags. Count
          // only newly committed card props, not visits to that reused fiber.
          if (id && lastCardProps.get(id) !== fiber.memoizedProps) {
            counts.cards += 1;
            lastCardProps.set(id, fiber.memoizedProps);
          }
        }
        visit(fiber.child);
        fiber = fiber.sibling;
      }
    };
    Object.assign(window, {
      __gridRenderCounts: counts,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer: unknown) {
          this.renderers.set(1, renderer);
          return 1;
        },
        onCommitFiberRoot(_id: number, root: { current: Fiber }) {
          counts.commits += 1;
          visit(root.current);
        },
        onCommitFiberUnmount() {},
      },
    });
  });
  const items = Array.from({ length: 13 }, (_, index) => ({
    id: `heartbeat-${index}`,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: `Heartbeat ${index}`,
    connectionState: "online",
    interactionState: ["running", "idle", "awaiting_input", "idle"][index % 4],
    hasUnreadCompletion: index % 4 === 3,
    outputPreview: "initial output",
    lastOutputAt: "2026-10-13T00:00:00.000Z",
    lastHeartbeatAt: "2026-10-13T00:00:00.000Z",
    lastRefreshedAt: "2026-10-13T00:00:00.000Z",
  }));
  const snapshot = {
    items,
    activeAgentSessionId: items[0].id,
    updatedAt: items[0].lastOutputAt,
  };
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket("**/*", (websocket) => {
    if (new URL(websocket.url()).pathname === "/ws/agent-sessions") {
      socket = websocket;
      websocket.send(JSON.stringify({ type: "snapshot", payload: snapshot }));
    }
  });
  // All backend requests stay in this fixture, including any accidental writes.
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/agent-sessions") json = snapshot;
    else if (path === "/api/ssh-hosts") json = { hosts: [] };
    else if (path.endsWith("/task-summary") || path.endsWith("/git-summary")) {
      json = { available: false, updatedAt: null };
    }
    return route.fulfill({ json });
  });
  await page.goto("/?mode=terminal");
  await expect(page.locator(".grid-card")).toHaveCount(13);
  const readCounts = () =>
    page.evaluate(() => ({
      ...(
        window as Window & {
          __gridRenderCounts: { commits: number; cards: number };
        }
      ).__gridRenderCounts,
    }));
  await expect
    .poll(async () => (await readCounts()).cards)
    .toBeGreaterThanOrEqual(13);
  const flushFrames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  await flushFrames();
  const baseline = await readCounts();
  expect(socket).toBeDefined();
  for (let tick = 1; tick <= 10; tick += 1) {
    const before = await readCounts();
    const timestamp = `2026-10-13T00:00:${String(tick).padStart(2, "0")}.000Z`;
    snapshot.updatedAt = timestamp;
    for (const item of items) {
      item.lastHeartbeatAt = timestamp;
      item.lastRefreshedAt = timestamp;
      item.lastOutputAt = timestamp;
    }
    socket!.send(JSON.stringify({ type: "snapshot", payload: snapshot }));
    await expect
      .poll(async () => (await readCounts()).commits)
      .toBeGreaterThan(before.commits);
    await flushFrames();
  }
  expect((await readCounts()).cards - baseline.cards).toBe(0);

  items[0].outputPreview = "changed output must appear";
  socket!.send(JSON.stringify({ type: "snapshot", payload: snapshot }));
  await expect(
    page
      .locator(".grid-card")
      .filter({ hasText: "changed output must appear" }),
  ).toHaveCount(1);
  expect((await readCounts()).cards - baseline.cards).toBe(1);

  const search = page.getByPlaceholder("会话名称、类型或路径");
  let outputTick = 0;
  const outputTimer = setInterval(() => {
    outputTick += 1;
    for (const item of items) item.outputPreview = `live output ${outputTick}`;
    socket!.send(JSON.stringify({ type: "snapshot", payload: snapshot }));
  }, 25);
  try {
    await search.pressSequentially("Heartbeat 12", { delay: 30 });
  } finally {
    clearInterval(outputTimer);
  }
  expect(outputTick).toBeGreaterThan(1);
  await expect(search).toHaveValue("Heartbeat 12");
  await expect(page.locator(".grid-card")).toHaveCount(1);
  await expect(page.locator(".grid-card-name")).toHaveText("Heartbeat 12");
  await expect(page.locator(".grid-card")).toContainText(
    `live output ${outputTick}`,
  );
});
