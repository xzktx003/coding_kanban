import { expect, test, type Locator, type Page } from "@playwright/test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

test.use({ ignoreHTTPSErrors: true });

function makeSession(
  overrides: Partial<AgentSessionRecord>,
): AgentSessionRecord {
  return {
    id: "session-default",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Default Session",
    workingDirectory: "/data01/home/xuzk/workspace/coding_kanban",
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
    updatedAt: new Date().toISOString(),
  };
}

async function installTrackingWebSocket(
  page: Page,
  {
    stalledTerminalConnections = 0,
  }: { stalledTerminalConnections?: number } = {},
): Promise<void> {
  await page.addInitScript((initialStalledTerminalConnections: number) => {
    localStorage.clear();

    const trackedWindow = window as Window & {
      __allWebSocketUrls?: string[];
      __closeLatestTerminalWebSocket?: () => void;
      __disableTerminalMonitorDragImageForTest?: boolean;
      __terminalWebSocketSends?: string[];
      __terminalWebSocketUrls?: string[];
    };
    trackedWindow.__allWebSocketUrls = [];
    trackedWindow.__disableTerminalMonitorDragImageForTest = true;
    trackedWindow.__terminalWebSocketSends = [];
    trackedWindow.__terminalWebSocketUrls = [];
    const terminalSockets: MockWebSocket[] = [];
    let remainingStalledTerminalConnections = initialStalledTerminalConnections;

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

        trackedWindow.__allWebSocketUrls?.push(this.url);
        const isTerminalSocket =
          this.url.includes("/ws/agent-sessions/") &&
          this.url.includes("/terminal");
        if (isTerminalSocket) {
          trackedWindow.__terminalWebSocketUrls?.push(this.url);
          terminalSockets.push(this);
        }

        if (isTerminalSocket && remainingStalledTerminalConnections > 0) {
          remainingStalledTerminalConnections -= 1;
          return;
        }

        queueMicrotask(() => {
          this.readyState = MockWebSocket.OPEN;
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
          if (this.url.includes("/terminal")) {
            const message = new MessageEvent("message", {
              data: JSON.stringify({
                __agentOrchestrator: "terminal-control",
                event: "replay-complete",
              }),
            });
            this.dispatchEvent(message);
            this.onmessage?.(message);
          }
        });
      }

      send(data?: unknown) {
        if (this.url.includes("/terminal")) {
          trackedWindow.__terminalWebSocketSends?.push(String(data ?? ""));
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const event = new Event("close");
        this.dispatchEvent(event);
        this.onclose?.(event);
      }
    }

    trackedWindow.__closeLatestTerminalWebSocket = () => {
      terminalSockets.at(-1)?.close();
    };

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  }, stalledTerminalConnections);
}

async function mockSessions(
  page: Page,
  sessions: AgentSessionRecord[],
  options?: { stalledTerminalConnections?: number },
): Promise<void> {
  await installTrackingWebSocket(page, options);
  let currentSessions = sessions;
  let activeAgentSessionId = sessions[0]?.id ?? null;

  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ hosts: [] }),
    });
  });

  await page.route("**/api/agent-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...buildSnapshot(currentSessions),
        activeAgentSessionId,
      }),
    });
  });

  await page.route("**/api/agent-sessions/focus", async (route) => {
    const body = route.request().postDataJSON() as {
      agentSessionId: string;
    };
    activeAgentSessionId = body.agentSessionId;
    currentSessions = currentSessions.map((session) =>
      session.id === body.agentSessionId
        ? { ...session, hasUnreadCompletion: false }
        : session,
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...buildSnapshot(currentSessions),
        activeAgentSessionId,
      }),
    });
  });
}

async function terminalWebSocketUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return [
      ...((window as Window & { __terminalWebSocketUrls?: string[] })
        .__terminalWebSocketUrls ?? []),
    ];
  });
}

async function terminalWebSocketSends(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return [
      ...((window as Window & { __terminalWebSocketSends?: string[] })
        .__terminalWebSocketSends ?? []),
    ];
  });
}

async function dragRangeToValue(
  page: Page,
  slider: Locator,
  value: number,
): Promise<void> {
  await dragRangeToValueBeforeRelease(page, slider, value);
  await page.mouse.up();
}

async function dragRangeToValueBeforeRelease(
  page: Page,
  slider: Locator,
  value: number,
): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) {
    throw new Error("Range input is not visible");
  }

  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  const current = Number(await slider.inputValue());
  const valueToX = (nextValue: number) =>
    box.x + (box.width * (nextValue - min)) / (max - min);
  const y = box.y + box.height / 2;

  await page.mouse.move(valueToX(current), y);
  await page.mouse.down();
  await page.mouse.move(valueToX(value), y, { steps: 8 });
}

