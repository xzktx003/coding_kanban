import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("active visible Codex history reaches a bounded plateau and older turns remain pageable", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const url = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      url("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      url("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { releaseSessionMemory } = await import(
      url("/src/session-mode/services/sessionMemoryGovernor.ts")
    );
    const { estimateTranscriptBytes } = await import(
      url("/src/session-mode/services/codexTranscriptMemoryBudget.ts")
    );
    const w = window as any;
    w.__budgetStore = useCodexStore;
    w.__releaseBudget = releaseSessionMemory;
    w.__budgetSize = estimateTranscriptBytes;
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id: "ux-0" }],
      detachedCard: null,
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      events: {},
      historyLoadedMap: { "ux-0": true },
    });
  });
  const cdp = await context.newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const before = await heap();
  const metrics: number[] = [];
  for (let batch = 0; batch < 5; batch++) {
    await page.evaluate((batch) => {
      const w = window as any;
      for (let i = 0; i < 30; i++) {
        const id = `memory-${batch}-${i}`;
        // JSON parsing materializes distinct strings instead of shared repeat ropes.
        const event = JSON.parse(
          JSON.stringify({
            method: "item/completed",
            params: {
              threadId: "ux-0",
              turnId: id,
              item: {
                id,
                type: "agentMessage",
                text: `${id}:` + "x".repeat(160000),
              },
            },
          }),
        );
        w.__budgetStore.getState().addEvent("ux-0", event);
        w.__budgetStore.getState().addEvent("ux-0", {
          method: "turn/completed",
          params: {
            threadId: "ux-0",
            turn: {
              id,
              status: "completed",
              items: [],
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
              error: null,
            },
          },
        });
      }
      w.__releaseBudget();
    }, batch);
    await page.waitForTimeout(300);
    metrics.push(await heap());
    expect(
      await page.evaluate(() =>
        (window as any).__budgetSize(
          (window as any).__budgetStore.getState().events["ux-0"],
        ),
      ),
    ).toBeLessThan(8 * 1024 * 1024);
  }
  expect(
    Math.max(...metrics.slice(2)) - Math.min(...metrics.slice(2)),
  ).toBeLessThan(15 * 1024 * 1024);
  const result = await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionSyncStore.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useSessionSyncStore } = await import(url);
    return {
      cursor: useSessionSyncStore.getState().cursors["ux-0"],
      events: (window as any).__budgetStore.getState().events["ux-0"].length,
    };
  });
  expect(result.cursor).toMatch(/^kanban-memory-reload:/);
  expect(result.events).toBeLessThan(60);
  const recovered: string[] = [];
  await page.route("**/api/codex/thread/turns/list", async (route) => {
    const body = route.request().postDataJSON();
    const ids = Array.from(
      { length: 150 },
      (_, i) => `memory-${Math.floor(i / 30)}-${i % 30}`,
    ).reverse();
    const start = body.cursor ? Number(String(body.cursor).split(":")[1]) : 0;
    const data = ids.slice(start, start + 10).map((id) => ({
      id,
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
      error: null,
      items:
        body.itemsView === "full"
          ? [{ id, type: "agentMessage", text: `已重新读取 ${id}` }]
          : [],
    }));
    if (body.itemsView === "full")
      recovered.push(...data.map((turn) => turn.id));
    await route.fulfill({
      json: {
        data,
        nextCursor: start + 10 < ids.length ? `native:${start + 10}` : null,
      },
    });
  });
  await page.evaluate(async () => {
    const path = "/src/session-mode/services/codexService.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { codexService } = await import(url);
    await codexService.loadEarlierHistory("ux-0");
  });
  expect(recovered.length).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      (window as any).__budgetStore
        .getState()
        .events[
          "ux-0"
        ].some((event: any) => event.params.item?.text?.startsWith("已重新读取")),
    ),
  ).toBe(true);
  console.log(
    JSON.stringify({
      before,
      samples: metrics,
      retainedEvents: result.events,
      recoveredTurns: recovered.length,
    }),
  );
});

