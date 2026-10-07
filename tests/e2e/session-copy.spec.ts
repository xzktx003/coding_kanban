import { expect, test } from "@playwright/test";

for (const kind of ["codex", "cc", "acp"] as const) {
  test(`${kind}: a retained terminal focus view leaves session copy to the browser`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    const snapshot = {
      items: [
        {
          id: "copy-terminal",
          workspaceId: "default",
          sourceType: "local",
          agentKind: "shell",
          displayName: "Copy fixture",
          connectionState: "offline",
          interactionState: "idle",
          controlMode: "control",
        },
      ],
      activeAgentSessionId: null,
      updatedAt: new Date().toISOString(),
    };
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      localStorage.setItem(
        "focus-view-state",
        JSON.stringify({ viewMode: "focus", focusedId: "copy-terminal" }),
      );
    });
    // Keep terminal streams, settings and synthetic conversations in this browser.
    await page.routeWebSocket("**/ws/agent-sessions", (ws) =>
      ws.send(JSON.stringify({ type: "snapshot", payload: snapshot })),
    );
    await page.route("**/api/agent-sessions**", (route) =>
      route.fulfill({
        json: route.request().url().endsWith("/api/agent-sessions")
          ? snapshot
          : {},
      }),
    );
    await page.route("**/api/session/api/settings", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 200, body: "" })
        : route.continue(),
    );
    await page.route("**/api/session/api/acp/**", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            json: route.request().url().endsWith("/sessions") ? [] : {},
          })
        : route.continue(),
    );
    await page.route("**/api/session/health", (route) =>
      route.fulfill({ json: { status: "ok", instance: "copy-fixture" } }),
    );
    await page.route("**/api/session/api/events**", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      }),
    );
    await page.goto("/?mode=terminal");
    await expect(page.locator(".workbench-terminal .focus-view")).toBeVisible();
    await page.getByRole("button", { name: "会话", exact: true }).click();
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor({ timeout: 30000 });
    await page.evaluate(async (kind) => {
      const { useAgentCenterStore } =
        await import("/src/session-mode/stores/useAgentCenterStore.ts");
      const { useAgentSettingsStore } =
        await import("/src/session-mode/stores/useAgentSettingsStore.ts");
      const { useCodexStore } =
        await import("/src/session-mode/components/codex/stores/index.ts");
      const { useCCStore } =
        await import("/src/session-mode/stores/cc/index.ts");
      const acpModule =
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((url) =>
            url.includes("/src/session-mode/stores/useAcpStore.ts?"),
          ) ?? "/src/session-mode/stores/useAcpStore.ts";
      const { useAcpStore } = await import(acpModule);
      const text = "Selected dialogue copy regression";
      useAgentCenterStore.setState({
        cards: [],
        currentAgentCardId: null,
        cardsViewMode: "solo",
      });
      useAgentSettingsStore.setState({
        selectedAgent: kind === "cc" ? "cc" : "codex",
      });
      useCodexStore.setState({
        currentThreadId: "copy-codex",
        events: {
          "copy-codex": [
            {
              method: "item/completed",
              params: {
                threadId: "copy-codex",
                turnId: "copy-turn",
                item: { id: "copy-message", type: "agentMessage", text },
              },
            },
          ],
        },
      });
      const messages = [
        {
          type: "assistant",
          message: {
            id: "copy-message",
            role: "assistant",
            content: [{ type: "text", text }],
          },
        },
      ];
      useCCStore.setState({
        activeSessionId: "copy-cc",
        messages,
        sessionMessagesMap: { "copy-cc": messages },
        isLoading: false,
      });
      useAcpStore.setState({
        active: kind === "acp",
        connectionId: "copy-acp",
        sessionId: "copy-acp-session",
        entries: [{ id: "copy-message", role: "agent", text }],
        running: false,
        connecting: false,
      });
    }, kind);
    const editor = page
      .locator(
        kind === "codex"
          ? ".session-mode [contenteditable=true]"
          : ".session-mode textarea",
      )
      .first();
    await editor.fill("Draft must stay intact");
    const message = page.getByText("Selected dialogue copy regression", {
      exact: true,
    });
    await expect(message).toBeVisible();
    const bounds = (await message.boundingBox())!;
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - 2,
      bounds.y + bounds.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    const selected = await page.evaluate(() =>
      window.getSelection()!.toString(),
    );
    expect(selected).toContain("Selected dialogue");
    // Linux Chromium cannot execute macOS native shortcuts; assert Meta+C is
    // uncancelled, then verify the real browser clipboard with native Ctrl+C.
    const metaCopyAllowed = await page.evaluate(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "c",
          code: "KeyC",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(metaCopyAllowed).toBe(true);
    await page.evaluate(() =>
      navigator.clipboard.writeText("clipboard sentinel"),
    );
    await page.keyboard.press("Control+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      selected,
    );
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
      selected,
    );
    if (kind === "codex")
      await expect(editor).toHaveText("Draft must stay intact");
    else await expect(editor).toHaveValue("Draft must stay intact");
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await expect(page.locator(".workbench-terminal .focus-view")).toBeVisible();
    // Exercise the retained view's input forwarding without touching a real PTY.
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      const pane = document.createElement("div");
      pane.dataset.activeTerminalPane = "true";
      const input = document.createElement("textarea");
      input.className = "xterm-helper-textarea";
      pane.appendChild(input);
      document.querySelector(".focus-view")!.appendChild(pane);
      input.addEventListener("keydown", (event) => {
        input.value += event.key;
      });
      (document.activeElement as HTMLElement).blur();
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "x",
          code: "KeyX",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(
      page.locator(".workbench-terminal .xterm-helper-textarea"),
    ).toHaveValue("x");
    // A queued terminal key must be discarded if the mode changes before its
    // deferred retry, even when a terminal textarea becomes available later.
    await page.evaluate(() => {
      document
        .querySelector(".workbench-terminal .xterm-helper-textarea")!
        .remove();
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "y",
          code: "KeyY",
          bubbles: true,
          cancelable: true,
        }),
      );
      (
        document.querySelector(
          ".workbench-modes button:nth-child(2)",
        ) as HTMLButtonElement
      ).click();
      const input = document.createElement("textarea");
      input.className = "xterm-helper-textarea";
      input.addEventListener("keydown", (event) => {
        input.value += event.key;
      });
      document
        .querySelector(
          '.workbench-terminal [data-active-terminal-pane="true"]',
        )!
        .appendChild(input);
    });
    // Allow the scheduled queue flush to run while the terminal is hidden.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );
    await expect(
      page.locator(".workbench-terminal .xterm-helper-textarea"),
    ).toHaveValue("");
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await page.keyboard.press("Alt+q");
    await expect(page.locator(".workbench-terminal .focus-view")).toHaveCount(
      0,
    );
  });
}
