import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";
test.use({ ignoreHTTPSErrors: true });
const evidence = ".dev-runtime/session-background-sync";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .findLast(
        (e) =>
          new URL(e.name).pathname ===
          "/src/session-mode/components/codex/stores/index.ts",
      )?.name;
    const { useCodexStore } = await import(
      url ?? "/src/session-mode/components/codex/stores/index.ts"
    );
    const state = useCodexStore.getState();
    return {
      selected: state.currentThreadId,
      loaded: Object.keys(state.historyLoadedMap).filter(
        (id) => state.historyLoadedMap[id],
      ),
      text: Object.fromEntries(
        Object.entries(state.events).map(([id, events]: [string, any]) => [
          id,
          events
            .filter(
              (e: any) =>
                e.method === "item/completed" &&
                e.params.item.type === "agentMessage",
            )
            .map((e: any) => e.params.item.text)
            .join("\n"),
        ]),
      ),
      timing: state.turnTimingMap,
    };
  });
}
async function setup(
  page: Page,
  baseURL: string,
  count: number,
  theme: string,
  history = 1,
) {
  const fixture = await installSessionUxFixture(page, count);
  const started = Math.floor(Date.now() / 1000) - 60;
  for (const thread of fixture.threads)
    (thread as any).turns = Array.from({ length: history }, (_, i) => ({
      id: `${thread.id}-t${i}`,
      status: "completed",
      startedAt: started + i,
      completedAt: started + i + 1,
      durationMs: 1000,
      error: null,
      items: [
        {
          type: "agentMessage",
          id: `${thread.id}-a${i}`,
          text: `会话 ${thread.id} 回复 ${i}\n\n${"正文用于检查阅读位置。".repeat(20)}`,
          phase: null,
          memoryCitation: null,
        },
      ],
    }));
  const cards = fixture.threads.map((t) => ({
    kind: "codex",
    id: t.id,
    preview: t.name,
    cwd: t.cwd,
  }));
  await page.route("**/api/session/tabs", (r) =>
    r.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }),
  );
  await page.addInitScript(
    ({ cards, theme }) => {
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
        "kanban.session.theme-storage",
        JSON.stringify({ version: 1, state: { theme, accent: "default" } }),
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
    { cards, theme },
  );
  const stream = await liveStream(page, baseURL);
  return { fixture, stream };
}
async function select(page: Page, id: string) {
  const tab = page.locator(`[data-tab-key="codex:${id}"]`).first();
  await tab.scrollIntoViewIfNeeded();
  await tab.click({ position: { x: 20, y: 12 } });
}
async function readingAnchor(page: Page, key?: string) {
  return page
    .locator('[data-session-group-body] [data-slot="scroll-area-viewport"]')
    .first()
    .evaluate((el, key) => {
      const top = el.getBoundingClientRect().top;
      const row = [
        ...el.querySelectorAll<HTMLElement>("[data-codex-row]"),
      ].find((r) =>
        key
          ? r.dataset.codexRow === key
          : r.getBoundingClientRect().bottom > top,
      );
      return {
        key: row?.dataset.codexRow,
        offset: row ? row.getBoundingClientRect().top - top : 0,
        scrollTop: el.scrollTop,
      };
    }, key);
}

