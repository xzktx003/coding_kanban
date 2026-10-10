import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import {
  installResizeDiagnostics,
  saveResizeDiagnostics,
} from "./resize-observer-diagnostics";

async function prepare(
  page: import("@playwright/test").Page,
  longRows = false,
) {
  const fixture = await installSessionUxFixture(page, 1);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installResizeDiagnostics(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(
    async ({ longRows }) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ useCodexStore }, { useLayoutStore }, { useAgentCenterStore }] =
        await Promise.all([
          module("/src/session-mode/components/codex/stores/index.ts"),
          module("/src/session-mode/stores/useLayoutStore.ts"),
          module("/src/session-mode/stores/useAgentCenterStore.ts"),
        ]);
      const events = Array.from({ length: 400 }, (_, index) => ({
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: `smooth-turn-${index}`,
          item: {
            id: `smooth-item-${index}`,
            type: "agentMessage",
            phase: "final_answer",
            text:
              longRows && index % 4 === 0
                ? `长代码消息 ${index}\n\n\x60\x60\x60typescript\n${Array.from({ length: 60 }, (_, line) => `const value${line} = ${index} + ${line};`).join("\n")}\n\x60\x60\x60\n\n代码之后继续阅读 ${index}`
                : `阅读消息 ${index}\n\n正文内容各自保持。`,
          },
        },
      }));
      useLayoutStore.setState({
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useAgentCenterStore.getState().addAgentCard(
        {
          kind: "codex",
          id: "ux-0",
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: "平滑滚动验收",
        },
        { activate: true },
      );
      useAgentCenterStore.setState({ cardsViewMode: "solo" });
      useCodexStore.setState({
        events: { "ux-0": events },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        threadStatusMap: { "ux-0": { type: "idle" } },
        currentThreadId: "ux-0",
      });
      (window as any).__smoothStore = useCodexStore;
    },
    { longRows },
  );
  await expect(page.getByText("阅读消息 399", { exact: true })).toBeVisible();
  const viewport = page
    .locator(".thread-surface")
    .first()
    .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"]');
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .fill("平滑滚动的会话草稿");
  return { fixture, errors, viewport };
}

test("small upward trackpad increments keep the reader detached during live updates", async ({
  page,
}, info) => {
  const { fixture, errors, viewport } = await prepare(page);
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const samples: unknown[] = [];
  for (let step = 0; step < 24; step++) {
    await page.mouse.wheel(0, -2);
    samples.push(
      await viewport.evaluate(async (element, step) => {
        (window as any).__smoothStore.getState().addEvent("ux-0", {
          method: "item/agentMessage/delta",
          params: {
            threadId: "ux-0",
            turnId: "live-smooth-turn",
            itemId: "live-smooth-item",
            delta: `实时文本 ${step}。`,
          },
        });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return {
          step,
          top: element.scrollTop,
          bottomDistance:
            element.scrollHeight - element.clientHeight - element.scrollTop,
        };
      }, step),
    );
  }
  await writeFile(
    info.outputPath("trackpad-live-samples.json"),
    JSON.stringify(samples, null, 2),
  );
  await info.attach("trackpad-live-samples", {
    path: info.outputPath("trackpad-live-samples.json"),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("trackpad-live.png") });
  const distance = await viewport.evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
  );
  expect(distance).toBeGreaterThanOrEqual(40);
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toContainText("有新消息");
  await page.getByRole("button", { name: "Scroll to bottom" }).click();
  await viewport.evaluate(async (el) => {
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "ux-0",
        turnId: "live-smooth-turn",
        itemId: "live-smooth-item",
        delta: "\n\n末尾主动继续跟随。",
      },
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByText("末尾主动继续跟随。", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|interrupt)$|\/thread\/resume$/.test(call.path),
    ),
  ).toEqual([]);
  await saveResizeDiagnostics(page, info);
});

