import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393]) {
  test(`a silent running turn explains its state and retains native retry details (${width}px)`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 960 });
    const fixture = await installSessionUxFixture(page, 1);
    (fixture.threads[0] as any).status = { type: "active", activeFlags: [] };
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
    await page.addInitScript((initialCards) => {
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards: initialCards,
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
      await editor.fill("等待期间保留草稿");
      await expect.poll(() => stream.connections()).toBeGreaterThan(0);
      const turn = {
        id: "silent-turn",
        status: "inProgress",
        startedAt: Math.floor(Date.now() / 1000) - 31,
        items: [],
        error: null,
      };
      stream.emit(1, {
        method: "turn/started",
        params: { threadId: "ux-0", turn },
      });
      const waiting = page.getByText("暂未显示本轮过程或回复", {
        exact: false,
      });
      // The transcript is a lazy chunk; the composer can be ready before it.
      await expect(waiting).toBeVisible({ timeout: 45_000 });
      stream.emit(2, {
        method: "error",
        params: {
          threadId: "ux-0",
          turnId: turn.id,
          willRetry: true,
          error: { message: "Reconnecting 1/5", codexErrorInfo: null },
        },
      });
      await expect(
        page.getByText("Reconnecting 1/5", { exact: false }),
      ).toBeVisible();
      await expect(waiting).toHaveCount(0);
      stream.emit(3, {
        method: "thread/status/changed",
        params: {
          threadId: "ux-0",
          status: { type: "active", activeFlags: [] },
        },
      });
      await expect(
        page.getByText("Reconnecting 1/5", { exact: false }),
      ).toBeVisible();
      stream.emit(4, {
        method: "item/agentMessage/delta",
        params: {
          threadId: "ux-0",
          turnId: turn.id,
          itemId: "answer",
          delta: "恢复后的实时回复",
        },
      });
      await expect(
        page.getByText("恢复后的实时回复", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText("Reconnecting 1/5", { exact: false }),
      ).toHaveCount(0);
      await expect(waiting).toHaveCount(0);
      stream.emit(5, {
        method: "item/completed",
        params: {
          threadId: "ux-0",
          turnId: turn.id,
          item: {
            type: "agentMessage",
            id: "answer",
            text: "恢复后的最终回复",
            phase: "final_answer",
          },
        },
      });
      stream.emit(6, {
        method: "turn/completed",
        params: {
          threadId: "ux-0",
          turn: { ...turn, status: "completed", durationMs: 32_000 },
        },
      });
      await expect(
        page.getByText("恢复后的最终回复", { exact: false }),
      ).toBeVisible();
      await expect(waiting).toHaveCount(0);
      await expect(editor).toHaveText("等待期间保留草稿");
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|steer|interrupt)|thread\/(?:start|resume|fork|rollback))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
    } catch (error) {
      const state = await page
        .evaluate(async () => {
          const path =
            "/src/session-mode/components/codex/stores/useCodexStore.ts";
          const mounted =
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path;
          const { useCodexStore } = await import(mounted);
          const current = useCodexStore.getState();
          return {
            timing: current.turnTimingMap["ux-0"],
            status: current.threadStatusMap["ux-0"],
            events: (current.events["ux-0"] ?? []).map(
              (event: any) => event.method,
            ),
            body: document.body.innerText.slice(-2500),
          };
        })
        .catch(() => null);
      console.log(
        "silent-turn fixture state",
        JSON.stringify({ state, errors }),
      );
      throw error;
    } finally {
      await page.close();
      await stream.close();
    }
  });
}
