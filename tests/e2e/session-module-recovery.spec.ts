import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [393, 1440]) {
test(`a failed composer module can be recovered by the explicit reload action (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 393 ? 852 : 900 });
  const fixture = await installSessionUxFixture(page, 1);
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }),
  );
  await page.addInitScript((initialCards) => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards: initialCards,
          currentAgentCardId: "ux-0",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
  }, cards);

  let failNextRequest = false;
  let failedRequests = 0;
  await page.route(
    (url) => /\/assets\/AgentComposer-[^/]+\.js$/.test(url.pathname) ||
      url.pathname === "/src/session-mode/components/agent/AgentComposer.tsx",
    async (route) => {
      if (failNextRequest) {
        failNextRequest = false;
        failedRequests++;
        await route.abort("failed");
      } else await route.continue();
    },
  );
  const forbidden: string[] = [];
  page.on("request", (request) => {
    if (/\/turn\/(start|interrupt)$|\/thread\/(start|resume|unsubscribe)$/.test(new URL(request.url()).pathname))
      forbidden.push(request.url());
  });

  await page.goto("/?mode=session");
  const editor = page.locator(".session-agent-view [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await editor.fill("加载失败后应保留这条草稿");
  failNextRequest = true;
  await page.reload();
  const alert = page.getByRole("alert").filter({ hasText: "会话界面加载失败" });
  await expect(alert).toBeVisible();
  expect(failedRequests).toBe(1);
  const initialDocument = await page.evaluate(() => performance.timeOrigin);
  await alert.getByRole("button", { name: "重新加载界面" }).click();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("加载失败后应保留这条草稿");
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(initialDocument);
  expect(forbidden).toEqual([]);
});
}
