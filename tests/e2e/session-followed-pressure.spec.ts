import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const count of [50, 100])
  test(`${count} followed sessions keep four real panes and the exact composer usable`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(75_000);
    const fixture = await installSessionUxFixture(page, count);
    for (const thread of fixture.threads)
      (thread as any).turns = [
        {
          id: `${thread.id}-turn`,
          status: "completed",
          startedAt: 1,
          durationMs: 1,
          items: [
            {
              id: `${thread.id}-answer`,
              type: "agentMessage",
              text: `pressure ${thread.id} bounded recent answer`,
            },
          ],
        },
      ];
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
    await page.addInitScript((cards) => {
      const group = (index: number, keys: string[]) => ({
        type: "group",
        id: `pressure-group-${index}`,
        keys,
        selected: keys[0],
      });
      const split = (
        id: string,
        first: unknown,
        second: unknown,
        direction = "horizontal",
      ) => ({ type: "split", id, first, second, direction, ratio: 50 });
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
        "kanban.session.split-layout",
        JSON.stringify({
          version: 1,
          state: {
            activeGroupId: "pressure-group-0",
            tree: split(
              "pressure-root",
              split(
                "pressure-left",
                group(
                  0,
                  cards.slice(0, -3).map((card) => `codex:${card.id}`),
                ),
                group(1, [`codex:${cards.at(-3)!.id}`]),
                "vertical",
              ),
              split(
                "pressure-right",
                group(2, [`codex:${cards.at(-2)!.id}`]),
                group(3, [`codex:${cards.at(-1)!.id}`]),
                "vertical",
              ),
            ),
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
      localStorage.setItem(
        "kanban.session.settings-storage",
        JSON.stringify({ version: 13, state: { warmFollowedSessions: true } }),
      );
    }, cards);
    const stream = await liveStream(page, baseURL!),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto("/?mode=session");
      await expect(
        page.locator(
          '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
        ),
      ).toBeVisible();
      const visible = [
        "ux-0",
        `ux-${count - 3}`,
        `ux-${count - 2}`,
        `ux-${count - 1}`,
      ];
      for (const id of visible)
        await expect(
          page
            .locator(`[data-codex-transcript-shell="${id}"]`)
            .filter({ hasText: `pressure ${id} bounded recent answer` }),
        ).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(
          () =>
            page.evaluate(async (count) => {
              const load = (path: string) =>
                import(
                  performance
                    .getEntriesByType("resource")
                    .findLast((e) => new URL(e.name).pathname === path)?.name ??
                    path
                );
              const [{ useCodexStore }, { useAgentCenterStore }] =
                await Promise.all([
                  load("/src/session-mode/components/codex/stores/index.ts"),
                  load("/src/session-mode/stores/useAgentCenterStore.ts"),
                ]);
              return (
                useAgentCenterStore.getState().cards.length === count &&
                Object.values(useCodexStore.getState().events).filter(
                  (rows: any) => rows?.length,
                ).length === count
              );
            }, count),
          { timeout: 50_000 },
        )
        .toBe(true);
      const editor = page.locator(
        '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
      );
      await editor.fill(`draft with ${count} followed sessions`);
      const metrics = await page.evaluate(
        async ({ count, visible }) => {
          const load = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((e) => new URL(e.name).pathname === path)?.name ??
                path
            );
          const [
            { useCodexStore },
            { estimateTranscriptBytes },
            { useAgentCenterStore },
            { useSettingsStore },
          ] = await Promise.all([
            load("/src/session-mode/components/codex/stores/index.ts"),
            load("/src/session-mode/services/codexTranscriptMemoryBudget.ts"),
            load("/src/session-mode/stores/useAgentCenterStore.ts"),
            load("/src/session-mode/stores/settings/useSettingsStore.ts"),
          ]);
          const state = useCodexStore.getState(),
            bytes = Object.values(state.events).reduce(
              (n: number, rows: any) => n + estimateTranscriptBytes(rows),
              0,
            );
          const editor = document.querySelector<HTMLElement>(
            '.session-codex-composer[data-owner-thread="ux-0"] [contenteditable=true]',
          )!;
          const start = performance.now();
          editor.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: "x",
              inputType: "insertText",
            }),
          );
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          return {
            count,
            visible,
            actualCards: useAgentCenterStore.getState().cards.length,
            warm: useSettingsStore.getState().warmFollowedSessions,
            bodyCount: Object.values(state.events).filter(
              (rows: any) => rows?.length,
            ).length,
            bytes,
            inputTwoFrames: performance.now() - start,
            ready: performance.now(),
            owner: editor
              .closest("[data-owner-thread]")
              ?.getAttribute("data-owner-thread"),
            draft: editor.textContent,
          };
        },
        { count, visible },
      );
      expect(metrics.bodyCount).toBe(count);
      expect(metrics.bytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(metrics.owner).toBe("ux-0");
      expect(metrics.draft).toContain(`draft with ${count}`);
      expect(errors).toEqual([]);
      await writeFile(
        info.outputPath("followed-pressure.json"),
        JSON.stringify(
          {
            metrics,
            errors,
            writes: fixture.calls.filter((call) =>
              /\/(?:start|resume|interrupt|submit)$/.test(call.path),
            ),
            boundary:
              "50/100 count stress with true warm preference; diagnostic timing only, independent of the 30x4x3 p95 acceptance.",
          },
          null,
          2,
        ),
      );
      expect(
        fixture.calls.filter((call) =>
          /\/(?:start|resume|interrupt|submit)$/.test(call.path),
        ),
      ).toEqual([]);
    } finally {
      await stream.close();
    }
  });
