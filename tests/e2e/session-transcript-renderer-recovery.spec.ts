import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("a failed full-transcript module load refreshes the module while preserving the conversation and draft", async ({ page }) => {
  const fixture = await installSessionUxFixture(page, 1);
  fixture.threads[0].turns = [
    {
      id: "cached-turn",
      status: "completed",
      startedAt: 1,
      durationMs: 1,
      error: null,
      items: [
        {
          id: "cached-answer",
          type: "agentMessage",
          text: "近期缓存正文仍可见",
          phase: "final_answer",
        },
      ],
    },
  ];
  let transcriptRequests = 0;
  await page.route(
    /\/src\/session-mode\/components\/codex\/thread\/CodexTranscript\.tsx/,
    async (route) => {
      transcriptRequests++;
      if (transcriptRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/javascript",
          body: "transcript module temporarily unavailable",
        });
        return;
      }
      await route.continue();
    },
  );

  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const moduleUrl = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const { useCodexStore } = await import(
      moduleUrl("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const threadId = "ux-0";
    useCodexStore.setState({
      events: {
        [threadId]: [
          {
            method: "item/completed",
            params: {
              threadId,
              turnId: "cached-turn",
              item: {
                type: "agentMessage",
                id: "cached-answer",
                text: "近期缓存正文仍可见",
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          },
        ],
      },
      historyLoadedMap: { [threadId]: true },
    });
    useAgentCenterStore
      .getState()
      .addAgentCard(
        {
          kind: "codex",
          id: threadId,
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "transcript recovery",
        },
        { activate: true },
      );
  });

  const preparing = page.locator('[data-transcript-preparing="ux-0"]');
  await expect(preparing).toContainText("完整消息视图暂时无法加载");
  await expect(preparing).toContainText("近期缓存正文仍可见");
  await expect(preparing.getByText("查看错误详情")).toBeVisible();
  await expect(preparing.getByRole("button", { name: "刷新页面" })).toHaveCount(0);
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  await editor.fill("重试期间保留的草稿");

  await preparing
    .getByRole("button", { name: "刷新并重试完整消息" })
    .click();
  await expect
    .poll(() => transcriptRequests)
    .toBeGreaterThanOrEqual(2);
  await expect(
    page.locator('[data-codex-transcript-shell="ux-0"] .thread-surface'),
  ).toContainText("近期缓存正文仍可见");
  await expect(page.locator('[data-transcript-preparing="ux-0"]')).toHaveCount(0);
  await expect(editor).toHaveText("重试期间保留的草稿");
  expect(
    fixture.calls.filter((call) =>
      /\/(?:thread\/start|turn\/start|turn\/interrupt)$/.test(call.path),
    ),
  ).toEqual([]);
});
