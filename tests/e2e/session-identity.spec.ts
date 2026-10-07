import { expect, test } from "@playwright/test";

test("embedded terminal has one visible brand and Issues points to this project", async ({
  page,
}) => {
  await page.goto("/?mode=terminal", { waitUntil: "domcontentloaded" });
  await page.locator("[data-testid=new-session-toggle]").waitFor();
  await expect(page.locator('img[src="/houmo-logo.png"]:visible')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Issues", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/BrotherHappy/coding-kanban/issues",
  );
});

test("Codex, Claude and ACP rename without changing session identity, persist and retry errors", async ({
  page,
}) => {
  test.setTimeout(60000);
  let saved: Record<string, unknown> = {};
  let codexName = "Original Codex";
  let fail = false;
  const requests: unknown[] = [];
  await page.route("**/api/session/api/settings", async (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON();
      await route.fulfill({ status: 200, body: "" });
    } else await route.fulfill({ json: saved });
  });
  await page.route("**/api/session/api/codex/thread/list", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "rename-codex",
            name: codexName,
            preview: "Original Codex",
            createdAt: 1,
            updatedAt: 1,
            cwd: "/fixture",
            modelProvider: "openai",
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route("**/api/session/api/codex/thread/rename", async (route) => {
    requests.push(route.request().postDataJSON());
    if (fail) {
      await route.fulfill({ status: 500, json: { error: "rename failed" } });
      return;
    }
    codexName = route.request().postDataJSON().name;
    await route.fulfill({ json: {} });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  const prepare = async (kind: string) =>
    page.evaluate(
      async ({ kind, codexName }) => {
        const { useCodexStore } =
          await import("/src/session-mode/components/codex/stores/index.ts");
        const { useAgentSettingsStore } =
          await import("/src/session-mode/stores/useAgentSettingsStore.ts");
        const { useAgentCenterStore } =
          await import("/src/session-mode/stores/useAgentCenterStore.ts");
        const { useCCStore } =
          await import("/src/session-mode/stores/cc/index.ts");
        const { useAcpStore } =
          await import("/src/session-mode/stores/useAcpStore.ts");
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
        useCodexStore.setState({
          currentThreadId: "rename-codex",
          threads: [
            { id: "rename-codex", name: codexName, preview: "Original Codex" },
          ],
          events: { "rename-codex": [] },
        });
        useCCStore.setState({
          activeSessionId: "rename-cc",
          messages: [],
          isLoading: false,
        });
        useAcpStore.setState({
          active: kind === "acp",
          agentId: "test-agent",
          sessionId: "rename-acp",
          connectionId: "test-connection",
          entries: [],
          running: false,
          connecting: false,
        });
      },
      { kind, codexName },
    );
  for (const kind of ["codex", "cc", "acp"]) {
    await prepare(kind);
    const action = page
      .locator(".session-agent-header")
      .getByRole("button", { name: "重命名会话", exact: true });
    await action.focus();
    await action.press("Enter");
    const dialog = page.getByRole("dialog");
    const input = dialog.getByLabel("会话名称");
    await input.fill("   ");
    await expect(
      dialog.getByRole("button", { name: "保存", exact: true }),
    ).toBeDisabled();
    await input.fill(`${kind} 新名称`);
    await input.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".session-agent-header")).toContainText(
      `${kind} 新名称`,
    );
  }
  expect(requests).toEqual([
    { threadId: "rename-codex", name: "codex 新名称" },
  ]);
  expect(saved.sessionNames).toEqual({
    "cc:rename-cc": "cc 新名称",
    "acp:test-agent:rename-acp": "acp 新名称",
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await prepare("cc");
  await expect(page.locator(".session-agent-header")).toContainText(
    "cc 新名称",
  );
  await prepare("acp");
  await expect(page.locator(".session-agent-header")).toContainText(
    "acp 新名称",
  );
  await prepare("codex");
  const composer = page.locator(".session-mode [contenteditable=true]").first();
  await composer.click();
  await composer.press("ControlOrMeta+a");
  await composer.press("Backspace");
  await composer.pressSequentially("/");
  await expect(page.locator("[data-composer-suggestions]")).toBeVisible();
  fail = true;
  await page
    .locator(".session-agent-header")
    .getByRole("button", { name: "重命名会话", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(page.locator("[data-composer-suggestions]")).toBeHidden();
  await dialog.getByLabel("会话名称").fill("重试名称");
  await dialog.getByLabel("会话名称").press("Enter");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("会话名称")).toHaveValue("重试名称");
  await expect(page.locator(".session-agent-header")).toContainText(
    "codex 新名称",
  );
  fail = false;
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".session-agent-header")).toContainText("重试名称");
  await page.setViewportSize({ width: 375, height: 667 });
  await page
    .locator(".session-agent-header")
    .getByRole("button", { name: "重命名会话", exact: true })
    .click();
  const bounds = await page.getByRole("dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(12);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(363);
  await page.screenshot({ path: ".dev-runtime/session-ui/mobile-rename.png" });
  await page.getByRole("button", { name: "取消", exact: true }).click();
});
