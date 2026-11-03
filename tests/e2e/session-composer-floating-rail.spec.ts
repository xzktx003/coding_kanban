import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const size of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 393, height: 852 },
]) {
  test(`a changing composer rail preserves reading geometry on ${size.name}`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const fixture = await installSessionUxFixture(page, 2);
    const stream = await liveStream(page, baseURL!);
    try {
      let queueVisible = false,
        queueRevision = 0;
      const queueState = () => ({
        revision: queueRevision,
        paused: null,
        items: queueVisible
          ? [
              {
                id: "rail-geometry",
                threadId: "ux-0",
                text: "布局验收队列",
                images: [],
                parameters: {},
                mode: "queue",
                status: "queued",
                createdAt: 1,
                fingerprint: "rail-geometry",
              },
            ]
          : [],
      });
      await page.route("**/api/session/followups?**", (route) =>
        route.fulfill({ json: queueState() }),
      );
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-native-composer")
        .waitFor({ timeout: 60_000 });
      await seedSessionUx(page, 2, { sidebarOpen: false });
      await page.evaluate(async () => {
        const path =
          "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const url =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
        const { useCodexStore } = await import(url);
        const tabsPath = "/src/session-mode/stores/useAgentCenterStore.ts";
        const tabsUrl =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === tabsPath)?.name ??
          tabsPath;
        const { useAgentCenterStore } = await import(tabsUrl);
        useAgentCenterStore.getState().addAgentCard(
          {
            kind: "codex",
            id: "ux-0",
            cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
            preview: "布局验收",
          },
          { activate: true },
        );
        const messages = Array.from({ length: 20 }, (_, i) => ({
          method: "item/completed",
          params: {
            threadId: "ux-0",
            turnId: `old-${i}`,
            item: {
              id: `reply-${i}`,
              type: "agentMessage",
              phase: "final_answer",
              text: `固定消息 ${i}。${"保持阅读位置。".repeat(20)}`,
            },
          },
        }));
        useCodexStore.setState({
          turnTimingMap: {
            "ux-0": {
              turnId: "rail-turn",
              status: "inProgress",
              startedAtMs: Date.now(),
              durationMs: null,
            },
          },
          historyLoadedMap: { "ux-0": true },
          events: { "ux-0": messages },
        });
        const followupPath = "/src/session-mode/services/followupService.ts";
        const followupUrl =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === followupPath)?.name ??
          followupPath;
        const { useFollowupStore } = await import(followupUrl);
        (window as any).__setRailQueue = (state: unknown) =>
          useFollowupStore.setState((s: any) => ({
            threads: { ...s.threads, "ux-0": state },
          }));
      });
      const rail = page.locator(
        ".session-native-composer [data-composer-rail]",
      );
      const viewport = page
        .locator(".thread-surface")
        .first()
        .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"]');
      const input = page.locator(
        ".session-native-composer .session-composer-surface",
      );
      await expect(viewport).toBeVisible({ timeout: 60_000 });
      await viewport.evaluate((el) => {
        el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
      });
      await page.waitForTimeout(400);
      const beforeViewport = await viewport.boundingBox();
      const beforeInput = await input.boundingBox();
      const beforeScroll = await viewport.evaluate((el) => ({
        top: el.scrollTop,
        max: el.scrollHeight - el.clientHeight,
      }));
      expect(beforeScroll.max).toBeGreaterThan(100);
      queueVisible = true;
      queueRevision++;
      const frames = await page.evaluate(async (queueState) => {
        const viewport = document
          .querySelector(".thread-surface")!
          .closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
        const input = document.querySelector(
          ".session-native-composer .session-composer-surface",
        )!;
        const samples: Array<{
          height: number;
          inputY: number;
          scrollTop: number;
        }> = [];
        (window as any).__setRailQueue(queueState);
        const start = performance.now();
        do {
          await new Promise(requestAnimationFrame);
          samples.push({
            height: viewport.getBoundingClientRect().height,
            inputY: input.getBoundingClientRect().y,
            scrollTop: viewport.scrollTop,
          });
        } while (performance.now() - start < 350);
        return samples;
      }, queueState());
      await info.attach(`${size.name}-geometry-frames`, {
        body: JSON.stringify({
          beforeViewport,
          beforeInput,
          beforeScroll,
          frames,
        }),
        contentType: "application/json",
      });
      await expect(rail.getByText("布局验收队列")).toBeVisible();
      for (const frame of frames) {
        expect(
          Math.abs(frame.height - beforeViewport!.height),
        ).toBeLessThanOrEqual(1);
        expect(Math.abs(frame.inputY - beforeInput!.y)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(frame.scrollTop - beforeScroll.top),
        ).toBeLessThanOrEqual(1);
      }
      expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe(
        "absolute",
      );
      const opacity = await rail
        .locator(".session-composer-rail-content")
        .evaluate((el) => {
          const canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d")!;
          ctx.fillStyle = getComputedStyle(el).backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          return {
            alpha: ctx.getImageData(0, 0, 1, 1).data[3],
            opacity: getComputedStyle(el).opacity,
          };
        });
      expect(opacity.alpha).toBeGreaterThan(0);
      expect(opacity.alpha).toBeLessThan(255);
      expect(opacity.opacity).toBe("1");
      const gapPassesThrough = await rail.evaluate((el) => {
        const toggle = el
          .querySelector(".session-composer-rail-toggle")!
          .getBoundingClientRect();
        const status = el
          .querySelector(".session-native-composer-status")!
          .getBoundingClientRect();
        const railBox = el.getBoundingClientRect();
        const firstControl = Math.min(toggle.left, status.left);
        const x = (railBox.left + firstControl) / 2,
          y = Math.max(toggle.top, status.top) + 5;
        return (
          firstControl - railBox.left > 10 &&
          !document.elementFromPoint(x, y)?.closest("[data-composer-rail]")
        );
      });
      expect(gapPassesThrough).toBe(true);
      const subtleToggle = await rail
        .getByRole("button", { name: "收起提示" })
        .evaluate((el) => ({
          text: el.textContent,
          background: getComputedStyle(el).backgroundColor,
          border: getComputedStyle(el).borderTopWidth,
          width: el.getBoundingClientRect().width,
        }));
      expect(subtleToggle.text).toBe("");
      expect(subtleToggle.background).toBe("rgba(0, 0, 0, 0)");
      expect(subtleToggle.border).toBe("0px");
      expect(subtleToggle.width).toBeLessThanOrEqual(40);
      await page.screenshot({
        path: info.outputPath(`${size.name}-expanded.png`),
      });
      const toggle = rail.getByRole("button", { name: "收起提示" });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(
        rail.getByRole("button", { name: "展开提示" }),
      ).toHaveAttribute("aria-expanded", "false");
      await expect(rail.getByText("布局验收队列")).toBeHidden();
      expect(
        Math.abs(
          (await viewport.boundingBox())!.height - beforeViewport!.height,
        ),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          (await viewport.evaluate((el) => el.scrollTop)) - beforeScroll.top,
        ),
      ).toBeLessThanOrEqual(1);
      await page.keyboard.press("Enter");
      await expect(rail.getByText("布局验收队列")).toBeVisible();
      await viewport.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const bottomGap = () =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        );
      expect(await bottomGap()).toBeLessThanOrEqual(1);
      queueVisible = false;
      queueRevision++;
      await page.evaluate(
        (state) => (window as any).__setRailQueue(state),
        queueState(),
      );
      await expect(
        rail.locator('[data-composer-rail-item="present"]'),
      ).toHaveCount(0);
      await page.waitForTimeout(200);
      expect(
        Math.abs(
          (await viewport.boundingBox())!.height - beforeViewport!.height,
        ),
      ).toBeLessThanOrEqual(1);
      expect(await bottomGap()).toBeLessThanOrEqual(1);
      expect(
        fixture.calls.filter((c) =>
          /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
            c.path,
          ),
        ),
      ).toEqual([]);
    } finally {
      await stream.close();
    }
  });
}

