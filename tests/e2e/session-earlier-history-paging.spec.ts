import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const SYNC_STORE = "/src/session-mode/stores/useSessionSyncStore.ts";
const CODEX_STORE = "/src/session-mode/components/codex/stores/index.ts";
const LAYOUT_STORE = "/src/session-mode/stores/useLayoutStore.ts";
const AGENT_STORE = "/src/session-mode/stores/useAgentCenterStore.ts";

/** Mounts the real CodexThread with a long, scrollable read-only transcript. */
async function prepare(page: import("@playwright/test").Page) {
  const fixture = await installSessionUxFixture(page, 1);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?mode=session");
  await page
    .locator(".session-codex-composer [contenteditable=true]")
    .first()
    .waitFor();
  await seedSessionUx(page, 1);
  await page.evaluate(
    async (paths) => {
      const module = (path: string) =>
        import(
          performance
            .getEntriesByType("resource")
            .findLast((e) => new URL(e.name).pathname === path)?.name ?? path
        );
      const [{ useCodexStore }, { useLayoutStore }, { useAgentCenterStore }] =
        await Promise.all([
          module(paths.codex),
          module(paths.layout),
          module(paths.agent),
        ]);
      const events = Array.from({ length: 160 }, (_, index) => ({
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: `page-turn-${index}`,
          item: {
            id: `page-item-${index}`,
            type: "agentMessage",
            phase: "final_answer",
            text: `阅读消息 ${index}\n\n正文内容各自保持。`,
          },
        },
      }));
      useLayoutStore.setState({
        isSidebarOpen: false,
        isRightPanelOpen: false,
      });
      useAgentCenterStore.getState().addAgentCard(
        { kind: "codex", id: "ux-0", cwd: "/fixture/项目", preview: "分页验收" },
        { activate: true },
      );
      useAgentCenterStore.setState({ cardsViewMode: "solo" });
      useCodexStore.setState({
        events: { "ux-0": events },
        historyLoadedMap: { "ux-0": true },
        historyLoadingMap: {},
        threadStatusMap: { "ux-0": { type: "idle" } },
        currentThreadId: "ux-0",
      });
    },
    { codex: CODEX_STORE, layout: LAYOUT_STORE, agent: AGENT_STORE },
  );
  await expect(page.getByText("阅读消息 159", { exact: true })).toBeVisible();
  const viewport = page
    .locator(".thread-surface")
    .first()
    .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"]');
  return { fixture, errors, viewport };
}

async function setPaging(
  page: import("@playwright/test").Page,
  state: Record<string, unknown>,
) {
  await page.evaluate(
    async ({ path, state }) => {
      const { useSessionSyncStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
          path
      );
      useSessionSyncStore.setState(state);
    },
    { path: SYNC_STORE, state },
  );
}

async function readPaging(page: import("@playwright/test").Page) {
  return await page.evaluate(async (path) => {
    const { useSessionSyncStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
    );
    const state = useSessionSyncStore.getState();
    return {
      cursor: state.cursors["ux-0"] ?? null,
      anchor: state.trimmedHistoryAnchors["ux-0"] ?? null,
      loading: state.earlierLoading["ux-0"] ?? false,
      error: state.earlierErrors["ux-0"] ?? "",
    };
  }, SYNC_STORE);
}

const noWrites = (fixture: { calls: Array<{ path: string }> }) =>
  fixture.calls.filter((call) =>
    /\/turn\/(start|interrupt)$|\/thread\/(resume|rollback|fork)$/.test(
      call.path,
    ),
  );

test("a memory-reclaimed transcript still shows the earlier-history entry without a cursor", async ({
  page,
}) => {
  const { fixture, errors } = await prepare(page);
  // Reclamation leaves only a recovery anchor; the opaque cursor is gone.
  await setPaging(page, {
    cursors: {},
    trimmedHistoryAnchors: { "ux-0": "page-turn-0" },
  });
  // Scope to the transcript entry: the toolbar carries its own paging button.
  await expect(
    page
      .locator(".session-earlier-history")
      .getByRole("button", { name: "加载更早消息", exact: true }),
  ).toBeVisible();
  expect(noWrites(fixture)).toEqual([]);
  expect(errors).toEqual([]);
});

