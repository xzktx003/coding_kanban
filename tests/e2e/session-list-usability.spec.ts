import { expect, test } from "@playwright/test";

test("structured sidebar keyboard, error retry and dangerous-action confirmation fit desktop and phone", async ({
  page,
}) => {
  test.setTimeout(60000);
  let failList = true;
  let deleted = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `ui-list-${i}`,
    name: `中文会话 ${i} · 长名称 ${"界面验证".repeat(8)}`,
    preview: `Original ${i}`,
    cwd: "/fixture/长路径/structured-list",
    createdAt: 1,
    updatedAt: 1,
    modelProvider: "openai",
  }));
  // No test action reaches a real Agent or persistent configuration.
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/events")) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
      return;
    }
    if (path.endsWith("/api/codex/thread/list")) {
      await route.fulfill(
        failList
          ? { status: 500, json: { error: "列表暂时离线" } }
          : { json: { data: rows, nextCursor: null } },
      );
      return;
    }
    if (path.endsWith("/api/codex/thread/fork")) {
      await route.fulfill({
        json: {
          thread: {
            ...rows[0],
            id: "ui-new-fork",
            name: "新分支会话",
            turns: [],
            status: { type: "idle" },
          },
        },
      });
      return;
    }
    if (path.endsWith("/api/codex/thread/delete")) {
      deleted++;
      await route.fulfill({ json: {} });
      return;
    }
    let json: unknown = {};
    if (path.endsWith("/plugin/installed")) json = { marketplaces: [] };
    else if (path.endsWith("/read-directory")) json = [];
    else if (path.endsWith("/git/status")) json = { entries: [] };
    else if (path.endsWith("/diff-stats"))
      json = {
        staged: { additions: 0, deletions: 0 },
        unstaged: { additions: 0, deletions: 0 },
      };
    else if (path.endsWith("/account/get"))
      json = {
        account: {
          type: "chatgpt",
          email: "fixture@example.invalid",
          chatgptPlanType: "plus",
        },
        requiresOpenaiAuth: false,
      };
    else if (path.endsWith("/bots/list")) json = [];
    else if (path === "/api/agent-sessions") json = { items: [], revision: 1 };
    else if (path === "/api/ssh-hosts") json = { hosts: [] };
    else if (path === "/api/workbench/projects") json = { projects: [] };
    else if (path === "/api/app-update/check")
      json = { enabled: false, status: "disabled" };
    else if (/account.*\/list$/.test(path)) json = [];
    else if (path.endsWith("/config/read")) json = { config: {} };
    else if (/\/plugins?\/list$/.test(path)) json = { marketplaces: [] };
    else if (/(skills|plugins|models)\/list$/.test(path)) json = { data: [] };
    else if (/\/acp\/(agents|sessions)$/.test(path)) json = [];
    else if (/\/(projects|sessions|automations|bots|models)$/.test(path))
      json = [];
    else if (/status|health/.test(path))
      json = { status: "ok", connected: false };
    await route.fulfill({ status: 200, json });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await page.evaluate(async () => {
    const { useWorkspaceStore } =
      await import("/src/session-mode/stores/useWorkspaceStore.ts");
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    const { useAgentSettingsStore } =
      await import("/src/session-mode/stores/useAgentSettingsStore.ts");
    const { useAgentCenterStore } =
      await import("/src/session-mode/stores/useAgentCenterStore.ts");
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    const { codexService } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) =>
          entry.name.includes("/src/session-mode/services/codexService.ts"),
        )?.name ?? "/src/session-mode/services/codexService.ts"
    );
    (window as any).__fixtureSelections = [];
    codexService.setCurrentThread = async (id: string | null) => {
      (window as any).__fixtureSelections.push(id);
      useCodexStore.setState({ currentThreadId: id });
    };
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useAgentCenterStore.setState({ cards: [], cardsViewMode: "solo" });
    useLayoutStore.setState({
      view: "agent",
      isSidebarOpen: true,
      isRightPanelOpen: false,
    });
    useCodexStore.setState({
      currentThreadId: null,
      threads: [],
      events: {
        "ui-list-0": [
          {
            method: "item/completed",
            params: {
              threadId: "ui-list-0",
              turnId: "fixture-history",
              item: {
                id: "original-history",
                type: "agentMessage",
                text: "原会话记录应保持",
              },
            },
          },
        ],
      },
    });
    useWorkspaceStore.setState({
      projects: ["/fixture/长路径/structured-list"],
      cwd: "/fixture/长路径/structured-list",
    });
  });
  await expect(page.locator(".session-mode [role=alert]")).toContainText(
    "列表暂时离线",
  );
  failList = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  const row = page
    .locator(".session-mode [role=button]")
    .filter({ hasText: "中文会话 0 ·" })
    .first();
  await page.mouse.move(1200, 20);
  await row.focus();
  const otherRow = page
    .locator(".session-mode [role=button]")
    .filter({ hasText: "中文会话 1 ·" })
    .first();
  await expect(
    otherRow.getByRole("button", { name: "Archive thread", exact: true }),
  ).toHaveCSS("opacity", "0");
  await row.press("Enter");
  await expect
    .poll(() => page.evaluate(() => (window as any).__fixtureSelections.at(-1)))
    .toBe("ui-list-0");
  await row.focus();
  await row.press("Space");
  // Renaming can be keyboard activated without triggering a row selection.
  const count = await page.evaluate(
    () => (window as any).__fixtureSelections.length,
  );
  await row.getByRole("button", { name: "重命名会话" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Control+n");
  expect(
    await page.evaluate(() => (window as any).__fixtureSelections.length),
  ).toBe(count);
  await page.keyboard.press("Escape");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(deleted).toBe(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(deleted).toBe(0);
  const historyBefore = await page.evaluate(async () =>
    JSON.stringify(
      (
        await import("/src/session-mode/components/codex/stores/index.ts")
      ).useCodexStore.getState().events["ui-list-0"],
    ),
  );
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fork", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useAgentCenterStore } =
          await import("/src/session-mode/stores/useAgentCenterStore.ts");
        return useAgentCenterStore.getState().currentAgentCardId;
      }),
    )
    .toBe("ui-new-fork");
  expect(
    await page.evaluate(async () => {
      const { useCodexStore } =
        await import("/src/session-mode/components/codex/stores/index.ts");
      return useCodexStore.getState().currentThreadId;
    }),
  ).toBe("ui-new-fork");
  expect(
    await page.evaluate(async () =>
      JSON.stringify(
        (
          await import("/src/session-mode/components/codex/stores/index.ts")
        ).useCodexStore.getState().events["ui-list-0"],
      ),
    ),
  ).toBe(historyBefore);
  await page.screenshot({
    path: ".dev-runtime/session-ui-upgrade/structured-list-desktop.png",
  });
  await page.setViewportSize({ width: 900, height: 720 });
  await expect(page.locator(".session-agent-header")).toContainText(
    "新分支会话",
  );
  await page.screenshot({
    path: ".dev-runtime/session-ui-upgrade/structured-list-narrow.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".session-agent-header")
    .getByRole("button", { name: /sidebar/i })
    .click();
  const mobileRow = page
    .locator(".session-mode [role=button]")
    .filter({ hasText: "中文会话 0 ·" })
    .first();
  await expect(mobileRow).toBeVisible();
  await expect(
    mobileRow.getByRole("button", { name: "重命名会话" }),
  ).toBeVisible();
  await mobileRow.getByRole("button", { name: "重命名会话" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".dev-runtime/session-ui-upgrade/structured-rename-phone.png",
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog").filter({ has: page.getByLabel("会话名称") }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".dev-runtime/session-ui-upgrade/structured-list-phone.png",
  });
  expect(errors).toEqual([]);
});
