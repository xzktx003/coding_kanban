import { expect, test } from "@playwright/test";

test("the browser memory governor does not republish an unchanged protected attachment under heap pressure", async ({
  page,
}) => {
  await page.route("**/memory-feedback-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Memory governor probe</title>",
    }),
  );
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/memory-feedback-probe");
  await page.evaluate(async () => {
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    const { startSessionMemoryGovernor } =
      await import("/src/session-mode/services/sessionMemoryGovernor.ts");
    const memory = Object.getOwnPropertyDescriptor(performance, "memory");
    // This drives the real pressure branch without allocating 300 MiB or GC.
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: {
        usedJSHeapSize: 300 * 1024 * 1024,
        jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
      },
    });
    const url = "data:image/png;base64," + "x".repeat(3 * 1024 * 1024);
    const events = [
      {
        method: "item/completed",
        params: {
          threadId: "pressure-probe",
          turnId: "live",
          item: {
            id: "attachment",
            type: "userMessage",
            clientId: null,
            content: [{ type: "image", url }],
          },
        },
      },
    ];
    useCodexStore.setState({
      events: { "pressure-probe": events },
      threads: [],
      currentThreadId: "pressure-probe",
      commandStatusMap: {},
      commandDurationMap: {},
      turnTimingMap: {},
    });
    const probe = {
      publications: 0,
      startedAt: performance.now(),
      store: useCodexStore,
      events,
      stop: () => {},
    };
    const unsubscribe = useCodexStore.subscribe((next, previous) => {
      if (next.events !== previous.events) probe.publications++;
    });
    const stop = startSessionMemoryGovernor();
    probe.stop = () => {
      stop();
      unsubscribe();
      if (memory) Object.defineProperty(performance, "memory", memory);
      else delete (performance as any).memory;
    };
    (window as any).__memoryFeedbackProbe = probe;
  });
  try {
    await page.waitForTimeout(2300);
    const result = await page.evaluate(() => {
      const probe = (window as any).__memoryFeedbackProbe;
      return {
        publications: probe.publications,
        milliseconds: performance.now() - probe.startedAt,
        same: probe.store.getState().events["pressure-probe"] === probe.events,
      };
    });
    expect(result.milliseconds).toBeGreaterThanOrEqual(2100);
    expect(result.publications).toBe(0);
    expect(result.same).toBe(true);
  } finally {
    await page.evaluate(() => (window as any).__memoryFeedbackProbe.stop());
  }
});