test("a positive wheel at latest keeps before-paint following when the reply grows", async ({
  page,
}, info) => {
  const { viewport, fixture, errors } = await prepare(page);
  const key = "event-positive-smooth-turn-positive-smooth-item";
  await page.evaluate(() =>
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "ux-0",
        turnId: "positive-smooth-turn",
        itemId: "positive-smooth-item",
        delta: "正向滚轮跟随短回复。",
      },
    }),
  );
  await expect(
    page.getByText("正向滚轮跟随短回复。", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  const initial = await viewport.evaluate((el, key) => {
    (window as any).__positiveWheel = { wheels: [], scrolls: 0 };
    el.addEventListener(
      "wheel",
      (event) =>
        (window as any).__positiveWheel.wheels.push({
          deltaY: (event as WheelEvent).deltaY,
          trusted: event.isTrusted,
        }),
      { passive: true },
    );
    el.addEventListener(
      "scroll",
      () => (window as any).__positiveWheel.scrolls++,
    );
    return {
      scrollTop: el.scrollTop,
      height: el
        .querySelector(`[data-codex-row="${key}"]`)!
        .getBoundingClientRect().height,
    };
  }, key);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.wheel(0, 220);
  await viewport.evaluate(async () => {
    for (let frame = 0; frame < 4; frame++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  });
  const wheel = await viewport.evaluate((el) => ({
    ...(window as any).__positiveWheel,
    scrollTop: el.scrollTop,
  }));
  expect(
    wheel.wheels.some(
      (event: { deltaY: number; trusted: boolean }) =>
        event.deltaY > 0 && event.trusted,
    ),
  ).toBe(true);
  expect(wheel.scrolls).toBe(0);
  expect(wheel.scrollTop).toBe(initial.scrollTop);
  const samples = await viewport.evaluate(async (el, key) => {
    const snapshot = () => {
      const row = el.querySelector(`[data-codex-row="${key}"]`);
      if (!row)
        throw new Error("Latest reply disappeared during positive following");
      return {
        at: performance.now(),
        bottomDistance: el.scrollHeight - el.clientHeight - el.scrollTop,
        height: row.getBoundingClientRect().height,
      };
    };
    type Delivery = {
      deliveredAt: number;
      targets: Array<{ target: string; height: number }>;
      microtask: ReturnType<typeof snapshot>;
    };
    const initialDeliveries: Delivery[] = [];
    const growthDeliveries: Delivery[] = [];
    let growing = false;
    let resolveInitial!: () => void;
    const firstDelivery = new Promise<void>((resolve) => {
      resolveInitial = resolve;
    });
    const row = el.querySelector(`[data-codex-row="${key}"]`)!;
    const surface = el.querySelector(".thread-surface")!;
    // The production observers are already registered. Witness a real native
    // delivery and its microtask, separately from RAF/zero-task ordering.
    const observer = new ResizeObserver((entries) => {
      const deliveredAt = performance.now();
      const targets = entries.map((entry) => ({
        target: entry.target === row ? "latest-row" : "thread-surface",
        height: entry.contentRect.height,
      }));
      const destination = growing ? growthDeliveries : initialDeliveries;
      queueMicrotask(() => {
        destination.push({ deliveredAt, targets, microtask: snapshot() });
        if (destination === initialDeliveries) resolveInitial();
      });
    });
    observer.observe(row);
    observer.observe(surface);
    await firstDelivery;
    growing = true;
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "ux-0",
        turnId: "positive-smooth-turn",
        itemId: "positive-smooth-item",
        delta:
          "\n\n" +
          Array.from(
            { length: 12 },
            (_, index) => `正向滑动之后第${index}段，回复增高仍保持底部。`,
          ).join("\n\n"),
      },
    });
    const frames: Array<{
      rawRAF: ReturnType<typeof snapshot>;
      afterRO: ReturnType<typeof snapshot>;
    }> = [];
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const rawRAF = snapshot();
      // Retain the original zero-task samples too. React may commit between
      // RAF and this task, before the new height has actually been delivered.
      // Only the independent native RO microtask anchors delivery ordering.
      const afterRO = await new Promise<ReturnType<typeof snapshot>>(
        (resolve) => setTimeout(() => resolve(snapshot()), 0),
      );
      frames.push({ rawRAF, afterRO });
    }
    observer.disconnect();
    return { frames, initialDeliveries, growthDeliveries };
  }, key);
  await writeFile(
    info.outputPath("positive-wheel-before-paint.json"),
    JSON.stringify({ initial, wheel, samples }, null, 2),
  );
  expect(
    Math.max(
      ...samples.growthDeliveries.map((sample) => sample.microtask.height),
    ),
  ).toBeGreaterThan(initial.height + 200);
  expect(samples.initialDeliveries.length).toBeGreaterThan(0);
  expect(
    samples.growthDeliveries.some((delivery) =>
      delivery.targets.some(
        (target) =>
          target.target === "latest-row" && target.height > initial.height + 200,
      ),
    ),
  ).toBe(true);
  expect(
    Math.max(
      ...samples.growthDeliveries.map(
        (sample) => sample.microtask.bottomDistance,
      ),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(
    page.getByText("正向滑动之后第11段，回复增高仍保持底部。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|interrupt)$|\/thread\/resume$/.test(call.path),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath("positive-wheel-before-paint.png"),
  });
  await saveResizeDiagnostics(page, info);
});

