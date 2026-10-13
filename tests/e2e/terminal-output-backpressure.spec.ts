import { expect, test, type Page } from "@playwright/test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

test.use({ ignoreHTTPSErrors: true });

function makeSession(
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "backpressure-terminal",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Backpressure Terminal",
    workingDirectory: "/tmp/terminal-backpressure-fixture",
    connectionState: "online",
    interactionState: "running",
    outputPreview: "ready",
    ...overrides,
  };
}

function buildSnapshot(items: AgentSessionRecord[]): ListAgentSessionsResponse {
  return {
    items,
    activeAgentSessionId: items[0]?.id ?? null,
    updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

async function installTerminalBackpressureFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("terminal-output-backpressure-storage")) {
      localStorage.clear();
      sessionStorage.setItem("terminal-output-backpressure-storage", "1");
    }

    const trackedWindow = window as Window & {
      __terminalBackpressureClosedUrls?: string[];
      __terminalBackpressureEmit?: (frames: string[]) => void;
      __terminalBackpressureSends?: string[];
      __terminalBackpressureUrls?: string[];
      __terminalBackpressureWrites?: string[];
    };
    trackedWindow.__terminalBackpressureClosedUrls = [];
    trackedWindow.__terminalBackpressureSends = [];
    trackedWindow.__terminalBackpressureUrls = [];
    trackedWindow.__terminalBackpressureWrites = [];
    const terminalSockets: MockWebSocket[] = [];
    let terminalConnectionCount = 0;

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.CONNECTING;
      bufferedAmount = 0;
      extensions = "";
      protocol = "";
      binaryType: BinaryType = "blob";
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        const isTerminalSocket =
          this.url.includes("/ws/agent-sessions/") &&
          this.url.includes("/terminal");
        if (isTerminalSocket) {
          terminalConnectionCount += 1;
          trackedWindow.__terminalBackpressureUrls?.push(this.url);
          terminalSockets.push(this);
        }

        queueMicrotask(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) {
            return;
          }
          this.readyState = MockWebSocket.OPEN;
          const openEvent = new Event("open");
          this.dispatchEvent(openEvent);
          this.onopen?.(openEvent);
          if (!isTerminalSocket) {
            return;
          }

          const replayText =
            terminalConnectionCount === 1
              ? "initial replay\r\n"
              : "recovered replay\r\n";
          for (const data of [
            JSON.stringify({
              __agentOrchestrator: "terminal-control",
              event: "replay",
              data: replayText,
            }),
            JSON.stringify({
              __agentOrchestrator: "terminal-control",
              event: "replay-complete",
            }),
          ]) {
            const message = new MessageEvent("message", { data });
            this.dispatchEvent(message);
            this.onmessage?.(message);
          }
        });
      }

      send(data?: unknown) {
        if (this.url.includes("/terminal")) {
          trackedWindow.__terminalBackpressureSends?.push(String(data ?? ""));
        }
      }

      close() {
        if (this.readyState === MockWebSocket.CLOSED) {
          return;
        }
        this.readyState = MockWebSocket.CLOSED;
        if (this.url.includes("/terminal")) {
          trackedWindow.__terminalBackpressureClosedUrls?.push(this.url);
        }
        const closeEvent = new Event("close");
        this.dispatchEvent(closeEvent);
        this.onclose?.(closeEvent);
      }
    }

    trackedWindow.__terminalBackpressureEmit = (frames) => {
      const socket = terminalSockets.at(-1);
      if (!socket || socket.readyState !== MockWebSocket.OPEN) {
        throw new Error("No open terminal socket");
      }
      for (const data of frames) {
        const message = new MessageEvent("message", { data });
        socket.dispatchEvent(message);
        socket.onmessage?.(message);
      }
    };

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  });
}

async function mockTerminalApis(page: Page): Promise<void> {
  const session = makeSession();
  await installTerminalBackpressureFixture(page);
  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({ json: { hosts: [] } });
  });
  await page.route("**/api/agent-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ json: buildSnapshot([session]) });
      return;
    }
    await route.fulfill({ json: buildSnapshot([session]) });
  });
  await page.route("**/api/agent-sessions/focus", async (route) => {
    await route.fulfill({ json: buildSnapshot([session]) });
  });
  await page.route("**/api/agent-sessions/*/task-summary", async (route) => {
    await route.fulfill({ json: { available: false, updatedAt: null } });
  });
  await page.route("**/api/agent-sessions/*/git-summary", async (route) => {
    await route.fulfill({ json: { available: false, updatedAt: null } });
  });
}