async function focusedTerminalFontSize(page: Page): Promise<number | null> {
  return page.locator(".focus-main-terminal .terminal-view-live").evaluate(
    (element) =>
      (
        element as HTMLElement & {
          __xterm?: { options?: { fontSize?: number } };
        }
      ).__xterm?.options?.fontSize ?? null,
  );
}

async function dragElementToPane(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const source = document.querySelector(sourceSelector);
      const target = document.querySelector(targetSelector);
      if (!source || !target) {
        throw new Error("Drag source or target not found");
      }

      const dataTransfer = new DataTransfer();
      const dispatchDragEvent = (element: Element, type: string) => {
        const event = new Event(type, {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "dataTransfer", {
          configurable: true,
          value: dataTransfer,
        });
        element.dispatchEvent(event);
      };

      dispatchDragEvent(source, "dragstart");
      if (!dataTransfer.getData("text/plain")) {
        const sourceSession =
          source
            .closest("[data-session-id]")
            ?.getAttribute("data-session-id") ??
          source
            .closest("[data-terminal-pane-session]")
            ?.getAttribute("data-terminal-pane-session");
        if (!sourceSession) {
          throw new Error("Drag source session not found");
        }
        const sourceSlot =
          source
            .closest("[data-terminal-pane-slot]")
            ?.getAttribute("data-terminal-pane-slot") ?? undefined;
        const payload = JSON.stringify({
          sessionId: sourceSession,
          sourceSlotId: sourceSlot,
        });
        dataTransfer.setData(
          "application/x-coding-kanban-terminal-session",
          payload,
        );
        dataTransfer.setData("text/plain", payload);
      }
      dispatchDragEvent(target, "dragover");
      dispatchDragEvent(target, "drop");
      dispatchDragEvent(source, "dragend");
    },
    { sourceSelector, targetSelector },
  );
}

test("grid cards use lightweight terminal previews without opening terminal WebSockets", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await expect(page.locator(".grid-card")).toHaveCount(2);
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(2);
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    0,
  );
  await expect(page.locator(".grid-card-terminal .xterm")).toHaveCount(0);
  await expect(
    page.locator(".grid-card", { hasText: "Alpha Session" }),
  ).toContainText("alpha ready");

  expect(await terminalWebSocketUrls(page)).toEqual([]);
});

test("focused terminal reconnects after an unexpected WebSocket close and accepts input", async ({
  page,
}) => {
  const session = makeSession({
    id: "reconnect-session",
    displayName: "Reconnect Session",
    outputPreview: "ready",
  });
  await mockSessions(page, [session]);
  await page.goto("/");

  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: session.displayName }),
  });
  await card.dblclick();
  await expect(page.locator(".focus-main")).toBeVisible();
  await expect.poll(() => terminalWebSocketUrls(page)).toHaveLength(1);

  await page.evaluate(() => {
    (
      window as Window & { __closeLatestTerminalWebSocket?: () => void }
    ).__closeLatestTerminalWebSocket?.();
  });

  await expect
    .poll(() => terminalWebSocketUrls(page), { timeout: 5_000 })
    .toHaveLength(2);

  const textarea = page.locator(
    '[data-active-terminal-pane="true"] .xterm-helper-textarea',
  );
  await textarea.click();
  await page.keyboard.type("reconnected-input");
  await expect
    .poll(async () => (await terminalWebSocketSends(page)).join(""))
    .toContain("reconnected-input");
});

test("focused terminal retries a WebSocket that never finishes connecting", async ({
  page,
}) => {
  const session = makeSession({
    id: "connecting-session",
    displayName: "Connecting Session",
    outputPreview: "ready",
  });
  await mockSessions(page, [session], { stalledTerminalConnections: 1 });
  await page.goto("/");

  const card = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: session.displayName }),
  });
  await card.dblclick();
  await expect(page.locator(".focus-main")).toBeVisible();
  await expect
    .poll(() => terminalWebSocketUrls(page), { timeout: 6_000 })
    .toHaveLength(2);

  const textarea = page.locator(
    '[data-active-terminal-pane="true"] .xterm-helper-textarea',
  );
  await textarea.click();
  await page.keyboard.type("recovered-from-connecting");
  await expect
    .poll(async () => (await terminalWebSocketSends(page)).join(""))
    .toContain("recovered-from-connecting");
});