test("one running turn can release old completed tools while keeping its live command and answer", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const url = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      url("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      url("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { releaseSessionMemory } = await import(
      url("/src/session-mode/services/sessionMemoryGovernor.ts")
    );
    const { useSessionSyncStore } = await import(
      url("/src/session-mode/stores/useSessionSyncStore.ts")
    );
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id: "ux-0" }],
      detachedCard: null,
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      currentTurnId: "running",
      events: { "ux-0": [] },
      historyLoadedMap: { "ux-0": true },
      turnTimingMap: {
        "ux-0": {
          turnId: "running",
          status: "inProgress",
          startedAtMs: 1,
          durationMs: null,
        },
      },
    });
    for (let i = 0; i < 500; i++) {
      useCodexStore.getState().addEvent("ux-0", {
        method: "item/started",
        params: {
          threadId: "ux-0",
          turnId: "running",
          item: {
            id: `tool-${i}`,
            type: "commandExecution",
            command: "echo result",
            commandActions: [],
            status: "inProgress",
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
            cwd: "/fixture",
            source: "agent",
            processId: null,
            pluginId: null,
            scriptPath: null,
          },
        },
      });
      useCodexStore.getState().addEvent(
        "ux-0",
        JSON.parse(
          JSON.stringify({
            method: "item/completed",
            params: {
              threadId: "ux-0",
              turnId: "running",
              item: {
                id: `tool-${i}`,
                type: "commandExecution",
                command: "echo result",
                commandActions: [],
                status: "completed",
                aggregatedOutput: `${i}:` + "x".repeat(100000),
                exitCode: 0,
                durationMs: 1,
              },
            },
          }),
        ),
      );
    }
    useCodexStore.getState().addEvent("ux-0", {
      method: "item/started",
      params: {
        threadId: "ux-0",
        turnId: "running",
        item: {
          id: "live-command",
          type: "commandExecution",
          command: "current",
          commandActions: [],
          status: "inProgress",
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
          cwd: "/fixture",
          source: "agent",
          processId: null,
          pluginId: null,
          scriptPath: null,
        },
      },
    });
    useCodexStore.getState().addEvent("ux-0", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "ux-0",
        turnId: "running",
        itemId: "answer",
        delta: "仍在处理当前任务",
      },
    });
    const memory = releaseSessionMemory();
    const state = useCodexStore.getState();
    return {
      bytes: memory.afterBytes,
      count: state.events["ux-0"].length,
      current: state.currentTurnId,
      status: state.turnTimingMap["ux-0"].status,
      command: state.events["ux-0"].some(
        (e: any) => e.params.item?.id === "live-command",
      ),
      answer: state.events["ux-0"].some(
        (e: any) => e.params.delta === "仍在处理当前任务",
      ),
      cursor: useSessionSyncStore.getState().cursors["ux-0"],
    };
  });
  expect(result.bytes).toBeLessThan(4 * 1024 * 1024);
  expect(result.count).toBeLessThan(100);
  expect(result).toMatchObject({
    current: "running",
    status: "inProgress",
    command: true,
    answer: true,
  });
  expect(result.cursor).toMatch(/^kanban-memory-items:/);
});

test("real tool lifecycles stay bounded through automatic recovery and cache writes without forced GC", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await installSessionUxFixture(page, 1);
  await page.goto("/?mode=session", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const url = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      url("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      url("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { estimateTranscriptBytes } = await import(
      url("/src/session-mode/services/codexTranscriptMemoryBudget.ts")
    );
    Object.assign(window, {
      __lifecycleStore: useCodexStore,
      __lifecycleBytes: estimateTranscriptBytes,
    });
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id: "ux-0" }],
      detachedCard: null,
    });
    useCodexStore.setState({
      currentThreadId: "ux-0",
      currentTurnId: "lifecycle",
      events: { "ux-0": [] },
      historyLoadedMap: { "ux-0": true },
      turnTimingMap: {
        "ux-0": {
          turnId: "lifecycle",
          status: "inProgress",
          startedAtMs: 1,
          durationMs: null,
        },
      },
    });
  });
  const cdp = await context.newCDPSession(page);
  const before = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  const samples: number[] = [];
  for (let batch = 0; batch < 24; batch++) {
    await page.evaluate((batch) => {
      const store = (window as any).__lifecycleStore;
      for (let i = 0; i < 100; i++) {
        const item = {
          id: `real-${batch}-${i}`,
          type: "commandExecution",
          command: "echo result",
          commandActions: [],
          status: "inProgress",
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
          cwd: "/fixture",
          source: "agent",
          processId: null,
          pluginId: null,
          scriptPath: null,
        };
        store
          .getState()
          .addEvent("ux-0", {
            method: "item/started",
            params: { threadId: "ux-0", turnId: "lifecycle", item },
          });
        store.getState().addEvent(
          "ux-0",
          JSON.parse(
            JSON.stringify({
              method: "item/completed",
              params: {
                threadId: "ux-0",
                turnId: "lifecycle",
                item: {
                  ...item,
                  status: "completed",
                  aggregatedOutput: `${batch}:${i}:` + "x".repeat(100000),
                  exitCode: 0,
                  durationMs: 1,
                },
              },
            }),
          ),
        );
      }
    }, batch);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const w = window as any;
          return w.__lifecycleBytes(
            w.__lifecycleStore.getState().events["ux-0"],
          );
        }),
      )
      .toBeLessThan(8 * 1024 * 1024);
    // Let the normal 500ms cache writer run; do not call the governor or CDP GC.
    await page.waitForTimeout(700);
    samples.push((await cdp.send("Runtime.getHeapUsage")).usedSize);
  }
  console.log(
    JSON.stringify({ mode: "automatic-no-forced-gc", before, samples }),
  );
  expect(Math.max(...samples)).toBeLessThan(before + 256 * 1024 * 1024);
  expect(samples.at(-1)! - samples[2]).toBeLessThan(96 * 1024 * 1024);
  expect(
    await page.evaluate(
      () =>
        (window as any).__lifecycleStore.getState().turnTimingMap["ux-0"]
          .status,
    ),
  ).toBe("inProgress");
});