for (const width of [390, 1440])
  for (const theme of ["light", "dark"]) {
    test(`20 tabs update offscreen without loaders or draft loss (${width}px ${theme})`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 950 });
      const { fixture, stream } = await setup(page, baseURL!, 20, theme);
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const target = fixture.threads[19] as any;
      target.status = { type: "active", activeFlags: [] };
      target.turns[0].status = "inProgress";
      try {
        await page.goto("/?mode=session");
        await expect(page.locator(".session-tab")).toHaveCount(20);
        await expect
          .poll(
            async () => {
              if (errors.length) throw new Error(errors.join("\n"));
              return (await snapshot(page)).loaded.length;
            },
            { timeout: 30000 },
          )
          .toBe(20);
        const editor = page.locator(
          ".session-agent-view [contenteditable=true]",
        );
        await editor.fill("保留当前会话草稿");
        const begin = Date.now();
        target.turns[0].items[0].text = "后台补回的最终回复";
        target.turns[0].status = "completed";
        target.status = { type: "idle" };
        await expect
          .poll(async () => (await snapshot(page)).text["ux-19"], {
            timeout: 9000,
          })
          .toContain("后台补回的最终回复");
        const catchupMs = Date.now() - begin;
        await expect(
          page.locator('[data-tab-key="codex:ux-19"] [data-state="unread"]'),
        ).toHaveCount(1);
        expect((await snapshot(page)).selected).toBe("ux-0");
        await expect(editor).toHaveText("保留当前会话草稿");
        const selectedAt = Date.now();
        await select(page, "ux-19");
        await expect(
          page.getByText("后台补回的最终回复", { exact: true }),
        ).toBeVisible();
        await page.bringToFront();
        await expect(
          page.locator('[data-tab-key="codex:ux-19"] [data-state="unread"]'),
        ).toHaveCount(0);
        const switchMs = Date.now() - selectedAt;
        await expect(
          page.getByText("正在加载历史消息…", { exact: true }),
        ).toHaveCount(0);
        const live = {
          id: "stream-turn",
          status: "inProgress",
          startedAt: Math.floor(Date.now() / 1000),
          items: [],
          error: null,
          durationMs: null,
        };
        stream.emit(1, {
          method: "turn/started",
          params: { threadId: target.id, turn: live },
        });
        const item = {
          type: "agentMessage",
          id: "stream-reply",
          text: "真正 SSE 到达的回复",
          phase: null,
          memoryCitation: null,
        };
        stream.emit(2, {
          method: "item/completed",
          params: {
            threadId: target.id,
            turnId: live.id,
            item,
            completedAtMs: Date.now(),
          },
        });
        target.turns.push({ ...live, status: "completed", items: [item] });
        stream.emit(3, {
          method: "turn/completed",
          params: { threadId: target.id, turn: target.turns.at(-1) },
        });
        stream.emit(3, {
          method: "turn/completed",
          params: { threadId: target.id, turn: target.turns.at(-1) },
        });
        await expect(
          page.getByText("真正 SSE 到达的回复", { exact: true }),
        ).toHaveCount(1);
        const viewport = page
          .locator(
            '[data-session-group-body] [data-slot="scroll-area-viewport"]',
          )
          .first();
        const beforeNotice = await viewport.boundingBox();
        let failedRead = false;
        await page.route("**/api/codex/thread/turns/list", (route) => {
          if (
            !failedRead &&
            route.request().postDataJSON().threadId === target.id
          ) {
            failedRead = true;
            return route.fulfill({
              status: 503,
              json: { error: "isolated readonly outage" },
            });
          }
          return route.fallback();
        });
        await page.evaluate(
          (id) =>
            window.dispatchEvent(
              new CustomEvent("session-history-reconcile", { detail: id }),
            ),
          target.id,
        );
        const notice = page.locator(
          ".session-sync-notice[data-session-recovery]",
        );
        await expect(notice).toBeVisible({ timeout: 8000 });
        const appearance = await notice.evaluate((el) => ({
          position: getComputedStyle(el).position,
          background: getComputedStyle(el).backgroundColor,
          height: el.getBoundingClientRect().height,
        }));
        expect(appearance.position).toBe("absolute");
        expect(appearance.background).toMatch(
          /(?:\/\s*0\.82\s*\)|,\s*0\.82\s*\))/,
        );
        expect(appearance.height).toBeLessThan(60);
        expect(await viewport.boundingBox()).toEqual(beforeNotice);
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({
          path: `${evidence}/notice-${width}-${theme}.png`,
        });
        await notice.getByRole("button", { name: "重试", exact: true }).click();
        await expect(notice).toHaveCount(0);
        expect(await viewport.boundingBox()).toEqual(beforeNotice);
        expect(errors).toEqual([]);
        expect(
          fixture.calls.filter((c) =>
            /\/turn\/(start|interrupt)|\/thread\/(resume|start)|\/followups\/submit/.test(
              c.path,
            ),
          ),
        ).toEqual([]);
        mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/20-${width}-${theme}.png` });
        writeFileSync(
          `${evidence}/20-${width}-${theme}.json`,
          JSON.stringify(
            {
              catchupMs,
              switchMs,
              errors,
              recentReads: fixture.calls.filter((c) =>
                c.path.endsWith("/turns/list"),
              ).length,
            },
            null,
            2,
          ),
        );
      } finally {
        await page.close();
        await stream.close();
      }
    });
  }

test("reading anchors survive switching, pagination and reload while the backend is unavailable", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  const { fixture, stream } = await setup(page, baseURL!, 2, "dark", 35);
  try {
    await page.goto("/?mode=session");
    await expect(page.locator(".session-tab")).toHaveCount(2);
    await expect.poll(async () => (await snapshot(page)).loaded.length).toBe(2);
    const viewport = page
      .locator('[data-session-group-body] [data-slot="scroll-area-viewport"]')
      .first();
    await viewport.hover();
    await page.mouse.wheel(0, -650);
    await page.waitForTimeout(300);
    const before = await readingAnchor(page);
    await select(page, "ux-1");
    await select(page, "ux-0");
    await expect
      .poll(async () => (await readingAnchor(page, before.key)).key)
      .toBe(before.key);
    expect(
      Math.abs((await readingAnchor(page, before.key)).offset - before.offset),
    ).toBeLessThan(8);
    await page.waitForTimeout(700);
    fixture.setHealthError(true);
    await page.reload();
    await expect
      .poll(async () => (await readingAnchor(page, before.key)).key, {
        timeout: 8000,
      })
      .toBe(before.key);
    expect(
      Math.abs((await readingAnchor(page, before.key)).offset - before.offset),
    ).toBeLessThan(8);
    await expect(
      page.getByText("正在加载历史消息…", { exact: true }),
    ).toHaveCount(0);
    fixture.setHealthError(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await snapshot(page)).loaded.length).toBe(2);
    await viewport.hover();
    await page.mouse.wheel(0, -100000);
    await page.waitForTimeout(250);
    const priorPage = await readingAnchor(page);
    await page
      .getByRole("button", { name: "加载更早消息", exact: true })
      .click();
    await expect
      .poll(async () => (await snapshot(page)).text["ux-0"])
      .toContain("回复 15");
    expect((await readingAnchor(page, priorPage.key)).key).toBe(priorPage.key);
    expect(
      Math.abs(
        (await readingAnchor(page, priorPage.key)).offset - priorPage.offset,
      ),
    ).toBeLessThan(8);
    for (const text of ["回复 5", "回复 0"]) {
      await viewport.hover();
      await page.mouse.wheel(0, -100000);
      await page.waitForTimeout(250);
      const anchor = await readingAnchor(page);
      await page
        .getByRole("button", { name: "加载更早消息", exact: true })
        .click();
      await expect
        .poll(async () => (await snapshot(page)).text["ux-0"])
        .toContain(text);
      expect((await readingAnchor(page, anchor.key)).key).toBe(anchor.key);
      expect(
        Math.abs(
          (await readingAnchor(page, anchor.key)).offset - anchor.offset,
        ),
      ).toBeLessThan(8);
    }
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/reading-restored.png` });
  } finally {
    await page.close();
    await stream.close();
  }
});