test("grid sorts sessions into four status columns and stacks them on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockSessions(page, [
    makeSession({
      id: "response-session",
      displayName: "Needs Response",
      interactionState: "awaiting_input",
    }),
    makeSession({
      id: "working-session",
      displayName: "Working Session",
      interactionState: "running",
    }),
    makeSession({
      id: "review-session",
      displayName: "Review Session",
      interactionState: "idle",
      hasUnreadCompletion: true,
    }),
    makeSession({
      id: "ready-session",
      displayName: "Ready Session",
      interactionState: "idle",
    }),
    makeSession({
      id: "exited-session",
      displayName: "Exited Session",
      interactionState: "exited",
    }),
    makeSession({
      id: "available-session",
      displayName: "Available Session",
      interactionState: "detached",
    }),
  ]);

  await page.goto("/");

  const board = page.getByTestId("agent-grid");
  const response = board.locator('[data-kanban-column="response"]');
  const executing = board.locator('[data-kanban-column="executing"]');
  const review = board.locator('[data-kanban-column="review"]');
  const ready = board.locator('[data-kanban-column="ready"]');

  await expect(board.locator(".agent-kanban-column")).toHaveCount(4);
  await expect(response).toContainText("需响应1");
  await expect(response).toContainText("Needs Response");
  await expect(response).not.toContainText("Review Session");
  await expect(executing).toContainText("执行中1");
  await expect(executing).toContainText("Working Session");
  await expect(review).toContainText("待验收1");
  await expect(review).toContainText("Review Session");
  await expect(ready).toContainText("可继续3");
  await expect(ready).toContainText("Ready Session");
  await expect(ready).toContainText("Exited Session");
  await expect(ready).toContainText("Available Session");
  await expect
    .poll(() =>
      board.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(4);

  await page.setViewportSize({ width: 800, height: 720 });

  await expect
    .poll(() =>
      board.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(1);
  await expect
    .poll(async () => {
      const responseBox = await response.boundingBox();
      const executingBox = await executing.boundingBox();
      return Boolean(
        responseBox && executingBox && executingBox.y > responseBox.y,
      );
    })
    .toBe(true);
});

test("viewing an unread completion moves it from review to ready", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "review-session",
      displayName: "Review Result",
      interactionState: "idle",
      hasUnreadCompletion: true,
    }),
  ]);

  await page.goto("/");

  const review = page.locator('[data-kanban-column="review"]');
  const ready = page.locator('[data-kanban-column="ready"]');
  await expect(review).toContainText("Review Result");
  await expect(review).toContainText("待验收");

  await page.locator(".grid-card", { hasText: "Review Result" }).dblclick();
  await expect(page.locator(".focus-view")).toBeVisible();
  await page.getByRole("button", { name: "返回宫格" }).click();

  await expect(ready).toContainText("Review Result");
  await expect(review).not.toContainText("Review Result");
});

test("viewing a response-required session keeps it in response", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "response-required-session",
      displayName: "Answer Required",
      interactionState: "awaiting_input",
    }),
  ]);

  await page.goto("/");

  const response = page.locator('[data-kanban-column="response"]');
  await expect(response).toContainText("Answer Required");

  await page.locator(".grid-card", { hasText: "Answer Required" }).dblclick();
  await expect(page.locator(".focus-view")).toBeVisible();
  await page.getByRole("button", { name: "返回宫格" }).click();

  await expect(response).toContainText("Answer Required");
  await expect(page.locator('[data-kanban-column="ready"]')).not.toContainText(
    "Answer Required",
  );
});

test("opening an unread completion on mobile acknowledges it", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "mobile-review-session",
      displayName: "Mobile Review Result",
      interactionState: "idle",
      hasUnreadCompletion: true,
    }),
  ]);

  await page.goto("/?view=mobile");

  await expect(page.locator(".mobile-workbench-page")).toContainText(
    "Mobile Review Result",
  );
  await page.getByRole("link", { name: "电脑端 Coding Kanban" }).click();

  const review = page.locator('[data-kanban-column="review"]');
  const ready = page.locator('[data-kanban-column="ready"]');
  await expect(ready).toContainText("Mobile Review Result");
  await expect(review).not.toContainText("Mobile Review Result");
});

