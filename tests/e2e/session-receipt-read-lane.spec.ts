import { expect, test } from "@playwright/test";

test("queue status reaches HTTP while transcript slots remain occupied", async ({
  page,
}, info) => {
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    peak = 0;
  await page.route("**/__receipt-history/*", async (route) => {
    active++;
    peak = Math.max(peak, active);
    await held;
    active--;
    await route.fulfill({ json: { done: true } });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(request.method() + " " + url.pathname);
    if (request.method() !== "GET" || url.pathname !== "/api/session/followups")
      return route.fulfill({
        status: 403,
        json: { error: "No task calls permitted" },
      });
    await route.fulfill({ json: { revision: 7, paused: null, items: [] } });
  });
  await page.route("**/__receipt-lane", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><output id="ready"></output><script type="module">
      const refresh = await import('/@react-refresh');
      refresh.default.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const scheduler = await import('/src/session-mode/services/sessionReadQueue.ts');
      const {followupService} = await import('/src/session-mode/services/followupService.ts');
      window.receiptFixture = {scheduler, followupService};
      document.querySelector('#ready').textContent = 'Ready';
    </script></body></html>`,
    }),
  );
  try {
    await page.goto("/__receipt-lane");
    await expect(page.locator("#ready")).toHaveText("Ready");
    await page.evaluate(() => {
      const f = (window as any).receiptFixture;
      f.controllers = Array.from({ length: 4 }, () => new AbortController());
      f.histories = Array.from({ length: 4 }, (_, i) =>
        f.scheduler
          .enqueueSessionRead(
            "recent",
            `browser-history:${i}`,
            () => fetch(`/__receipt-history/${i}`).then((r) => r.json()),
            f.controllers[i].signal,
          )
          .catch((error: Error) => ({ error: error.name })),
      );
    });
    await expect.poll(() => active).toBe(3);
    const cancelled = await page.evaluate(async () => {
      const f = (window as any).receiptFixture;
      f.controllers[3].abort();
      const outcome = await f.histories[3];
      // A new read for this exact target must not coalesce with the cancelled job.
      f.histories.push(
        f.scheduler.enqueueSessionRead("recent", "browser-history:3", () =>
          fetch("/__receipt-history/fresh").then((r) => r.json()),
        ),
      );
      return outcome;
    });
    expect(cancelled).toEqual({ error: "AbortError" });
    const result = await page.evaluate(async () => {
      const start = performance.now();
      const receipt = await (window as any).receiptFixture.followupService.load(
        "fixture-owner",
      );
      return { receipt, elapsedMs: performance.now() - start };
    });
    expect(result.receipt.revision).toBe(7);
    expect(result.elapsedMs).toBeLessThan(5000);
    expect(active).toBe(3);
    expect(requests).toEqual(["GET /api/session/followups"]);
    release();
    const histories = await page.evaluate(() =>
      Promise.all((window as any).receiptFixture.histories),
    );
    expect(histories.at(-1)).toEqual({ done: true });
    expect(peak).toBe(3);
    expect(errors).toEqual([]);
    await info.attach("receipt-admission", {
      body: JSON.stringify(
        { ...result, peakHistoryRequests: peak, requests, errors },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    release();
  }
});
