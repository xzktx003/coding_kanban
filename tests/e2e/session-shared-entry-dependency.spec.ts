import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const width of [1440, 393]) {
  test(`navigation and the exact input do not wait for unused shared previews (${width}px)`, async ({
    page,
    baseURL,
  }, info) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    const card = {
      kind: "codex",
      id: fixture.threads[0].id,
      cwd: fixture.threads[0].cwd,
      preview: fixture.threads[0].name,
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
    const blocked: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      /\/packages\/shared\/dist\/codex-slack-preview\.js(?:\?|$)/,
      async (route) => {
        blocked.push(new URL(route.request().url()).pathname);
        await held;
        await route.continue();
      },
    );
    const stream = await liveStream(page, baseURL!);
    let exactInputReady = false;
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
      await editor.fill("正确会话先可输入，未打开的预览独立加载");
      await expect(editor).toHaveText("正确会话先可输入，未打开的预览独立加载");
      exactInputReady = true;
      expect(errors).toEqual([]);
      expect(
        fixture.calls.filter(({ path }) =>
          /\/(?:turn\/start|turn\/interrupt|resume)$/.test(path),
        ),
      ).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath("shared-entry-dependency.json"),
        JSON.stringify(
          {
            width,
            blocked,
            exactInputOwner: "ux-0",
            exactInputReady,
            nativeTaskWrites: fixture.calls.filter(({ path }) =>
              /\/(?:turn\/start|turn\/interrupt|resume)$/.test(path),
            ).length,
            errors,
          },
          null,
          2,
        ),
      );
      release();
      await stream.close();
    }
  });
}