test("monitor session switcher groups choices and marks occupied panes", async ({
  page,
}) => {
  const sessions = [
    makeSession({ id: "session-alpha", displayName: "Alpha" }),
    makeSession({ id: "session-beta", displayName: "Beta" }),
    makeSession({ id: "session-gamma", displayName: "Gamma" }),
    makeSession({ id: "session-delta", displayName: "Delta" }),
    ...[
      "Epsilon",
      "Zeta",
      "Eta",
      "Theta",
      "Iota",
      "Kappa",
      "Lambda",
      "Mu",
      "Nu",
      "Xi",
      "Omicron",
      "Pi",
    ].map((displayName) =>
      makeSession({
        id: `session-${displayName.toLowerCase()}`,
        displayName,
      }),
    ),
  ];
  await mockSessions(page, sessions);
  await page.addInitScript(
    ({ sessionIds }) => {
      localStorage.setItem(
        "coding-kanban-session-groups-v1",
        JSON.stringify({
          groups: [
            { id: "group-research", name: "模型与量化" },
            { id: "group-platform", name: "工程与平台" },
          ],
          assignments: {
            "session:session-alpha": "group-research",
            "session:session-beta": "group-research",
            "session:session-epsilon": "group-research",
            "session:session-zeta": "group-research",
            "session:session-eta": "group-research",
            "session:session-theta": "group-research",
            "session:session-gamma": "group-platform",
            "session:session-iota": "group-platform",
          },
          collapsedGroupIds: [],
        }),
      );
      localStorage.setItem(
        "terminal-monitor-workspace-v1",
        JSON.stringify({
          mode: "dual",
          slots: [
            { id: "terminal-monitor-slot-1", sessionId: sessionIds[0] },
            { id: "terminal-monitor-slot-2", sessionId: sessionIds[1] },
          ],
          activeSlotId: "terminal-monitor-slot-1",
          closedSlotIds: [],
        }),
      );
    },
    { sessionIds: sessions.map((session) => session.id) },
  );
  await page.goto("/");

  const alphaCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Alpha" }),
  });
  await alphaCard.dblclick();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  await firstPane
    .getByRole("combobox", { name: "选择第 1 个监控终端" })
    .click();

  const menu = page.getByRole("dialog", {
    name: "切换第 1 个监控终端",
  });
  await expect(menu).toBeVisible();
  const searchInput = menu.getByRole("searchbox", {
    name: "搜索会话或分组",
  });
  await expect(searchInput).toBeFocused();
  await searchInput.fill("平台");
  await expect(
    menu.locator('[data-terminal-switch-group-id="group-platform"]'),
  ).toContainText("工程与平台2");
  await expect(
    menu.locator('[data-terminal-switch-group-id="group-research"]'),
  ).toHaveCount(0);
  await searchInput.fill("Delta");
  await expect(
    menu.locator('[data-terminal-switch-group-id="__ungrouped__"]'),
  ).toContainText("未分组1");
  await expect(
    menu.locator('[data-terminal-switch-session-id="session-delta"]'),
  ).toBeVisible();
  await searchInput.fill("");
  const groupedList = menu.getByRole("listbox", {
    name: "第 1 个终端可选会话",
  });
  await expect(
    groupedList.locator(":scope > [data-terminal-switch-group-id]"),
  ).toHaveCount(3);
  await expect(
    menu.locator('[data-terminal-switch-group-id="group-research"]'),
  ).toContainText("模型与量化6");
  await expect(
    menu.locator('[data-terminal-switch-group-id="group-platform"]'),
  ).toContainText("工程与平台2");
  await expect(
    menu.locator('[data-terminal-switch-group-id="__ungrouped__"]'),
  ).toContainText("未分组8");
  await expect(
    menu.locator('[data-terminal-switch-session-id="session-alpha"]'),
  ).toContainText("当前");
  await expect(
    menu.locator('[data-terminal-switch-session-id="session-beta"]'),
  ).toContainText("窗格 2");
  await expect(
    menu.locator('[data-terminal-switch-session-id="session-beta"]'),
  ).toBeDisabled();
  await groupedList.evaluate((element) => {
    element.scrollTop = 0;
  });
  await groupedList.hover();
  await page.mouse.wheel(0, 420);
  await expect
    .poll(() => groupedList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const researchHeader = menu
    .locator('[data-terminal-switch-group-id="group-research"]')
    .locator(".terminal-session-switch-group-header");
  await groupedList.evaluate((element) => {
    element.scrollTop = 96;
  });
  await expect
    .poll(async () => {
      const [listBox, headerBox, paddingTop] = await Promise.all([
        groupedList.boundingBox(),
        researchHeader.boundingBox(),
        groupedList.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingTop),
        ),
      ]);
      return Math.abs(
        (headerBox?.y ?? -1000) - (listBox?.y ?? 1000) - paddingTop,
      );
    })
    .toBeLessThan(3);

  const platformHeader = menu
    .locator('[data-terminal-switch-group-id="group-platform"]')
    .locator(".terminal-session-switch-group-header");
  await groupedList.evaluate((element) => {
    const platformGroup = element.querySelector<HTMLElement>(
      '[data-terminal-switch-group-id="group-platform"]',
    );
    if (!platformGroup) {
      throw new Error("platform group is missing");
    }
    const paddingTop = Number.parseFloat(getComputedStyle(element).paddingTop);
    element.scrollTop +=
      platformGroup.getBoundingClientRect().top -
      element.getBoundingClientRect().top -
      paddingTop +
      12;
  });
  await expect
    .poll(async () => {
      const [listBox, headerBox, paddingTop] = await Promise.all([
        groupedList.boundingBox(),
        platformHeader.boundingBox(),
        groupedList.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingTop),
        ),
      ]);
      return Math.abs(
        (headerBox?.y ?? -1000) - (listBox?.y ?? 1000) - paddingTop,
      );
    })
    .toBeLessThan(3);
  await expect
    .poll(async () => {
      const [researchBox, platformBox] = await Promise.all([
        researchHeader.boundingBox(),
        platformHeader.boundingBox(),
      ]);
      return (researchBox?.y ?? 1000) < (platformBox?.y ?? -1000);
    })
    .toBe(true);
  const finalUngroupedOption = menu.locator(
    '[data-terminal-switch-session-id="session-pi"]',
  );
  await finalUngroupedOption.scrollIntoViewIfNeeded();
  await expect(finalUngroupedOption).toBeVisible();

  await menu
    .locator('[data-terminal-switch-session-id="session-delta"]')
    .click();
  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "session-delta",
  );
  await expect(menu).toBeHidden();

  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );
  await secondPane
    .getByRole("combobox", { name: "选择第 2 个监控终端" })
    .click();
  await page
    .locator('[data-terminal-switch-session-id="session-beta"]')
    .click();
  await expect(firstPane).toHaveAttribute("data-active-terminal-pane", "true");
  await expect(secondPane).toHaveAttribute(
    "data-active-terminal-pane",
    "false",
  );
});

