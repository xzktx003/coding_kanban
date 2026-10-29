import { expect, test } from "@playwright/test";
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
