import { test, expect, type Page } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

async function trackViteDocument(page: Page) {
  await page.addInitScript(() => {
    const target = window as any;
    target.documentIdentity = Math.random().toString(36) + Date.now();
    target.devSockets = [];
    target.hmrAwaitingVisibility = false;
    const addDocumentListener = document.addEventListener.bind(document);
    document.addEventListener = ((type, listener, options) => {
      if (type === "visibilitychange" && document.visibilityState === "hidden")
        target.hmrAwaitingVisibility = true;
      return addDocumentListener(type, listener, options);
    }) as typeof document.addEventListener;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Type, args) {
        const socket = Reflect.construct(Type, args);
        if (args[1] === "vite-hmr") target.devSockets.push(socket);
        return socket;
      },
    });
  });
}

async function installRealViteSocket(page: Page) {
  await page.routeWebSocket(
    (url) => url.searchParams.has("token"),
    (socket) => socket.connectToServer(),
  );
}

async function loseSocketWhileHidden(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const sockets = (window as any).devSockets as WebSocket[];
    sockets.find((socket) => socket.readyState === WebSocket.OPEN)!.close();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).hmrAwaitingVisibility))
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

for (const width of [393, 1280]) {
  test(`a backgrounded workbench reconnects Vite without refreshing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    await trackViteDocument(page);
    const f = await setup(page, true, () => installRealViteSocket(page));
    try {
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).devSockets.some(
              (socket: WebSocket) => socket.readyState === WebSocket.OPEN,
            ),
          ),
        )
        .toBe(true);
      const editor = page
        .locator(".session-agent-view [contenteditable=true]")
        .first();
      await editor.fill("手机短暂切后台时保留的输入");
      const identity = await page.evaluate(
        () => (window as any).documentIdentity,
      );

      await loseSocketWhileHidden(page);

      await expect
        .poll(() => page.evaluate(() => (window as any).devSockets.length), {
          timeout: 15_000,
        })
        .toBeGreaterThan(1);
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).devSockets.at(-1)?.readyState),
        )
        .toBe(WebSocket.OPEN);
      expect(await page.evaluate(() => (window as any).documentIdentity)).toBe(
        identity,
      );
      await expect(editor).toHaveText("手机短暂切后台时保留的输入");
      expect(f.calls).toEqual([]);
      expect(
        f.fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|unsubscribe))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

for (const generationChange of [
  "missed update",
  "changed server generation",
] as const) {
  test(`a ${generationChange} waits for an explicit refresh and preserves the mobile draft`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await trackViteDocument(page);
    const f = await setup(page, true, () => installRealViteSocket(page));
    try {
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).devSockets.some(
              (socket: WebSocket) => socket.readyState === WebSocket.OPEN,
            ),
          ),
        )
        .toBe(true);
      const editor = page
        .locator(".session-agent-view [contenteditable=true]")
        .first();
      await editor.fill("等待我确认刷新前保留的手机草稿");
      const identity = await page.evaluate(
        () => (window as any).documentIdentity,
      );
      const originalState = await page.evaluate(async () =>
        (await fetch("/__workbench_hmr_state", { cache: "no-store" })).json(),
      );
      const updatedState =
        generationChange === "changed server generation"
          ? {
              ...originalState,
              instanceId: `${originalState.instanceId}-next`,
              revision: 0,
            }
          : { ...originalState, revision: originalState.revision + 1 };
      await page.route("**/__workbench_hmr_state", (route) =>
        route.fulfill({ json: updatedState }),
      );

      await loseSocketWhileHidden(page);

      const refresh = page.getByRole("button", {
        name: "刷新界面",
        exact: true,
      });
      await expect(refresh).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => (window as any).documentIdentity)).toBe(
        identity,
      );
      await expect(editor).toHaveText("等待我确认刷新前保留的手机草稿");
      const bounds = await refresh.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      await refresh.click();
      await expect
        .poll(() => page.evaluate(() => (window as any).documentIdentity))
        .not.toBe(identity);
      await expect(editor).toHaveText("等待我确认刷新前保留的手机草稿");
      expect(f.calls).toEqual([]);
      expect(
        f.fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test("a mobile foreground connection survives three network losses in the same document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await trackViteDocument(page);
  const f = await setup(page, true, () => installRealViteSocket(page));
  try {
    const identity = await page.evaluate(
      () => (window as any).documentIdentity,
    );
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await editor.fill("连续弱网重连的手机草稿");
    for (let index = 0; index < 3; index++) {
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).devSockets.at(-1)?.readyState),
        )
        .toBe(WebSocket.OPEN);
      const count = await page.evaluate(
        () => (window as any).devSockets.length,
      );
      await page.evaluate(() => (window as any).devSockets.at(-1).close());
      await expect
        .poll(() => page.evaluate(() => (window as any).devSockets.length))
        .toBeGreaterThan(count);
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).devSockets.at(-1)?.readyState),
        )
        .toBe(WebSocket.OPEN);
      expect(await page.evaluate(() => (window as any).documentIdentity)).toBe(
        identity,
      );
    }
    await expect(editor).toHaveText("连续弱网重连的手机草稿");
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
