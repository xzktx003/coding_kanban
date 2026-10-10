import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
const cards = [0, 1, 2].map((i) => ({
  kind: "codex",
  id: `ux-${i}`,
  cwd: `/fixture/project-${i}`,
  preview: `恢复测试 ${i}`,
}));
const threads = cards.map((card, i) => ({
  id: card.id,
  cwd: card.cwd,
  name: card.preview,
  preview: card.preview,
  createdAt: 1,
  updatedAt: 2,
  modelProvider: "openai",
  status:
    i === 0
      ? { type: "idle" }
      : { type: "active", activeFlags: i === 2 ? ["waitingOnUserInput"] : [] },
  turns: Array.from({ length: 24 }, (_, n) => ({
    id: `${card.id}-turn-${n}`,
    // An active native thread has an in-progress turn. A stale active flag
    // cannot revive a completed turn under the current state contract.
    status: i > 0 && n === 23 ? "inProgress" : "completed",
    startedAt: 1,
    completedAt: i > 0 && n === 23 ? null : 2,
    durationMs: i > 0 && n === 23 ? null : 1000,
    error: null,
    items: [
      {
        type: "userMessage",
        id: `${card.id}-user-${n}`,
        content: [
          { type: "text", text: `${card.id} 历史问题 ${n}`, text_elements: [] },
        ],
      },
      {
        type: "agentMessage",
        id: `${card.id}-answer-${n}`,
        text:
          `${card.id} 历史回答 ${n} ` +
          "用于验证历史、滚动和重连恢复。".repeat(16),
      },
    ],
  })),
}));
async function state(page: Page) {
  return page.evaluate(async () => {
    const url = (p: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => new URL(e.name).pathname === p)?.name ?? p;
    const { useCodexStore } = await import(
      url("/src/session-mode/components/codex/stores/index.ts")
    );
    const { useAgentCenterStore } = await import(
      url("/src/session-mode/stores/useAgentCenterStore.ts")
    );
    const { useWorkspaceStore } = await import(
      url("/src/session-mode/stores/useWorkspaceStore.ts")
    );
    const { useSessionSplitStore } = await import(
      url("/src/session-mode/stores/useSessionSplitStore.ts")
    );
    const s = useCodexStore.getState();
    return {
      loaded: s.historyLoadedMap,
      statuses: s.threadStatusMap,
      current: s.currentThreadId,
      selected: useAgentCenterStore.getState().currentAgentCardId,
      cwd: useWorkspaceStore.getState().cwd,
      focus: s.inputFocusTrigger,
      layout: useSessionSplitStore.getState().tree,
      eventCounts: Object.fromEntries(
        Object.entries(s.events).map(([id, events]) => [id, events.length]),
      ),
    };
  });
}
for (const width of [375, 1440])
  test(`reload hydrates background tabs and status, retries errors and reconnects without moving the reader (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 3);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      class Stream {
        onopen: (() => void) | null = null;
        onmessage: ((event: any) => void) | null = null;
        onerror: (() => void) | null = null;
        closed = false;
        constructor() {
          ((window as any).__restoreStreams ??= []).push(this);
          setTimeout(() => {
            if (!this.closed) this.onopen?.();
          }, 30);
        }
        close() {
          this.closed = true;
        }
      }
      (window as any).EventSource = Stream;
      if (!localStorage.getItem("restore-fixture-seeded")) {
        localStorage.setItem("restore-fixture-seeded", "1");
        localStorage.setItem(
          "kanban.session.agent-center-store",
          JSON.stringify({
            version: 5,
            state: {
              cards: [],
              currentAgentCardId: "ux-0",
              currentAgentCardKind: "codex",
              cardsViewMode: "solo",
              sharedTabsInitialized: false,
              pendingTabOperations: [],
            },
          }),
        );
      }
    });
    let releaseTabs!: () => void;
    const tabsReady = new Promise<void>((r) => {
      releaseTabs = r;
    });
    await page.route("**/api/session/tabs", async (route) => {
      await tabsReady;
      const body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
      await route.fulfill({
        json: {
          initialized: true,
          revision: 1,
          cards,
          ...(body ? { sequence: body.operations?.at(-1)?.seq ?? 0 } : {}),
        },
      });
    });
    await page.route("**/api/session/api/codex/thread/list", (route) =>
      route.fulfill({ json: { data: threads, nextCursor: null } }),
    );
    let failB = true;
    const reads: string[] = [];
    await page.route(
      (url) => url.pathname.endsWith("/api/codex/thread/turns/list"),
      async (route) => {
        const { threadId: id, cursor, limit } = route.request().postDataJSON();
        reads.push(id);
        if (id === "ux-1" && failB) {
          failB = false;
          await route.fulfill({
            status: 503,
            json: { error: "隔离测试：首次历史查询失败" },
          });
          return;
        }
        const turns = [...threads.find((t) => t.id === id)!.turns].reverse();
        const start = Number(cursor ?? 0);
        const end = start + limit;
        await route.fulfill({
          json: {
            data: turns.slice(start, end),
            nextCursor: end < turns.length ? String(end) : null,
          },
        });
      },
    );
    await page.goto("/?mode=session");
    await page
      .locator(".session-mode [contenteditable=true]")
      .first()
      .waitFor();
    // A streamed event precedes shared membership/full history, reproducing the race.
    await page.evaluate(async () => {
      const p = "/src/session-mode/components/codex/stores/index.ts";
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) => new URL(e.name).pathname === p)?.name ?? p
      );
      useCodexStore.getState().addEvent("ux-1", {
        method: "thread/status/changed",
        params: {
          threadId: "ux-1",
          status: { type: "active", activeFlags: [] },
        },
      });
    });
    releaseTabs();
    await expect
      .poll(async () => (await state(page)).loaded, { timeout: 15000 })
      .toMatchObject({ "ux-0": true, "ux-1": true, "ux-2": true });
    await expect(
      page.locator('[role=tab][data-tab-key="codex:ux-0"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page
        .locator('[role=tab][data-tab-key="codex:ux-1"]')
        .getByLabel("运行中"),
    ).toBeVisible();
    await expect(
      page
        .locator('[role=tab][data-tab-key="codex:ux-2"]')
        .getByLabel("待处理"),
    ).toBeVisible();
    expect(reads.filter((id) => id === "ux-1").length).toBeGreaterThanOrEqual(
      2,
    );
    const beforeReload = await state(page);
    expect(beforeReload.eventCounts["ux-1"]).toBeGreaterThanOrEqual(40);
    expect(beforeReload).toMatchObject({
      current: "ux-0",
      selected: "ux-0",
      cwd: "/fixture/project-0",
    });
    const beforeCount = reads.length;
    await page.reload();
    await expect
      .poll(async () => (await state(page)).loaded, { timeout: 15000 })
      .toMatchObject({ "ux-0": true, "ux-1": true, "ux-2": true });
    await expect
      .poll(() => new Set(reads.slice(beforeCount)))
      .toEqual(new Set(["ux-0", "ux-1", "ux-2"]));
    expect((await state(page)).layout).toEqual(beforeReload.layout);
    const viewport = page
      .locator('.session-window-body [data-slot="scroll-area-viewport"]')
      .first();
    await viewport.hover();
    await page.mouse.wheel(0, -1000);
    await expect
      .poll(() =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeGreaterThan(100);
    await page.waitForTimeout(200);
    const top = await viewport.evaluate((el) => el.scrollTop);
    const beforeReconnect = await state(page);
    const count = reads.length;
    await page.evaluate(() => {
      (window as any).__restoreStreams.forEach((s: any) => {
        if (!s.closed) s.onopen?.();
      });
    });
    await expect.poll(() => reads.length).toBeGreaterThanOrEqual(count + 3);
    await page.waitForTimeout(300);
    const after = await state(page);
    expect(after).toMatchObject({
      current: beforeReconnect.current,
      selected: beforeReconnect.selected,
      cwd: beforeReconnect.cwd,
      focus: beforeReconnect.focus,
      layout: beforeReconnect.layout,
    });
    expect(
      Math.abs((await viewport.evaluate((el) => el.scrollTop)) - top),
    ).toBeLessThan(6);
    expect(
      fixture.calls.filter((c) =>
        /\/turn\/start|\/turn\/interrupt|\/thread\/(resume|start|rollback)|\/stop$/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `.dev-runtime/session-restore-accepted-${width}.png`,
    });
  });
