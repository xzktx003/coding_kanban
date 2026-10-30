import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

async function execution(page: Page) {
  return page.evaluate(async () => {
    const mounted = (path: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === path)?.name ?? path;
    const { useCodexStore } = await import(
      mounted("/src/session-mode/components/codex/stores/useCodexStore.ts")
    );
    const { currentNativeExecutionTiming } = await import(
      mounted("/src/session-mode/services/nativeTurnExecutionProof.ts")
    );
    const state = useCodexStore.getState();
    return {
      timing: state.turnTimingMap["ux-0"],
      proof: !!currentNativeExecutionTiming(
        "ux-0",
        state.turnTimingMap["ux-0"],
      ),
      loaded: !!state.historyLoadedMap["ux-0"],
      events: state.events["ux-0"] ?? [],
      currentTurn: state.currentTurnId,
    };
  });
}

for (const width of [1440, 393])
  test(`refresh rejects cached interruption after exact native activity proof (${width}px)`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installSessionUxFixture(page, 1);
    const turn = {
      id: "cache-live-turn",
      status: "inProgress",
      startedAt: 10,
      completedAt: null,
      durationMs: null,
      items: [],
      itemsView: "full",
      error: null,
    };
    const cards = fixture.threads.map((t) => ({
      kind: "codex",
      id: t.id,
      cwd: t.cwd,
      preview: t.name,
    }));
    let complete = false;
    let releaseHistory!: () => void;
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    let releaseAccount!: () => void;
    const accountGate = new Promise<void>((resolve) => {
      releaseAccount = resolve;
    });
    await page.route("**/api/session/tabs", (route) =>
      route.fulfill({
        json: { cards, initialized: true, revision: 1, sequence: 0 },
      }),
    );
    await page.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          data: fixture.threads.map((t) => ({
            ...t,
            status: complete
              ? { type: "idle" }
              : { type: "active", activeFlags: [] },
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
          status: complete
            ? { type: "idle" }
            : { type: "active", activeFlags: [] },
          turn: { ...turn, status: complete ? "completed" : "inProgress" },
        },
      }),
    );
    // Keep this scenario in one unchanged authority lifetime. Account-change
    // cancellation of a held cache is covered separately; initial account
    // confirmation must not turn this lifecycle-reconciliation case into it.
    await page.route("**/api/codex/account/get", async (route) => {
      await accountGate;
      await route
        .fulfill({ json: { account: null, requiresOpenaiAuth: false } })
        .catch(() => {});
    });
    await page.route(
      /\/api\/codex\/thread\/turns\/list(?:\?.*)?$/,
      async (route) => {
        await historyGate;
        await route
          .fulfill({
            json: {
              data: [
                {
                  ...turn,
                  status: complete ? "completed" : "inProgress",
                  items: complete
                    ? [
                        {
                          type: "agentMessage",
                          id: "final",
                          text: "刷新后原任务正常完成",
                        },
                      ]
                    : [],
                },
              ],
              nextCursor: null,
            },
          })
          .catch(() => {});
      },
    );
    await page.addInitScript((cards) => {
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
      (window as any).__falseCachedInterruption = false;
      new MutationObserver(() => {
        if (
          [...document.querySelectorAll('[aria-label="该轮已中断"]')].some(
            (e) => e.getClientRects().length,
          )
        )
          (window as any).__falseCachedInterruption = true;
      }).observe(document, { subtree: true, childList: true });
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
        const request = get.call(this, key);
        if (
          this.name !== "transcripts" ||
          key !== "codex:ux-0" ||
          sessionStorage.getItem("hold-cache-restore") !== "1"
        )
          return request;
        // Delay only delivery of a real IDB request. Its data, native transaction
        // and disk result remain unchanged; no store or proof is injected.
        const delayed = {
          get result() {
            return request.result;
          },
          set onsuccess(listener: (event: Event) => void) {
            request.onsuccess = (event) => {
              (window as any).__releaseDeviceCache = () => listener(event);
            };
          },
          set onerror(listener: (event: Event) => void) {
            request.onerror = listener;
          },
        };
        return delayed as unknown as IDBRequest;
      };
    }, cards);
    const stream = await liveStream(page, baseURL!);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      const editor = page
        .locator(
          '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
        )
        .first();
      await expect(editor).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(async () => (await execution(page)).proof, { timeout: 10_000 })
        .toBe(true);
      await editor.fill("刷新保留草稿");
      await page.evaluate(async (turn) => {
        await new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open("kanban.session.transcripts.v1", 2);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction("transcripts", "readwrite");
            tx.objectStore("transcripts").put({
              key: "codex:ux-0",
              savedAt: Date.now(),
              events: [
                {
                  method: "item/completed",
                  params: {
                    threadId: "ux-0",
                    turnId: turn.id,
                    item: {
                      type: "agentMessage",
                      id: "cached",
                      text: "缓存正文保持可读",
                    },
                  },
                },
                {
                  method: "turn/completed",
                  params: {
                    threadId: "ux-0",
                    turn: { ...turn, status: "interrupted", durationMs: 100 },
                  },
                },
              ],
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
        });
        sessionStorage.setItem("hold-cache-restore", "1");
      }, turn);
      // This is an actual reload, with a legacy erroneous on-disk terminal and
      // the ordinary history HTTP request still blocked.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(editor).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(() =>
          page.evaluate(() => typeof (window as any).__releaseDeviceCache),
        )
        .toBe("function");
      await expect
        .poll(async () => (await execution(page)).proof, { timeout: 10_000 })
        .toBe(true);
      await page.evaluate(() => (window as any).__releaseDeviceCache());
      await expect.poll(async () => (await execution(page)).loaded).toBe(true);
      await expect(
        page.getByText("缓存正文保持可读", { exact: true }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(editor).toHaveText("刷新保留草稿");
      expect((await execution(page)).timing).toMatchObject({
        turnId: turn.id,
        status: "inProgress",
      });
      expect(
        (await execution(page)).events.some(
          (event: any) =>
            event.method === "turn/completed" &&
            event.params.turn.status === "interrupted",
        ),
      ).toBe(false);
      expect(
        await page.evaluate(() => (window as any).__falseCachedInterruption),
      ).toBe(false);
      const cached = await execution(page);
      complete = true;
      stream.emit(100, {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: turn.id,
          item: {
            type: "agentMessage",
            id: "final",
            text: "刷新后原任务正常完成",
          },
        },
      });
      stream.emit(101, {
        method: "turn/completed",
        params: {
          threadId: "ux-0",
          turn: { ...turn, status: "completed", durationMs: 500 },
        },
      });
      stream.emit(102, {
        method: "thread/status/changed",
        params: { threadId: "ux-0", status: { type: "idle" } },
      });
      releaseHistory();
      await expect(
        page.getByText("刷新后原任务正常完成", { exact: true }).first(),
      ).toBeVisible();
      await expect
        .poll(async () => (await execution(page)).timing?.status)
        .toBe("completed");
      expect(errors).toEqual([]);
      const writes = fixture.calls.filter((call) =>
        /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|rollback))$/.test(
          call.path,
        ),
      );
      expect(writes).toEqual([]);
      await writeFile(
        info.outputPath("cache-native-execution-recovery.json"),
        JSON.stringify(
          {
            width,
            baseURL,
            cached,
            final: await execution(page),
            errors,
            writes,
            boundary:
              "Real browser IndexedDB and reload, real EventSource with isolated API fixture; native activity proof precedes held disk restore. No actual Agent mutation or physical-phone claim.",
          },
          null,
          2,
        ),
      );
    } finally {
      releaseHistory();
      releaseAccount();
      await page.close();
      await stream.close();
    }
  });

