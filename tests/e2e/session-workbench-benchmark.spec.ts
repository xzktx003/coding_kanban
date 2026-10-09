import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

for (const count of [100, 1000, 10000]) {
  test(`${count} messages and 30 followed sessions preserve responsive input and complete history`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let requests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/")) requests++;
    });
    await installSessionUxFixture(page, 30);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=session");
    await seedSessionUx(page, 0);
    await page.evaluate(async (count) => {
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (e) =>
              new URL(e.name).pathname ===
              "/src/session-mode/components/codex/stores/index.ts",
          )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
      );
      const { useAgentCenterStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (e) =>
              new URL(e.name).pathname ===
              "/src/session-mode/stores/useAgentCenterStore.ts",
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      const { useSessionSplitStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (e) =>
              new URL(e.name).pathname ===
              "/src/session-mode/stores/useSessionSplitStore.ts",
          )?.name ?? "/src/session-mode/stores/useSessionSplitStore.ts"
      );
      const state = window as any;
      state.benchmarkTasks = [];
      state.benchmarkInput = [];
      state.benchmarkObserver = new PerformanceObserver((list) => {
        state.benchmarkTasks.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      });
      state.benchmarkObserver.observe({ type: "longtask", buffered: false });
      const ids = Array.from({ length: 30 }, (_, i) => `benchmark-${i}`);
      const events = Object.fromEntries(
        ids.map((id, index) => [
          id,
          Array.from({ length: index === 0 ? count : 1 }, (_, i) => ({
            method: "item/completed",
            params: {
              threadId: id,
              turnId: `turn-${i}`,
              item: {
                id: `message-${i}`,
                type: "agentMessage",
                text: `基准消息 ${i}\n\n**检查结果**\n\n- 保留完整历史\n- 后台更新不改写输入\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``,
              },
            },
          })),
        ]),
      );
      useCodexStore.setState({
        events,
        historyLoadedMap: Object.fromEntries(ids.map((id) => [id, true])),
      });
      for (const id of ids)
        useAgentCenterStore
          .getState()
          .addAgentCard({
            kind: "codex",
            id,
            cwd: "/fixture/benchmark",
            preview: id,
          });
      state.benchmarkSelect = (id: string) => {
        useCodexStore.setState({ currentThreadId: id });
        useAgentCenterStore.getState().setCurrentAgentCardId(id, "codex");
        useSessionSplitStore.getState().focusKey(`codex:${id}`);
      };
      state.benchmarkSelect("benchmark-1");
      document.addEventListener("keydown", (event) => {
        if (!(event.target as Element)?.closest("[contenteditable=true]"))
          return;
        const start = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            state.benchmarkInput.push(performance.now() - start),
          ),
        );
      });
    }, count);
    await expect(page.getByText("基准消息 0", { exact: true })).toBeVisible();
    const profiler =
      process.env.SESSION_BENCHMARK_PROFILE === "1"
        ? await page.context().newCDPSession(page)
        : null;
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }
    const switches = await page.evaluate(async (count) => {
      const state = window as any;
      const samples: number[] = [];
      for (let trial = 0; trial < 6; trial++) {
        state.benchmarkSelect("benchmark-1");
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        const start = performance.now();
        state.benchmarkSelect("benchmark-0");
        let visible = false;
        while (performance.now() - start < 10000) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const row = document.querySelector(
            `[data-codex-row="event-turn-${count - 1}-message-${count - 1}"]`,
          );
          const viewport = row?.closest('[data-slot="scroll-area-viewport"]');
          if (!row || !viewport) continue;
          const r = row.getBoundingClientRect(),
            v = viewport.getBoundingClientRect();
          if (r.top < v.bottom && r.bottom > v.top) {
            visible = true;
            break;
          }
        }
        if (!visible)
          throw new Error("Complete history never reached the viewport");
        samples.push(performance.now() - start);
      }
      return samples;
    }, count);
    await expect(
      page.getByText(`基准消息 ${count - 1}`, { exact: true }),
    ).toBeVisible();
    const editor = page.locator(".session-mode [contenteditable=true]").first();
    await editor.pressSequentially("benchmark draft", { delay: 20 });
    const backgroundMs = await page.evaluate(async () => {
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast(
            (e) =>
              new URL(e.name).pathname ===
              "/src/session-mode/components/codex/stores/index.ts",
          )?.name ?? "/src/session-mode/components/codex/stores/index.ts"
      );
      const start = performance.now();
      for (let i = 1; i < 30; i++)
        useCodexStore.getState().addEvent(`benchmark-${i}`, {
          method: "item/agentMessage/delta",
          params: {
            threadId: `benchmark-${i}`,
            turnId: "live",
            itemId: "live",
            delta: "后台更新",
          },
        });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return performance.now() - start;
    });
    await expect(editor).toHaveText("benchmark draft");
    const metrics = await page.evaluate(() => {
      const state = window as any;
      state.benchmarkObserver.disconnect();
      return {
        inputFrames: state.benchmarkInput as number[],
        longTasks: state.benchmarkTasks as number[],
        mountedRows: document.querySelectorAll("[data-codex-row]").length,
        mountedElements: document
          .querySelector(".thread-surface")
          ?.querySelectorAll("*").length,
        heapBytes: (performance as any).memory?.usedJSHeapSize ?? null,
        resourceRequests: performance.getEntriesByType("resource").length,
      };
    });
    const p95 = (samples: number[]) =>
      [...samples].sort((a, b) => a - b)[
        Math.ceil(samples.length * 0.95) - 1
      ] ?? 0;
    const result = {
      messages: count,
      followedSessions: 30,
      firstSwitchMs: switches[0],
      warmSwitchP95Ms: p95(switches.slice(1)),
      inputToTwoFramesP95Ms: p95(metrics.inputFrames),
      backgroundMs,
      apiRequests: requests,
      ...metrics,
    };
    await mkdir(".dev-runtime/session-opt", { recursive: true });
    if (profiler) {
      const profile = await profiler.send("Profiler.stop");
      await writeFile(
        `.dev-runtime/session-opt/cpu-profile-${count}.json`,
        JSON.stringify(profile),
      );
      await profiler.detach();
    }
    await writeFile(
      `.dev-runtime/session-opt/benchmark-${process.env.SESSION_BENCHMARK_PHASE ?? "current"}-${count}.json`,
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    expect(metrics.mountedRows).toBeLessThan(30);
    expect(metrics.mountedElements).toBeLessThan(2000);
    expect(result.warmSwitchP95Ms).toBeLessThan(750);
    expect(result.inputToTwoFramesP95Ms).toBeLessThan(200);
    expect(errors).toEqual([]);
  });
}
