import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("real event bridge discards unrelated bodies and hidden output bursts", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await installSessionUxFixture(page, 1);
  await page.addInitScript(() => {
    const w = window as any;
    w.__memorySources = [];
    w.EventSource = class {
      onopen: any;
      onmessage: any;
      onerror: any;
      readyState = 1;
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 2;
      constructor() {
        w.__memorySources.push(this);
        setTimeout(() => this.onopen?.({}), 0);
      }
      close() {
        this.readyState = 2;
      }
      addEventListener() {}
      removeEventListener() {}
    };
  });
  await page.goto("/?mode=session", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const moduleUrl = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      moduleUrl("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    useAgentCenterStore.setState({
      cards: [{ kind: "codex", id: "memory-observed" }],
      detachedCard: null,
    });
    useCodexStore.setState({
      currentThreadId: "memory-observed",
      historyLoadedMap: { "memory-observed": true },
    });
    const w = window as any;
    w.__memoryStore = useCodexStore;
    w.__memorySeq = 0;
    w.__emitMemory = (payload: any) => {
      const source = w.__memorySources.find(
        (s: any) =>
          s.readyState === 1 &&
          s.onmessage?.toString().includes("Number.isSafeInteger"),
      );
      if (!source) throw Error("Real event bridge is missing");
      source.onmessage({
        data: JSON.stringify({
          seq: ++w.__memorySeq,
          event: "codex:notification",
          payload,
        }),
      });
    };
    w.__emitMemory({
      method: "item/completed",
      params: {
        threadId: "memory-observed",
        turnId: "t",
        item: { type: "agentMessage", id: "initial", text: "观察中的消息" },
      },
    });
  });
  await page.waitForTimeout(200);
  const cdp = await context.newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const before = await heap();
  for (let batch = 0; batch < 5; batch++) {
    await page.evaluate((batch) => {
      const w = window as any;
      for (let i = 0; i < 200; i++) {
        const id = batch * 200 + i;
        const text = `${id}:` + "x".repeat(100_000);
        w.__emitMemory({
          method: "item/commandExecution/outputDelta",
          params: {
            threadId: "memory-observed",
            turnId: "t",
            itemId: "verbose-command",
            delta: text,
          },
        });
        w.__emitMemory({
          method: "item/completed",
          params: {
            threadId: "memory-unobserved",
            turnId: "t",
            item: { id: `unrelated-${id}`, type: "agentMessage", text },
          },
        });
      }
    }, batch);
    await page.waitForTimeout(30);
  }
  const after = await heap();
  expect(
    await page.evaluate(
      () =>
        (window as any).__memorySources.filter(
          (source: any) => source.readyState === 1,
        ).length,
    ),
  ).toBe(1);
  const state = await page.evaluate(() => {
    const state = (window as any).__memoryStore.getState();
    return {
      current: state.currentThreadId,
      observed: state.events["memory-observed"]?.length,
      unrelated: state.events["memory-unobserved"]?.length ?? 0,
    };
  });
  expect(state).toEqual({
    current: "memory-observed",
    observed: 1,
    unrelated: 0,
  });
  expect(after - before).toBeLessThan(15 * 1024 * 1024);

  await page.evaluate(() => {
    const w = window as any;
    for (let i = 0; i < 20; i++)
      w.__emitMemory({
        method: "item/agentMessage/delta",
        params: {
          threadId: "memory-observed",
          turnId: "t",
          itemId: "final",
          delta: "最终回复",
        },
      });
    w.__emitMemory({
      method: "item/completed",
      params: {
        threadId: "memory-observed",
        turnId: "t",
        item: { id: "final", type: "agentMessage", text: "最终完整回复" },
      },
    });
    w.__emitMemory({
      method: "item/completed",
      params: {
        threadId: "memory-observed",
        turnId: "t",
        item: {
          id: "verbose-command",
          type: "commandExecution",
          command: "printf result",
          commandActions: [],
          status: "completed",
          aggregatedOutput: "完整命令结果",
          exitCode: 0,
          durationMs: 5,
        },
      },
    });
  });
  expect(
    await page.evaluate(() => {
      const events = (window as any).__memoryStore.getState().events[
        "memory-observed"
      ];
      return events.map((e: any) => ({
        method: e.method,
        text: e.params.item?.text,
        output: e.params.item?.aggregatedOutput,
      }));
    }),
  ).toEqual([
    { method: "item/completed", text: "观察中的消息", output: undefined },
    { method: "item/completed", text: "最终完整回复", output: undefined },
    { method: "item/completed", text: undefined, output: "完整命令结果" },
  ]);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useAgentCenterStore } = await import(url);
    useAgentCenterStore.setState({ cards: [], detachedCard: null });
    (window as any).__memoryStore.setState({ currentThreadId: null });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__memoryStore.getState().events["memory-observed"] ===
          undefined,
      ),
    )
    .toBe(true);
  console.log(JSON.stringify({ before, after, growthBytes: after - before }));
});