test("clicking the recovery-anchor entry actually reads older turns and clears the anchor", async ({
  page,
}) => {
  const { fixture, errors } = await prepare(page);
  await setPaging(page, {
    cursors: {},
    trimmedHistoryAnchors: { "ux-0": "page-turn-0" },
  });
  const entry = page.locator(".session-earlier-history");
  await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
  await expect.poll(async () => (await readPaging(page)).loading).toBe(false);
  const paging = await readPaging(page);
  expect(paging.error).toBe("");
  // A consumed anchor means the recovery page really landed.
  expect(paging.anchor).toBeNull();
  expect(
    fixture.calls.filter((call) => call.path.endsWith("/thread/turns/list"))
      .length,
  ).toBeGreaterThan(0);
  expect(noWrites(fixture)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a failed earlier page shows its reason and a retry recovers the pagination", async ({
  page,
}) => {
  const { fixture, errors } = await prepare(page);
  await setPaging(page, {
    cursors: { "ux-0": "0" },
    trimmedHistoryAnchors: {},
  });
  let fail = true;
  await page.route("**/api/codex/thread/turns/list**", async (route) => {
    if (!fail) return route.fallback();
    await route.fulfill({
      status: 500,
      json: { error: "fixture earlier page failure" },
    });
  });
  const entry = page.locator(".session-earlier-history");
  await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
  // The reason is visible instead of a bare "加载失败，可重试".
  await expect(entry.getByRole("status")).toHaveText(/^加载失败：.+/);
  const retry = entry.getByRole("button", {
    name: "重试加载更早消息",
    exact: true,
  });
  await expect(retry).toBeEnabled();

  fail = false;
  await retry.click();
  await expect.poll(async () => (await readPaging(page)).error).toBe("");
  await expect(entry.getByRole("status")).toHaveCount(0);
  expect(noWrites(fixture)).toEqual([]);
  expect(errors).toEqual([]);
});