test("renders distinct group colors consistently across board and switcher", async ({
  page,
}) => {
  const sessions = Array.from({ length: 14 }, (_, index) =>
    makeSession({
      id: `color-session-${index}`,
      displayName: `Color Session ${index}`,
    }),
  );
  const groups = sessions.map((_, index) => ({
    id: `color-group-${index}`,
    name: `颜色组 ${index}`,
  }));

  await mockSessions(page, sessions);
  await page.addInitScript(
    ({ groups: configuredGroups, sessionIds }) => {
      localStorage.setItem(
        "coding-kanban-session-groups-v1",
        JSON.stringify({
          groups: configuredGroups,
          assignments: Object.fromEntries(
            sessionIds.map((sessionId, index) => [
              `session:${sessionId}`,
              `color-group-${index}`,
            ]),
          ),
          collapsedGroupIds: [],
        }),
      );
    },
    { groups, sessionIds: sessions.map((session) => session.id) },
  );
  await page.goto("/");

  const boardHeaders = page.locator(
    '.session-group-header[data-session-group-id^="color-group-"]',
  );
  await expect(boardHeaders).toHaveCount(groups.length);
  const boardColors = await boardHeaders.evaluateAll((elements) =>
    elements.map((element) =>
      getComputedStyle(element)
        .getPropertyValue("--session-group-accent")
        .trim(),
    ),
  );
  expect(new Set(boardColors).size).toBe(groups.length);

  await page.locator(".grid-card").first().dblclick();
  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  await firstPane
    .getByRole("combobox", { name: "选择第 1 个监控终端" })
    .click();

  const menu = page.getByRole("dialog", {
    name: "切换第 1 个监控终端",
  });
  const switchGroups = menu.locator(
    '.terminal-session-switch-group[data-terminal-switch-group-id^="color-group-"]',
  );
  await expect(switchGroups).toHaveCount(groups.length);
  const switcherColors = await switchGroups.evaluateAll((elements) =>
    elements.map((element) =>
      getComputedStyle(element)
        .getPropertyValue("--terminal-switch-group-accent")
        .trim(),
    ),
  );
  expect(new Set(switcherColors).size).toBe(groups.length);
  expect(switcherColors).toEqual(boardColors);
});

