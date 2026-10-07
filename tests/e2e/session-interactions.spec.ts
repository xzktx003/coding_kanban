import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, kind = "codex") {
  await page.route("**/api/session/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        instance: "interaction-fixture",
        capabilities: { acpImages: true },
      },
    }),
  );
  await page.route("**/api/session/api/events**", (route) =>
    route.fulfill({ contentType: "text/event-stream", body: ": fixture\n\n" }),
  );
  const empty = {
    items: [],
    activeAgentSessionId: null,
    updatedAt: new Date().toISOString(),
  };
  await page.routeWebSocket("**/ws/agent-sessions", (ws) =>
    ws.send(JSON.stringify({ type: "snapshot", payload: empty })),
  );
  await page.route("**/api/agent-sessions**", (route) =>
    route.fulfill({ json: empty }),
  );
  await page.route("**/api/session/api/settings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, body: "" })
      : route.continue(),
  );
  await page.route("**/api/session/api/cc/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/session/api/acp/**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/?mode=session");
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ timeout: 30000 });
  await page.evaluate(async (kind) => {
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    const { useAgentSettingsStore } =
      await import("/src/session-mode/stores/useAgentSettingsStore.ts");
    const { useAgentCenterStore } =
      await import("/src/session-mode/stores/useAgentCenterStore.ts");
    const { useCCStore } = await import("/src/session-mode/stores/cc/index.ts");
    const acpModule =
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) =>
          url.includes("/src/session-mode/stores/useAcpStore.ts?"),
        ) ?? "/src/session-mode/stores/useAcpStore.ts";
    const { useAcpStore } = await import(acpModule);
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
    useAgentSettingsStore.setState({
      selectedAgent: kind === "cc" ? "cc" : "codex",
    });
    const threads = ["a", "b"].map((id) => ({
      id,
      name: id === "a" ? "前台会话" : "后台会话",
      preview: "fixture",
      cwd: "/fixture",
      modelProvider: "openai",
      createdAt: 1,
      updatedAt: 1,
    }));
    useCodexStore.setState({
      currentThreadId: "a",
      threads,
      threadStatusMap: {},
      events: Object.fromEntries(
        ["a", "b"].map((id) => [
          id,
          [
            {
              method: "item/completed",
              params: {
                threadId: id,
                turnId: "turn",
                item: {
                  id: `reply-${id}`,
                  type: "agentMessage",
                  text: `这是会话 ${id} 的最新回复。`,
                },
              },
            },
          ],
        ]),
      ),
      activeThreadIds: ["a", "b"],
    });
    useCCStore.setState({
      activeSessionId: "cc-a",
      activeSessionIds: ["cc-a"],
      messages: [],
      sessionMessagesMap: { "cc-a": [] },
      sessionLoadingMap: { "cc-a": false },
      isLoading: false,
    });
    useAcpStore.setState({
      active: kind === "acp",
      agentId: "fixture",
      connectionId: "connection",
      sessionId: "acp-a",
      canInputImages: true,
      entries: [],
      running: false,
      connecting: false,
    });
  }, kind);
}

test("running spinner stays visible and animated without adding idle dots", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.route("**/api/session/api/codex/thread/list", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "a",
            name: "运行中会话",
            preview: "fixture",
            cwd: "/fixture",
            modelProvider: "openai",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await prepare(page);
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    useCodexStore.setState({
      threadStatusMap: { a: { type: "active", activeFlags: [] } },
    });
  });
  const spinner = page.locator(".session-mode .session-status-spin");
  await expect(spinner.first()).toBeVisible();
  expect(
    await spinner.first().evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("session-status-spin");
  await expect(
    page.locator('.session-mode .session-agent-header [aria-label="运行中"]'),
  ).toBeVisible();
  await expect(page.locator(".session-mode .session-status-dot")).toHaveCount(
    0,
  );
  const listSpinner = page
    .locator(
      '.session-mode [data-slot="sidebar-container"] .session-status[aria-label="运行中"]',
    )
    .first();
  await expect(listSpinner).toBeVisible();
  await listSpinner.locator('xpath=ancestor::div[@role="button"][1]').hover();
  expect(
    await listSpinner.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ),
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: ".dev-runtime/session-interactions/running-spinner.png",
  });
});

