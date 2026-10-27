import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

const RUNS = Number(process.env.SESSION_STARTUP_RUNS ?? 30);
const BUDGET_MS = 2000;
if (!Number.isInteger(RUNS) || RUNS < 1)
  throw new Error("SESSION_STARTUP_RUNS must be a positive integer");

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

for (const width of [393, 1440]) {
  test(`cold session entry exposes navigation and composer within ${BUDGET_MS}ms p95 at ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const navigation: number[] = [];
    const composer: number[] = [];
    const requestCounts: number[] = [];
    const transferBytes: number[] = [];
    const stageSamples = new Map<string, number[]>();
    let diagnosticLogged = false;

    for (let index = 0; index < RUNS; index++) {
      const context = await browser.newContext({
        viewport: { width, height: width === 393 ? 852 : 900 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.addInitScript(() => {
        const started = performance.now();
        const times: { navigation: number | null; composer: number | null } = {
          navigation: null,
          composer: null,
        };
        const stageSelectors: Record<string, string> = {
          workbench: ".session-workbench",
          content: ".session-content",
          appLoading: ".session-app-loading",
          agentView: ".session-agent-view",
          composerTarget: ".session-composer-target-container",
          editorSlot: ".session-native-editor-slot",
          editor: ".session-agent-view [contenteditable=true]",
        };
        const stages: Record<string, number | null> = Object.fromEntries(
          Object.keys(stageSelectors).map((key) => [key, null]),
        );
        Object.defineProperty(window, "__sessionStartupTimes", {
          configurable: false,
          value: Object.assign(times, { stages }),
        });
        const observe = () => {
          for (const [name, selector] of Object.entries(stageSelectors))
            if (stages[name] === null && document.querySelector(selector))
              stages[name] = performance.now() - started;
          if (
            times.navigation === null &&
            document.querySelector(
              '.session-top-nav[data-navigation-ready="true"]',
            )
          )
            times.navigation = performance.now() - started;
          const editor = document.querySelector<HTMLElement>(
            ".session-agent-view [contenteditable=true]",
          );
          if (
            times.composer === null &&
            editor?.isConnected &&
            editor.getClientRects().length > 0 &&
            !editor.hasAttribute("aria-disabled")
          )
            times.composer = performance.now() - started;
          if (times.navigation !== null && times.composer !== null)
            observer.disconnect();
        };
        const observer = new MutationObserver(observe);
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        requestAnimationFrame(observe);
      });

      const fixture = await setup(page, true);
      try {
        const measured = await page.evaluate(
          () =>
            (
              window as Window & {
                __sessionStartupTimes: {
                  navigation: number | null;
                  composer: number | null;
                  stages: Record<string, number | null>;
                };
              }
            ).__sessionStartupTimes,
        );
        expect(
          measured.navigation,
          `navigation sample ${index + 1}`,
        ).not.toBeNull();
        expect(
          measured.composer,
          `composer sample ${index + 1}`,
        ).not.toBeNull();
        navigation.push(measured.navigation!);
        composer.push(measured.composer!);
        for (const [name, value] of Object.entries(measured.stages)) {
          if (value === null) continue;
          const samples = stageSamples.get(name) ?? [];
          samples.push(value);
          stageSamples.set(name, samples);
        }
        const network = await page.evaluate(() => {
          const resources = performance.getEntriesByType(
            "resource",
          ) as PerformanceResourceTiming[];
          return {
            requests: resources.length,
            bytes: resources.reduce(
              (total, resource) => total + resource.transferSize,
              0,
            ),
          };
        });
        requestCounts.push(network.requests);
        transferBytes.push(network.bytes);
        if (
          process.env.SESSION_STARTUP_DIAGNOSTICS === "1" &&
          !diagnosticLogged &&
          (index === 0 || measured.composer! > BUDGET_MS)
        ) {
          diagnosticLogged = true;
          const diagnostics = await page.evaluate(() => {
            const entries = performance
              .getEntriesByType("resource")
              .map((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return {
                  path: new URL(resource.name).pathname,
                  asset: new URL(resource.name).pathname.split("/").at(-1),
                  startMs: Math.round(resource.startTime),
                  durationMs: Math.round(resource.duration),
                  transferBytes: resource.transferSize,
                };
              });
            return {
              stages: (
                window as Window & {
                  __sessionStartupTimes: {
                    stages: Record<string, number | null>;
                  };
                }
              ).__sessionStartupTimes.stages,
              api: entries.filter(
                (entry) =>
                  entry.path.startsWith("/api/") &&
                  /(health|tabs|projects|settings|thread\/(read|list|turns\/list)|model\/list|plugin\/installed|skills\/list|followups|events)/.test(
                    entry.path,
                  ),
              ),
              resources: entries
                .filter((entry) => /\.js(?:$|\?)/.test(entry.path))
                .map(({ path: _path, ...entry }) => entry)
              .sort((a, b) => b.durationMs - a.durationMs)
                .slice(0, 12),
            };
          });
          console.info(`[session-startup-diagnostics] ${JSON.stringify(diagnostics)}`);
        }
        expect(fixture.calls).toEqual([]);
        expect(
          fixture.fixture.calls.filter((call) =>
            /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(fixture.errors).toEqual([]);
      } finally {
        await fixture.close();
        await context.close();
      }
    }

    const result = {
      width,
      runs: RUNS,
      navigationP50Ms: percentile(navigation, 0.5),
      navigationP95Ms: percentile(navigation, 0.95),
      composerP50Ms: percentile(composer, 0.5),
      composerP95Ms: percentile(composer, 0.95),
      navigationMaxMs: Math.max(...navigation),
      composerMaxMs: Math.max(...composer),
      requestCountP50: percentile(requestCounts, 0.5),
      requestCountP95: percentile(requestCounts, 0.95),
      requestCountMax: Math.max(...requestCounts),
      transferBytesP50: percentile(transferBytes, 0.5),
      transferBytesP95: percentile(transferBytes, 0.95),
      transferBytesMax: Math.max(...transferBytes),
      stages: Object.fromEntries(
        [...stageSamples].map(([name, values]) => [
          name,
          {
            p50Ms: percentile(values, 0.5),
            p95Ms: percentile(values, 0.95),
            maxMs: Math.max(...values),
          },
        ]),
      ),
    };
    console.info(`[session-startup-perf] ${JSON.stringify(result)}`);
    expect(result.navigationP95Ms).toBeLessThanOrEqual(BUDGET_MS);
    expect(result.composerP95Ms).toBeLessThanOrEqual(BUDGET_MS);
  });
}

const MULTI_WINDOW_RUNS = Number(
  process.env.SESSION_STARTUP_MULTI_WINDOW_RUNS ?? 10,
);
const CONCURRENT_WINDOWS = 3;
if (!Number.isInteger(MULTI_WINDOW_RUNS) || MULTI_WINDOW_RUNS < 1)
  throw new Error("SESSION_STARTUP_MULTI_WINDOW_RUNS must be a positive integer");

for (const width of [393, 1440]) {
  test(`three simultaneous session windows expose the composer within ${BUDGET_MS}ms p95 at ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const composer: number[] = [];
    const requestCounts: number[] = [];
    const transferBytes: number[] = [];

    for (let batch = 0; batch < MULTI_WINDOW_RUNS; batch++) {
      const context = await browser.newContext({
        viewport: { width, height: width === 393 ? 852 : 900 },
      });
      try {
        const windows = await Promise.all(
          Array.from({ length: CONCURRENT_WINDOWS }, async (_, windowIndex) => {
            const page = await context.newPage();
            page.setDefaultTimeout(10_000);
            await page.addInitScript(() => {
              const started = performance.now();
              const times = { composer: null as number | null };
              Object.defineProperty(window, "__sessionConcurrentStartup", {
                configurable: false,
                value: times,
              });
              const observe = () => {
                const editor = document.querySelector<HTMLElement>(
                  ".session-agent-view [contenteditable=true]",
                );
                if (
                  times.composer === null &&
                  editor?.isConnected &&
                  editor.getClientRects().length > 0 &&
                  !editor.hasAttribute("aria-disabled")
                )
                  times.composer = performance.now() - started;
                if (times.composer !== null) observer.disconnect();
              };
              const observer = new MutationObserver(observe);
              observer.observe(document, {
                childList: true,
                subtree: true,
                attributes: true,
              });
              requestAnimationFrame(observe);
            });
            const fixture = await setup(page, true);
            try {
              const measured = await page.evaluate(
                () =>
                  (
                    window as Window & {
                      __sessionConcurrentStartup: {
                        composer: number | null;
                      };
                    }
                  ).__sessionConcurrentStartup,
              );
              expect(
                measured.composer,
                `viewport ${width}px batch ${batch + 1} window ${windowIndex + 1}`,
              ).not.toBeNull();
              expect(fixture.calls).toEqual([]);
              expect(
                fixture.fixture.calls.filter((call) =>
                  /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
                    call.path,
                  ),
                ),
              ).toEqual([]);
              expect(fixture.errors).toEqual([]);
              const network = await page.evaluate(() => {
                const resources = performance.getEntriesByType(
                  "resource",
                ) as PerformanceResourceTiming[];
                return {
                  requests: resources.length,
                  bytes: resources.reduce(
                    (total, resource) => total + resource.transferSize,
                    0,
                  ),
                };
              });
              return {
                composer: measured.composer!,
                requests: network.requests,
                bytes: network.bytes,
              };
            } finally {
              await fixture.close();
            }
          }),
        );
        for (const window of windows) {
          composer.push(window.composer);
          requestCounts.push(window.requests);
          transferBytes.push(window.bytes);
        }
      } finally {
        await context.close();
      }
    }

    const result = {
      width,
      concurrentWindows: CONCURRENT_WINDOWS,
      batches: MULTI_WINDOW_RUNS,
      samples: composer.length,
      composerP50Ms: percentile(composer, 0.5),
      composerP95Ms: percentile(composer, 0.95),
      composerMaxMs: Math.max(...composer),
      requestCountP50: percentile(requestCounts, 0.5),
      requestCountP95: percentile(requestCounts, 0.95),
      requestCountMax: Math.max(...requestCounts),
      transferBytesP50: percentile(transferBytes, 0.5),
      transferBytesP95: percentile(transferBytes, 0.95),
      transferBytesMax: Math.max(...transferBytes),
    };
    console.info(`[session-startup-multi-window] ${JSON.stringify(result)}`);
    expect(result.composerP95Ms).toBeLessThanOrEqual(BUDGET_MS);
  });
}

for (const width of [393, 1440]) {
  test(`composer accepts input while three ${width}px session windows stay open`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width, height: width === 393 ? 852 : 900 },
    });
    const pages = await Promise.all(
      Array.from({ length: CONCURRENT_WINDOWS }, async () => {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        return page;
      }),
    );
    const fixtures = await Promise.all(
      pages.map((page) => setup(page, true)),
    );
    try {
      const editor = pages[0].locator(
        ".session-agent-view [contenteditable=true]",
      );
      await editor.fill("三窗口输入响应检查");
      await expect(editor).toContainText("三窗口输入响应检查");
      for (const fixture of fixtures) {
        expect(fixture.calls).toEqual([]);
        expect(
          fixture.fixture.calls.filter((call) =>
            /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
              call.path,
            ),
          ),
        ).toEqual([]);
        expect(fixture.errors).toEqual([]);
      }
    } finally {
      await Promise.all(fixtures.map((fixture) => fixture.close()));
      await context.close();
    }
  });
}
