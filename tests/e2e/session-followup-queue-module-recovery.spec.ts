import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const queueState = {
  revision: 1,
  paused: null,
  items: [
    {
      id: "queued-ux-0",
      threadId: "ux-0",
      text: "保留的待发队列内容",
      images: [],
      parameters: {},
      mode: "queue",
      status: "queued",
      createdAt: 1,
      fingerprint: "queued-ux-fingerprint",
    },
  ],
};

test("a failed queue panel load offers an explicit retry without losing the draft or queue", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await installSessionUxFixture(page, 1);
  let moduleRequests = 0;
  await page.route("**/api/session/followups?*", (route) =>
    route.fulfill({ json: queueState }),
  );
  await page.route(
    /\/src\/session-mode\/components\/codex\/composer\/FollowupQueue\.tsx/,
    async (route) => {
      moduleRequests++;
      if (moduleRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/javascript",
          body: "queue module temporarily unavailable",
        });
        return;
      }
      await route.continue();
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const live = (path: string) =>
      import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
    const { useAgentCenterStore } = await live(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    useAgentCenterStore.getState().addAgentCard(
      {
        kind: "codex",
        id: "ux-0",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "queue recovery fixture",
      },
      { activate: true },
    );
  });

  const editor = page
    .locator('.session-codex-composer [contenteditable="true"]')
    .first();
  await expect(editor).toBeVisible();
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "完整队列面板暂时无法加载" });
  await expect(failure).toBeVisible();
  await expect(page.getByText("保留的待发队列内容")).toBeVisible();
  await editor.fill("队列面板故障期间保留的草稿");

  const retry = page.getByRole("button", { name: "刷新页面并重试队列" });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await retry.click();
  await expect.poll(() => moduleRequests).toBeGreaterThanOrEqual(2);
  await expect(editor).toHaveText("队列面板故障期间保留的草稿");
  await expect(page.getByText("保留的待发队列内容")).toBeVisible();
  expect(
    fixture.calls.filter((call) =>
      /followups\/(submit|stop)|turn\/(start|interrupt)/.test(call.path),
    ),
  ).toEqual([]);
});
