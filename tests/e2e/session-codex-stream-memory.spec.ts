import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("renders live Codex text outside transcript history until final markdown arrives", async ({
  page,
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
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const { useCodexStore } = await import(
      moduleUrl("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      moduleUrl("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { useLayoutStore } = await import(
      moduleUrl("/src/session-mode/stores/useLayoutStore.ts")
    );
    const { useAgentSettingsStore } = await import(
      moduleUrl("/src/session-mode/stores/useAgentSettingsStore.ts")
    );
    const { useAcpStore } = await import(
      moduleUrl("/src/session-mode/stores/useAcpStore.ts")
    );
    useLayoutStore.setState({ view: "agent", isRightPanelOpen: false });
    useAgentSettingsStore.setState({ selectedAgent: "codex" });
    useAcpStore.setState({ active: false });
    useCodexStore.setState({
      currentThreadId: "stream-memory",
      currentTurnId: "stream-turn",
      events: { "stream-memory": [] },
      historyLoadedMap: { "stream-memory": true },
      historyLoadingMap: {},
      historyErrorMap: {},
      turnTimingMap: {
        "stream-memory": {
          turnId: "stream-turn",
          status: "inProgress",
          startedAtMs: Date.now(),
          durationMs: null,
        },
      },
      threads: [
        {
          id: "stream-memory",
          name: "stream memory",
          preview: "stream memory",
          cwd: "/fixture",
          createdAt: 1,
          updatedAt: 1,
          modelProvider: "openai",
          status: { type: "active", activeFlags: [] },
          turns: [],
        } as any,
      ],
    });
    useAgentCenterStore.getState().addAgentCard({
      kind: "codex",
      id: "stream-memory",
      cwd: "/fixture",
      preview: "stream memory",
    } as any);
    const w = window as any;
    w.__memoryStore = useCodexStore;
    w.__memorySeq = 0;
    w.__emitMemory = (payload: any) => {
      const source = w.__memorySources.find(
        (candidate: any) =>
          candidate.readyState === 1 &&
          candidate.onmessage?.toString().includes("Number.isSafeInteger"),
      );
      if (!source) throw Error("Real Codex event bridge is missing");
      source.onmessage({
        data: JSON.stringify({
          seq: ++w.__memorySeq,
          event: "codex:notification",
          payload,
        }),
      });
    };
  });
  await expect(page.locator(".thread-surface")).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const heapBefore = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  let peakHeap = heapBefore;
  for (let batch = 0; batch < 5; batch++) {
    await page.evaluate(async (batchIndex) => {
      const w = window as any;
      for (let item = 0; item < 80; item++) {
        const index = batchIndex * 80 + item;
        w.__emitMemory({
          method: "item/agentMessage/delta",
          params: {
            threadId: "stream-memory",
            turnId: "stream-turn",
            itemId: "stream-item",
            delta: `active ${index}\n${"x".repeat(8 * 1024)}`,
          },
        });
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }, batch);
    peakHeap = Math.max(
      peakHeap,
      (await cdp.send("Runtime.getHeapUsage")).usedSize,
    );
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const heapAfter = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  await cdp.detach();
  expect(peakHeap - heapBefore).toBeLessThan(32 * 1024 * 1024);
  expect(heapAfter - heapBefore).toBeLessThan(8 * 1024 * 1024);

  const liveText = page.locator(
    ".thread-surface [data-codex-live-message] [data-codex-streaming-text]",
  );
  await expect(liveText).toContainText("active 39");
  await expect(liveText).toContainText("...[中间内容因会话内存限制已省略]...");
  await expect(liveText).toContainText("active 0");
  await expect(
    page.locator(".thread-surface [data-codex-live-message] [data-streamdown]"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const state = (window as any).__memoryStore.getState();
      return {
        history: state.events["stream-memory"],
        liveLength: state.streamingAgentMessages["stream-memory"]?.length,
      };
    }),
  ).toMatchObject({ history: [] });
  expect(
    await page.evaluate(
      () =>
        (window as any).__memoryStore.getState().streamingAgentMessages[
          "stream-memory"
        ].length,
    ),
  ).toBeLessThanOrEqual(256 * 1024);

  await page.evaluate(() => {
    (window as any).__emitMemory({
      method: "item/completed",
      params: {
        threadId: "stream-memory",
        turnId: "stream-turn",
        item: {
          id: "stream-item",
          type: "agentMessage",
          text: "**final response**",
          phase: null,
          memoryCitation: null,
        },
      },
    });
  });

  await expect(page.getByText("final response", { exact: true })).toBeVisible();
  await expect(
    page.locator(".thread-surface [data-codex-live-message]"),
  ).toHaveCount(0);
  await expect(
    page.locator('.thread-surface [data-streamdown="strong"]'),
  ).toHaveText("final response");
  expect(
    await page.evaluate(() => {
      const state = (window as any).__memoryStore.getState();
      return {
        methods: state.events["stream-memory"].map(
          (event: any) => event.method,
        ),
        streaming: state.streamingAgentMessages["stream-memory"],
      };
    }),
  ).toEqual({ methods: ["item/completed"], streaming: undefined });
});
