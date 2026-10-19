import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";

const draftName = "kanban.session.text-drafts";
const input = (page: Page) =>
  page.locator(".session-agent-view [contenteditable=true]").first();

async function instrumentDraftWrites(page: Page, seedLegacy = false) {
  await page.addInitScript(
    ({ name, seedLegacy }) => {
      if (seedLegacy && !localStorage.getItem("input-budget-fixture-seeded")) {
        const drafts = Object.fromEntries(
          Array.from({ length: 300 }, (_, index) => [
            JSON.stringify(["codex", "", "session", `old-${index}`]),
            { text: "x".repeat(5000), revision: 1 },
          ]),
        );
        localStorage.setItem(
          name,
          JSON.stringify({
            version: 1,
            state: { drafts, migrated: ["codex"] },
          }),
        );
        localStorage.setItem("input-budget-fixture-seeded", "1");
      }
      const metrics = {
        writes: [] as { name: string; bytes: number }[],
        keyToFrameMs: [] as number[],
      };
      (window as any).__inputBudget = metrics;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key.startsWith(name))
          metrics.writes.push({ name: key, bytes: String(value).length * 2 });
        return original.call(this, key, value);
      };
      document.addEventListener("keydown", (event) => {
        if (!(event.target as Element)?.closest("[contenteditable=true]"))
          return;
        const started = performance.now();
        requestAnimationFrame(() =>
          metrics.keyToFrameMs.push(performance.now() - started),
        );
      });
    },
    { name: draftName, seedLegacy },
  );
}

async function selectOwner(page: Page, index: number) {
  await expect(input(page)).toBeVisible({ timeout: 30000 });
  await page.evaluate(async (index) => {
    const live = (path: string) => {
      const entry = performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path);
      if (!entry) throw new Error(`Mounted store URL missing: ${path}`);
      return import(entry.name);
    };
    const { useCodexStore } = await live(
      "/src/session-mode/components/codex/stores/index.ts",
    );
    const { useAgentCenterStore } = await live(
      "/src/session-mode/stores/useAgentCenterStore.ts",
    );
    const { useSessionSplitStore } = await live(
      "/src/session-mode/stores/useSessionSplitStore.ts",
    );
    const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
    const id = `ux-${index}`;
    useAgentCenterStore.setState({
      cards: Array.from({ length: 3 }, (_, index) => ({
        kind: "codex",
        id: `ux-${index}`,
        cwd,
        preview: `中文会话 ${index}`,
      })),
      currentAgentCardId: id,
      currentAgentCardKind: "codex",
      cardsViewMode: "solo",
    });
    useCodexStore.setState({ currentThreadId: id });
    useSessionSplitStore.getState().focusKey(`codex:${id}`);
    if (useCodexStore.getState().currentThreadId !== id)
      throw new Error("Mounted input target was not selected");
  }, index);
  const tab = page.locator(`[role=tab][data-tab-key="codex:ux-${index}"]`);
  // Use the shipped navigation once the card exists, after effects from fixture
  // initialization have finished reconciling an initially empty split group.
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function prepare(
  page: Page,
  seedLegacy = false,
  beforeNavigation?: (
    fixture: Awaited<ReturnType<typeof installSessionUxFixture>>,
  ) => Promise<void>,
) {
  const fixture = await installSessionUxFixture(page, 3);
  await instrumentDraftWrites(page, seedLegacy);
  // Every page sees the same fixture tabs, with no connection to the real service.
  await page.route("**/api/session/tabs", (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    return route.fulfill({
      json: {
        initialized: true,
        revision: 1,
        sequence: body?.operations?.at(-1)?.seq ?? 0,
        cards: fixture.threads.map((thread) => ({
          kind: "codex",
          id: thread.id,
          cwd: thread.cwd,
          preview: thread.name,
        })),
      },
    });
  });
  await beforeNavigation?.(fixture);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await expect(input(page)).toBeVisible({ timeout: 30000 });
  await seedSessionUx(page, 3);
  return fixture;
}

function assertNoTaskDispatch(calls: { path: string }[]) {
  expect(
    calls.filter((call) =>
      /thread\/resume|turn\/(start|interrupt)|followups\/(submit|stop)|\/stop$/.test(
        call.path,
      ),
    ),
  ).toEqual([]);
}

