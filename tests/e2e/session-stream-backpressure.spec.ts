import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

test("a suspended browser frame cannot accumulate an unlimited delta batch and final replies remain available", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.route("**/stream-backpressure-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div id="root"></div>',
    }),
  );
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/stream-backpressure-probe");
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    (window as any).$RefreshReg$ = () => {};
    (window as any).$RefreshSig$ = () => (type: unknown) => type;
    (window as any).__vite_plugin_react_preamble_installed__ = true;
    const main = await (await fetch("/src/main.tsx")).text();
    const thread = await (
      await fetch("/src/session-mode/components/codex/thread/CodexThread.tsx")
    ).text();
    const dependency = (source: string, name: string) => {
      const path = [...source.matchAll(/from "([^"]+)"/g)]
        .map((match) => match[1]!)
        .find((path) => path.includes(`/deps/${name}.js?`));
      if (!path) throw new Error(`Missing optimized Vite dependency: ${name}`);
      return import(path).then((module) => module.default ?? module);
    };
    const [
      React,
      { createRoot },
      { flushSync },
      { useServerNotificationHandler },
      { useCodexStore },
    ] = await Promise.all([
      dependency(main, "react"),
      dependency(main, "react-dom_client"),
      dependency(thread, "react-dom"),
      import("/src/session-mode/components/codex/hooks/useServerNotificationHandler.ts"),
      import("/src/session-mode/components/codex/stores/index.ts"),
    ]);
    const probe: any = { store: useCodexStore, handle: null };
    (window as any).__backpressure = probe;
    function Probe() {
      probe.handle = useServerNotificationHandler(
        {
          isCodexThreadActiveRef: { current: false },
          taskCompleteBeepModeRef: { current: "never" },
          preventSleepDuringTasksRef: { current: false },
        },
        async () => {},
      );
      return React.createElement("p", null, "ready");
    }
    const root = createRoot(document.querySelector("#root")!);
    flushSync(() => root.render(React.createElement(Probe)));
    probe.root = root;
  });
  const cdp = await page.context().newCDPSession(page);
  const global = await browser.newBrowserCDPSession();
  const sample = async () => ({
    ...(await cdp.send("Runtime.getHeapUsage")),
    ...sampleRendererRss(
      (await global.send("SystemInfo.getProcessInfo")).processInfo,
    ),
  });
  const before = await sample();
  const workload = await page.evaluate(async () => {
    const { estimateTranscriptBytes } =
      await import("/src/session-mode/services/codexTranscriptMemoryBudget.ts");
    const probe = (window as any).__backpressure;
    const store = probe.store;
    const original = store.getState().setStreamingAgentDeltas;
    const originalTranscript = store.getState().addTranscriptDeltas;
    let submittedBytes = 0,
      deliveredBytes = 0,
      maximumPendingTextBytes = 0;
    const stopMemory = store.subscribe((state: any) => {
      maximumStoreBytes = Math.max(
        maximumStoreBytes,
        estimateTranscriptBytes(state.events) +
          estimateTranscriptBytes(state.streamingAgentMessages),
      );
    });
    const nativeRaf = window.requestAnimationFrame,
      nativeCancel = window.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let serial = 0,
      maximumPending = 0,
      maximumBatch = 0,
      maximumStoreBytes = 0;
    const received: string[] = [];
    const start = performance.now();
    try {
      window.requestAnimationFrame = (cb) => {
        frames.set(++serial, cb);
        return serial;
      };
      window.cancelAnimationFrame = (id) => {
        frames.delete(id);
      };
      store.setState({
        currentThreadId: "burst",
        events: {},
        streamingAgentMessages: {},
        threads: [],
        commandStatusMap: {},
        commandDurationMap: {},
        turnTimingMap: {},
      });
      const deliver =
        (action: typeof original) => (id: string, events: any[]) => {
          maximumBatch = Math.max(maximumBatch, events.length);
          received.push(...events.map((event) => event.params.itemId));
          deliveredBytes += events.reduce(
            (sum, event) => sum + event.params.delta.length * 2,
            0,
          );
          action(id, events);
        };
      store.setState({
        setStreamingAgentDeltas: deliver(original),
        addTranscriptDeltas: deliver(originalTranscript),
      });
      for (let i = 0; i < 5000; i++) {
        const delta = `${i}:${"x".repeat(4096)}`;
        submittedBytes += delta.length * 2;
        probe.handle({
          method:
            i % 3 === 0
              ? "item/agentMessage/delta"
              : "item/reasoning/summaryTextDelta",
          params: {
            threadId: "burst",
            turnId: "running",
            itemId: `item-${i}`,
            delta,
            ...(i % 3 !== 0 ? { summaryIndex: i % 5 } : {}),
          },
        });
        maximumPending = Math.max(maximumPending, i + 1 - received.length);
        maximumPendingTextBytes = Math.max(
          maximumPendingTextBytes,
          submittedBytes - deliveredBytes,
        );
        if (i % 64 === 0)
          maximumStoreBytes = Math.max(
            maximumStoreBytes,
            estimateTranscriptBytes(store.getState().events) +
              estimateTranscriptBytes(store.getState().streamingAgentMessages),
          );
      }
      const pendingBeforeFrame = 5000 - received.length;
      while (frames.size) {
        const [id, callback] = frames.entries().next().value!;
        frames.delete(id);
        callback(performance.now());
      }
      probe.handle({
        method: "item/completed",
        params: {
          threadId: "burst",
          turnId: "running",
          item: {
            type: "agentMessage",
            id: "item-4999",
            text: "final answer retained",
            phase: null,
            memoryCitation: null,
          },
        },
      });
      const final = store.getState().events.burst;
      return {
        maximumPending,
        maximumPendingTextBytes,
        pendingBeforeFrame,
        maximumBatch,
        maximumStoreBytes,
        elapsedMs: performance.now() - start,
        receivedCount: received.length,
        ordered: received.every((id, index) => id === `item-${index}`),
        framesAfter: frames.size,
        finalPreserved: final.some(
          (event: any) =>
            event.method === "item/completed" &&
            event.params.item.text === "final answer retained",
        ),
      };
    } finally {
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCancel;
      stopMemory();
      store.setState({
        setStreamingAgentDeltas: original,
        addTranscriptDeltas: originalTranscript,
      });
      probe.root.unmount();
    }
  });
  const after = await sample();
  const path = testInfo.outputPath("stream-backpressure-metrics.json");
  await writeFile(path, JSON.stringify({ before, workload, after }, null, 2));
  await testInfo.attach("stream-backpressure-metrics", {
    path,
    contentType: "application/json",
  });
  expect(workload.maximumPending).toBeLessThanOrEqual(128);
  expect(workload.maximumBatch).toBeLessThanOrEqual(32);
  expect(workload.maximumPendingTextBytes).toBeLessThanOrEqual(1024 * 1024);
  expect(workload.maximumStoreBytes).toBeLessThan(8 * 1024 * 1024 + 512 * 1024);
  expect(workload.receivedCount).toBe(5000);
  expect(workload.ordered).toBe(true);
  expect(workload.framesAfter).toBe(0);
  expect(workload.finalPreserved).toBe(true);
});
