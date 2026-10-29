import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

// A valid-size network page may still expand past the display budget after
// JSON parsing. No subscriber/Markdown render may observe that oversized array.
test("cold history is bounded on its first publication, including a protected oversized user prompt", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const url = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      url("/src/session-mode/components/codex/stores/index.ts")
    );
    const { codexService } = await import(
      url("/src/session-mode/services/codexService.ts")
    );
    const { estimateTranscriptBytes } = await import(
      url("/src/session-mode/services/codexTranscriptMemoryBudget.ts")
    );
    const w = window as any;
    w.__coldMemory = {
      store: useCodexStore,
      service: codexService,
      estimate: estimateTranscriptBytes,
      peak: 0,
      sizes: [],
    };
  });
  await page
    .locator('.session-nav-row[role="button"]')
    .filter({ hasText: "中文会话 0 " })
    .first()
    .click();
  await page.evaluate(async () => {
    await (window as any).__coldMemory.service.loadThreadHistory(
      "ux-0",
      undefined,
      { recent: true, background: true },
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as any).__coldMemory.store.getState().historyLoadedMap[
            "ux-0"
          ],
        ),
      ),
    )
    .toBe(true);
  const text = "Bounded history display.\n".repeat(10000);
  const turns = Array.from({ length: 20 }, (_, index) => ({
    id: `cold-turn-${index}`,
    status: "completed",
    startedAt: index + 1,
    completedAt: index + 2,
    durationMs: 1000,
    error: null,
    items: [
      {
        id: `cold-user-${index}`,
        type: "userMessage",
        content: [
          {
            type: "text",
            text:
              index === 19
                ? "cold-prompt-head " +
                  "x".repeat(5 * 1024 * 1024) +
                  " cold-prompt-tail"
                : `Question ${index}`,
            text_elements: [],
          },
        ],
      },
      {
        id: `cold-agent-${index}`,
        type: "agentMessage",
        phase: "final_answer",
        text,
      },
    ],
  }));
  await page.route(
    (url) => url.pathname.endsWith("/api/codex/thread/turns/list"),
    async (route) => {
      await route.fulfill({
        json: { data: [...turns].reverse(), nextCursor: null },
      });
    },
  );
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:resume|start|acquire))$/.test(
        path,
      )
    )
      writes.push(path);
  });
  const startedAt = Date.now();
  const result = await page.evaluate(async () => {
    const w = window as any;
    const probe = w.__coldMemory;
    const stop = probe.store.subscribe((state: any) => {
      const events = state.events["ux-0"];
      if (!events) return;
      const bytes = probe.estimate(events);
      probe.peak = Math.max(probe.peak, bytes);
      probe.sizes.push(bytes);
    });
    try {
      await probe.service.loadThreadHistory("ux-0", undefined, {
        recent: true,
        background: true,
      });
      const events = probe.store.getState().events["ux-0"];
      const user = events.find(
        (event: any) =>
          event.method === "item/completed" &&
          event.params.item.type === "userMessage" &&
          event.params.item.id === "cold-user-19",
      );
      const prompt =
        user?.params.item.content.find((input: any) => input.type === "text")
          ?.text ?? "";
      return {
        peak: probe.peak,
        final: probe.estimate(events),
        publications: probe.sizes.length,
        count: events.length,
        promptLength: prompt.length,
        head: prompt.startsWith("cold-prompt-head"),
        tail: prompt.endsWith("cold-prompt-tail"),
      };
    } finally {
      stop();
    }
  });
  const cdp = await context.newCDPSession(page);
  const heap = await cdp.send("Runtime.getHeapUsage");
  expect(result.publications).toBeGreaterThan(0);
  expect(result.peak).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.final).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.promptLength).toBeLessThanOrEqual(256 * 1024);
  expect(result.head).toBe(true);
  expect(result.tail).toBe(true);
  expect(writes).toEqual([]);
  await testInfo.attach("cold-memory-admission.json", {
    body: JSON.stringify({
      ...result,
      milliseconds: Date.now() - startedAt,
      heap: heap.usedSize,
    }),
    contentType: "application/json",
  });
});
