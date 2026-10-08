import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const kind of ["codex", "cc", "acp"]) {
  test(`${kind}: empty running composer stops, retries failures and preserves drafts`, async ({
    page,
  }) => {
    await installSessionUxFixture(page, 0);
    const modules: Record<string, string> = {};
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/src/session-mode/")) modules[path] = r.url();
    });
    const calls: unknown[] = [];
    let fail = true;
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const path =
      kind === "codex"
        ? "../followups/stop"
        : kind === "cc"
          ? "cc/interrupt"
          : "acp/cancel";
    await page.route("**/api/session/api/settings", (route) =>
      route.fulfill({ json: {} }),
    );
    await page.route("**/api/session/api/codex/thread/list", (route) =>
      route.fulfill({ json: { data: [], nextCursor: null } }),
    );
    await page.route(
      kind === "codex"
        ? "**/api/session/followups/stop"
        : `**/api/session/api/${path}`,
      async (route) => {
        calls.push(route.request().postDataJSON());
        if (fail)
          await route.fulfill({
            status: 500,
            json: { error: "test stop failure" },
          });
        else {
          await held;
          await route.fulfill({
            json:
              kind === "codex"
                ? { revision: 1, paused: "stopped", items: [] }
                : {},
          });
        }
      },
    );
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await page.evaluate(
      async ({ kind, modules }) => {
        const { useCodexStore } = await import(
          modules["/src/session-mode/components/codex/stores/index.ts"] ??
            "/src/session-mode/components/codex/stores/index.ts"
        );
        const { useAgentSettingsStore } = await import(
          modules["/src/session-mode/stores/useAgentSettingsStore.ts"] ??
            "/src/session-mode/stores/useAgentSettingsStore.ts"
        );
        const { useAgentCenterStore } = await import(
          modules["/src/session-mode/stores/useAgentCenterStore.ts"] ??
            "/src/session-mode/stores/useAgentCenterStore.ts"
        );
        const { useCCStore } = await import(
          modules["/src/session-mode/stores/cc/index.ts"] ??
            "/src/session-mode/stores/cc/index.ts"
        );
        const { useAcpStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) =>
              entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
            )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
        );
        const { useLayoutStore } = await import(
          modules["/src/session-mode/stores/useLayoutStore.ts"] ??
            "/src/session-mode/stores/useLayoutStore.ts"
        );
        const { useInputStore } = await import(
          modules["/src/session-mode/stores/useInputStore.ts"] ??
            "/src/session-mode/stores/useInputStore.ts"
        );
        useInputStore.setState({ inputValue: "   \n" });
        useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
        useAgentCenterStore.setState({
          cards: [],
          currentAgentCardId: null,
          cardsViewMode: "solo",
        });
        useAgentSettingsStore.setState({
          selectedAgent: kind === "cc" ? "cc" : "codex",
        });
        // Missing thread status/currentTurnId reproduces the Codex notification race.
        useCodexStore.setState({
          currentThreadId: "stop-codex",
          currentTurnId: null,
          threads: [],
          events: { "stop-codex": [] },
          threadStatusMap: {},
          turnTimingMap: {
            "stop-codex": {
              turnId: "stop-turn",
              status: "inProgress",
              startedAtMs: Date.now(),
              durationMs: null,
            },
          },
        });
        useCCStore.setState({
          activeSessionId: "stop-cc",
          messages: [],
          sessionLoadingMap: { "stop-cc": true },
          isLoading: false,
        });
        useAcpStore.setState({
          active: kind === "acp",
          agentId: "test-agent",
          sessionId: "stop-acp",
          connectionId: "stop-connection",
          entries: [],
          running: true,
          connecting: false,
        });
      },
      { kind, modules },
    );
    const stop = page.getByRole("button", { name: "停止生成", exact: true });
    await expect(stop).toBeEnabled();
    const editor =
      kind === "codex"
        ? page.locator(".session-mode [contenteditable=true]").first()
        : page.locator(".session-mode textarea:visible").first();
    if (kind !== "codex") await editor.fill("   ");
    // An invalid image blocks Send but must not block Stop.
    if (kind === "cc") {
      await editor.evaluate((node) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-large.png", {
            type: "image/png",
          }),
        );
        node.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });
      await expect(
        page.getByText("图片不能超过 10 MB", { exact: true }),
      ).toBeVisible();
      await expect(stop).toBeEnabled();
    }
    await stop.click();
    await expect(page.getByText(/停止失败：/).first()).toBeVisible();
    await expect(stop).toBeEnabled();
    fail = false;
    if (kind === "codex") await editor.pressSequentially("保留草稿");
    else await editor.fill("保留草稿");
    await stop.click();
    await expect(
      page.getByRole("button", { name: "正在停止", exact: true }),
    ).toBeDisabled();
    expect(calls).toHaveLength(2);
    release();
    await page.evaluate(
      async ({ kind, modules }) => {
        if (kind === "codex") {
          const { useCodexStore } = await import(
            modules["/src/session-mode/components/codex/stores/index.ts"] ??
              "/src/session-mode/components/codex/stores/index.ts"
          );
          useCodexStore.setState({
            turnTimingMap: {
              "stop-codex": {
                turnId: "stop-turn",
                status: "interrupted",
                startedAtMs: 1,
                durationMs: 1,
              },
            },
          });
        } else if (kind === "acp") {
          const { useAcpStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) =>
                entry.name.includes("/src/session-mode/stores/useAcpStore.ts"),
              )?.name ?? "/src/session-mode/stores/useAcpStore.ts"
          );
          useAcpStore.setState({ running: false });
        }
      },
      { kind, modules },
    );
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeVisible();
    if (kind === "codex") await expect(editor).toContainText("保留草稿");
    else await expect(editor).toHaveValue("保留草稿");
    if (kind === "codex") {
      await editor.press("ControlOrMeta+A");
      await editor.press("Backspace");
    } else await editor.fill("  \n");
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeDisabled();
    expect(calls[0]).toEqual(
      kind === "codex"
        ? { threadId: "stop-codex", turnId: "stop-turn" }
        : kind === "cc"
          ? { session_id: "stop-cc" }
          : { connection_id: "stop-connection", session_id: "stop-acp" },
    );
  });
}
