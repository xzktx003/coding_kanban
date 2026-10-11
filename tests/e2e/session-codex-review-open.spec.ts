import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const diff = "diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-old\n+new\n";

test("review changes opens the diff panel for the cited file", async ({ page }) => {
  test.setTimeout(60000);
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-codex-composer [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 1);
  const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
  await page.evaluate(
    async ({ cwd, diff }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const [{ useCodexStore }, { useAgentCenterStore }] = await Promise.all([
        module("/src/session-mode/components/codex/stores/useCodexStore.ts"),
        module("/src/session-mode/stores/useAgentCenterStore.ts"),
      ]);
      useAgentCenterStore.getState().addAgentCard(
        { kind: "codex", id: "ux-0", cwd, preview: "查看变更" },
        { activate: true },
      );
      useCodexStore.setState({ currentThreadId: "ux-0" });
      const change = {
        path: `${cwd}/source.ts`,
        kind: { type: "update", move_path: null },
        diff,
      };
      useCodexStore.getState().addEvent("ux-0", {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: "review-turn",
          item: {
            id: "patch",
            type: "fileChange",
            status: "completed",
            changes: [change],
          },
        },
      });
      useCodexStore.getState().addEvent("ux-0", {
        method: "turn/completed",
        params: {
          threadId: "ux-0",
          turn: {
            id: "review-turn",
            status: "completed",
            items: [
              {
                id: "patch",
                type: "fileChange",
                status: "completed",
                changes: [change],
              },
            ],
          },
        },
      });
    },
    { cwd, diff },
  );
  const work = page.getByRole("button", { name: /用时|工作过程/ });
  if (await work.count()) await work.first().click();
  const review = page.getByRole("button", { name: "查看变更", exact: true });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.getByText("正在加载变更")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("review-open.png"),
    fullPage: true,
  });
});
