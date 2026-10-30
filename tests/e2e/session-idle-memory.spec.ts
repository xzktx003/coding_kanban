import { writeFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { sampleRendererRss } from "../../scripts/session-renderer-memory.mjs";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

type RendererMemory = {
  rendererRssBytes?: number;
  rendererProcesses: Array<{
    pid: number;
    startTicks: string;
    rssBytes: number;
  }>;
};
type RssSamplingError = { phase: string; error: string };

function rendererMemory(
  processes: Array<{ id: number; type: string }>,
  errors: RssSamplingError[],
  phase: string,
): RendererMemory {
  if (process.platform !== "linux") return { rendererProcesses: [] };
  try {
    return sampleRendererRss(processes);
  } catch (error) {
    errors.push({ phase, error: String(error) });
    throw error;
  }
}

async function setup(page: Page, baseURL: string, warmFollowedSessions?: boolean) {
  const fixture = await installSessionUxFixture(page, 3);
  for (const thread of fixture.threads) {
    (thread as any).turns = Array.from({ length: 8 }, (_, i) => ({
      id: `${thread.id}-${i}`,
      status: "completed",
      startedAt: i + 1,
      durationMs: 1,
      items: [
        {
          type: "agentMessage",
          id: `answer-${i}`,
          text: `${thread.id} answer ${i}\n${"history ".repeat(8000)}`,
        },
      ],
    }));
  }
  // The status-only native list never transports transcript bodies. Keep the
  // fixture's durable history in thread/read and turns/list, not status polling.
  await page.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        data: fixture.threads.map((t) => ({ ...t, turns: [] })),
        nextCursor: null,
      },
    });
  });
  const cards = fixture.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({
      json: { cards, initialized: true, revision: 1, sequence: 0 },
    }),
  );
  await page.addInitScript(
    ({ cards, warmFollowedSessions }) => {
      // Undefined exercises a new device without a persisted retention choice.
      // Do not seed false and mistake it for proof of the product default.
      if (warmFollowedSessions !== undefined)
        localStorage.setItem(
          "kanban.session.settings-storage",
          JSON.stringify({ version: 13, state: { warmFollowedSessions } }),
        );
      else if (localStorage.getItem("kanban.session.settings-storage") !== null)
        throw new Error("Default-retention fixture requires empty settings storage");
      (window as any).__idleMemoryInitialSettings = localStorage.getItem(
        "kanban.session.settings-storage",
      );
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
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
          state: {
            isSidebarOpen: false,
            isRightPanelOpen: false,
            view: "agent",
          },
        }),
      );
    },
    { cards, warmFollowedSessions },
  );
  const stream = await liveStream(page, baseURL);
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(async () => {
      const path = "/src/session-mode/components/codex/stores/index.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
      const { useCodexStore } = await import(url);
      return ["ux-0", "ux-1", "ux-2"].every(
        (id) => useCodexStore.getState().events[id]?.length,
      );
    }), {timeout:45_000}).toBe(true);
    await expect(
      page.locator('[data-codex-transcript-shell="ux-0"]'),
    ).toBeVisible({ timeout: 45_000 });
    await page.evaluate(async () => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const { useCodexStore, useApprovalStore } = await module(
        "/src/session-mode/components/codex/stores/index.ts",
      );
      const { useSessionDraftStore } = await module(
        "/src/session-mode/stores/useSessionDraftStore.ts",
      );
      const { useSessionAttentionStore } = await module(
        "/src/session-mode/stores/useSessionAttentionStore.ts",
      );
      const { estimateTranscriptBytes } = await module(
        "/src/session-mode/services/codexTranscriptMemoryBudget.ts",
      );
      (window as any).__idleMemory = {
        codex: useCodexStore,
        approvals: useApprovalStore,
        drafts: useSessionDraftStore,
        attention: useSessionAttentionStore,
        estimateTranscriptBytes,
      };
      useSessionDraftStore
        .getState()
        .setText("memory-fixture-draft", "keep my unsent draft");
      useApprovalStore.setState({
        pendingApprovals: [
          {
            type: "commandExecution",
            requestId: "memory-fixture-approval",
            threadId: "ux-1",
            turnId: "running",
            itemId: "command",
          },
        ],
      });
    });
    return { fixture, stream };
  } catch (error) {
    await stream.close();
    throw error;
  }
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const w = (window as any).__idleMemory;
    const state = w.codex.getState();
    return {
      counts: Object.fromEntries(
        Object.entries(state.events).map(([id, es]: [string, any]) => [
          id,
          es.length,
        ]),
      ),
      streaming: Object.keys(state.streamingAgentMessages),
      timing: state.turnTimingMap,
      bodyBytes: Object.fromEntries(
        Object.entries(state.events).map(([id, events]) => [
          id,
          w.estimateTranscriptBytes(events),
        ]),
      ),
      approvals: w.approvals.getState().pendingApprovals.length,
      draft: w.drafts.getState().drafts["memory-fixture-draft"]?.text,
      unread: w.attention.getState().receipts["codex:ux-1"],
    };
  });
}
async function select(page: Page, id: string) {
  const tab = page.locator(`[data-tab-key="codex:${id}"]`).first();
  await tab.scrollIntoViewIfNeeded();
  await tab.click({ position: { x: 20, y: 12 } });
}