async function patchCurrentTerminalWriteToStall(page: Page): Promise<number> {
  return page.evaluate(() => {
    const container = document.querySelector(".terminal-view") as
      | (HTMLDivElement & {
          __xterm?: {
            write: (data: string, callback?: () => void) => void;
          };
        })
      | null;
    const term = container?.__xterm;
    if (!term) {
      throw new Error("Terminal instance not found");
    }
    const trackedWindow = window as Window & {
      __terminalBackpressureFirstXterm?: unknown;
      __terminalBackpressureWrites?: string[];
    };
    trackedWindow.__terminalBackpressureFirstXterm = term;
    const originalWrite = term.write.bind(term);
    term.write = (data: string, callback?: () => void) => {
      trackedWindow.__terminalBackpressureWrites?.push(String(data));
      if (String(data).includes("BACKPRESSURE_STALL")) {
        return;
      }
      originalWrite(data, callback);
    };
    return 1;
  });
}

async function readBackpressureStats(page: Page): Promise<{
  closed: number;
  sends: string[];
  urls: string[];
  writes: string[];
}> {
  return page.evaluate(() => {
    const trackedWindow = window as Window & {
      __terminalBackpressureClosedUrls?: string[];
      __terminalBackpressureSends?: string[];
      __terminalBackpressureUrls?: string[];
      __terminalBackpressureWrites?: string[];
    };
    return {
      closed: trackedWindow.__terminalBackpressureClosedUrls?.length ?? 0,
      sends: [...(trackedWindow.__terminalBackpressureSends ?? [])],
      urls: [...(trackedWindow.__terminalBackpressureUrls ?? [])],
      writes: [...(trackedWindow.__terminalBackpressureWrites ?? [])],
    };
  });
}

async function openFocusedTerminal(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockTerminalApis(page);
  await page.goto("/?mode=terminal");

  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Backpressure Terminal" }),
  });
  await expect(card).toBeVisible();
  await card.locator(".grid-card-terminal").dblclick();
  await expect(page.locator(".focus-main .terminal-view .xterm")).toBeVisible();
  await expect(page.locator(".focus-main .xterm-rows")).toContainText(
    "initial replay",
  );
}

async function overflowCurrentTerminalOutput(page: Page): Promise<void> {
  await patchCurrentTerminalWriteToStall(page);
  const largeFrame = `BACKPRESSURE_STALL ${"x".repeat(64 * 1024)}`;
  await page.evaluate((frame) => {
    const trackedWindow = window as Window & {
      __terminalBackpressureEmit?: (frames: string[]) => void;
    };
    trackedWindow.__terminalBackpressureEmit?.(Array(20).fill(frame));
  }, largeFrame);
}

test("terminal output backpressure rebuilds xterm and reconnects for replay", async ({
  page,
}) => {
  await openFocusedTerminal(page);
  await overflowCurrentTerminalOutput(page);

  await expect
    .poll(async () => (await readBackpressureStats(page)).closed)
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () => (await readBackpressureStats(page)).urls.length)
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".focus-main .terminal-view .xterm")).toHaveCount(
    1,
  );
  await expect(page.locator(".focus-main .xterm-rows")).toContainText(
    "recovered replay",
  );

  const currentIsRebuilt = await page.evaluate(() => {
    const container = document.querySelector(".terminal-view") as
      | (HTMLDivElement & { __xterm?: unknown })
      | null;
    const trackedWindow = window as Window & {
      __terminalBackpressureFirstXterm?: unknown;
    };
    return (
      Boolean(container?.__xterm) &&
      container?.__xterm !== trackedWindow.__terminalBackpressureFirstXterm
    );
  });
  expect(currentIsRebuilt).toBe(true);

  await page.locator(".focus-main .xterm-helper-textarea").press("a");
  await expect
    .poll(async () => (await readBackpressureStats(page)).sends.join(""))
    .toContain("a");

  await page.locator(".focus-exit-btn").click();
  await expect(page.locator(".focus-main .terminal-view .xterm")).toHaveCount(
    0,
  );
});

test("terminal output backpressure does not rebuild after the pane unmounts", async ({
  page,
}) => {
  await openFocusedTerminal(page);
  await overflowCurrentTerminalOutput(page);
  await expect
    .poll(async () => (await readBackpressureStats(page)).closed)
    .toBeGreaterThanOrEqual(1);

  await page.locator(".focus-exit-btn").click();
  await expect(page.locator(".focus-main .terminal-view .xterm")).toHaveCount(
    0,
  );
  await page.waitForTimeout(1000);

  const stats = await readBackpressureStats(page);
  expect(stats.urls).toHaveLength(1);
});
