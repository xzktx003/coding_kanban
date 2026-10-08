import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const width of [375, 1440]) {
  test(`rollback failure remains readable and retry restores the exact message (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 1);
    const calls: any[] = [];
    const turns = Array.from({ length: 3 }, (_, i) => ({
      id: `turn-${i}`,
      status: "completed",
      error: null,
      items: [
        {
          type: "userMessage",
          id: `user-${i}`,
          content: [
            { type: "text", text: `回退测试消息 ${i}`, text_elements: [] },
          ],
        },
        { type: "agentMessage", id: `answer-${i}`, text: `回退测试回复 ${i}` },
      ],
    }));
    const thread = {
      id: "ux-0",
      cwd: "/fixture",
      status: { type: "idle" },
      turns,
    };
    Object.assign(fixture.threads[0], thread);
    await page.route("**/api/session/api/codex/thread/rollback", (route) => {
      calls.push(route.request().postDataJSON());
      if (calls.length > 1) Object.assign(fixture.threads[0], { turns: turns.slice(0, 1) });
      return calls.length === 1
        ? route.fulfill({
            status: 500,
            json: {
              error:
                "Request failed: " +
                JSON.stringify({
                  code: -32600,
                  message:
                    "Invalid request: unknown variant `thread/rollback`, expected one of `thread/revert`, " +
                    "otherMethod ".repeat(400),
                }),
            },
          })
        : route.fulfill({
            json: { thread: { ...thread, turns: turns.slice(0, 1) } },
          });
    });
    await page.goto("/?mode=session");
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    await seedSessionUx(page);
    await page.evaluate(async (thread) => {
      const moduleUrl = (path: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(
        moduleUrl("/src/session-mode/components/codex/stores/index.ts")
      );
      const { convertThreadHistoryToEvents } = await import(
        moduleUrl("/src/session-mode/utils/threadHistoryConverter.ts")
      );
      const { useSessionDraftStore, sessionDraftKey } = await import(
        moduleUrl("/src/session-mode/stores/useSessionDraftStore.ts")
      );
      const { useAgentCenterStore } = await import(
        moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
      );
      const { useSessionSplitStore } = await import(
        moduleUrl("/src/session-mode/stores/useSessionSplitStore.ts")
      );
      useCodexStore.setState({
        currentThreadId: thread.id,
        threads: [thread],
        events: { [thread.id]: convertThreadHistoryToEvents(thread) },
        // This fixture injects a complete history, including its hydration receipt.
        historyLoadedMap: { [thread.id]: true },
        historyLoadingMap: { [thread.id]: false },
        threadStatusMap: { [thread.id]: { type: "idle" } },
      });
      useAgentCenterStore
        .getState()
        .addAgentCard({
          kind: "codex",
          id: thread.id,
          title: "回退测试",
          cwd: thread.cwd,
        });
      useSessionSplitStore
        .getState()
        .place(
          `codex:${thread.id}`,
          useSessionSplitStore.getState().activeGroupId,
          "center",
        );
      useSessionDraftStore
        .getState()
        .setText(sessionDraftKey("codex", thread.id), "保留的草稿");
    }, thread);
    const message = page.getByText("回退测试消息 1", { exact: true });
    await message.scrollIntoViewIfNeeded();
    await message.hover();
    await page
      .locator(".group")
      .filter({ has: message })
      .last()
      .getByRole("button", { name: /^(编辑消息|Edit message)$/ })
      .click();
    const dialog = page.getByRole("alertdialog");
    expect(calls).toHaveLength(0);
    await dialog.getByRole("button", { name: /^(继续|Continue)$/ }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      /重启会话服务|restart/,
    );
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(dialog.locator("details")).not.toHaveAttribute("open");
    expect(
      await dialog.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(765);
    const composer = page
      .locator(".session-mode [contenteditable=true]")
      .first();
    await expect(composer).toContainText("保留的草稿");
    await dialog.locator("summary").click();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: `.dev-runtime/rollback-error-${width}.png` });
    await dialog.locator("summary").click();
    await dialog.getByRole("button", { name: /^(继续|Continue)$/ }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual(
      Array(2).fill({ threadId: "ux-0", numTurns: 2, beforeTurnId: "turn-1" }),
    );
    await expect(composer).toContainText("回退测试消息 1");
    await expect(page.getByText("回退测试回复 1", { exact: true })).toHaveCount(
      0,
    );
  });
}