async function observeAudioContexts(cdp: CDPSession) {
  const active = new Set<string>();
  let created = 0;
  let peakActive = 0;
  cdp.on("WebAudio.contextCreated", ({ context }) => {
    created++;
    if (context.contextState !== "closed") active.add(context.contextId);
    peakActive = Math.max(peakActive, active.size);
  });
  cdp.on("WebAudio.contextChanged", ({ context }) => {
    if (context.contextState === "closed") active.delete(context.contextId);
  });
  cdp.on("WebAudio.contextWillBeDestroyed", ({ contextId }) =>
    active.delete(contextId),
  );
  await cdp.send("WebAudio.enable");
  return () => ({ created, active: active.size, peakActive });
}

for (const warm of [undefined, true, false])
  test(
    warm === undefined
      ? "default no-persisted-choice keeps recent pages warm then pressure reclaims invisible bodies while native completions and read-only reactivation survive"
      : warm
        ? "bounded recent pages stay warm then pressure reclaims invisible bodies while native completions and read-only reactivation survive"
        : "device-local opt-out restores sixty-second physical release while native completions and read-only reactivation survive",
    async ({ page, context, baseURL }, info) => {
      const expectsWarm = warm !== false;
      test.setTimeout(210_000);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const { fixture, stream } = await setup(page, baseURL!, warm);
      const cdp = await context.newCDPSession(page);
      const audio = await observeAudioContexts(cdp);
      const browserCdp = await context.browser()!.newBrowserCDPSession();
      const started = Date.now(),
        observations: unknown[] = [];
      const rssSamplingErrors: RssSamplingError[] = [];
      let retentionPolicy:
        | { actualWarm: boolean; initialSettings: string | null }
        | undefined;
      const observe = async (phase: string) => {
        const heap = await cdp.send("Runtime.getHeapUsage");
        const processes = await browserCdp.send("SystemInfo.getProcessInfo");
        const memory = rendererMemory(
          processes.processInfo,
          rssSamplingErrors,
          phase,
        );
        observations.push({
          phase,
          seconds: (Date.now() - started) / 1000,
          heapBytes: heap.usedSize,
          backingStorageBytes: heap.backingStorageSize,
          ...memory,
          rendererRssBytes: memory.rendererRssBytes ?? null,
          rendererRssScope: "all-browser-renderers",
          snapshot: await snapshot(page),
        });
      };
      try {
        retentionPolicy = await page.evaluate(async () => {
          const path = "/src/session-mode/stores/settings/useSettingsStore.ts";
          const { useSettingsStore } = await import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
              path
          );
          return {
            actualWarm: useSettingsStore.getState().warmFollowedSessions,
            initialSettings: (window as any).__idleMemoryInitialSettings,
          };
        });
        expect(retentionPolicy.actualWarm).toBe(expectsWarm);
        if (warm === undefined)
          expect(retentionPolicy.initialSettings).toBeNull();
        else
          expect(
            JSON.parse(retentionPolicy.initialSettings!).state
              .warmFollowedSessions,
          ).toBe(warm);
        // Absence before the initial read is not evidence of idle-body reclamation.
        // Prove both background transcripts were populated before timing expiry.
        for (const id of ["ux-1", "ux-2"])
          await expect
            .poll(async () => (await snapshot(page)).counts[id])
            .toBeGreaterThan(0);
        await observe("visible-and-background");
        let pressureSequence = 0;
        if (expectsWarm) {
          // Resource-sufficient followed pages stay warm beyond the former grace.
          // Keep real time, normal lifecycle and actual body preconditions: no fake
          // timers, direct release call or forced GC can masquerade as reclamation.
          await page.waitForTimeout(120_000);
          for (const id of ["ux-1", "ux-2"])
            expect((await snapshot(page)).counts[id]).toBeGreaterThan(0);
          await observe("resource-sufficient-warm-120s");
          // Exercise the existing incoming-display-traffic pressure detector with
          // actual completed-item EventSource snapshots. Live deltas are clipped and
          // coalesced before this detector, so a burst of one live item is not a valid
          // pressure precondition. Every frame remains below the 16 MiB ceiling.
          for (let i = 0; i < 9; i++)
            stream.emit(++pressureSequence, {
              method: "item/completed",
              params: {
                threadId: "ux-0",
                turnId: "pressure-probe",
                item: {
                  type: "agentMessage",
                  id: "pressure-reply",
                  text: "p".repeat(1024 * 1024),
                },
              },
            });
          const pressureTurn = {
            id: "pressure-probe",
            status: "completed",
            startedAt: Math.floor(Date.now() / 1000),
            durationMs: 1,
            items: [
              {
                type: "agentMessage",
                id: "pressure-reply",
                text: "Bounded pressure probe complete",
              },
            ],
          };
          (fixture.threads[0] as any).turns.push(pressureTurn);
          stream.emit(++pressureSequence, {
            method: "turn/completed",
            params: { threadId: "ux-0", turn: pressureTurn },
          });
        } else {
          // A saved device opt-out uses the original real-time release.
          // No injected traffic pressure, fake clock, GC or direct release call.
          await expect
            .poll(async () => (await snapshot(page)).counts["ux-1"], {
              timeout: 75_000,
            })
            .toBeUndefined();
        }
        await expect
          .poll(async () => (await snapshot(page)).counts["ux-1"], {
            timeout: 15_000,
          })
          .toBeUndefined();
        const cold = await snapshot(page);
        await observe("dormant-body-expired");
        expect(cold.counts["ux-0"]).toBeGreaterThan(0);
        expect(cold.counts["ux-2"]).toBeUndefined();
        expect(cold.approvals).toBe(1);
        expect(cold.draft).toBe("keep my unsent draft");
        const target = fixture.threads[1] as any;
        const turn = {
          id: "new-after-expiry",
          status: "inProgress",
          startedAt: Math.floor(Date.now() / 1000),
          durationMs: null,
          items: [] as any[],
        };
        target.turns.push(turn);
        target.status = { type: "active", activeFlags: [] };
        stream.emit(pressureSequence + 1, {
          method: "turn/started",
          params: { threadId: target.id, turn },
        });
        await expect
          .poll(async () => (await snapshot(page)).timing[target.id]?.status)
          .toBe("inProgress");
        for (let i = 0; i < 40; i++)
          stream.emit(pressureSequence + 2 + i, {
            method: "item/agentMessage/delta",
            params: {
              threadId: target.id,
              turnId: turn.id,
              itemId: "latest-answer",
              delta: "temporary text ".repeat(2000),
            },
          });
        turn.status = "completed";
        turn.items = [
          {
            type: "agentMessage",
            id: "latest-answer",
            text: "新的最终回复：休眠后仍能恢复",
          },
        ];
        target.status = { type: "idle" };
        stream.emit(pressureSequence + 42, {
          method: "turn/completed",
          params: { threadId: target.id, turn },
        });
        await expect
          .poll(async () => (await snapshot(page)).timing[target.id]?.status)
          .toBe("completed");
        await expect
          .poll(async () =>
            (await snapshot(page)).unread?.completed?.some(
              (r: any) => r.id === turn.id,
            ),
          )
          .toBe(true);
        await page.waitForTimeout(1500);
        await expect.poll(() => audio().active, { timeout: 35_000 }).toBe(0);
        expect(audio().created).toBeGreaterThan(0);
        expect((await snapshot(page)).counts[target.id]).toBeUndefined();
        expect((await snapshot(page)).streaming).not.toContain(target.id);
        await select(page, target.id);
        await expect(
          page.getByText("新的最终回复：休眠后仍能恢复", { exact: true }),
        ).toBeVisible();
        expect((await snapshot(page)).draft).toBe("keep my unsent draft");
        expect(
          fixture.calls.filter((c) =>
            /\/(resume|start|interrupt|submit)$/.test(c.path),
          ),
        ).toEqual([]);
        expect(errors).toEqual([]);
        await observe("read-only-reactivated");
      } finally {
        writeFileSync(
          info.outputPath("idle-memory-observations.json"),
          JSON.stringify(
            {
              boundary:
                "Natural heap samples and all renderer RSS in this isolated browser; no forced GC or reload",
              retentionPolicy: retentionPolicy && {
                expectedWarm: expectsWarm,
                ...retentionPolicy,
              },
              observations,
              errors,
              rssSamplingErrors,
            },
            null,
            2,
          ),
        );
        await browserCdp.detach();
        await cdp.detach();
        await stream.close();
      }
    },
  );

