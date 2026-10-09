import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";

// This driver uses public UI and HTTP fixtures only, so it also runs against
// Vite's production preview without importing development source modules.
test("10000 native history messages and 30 tabs remain usable in a built workbench", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await installSessionUxFixture(page, 30);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const turns = Array.from({ length: 10000 }, (_, i) => ({
    id: `built-turn-${i}`,
    status: "completed",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
    items: [
      {
        id: `built-message-${i}`,
        type: "agentMessage",
        text: `Production message ${i}\n\n**验证完整历史**\n\n- 所有消息保留\n- 隔离的原生格式 fixture\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``,
      },
    ],
  }));
  await page.route("**/api/session/api/codex/thread/read", (route) => {
    const body = route.request().postDataJSON(),
      thread = f.threads.find((t) => t.id === body.threadId);
    return route.fulfill({
      json: {
        thread: {
          ...thread,
          turns: body.threadId === "ux-0" && body.includeTurns ? turns : [],
        },
      },
    });
  });
  await page.route("**/api/session/api/codex/thread/turns/list", (route) => {
    const body = route.request().postDataJSON();
    const data = body.threadId === "ux-0" ? turns : [];
    return route.fulfill({
      json: {
        data: body.sortDirection === "desc" ? [...data].reverse() : data,
        nextCursor: null,
        backwardsCursor: null,
      },
    });
  });
  const cards = f.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.addInitScript((cards) => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards,
          currentAgentCardId: "ux-1",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
  }, cards);
  await page.setViewportSize({ width: 1440, height: 900 });
  const startupStarted = Date.now();
  await page.goto("/?mode=session");
  const tab = (i: number) =>
    page.locator(`[role=tab][data-tab-key="codex:ux-${i}"]`);
  await expect(tab(1)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".session-mode [contenteditable=true]").first(),
  ).toBeVisible();
  const startupUsableMs = Date.now() - startupStarted;
  const start = Date.now();
  await tab(0).click();
  await expect(
    page.getByText("Production message 9999", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const firstMs = Date.now() - start;
  await page.evaluate(() => {
    const w = window as any;
    w.inputFrames = [];
    w.tasks = [];
    w.observer = new PerformanceObserver((list) =>
      w.tasks.push(...list.getEntries().map((e) => e.duration)),
    );
    w.observer.observe({ type: "longtask", buffered: false });
    document.addEventListener("keydown", (event) => {
      if (!(event.target as Element)?.closest("[contenteditable=true]")) return;
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          w.inputFrames.push(performance.now() - start),
        ),
      );
    });
  });
  const switches: number[] = [];
  for (let i = 0; i < 5; i++) {
    await tab(1).click();
    await expect(tab(1)).toHaveAttribute("aria-selected", "true");
    const at = Date.now();
    await tab(0).click();
    await expect(
      page.getByText("Production message 9999", { exact: true }),
    ).toBeVisible();
    switches.push(Date.now() - at);
  }
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await editor.pressSequentially("benchmark draft", { delay: 20 });
  await expect(editor).toHaveText("benchmark draft");
  const metrics = await page.evaluate(() => {
    const w = window as any;
    w.observer.disconnect();
    return {
      inputFrames: w.inputFrames as number[],
      longTasks: w.tasks,
      mountedRows: document.querySelectorAll("[data-codex-row]").length,
      mountedElements: document
        .querySelector(".thread-surface")
        ?.querySelectorAll("*").length,
      heapBytes: (performance as any).memory?.usedJSHeapSize ?? null,
      resourceRequests: performance.getEntriesByType("resource").length,
    };
  });
  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const result = {
    messages: 10000,
    followedSessions: 30,
    startupUsableMs,
    firstMs,
    switches,
    warmSwitchP95Ms: p95(switches),
    inputToTwoFramesP95Ms: p95(metrics.inputFrames),
    apiPostRequests: f.calls.length,
    ...metrics,
  };
  await mkdir(".dev-runtime/session-opt", { recursive: true });
  await writeFile(
    `.dev-runtime/session-opt/public-ui-${process.env.SESSION_BENCHMARK_PHASE ?? "production"}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  expect(metrics.mountedRows).toBeLessThan(30);
  expect(metrics.mountedElements).toBeLessThan(2000);
  expect(result.warmSwitchP95Ms).toBeLessThan(750);
  expect(result.inputToTwoFramesP95Ms).toBeLessThan(200);
  expect(
    f.calls.filter((c) =>
      /thread\/resume|turn\/(start|interrupt)|\/stop$/.test(c.path),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