test("native SSE gaps, malformed frames, disconnects and pending snapshots recover without navigation or execution", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  const { fixture, stream } = await setup(page, baseURL!, 2, "dark");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/?mode=session");
    await expect(page.locator(".session-tab")).toHaveCount(2);
    await expect.poll(async () => (await snapshot(page)).loaded.length).toBe(2);
    await expect.poll(stream.opens).toBeGreaterThan(0);
    const initiallyOpened = stream.opens();
    const editor = page.locator(".session-agent-view [contenteditable=true]");
    await editor.fill("恢复过程中保留的草稿");
    const target = fixture.threads[1] as any;
    stream.emit(1, {
      method: "thread/status/changed",
      params: { threadId: target.id, status: { type: "idle" } },
    });
    target.turns[0].items[0].text = "事件跳号后只读补回";
    stream.emit(3, {
      method: "thread/status/changed",
      params: { threadId: target.id, status: { type: "idle" } },
    });
    await expect
      .poll(async () => (await snapshot(page)).text[target.id], {
        timeout: 8000,
      })
      .toContain("事件跳号后只读补回");
    await expect.poll(stream.opens).toBeGreaterThan(initiallyOpened);
    target.turns[0].items[0].text = "损坏帧后只读补回";
    stream.raw("{invalid frame}");
    await expect
      .poll(async () => (await snapshot(page)).text[target.id], {
        timeout: 8000,
      })
      .toContain("损坏帧后只读补回");
    const beforeDisconnect = stream.opens();
    target.turns[0].items[0].text = "断线后只读补回";
    stream.disconnect();
    await expect
      .poll(stream.opens, { timeout: 8000 })
      .toBeGreaterThan(beforeDisconnect);
    await expect
      .poll(async () => (await snapshot(page)).text[target.id], {
        timeout: 8000,
      })
      .toContain("断线后只读补回");
    const turn = {
      id: "pending-turn",
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      items: [],
      error: null,
      durationMs: null,
    };
    (fixture.threads[0] as any).turns.push(turn);
    (fixture.threads[0] as any).status = {
      type: "active",
      activeFlags: ["waitingOnUserInput"],
    };
    stream.emit(4, {
      method: "turn/started",
      params: { threadId: "ux-0", turn },
    });
    // Reconciliation may share the last event sequence; it must not be dropped.
    stream.envelope(4, "codex/user-input-snapshot", {
      requests: [
        {
          requestId: "recovered-rpc",
          threadId: "ux-0",
          turnId: turn.id,
          itemId: "pending-item",
          questions: [
            {
              id: "choice",
              header: "恢复",
              question: "恢复的问题是否显示？",
              isOther: true,
              isSecret: false,
              options: [
                { label: "已显示", description: "仅显示，不自动提交。" },
              ],
            },
          ],
        },
      ],
    });
    await expect(
      page
        .locator("[data-session-user-question]")
        .getByRole("radio", { name: /已显示/ }),
    ).toBeVisible();
    expect((await snapshot(page)).selected).toBe("ux-0");
    await expect(editor).toHaveText("恢复过程中保留的草稿");
    await expect(
      page.getByText("正在加载历史消息…", { exact: true }),
    ).toHaveCount(0);
    expect(
      fixture.calls.filter((c) =>
        /\/thread\/(resume|start)|\/turn\/(start|interrupt)|\/approval\/user-input|\/followups\/submit/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/sse-recovered-question.png` });
  } finally {
    await page.close();
    await stream.close();
  }
});

test("50 tabs recover after a browser freeze and two slow recent reads do not block other tabs", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60000);
  const { fixture, stream } = await setup(page, baseURL!, 50, "light");
  await page.setViewportSize({ width: 390, height: 900 });
  const reads: Array<{ id: string; at: number; done?: number }> = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.route(
      "**/api/session/api/codex/thread/turns/list",
      async (route) => {
        const body = route.request().postDataJSON();
        const read = {
          id: body.threadId,
          at: Date.now(),
          done: undefined as number | undefined,
        };
        reads.push(read);
        if (["ux-0", "ux-1"].includes(body.threadId)) {
          await new Promise((r) => setTimeout(r, 8000));
        }
        const thread = fixture.threads.find(
          (t) => t.id === body.threadId,
        ) as any;
        await route
          .fulfill({
            json: {
              data: [...thread.turns].reverse().slice(0, 10),
              nextCursor: null,
            },
          })
          .catch(() => {});
        read.done = Date.now();
      },
    );
    await page.goto("/?mode=session");
    await expect(page.locator(".session-tab")).toHaveCount(50);
    await expect
      .poll(async () => (await snapshot(page)).loaded.includes("ux-3"), {
        timeout: 5000,
      })
      .toBe(true);
    expect((await snapshot(page)).loaded.includes("ux-0")).toBe(false);
    // Cold boot has no cached display data; the timing SLA applies to warm
    // reconciliation. Prove worker independence first, then finish warming 50 tabs.
    await expect
      .poll(async () => (await snapshot(page)).loaded.includes("ux-49"), {
        timeout: 30000,
      })
      .toBe(true);
    const session = await page.context().newCDPSession(page);
    await session.send("Page.setWebLifecycleState", { state: "frozen" });
    (fixture.threads[49] as any).turns[0].items[0].text = "手机返回后自动补齐";
    await new Promise((r) => setTimeout(r, 6000));
    await session.send("Page.setWebLifecycleState", { state: "active" });
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect
      .poll(async () => (await snapshot(page)).text["ux-49"], { timeout: 8000 })
      .toContain("手机返回后自动补齐");
    expect(
      fixture.calls.filter((c) =>
        /\/thread\/(resume|start)|\/turn\/(start|interrupt)/.test(c.path),
      ),
    ).toEqual([]);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/50-recovered.png` });
  } finally {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      `${evidence}/50-diagnostic.json`,
      JSON.stringify(
        { reads, errors, state: await snapshot(page).catch(() => null) },
        null,
        2,
      ),
    );
    await page.close();
    await stream.close();
  }
});
