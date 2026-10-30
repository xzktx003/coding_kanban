import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

// The generic fixture blocks native/PTY sockets. This driver alone reconnects
// the exact frontend HMR endpoint so a dev run can assert zero console errors.
async function installPerformanceObservation(page: Page, baseURL: string) {
  const frontend = new URL(baseURL);
  const protocol = frontend.protocol === "https:" ? "wss:" : "ws:";
  const isHmr = (url: URL) =>
    url.protocol === protocol &&
    url.host === frontend.host &&
    !url.username &&
    !url.password &&
    url.pathname === "/";
  const ownHmr = new URL(frontend);
  ownHmr.protocol = protocol;
  ownHmr.pathname = "/";
  ownHmr.search = "?token=driver-predicate";
  const rejected = [
    `${protocol}//${frontend.host}/api/session/events`,
    `${protocol}//${frontend.host}/ws/terminal`,
    `${protocol}//user@${frontend.host}/`,
    `${protocol}//${frontend.hostname}:1/`,
    `${protocol}//other.invalid:${frontend.port}/`,
    `${protocol === "wss:" ? "ws:" : "wss:"}//${frontend.host}/`,
    frontend.href,
  ];
  expect(isHmr(ownHmr)).toBe(true);
  expect(rejected.map((url) => isHmr(new URL(url)))).toEqual(
    rejected.map(() => false),
  );
  const webSockets: Array<Record<string, unknown>> = [];
  const requests: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    requests.push({
      at: Date.now(),
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });
  page.on("websocket", (socket) => {
    const entry = {
      url: socket.url(),
      allowed: isHmr(new URL(socket.url())),
      openedAt: Date.now(),
      connectedAt: 0,
      closedAt: 0,
      errors: [] as string[],
    };
    webSockets.push(entry);
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        if (JSON.parse(payload).type === "connected")
          entry.connectedAt = Date.now();
      } catch {
        /* Other socket frames are not retained. */
      }
    });
    socket.on("socketerror", (error) => entry.errors.push(error));
    socket.on("close", () => {
      entry.closedAt = Date.now();
    });
  });
  await page.routeWebSocket(/.*/, (socket) => {
    if (isHmr(new URL(socket.url()))) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(() => {
    const longTasks: unknown[] = [];
    (window as any).__performanceLongTasks = longTasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.toJSON());
    }).observe({ type: "longtask", buffered: true });
  });
  return {
    predicate: {
      frontend: frontend.origin,
      protocol,
      pathname: "/",
      accepted: ownHmr.href,
      rejected,
    },
    webSockets,
    requests,
    snapshot: () =>
      page.evaluate(() => ({
        at: performance.now(),
        longTasks: (window as any).__performanceLongTasks,
        resources: performance
          .getEntriesByType("resource")
          .map((entry) => entry.toJSON()),
      })),
  };
}

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    p50: sorted[Math.floor(values.length / 2)],
    p95: sorted[Math.ceil(values.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};

for (const width of [1440, 393])
  test(`thirty fresh contexts measure actual cold input at ${width}px`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(240000);
    const samples: Array<Record<string, number>> = [];
    const contextErrors: Array<{
      index: number;
      pageErrors: string[];
      consoleErrors: string[];
      pageErrorCount: number;
      consoleErrorCount: number;
    }> = [];
    for (let i = 0; i < 30; i++) {
      const context = await browser.newContext({
        viewport: { width, height: 852 },
        ignoreHTTPSErrors: new URL(baseURL!).protocol === "https:",
      });
      const page = await context.newPage();
      const failures: string[] = [];
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
        failures.push(error.message);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
          failures.push(message.text());
        }
      });
      await installSessionUxFixture(page, 0);
      const observation = await installPerformanceObservation(page, baseURL!);
      await page.addInitScript(() => {
        performance.setResourceTimingBufferSize(10000);
        const metrics = ((window as any).__coldInput = {
          nav: 0,
          composer: 0,
          input: 0,
        });
        const observe = new MutationObserver(() => {
          if (!metrics.nav && document.querySelector(".session-top-nav"))
            metrics.nav = performance.now();
          if (
            !metrics.composer &&
            document
              .querySelector<HTMLElement>(
                ".session-codex-composer [contenteditable=true]",
              )
              ?.getClientRects().length
          )
            metrics.composer = performance.now();
          if (
            document.querySelector(
              ".session-codex-composer [contenteditable=true]",
            )?.textContent === "x"
          ) {
            metrics.input ||= performance.now();
            observe.disconnect();
          }
        });
        observe.observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      try {
        await page.goto(baseURL + "/?mode=session", {
          waitUntil: "domcontentloaded",
        });
        const editor = page
          .locator(".session-codex-composer [contenteditable=true]")
          .first();
        // Assertion polling backs off by hundreds of milliseconds, which can
        // dominate this cold-input measurement after the editor is usable.
        // React to its first visible frame, then measure a real key and DOM text.
        await page.waitForFunction(
          () => {
            const input = document.querySelector<HTMLElement>(
              ".session-codex-composer [contenteditable=true]",
            );
            return (
              input?.isContentEditable &&
              input.getClientRects().length > 0 &&
              getComputedStyle(input).visibility !== "hidden"
            );
          },
          undefined,
          { polling: "raf", timeout: 5000 },
        );
        await editor.press("x");
        await expect(editor).toHaveText("x");
        await expect
          .poll(() => page.evaluate(() => (window as any).__coldInput.input))
          .toBeGreaterThan(0);
        samples.push(
          await page.evaluate(() => {
            const entries = performance.getEntriesByType(
              "resource",
            ) as PerformanceResourceTiming[];
            return {
              ...(window as any).__coldInput,
              requests: entries.length,
              transferBytes: entries.reduce(
                (sum, value) => sum + value.transferSize,
                0,
              ),
            };
          }),
        );
        // Record errors only after the original measurement has completed.
        // Keep every sample, including an errored context, before asserting.
        const observed = {
          index: i,
          pageErrors: [...pageErrors],
          consoleErrors: [...consoleErrors],
          pageErrorCount: pageErrors.length,
          consoleErrorCount: consoleErrors.length,
        };
        contextErrors.push(observed);
        await writeFile(
          info.outputPath(`cold-context-${width}-${i}.json`),
          JSON.stringify(
            {
              baseURL,
              width,
              sample: samples[i],
              ...observed,
              observation: {
                ...observation,
                browser: await observation.snapshot(),
              },
            },
            null,
            2,
          ),
        );
        // Preserve completed measurements when a later context encounters an
        // environment/module-load failure; never count a partial run as 30.
        await writeFile(
          info.outputPath("cold-progress.json"),
          JSON.stringify(
            {
              baseURL,
              width,
              completed: samples.length,
              required: 30,
              samples,
              contextErrors,
            },
            null,
            2,
          ),
        );
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
      } catch (error) {
        await writeFile(
          info.outputPath(`cold-failure-${width}-${i}.json`),
          JSON.stringify(
            {
              baseURL,
              width,
              index: i,
              sample: samples[i],
              failures,
              pageErrors,
              consoleErrors,
              pageErrorCount: pageErrors.length,
              consoleErrorCount: consoleErrors.length,
              observation: {
                ...observation,
                browser: await observation.snapshot().catch(() => null),
              },
              error:
                error instanceof Error
                  ? { name: error.name, message: error.message }
                  : String(error),
              boundary: await page
                .evaluate(
                  () =>
                    document.querySelector(".workbench-error-details")
                      ?.textContent ?? null,
                )
                .catch(() => null),
            },
            null,
            2,
          ),
        );
        throw error;
      } finally {
        await context.close();
      }
    }
    const result = {
      baseURL,
      width,
      samples,
      contextErrors,
      pageErrorCount: contextErrors.reduce(
        (sum, value) => sum + value.pageErrorCount,
        0,
      ),
      consoleErrorCount: contextErrors.reduce(
        (sum, value) => sum + value.consoleErrorCount,
        0,
      ),
      navigation: summary(samples.map((value) => value.nav)),
      composer: summary(samples.map((value) => value.composer)),
      actualInput: summary(samples.map((value) => value.input)),
      boundary:
        "Fresh browser contexts on one Chromium instance, LAN frontend and isolated immediate API; size simulation, not physical phone/network or provider timing.",
    };
    await writeFile(
      info.outputPath("cold-performance.json"),
      JSON.stringify(result, null, 2),
    );
    expect(result.actualInput.count).toBe(30);
    expect(result.contextErrors).toHaveLength(30);
    expect(
      samples.every(
        (sample) => sample.nav > 0 && sample.composer > 0 && sample.input > 0,
      ),
    ).toBe(true);
    expect(result.actualInput.p95).toBeLessThanOrEqual(2000);
  });