const soakMinutes = Number(process.env.SESSION_MEMORY_SOAK_MINUTES ?? 0);
test("long-running native events keep warm bodies bounded with natural garbage collection", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.skip(
    !soakMinutes,
    "Set SESSION_MEMORY_SOAK_MINUTES=30 for the real-time soak",
  );
  test.setTimeout((soakMinutes * 60 + 120) * 1000);
  // Preserve this historical optional-warm workload and its original thresholds.
  const { fixture, stream } = await setup(page, baseURL!, true);
  const cdp = await context.newCDPSession(page);
  const audio = await observeAudioContexts(cdp);
  const browserCdp = await context.browser()!.newBrowserCDPSession();
  const samples: Array<{
    seconds: number;
    heapBytes: number;
    backingStorageBytes: number;
    documents: number;
    nodes: number;
    listeners: number;
    reactMeasures: number;
    rendererRssBytes?: number;
    rendererProcesses: RendererMemory["rendererProcesses"];
    rendererRssScope: string;
    audioContexts: ReturnType<typeof audio>;
  }> = [];
  const errors: string[] = [];
  const rssSamplingErrors: RssSamplingError[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let sequence = 0,
    cycle = 0;
  const start = Date.now();
  try {
    while (Date.now() - start < soakMinutes * 60_000) {
      const target = fixture.threads[cycle % 2] as any;
      const turn = {
        id: `soak-${cycle}`,
        status: "completed",
        startedAt: Math.floor(Date.now() / 1000),
        durationMs: 1,
        items: [
          {
            type: "agentMessage",
            id: `answer-${cycle}`,
            text: `soak reply ${cycle}: ${"bounded final ".repeat(1200)}`,
          },
        ],
      };
      target.turns.push(turn);
      stream.emit(++sequence, {
        method: "turn/started",
        params: {
          threadId: target.id,
          turn: { ...turn, status: "inProgress", items: [] },
        },
      });
      for (let i = 0; i < 30; i++)
        stream.emit(++sequence, {
          method: "item/agentMessage/delta",
          params: {
            threadId: target.id,
            turnId: turn.id,
            itemId: `answer-${cycle}`,
            delta: `${cycle}:${i}:${"delta ".repeat(1000)}`,
          },
        });
      stream.emit(++sequence, {
        method: "turn/completed",
        params: { threadId: target.id, turn },
      });
      if (cycle % 40 === 20) await select(page, "ux-1");
      if (cycle % 40 === 21) await select(page, "ux-0");
      await page.waitForTimeout(2000);
      const heap = await cdp.send("Runtime.getHeapUsage");
      const dom = await cdp.send("Memory.getDOMCounters");
      const reactMeasures = await page.evaluate(
        () =>
          performance.getEntriesByType("measure").filter((entry) => {
            const devtools = (entry as PerformanceMeasure).detail?.devtools;
            return (
              devtools?.track === "Components ⚛" ||
              devtools?.trackGroup === "Scheduler ⚛"
            );
          }).length,
      );
      const processes = await browserCdp.send("SystemInfo.getProcessInfo");
      const memory = rendererMemory(
        processes.processInfo,
        rssSamplingErrors,
        `cycle:${cycle}`,
      );
      expect(reactMeasures).toBe(0);
      expect(audio().active).toBeLessThanOrEqual(1);
      expect(audio().peakActive).toBeLessThanOrEqual(1);
      samples.push({
        seconds: (Date.now() - start) / 1000,
        heapBytes: heap.usedSize,
        backingStorageBytes: heap.backingStorageSize,
        documents: dom.documents,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
        reactMeasures,
        ...memory,
        rendererRssScope: "all-browser-renderers",
        audioContexts: audio(),
      });
      if (cycle % 40 >= 16 && cycle % 40 < 20 && Date.now() - start > 90_000) {
        // A resource-sufficient followed page is now deliberately warm. The
        // separate real-pressure test retains the physical dormant-body/late
        // event assertions; this unchanged soak workload verifies its bounded
        // allocation with the original heap/RSS ceilings and GC windows.
        const state = await snapshot(page);
        expect(
          Object.values(state.bodyBytes).every(
            (bytes) => Number(bytes) <= 8 * 1024 * 1024,
          ),
        ).toBe(true);
        expect(
          Object.entries(state.bodyBytes).reduce(
            (sum, [id, bytes]) => (id === "ux-0" ? sum : sum + Number(bytes)),
            0,
          ),
        ).toBeLessThanOrEqual(16 * 1024 * 1024);
      }
      if (cycle % 30 === 0)
        console.log(
          JSON.stringify({ phase: "soak", cycle, ...samples.at(-1) }),
        );
      cycle++;
    }
    // Compare post-warmup low points, not a single sample taken before a natural GC.
    const first = samples.filter((s) => s.seconds >= 90 && s.seconds < 300);
    const last = samples.filter((s) => s.seconds > soakMinutes * 60 - 180);
    if (first.length && last.length)
      expect(
        Math.min(...last.map((s) => s.heapBytes)) -
          Math.min(...first.map((s) => s.heapBytes)),
      ).toBeLessThan(64 * 1024 * 1024);
    expect(Math.max(...samples.map((s) => s.heapBytes))).toBeLessThan(
      256 * 1024 * 1024,
    );
    const firstRss = first.flatMap((s) =>
      s.rendererRssBytes === undefined ? [] : [s.rendererRssBytes],
    );
    const lastRss = last.flatMap((s) =>
      s.rendererRssBytes === undefined ? [] : [s.rendererRssBytes],
    );
    if (firstRss.length && lastRss.length) {
      expect(Math.min(...lastRss) - Math.min(...firstRss)).toBeLessThan(
        128 * 1024 * 1024,
      );
      expect(
        Math.max(...samples.map((s) => s.rendererRssBytes ?? 0)),
      ).toBeLessThan(768 * 1024 * 1024);
    }
    expect(errors).toEqual([]);
    // Continuous notifications reuse one context; natural idle then closes it.
    expect(audio().created).toBe(1);
    await expect.poll(() => audio().active, { timeout: 35_000 }).toBe(0);
  } finally {
    const evidence = JSON.stringify({
      minutes: soakMinutes,
      cycles: cycle,
      samples,
      errors,
      rssSamplingErrors,
    });
    writeFileSync(testInfo.outputPath("natural-gc-soak.json"), evidence);
    await testInfo.attach("natural-gc-soak.json", {
      body: evidence,
      contentType: "application/json",
    });
    await stream.close();
  }
});
