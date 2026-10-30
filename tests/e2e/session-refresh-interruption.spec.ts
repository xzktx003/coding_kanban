import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

async function observedState(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/session-mode/components/codex/stores/index.ts";
    const url =
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
      path;
    const { useCodexStore } = await import(url);
    const state = useCodexStore.getState();
    return {
      target: state.currentThreadId,
      currentTurn: state.currentTurnId,
      timing: state.turnTimingMap["ux-0"],
      status: state.threadStatusMap["ux-0"],
      loaded: state.historyLoadedMap["ux-0"],
      interrupted: (state.events["ux-0"] ?? []).filter(
        (event) =>
          event.method === "turn/completed" &&
          event.params.turn.status === "interrupted",
      ).length,
    };
  });
}

for (const width of [1440, 393])
  test(`refresh preserves the native running turn through a late passive interruption and then its final answer (${width}px)`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installSessionUxFixture(page, 1);
    const nativeTurn = {
      id: "refresh-native-turn",
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      durationMs: null,
      completedAt: null,
      items: [],
      error: null,
    };
    const cards = fixture.threads.map((thread) => ({
      kind: "codex",
      id: thread.id,
      cwd: thread.cwd,
      preview: thread.name,
    }));
    let completed = false;
    let releaseRead = () => {};
    let readGate: Promise<void>;
    const holdRead = () => {
      readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
    };
    holdRead();
    await page.route("**/api/session/tabs", (route) =>
      route.fulfill({
        json: { cards, initialized: true, revision: 1, sequence: 0 },
      }),
    );
    await page.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          data: fixture.threads.map((thread) => ({
            ...thread,
            status: { type: completed ? "idle" : "active", activeFlags: [] },
            turns: [],
          })),
          nextCursor: null,
        },
      }),
    );
    await page.route("**/api/session/codex/activity", (route) =>
      route.fulfill({
        json: {
          threadId: "ux-0",
          status: { type: completed ? "idle" : "active", activeFlags: [] },
          turn: {
            ...nativeTurn,
            status: completed ? "completed" : "inProgress",
          },
        },
      }),
    );
    await page.route(
      /\/api\/codex\/thread\/turns\/list(?:\?.*)?$/,
      async (route) => {
        const params = route.request().postDataJSON();
        if (params.itemsView !== "notLoaded") await readGate;
        await route.fulfill({
          json: {
            data: [
              {
                ...nativeTurn,
                status:
                  params.itemsView === "notLoaded"
                    ? completed
                      ? "completed"
                      : "inProgress"
                    : completed
                      ? "completed"
                      : "interrupted",
                durationMs: completed ? 1000 : 20,
                items:
                  completed && params.itemsView !== "notLoaded"
                    ? [
                        {
                          type: "agentMessage",
                          id: "refresh-final-answer",
                          text: "刷新没有中断任务，最终回复已到达。",
                        },
                      ]
                    : [],
              },
            ],
            nextCursor: null,
          },
        });
      },
    );
    await page.addInitScript((cards) => {
      if (!localStorage.getItem("refresh-interruption-seeded")) {
        localStorage.setItem("refresh-interruption-seeded", "1");
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
              view: "agent",
              isSidebarOpen: false,
              isRightPanelOpen: false,
            },
          }),
        );
      }
      (window as any).__falseInterruptionVisible = false;
      new MutationObserver(() => {
        if (
          [
            ...document.querySelectorAll<HTMLElement>(
              '[aria-label="该轮已中断"]',
            ),
          ].some((element) => element.getClientRects().length)
        )
          (window as any).__falseInterruptionVisible = true;
      }).observe(document, { subtree: true, childList: true });
    }, cards);
    const stream = await liveStream(page, baseURL!);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const samples: unknown[] = [];
    let sequence = 100;
    try {
      for (let refresh = 0; refresh < 3; refresh++) {
        const opened = stream.opens();
        if (refresh) {
          holdRead();
          await page.reload({ waitUntil: "domcontentloaded" });
        } else
          await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        const editor = page
          .locator(
            '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
          )
          .first();
        await expect(editor).toBeVisible({ timeout: 45_000 });
        await expect.poll(stream.opens).toBeGreaterThan(opened);
        stream.emit(sequence++, {
          method: "thread/status/changed",
          params: {
            threadId: "ux-0",
            status: { type: "active", activeFlags: [] },
          },
        });
        stream.emit(sequence++, {
          method: "turn/started",
          params: { threadId: "ux-0", turn: nativeTurn },
        });
        await expect
          .poll(async () => (await observedState(page)).timing?.status)
          .toBe("inProgress");
        releaseRead();
        await expect
          .poll(async () => (await observedState(page)).loaded)
          .toBe(true);
        await expect(page.locator("[data-transcript-preparing]")).toHaveCount(
          0,
          { timeout: 45_000 },
        );
        expect((await observedState(page)).interrupted).toBe(0);
        expect((await observedState(page)).currentTurn).toBe(nativeTurn.id);
        if (!refresh)
          await expect(
            page.getByRole("button", { name: "停止生成", exact: true }),
          ).toBeVisible();
        else
          await expect(
            page.getByRole("button", { name: /^(加入队列|引导当前任务)$/ }),
          ).toBeVisible();
        expect(
          await page.evaluate(() => (window as any).__falseInterruptionVisible),
        ).toBe(false);
        if (refresh) await expect(editor).toHaveText("刷新后保留的草稿");
        else await editor.fill("刷新后保留的草稿");
        samples.push({ refresh, ...(await observedState(page)) });
      }
      completed = true;
      stream.emit(sequence++, {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: nativeTurn.id,
          item: {
            type: "agentMessage",
            id: "refresh-final-answer",
            text: "刷新没有中断任务，最终回复已到达。",
          },
        },
      });
      stream.emit(sequence++, {
        method: "turn/completed",
        params: {
          threadId: "ux-0",
          turn: { ...nativeTurn, status: "completed", durationMs: 1000 },
        },
      });
      stream.emit(sequence++, {
        method: "thread/status/changed",
        params: { threadId: "ux-0", status: { type: "idle" } },
      });
      await expect(
        page.getByText("刷新没有中断任务，最终回复已到达。", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "停止生成", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(async () => (await observedState(page)).timing?.status)
        .toBe("completed");
      expect((await observedState(page)).interrupted).toBe(0);
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback)|followups\/submit)$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      await writeFile(
        info.outputPath("refresh-interruption.json"),
        JSON.stringify(
          {
            width,
            baseURL,
            samples,
            final: await observedState(page),
            errors,
            writes: fixture.calls.filter((call) =>
              /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback)|followups\/submit)$/.test(
                call.path,
              ),
            ),
            boundary:
              "Native EventSource with isolated HTTP fixture; passive history held until the precise live turn is observed. No real task or physical phone.",
          },
          null,
          2,
        ),
      );
    } finally {
      releaseRead();
      await page.close();
      await stream.close();
    }
  });