test("keeps a session in its group after a restarted snapshot changes runtime ids", async ({
  page,
}) => {
  const initialSession = makeSession({
    id: "stable-session",
    displayName: "Restarted Session",
    agentSessionId: "agent-before",
    transportRef: {
      runtimeId: "pty:1001",
      tmuxSession: "stable-tmux",
      tmuxPane: "%1",
    },
  });
  const restoredSession = {
    ...initialSession,
    agentSessionId: "agent-after",
    transportRef: {
      runtimeId: "pty:2048",
      tmuxSession: "stable-tmux",
      tmuxPane: "%2",
    },
  };
  let currentSession = initialSession;

  await installTrackingWebSocket(page);
  await page.route("**/api/ssh-hosts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ hosts: [] }),
    });
  });
  await page.route("**/api/agent-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(buildSnapshot([currentSession])),
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "coding-kanban-session-groups-v1",
      JSON.stringify({
        groups: [{ id: "group-research", name: "模型与量化" }],
        assignments: {
          "session:stable-session": "group-research",
          "agent-session:agent-before": "group-research",
        },
        collapsedGroupIds: [],
      }),
    );
  });

  await page.goto("/");
  const groupSection = page.locator(".agent-group-section").filter({
    has: page.locator('[data-session-group-id="group-research"]'),
  });
  await expect(groupSection).toContainText("Restarted Session");

  currentSession = restoredSession;
  await page.reload();
  await expect(
    page.locator(".agent-group-section").filter({
      has: page.locator('[data-session-group-id="group-research"]'),
    }),
  ).toContainText("Restarted Session");
});

test("preview mode toggle restores full terminal previews on demand", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  const toggle = page.getByTestId("terminal-preview-mode-toggle");
  const toggleLabel = toggle.locator("span").first();
  await expect(toggleLabel).toHaveText("轻量预览：开");
  expect(await terminalWebSocketUrls(page)).toEqual([]);

  await toggle.click();

  await expect(toggleLabel).toHaveText("完整预览");
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    2,
  );
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(0);
  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/alpha-session/terminal"));
  expect(await terminalWebSocketUrls(page)).toContainEqual(
    expect.stringContaining("/beta-session/terminal"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("terminal-preview-mode")),
    )
    .toBe("full");
});

test("grid virtualizes full terminal previews when many tmux sessions are joined", async ({
  page,
}) => {
  const sessions = Array.from({ length: 30 }, (_, index) =>
    makeSession({
      id: `bulk-session-${index + 1}`,
      displayName: `Bulk Session ${index + 1}`,
      outputPreview: `bulk ${index + 1} ready`,
      sourceType: "remote-tmux-discovered",
      transportRef: {
        tmuxSession: `bulk-${index + 1}`,
      },
    }),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await mockSessions(page, sessions);
  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  await page.getByTestId("terminal-preview-mode-toggle").click();

  const grid = page.getByTestId("agent-grid");
  await expect(grid).toHaveAttribute("data-virtualized", "true");
  await expect
    .poll(async () =>
      page.locator(".grid-card-terminal .terminal-view").count(),
    )
    .toBeGreaterThan(0);

  const initiallyMountedCards = await page.locator(".grid-card").count();
  const initiallyMountedTerminals = await page
    .locator(".grid-card-terminal .terminal-view")
    .count();
  expect(initiallyMountedCards).toBeLessThan(sessions.length);
  expect(initiallyMountedTerminals).toBeLessThan(sessions.length);
  expect((await terminalWebSocketUrls(page)).length).toBeLessThan(
    sessions.length,
  );

  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(
    page.locator(".grid-card", { hasText: "Bulk Session 30" }),
  ).toBeVisible();
});

test("VS Code preserve-state profile restores full terminal previews for running panes", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page.getByTestId("resource-tuning-menu-toggle").click();
  const vscodeProfileToggle = page.getByTestId("vscode-cache-mode-toggle");
  const vscodeProfileLabel = vscodeProfileToggle.locator("span").first();
  await expect(vscodeProfileLabel).toHaveText("VS Code 省内存");
  const terminalPreviewToggle = page.getByTestId(
    "terminal-preview-mode-toggle",
  );
  const terminalPreviewLabel = terminalPreviewToggle.locator("span").first();
  await expect(terminalPreviewLabel).toHaveText("轻量预览：开");
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(2);
  expect(await terminalWebSocketUrls(page)).toEqual([]);

  await vscodeProfileToggle.click();

  await expect(vscodeProfileLabel).toHaveText("VS Code 保持状态");
  await expect(terminalPreviewLabel).toHaveText("完整预览");
  await expect(page.locator(".grid-card-terminal .terminal-view")).toHaveCount(
    2,
  );
  await expect(
    page.locator(".grid-card-terminal .terminal-preview"),
  ).toHaveCount(0);
  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/alpha-session/terminal"));
  expect(await terminalWebSocketUrls(page)).toContainEqual(
    expect.stringContaining("/beta-session/terminal"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("vscode-iframe-cache-mode")),
    )
    .toBe("preserve-state");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("terminal-preview-mode")),
    )
    .toBe("full");
});