test("thirty actual tab clicks measure matching body, saved draft and keyboard input", async ({
  page,
  baseURL,
  browser,
}, info) => {
  test.setTimeout(120000);
  const fixture = await installSessionUxFixture(page, 30);
  const observation = await installPerformanceObservation(page, baseURL!);
  const stream = await liveStream(page, baseURL!);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  for (const thread of fixture.threads)
    (thread as any).turns = Array.from(
      { length: thread.id === "ux-0" ? 10000 : 1 },
      (_, i) => ({
        id: `${thread.id}-turn-${i}`,
        status: "completed",
        startedAt: i + 1,
        durationMs: 1,
        items: [
          {
            id: `${thread.id}-reply-${i}`,
            type: "agentMessage",
            text: `sample ${thread.id} message ${i}`,
          },
        ],
      }),
    );
  await page.addInitScript((cards) => {
    localStorage.setItem(
      "kanban.session.agent-center-store",
      JSON.stringify({
        version: 5,
        state: {
          cards,
          currentAgentCardId: "ux-1",
          currentAgentCardKind: "codex",
          cardsViewMode: "solo",
          sharedTabsInitialized: true,
        },
      }),
    );
    localStorage.setItem(
      "kanban.session.layout-storage",
      JSON.stringify({
        version: 0,
        state: { view: "agent", isSidebarOpen: false, isRightPanelOpen: false },
      }),
    );
  }, cards);
  const tab = (id: number) =>
    page.locator(
      `[role=tab][data-tab-key="codex:ux-${id}"] .session-identity-title`,
    );
  const editor = page
    .locator(".session-codex-composer [contenteditable=true]")
    .first();
  try {
    await page.goto("/?mode=session");
    // Vite injects this module into development HTML; preview serves built HTML.
    const expectsViteHmr = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLScriptElement>(
          'script[type="module"][src]',
        ),
      ].some((script) => {
        const url = new URL(script.src, location.href);
        return (
          url.origin === location.origin && url.pathname === "/@vite/client"
        );
      }),
    );
    if (expectsViteHmr)
      await expect
        .poll(() =>
          observation.webSockets.some(
            (socket) =>
              socket.allowed === true &&
              typeof socket.connectedAt === "number" &&
              socket.connectedAt > 0 &&
              Array.isArray(socket.errors) &&
              socket.errors.length === 0,
          ),
        )
        .toBe(true);
    for (const id of [0, 1]) {
      await tab(id).click();
      await expect(
        page.getByText(`sample ux-${id} message ${id ? 0 : 9999}`, {
          exact: true,
        }),
      ).toBeVisible();
      await editor.fill(`draft ux-${id}`);
    }
    await page.evaluate(() => {
      const metrics = ((window as any).__publicInput = {
        switches: [],
        inputs: [],
        inputDetails: [],
      });
      document.addEventListener(
        "pointerdown",
        (event) => {
          const tab = (event.target as Element)?.closest<HTMLElement>(
            "[role=tab][data-tab-key]",
          );
          if (!tab) return;
          const id = tab.dataset.tabKey!.slice("codex:".length);
          const previous = metrics.switches.at(-1);
          if (previous && !previous.settledAt) previous.invalid = "superseded";
          const entry = {
            index: metrics.switches.length,
            id,
            start: performance.now(),
            body: 0,
            draft: 0,
            bodyAt: 0,
            draftAt: 0,
            settledAt: 0,
            invalid: "",
          };
          metrics.switches.push(entry);
          const check = () => {
            if (metrics.switches.at(-1) !== entry) {
              entry.invalid = "superseded";
              return;
            }
            const correct = [
              ...document.querySelectorAll<HTMLElement>(".thread-surface"),
            ].some(
              (surface) =>
                surface.getClientRects().length &&
                surface.textContent?.includes(
                  `sample ${id} message ${id === "ux-0" ? 9999 : 0}`,
                ),
            );
            if (!entry.body && correct) {
              entry.bodyAt = performance.now();
              entry.body = entry.bodyAt - entry.start;
            }
            const input = document.querySelector<HTMLElement>(
              ".session-codex-composer [contenteditable=true]",
            );
            if (
              !entry.draft &&
              correct &&
              input?.textContent === `draft ${id}`
            ) {
              entry.draftAt = performance.now();
              entry.draft = entry.draftAt - entry.start;
            }
            if (entry.body && entry.draft) entry.settledAt = performance.now();
            if (
              (!entry.body || !entry.draft) &&
              performance.now() - entry.start < 5000
            )
              requestAnimationFrame(check);
            else if (!entry.settledAt) entry.invalid = "readiness-timeout";
          };
          requestAnimationFrame(check);
        },
        true,
      );
      document.addEventListener("keydown", (event) => {
        if (
          event.key !== "x" ||
          !(event.target as Element)?.closest("[contenteditable=true]")
        )
          return;
        const start = performance.now();
        const owner = metrics.switches.at(-1);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const settledAt = performance.now();
            metrics.inputs.push(settledAt - start);
            metrics.inputDetails.push({
              index: owner.index,
              id: owner.id,
              start,
              settledAt,
              invalid: metrics.switches.at(-1) !== owner ? "superseded" : "",
            });
          }),
        );
      });
    });
    for (let i = 0; i < 30; i++) {
      const id = i % 2;
      await tab(id).click();
      await expect(editor).toHaveText(`draft ux-${id}`);
      await expect(
        page.getByText(`sample ux-${id} message ${id ? 0 : 9999}`, {
          exact: true,
        }),
      ).toBeVisible();
      // Complete this pointerdown's RAF observation before changing its draft
      // or clicking the same ID again. Never let a later click repair a sample.
      await page.waitForFunction(
        ({ index, id }) => {
          const metrics = (window as any).__publicInput;
          const entry = metrics.switches[index];
          return (
            metrics.switches.length === index + 1 &&
            entry?.index === index &&
            entry.id === id &&
            (entry.invalid ||
              (entry.body > 0 && entry.draft > 0 && entry.settledAt > 0))
          );
        },
        { index: i, id: `ux-${id}` },
        { polling: "raf", timeout: 6000 },
      );
      const entry = await page.evaluate(
        (index) => (window as any).__publicInput.switches[index],
        i,
      );
      expect(entry.invalid).toBe("");
      await editor.press("End");
      await editor.press("x");
      await expect(editor).toHaveText(`draft ux-${id}x`);
      await page.waitForFunction(
        (count) => (window as any).__publicInput.inputs.length === count,
        i + 1,
        { polling: "raf", timeout: 5000 },
      );
      await editor.press("Backspace");
    }
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__publicInput.inputs.length),
      )
      .toBe(30);
    const samples = await page.evaluate(() => (window as any).__publicInput);
    const result = {
      baseURL,
      browserVersion: browser.version(),
      expectsViteHmr,
      messages: 10000,
      followed: 30,
      samples,
      body: summary(samples.switches.map((value: any) => value.body)),
      draft: summary(samples.switches.map((value: any) => value.draft)),
      input: summary(samples.inputs),
      pageErrors: errors,
      consoleErrors,
      pageErrorCount: errors.length,
      consoleErrorCount: consoleErrors.length,
      observation: { ...observation, browser: await observation.snapshot() },
      boundary:
        "Correct visible body and saved draft ready together; pointerdown to this click's RAF, keydown to two RAFs. Every sample settles before the next gesture.",
    };
    await writeFile(
      info.outputPath("public-performance.json"),
      JSON.stringify(result, null, 2),
    );
    expect(samples.switches).toHaveLength(30);
    expect(
      samples.switches.every(
        (value: any, index: number) =>
          value.index === index &&
          value.id === `ux-${index % 2}` &&
          value.body > 0 &&
          value.draft > 0 &&
          value.settledAt > 0 &&
          !value.invalid,
      ),
    ).toBe(true);
    expect(result.body.p95).toBeLessThanOrEqual(300);
    expect(result.draft.p95).toBeLessThanOrEqual(300);
    expect(result.input.p95).toBeLessThanOrEqual(100);
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(
      observation.webSockets.flatMap((socket) =>
        Array.isArray(socket.errors) ? socket.errors : [],
      ),
    ).toEqual([]);
    expect(
      samples.inputDetails.every(
        (value: any, index: number) =>
          value.index === index &&
          value.id === `ux-${index % 2}` &&
          !value.invalid,
      ),
    ).toBe(true);
    expect(
      fixture.calls.filter((call) =>
        /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback))$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
  } catch (error) {
    await writeFile(
      info.outputPath("public-performance-failure.json"),
      JSON.stringify(
        {
          baseURL,
          error: error instanceof Error ? error.message : String(error),
          pageErrors: errors,
          consoleErrors,
          samples: await page
            .evaluate(() => (window as any).__publicInput)
            .catch(() => null),
          observation: {
            ...observation,
            browser: await observation.snapshot().catch(() => null),
          },
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await page.close();
    await stream.close();
  }
});