test("new mixed-size rows settle without first-frame overlap or blank seams during native wheel scrolling", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { fixture, errors, viewport } = await prepare(page, true);
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await viewport.evaluate((el) => {
    (window as any).__smoothFrames = [];
    let last = performance.now();
    const sample = (at: number) => {
      const frames = (window as any).__smoothFrames;
      const bounds = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll<HTMLElement>("[data-codex-row]")]
        .map((row) => ({
          index: Number(row.dataset.index),
          key: row.dataset.codexRow,
          top: row.getBoundingClientRect().top,
          bottom: row.getBoundingClientRect().bottom,
          height: row.getBoundingClientRect().height,
        }))
        .sort((a, b) => a.index - b.index);
      const seams = rows
        .slice(1)
        .map((row, index) => ({
          index: row.index,
          delta: row.top - rows[index].bottom,
          visible: row.top > bounds.top && row.top < bounds.bottom,
        }))
        .filter((seam) => seam.visible && Math.abs(seam.delta) > 2);
      frames.push({
        at,
        elapsed: at - last,
        top: el.scrollTop,
        seams,
        mounted: rows.length,
      });
      last = at;
      if (frames.length < 1000)
        (window as any).__smoothFrame = requestAnimationFrame(sample);
    };
    (window as any).__smoothFrame = requestAnimationFrame(sample);
  });
  // Actual wheel defaults, including normal wheel and fast reversals; no scrollTop teleport.
  for (const delta of [
    -280, -280, -700, -1200, -1200, 1100, -900, 1300, -1200, 900,
  ]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(55);
  }
  for (let step = 0; step < 20; step++) {
    await page.mouse.wheel(0, step < 10 ? -16 : 16);
    await page.waitForTimeout(18);
  }
  await page.waitForTimeout(200);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame((window as any).__smoothFrame);
    return (window as any).__smoothFrames;
  });
  const metrics = {
    frames: frames.length,
    seamFrames: frames.filter((f: any) => f.seams.length),
    maxFrameMs: Math.max(...frames.map((f: any) => f.elapsed)),
    mountedMax: Math.max(...frames.map((f: any) => f.mounted)),
  };
  await writeFile(
    info.outputPath("native-wheel-frame-metrics.json"),
    JSON.stringify({ metrics, frames }, null, 2),
  );
  await info.attach("native-wheel-frame-metrics", {
    path: info.outputPath("native-wheel-frame-metrics.json"),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("mixed-native-wheel.png") });
  expect(metrics.seamFrames).toHaveLength(0);
  expect(metrics.mountedMax).toBeLessThan(40);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|interrupt)$|\/thread\/resume$/.test(call.path),
    ),
  ).toEqual([]);
  await saveResizeDiagnostics(page, info);
});

