import { expect, test } from "@playwright/test";
import { installThirtyFollowedFourPanes } from "./session-multisession-fixture";

test("typing stays responsive with 10,000 history events and 30 followed chats", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { fixture, stream } = await installThirtyFollowedFourPanes(
    page,
    baseURL!,
  );
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(baseURL + "/?mode=session", {
      waitUntil: "domcontentloaded",
    });
    const editor = page
      .locator('.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]')
      .first();
    await expect(editor).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("[data-session-group]")).toHaveCount(4);

    const history = await page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const moduleUrl = performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name;
      const { useCodexStore } = await import(moduleUrl ?? path);
      const events = Array.from({ length: 2500 }, (_, index) => {
        const params = {
          threadId: "ux-0",
          turnId: `load-${index}`,
          itemId: `answer-${index}`,
        };
        return [
          {
            method: "item/agentMessage/delta",
            params: { ...params, delta: `历史正文 ${index}` },
          },
          {
            method: "thread/tokenUsage/updated",
            params: { threadId: "ux-0", turnId: params.turnId, tokenUsage: {} },
          },
          {
            method: "item/agentMessage/delta",
            params: { ...params, delta: " 更多内容" },
          },
          {
            method: "item/completed",
            params: {
              threadId: "ux-0",
              turnId: params.turnId,
              item: {
                type: "agentMessage",
                id: params.itemId,
                text: `历史正文 ${index} 完整回复`,
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          },
        ];
      }).flat();
      useCodexStore.setState({
        events: { ...useCodexStore.getState().events, "ux-0": events },
      });
      return events.length;
    });
    expect(history).toBe(10_000);
    await expect(
      page.locator(
        '.codex-presentation [data-codex-row="event-load-2499-answer-2499"]',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("历史正文 2499 完整回复", { exact: true }),
    ).toBeVisible();
    expect(
      await page.locator(".codex-presentation [data-codex-row]").count(),
    ).toBeLessThan(80);

    await page.evaluate(() => {
      const samples: number[] = [];
      (window as any).__longHistoryInputSamples = samples;
      document.addEventListener(
        "keydown",
        (event) => {
          const target = event.target as HTMLElement;
          if (
            event.key !== "x" ||
            !target.closest(".session-codex-composer") ||
            !target.isContentEditable
          )
            return;
          const started = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              samples.push(performance.now() - started);
            }),
          );
        },
        true,
      );
    });
    for (let index = 0; index < 30; index++) {
      await editor.press("x");
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as any).__longHistoryInputSamples.length,
          ),
        )
        .toBe(index + 1);
    }
    const samples = await page.evaluate(
      () => (window as any).__longHistoryInputSamples as number[],
    );
    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    console.log(
      `10,000-history / 30-chat input-to-two-frames p95: ${p95.toFixed(1)}ms`,
    );
    expect(p95).toBeLessThanOrEqual(100);
    await expect(editor).toHaveText("x".repeat(30));
    expect(
      fixture.calls.filter((call) =>
        /thread\/(resume|fork|rollback)|turn\/(start|interrupt)|followups\/(submit|stop)|\/stop$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await stream.close();
  }
});
