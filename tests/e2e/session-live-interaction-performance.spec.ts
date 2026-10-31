import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const INTERACTION_CYCLES = Number(
  process.env.SESSION_INTERACTION_CYCLES ?? 500,
);
if (
  !Number.isInteger(INTERACTION_CYCLES) ||
  INTERACTION_CYCLES < 500 ||
  INTERACTION_CYCLES > 6000
)
  throw new Error(
    "SESSION_INTERACTION_CYCLES must be an integer from 500 to 6000",
  );

// A long real conversation has user prompts as well as assistant replies. The
// old assistant-only history benchmark did not exercise prompt navigation.
test("typing and tab clicks stay responsive during mixed output over a long conversation with user prompts", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(INTERACTION_CYCLES * 100 + 180_000);
  const fixture = await installSessionUxFixture(page, 2);
  if (INTERACTION_CYCLES > 500) {
    // Real history survives offscreen-body expiry. Native lists carry metadata
    // only; reactivation reads durable turns instead of an artificially empty
    // thread that would make an aged-input test progressively easier.
    for (const thread of fixture.threads)
      (thread as any).turns = [
        ...Array.from({ length: 600 }, (_, index) => ({
          id: `history-${index}`,
          status: "completed",
          startedAt: index + 1,
          durationMs: 1,
          error: null,
          items: [
            {
              type: "userMessage",
              id: `user-${index}`,
              clientId: null,
              content: [
                {
                  type: "text",
                  text: `Task ${index}: inspect the implementation and verify the changes.`,
                  text_elements: [],
                },
              ],
            },
            {
              type: "agentMessage",
              id: `comment-${index}`,
              text: `Checking task ${index}.`,
              phase: "commentary",
              memoryCitation: null,
            },
            {
              type: "agentMessage",
              id: `answer-${index}`,
              text: `Completed task ${index}. **Verified** with a small report.`,
              phase: "final_answer",
              memoryCitation: null,
            },
          ],
        })),
        {
          id: `busy-${thread.id}`,
          status: "inProgress",
          items: [],
          startedAt: Math.floor(Date.now() / 1000),
          durationMs: null,
          error: null,
        },
      ];
  }
  await page.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        data: fixture.threads.map((thread) => ({ ...thread, turns: [] })),
        nextCursor: null,
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const metrics = {
      keys: [] as number[],
      keyInputDelays: [] as number[],
      keyTotalMs: [] as number[],
      clicks: [] as Array<{
        kind: string;
        queueMs: number;
        frameMs?: number;
        selectedMs?: number;
        composerMs?: number;
        draftMs?: number;
      }>,
      longTasks: [] as { start: number; duration: number }[],
    };
    (window as any).__interactionMetrics = metrics;
    (window as any).__expectedInteractionDrafts = { "ux-0": "", "ux-1": "" };
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element;
        const tab = target.closest<HTMLElement>("[role=tab][data-tab-key]");
        if (!tab && !target.closest("[contenteditable=true]")) return;
        const at = performance.now();
        const measurement: (typeof metrics.clicks)[number] = {
          kind: tab ? "tab" : "composer",
          queueMs: Math.max(0, at - event.timeStamp),
        };
        metrics.clicks.push(measurement);
        requestAnimationFrame(() => {
          measurement.frameMs = performance.now() - at;
        });
        if (!tab) return;
        const threadId = tab.dataset.tabKey!.slice("codex:".length);
        const update = () => {
          if (
            measurement.selectedMs === undefined &&
            tab.getAttribute("aria-selected") === "true"
          )
            measurement.selectedMs = performance.now() - at;
          const form = document.querySelector<HTMLElement>(
            ".session-codex-composer",
          );
          if (form?.dataset.ownerThread === threadId) {
            if (measurement.composerMs === undefined)
              measurement.composerMs = performance.now() - at;
            if (
              form.querySelector("[contenteditable=true]")?.textContent ===
              (window as any).__expectedInteractionDrafts[threadId]
            )
              measurement.draftMs = performance.now() - at;
          }
          if (
            measurement.draftMs !== undefined &&
            measurement.selectedMs !== undefined
          ) {
            observer.disconnect();
            clearTimeout(timeout);
          }
        };
        const observer = new MutationObserver(update);
        const timeout = setTimeout(() => observer.disconnect(), 5000);
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["aria-selected", "data-owner-thread"],
          characterData: true,
          childList: true,
          subtree: true,
        });
        update();
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if (!(event.target as Element)?.closest("[contenteditable=true]")) return;
      const start = performance.now();
      metrics.keyInputDelays.push(Math.max(0, start - event.timeStamp));
      requestAnimationFrame(() => {
        if (metrics.keys.length < 2048) {
          metrics.keys.push(performance.now() - start);
          metrics.keyTotalMs.push(
            Math.max(0, performance.now() - event.timeStamp),
          );
        }
      });
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
        });
        if (metrics.longTasks.length > 256) metrics.longTasks.shift();
      }
    }).observe({ type: "longtask", buffered: false });
  });
  const stream = await liveStream(page, baseURL!);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let sequence = 0,
    cycle = 0,
    menuCycles = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  const operations: { kind: string; ms: number }[] = [];
  const samples: any[] = [];
  let cpu: unknown;
  const cdp = await page.context().newCDPSession(page);
  const global = await browser.newBrowserCDPSession();
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await expect(editor).toBeVisible({ timeout: 45_000 });
    await seedSessionUx(page, 2);
    for (const thread of fixture.threads)
      (thread as any).status = { type: "active", activeFlags: [] };
    await page.evaluate(async () => {
      const load = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
      const [
        { useCodexStore },
        { useAgentCenterStore },
        { useSessionSplitStore },
      ] = await Promise.all([
        load("/src/session-mode/components/codex/stores/index.ts"),
        load("/src/session-mode/stores/useAgentCenterStore.ts"),
        load("/src/session-mode/stores/useSessionSplitStore.ts"),
      ]);
      const events: Record<string, any[]> = {};
      for (const id of ["ux-0", "ux-1"])
        events[id] = Array.from({ length: 600 }, (_, index) => [
          {
            method: "item/completed",
            params: {
              threadId: id,
              turnId: `history-${index}`,
              item: {
                type: "userMessage",
                id: `user-${index}`,
                content: [
                  {
                    type: "text",
                    text: `Task ${index}: inspect the implementation and verify the changes.`,
                    text_elements: [],
                  },
                ],
                clientId: null,
              },
            },
          },
          {
            method: "item/completed",
            params: {
              threadId: id,
              turnId: `history-${index}`,
              item: {
                type: "agentMessage",
                id: `comment-${index}`,
                text: `Checking task ${index}.`,
                phase: "commentary",
                memoryCitation: null,
              },
            },
          },
          {
            method: "item/completed",
            params: {
              threadId: id,
              turnId: `history-${index}`,
              item: {
                type: "agentMessage",
                id: `answer-${index}`,
                text: `Completed task ${index}. **Verified** with a small report.`,
                phase: "final_answer",
                memoryCitation: null,
              },
            },
          },
        ]).flat();
      useCodexStore.setState({
        events,
        historyLoadedMap: { "ux-0": true, "ux-1": true },
        currentThreadId: "ux-0",
      });
      for (const id of ["ux-0", "ux-1"])
        useAgentCenterStore.getState().addAgentCard({
          kind: "codex",
          id,
          cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
          preview: id,
        });
      useAgentCenterStore.getState().setCurrentAgentCardId("ux-0", "codex");
      useSessionSplitStore.getState().focusKey("codex:ux-0");
      (window as any).__interactionStore = useCodexStore;
    });
    await expect(
      page.locator('[data-codex-transcript-shell="ux-0"]'),
    ).toBeVisible();
    await expect.poll(() => stream.connections()).toBeGreaterThan(0);
    // Warm the long history and active stream before collecting input timings.
    for (const id of ["ux-0", "ux-1"])
      stream.emit(++sequence, {
        method: "turn/started",
        params: {
          threadId: id,
          turn: {
            id: `busy-${id}`,
            status: "inProgress",
            items: [],
            startedAt: Math.floor(Date.now() / 1000),
            durationMs: null,
          },
        },
      });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      (window as any).__interactionMetrics.keys = [];
      (window as any).__interactionMetrics.keyInputDelays = [];
      (window as any).__interactionMetrics.keyTotalMs = [];
      (window as any).__interactionMetrics.clicks = [];
      (window as any).__interactionMetrics.longTasks = [];
    });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    const takeSample = async () =>
      samples.push({
        ...(await cdp.send("Runtime.getHeapUsage")),
        ...sampleRendererRss(
          (await global.send("SystemInfo.getProcessInfo")).processInfo,
        ),
        railMarkers: await page
          .locator(".codex-thread-user-rail button")
          .count(),
      });
    await takeSample();
    interval = setInterval(() => {
      if (cycle >= INTERACTION_CYCLES) return;
      for (const id of ["ux-0", "ux-1"]) {
        for (const method of [
          "item/reasoning/summaryTextDelta",
          "item/agentMessage/delta",
        ])
          stream.emit(++sequence, {
            method,
            params: {
              threadId: id,
              turnId: `busy-${id}`,
              itemId: method.includes("reasoning")
                ? `summary-${id}`
                : `live-${id}`,
              summaryIndex: 0,
              delta: `${cycle}: checking progress. `,
            },
          });
      }
      if (INTERACTION_CYCLES > 500 && cycle % 20 === 0) {
        for (const thread of fixture.threads) {
          const item = {
            type: "commandExecution",
            id: `command-${thread.id}-${cycle}`,
            command: "inspect fixture",
            commandActions: [],
            cwd: thread.cwd,
            source: "agent",
            processId: null,
            pluginId: null,
            scriptPath: null,
            status: "inProgress",
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          };
          stream.emit(++sequence, {
            method: "item/started",
            params: { threadId: thread.id, turnId: `busy-${thread.id}`, item },
          });
          const completed = {
            ...item,
            status: "completed",
            exitCode: 0,
            durationMs: 1,
          };
          stream.emit(++sequence, {
            method: "item/completed",
            params: {
              threadId: thread.id,
              turnId: `busy-${thread.id}`,
              item: completed,
            },
          });
          (thread as any).turns.at(-1).items.push(completed);
          thread.updatedAt = Math.floor(Date.now() / 1000);
        }
      }
      cycle++;
    }, 100);
    const drafts = ["", ""];
    let active = 0;
    const started = Date.now();
    for (let round = 0; round < 20; round++) {
      // The optional real-time soak spreads the same interactions across its
      // full age, rather than typing only at startup then waiting passively.
      if (INTERACTION_CYCLES > 500)
        await expect
          .poll(() => cycle, { timeout: INTERACTION_CYCLES * 100 + 30_000 })
          .toBeGreaterThanOrEqual(
            Math.floor((round * INTERACTION_CYCLES) / 20),
          );
      let at = Date.now();
      // Dispatch a real pointer immediately like the user. Playwright's default
      // two-frame stability wait over a live page is recorded separately by
      // the earlier diagnostic; focus/owner/real click counts remain asserted.
      await editor.click({ timeout: 5000, force: true });
      await expect(editor).toBeFocused();
      operations.push({ kind: "click-composer", ms: Date.now() - at });
      const addition = `round${round} `;
      at = Date.now();
      await editor.pressSequentially(addition, { delay: 15, timeout: 5000 });
      drafts[active] += addition;
      await expect(editor).toHaveText(drafts[active], { timeout: 5000 });
      operations.push({ kind: "type", ms: Date.now() - at });
      await page.evaluate(
        ([id, draft]) => {
          (window as any).__expectedInteractionDrafts[id] = draft;
        },
        [`ux-${active}`, drafts[active]],
      );
      if (INTERACTION_CYCLES > 500 && round % 5 === 4) {
        const attach = page.getByRole("button", {
          name: "附加文件",
          exact: true,
        });
        await attach.click({ timeout: 5000 });
        await expect(attach).toHaveAttribute("aria-expanded", "true");
        const conversation = page.getByRole("button", {
          name: "当前会话的更多操作",
          exact: true,
        });
        await conversation.click({ timeout: 5000 });
        await expect(page.getByRole("menu")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(attach).toHaveAttribute("aria-expanded", "false");
        expect(
          await page.evaluate(
            () => getComputedStyle(document.body).pointerEvents,
          ),
        ).not.toBe("none");
        await editor.click({ timeout: 5000 });
        await expect(editor).toBeFocused();
        await expect(editor).toHaveText(drafts[active]);
        menuCycles++;
      }
      if (round % 4 === 3) {
        active = 1 - active;
        at = Date.now();
        const tab = page.locator(
          `[role=tab][data-tab-key="codex:ux-${active}"]`,
        );
        await tab.click({ timeout: 5000, force: true });
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(editor).toHaveText(drafts[active], { timeout: 5000 });
        operations.push({ kind: "switch-tab", ms: Date.now() - at });
      }
      if (round % 4 === 3 || INTERACTION_CYCLES > 500) await takeSample();
      if (INTERACTION_CYCLES > 500) {
        const progress = {
          round,
          cycles: cycle,
          menuCycles,
          operations,
          sample: samples.at(-1),
          errors,
        };
        await writeFile(
          info.outputPath("progress.json"),
          JSON.stringify(progress, null, 2),
        );
        console.log(
          JSON.stringify({
            phase: "aged-live-interaction",
            round,
            cycles: cycle,
            menuCycles,
            heapBytes: progress.sample.usedSize,
            rendererRssBytes: progress.sample.rendererRssBytes,
          }),
        );
      }
      await page.waitForTimeout(500);
    }
    await expect
      .poll(() => cycle, { timeout: INTERACTION_CYCLES * 100 + 30_000 })
      .toBe(INTERACTION_CYCLES);
    await expect
      .poll(
        () =>
          page.evaluate((lastCycle) => {
            const state = (window as any).__interactionStore.getState();
            const message = state.streamingAgentMessages[state.currentThreadId];
            const tail = message?.preview
              ? `${message.preview.tail.at(-1) ?? ""}${message.preview.tailCurrent}`
              : `${message?.segments.at(-1) ?? ""}${message?.current ?? ""}`;
            return tail.endsWith(`${lastCycle}: checking progress. `);
          }, INTERACTION_CYCLES - 1),
        { timeout: 5000 },
      )
      .toBe(true);
    await takeSample();
    clearInterval(interval);
    interval = undefined;
    const durationSeconds = (Date.now() - started) / 1000;
    cpu = (await cdp.send("Profiler.stop")).profile;
    const metrics = await page.evaluate(
      () => (window as any).__interactionMetrics,
    );
    const sorted = [...metrics.keys].sort((a, b) => a - b);
    const result = {
      durationSeconds,
      workloadCycles: INTERACTION_CYCLES,
      menuCycles,
      samplingScope:
        "natural GC; all renderers in this owned browser; no reload or task dispatch",
      cycles: cycle,
      emitted: sequence,
      operations,
      keySamples: sorted.length,
      p95KeyFrameMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maximumKeyFrameMs: sorted.at(-1),
      keyInputDelays: metrics.keyInputDelays,
      keyTotalMs: metrics.keyTotalMs,
      clicks: metrics.clicks,
      longTasks: metrics.longTasks,
      errors,
      samples,
    };
    const path = info.outputPath("live-interaction.json");
    await writeFile(path, JSON.stringify(result, null, 2));
    await info.attach("live-interaction", {
      path,
      contentType: "application/json",
    });
    await writeFile(
      info.outputPath("interaction.cpuprofile"),
      JSON.stringify(cpu),
    );
    expect(sorted.length).toBeGreaterThan(100);
    expect(result.p95KeyFrameMs).toBeLessThan(100);
    expect(result.maximumKeyFrameMs).toBeLessThan(250);
    expect(Math.max(...metrics.keyTotalMs)).toBeLessThan(250);
    expect(
      metrics.clicks.filter((click: any) => click.kind === "tab"),
    ).toHaveLength(5);
    expect(
      metrics.clicks.filter((click: any) => click.kind === "composer"),
    ).toHaveLength(20 + menuCycles);
    expect(
      Math.max(...samples.map((sample) => sample.railMarkers)),
    ).toBeLessThanOrEqual(100);
    expect(
      operations.filter((op) => op.kind !== "type").every((op) => op.ms < 500),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(
      fixture.calls.filter((call) =>
        /thread\/resume|turn\/(start|interrupt)|followups\/(submit|stop)/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath("partial-operations.json"),
      JSON.stringify(
        { cycles: cycle, emitted: sequence, operations, samples, errors },
        null,
        2,
      ),
    );
    if (interval) clearInterval(interval);
    await stream.close();
    await cdp.detach();
    await global.detach();
  }
});