test("closing an earlier-history tab cancels only its read and a reopened tab can page again", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const { fixture, errors } = await prepare(page);
  const recentText = "关闭分页标签后重新打开的最近回复";
  Object.assign(fixture.threads[0], {
    turns: [{
      id: "cancel-recent-turn",
      status: "completed",
      startedAt: 1,
      durationMs: 1,
      error: null,
      items: [{ id: "cancel-recent", type: "agentMessage", text: recentText }],
    }],
  });
  let releaseOld!: () => void, releaseNew!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
  let requests = 0, oldSettled = false;
  const aborted: string[] = [], lateFulfillErrors: string[] = [];
  page.on("requestfailed", (request) => {
    if (!new URL(request.url()).pathname.endsWith("/api/codex/thread/turns/list"))
      return;
    if (request.postDataJSON()?.cursor === "cancel-page")
      aborted.push(request.failure()?.errorText ?? "request failed");
  });
  await page.route("**/api/codex/thread/turns/list**", async (route) => {
    const body = route.request().postDataJSON();
    if (body.threadId !== "ux-0" || body.cursor !== "cancel-page")
      return route.fallback();
    const attempt = ++requests;
    if (attempt > 2) throw new Error("Cancelled paging unexpectedly retried itself");
    await (attempt === 1 ? oldGate : newGate);
    try {
      await route.fulfill({ json: {
        data: [{
          id: attempt === 1 ? "cancel-stale-turn" : "cancel-new-turn",
          status: "completed",
          startedAt: 0,
          durationMs: 1,
          error: null,
          items: [{
            id: attempt === 1 ? "cancel-stale" : "cancel-new",
            type: "agentMessage",
            text: attempt === 1 ? "取消后迟到的旧分页不得复活" : "取消后的新分页成功",
          }],
        }],
        nextCursor: null,
        backwardsCursor: null,
      } });
    } catch (error) {
      // Chromium may already have discarded the first intercepted request.
      // Retain the observation instead of turning it into a fake HTTP response.
      if (attempt !== 1) throw error;
      lateFulfillErrors.push(String(error));
    } finally {
      if (attempt === 1) oldSettled = true;
    }
  });
  const transcript = () => page.evaluate(async (path) => {
    const { useCodexStore } = await import(
      performance.getEntriesByType("resource").findLast(
        (entry) => new URL(entry.name).pathname === path,
      )?.name ?? path
    );
    const state = useCodexStore.getState();
    return {
      current: state.currentThreadId,
      text: (state.events["ux-0"] ?? []).map(
        (event: any) => event.params?.item?.text ?? "",
      ).join("\n"),
    };
  }, CODEX_STORE);
  const frames = () => page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  const entry = page.locator(".session-earlier-history");
  const editor = page.locator(".session-agent-view [contenteditable=true]");
  try {
    const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
    await editor.fill("关闭分页期间保留的草稿");
    await setPaging(page, { cursors: { "ux-0": "cancel-page" }, trimmedHistoryAnchors: {} });
    await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await expect.poll(async () => (await readPaging(page)).loading).toBe(true);

    // Actual UI close removes observation and sets the input target to null.
    // The production retention lifecycle cancels its own read immediately;
    // this test never calls an internal cancellation function or aborts a route.
    const tab = page.locator('[role="tab"][data-tab-key="codex:ux-0"]');
    await tab.hover();
    await tab.locator("..").getByRole("button", { name: /^关闭标签：/ }).click();
    await expect(tab).toHaveCount(0);
    await expect.poll(async () => (await transcript()).current).toBeNull();
    await expect.poll(() => aborted.length).toBe(1);
    await frames();
    await expect.poll(async () => (await readPaging(page)).loading).toBe(false);
    expect((await readPaging(page)).error).toBe("");
    expect((await transcript()).text).not.toContain("取消后迟到的旧分页不得复活");

    await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
    await page.locator('.session-nav-row[role="button"]').filter({
      has: page.getByText(fixture.threads[0].name, { exact: true }),
    }).click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(recentText, { exact: true })).toBeVisible();
    await expect(editor).toHaveText("关闭分页期间保留的草稿");
    await setPaging(page, { cursors: { "ux-0": "cancel-page" }, trimmedHistoryAnchors: {} });
    await entry.getByRole("button", { name: "加载更早消息", exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    await expect.poll(async () => (await readPaging(page)).loading).toBe(true);
    releaseOld();
    await expect.poll(() => oldSettled).toBe(true);
    await frames();
    expect((await transcript()).text).not.toContain("取消后迟到的旧分页不得复活");
    expect((await readPaging(page)).loading).toBe(true);
    expect((await readPaging(page)).error).toBe("");

    releaseNew();
    await expect.poll(async () => (await readPaging(page)).loading).toBe(false);
    await expect(page.getByText("取消后的新分页成功", { exact: true })).toBeVisible();
    const paging = await readPaging(page);
    expect(paging.error).toBe("");
    expect(paging.cursor).toBeNull();
    await expect(entry.getByRole("status").filter({ hasText: /^加载失败/ })).toHaveCount(0);
    expect((await transcript()).text).not.toContain("取消后迟到的旧分页不得复活");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
    const executionWrites = fixture.calls.filter((call) =>
      /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|rollback|fork|delete|archive)|followups\/(?:submit|change|stop)|lifecycle\/(?:attach|resume|restore|archive)|subagents\/stop)$/.test(call.path),
    );
    expect(executionWrites).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath("earlier-cancel-evidence.json"), JSON.stringify({
      trigger: "Real earlier-page click, then close the current final followed tab; unobserved retention cancels its owned read",
      requests, aborted, oldSettled, lateFulfillErrors, paging,
      oldBodyRevived: false, newPageSucceeded: true, draftPreserved: true,
      documentPreserved: true, executionWrites, errors,
      boundary: "Browser cancellation/late transport and UI recovery; old-finally overlap and cross-realm AbortError identity have separate unit coverage",
    }, null, 2));
  } finally {
    releaseOld();
    releaseNew();
  }
});