test("switching sessions retains each draft and only that session's collapsed rail", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const fixture = await installSessionUxFixture(page, 2);
  let holdA = false,
    heldA = false,
    releaseA!: () => void;
  const restoreA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  await page.route("**/api/session/followups?**", async (route) => {
    const threadId =
      new URL(route.request().url()).searchParams.get("threadId") ?? "ux-0";
    if (holdA && threadId === "ux-0") {
      heldA = true;
      await restoreA;
    }
    return route.fulfill({
      json: {
        revision: 1,
        paused: null,
        items: [
          {
            id: `queue-${threadId}`,
            threadId,
            text: `队列 ${threadId}`,
            images: [],
            parameters: {},
            mode: "queue",
            status: "queued",
            createdAt: 1,
            fingerprint: threadId,
          },
        ],
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-native-composer").waitFor({ timeout: 60_000 });
  await seedSessionUx(page, 2);
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  const tab = (n: number) =>
    page.locator(`[role=tab][data-tab-key="codex:ux-${n}"]`);
  const open = async (n: number) => {
    await page
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: `中文会话 ${n} ` })
      .first()
      .click();
    await expect(tab(n)).toHaveAttribute("aria-selected", "true");
    await expect(
      page.locator(`.session-native-composer[data-owner-thread="ux-${n}"]`),
    ).toBeVisible();
  };
  await open(0);
  await expect(page.getByText("队列 ux-0")).toBeVisible({ timeout: 30_000 });
  await editor.fill("会话 A 的独立草稿");
  await page.getByRole("button", { name: "收起提示" }).click();
  const baseline = await page
    .locator(".session-composer-target-container")
    .boundingBox();
  await page.evaluate(() => {
    const samples: Array<{
      y: number;
      height: number;
      placeholder: boolean;
      owner: string | null;
    }> = [];
    (window as any).__switchSamples = samples;
    document.addEventListener(
      "pointerdown",
      () => {
        const start = performance.now();
        const sample = () => {
          const el = document.querySelector(
            ".session-composer-target-container",
          );
          if (el) {
            const rect = el.getBoundingClientRect();
            samples.push({
              y: rect.y,
              height: rect.height,
              placeholder: !![...el.querySelectorAll('[role="status"]')].find(
                (n) => n.textContent?.includes("正在同步会话输入目标"),
              ),
              owner:
                el
                  .querySelector(".session-native-composer")
                  ?.getAttribute("data-owner-thread") ?? null,
            });
          }
          if (performance.now() - start < 2500) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { once: true, capture: true },
    );
  });
  await open(1);
  await expect(page.getByText("队列 ux-1")).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveText("");
  await editor.fill("会话 B 的独立草稿");
  await page.waitForTimeout(2600);
  const samples = await page.evaluate(
    () =>
      (window as any).__switchSamples as Array<{
        y: number;
        height: number;
        placeholder: boolean;
        owner: string | null;
      }>,
  );
  await info.attach("session-switch-frames", {
    body: JSON.stringify({ baseline, samples }),
    contentType: "application/json",
  });
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.some((frame) => frame.owner === "ux-1")).toBe(true);
  for (const frame of samples) {
    expect(
      Math.abs(frame.y - baseline!.y),
      `switch frame ${JSON.stringify(frame)}`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(frame.height - baseline!.height),
      `switch frame ${JSON.stringify(frame)}`,
    ).toBeLessThanOrEqual(1);
  }
  holdA = true;
  await page.evaluate(async () => {
    const path = "/src/session-mode/services/followupService.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useFollowupStore } = await import(url);
    useFollowupStore.setState((state: any) => {
      const threads = { ...state.threads };
      delete threads["ux-0"];
      return { threads };
    });
  });
  try {
    await tab(0).click();
    await expect(editor).toHaveText("会话 A 的独立草稿");
    await expect.poll(() => heldA, { timeout: 30_000 }).toBe(true);
    await expect(page.getByRole("button", { name: "展开提示" })).toHaveCount(0);
  } finally {
    holdA = false;
    releaseA();
  }
  await expect(page.getByRole("button", { name: "展开提示" })).toBeVisible();
  await page.getByRole("button", { name: "展开提示" }).click();
  await expect(page.getByText("队列 ux-0")).toBeVisible();
  await tab(1).click();
  await expect(editor).toHaveText("会话 B 的独立草稿");
  await expect(page.getByText("队列 ux-1")).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionSplitStore.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useSessionSplitStore } = await import(url);
    useSessionSplitStore.getState().reconcile(["codex:ux-0", "codex:ux-1"]);
    useSessionSplitStore
      .getState()
      .place("codex:ux-1", useSessionSplitStore.getState().tree.id, "right");
  });
  const groups = page.locator("[data-session-group]");
  await expect(groups).toHaveCount(2);
  const boxes = await groups.evaluateAll((nodes) =>
    nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  await page.getByRole("button", { name: "收起提示" }).click();
  await expect(page.getByRole("button", { name: "展开提示" })).toBeVisible();
  const afterBoxes = await groups.evaluateAll((nodes) =>
    nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  for (let i = 0; i < boxes.length; i++)
    for (const key of ["x", "y", "width", "height"] as const)
      expect(Math.abs(afterBoxes[i][key] - boxes[i][key])).toBeLessThanOrEqual(
        1,
      );
  await expect(editor).toHaveText("会话 B 的独立草稿");
  expect(
    fixture.calls.filter((c) =>
      /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});

test("questions, a long native queue and Goal remain reachable in the bounded overlay", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const fixture = await installSessionUxFixture(page, 2);
  const stream = await liveStream(page, baseURL!);
  try {
    const goal = {
      threadId: "ux-0",
      objective: "完成悬浮层验收",
      status: "active",
      tokensUsed: 1200,
      tokenBudget: 5000,
      timeUsedSeconds: 65,
      createdAt: 1,
      updatedAt: 2,
    };
    await page.route(/\/thread\/goal\/get$/, (route) =>
      route.fulfill({ json: { goal } }),
    );
    await page.route("**/api/session/followups?**", (route) =>
      route.fulfill({
        json: {
          authority: "native",
          revision: 1,
          paused: null,
          items: Array.from({ length: 12 }, (_, i) => ({
            id: `native-${i}`,
            nativeQueuedSubmissionId: `native-${i}`,
            authority: "native",
            threadId: "ux-0",
            text: `待发内容 ${i + 1}`,
            images: [],
            parameters: {},
            mode: "queue",
            status: "queued",
            createdAt: i + 1,
            fingerprint: `native-${i}`,
          })),
        },
      }),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await page.locator(".session-native-composer").waitFor({ timeout: 60_000 });
    await seedSessionUx(page, 2);
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useAgentCenterStore.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useAgentCenterStore } = await import(url);
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "提示验收",
        },
        { activate: true },
      );
    });
    await expect(
      page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
    ).toHaveAttribute("aria-selected", "true");
    await page.evaluate(async (goal) => {
      const path = "/src/session-mode/components/codex/stores/useCodexStore.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(url);
      useCodexStore.setState({
        currentTurnId: "rail-turn",
        turnTimingMap: {
          "ux-0": {
            turnId: "rail-turn",
            status: "inProgress",
            startedAtMs: Date.now(),
            durationMs: null,
          },
        },
        goalMap: { "ux-0": goal },
        events: {
          "ux-0": [
            {
              method: "turn/diff/updated",
              params: {
                threadId: "ux-0",
                turnId: "rail-turn",
                diff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n",
              },
            },
            {
              method: "item/completed",
              params: {
                threadId: "ux-0",
                turnId: "rail-turn",
                item: {
                  type: "agentMessage",
                  id: "rail-question",
                  text: "请确认验收范围",
                  delivery: "async",
                  questions: [
                    { title: "确认验收范围？", options: ["确认", "稍后"] },
                  ],
                },
              },
            },
          ],
        },
      });
    }, goal);
    const rail = page.locator(".session-native-composer [data-composer-rail]");
    const panel = rail.locator(".session-composer-rail-content");
    const question = rail.getByRole("button", { name: "回答问题 · 1" });
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(rail.getByText("待发内容 1", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(rail.locator(".session-thread-goal")).toHaveCount(1);
    await expect(rail.getByText(/待发消息按原生线程当前设置执行/)).toHaveCount(
      1,
    );
    const metrics = await panel.evaluate((el) => ({
      height: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.height);
    expect((await rail.boundingBox())!.height).toBeLessThanOrEqual(200);
    const toggleBox = await rail
      .getByRole("button", { name: "收起提示" })
      .boundingBox();
    const statusBox = await rail
      .locator(".session-native-composer-status")
      .boundingBox();
    const panelBox = await panel.boundingBox();
    expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(
      toggleBox!.x + 1,
    );
    expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(
      panelBox!.y + 1,
    );
    await page.screenshot({ path: info.outputPath("coexisting-notices.png") });
    await question.click();
    const questionOverlay = page.locator(".session-async-question-overlay");
    await expect(questionOverlay).toBeVisible();
    expect(
      await questionOverlay.evaluate((el) =>
        Number(getComputedStyle(el).zIndex),
      ),
    ).toBeGreaterThan(
      await rail.evaluate((el) => Number(getComputedStyle(el).zIndex)),
    );
    await page.keyboard.press("Escape");
    await expect(questionOverlay).toHaveCount(0);
    await rail.locator(".session-goal-open").click();
    await expect(page.locator(".session-goal-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".session-goal-dialog")).toHaveCount(0);
    await rail.getByRole("button", { name: "收起提示" }).click();
    await expect(rail.getByRole("button", { name: "展开提示" })).toBeVisible();
    await expect(rail.locator(".session-native-composer-status")).toContainText(
      "正在等待你的回答",
    );
    await rail.getByRole("button", { name: "展开提示" }).click();
    await expect(question).toBeVisible();
    expect(
      fixture.calls.filter((c) =>
        /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop)|thread\/goal\/(set|clear))$/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await stream.close();
  }
});

test("the completed Goal uses a quiet, accessible control on desktop and touch screens", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  for (const device of [
    { name: "desktop", width: 1440, height: 1000, hasTouch: false },
    { name: "touch", width: 393, height: 852, hasTouch: true },
  ]) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: device.width, height: device.height },
      hasTouch: device.hasTouch,
      isMobile: device.hasTouch,
    });
    const page = await context.newPage();
    try {
      const fixture = await installSessionUxFixture(page, 1);
      const goal = {
        threadId: "ux-0",
        objective: "完成当前项目的实现与验收",
        status: "complete",
        tokenBudget: 5000,
        tokensUsed: 1200,
        timeUsedSeconds: 65,
        createdAt: 1,
        updatedAt: 2,
      };
      await page.route(/\/thread\/goal\/get$/, (route) =>
        route.fulfill({ json: { goal } }),
      );
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-native-composer")
        .waitFor({ timeout: 60_000 });
      await seedSessionUx(page, 1, { sidebarOpen: false });
      await page.evaluate(async (goal) => {
        const path =
          "/src/session-mode/components/codex/stores/useCodexStore.ts";
        const url =
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
        const { useCodexStore } = await import(url);
        useCodexStore.setState({ goalMap: { "ux-0": goal } });
      }, goal);
      const rail = page.locator(
        ".session-native-composer [data-composer-rail]",
      );
      const status = rail.locator(".session-native-composer-status");
      const toggle = rail.getByRole("button", { name: "收起提示" });
      await expect(rail.locator(".session-thread-goal")).toBeVisible({
        timeout: 30_000,
      });
      await expect(status).toHaveText("已达成目标");
      await expect(toggle).toBeVisible();
      const measured = await toggle.evaluate((el) => {
        const button = el.getBoundingClientRect();
        const status = el
          .parentElement!.querySelector(".session-native-composer-status")!
          .getBoundingClientRect();
        return {
          width: button.width,
          height: button.height,
          left: button.left,
          center: button.y + button.height / 2,
          statusRight: status.right,
          statusCenter: status.y + status.height / 2,
          background: getComputedStyle(el).backgroundColor,
          border: getComputedStyle(el).borderTopWidth,
          text: el.textContent,
        };
      });
      expect(measured.text).toBe("");
      expect(measured.background).toBe("rgba(0, 0, 0, 0)");
      expect(measured.border).toBe("0px");
      expect(measured.statusRight).toBeLessThanOrEqual(measured.left + 1);
      expect(
        Math.abs(measured.center - measured.statusCenter),
      ).toBeLessThanOrEqual(1);
      if (device.hasTouch) {
        expect(measured.width).toBeGreaterThanOrEqual(40);
        expect(measured.height).toBeGreaterThanOrEqual(40);
      } else expect(measured.width).toBeLessThanOrEqual(40);
      await page.screenshot({
        path: info.outputPath(`completed-goal-${device.name}.png`),
      });
      const composerBox = (await page
        .locator(".session-native-composer")
        .boundingBox())!;
      const railBox = (await rail.boundingBox())!;
      const left = Math.max(0, Math.floor(composerBox.x - 8));
      const top = Math.max(0, Math.floor(railBox.y - 8));
      const right = Math.min(
        device.width,
        Math.ceil(composerBox.x + composerBox.width + 8),
      );
      const bottom = Math.min(
        device.height,
        Math.ceil(composerBox.y + composerBox.height + 8),
      );
      await page.screenshot({
        path: info.outputPath(`completed-goal-${device.name}-detail.png`),
        clip: { x: left, y: top, width: right - left, height: bottom - top },
      });
      await toggle.click();
      await expect(rail.locator(".session-thread-goal")).toBeHidden();
      const reopen = rail.getByRole("button", { name: "展开提示" });
      await expect(reopen).toHaveText("展开");
      await expect(status).toHaveText("已达成目标");
      await reopen.click();
      await expect(rail.locator(".session-thread-goal")).toBeVisible();
      expect(
        fixture.calls.filter((c) =>
          /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop)|thread\/goal\/(set|clear))$/.test(
            c.path,
          ),
        ),
      ).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