for (const width of [1440, 393])
  for (const nativeStatus of [
    "inProgress",
    "completed",
    "interrupted",
  ] as const)
    test(`cache-first refresh stays neutral and settles from ${nativeStatus} proof before history (${width}px)`, async ({
      page,
      baseURL,
    }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await installSessionUxFixture(page, 1);
      const turn = {
        id: "cache-live-turn",
        status: "inProgress",
        startedAt: 20,
        completedAt: null,
        durationMs: null,
        items: [],
        itemsView: "full",
        error: null,
      };
      const cards = fixture.threads.map((t) => ({
        kind: "codex",
        id: t.id,
        cwd: t.cwd,
        preview: t.name,
      }));
      let refreshed = false;
      let releaseHistory!: () => void,
        releaseActivity!: () => void,
        releaseAccount!: () => void;
      const historyGate = new Promise<void>((resolve) => {
        releaseHistory = resolve;
      });
      const activityGate = new Promise<void>((resolve) => {
        releaseActivity = resolve;
      });
      const accountGate = new Promise<void>((resolve) => {
        releaseAccount = resolve;
      });
      const currentStatus = () => (refreshed ? nativeStatus : "inProgress");
      const threadStatus = () =>
        currentStatus() === "inProgress"
          ? { type: "active", activeFlags: [] }
          : { type: "idle" };
      await page.route("**/api/session/tabs", (route) =>
        route.fulfill({
          json: { cards, initialized: true, revision: 1, sequence: 0 },
        }),
      );
      await page.route(/\/api\/codex\/thread\/list(?:\?.*)?$/, (route) =>
        route.fulfill({
          json: {
            data: fixture.threads.map((t) => ({
              ...t,
              status: threadStatus(),
              turns: [],
            })),
            nextCursor: null,
          },
        }),
      );
      await page.route("**/api/session/codex/activity", async (route) => {
        if (refreshed) await activityGate;
        await route
          .fulfill({
            json: {
              threadId: "ux-0",
              status: threadStatus(),
              turn: {
                ...turn,
                status: currentStatus(),
                completedAt: currentStatus() === "inProgress" ? null : 21,
                durationMs: currentStatus() === "inProgress" ? null : 1000,
              },
            },
          })
          .catch(() => {});
      });
      await page.route("**/api/codex/account/get", async (route) => {
        await accountGate;
        await route
          .fulfill({ json: { account: null, requiresOpenaiAuth: false } })
          .catch(() => {});
      });
      await page.route(
        /\/api\/codex\/thread\/turns\/list(?:\?.*)?$/,
        async (route) => {
          await historyGate;
          await route
            .fulfill({
              json: {
                data: [{ ...turn, status: currentStatus() }],
                nextCursor: null,
              },
            })
            .catch(() => {});
        },
      );
      await page.addInitScript((cards) => {
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
        const summaries = () => JSON.parse(sessionStorage.getItem("cache-fixture-io") ?? "[]") as unknown[];
        const record = (operation: string, value: any) => {
          const entries = summaries();
          entries.push({ operation, ms: Date.now(), savedAt: value?.savedAt, count: value?.events?.length,
            cachedText: value?.events?.some((event: any) => event.params?.item?.text === "缓存正文先于执行核对显示") ?? false });
          sessionStorage.setItem("cache-fixture-io", JSON.stringify(entries.slice(-20)));
        };
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function(key: IDBValidKey | IDBKeyRange) {
          const request = get.call(this, key);
          if (this.name === "transcripts" && key === "codex:ux-0") request.addEventListener("success", () => record("get", request.result));
          return request;
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
          if (this.name === "transcripts" && value?.key === "codex:ux-0") record("put", value);
          return key === undefined ? put.call(this, value) : put.call(this, value, key);
        };
      }, cards);
      const stream = await liveStream(page, baseURL!);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
        const editor = page
          .locator(
            '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
          )
          .first();
        await expect(editor).toBeVisible({ timeout: 45_000 });
        await expect
          .poll(async () => (await execution(page)).proof, { timeout: 10_000 })
          .toBe(true);
        await editor.fill("不应发送的草稿");
        await page.evaluate(
          async ({ turn, cwd }) => {
            await new Promise<void>((resolve, reject) => {
              const opening = indexedDB.open(
                "kanban.session.transcripts.v1",
                2,
              );
              opening.onerror = () => reject(opening.error);
              opening.onsuccess = () => {
                const db = opening.result,
                  tx = db.transaction("transcripts", "readwrite");
                tx.objectStore("transcripts").put({
                  key: "codex:ux-0",
                  savedAt: Date.now(),
                  events: [
                    {
                      method: "turn/completed",
                      params: {
                        threadId: "ux-0",
                        turn: {
                          ...turn,
                          id: "older-real-interruption",
                          status: "interrupted",
                          startedAt: 1,
                          completedAt: 2,
                          durationMs: 100,
                        },
                      },
                    },
                    {
                      method: "item/completed",
                      params: {
                        threadId: "ux-0",
                        turnId: turn.id,
                        item: {
                          type: "agentMessage",
                          id: "cached",
                          text: "缓存正文先于执行核对显示",
                        },
                      },
                    },
                    {
                      method: "item/started",
                      params: {
                        threadId: "ux-0",
                        turnId: turn.id,
                        item: {
                          type: "commandExecution",
                          id: "cached-tool",
                          command: "printf cache-recovery",
                          commandActions: [
                            {
                              type: "unknown",
                              command: "printf cache-recovery",
                            },
                          ],
                          cwd,
                          processId: "cache-fixture-process",
                          status: "inProgress",
                          aggregatedOutput: null,
                          exitCode: null,
                          durationMs: null,
                        },
                      },
                    },
                    {
                      method: "turn/completed",
                      params: {
                        threadId: "ux-0",
                        turn: {
                          ...turn,
                          status: "interrupted",
                          completedAt: 21,
                          durationMs: 1000,
                        },
                      },
                    },
                  ],
                });
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => {
                  db.close();
                  reject(tx.error);
                };
              };
            });
          },
          { turn, cwd: fixture.threads[0].cwd },
        );
        refreshed = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(editor).toBeVisible({ timeout: 45_000 });
        await expect.poll(async () => (await execution(page)).loaded).toBe(true);
        // The approved active view shows latest progress by default; this
        // cached commentary precedes the tool, so explicitly expand all before
        // asserting that older content is visible. Do not relabel it final.
        const header = page
          .locator('button[data-turn-work="cache-live-turn"]')
          .first();
        await expect(header).toBeVisible();
        if ((await header.getAttribute("aria-expanded")) === "false")
          await header.click();
        await expect(
          page.getByText("缓存正文先于执行核对显示", { exact: true }),
        ).toBeVisible({ timeout: 45_000 });
        await expect(
          page.getByText("正在核对轮次状态", { exact: true }).first(),
        ).toBeVisible();
        expect((await execution(page)).proof).toBe(false);
        expect((await execution(page)).currentTurn).toBeNull();
        await expect(page.locator('[aria-label="该轮已中断"]')).toHaveCount(1);
        await expect(
          page.getByText("printf cache-recovery", { exact: false }).first(),
        ).toBeVisible();
        const before = await execution(page);
        releaseActivity();
        await expect
          .poll(async () => (await execution(page)).proof, { timeout: 10_000 })
          .toBe(true);
        await expect
          .poll(async () => (await execution(page)).timing?.status)
          .toBe(nativeStatus);
        await expect(
          page.getByText("正在核对轮次状态", { exact: true }),
        ).toHaveCount(0);
        await expect(page.locator('[aria-label="该轮已中断"]')).toHaveCount(
          nativeStatus === "interrupted" ? 2 : 1,
        );
        expect((await execution(page)).currentTurn).toBe(
          nativeStatus === "inProgress" ? turn.id : null,
        );
        await expect(editor).toHaveText("不应发送的草稿");
        expect(errors).toEqual([]);
        const writes = fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|rollback))$/.test(
            call.path,
          ),
        );
        expect(writes).toEqual([]);
        await writeFile(
          info.outputPath("cache-first-execution-recovery.json"),
          JSON.stringify(
            {
              width,
              nativeStatus,
              baseURL,
              before,
              after: await execution(page),
              errors,
              writes,
              boundary:
                "Actual IndexedDB reload restores body before held readonly activity; real EventSource connected but emits no final answer, full history remains blocked through assertions. Latest cache-only ending/tool neutral; older historical interruption retained.",
            },
            null,
            2,
          ),
        );
      } finally {
        await writeFile(info.outputPath("cache-recovery-debug.json"), JSON.stringify({ state: await execution(page).catch(error => ({ error: String(error) })),
          io: await page.evaluate(() => JSON.parse(sessionStorage.getItem("cache-fixture-io") ?? "[]")).catch(() => []),
          visible: await page.locator("body").innerText().then(value => value.slice(0, 8000)).catch(() => "page closed"), errors, calls: fixture.calls,
        }, null, 2));
        releaseActivity();
        releaseHistory();
        releaseAccount();
        await page.close();
        await stream.close();
      }
    });
