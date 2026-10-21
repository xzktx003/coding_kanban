import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const ts = requireWeb("typescript") as typeof import("typescript");

test("development React measures do not accumulate native property clones", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(45_000);
  const source = await readFile(
    "apps/web/src/lib/react-performance-retention.ts",
    "utf8",
  );
  const script = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "content-type",
      request.url === "/guard.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/guard.js"
        ? script
        : "<!doctype html><title>Native React timing fixture</title>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const host =
    Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)
      ?.address ?? "127.0.0.1";
  const url = `http://${host}:${(server.address() as { port: number }).port}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  const samples: any[] = [];
  try {
    await page.goto(url);
    await page.evaluate(async () => {
      const { installReactPerformanceRetention } = await import("/guard.js");
      installReactPerformanceRetention(performance, true);
      const text = new TextDecoder().decode(new Uint8Array(64 * 1024).fill(65));
      let count = 0;
      performance.measure("application-sentinel", {
        start: 0,
        end: 1,
        detail: {
          devtools: {
            track: "Application",
            properties: [["ordinary", "keep-me"]],
          },
          sentinel: 123,
        },
      });
      (window as any).__reactMeasureFixture = {
        batch(round: number) {
          for (let i = 0; i < 100; i++) {
            const start = performance.now();
            performance.measure("ComponentFixture", {
              start,
              end: start + 0.01,
              detail: {
                devtools: {
                  track: "Components ⚛",
                  color: "primary",
                  tooltipText: "render",
                  properties: [
                    ["largeProp", text],
                    ["round", String(round)],
                    ["item", String(i)],
                  ],
                },
              },
            });
            count++;
          }
        },
        state() {
          const measures = performance.getEntriesByType("measure");
          return {
            count,
            reactMeasures: measures.filter((entry) =>
              entry.name.startsWith("__kanban_react_dev_timing__:"),
            ).length,
            application: performance
              .getEntriesByName("application-sentinel")
              .map((entry) => ({
                name: entry.name,
                detail: (entry as PerformanceMeasure).detail,
              })),
          };
        },
      };
    });
    const started = Date.now();
    const sample = async (phase: string, round: number) => {
      const heap = await cdp.send("Runtime.getHeapUsage");
      const processes = await browserCdp.send("SystemInfo.getProcessInfo");
      const row = {
        phase,
        round,
        seconds: (Date.now() - started) / 1000,
        ...heap,
        ...(process.platform === "linux"
          ? sampleRendererRss(processes.processInfo)
          : {}),
        ...(await page.evaluate(() =>
          (window as any).__reactMeasureFixture.state(),
        )),
      };
      samples.push(row);
      // A runaway diagnostic must stop before the established 768 MiB renderer ceiling.
      for (const process of row.rendererProcesses ?? [])
        expect(process.rssBytes).toBeLessThan(700 * 1024 * 1024);
    };
    await page.waitForTimeout(1000);
    await sample("baseline", 0);
    for (let round = 1; round <= 30; round++) {
      await page.evaluate(
        (round) => (window as any).__reactMeasureFixture.batch(round),
        round,
      );
      await page.waitForTimeout(300);
      await sample("natural", round);
    }
    await page.waitForTimeout(2000);
    await sample("quiet-natural", 30);
    // Diagnostic separation only: no forced collection before natural RSS assertions' samples.
    await cdp.send("HeapProfiler.collectGarbage");
    await sample("explicit-gc", 30);
    expect(errors).toEqual([]);
    expect(samples.at(-1).count).toBe(3000);
    for (const sample of samples) {
      expect(sample.reactMeasures).toBe(0);
      expect(sample.application).toEqual([
        {
          name: "application-sentinel",
          detail: {
            devtools: {
              track: "Application",
              properties: [["ordinary", "keep-me"]],
            },
            sentinel: 123,
          },
        },
      ]);
    }
    const natural = samples.filter((sample) => sample.phase !== "explicit-gc");
    const baseline = natural[0];
    expect(
      Math.max(...natural.map((sample) => sample.usedSize)) - baseline.usedSize,
    ).toBeLessThan(16 * 1024 * 1024);
    expect(
      Math.max(...natural.map((sample) => sample.backingStorageSize)) -
        baseline.backingStorageSize,
    ).toBeLessThan(8 * 1024 * 1024);
    if (process.platform === "linux") {
      // 187.5 MiB of cloned properties caused >200 MiB RSS growth with the old guard.
      expect(
        Math.max(...natural.map((sample) => sample.rendererRssBytes)) -
          baseline.rendererRssBytes,
      ).toBeLessThan(64 * 1024 * 1024);
      const identity = baseline.rendererProcesses.map(
        ({ pid, startTicks }: any) => ({ pid, startTicks }),
      );
      for (const sample of samples)
        expect(
          sample.rendererProcesses.map(({ pid, startTicks }: any) => ({
            pid,
            startTicks,
          })),
        ).toEqual(identity);
    }
  } finally {
    const evidence = JSON.stringify(
      {
        url,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        rounds: 30,
        measuresPerRound: 100,
        propertyCharacters: 64 * 1024,
        errors,
        samples,
        scope:
          "Isolated native Performance API with actual development guard, no React renderer or production agents; natural observations followed by explicit diagnostic GC, not the standard long-running soak.",
      },
      null,
      2,
    );
    await writeFile(
      testInfo.outputPath("react-performance-memory.json"),
      evidence,
    );
    await testInfo.attach("react-performance-memory.json", {
      body: evidence,
      contentType: "application/json",
    });
    await Promise.allSettled([cdp.detach(), browserCdp.detach()]);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