test("Lexical typing writes only the edited owner despite 300 large legacy drafts", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const fixture = await prepare(page, true);
  await selectOwner(page, 0);
  await expect(input(page)).toHaveText("");
  await page.evaluate(() => {
    (window as any).__inputBudget.writes = [];
    (window as any).__inputBudget.keyToFrameMs = [];
  });
  const text = "task draft remains responsive";
  await input(page).pressSequentially(text, { delay: 20 });
  await expect(input(page)).toHaveText(text);
  const metrics = await page.evaluate(() => {
    const metrics = (window as any).__inputBudget;
    return {
      writes: metrics.writes,
      totalWriteBytes: metrics.writes.reduce(
        (sum: number, write: { bytes: number }) => sum + write.bytes,
        0,
      ),
      maxWriteBytes: Math.max(
        0,
        ...metrics.writes.map((write: { bytes: number }) => write.bytes),
      ),
      keyToFrameMs: metrics.keyToFrameMs,
      // UTF-16 storage payload bytes; timings are synthetic key-to-next-frame observations.
      legacyDraftCount: 300,
      legacyCharsPerDraft: 5000,
    };
  });
  const metricsPath = info.outputPath("input-persistence-metrics.json");
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await info.attach("input-persistence-metrics", {
    path: metricsPath,
    contentType: "application/json",
  });
  console.log(
    JSON.stringify({
      totalWriteBytes: metrics.totalWriteBytes,
      maxWriteBytes: metrics.maxWriteBytes,
      writeCount: metrics.writes.length,
      maxKeyToFrameMs: Math.max(...metrics.keyToFrameMs),
    }),
  );
  expect(metrics.writes.length).toBeGreaterThan(0);
  expect(metrics.maxWriteBytes).toBeLessThan(8 * 1024);
  expect(metrics.totalWriteBytes).toBeLessThan(64 * 1024);
  await page.reload({ waitUntil: "domcontentloaded" });
  await selectOwner(page, 0);
  await expect(input(page)).toHaveText(text);
  const retainedLegacyOwners = await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionDraftStore.ts";
    const entry = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === path);
    if (!entry) throw new Error("Mounted draft store URL missing");
    const { useSessionDraftStore } = await import(entry.name);
    const drafts = useSessionDraftStore.getState().drafts;
    return Array.from(
      { length: 300 },
      (_, index) =>
        drafts[JSON.stringify(["codex", "", "session", `old-${index}`])]
          ?.text === "x".repeat(5000),
    ).filter(Boolean).length;
  });
  expect(retainedLegacyOwners).toBe(300);
  assertNoTaskDispatch(fixture.calls);
});