test("focus view keeps every sidebar card lightweight while only the main pane opens a real terminal", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "focused-session",
      displayName: "Focused Session",
      outputPreview: "focused ready",
    }),
    makeSession({
      id: "sidebar-session",
      displayName: "Sidebar Session",
      outputPreview: "sidebar ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Focused Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect(
    page.locator(".focus-sidebar-terminal .terminal-preview"),
  ).toHaveCount(2);
  await expect(
    page.locator(".focus-sidebar-terminal .terminal-view"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("terminal-preview-focused-session"),
  ).toContainText("focused ready");
  await expect(
    page.getByTestId("terminal-preview-sidebar-session"),
  ).toContainText("sidebar ready");

  await expect
    .poll(() => terminalWebSocketUrls(page))
    .toContainEqual(expect.stringContaining("/focused-session/terminal"));
  expect(await terminalWebSocketUrls(page)).not.toContainEqual(
    expect.stringContaining("/sidebar-session/terminal"),
  );
});

test("top font-size slider adjusts the focused terminal font size", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "focused-session",
      displayName: "Focused Session",
      outputPreview: "focused ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Focused Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);

  const slider = page.getByTestId("terminal-font-size-slider");
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("14");

  await dragRangeToValue(page, slider, 21);
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(18);

  const selectedFontSize = Number(await slider.inputValue());
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(selectedFontSize);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe(String(selectedFontSize));
});

test("top font-size slider defers terminal resize until the drag is released", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "deferred-font-session",
      displayName: "Deferred Font Session",
      outputPreview: "deferred font ready",
    }),
  ]);

  await page.goto("/");

  const focusedCard = page.locator(".grid-card", {
    has: page.locator(".grid-card-name", { hasText: "Deferred Font Session" }),
  });
  await expect(focusedCard).toBeVisible();
  await focusedCard.dblclick();

  await expect(
    page.locator(".focus-main-terminal .terminal-view-live"),
  ).toBeVisible();
  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe("14");

  const slider = page.getByTestId("terminal-font-size-slider");
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("14");

  await dragRangeToValueBeforeRelease(page, slider, 21);
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThan(18);
  const selectedFontSize = Number(await slider.inputValue());

  await expect.poll(() => focusedTerminalFontSize(page)).toBe(14);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe("14");

  await page.mouse.up();

  await expect.poll(() => focusedTerminalFontSize(page)).toBe(selectedFontSize);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("terminal-font-size")))
    .toBe(String(selectedFontSize));
});

test("focus monitor panes accept dragged sidebar sessions and swap dragged panes", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await dragElementToPane(
    page,
    '[data-session-id="gamma-session"] .focus-sidebar-card-header',
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(
    page.locator(".focus-sidebar-card", { hasText: "Alpha Session" }),
  ).toBeVisible();

  await dragElementToPane(
    page,
    '[data-terminal-pane-slot="terminal-monitor-slot-1"] .focus-terminal-pane-header',
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
});

test("links sidebar cards to monitor panes without moving monitored sessions", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "alpha",
      outputPreview: "alpha ready",
      transportRef: {
        runtimeId: "tmux:alpha",
        tmuxSession: "alpha",
      },
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");
  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "alpha" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );
  const alphaCard = page.locator(
    '.focus-sidebar-card[data-session-id="alpha-session"]',
  );
  const betaCard = page.locator(
    '.focus-sidebar-card[data-session-id="beta-session"]',
  );
  const gammaCard = page.locator(
    '.focus-sidebar-card[data-session-id="gamma-session"]',
  );

  await expect(alphaCard).toHaveAttribute("data-monitor-index", "1");
  await expect(alphaCard.locator(".focus-sidebar-card-name")).toHaveText(
    "alpha",
  );
  await expect(alphaCard.locator(".focus-sidebar-transport-tag")).toHaveText(
    "tmux",
  );
  await expect(betaCard.locator(".focus-sidebar-transport-tag")).toHaveCount(0);
  await expect(alphaCard).toHaveAttribute(
    "data-active-monitor-session",
    "true",
  );
  await expect(firstPane).toHaveCSS(
    "border-top-color",
    "rgba(255, 152, 0, 0.95)",
  );
  await expect(alphaCard).toHaveCSS(
    "border-top-color",
    "rgba(255, 152, 0, 0.95)",
  );
  await expect(betaCard).toHaveAttribute("data-monitor-index", "2");
  await expect(gammaCard).not.toHaveAttribute("data-monitor-index", /.+/);

  await betaCard.click();
  await expect(secondPane).toHaveAttribute("data-active-terminal-pane", "true");
  await expect(betaCard).toHaveAttribute("data-active-monitor-session", "true");
  await expect(betaCard).toHaveCSS(
    "border-top-color",
    "rgba(255, 152, 0, 0.95)",
  );
  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await gammaCard.click();
  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(gammaCard).toHaveAttribute("data-monitor-index", "2");
  await expect(gammaCard).toHaveAttribute(
    "data-active-monitor-session",
    "true",
  );
  await expect(betaCard).not.toHaveAttribute("data-monitor-index", /.+/);
});