test("an actual scrollbar thumb drag controls the reader instead of being pulled to latest", async ({
  page,
}, info) => {
  const { viewport, errors } = await prepare(page);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height / 2,
  );
  const thumb = page.locator('[data-slot="scroll-area-thumb"]').first();
  await expect(thumb).toBeVisible();
  const box = (await thumb.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 140, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const distance = await viewport.evaluate(
    (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
  );
  await writeFile(
    info.outputPath("scrollbar-drag.json"),
    JSON.stringify({ distance, thumb: box }),
  );
  await page.screenshot({ path: info.outputPath("scrollbar-drag.png") });
  expect(distance).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
});

test("a partially visible reading row grows below the reading point without a compensating jump", async ({
  page,
}, info) => {
  const { viewport, errors } = await prepare(page, true);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.wheel(0, -120);
  // WebKit may finish a native wheel on the next frame. Separate that input
  // movement from the subsequent size change; the anchor tolerance stays 2px.
  const wheelSettling = await viewport.evaluate(async (el) => {
    const samples: number[] = [];
    let stable = 0,
      previous = el.scrollTop;
    for (let frame = 0; frame < 60; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const top = el.scrollTop;
      samples.push(top);
      stable = Math.abs(top - previous) < 0.1 ? stable + 1 : 0;
      previous = top;
      if (stable >= 4) return samples;
    }
    throw new Error(
      "Native wheel did not settle before the independent row update",
    );
  });
  await writeFile(
    info.outputPath("partial-row-wheel-settling.json"),
    JSON.stringify(wheelSettling),
  );
  const anchor = await viewport.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>("[data-codex-row]")].find(
      (row) => row.getBoundingClientRect().bottom > top,
    )!;
    return {
      key: row.dataset.codexRow!,
      index: Number(row.dataset.index),
      offset: row.getBoundingClientRect().top - top,
    };
  });
  expect(anchor.index % 4).toBe(0);
  expect(anchor.offset).toBeLessThan(-10);
  const samples = await viewport.evaluate(async (el, anchor) => {
    const offsets: { offset: number; top: number }[] = [];
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: `smooth-turn-${anchor.index}`,
        item: {
          id: `smooth-item-${anchor.index}`,
          type: "agentMessage",
          phase: "final_answer",
          text: `长代码消息 ${anchor.index}\n\n\x60\x60\x60typescript\n${Array.from({ length: 90 }, (_, line) => `const value${line} = ${anchor.index} + ${line};`).join("\n")}\n\x60\x60\x60\n\n代码之后继续阅读 ${anchor.index}`,
        },
      },
    });
    for (let frame = 0; frame < 12; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const node = el.querySelector<HTMLElement>(
        `[data-codex-row="${anchor.key}"]`,
      )!;
      offsets.push({
        offset:
          node.getBoundingClientRect().top - el.getBoundingClientRect().top,
        top: el.scrollTop,
      });
    }
    return offsets;
  }, anchor);
  const metrics = {
    anchor,
    samples,
    maximumDrift: Math.max(
      ...samples.map((sample) => Math.abs(sample.offset - anchor.offset)),
    ),
  };
  await writeFile(
    info.outputPath("partial-reading-row.json"),
    JSON.stringify(metrics, null, 2),
  );
  await page.screenshot({ path: info.outputPath("partial-reading-row.png") });
  expect(metrics.maximumDrift).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
});

test("inline text editing navigation and consumed keys retain positive latest following", async ({
  page,
}, info) => {
  const { viewport, errors, fixture } = await prepare(page);
  await page.evaluate(() =>
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: "inline-smooth-turn",
        item: {
          id: "inline-smooth-user",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: "原生内联编辑\n保留此处输入",
              text_elements: [],
            },
          ],
        },
      },
    }),
  );
  const user = page.locator(
    '.codex-native-user[data-owner-turn="inline-smooth-turn"]',
  );
  await user.hover();
  await user.getByRole("button", { name: "编辑消息", exact: true }).click();
  const inline = page.getByRole("textbox", {
    name: "编辑上一条用户消息",
    exact: true,
  });
  await inline.fill("输入区方向键\nHome保留编辑草稿");
  const inlineBaseline = await inline.evaluate(async (el) => {
    const path = "/src/session-mode/features/thread-workflows/delivery.ts";
    const { useThreadWorkflowStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    return {
      dom: (el as HTMLElement).innerText,
      draft: JSON.stringify(useThreadWorkflowStore.getState().inlineEdits),
    };
  });
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  const samples: unknown[] = [];
  for (const key of ["ArrowUp", "Home"]) {
    await inline.press(key);
    await page.evaluate(
      (key) =>
        (window as any).__smoothStore.getState().addEvent("ux-0", {
          method: "item/agentMessage/delta",
          params: {
            threadId: "ux-0",
            turnId: "inline-live-turn",
            itemId: "inline-live-item",
            delta: `\n\n${key} 导航期间的实时回复。`,
          },
        }),
      key,
    );
    await expect(
      page.getByText(`${key} 导航期间的实时回复。`, { exact: true }),
    ).toBeVisible();
    await viewport.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(() =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    samples.push({
      key,
      bottomDistance: await viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    });
  }
  await viewport.evaluate((el) => {
    (el as HTMLElement).tabIndex = 0;
    el.addEventListener("keydown", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
  });
  await viewport.focus();
  await page.keyboard.press("Home");
  await page.evaluate(() =>
    (window as any).__smoothStore.getState().addEvent("ux-0", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "ux-0",
        turnId: "inline-live-turn",
        itemId: "inline-live-item",
        delta: "\n\n已处理的按键继续跟随新回复。",
      },
    }),
  );
  await expect(
    page.getByText("已处理的按键继续跟随新回复。", { exact: true }),
  ).toBeVisible();
  await viewport.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() => inline.evaluate((el) => (el as HTMLElement).innerText))
    .toBe(inlineBaseline.dom);
  const savedEdit = await page.evaluate(async () => {
    const path = "/src/session-mode/features/thread-workflows/delivery.ts";
    const { useThreadWorkflowStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
    );
    return JSON.stringify(useThreadWorkflowStore.getState().inlineEdits);
  });
  expect(savedEdit).toBe(inlineBaseline.draft);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|interrupt)$|\/thread\/(resume|rollback)$/.test(call.path),
    ),
  ).toEqual([]);
  await writeFile(
    info.outputPath("inline-key-following.json"),
    JSON.stringify({ inlineBaseline, samples }),
  );
  await page.screenshot({ path: info.outputPath("inline-key-following.png") });
});