test("unread grid card stays highlighted until selected; normal titles have no dot", async ({
  page,
}) => {
  test.setTimeout(60000);
  await prepare(page);
  await page.evaluate(async () => {
    const { useAgentCenterStore } =
      await import("/src/session-mode/stores/useAgentCenterStore.ts");
    const attentionModule =
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) =>
          url.includes("/src/session-mode/stores/useSessionAttentionStore.ts?"),
        ) ?? "/src/session-mode/stores/useSessionAttentionStore.ts";
    const { useSessionAttentionStore } = await import(attentionModule);
    useAgentCenterStore.setState({
      cards: [
        { kind: "codex", id: "a", preview: "前台会话" },
        { kind: "codex", id: "b", preview: "后台会话" },
      ],
      currentAgentCardId: "a",
      cardsViewMode: "grid",
    });
    useSessionAttentionStore.getState().complete("codex", "b", "finished-b");
  });
  const card = page.locator('[data-session-card="b"]');
  await expect(card).toHaveAttribute("data-attention", "unread");
  await expect(card.getByRole("img", { name: "有新的回复未读" })).toBeVisible();
  await expect(
    page.locator('[data-session-card="a"] .session-unread-dot'),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(card).toHaveAttribute("data-attention", "unread");
  await page.screenshot({
    path: ".dev-runtime/session-interactions/unread-grid.png",
  });
  await card.getByText("这是会话 b 的最新回复。", { exact: true }).click();
  await expect(card).toHaveAttribute("data-attention", "completed");
  await expect(card.getByRole("img", { name: "有新的回复未读" })).toHaveCount(
    0,
  );
});

test("collapsed sidebar peeks over the workspace and preserves menu interaction", async ({
  page,
}) => {
  test.setTimeout(60000);
  await prepare(page);
  await page.evaluate(async () => {
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    useLayoutStore.getState().setSidebarOpen(false);
  });
  const sidebar = page.locator(
    '.session-mode [data-slot="sidebar"][data-side="left"]',
  );
  const workspace = page.locator(".session-agent-header");
  await expect.poll(async () => (await workspace.boundingBox())!.x).toBe(0);
  const before = await workspace.boundingBox();
  await page.getByRole("button", { name: "悬浮展开侧栏" }).hover();
  await expect(sidebar).toHaveAttribute("data-peek", "true");
  await expect(
    sidebar.locator('[data-slot="sidebar-container"]'),
  ).toBeInViewport();
  expect((await workspace.boundingBox())!.x).toBe(before!.x);
  await page.screenshot({
    path: ".dev-runtime/session-interactions/sidebar-peek.png",
  });
  await page.getByTitle(/Filter threads/).click();
  await page.mouse.move(900, 500);
  await page.waitForTimeout(350);
  await expect(sidebar).toHaveAttribute("data-peek", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("data-peek", "false");
  await page.getByRole("button", { name: "悬浮展开侧栏" }).hover();
  await page.getByRole("button", { name: "固定展开" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
});

for (const kind of ["codex", "cc", "acp"])
  test(`${kind}: paste image, preview and send its attachment without losing text`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await prepare(page, kind);
    let sent: Record<string, unknown> | undefined;
    let uploadName = "";
    let releaseUpload: (() => void) | undefined;
    await page.route("**/api/session/files/upload", async (route) => {
      uploadName = route.request().postDataJSON().name;
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      await route.fulfill({ json: { path: "/fixture/uploads/paste.png" } });
    });
    const endpoint =
      kind === "codex"
        ? "codex/turn/start"
        : kind === "cc"
          ? "cc/send-message"
          : "acp/prompt";
    await page.route(`**/api/session/api/${endpoint}`, (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json:
          kind === "codex"
            ? { turn: { id: "sent-turn", status: "inProgress", items: [] } }
            : { stopReason: "end_turn" },
      });
    });
    const editor = page
      .locator(
        kind === "codex"
          ? ".session-mode [contenteditable=true]"
          : ".session-mode textarea",
      )
      .first();
    await editor.fill("请分析这张图片");
    await editor.evaluate((el) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const strip = page.getByLabel("图片附件");
    await expect(strip.locator('[data-state="uploading"]')).toHaveCount(1);
    // Enter while uploading must not send a partial message.
    await expect.poll(() => uploadName).toBe("pasted.png");
    await editor.press("Enter");
    expect(sent).toBeUndefined();
    releaseUpload!();
    await expect(strip.locator('[data-state="ready"]')).toHaveCount(1);
    expect(uploadName).toBe("pasted.png");
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `.dev-runtime/session-interactions/${kind}-image-${width}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await editor.press("Enter");
    await expect.poll(() => sent).toBeTruthy();
    if (kind === "codex")
      expect(sent!.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "localImage",
            path: "/fixture/uploads/paste.png",
          }),
        ]),
      );
    else expect(sent!.image_paths).toEqual(["/fixture/uploads/paste.png"]);
    await expect(strip).toHaveCount(0);
  });
