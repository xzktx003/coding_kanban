import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
import { historyGateway } from "./session-history-gateway-fixture";
import { liveStream } from "./session-sse-fixture";

for (const count of [1, 8, 30, 50])
  test(`all ${count} followed recent pages preload through the real gateway and native reader`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await installSessionUxFixture(page, count);
    const stream = await liveStream(page, baseURL!);
    const gateway = await historyGateway(900);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(
      "**/api/session/api/codex/thread/turns/list?view=chat",
      async (route) => {
        const request = route.request();
        const response = await route.fetch({
          url:
            gateway.origin +
            "/api/session/api/codex/thread/turns/list?view=chat",
          headers: request.headers(),
        });
        await route.fulfill({ response });
      },
    );
    try {
      await page.goto("/?mode=session");
      await expect(
        page.locator(".session-mode [contenteditable=true]").first(),
      ).toBeVisible();
      await seedSessionUx(page, count);
      // Setup follows all targets at once; subsequent selection uses a real tab click.
      await page.evaluate(async (count) => {
        const path = "/src/session-mode/stores/useAgentCenterStore.ts";
        const { useAgentCenterStore } = await import(
          performance
            .getEntriesByType("resource")
            .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
            path
        );
        const cards = Array.from({ length: count }, (_, i) => ({
          kind: "codex",
          id: `ux-${i}`,
          cwd: "/fixture/项目",
          preview: `会话 ${i}`,
        }));
        for (const [index, card] of cards.entries())
          useAgentCenterStore
            .getState()
            .addAgentCard(card, { activate: index === 0 });
        useAgentCenterStore.setState({ cardsViewMode: "solo" });
      }, count);
      await expect
        .poll(async () => (await gateway.reads()).length)
        .toBeGreaterThan(0);
      let targetMs: number | null = null;
      if (count > 1) {
        const target = page.locator(
          `[role=tab][data-tab-key="codex:ux-${count - 1}"]`,
        );
        await target.scrollIntoViewIfNeeded();
        const start = Date.now();
        await target.click();
        await expect(
          page.getByText(`recent page ux-${count - 1}`, { exact: true }),
        ).toBeVisible();
        targetMs = Date.now() - start;
        const order = (await gateway.reads()).map((entry) => entry.id);
        expect(order.indexOf(`ux-${count - 1}`)).toBeLessThanOrEqual(2);
        expect(targetMs).toBeLessThan(2000);
        const editor = page
          .locator(".session-mode [contenteditable=true]")
          .first();
        await editor.fill("draft while other recent pages preload");
        await expect(editor).toHaveText(
          "draft while other recent pages preload",
        );
      }
      await expect
        .poll(
          async () => {
            return await page.evaluate(async () => {
              const path = "/src/session-mode/services/sessionPreloadState.ts";
              const { useSessionPreloadStore } = await import(
                performance
                  .getEntriesByType("resource")
                  .findLast((entry) => new URL(entry.name).pathname === path)
                  ?.name ?? path
              );
              return Object.values(
                useSessionPreloadStore.getState().entries,
              ).filter((entry: any) => entry.phase === "ready").length;
            });
          },
          { timeout: 20000 },
        )
        .toBe(count);
      const native = await gateway.reads();
      expect(new Set(native.map((entry) => entry.id)).size).toBe(count);
      expect(
        (await gateway.requests()).some(
          (request) => request.priority === "interactive",
        ),
      ).toBe(true);
      if (count > 1)
        expect(
          (await gateway.requests()).some(
            (request) => request.priority === "background",
          ),
        ).toBe(true);
      expect(
        fixture.calls.filter((call) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:resume|fork|rollback))$/.test(
            call.path,
          ),
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await writeFile(
        info.outputPath("coverage.json"),
        JSON.stringify(
          { count, targetMs, requests: await gateway.requests(), native },
          null,
          2,
        ),
      );
    } finally {
      const debug = await page
        .evaluate(async () => {
          const load = (path: string) =>
            import(
              performance
                .getEntriesByType("resource")
                .findLast((entry) => new URL(entry.name).pathname === path)
                ?.name ?? path
            );
          const [
            { useSessionPreloadStore },
            { useAgentCenterStore },
            { useCodexStore },
          ] = await Promise.all([
            load("/src/session-mode/services/sessionPreloadState.ts"),
            load("/src/session-mode/stores/useAgentCenterStore.ts"),
            load("/src/session-mode/components/codex/stores/index.ts"),
          ]);
          return {
            preload: useSessionPreloadStore.getState().entries,
            cards: useAgentCenterStore
              .getState()
              .cards.map((card: any) => card.id),
            errors: useCodexStore.getState().historyErrorMap,
            loaded: useCodexStore.getState().historyLoadedMap,
          };
        })
        .catch(() => null);
      await writeFile(
        info.outputPath("debug.json"),
        JSON.stringify({ debug, consoleErrors }, null, 2),
      );
      await page.close();
      const cleanup = await gateway.close();
      await stream.close();
      await writeFile(
        info.outputPath("cleanup.json"),
        JSON.stringify(cleanup, null, 2),
      );
      expect(cleanup.alive).toEqual([]);
    }
  });