test("a real turn lifecycle preserves process reading and a restored expanded header collapses on its first click", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const { viewport, fixture, errors } = await prepare(page);
  const turnId = "lifecycle-smooth-turn";
  const processKey = `event-${turnId}-lifecycle-process`;
  const startedAt = Math.floor(Date.now() / 1_000) - 5;
  const process = {
    type: "agentMessage",
    id: "lifecycle-process",
    phase: "commentary",
    memoryCitation: null,
    text: `正在阅读本轮过程\n\n\x60\x60\x60typescript\n${Array.from({ length: 80 }, (_, line) => `const lifecycle${line} = ${line};`).join("\n")}\n\x60\x60\x60`,
  };
  const report = {
    type: "agentMessage",
    id: "lifecycle-report",
    phase: "final_answer",
    memoryCitation: null,
    text: `本轮最终报告\n\n\x60\x60\x60typescript\n${Array.from({ length: 60 }, (_, line) => `const report${line} = ${line};`).join("\n")}\n\x60\x60\x60`,
  };
  const turn = {
    id: turnId,
    status: "inProgress",
    items: [],
    itemsView: "full",
    error: null,
    startedAt,
    completedAt: null,
    durationMs: null,
  };
  await page.evaluate(
    ({ turn, process }) => {
      const store = (window as any).__smoothStore;
      store.getState().addEvent("ux-0", {
        method: "turn/started",
        params: { threadId: "ux-0", turn },
      });
      store.getState().addEvent("ux-0", {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: turn.id,
          completedAtMs: Date.now(),
          item: process,
        },
      });
    },
    { turn, process },
  );
  const header = page.locator(`[data-turn-work="${turnId}"]`);
  await expect(header).toHaveAttribute("data-running", "true");
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  const bounds = (await viewport.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.wheel(0, -260);
  // Persist actual native-wheel reading before completing the turn. Both
  // engines must settle before measuring the independent lifecycle update.
  const anchor = await viewport.evaluate(async (el, processKey) => {
    let previous = el.scrollTop,
      stable = 0;
    for (let frame = 0; frame < 60; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const top = el.scrollTop;
      stable = Math.abs(top - previous) < 0.1 ? stable + 1 : 0;
      previous = top;
      if (stable >= 4) break;
      if (frame === 59) throw new Error("Lifecycle wheel did not settle");
    }
    const node = el.querySelector<HTMLElement>(
      `[data-codex-row="${processKey}"]`,
    );
    if (!node) throw new Error("Expected the running process to be mounted");
    return {
      key: processKey,
      offset: node.getBoundingClientRect().top - el.getBoundingClientRect().top,
      scrollTop: el.scrollTop,
    };
  }, processKey);
  expect(anchor.offset).toBeLessThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("kanban.session.read-position.codex:ux-0") ??
              "null",
          )?.anchor,
      ),
    )
    .toBe(processKey);
  const completed = {
    ...turn,
    status: "completed",
    completedAt: startedAt + 5,
    durationMs: 5_000,
    items: [process, report],
  };
  const samples = await viewport.evaluate(
    async (el, { completed, report, anchor }) => {
      const store = (window as any).__smoothStore;
      store.getState().addEvent("ux-0", {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: completed.id,
          item: report,
          completedAtMs: Date.now(),
        },
      });
      store.getState().addEvent("ux-0", {
        method: "turn/completed",
        params: { threadId: "ux-0", turn: completed },
      });
      const offsets: Array<{ offset: number; scrollTop: number }> = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const node = el.querySelector<HTMLElement>(
          `[data-codex-row="${anchor.key}"]`,
        );
        if (!node)
          throw new Error("Turn completion removed the process reading anchor");
        offsets.push({
          offset:
            node.getBoundingClientRect().top - el.getBoundingClientRect().top,
          scrollTop: el.scrollTop,
        });
      }
      return offsets;
    },
    { completed, report, anchor },
  );
  const maximumDrift = Math.max(
    ...samples.map((sample) => Math.abs(sample.offset - anchor.offset)),
  );
  expect(maximumDrift).toBeLessThanOrEqual(2);
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const beforeReloadResizeErrors = await page.evaluate(
    () => (window as any).__resizeObserverReceipts.errors,
  );
  expect(beforeReloadResizeErrors).toEqual([]);

  // Cold restore has no in-memory openedWork set. A valid process anchor can
  // request its row below the viewport edge; leave the header visible so the
  // first real pointer click tests the restored disclosure without scrolling.
  // Native reload must carry its own preceding history. In a genuinely cold
  // cache the process cannot restore 120px below the viewport if its turn is
  // the first content: scrollTop would need to be negative.
  const priorCompleted = {
    ...completed,
    id: "lifecycle-prior-turn",
    startedAt: startedAt - 10,
    completedAt: startedAt - 9,
    durationMs: 1_000,
    items: [
      {
        ...report,
        id: "lifecycle-prior-report",
        text: `前一轮真实报告\n\n\x60\x60\x60typescript\n${Array.from({ length: 40 }, (_, line) => `const prior${line} = ${line};`).join("\n")}\n\x60\x60\x60`,
      },
    ],
  };
  Object.assign(fixture.threads[0], { turns: [priorCompleted, completed] });
  await page.evaluate(
    async ({ anchor }) => {
      const path = "/src/session-mode/services/sessionTranscriptCache.ts";
      const { saveReadingPosition } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      saveReadingPosition("codex:ux-0", {
        atBottom: false,
        anchor: anchor.key,
        offset: -120,
        scrollTop: anchor.scrollTop,
        format: "row",
      });
    },
    { anchor },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const restoredOffset = () =>
    viewport.evaluate((el, key) => {
      const node = el.querySelector(`[data-codex-row="${key}"]`);
      return node
        ? node.getBoundingClientRect().top - el.getBoundingClientRect().top
        : null;
    }, processKey);
  await expect
    .poll(async () => Math.abs(((await restoredOffset()) ?? Infinity) - 120))
    .toBeLessThanOrEqual(2);
  const headerOffset = () =>
    header.evaluate((el) => {
      const viewport = el.closest('[data-slot="scroll-area-viewport"]')!;
      return (
        el.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      );
    });
  const headerBefore = await headerOffset();
  expect(headerBefore).toBeGreaterThan(0);
  expect(headerBefore).toBeLessThan(120);
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(
    viewport.locator(`[data-codex-row="${processKey}"]`),
  ).toHaveCount(0);
  await expect
    .poll(async () => Math.abs((await headerOffset()) - headerBefore))
    .toBeLessThanOrEqual(2);
  await expect(page.getByText("本轮最终报告", { exact: true })).toBeVisible();
  await expect(
    page.locator(".session-codex-composer [contenteditable=true]").first(),
  ).toHaveText("平滑滚动的会话草稿");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as any).__resizeObserverReceipts.errors),
  ).toEqual([]);
  expect(
    fixture.calls.filter((call) =>
      /\/turn\/(start|interrupt)$|\/thread\/(resume|rollback)$/.test(call.path),
    ),
  ).toEqual([]);
  await writeFile(
    info.outputPath("turn-lifecycle-reading.json"),
    JSON.stringify(
      {
        anchor,
        samples,
        maximumDrift,
        restoredProcessOffset: 120,
        headerBefore,
        headerAfter: await headerOffset(),
        beforeReloadResizeErrors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: info.outputPath("turn-lifecycle-reading.png"),
  });
  await saveResizeDiagnostics(page, info);
});