const inputSoakMinutes = Number(process.env.SESSION_INPUT_SOAK_MINUTES ?? 0);
test("aged three-page native streams preserve responsive independent input with natural GC", async ({
  context,
  baseURL,
}, info) => {
  test.skip(
    inputSoakMinutes === 0,
    "Set SESSION_INPUT_SOAK_MINUTES=10 for the real-time input soak",
  );
  if (!Number.isFinite(inputSoakMinutes) || inputSoakMinutes <= 0)
    throw new Error(
      "SESSION_INPUT_SOAK_MINUTES must be a positive finite number",
    );
  test.setTimeout(inputSoakMinutes * 60000 + 180000);
  const pages = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  const streams: Awaited<ReturnType<typeof liveStream>>[] = [];
  const fixtures: Awaited<ReturnType<typeof installSessionUxFixture>>[] = [];
  const errors: { page: number; error: string }[] = [];
  const sequences = [0, 0, 0];
  const texts = ["", "", ""];
  const samples: unknown[] = [];
  const typingRounds: unknown[] = [];
  let cycles = 0;
  let emittedDataFrameBytes = 0;
  let started = 0;
  let agingSeconds = 0;
  let completed = false;
  const browserCdp = await context.browser()!.newBrowserCDPSession();
  const pageCdps = await Promise.all(
    pages.map((page) => context.newCDPSession(page)),
  );
  const resultPath = info.outputPath("three-page-input-soak.json");
  try {
    for (let index = 0; index < pages.length; index++) {
      pages[index].on("pageerror", (error) =>
        errors.push({ page: index, error: error.message }),
      );
      fixtures.push(
        await prepare(pages[index], true, async (fixture) => {
          // Status polling carries metadata only, with transcript reads served by
          // the fixture's durable, bounded turns below.
          await pages[index].route(
            /\/api\/codex\/thread\/list(?:\?.*)?$/,
            (route) =>
              route.fulfill({
                json: {
                  data: fixture.threads.map((thread) => ({
                    ...thread,
                    turns: [],
                  })),
                  nextCursor: null,
                },
              }),
          );
          streams[index] = await liveStream(pages[index], baseURL!);
        }),
      );
      await selectOwner(pages[index], index);
      await expect
        .poll(() => streams[index].connections(), { timeout: 30000 })
        .toBeGreaterThan(0);
      await pages[index].evaluate(() => {
        (window as any).__inputBudget.writes = [];
        (window as any).__inputBudget.keyToFrameMs = [];
      });
    }
    started = Date.now();
    let lastTypingMinute = -1;
    let lastSampleAt = -10000;
    while (Date.now() - started < inputSoakMinutes * 60000) {
      for (let index = 0; index < pages.length; index++) {
        const target = fixtures[index].threads[index] as any;
        const turn = {
          id: `input-soak-${index}-${cycles}`,
          status: "completed",
          startedAt: Math.floor(Date.now() / 1000),
          durationMs: 1,
          items: [
            {
              type: "agentMessage",
              id: `answer-${index}-${cycles}`,
              text: `Native input soak ${index}:${cycles} ${"bounded reply ".repeat(80)}`,
            },
          ],
        };
        const emit = (payload: unknown) => {
          const seq = ++sequences[index];
          emittedDataFrameBytes +=
            Buffer.byteLength(
              `data: ${JSON.stringify({ seq, event: "codex:notification", payload })}\n\n`,
            ) * streams[index].connections();
          streams[index].emit(seq, payload);
        };
        target.status = { type: "active", activeFlags: [] };
        emit({
          method: "turn/started",
          params: {
            threadId: target.id,
            turn: { ...turn, status: "inProgress", items: [] },
          },
        });
        for (let chunk = 0; chunk < 8; chunk++)
          emit({
            method: "item/agentMessage/delta",
            params: {
              threadId: target.id,
              turnId: turn.id,
              itemId: turn.items[0].id,
              delta: `${chunk}:${"live ".repeat(50)}`,
            },
          });
        target.turns = [...target.turns, turn].slice(-40);
        target.status = { type: "idle" };
        target.updatedAt = Math.floor(Date.now() / 1000);
        emit({
          method: "turn/completed",
          params: { threadId: target.id, turn },
        });
      }
      const minute = Math.floor((Date.now() - started) / 60000);
      if (minute > lastTypingMinute) {
        for (let offset = 0; offset < pages.length; offset++) {
          const index = (minute + offset) % pages.length;
          await pages[index].bringToFront();
          const addition = `m${minute} `;
          await input(pages[index]).pressSequentially(addition, { delay: 20 });
          texts[index] += addition;
          await expect(input(pages[index])).toHaveText(texts[index]);
          const metrics = await pages[index].evaluate(() => {
            const m = (window as any).__inputBudget;
            const timings = [...m.keyToFrameMs].sort(
              (a: number, b: number) => a - b,
            );
            return {
              writes: m.writes.length,
              totalWriteBytes: m.writes.reduce(
                (sum: number, write: { bytes: number }) => sum + write.bytes,
                0,
              ),
              maxWriteBytes: Math.max(
                0,
                ...m.writes.map((write: { bytes: number }) => write.bytes),
              ),
              keyToFrameMs: timings,
              keySamples: timings.length,
              p50Ms: timings[Math.ceil(timings.length * 0.5) - 1],
              p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
              maxMs: timings.at(-1),
            };
          });
          typingRounds.push({
            seconds: (Date.now() - started) / 1000,
            minute,
            page: index,
            ...metrics,
          });
          expect(metrics.maxWriteBytes).toBeLessThan(8 * 1024);
          expect(metrics.totalWriteBytes).toBeLessThan(64 * 1024);
        }
        console.log(
          JSON.stringify({
            phase: "three-page-input-soak",
            minute,
            cycles,
            seconds: (Date.now() - started) / 1000,
            latestTyping: typingRounds.slice(-3),
          }),
        );
        lastTypingMinute = minute;
      }
      if (Date.now() - started - lastSampleAt >= 10000) {
        const heaps = await Promise.all(
          pageCdps.map(async (cdp, page) => ({
            page,
            ...(await cdp.send("Runtime.getHeapUsage")),
          })),
        );
        const processInfo = await browserCdp.send("SystemInfo.getProcessInfo");
        const memory =
          process.platform === "linux"
            ? sampleRendererRss(processInfo.processInfo)
            : { rendererProcesses: [] };
        samples.push({
          seconds: (Date.now() - started) / 1000,
          heaps,
          ...memory,
          rendererRssScope: "all-renderers-in-this-three-page-browser",
        });
        lastSampleAt = Date.now() - started;
      }
      cycles++;
      await pages[0].waitForTimeout(
        Math.min(
          2000,
          Math.max(0, inputSoakMinutes * 60000 - (Date.now() - started)),
        ),
      );
    }
    agingSeconds = (Date.now() - started) / 1000;
    for (let index = 0; index < pages.length; index++) {
      await pages[index].bringToFront();
      await expect(input(pages[index])).toHaveText(texts[index]);
      await expect
        .poll(() =>
          pages[index].evaluate(async (index) => {
            const path = "/src/session-mode/components/codex/stores/index.ts";
            const entry = performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path);
            if (!entry) throw new Error("Mounted Codex store URL missing");
            const { useCodexStore } = await import(entry.name);
            return useCodexStore.getState().turnTimingMap[`ux-${index}`]
              ?.turnId;
          }, index),
        )
        .toBe(`input-soak-${index}-${cycles - 1}`);
    }
    // Reload only after the entire natural-GC aging window; never as recovery
    // during the load or to reduce its resource measurements.
    const recovered = [];
    for (let index = 0; index < pages.length; index++) {
      await pages[index].reload({ waitUntil: "domcontentloaded" });
      await selectOwner(pages[index], index);
      await expect(input(pages[index])).toHaveText(texts[index]);
      recovered.push(await input(pages[index]).textContent());
    }
    expect(recovered).toEqual(texts);
    fixtures.forEach((fixture) => assertNoTaskDispatch(fixture.calls));
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          completed,
          requestedMinutes: inputSoakMinutes,
          loadSeconds:
            agingSeconds || (started ? (Date.now() - started) / 1000 : 0),
          elapsedIncludingRecoverySeconds: started
            ? (Date.now() - started) / 1000
            : 0,
          cycles,
          sequences,
          emittedDataFrameBytes,
          streams: streams.map((stream) => ({
            opens: stream.opens(),
            connections: stream.connections(),
          })),
          expectedDrafts: texts,
          typingRounds,
          samples,
          errors,
          measurementBoundary:
            "Natural GC; no reload during aging. Heap is per page target; RSS is all browser renderers with PID/startTicks identities. Ten minutes does not replace the standard thirty-minute soak.",
        },
        null,
        2,
      ),
    );
    await info.attach("three-page-input-soak", {
      path: resultPath,
      contentType: "application/json",
    });
    await Promise.all(pageCdps.map((cdp) => cdp.detach()));
    await browserCdp.detach();
    await Promise.all(streams.map((stream) => stream.close()));
    await Promise.all(pages.map((page) => page.close()));
  }
});

