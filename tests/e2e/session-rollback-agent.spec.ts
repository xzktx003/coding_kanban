import { expect, test } from "@playwright/test";

const turns = Array.from({ length: 3 }, (_, i) => ({
  id: `fixture-turn-${i}`,
  status: "completed",
  startedAt: 1,
  completedAt: 2,
  durationMs: 1000,
  error: null,
  items: [
    {
      type: "userMessage",
      id: `user-${i}`,
      content: [
        {
          type: "text",
          text: `rollback fixture message ${i}`,
          text_elements: [],
        },
      ],
    },
    {
      type: "agentMessage",
      id: `answer-${i}`,
      text: `rollback fixture answer ${i}`,
    },
  ],
}));
const thread = {
  id: "rollback-fixture",
  cwd: "/fixture",
  name: "Rollback fixture",
  preview: "Rollback fixture",
  createdAt: 1,
  updatedAt: 1,
  modelProvider: "openai",
  status: { type: "idle" },
  turns,
};

test("rollback confirms its boundary, removes later turns, restores the draft and keeps agent badges visible", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await page.route("**/api/session/api/settings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, body: "" })
      : route.continue(),
  );
  await page.route("**/api/session/api/codex/thread/list", (route) =>
    route.fulfill({ json: { data: [thread], nextCursor: null } }),
  );
  await page.route("**/api/session/api/codex/thread/rollback", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({
      json: { thread: { ...thread, turns: turns.slice(0, 1) } },
    });
  });
  await page.goto("/?mode=session");
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ timeout: 30000 });
  await page.evaluate(async (thread) => {
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    const { convertThreadHistoryToEvents } =
      await import("/src/session-mode/utils/threadHistoryConverter.ts");
    const { useWorkspaceStore } =
      await import("/src/session-mode/stores/useWorkspaceStore.ts");
    const { usePinStore } =
      await import("/src/session-mode/stores/usePinStore.ts");
    const { useLayoutStore } =
      await import("/src/session-mode/stores/useLayoutStore.ts");
    const { useAgentSettingsStore } =
      await import("/src/session-mode/stores/useAgentSettingsStore.ts");
    const { useAgentCenterStore } =
      await import("/src/session-mode/stores/useAgentCenterStore.ts");
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useAgentCenterStore.setState({
      cards: [],
      cardsViewMode: "solo",
      currentAgentCardId: null,
    });
    useWorkspaceStore.setState({ cwd: "/fixture", projects: ["/fixture"] });
    useLayoutStore.setState({
      view: "agent",
      isPinnedListOpen: true,
      isRightPanelOpen: false,
    });
    usePinStore.setState({
      pinned: [
        {
          kind: "codex",
          id: "pin-codex",
          title: "Pinned Codex fixture",
          cwd: "/fixture",
        },
        {
          kind: "cc",
          id: "pin-claude",
          title: "Pinned Claude fixture",
          cwd: "/fixture",
        },
      ],
    });
    useCodexStore.setState({
      currentThreadId: thread.id,
      currentTurnId: null,
      activeThreadIds: [thread.id],
      threads: [thread],
      events: { [thread.id]: convertThreadHistoryToEvents(thread) },
      threadStatusMap: { [thread.id]: { type: "idle" } },
      turnTimingMap: {},
    });
  }, thread);
  const message = page.getByText("rollback fixture message 1", { exact: true });
  await message.scrollIntoViewIfNeeded();
  await message.hover();
  await page
    .locator(".session-mode")
    .getByRole("button", { name: /^(编辑消息|Edit message)$/ })
    .first()
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    /代码文件不会恢复|Code files are not reverted/,
  );
  expect(calls).toHaveLength(0);
  await dialog.getByRole("button", { name: /^(继续|Continue)$/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls).toEqual([
    { threadId: thread.id, numTurns: 2, beforeTurnId: "fixture-turn-1" },
  ]);
  await expect(
    page.getByText("rollback fixture answer 0", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("rollback fixture answer 1", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toContainText("rollback fixture message 1");
  const sidebar = page.locator("[data-sidebar=sidebar]");
  await expect(sidebar.getByLabel("Agent: Codex")).toHaveCount(2);
  await expect(sidebar.getByLabel("Agent: Claude Code")).toHaveCount(1);
});
