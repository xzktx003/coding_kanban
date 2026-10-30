import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  installThirtyFollowedFourPanes,
  installDiagnosticReadTimeline,
} from "./session-multisession-fixture";

const percentile = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    p50: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};

const diagnostic = process.env.SESSION_PERFORMANCE_DIAGNOSTIC === "1";
const transport =
  process.env.SESSION_PERFORMANCE_TRANSPORT ?? "playwright-route";
if (!["playwright-route", "native-http"].includes(transport))
  throw new Error("Unknown performance fixture transport");
const nativeHttp = transport === "native-http";
const requiredRounds = diagnostic ? 1 : 30;
test(`${diagnostic ? "diagnostic one cold entry" : "thirty cold entries"} each with thirty followed, four visible panes and three simultaneous pages (${transport})`, async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(480_000);
  const pageSamples: Array<Array<Record<string, number>>> = [[], [], []];
  const failures: Array<{ sample: number; page: number; error: string }> = [];
  const nativeHttpSamples: Array<Record<string, unknown>> = [];
  let nativeFixtureProof: Record<string, unknown> | null = null;
  if (nativeHttp) {
    const recordPath = process.env.SESSION_PERFORMANCE_NATIVE_FIXTURE_RECORD;
    expect(
      recordPath,
      "An explicit owned native fixture record is required",
    ).toBeTruthy();
    const raw = await readFile(recordPath!, "utf8");
    const record = JSON.parse(raw);
    expect(record.lanUrl).toBe(new URL(baseURL!).origin);
    expect(record.apiProxy).toBe(false);
    expect(record.nativeHttpFixture).toMatchObject({
      kind: "session-ux",
      followed: 30,
      visiblePanes: 4,
    });
    expect(record.launcherPath).toEqual(expect.any(String));
    expect(Number.isSafeInteger(record.pid) && record.pid > 0).toBe(true);
    const stat = await readFile(`/proc/${record.pid}/stat`, "utf8");
    expect(
      stat
        .slice(stat.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/)[19],
    ).toBe(record.startTicks);
    expect(
      (await readFile(`/proc/${record.pid}/cmdline`, "utf8")).split("\0"),
    ).toContain(record.launcherPath);
    nativeFixtureProof = {
      recordPath,
      sha256: createHash("sha256").update(raw).digest("hex"),
      ...record,
    };
  }
  for (let sample = 0; sample < requiredRounds; sample++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const pages = await Promise.all([
      context.newPage(),
      context.newPage(),
      context.newPage(),
    ]);
    const fixtures = nativeHttp
      ? []
      : await Promise.all(
          pages.map((page) =>
            installThirtyFollowedFourPanes(page, baseURL!, {
              observeReads: diagnostic,
            }),
          ),
        );
    if (nativeHttp && diagnostic)
      await Promise.all(pages.map(installDiagnosticReadTimeline));
    try {
      const results = await Promise.allSettled(
        pages.map(async (page, index) => {
          const profiler =
            diagnostic && index === 0
              ? await context.newCDPSession(page)
              : null;
          if (profiler) {
            await profiler.send("Profiler.enable");
            await profiler.send("Profiler.setSamplingInterval", {
              interval: 1000,
            });
            await profiler.send("Performance.enable");
            await profiler.send("Profiler.start");
          }
          const errors: string[] = [];
          const pending = new Set<string>();
          const taskWrites: string[] = [];
          const hmr = { opened: 0, connected: 0, errors: [] as string[] };
          let nativeSseResponses = 0;
          page.on("request", (request) => {
            const path = new URL(request.url()).pathname;
            if (
              request.method() !== "GET" &&
              /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback)|followups\/submit)$/.test(
                path,
              )
            )
              taskWrites.push(`${request.method()} ${path}`);
          });
          page.on("response", (response) => {
            if (
              response.request().resourceType() === "eventsource" &&
              response.status() === 200
            )
              nativeSseResponses++;
            if (nativeHttp && response.status() >= 500)
              errors.push(
                `HTTP ${response.status()} ${new URL(response.url()).pathname}`,
              );
          });
          page.on("websocket", (socket) => {
            const url = new URL(socket.url());
            const source = new URL(baseURL!);
            if (
              url.host !== source.host ||
              url.pathname !== "/" ||
              url.protocol !== (source.protocol === "https:" ? "wss:" : "ws:")
            ) {
              if (nativeHttp)
                errors.push(
                  `Unexpected WebSocket ${url.origin}${url.pathname}`,
                );
              return;
            }
            hmr.opened++;
            socket.on("framereceived", ({ payload }) => {
              if (typeof payload !== "string") return;
              try {
                if (JSON.parse(payload).type === "connected") hmr.connected++;
              } catch {
                /* Other owned HMR frames are not retained. */
              }
            });
            socket.on("socketerror", (error) => hmr.errors.push(error));
          });
          page.on("request", (request) =>
            pending.add(new URL(request.url()).pathname),
          );
          page.on("requestfinished", (request) =>
            pending.delete(new URL(request.url()).pathname),
          );
          page.on("requestfailed", (request) =>
            pending.delete(new URL(request.url()).pathname),
          );
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("requestfailed", (request) => {
            if (
              request.failure()?.errorText === "net::ERR_ABORTED" &&
              request.resourceType() !== "script" &&
              request.resourceType() !== "stylesheet"
            )
              return;
            errors.push(
              `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
            );
          });
          page.on("console", (message) => {
            // The all-API fixture deliberately closes Vite's WebSocket. This
            // exact diagnostic is not a failed product/module request.
            if (
              message.type() === "error" &&
              (nativeHttp ||
                !message
                  .text()
                  .startsWith("[vite] failed to connect to websocket."))
            )
              errors.push(message.text());
          });
          try {
            await page.goto(baseURL + "/?mode=session", {
              waitUntil: "domcontentloaded",
            });
            const editor = page
              .locator(".session-codex-composer [contenteditable=true]")
              .first();
            await expect(editor)
              .toBeVisible({ timeout: 45_000 })
              .catch(async (error) => {
                await writeFile(
                  info.outputPath(`failed-page-${sample}-${index}.json`),
                  JSON.stringify(
                    {
                      errors,
                      pending: [...pending],
                      url: page.url(),
                      body: await page
                        .locator("body")
                        .innerText()
                        .catch(() => "unavailable"),
                      metrics: await page
                        .evaluate(
                          () => (window as any).__multisessionPerformance,
                        )
                        .catch(() => null),
                    },
                    null,
                    2,
                  ),
                );
                await page
                  .screenshot({
                    path: info.outputPath(`failed-page-${sample}-${index}.png`),
                  })
                  .catch(() => undefined);
                throw error;
              });
            await expect
              .poll(() =>
                page.evaluate(
                  () => (window as any).__multisessionPerformance.ready,
                ),
              )
              .toBeGreaterThan(0);
            await editor.press("x");
            await expect(editor).toHaveText("x");
            await expect
              .poll(() =>
                page.evaluate(
                  () =>
                    (window as any).__multisessionPerformance.inputTwoFrames,
                ),
              )
              .toBeGreaterThan(0);
            await expect
              .poll(
                () =>
                  page.evaluate(
                    () => (window as any).__multisessionPerformance.body,
                  ),
                // Uncached full transcript availability is reported separately
                // from the unchanged two-second navigation/composer criterion.
                { timeout: 45_000 },
              )
              .toBeGreaterThan(0);
            await expect(page.locator("[data-session-group]")).toHaveCount(4);
            if (nativeHttp) {
              await expect.poll(() => hmr.connected).toBeGreaterThan(0);
              expect(hmr.errors).toEqual([]);
              expect(nativeSseResponses).toBeGreaterThan(0);
            }
            if (diagnostic)
              await writeFile(
                info.outputPath(`script-profile-${index}.json`),
                JSON.stringify(
                  await page.evaluate(() =>
                    (
                      performance.getEntriesByType(
                        "resource",
                      ) as PerformanceResourceTiming[]
                    )
                      .filter((resource) => resource.initiatorType === "script")
                      .map((resource) => ({
                        path: new URL(resource.name).pathname,
                        bytes: resource.encodedBodySize,
                        start: resource.startTime,
                        end: resource.responseEnd,
                        duration: resource.duration,
                        protocol: resource.nextHopProtocol,
                      })),
                  ),
                  null,
                  2,
                ),
              );
            if (diagnostic)
              await writeFile(
                info.outputPath(`runtime-profile-${index}.json`),
                JSON.stringify(
                  await page.evaluate(() => ({
                    metrics: (window as any).__multisessionPerformance,
                    visibility: document.visibilityState,
                    longTasks: (window as any).__multisessionLongTasks,
                    readTimeline: (window as any).__readCriticalTimeline,
                    api: (
                      performance.getEntriesByType(
                        "resource",
                      ) as PerformanceResourceTiming[]
                    )
                      .filter((resource) =>
                        new URL(resource.name).pathname.startsWith("/api/"),
                      )
                      .slice(0, 500)
                      .map((resource) => ({
                        path: new URL(resource.name).pathname,
                        start: resource.startTime,
                        end: resource.responseEnd,
                        duration: resource.duration,
                      })),
                  })),
                  null,
                  2,
                ),
              );
            if (profiler) {
              const [cpu, metrics] = await Promise.all([
                profiler.send("Profiler.stop"),
                profiler.send("Performance.getMetrics"),
              ]);
              await writeFile(
                info.outputPath("critical-cpu-profile.json"),
                JSON.stringify({ cpu, metrics }),
              );
              await profiler.detach();
            }
            expect(errors).toEqual([]);
            expect(taskWrites).toEqual([]);
            expect(
              (fixtures[index]?.fixture.calls ?? []).filter((call) =>
                /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback)|followups\/submit)$/.test(
                  call.path,
                ),
              ),
            ).toEqual([]);
            return page.evaluate(
              ({ hmr, nativeSseResponses, taskWrites }) => {
                const resources = performance.getEntriesByType(
                  "resource",
                ) as PerformanceResourceTiming[];
                const scripts = resources.filter(
                  (resource) => resource.initiatorType === "script",
                );
                return {
                  ...(window as any).__multisessionPerformance,
                  requests: resources.length,
                  scriptRequests: scripts.length,
                  scriptBytes: scripts.reduce(
                    (sum, resource) => sum + resource.encodedBodySize,
                    0,
                  ),
                  scriptTransferBytes: scripts.reduce(
                    (sum, resource) => sum + resource.transferSize,
                    0,
                  ),
                  cachedOrRevalidatedScripts: scripts.filter(
                    (resource) =>
                      resource.encodedBodySize > 0 &&
                      resource.transferSize < resource.encodedBodySize,
                  ).length,
                  hmrOpened: hmr.opened,
                  hmrConnected: hmr.connected,
                  nativeSseResponses,
                  taskWrites: taskWrites.length,
                  scriptLastEnd: Math.max(
                    ...scripts.map((resource) => resource.responseEnd),
                  ),
                  http2Requests: resources.filter(
                    (resource) => resource.nextHopProtocol === "h2",
                  ).length,
                };
              },
              { hmr, nativeSseResponses, taskWrites },
            );
          } catch (error) {
            await writeFile(
              info.outputPath(`failed-state-${sample}-${index}.json`),
              JSON.stringify(
                {
                  errors,
                  pending: [...pending],
                  url: page.url(),
                  body: await page
                    .locator("body")
                    .innerText()
                    .catch(() => "unavailable"),
                  state: await page
                    .evaluate(() => ({
                      metrics: (window as any).__multisessionPerformance,
                      visibility: document.visibilityState,
                      groups: [
                        ...document.querySelectorAll<HTMLElement>(
                          "[data-session-group]",
                        ),
                      ].map((element) => ({
                        id: element.dataset.sessionGroup,
                        visible: element.getClientRects().length > 0,
                        text: element.innerText.slice(0, 200),
                      })),
                      composerOwner: document
                        .querySelector(".session-codex-composer")
                        ?.getAttribute("data-owner-thread"),
                      composerLabel: document.querySelector(
                        ".session-input-target",
                      )?.textContent,
                      visibleShells: [
                        ...document.querySelectorAll<HTMLElement>(
                          "[data-codex-transcript-shell]",
                        ),
                      ]
                        .filter((element) => element.getClientRects().length)
                        .map((element) => ({
                          id: element.dataset.codexTranscriptShell,
                          text: element.innerText.slice(0, 500),
                        })),
                    }))
                    .catch(() => null),
                },
                null,
                2,
              ),
            );
            throw error;
          }
        }),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled")
          pageSamples[index].push(result.value);
        else
          failures.push({ sample, page: index, error: String(result.reason) });
      });
      if (nativeHttp) {
        try {
          const response = await context.request.get(
            baseURL + "/__fixture/native-http-stats",
            { ignoreHTTPSErrors: new URL(baseURL!).protocol === "https:" },
          );
          expect(response.ok()).toBe(true);
          const stats = await response.json();
          nativeHttpSamples.push({ sample, ...stats });
          expect(stats.nativeHttpFixture).toMatchObject({
            kind: "session-ux",
            followed: 30,
            visiblePanes: 4,
          });
          expect(stats.errors).toEqual([]);
          expect(stats.actualTaskWrites).toEqual([]);
          expect(stats.actualWebSocketInterception).toBe(false);
          expect(
            Object.keys(stats.httpVersions).some(
              (version) => version === "2.0" || version === "2",
            ),
          ).toBe(true);
          expect(stats.sse.connections).toBeGreaterThanOrEqual(3);
        } catch (error) {
          failures.push({
            sample,
            page: -1,
            error: `Native HTTP transport verification: ${String(error)}`,
          });
        }
      }
      await writeFile(
        info.outputPath("three-page-progress.json"),
        JSON.stringify(
          {
            baseURL,
            transport,
            nativeHttpSamples,
            completedRounds: sample + 1,
            requiredRounds,
            acceptanceEligible: !diagnostic,
            pageSamples,
            failures,
          },
          null,
          2,
        ),
      );
      // A failed environment load remains a failed sample, never replaced by a rerun.
      if (
        failures.length ||
        results.some((result) => result.status === "rejected")
      )
        break;
    } finally {
      await context.close();
      await Promise.all(fixtures.map((fixture) => fixture.stream.close()));
    }
  }
  const pages = pageSamples.map((samples) => ({
    navigation: percentile(samples.map((sample) => sample.navigation)),
    composer: percentile(samples.map((sample) => sample.composer)),
    correctTarget: percentile(samples.map((sample) => sample.target)),
    interactive: percentile(samples.map((sample) => sample.ready)),
    uncachedFourBodies: percentile(samples.map((sample) => sample.body)),
    inputTwoFrames: percentile(samples.map((sample) => sample.inputTwoFrames)),
  }));
  await writeFile(
    info.outputPath("three-page-performance.json"),
    JSON.stringify(
      {
        baseURL,
        transport,
        nativeFixtureProof,
        nativeHttpSamples,
        browserVersion: browser.version(),
        acceptanceEligible: !diagnostic,
        requiredRounds,
        load: { followed: 30, visiblePanes: 4, pages: 3 },
        pages,
        pageSamples,
        failures,
        boundary: nativeHttp
          ? "Fresh shared browser context each round, three simultaneous pages at one owned LAN HTTPS/H2 origin. API fixtures use actual HTTP middleware, native EventSource and the original HMR; no Page.route/Fetch interception or cache disabling. Standard Playwright Network observation remains. Normal cache/coalescing is allowed within each initially cold context. Same UI/read-client timings and thresholds; official daemon/model disk timing and physical phone excluded, bodies reported separately."
          : "Fresh shared browser context each round, three simultaneous LAN pages. Playwright route-based API isolation enables all-request Fetch interception and disables the whole HTTP cache; preserve this conservative result separately. Native EventSource retained. Same UI/read-client timings and thresholds; official daemon/model disk timing and physical phone excluded, bodies reported separately.",
      },
      null,
      2,
    ),
  );
  expect(failures).toEqual([]);
  for (const [index, page] of pages.entries()) {
    expect(page.interactive.count, `page ${index} samples`).toBe(
      requiredRounds,
    );
    expect(
      page.interactive.p95,
      `page ${index} interactive p95`,
    ).toBeLessThanOrEqual(2000);
    expect(
      page.inputTwoFrames.p95,
      `page ${index} input p95`,
    ).toBeLessThanOrEqual(100);
  }
});