test("three pages preserve independent owner drafts after interleaved typing and reload", async ({
  context,
}, info) => {
  test.setTimeout(120000);
  const pages = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  const fixtures = [];
  try {
    for (let index = 0; index < pages.length; index++) {
      fixtures.push(await prepare(pages[index]));
      await selectOwner(pages[index], index);
    }
    const texts = [
      "page A independent draft",
      "page B independent draft",
      "page C independent draft",
    ];
    for (let index = 0; index < pages.length; index++) {
      await pages[index].bringToFront();
      await input(pages[index]).pressSequentially(texts[index], { delay: 20 });
      await expect(input(pages[index])).toHaveText(texts[index]);
    }
    for (const index of [1, 0, 2]) {
      await pages[index].bringToFront();
      await input(pages[index]).pressSequentially(" final", { delay: 20 });
      texts[index] += " final";
      await expect(input(pages[index])).toHaveText(texts[index]);
    }
    const recovered = [];
    for (let index = 0; index < pages.length; index++) {
      await pages[index].reload({ waitUntil: "domcontentloaded" });
      await selectOwner(pages[index], index);
      recovered.push(await input(pages[index]).textContent());
    }
    const recoveryPath = info.outputPath("cross-page-draft-recovery.json");
    await writeFile(
      recoveryPath,
      JSON.stringify({ expected: texts, recovered }, null, 2),
    );
    await info.attach("cross-page-draft-recovery", {
      path: recoveryPath,
      contentType: "application/json",
    });
    expect(recovered).toEqual(texts);
    fixtures.forEach((fixture) => assertNoTaskDispatch(fixture.calls));
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
});
