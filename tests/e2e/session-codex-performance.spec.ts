import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

test("long Codex history stays bounded, scrollable and isolated from background updates", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSessionUxFixture(page);
  await page.route("**/api/session/api/settings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, body: "" })
      : route.fallback(),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-mode [contenteditable=true]")
    .first()
    .waitFor({ timeout: 30000 });
  await seedSessionUx(page, 0);
  await page.evaluate(async () => {
    const { useAgentSettingsStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/stores/useAgentSettingsStore.ts')?.name ?? '/src/session-mode/stores/useAgentSettingsStore.ts');
    const { useAgentCenterStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/stores/useAgentCenterStore.ts')?.name ?? '/src/session-mode/stores/useAgentCenterStore.ts');
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    const { useLayoutStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/stores/useLayoutStore.ts')?.name ?? '/src/session-mode/stores/useLayoutStore.ts');
    const { useSessionSplitStore } = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/stores/useSessionSplitStore.ts')?.name ?? '/src/session-mode/stores/useSessionSplitStore.ts');
    useLayoutStore.setState({
      view: "agent",
      isRightPanelFocused: false,
      isRightPanelOpen: false,
    });
    const { useAcpStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/stores/useAcpStore.ts')?.name ?? '/src/session-mode/stores/useAcpStore.ts');
    useAgentCenterStore.setState({
      cards: [],
      currentAgentCardId: null,
      cardsViewMode: "solo",
    });
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useAcpStore.setState({ active: false });
    const events = Array.from({ length: 1500 }, (_, i) => ({
      method: "item/completed",
      params: {
        threadId: "perf-history",
        turnId: `turn-${i}`,
        item: {
          id: `message-${i}`,
          type: "agentMessage",
          text: `性能消息 ${i}\n\n**分析结果**\n\n- 验证数据\n- 检查输出\n\n\`\`\`typescript\nconst answer = 42;\n\`\`\``,
        },
      },
    }));
    useCodexStore.setState({
      currentThreadId: "perf-empty",
      historyLoadedMap: { "perf-empty": true, "perf-history": true },
      events: {
        "perf-empty": [
          {
            method: "item/completed",
            params: {
              threadId: "perf-empty",
              turnId: "warm-turn",
              item: {
                id: "warm-message",
                type: "agentMessage",
                text: "预热消息\n\n**分析结果**\n\n- 验证数据\n\n```typescript\nconst answer = 42;\n```",
              },
            },
          },
        ],
        "perf-history": events,
      },
    });
    for (const id of ["perf-empty", "perf-history"])
      useAgentCenterStore.getState().addAgentCard({ kind: "codex", id, cwd: "/fixture/performance", preview: id });
    (window as any).__selectPerfThread = (id: string) => {
      useCodexStore.setState({ currentThreadId: id });
      useAgentCenterStore.getState().setCurrentAgentCardId(id, "codex");
      useSessionSplitStore.getState().focusKey(`codex:${id}`);
    };
    (window as any).__selectPerfThread("perf-empty");
  });
  await page.evaluate(
    () => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/thread/CodexThread.tsx')?.name ?? '/src/session-mode/components/codex/thread/CodexThread.tsx'),
  );
  await expect(page.getByText("预热消息", { exact: true })).toBeAttached();
  await page.waitForTimeout(500);
  const switchMs = await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    const start = performance.now();
    (window as any).__selectPerfThread("perf-history");
    // Measure until the latest row is actually in the viewport, including React scheduling.
    let ready = false;
    while (performance.now() - start < 10000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const row = document.querySelector('[data-codex-row="event-turn-1499-message-1499"]');
      const viewport = row?.closest('[data-slot="scroll-area-viewport"]');
      if (row && viewport) {
        const message = row.getBoundingClientRect();
        const area = viewport.getBoundingClientRect();
        if (message.top < area.bottom && message.bottom > area.top) {
          ready = true;
          break;
        }
      }
    }
    if (!ready) throw new Error("Latest history row did not become visible");
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return performance.now() - start;
  });
  await expect(page.getByText("性能消息 1499", { exact: true })).toBeAttached();
  const surface = page.locator(".thread-surface").first();
  expect(
    await surface.locator("*").count(),
    "only visible history should be mounted",
  ).toBeLessThan(2000);
  expect(
    switchMs,
    "cached long history must not block switching for seconds",
  ).toBeLessThan(500);
  console.log(`cached 1500-message switch: ${switchMs.toFixed(1)}ms`);
  await expect(page.getByText("性能消息 1499", { exact: true })).toBeVisible();
  const viewport = surface.locator(
    'xpath=ancestor::*[@data-slot="scroll-area-viewport"]',
  );
  await viewport.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1000 }));
    element.scrollTop = 0;
  });
  await expect(page.getByText("性能消息 0", { exact: true })).toBeVisible();
  await expect(
    surface.locator('[data-streamdown="paragraph"]'),
  ).not.toHaveCount(1500);
  const editor = page.locator(".session-mode [contenteditable=true]").first();
  await editor.fill("性能测试草稿");
  // Reading history must survive new content and background activity.
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    useCodexStore.getState().addEvent("perf-history", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "perf-history",
        turnId: "stream-turn",
        itemId: "stream-item",
        delta: "流式更新",
      },
    });
  });
  await expect(page.getByText("性能消息 0", { exact: true })).toBeVisible();
  const scrollTop = await viewport.evaluate((element) => element.scrollTop);
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    (window as any).__selectPerfThread("perf-empty");
  });
  await expect(page.getByText("性能消息 0", { exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    (window as any).__selectPerfThread("perf-history");
  });
  await expect(page.getByText("性能消息 0", { exact: true })).toBeVisible();
  expect(
    await viewport.evaluate((element) => element.scrollTop),
  ).toBeLessThanOrEqual(scrollTop + 2);
  await page
    .getByRole("button", { name: "Scroll to bottom", exact: true })
    .click();
  await expect(page.getByText("流式更新", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    useCodexStore.getState().addEvent("perf-history", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "perf-history",
        turnId: "stream-turn",
        itemId: "stream-item",
        delta: "完成",
      },
    });
  });
  await expect(page.getByText("流式更新完成", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("性能测试草稿");
  expect(await surface.locator("*").count()).toBeLessThan(2000);
  const backgroundMs = await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    const start = performance.now();
    for (let i = 0; i < 30; i++)
      useCodexStore.getState().addEvent("background", {
        method: "item/agentMessage/delta",
        params: {
          threadId: "background",
          turnId: "background-turn",
          itemId: "background-item",
          delta: "更新",
        },
      });
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return performance.now() - start;
  });
  expect(backgroundMs).toBeLessThan(150);
  console.log(
    `background 30 updates: ${backgroundMs.toFixed(1)}ms; mounted elements: ${await surface.locator("*").count()}`,
  );
  await viewport.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1000 }));
    element.scrollTop = 24000;
  });
  await page.waitForTimeout(150);
  const anchor = await surface
    .locator("[data-codex-row]")
    .first()
    .getAttribute("data-index");
  expect(Number(anchor)).toBeGreaterThan(10);
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    (window as any).__selectPerfThread("perf-empty");
  });
  await expect(page.getByText("预热消息", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === '/src/session-mode/components/codex/stores/index.ts')?.name ?? '/src/session-mode/components/codex/stores/index.ts');
    (window as any).__selectPerfThread("perf-history");
  });
  await expect
    .poll(() =>
      surface.locator("[data-codex-row]").first().getAttribute("data-index"),
    )
    .toBe(anchor);
  await page.getByRole("switch", { name: "工作模式", exact: true }).click();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect
    .poll(() =>
      surface.locator("[data-codex-row]").first().getAttribute("data-index"),
    )
    .toBe(anchor);
  await page
    .getByRole("button", { name: "Scroll to bottom", exact: true })
    .click();
  await expect(page.getByText("流式更新完成", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".dev-runtime/perf-diagnosis/desktop.png" });
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.getByText("流式更新完成", { exact: true })).toBeVisible();
  const bounds = await editor.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
  await page.screenshot({ path: ".dev-runtime/perf-diagnosis/mobile.png" });
  expect(errors).toEqual([]);
});
