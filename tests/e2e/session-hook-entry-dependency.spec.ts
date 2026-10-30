import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393]) {
  test(`the exact composer is usable before unused hooks load and retains public module identity (${width}px)`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    const thread = fixture.threads[0];
    const card = {
      kind: "codex",
      id: thread.id,
      cwd: thread.cwd,
      preview: thread.name,
    };
    await page.route("**/api/session/tabs", (route) =>
      route.fulfill({
        json: { cards: [card], initialized: true, revision: 1, sequence: 0 },
      }),
    );
    await page.addInitScript((card) => {
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards: [card],
            currentAgentCardId: card.id,
            currentAgentCardKind: card.kind,
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
    }, card);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocked: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      /\/src\/session-mode\/components\/codex\/hooks\/useNewThread\.ts(?:\?|$)/,
      async (route) => {
        blocked.push(new URL(route.request().url()).pathname);
        await held;
        await route.continue();
      },
    );
    const stream = await liveStream(page, baseURL!);
    try {
      await page.goto("/?mode=session", { waitUntil: "commit" });
      await expect(page.locator(".session-top-nav")).toBeVisible({
        timeout: 5000,
      });
      const composer = page.locator(
        '.session-codex-composer[data-owner-thread="ux-0"]',
      );
      const editor = composer.locator("[contenteditable=true]");
      await expect(editor).toBeVisible({ timeout: 5000 });
      await editor.fill("未使用的hook不能阻塞原输入目标");
      await expect(editor).toHaveText("未使用的hook不能阻塞原输入目标");
      const blockedBeforeReady = [...blocked];
      release();
      const identities = await page.evaluate(async () => {
        const load = (path: string) =>
          import(
            performance
              .getEntriesByType("resource")
              .findLast((entry) => new URL(entry.name).pathname === path)
              ?.name ?? path
          );
        const [directHook, publicHooks, directStore, publicStores] =
          await Promise.all([
            load("/src/session-mode/components/codex/hooks/useCodexEvents.ts"),
            load("/src/session-mode/components/codex/hooks/index.ts"),
            load("/src/session-mode/components/codex/stores/useCodexStore.ts"),
            load("/src/session-mode/components/codex/stores/index.ts"),
          ]);
        return {
          hook: directHook.useCodexEvents === publicHooks.useCodexEvents,
          store: directStore.useCodexStore === publicStores.useCodexStore,
        };
      });
      expect(identities).toEqual({ hook: true, store: true });
      expect(stream.opens()).toBe(1);
      await expect(editor).toHaveText("未使用的hook不能阻塞原输入目标");
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter(({ path }) =>
          /\/(?:turn\/start|turn\/interrupt|resume)$/.test(path),
        ),
      ).toEqual([]);
      await writeFile(
        info.outputPath("hook-entry-dependency.json"),
        JSON.stringify(
          {
            width,
            blockedBeforeReady,
            identities,
            streamOpens: stream.opens(),
            exactOwner: "ux-0",
            nativeTaskWrites: 0,
            errors,
            boundary:
              "A held unused hook must not gate the real composer. Importing the preserved public barrel afterward resolves to the same hook/store and starts no additional EventSource; this is not a two-second performance measurement.",
          },
          null,
          2,
        ),
      );
    } finally {
      await writeFile(
        info.outputPath("held-hook-requests.json"),
        JSON.stringify({ width, blocked, errors }, null, 2),
      );
      release();
      await stream.close();
    }
  });
}