test("focus sidebar double-click replaces the active monitor pane only once", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  const firstPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-1"]',
  );
  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "alpha-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );

  await page
    .locator(".focus-sidebar-card", { hasText: "Gamma Session" })
    .dblclick();

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
  await expect(
    page.locator(".focus-sidebar-card", { hasText: "Alpha Session" }),
  ).toBeVisible();

  await page.waitForTimeout(300);

  await expect(firstPane).toHaveAttribute(
    "data-terminal-pane-session",
    "gamma-session",
  );
  await expect(secondPane).toHaveAttribute(
    "data-terminal-pane-session",
    "beta-session",
  );
});

test("focus header follows the active monitor terminal session", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  await expect(page.locator(".focus-main-name")).toHaveText("Alpha Session");

  const secondPane = page.locator(
    '[data-terminal-pane-slot="terminal-monitor-slot-2"]',
  );
  await secondPane.getByRole("button", { name: "设为输入" }).click();

  await expect(page.locator(".focus-main-name")).toHaveText("Beta Session");

  let renameDefaultValue = "";
  page.once("dialog", async (dialog) => {
    renameDefaultValue = dialog.defaultValue();
    await dialog.dismiss();
  });
  await page.locator(".focus-rename-btn").click({ force: true });
  await expect.poll(() => renameDefaultValue).toBe("Beta Session");
});

test("focus sidebar drag uses a single preview for the dragged session", async ({
  page,
}) => {
  await mockSessions(page, [
    makeSession({
      id: "alpha-session",
      displayName: "Alpha Session",
      outputPreview: "alpha ready",
    }),
    makeSession({
      id: "beta-session",
      displayName: "Beta Session",
      outputPreview: "beta ready",
    }),
    makeSession({
      id: "gamma-session",
      displayName: "Gamma Session",
      outputPreview: "gamma line 1\ngamma line 2\ngamma line 3",
    }),
  ]);

  await page.goto("/");

  await page
    .locator(".grid-card", {
      has: page.locator(".grid-card-name", { hasText: "Alpha Session" }),
    })
    .dblclick();
  await page.getByRole("button", { name: /屏幕布局/ }).click();
  await page.getByRole("menuitemradio", { name: /左右双屏/ }).click();

  await page.evaluate(() => {
    const trackedWindow = window as Window & {
      __forceTerminalMonitorDragImageForTest?: boolean;
      __terminalMonitorDragImages?: Array<{
        height: number;
        previewKind: string | undefined;
        sessionId: string | undefined;
        tagName: string;
        width: number;
        x: number;
        y: number;
      }>;
      __terminalMonitorDragImagePatched?: boolean;
    };
    trackedWindow.__terminalMonitorDragImages = [];
    trackedWindow.__forceTerminalMonitorDragImageForTest = true;
    if (trackedWindow.__terminalMonitorDragImagePatched) {
      return;
    }

    const originalSetDragImage = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (
      image: Element,
      x: number,
      y: number,
    ) {
      const element = image as HTMLElement;
      const canvas = image as HTMLCanvasElement;
      trackedWindow.__terminalMonitorDragImages?.push({
        height: canvas.height,
        previewKind: element.dataset.previewKind,
        sessionId: element.dataset.sessionId,
        tagName: element.tagName,
        width: canvas.width,
        x,
        y,
      });
      return originalSetDragImage.call(this, image, x, y);
    };
    trackedWindow.__terminalMonitorDragImagePatched = true;
  });

  const draggedCard = page.locator(".focus-sidebar-card", {
    hasText: "Gamma Session",
  });
  await draggedCard.evaluate((element) => {
    const event = new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    });
    element.dispatchEvent(event);
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        return (
          (
            window as Window & {
              __terminalMonitorDragImages?: unknown[];
            }
          ).__terminalMonitorDragImages ?? []
        );
      }),
    )
    .toEqual([
      expect.objectContaining({
        previewKind: "terminal-monitor-session",
        sessionId: "gamma-session",
        tagName: "CANVAS",
        x: 132,
        y: 44,
      }),
    ]);
  await expect(
    page.locator('canvas[data-preview-kind="terminal-monitor-session"]'),
  ).toHaveAttribute("data-session-id", "gamma-session");

  await draggedCard.evaluate((element) => {
    element.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  });
  await expect(
    page.locator('canvas[data-preview-kind="terminal-monitor-session"]'),
  ).toHaveCount(0);
});
