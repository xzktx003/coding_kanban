import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionTabsRoutes } from "../../apps/server/src/routes/session-tabs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture } from "./session-ux-fixture";
const tab = (page: Page, id: string) =>
  page.locator(`[role=tab][data-tab-key="codex:${id}"]`);
async function close(page: Page, id: string) {
  const target = tab(page, id);
  await target.hover();
  await target.locator("..").locator(".session-tab-close").click();
}
async function local(page: Page, layout?: string) {
  return page.evaluate(async (layout) => {
    const url =
      performance
        .getEntriesByType("resource")
        .findLast(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/stores/useAgentCenterStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore: s } = await import(url);
    if (layout) s.getState().setCardsViewMode(layout);
    return {
      ids: s.getState().cards.map((c: any) => c.id),
      pending: s.getState().pendingTabOperations.length,
      client: s.getState().syncClientId,
    };
  }, layout);
}
test("same-browser pages preserve closes through stale cache writes, offline reload, backend restart and old add retries", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const dir = await mkdtemp(join(tmpdir(), "same-browser-tabs-")),
    file = join(dir, "tabs.json");
  let app = Fastify();
  registerSessionTabsRoutes(app, { file });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const pages = [await context.newPage(), await context.newPage()];
  const offline = new Set<Page>();
  const calls: any[] = [];
  const posts: any[] = [];
  const cwd = "/fixture/项目/very-long-project-path-for-ui-regression";
  const cards = [0, 1].map((i) => ({ kind: "codex", id: `ux-${i}`, cwd }));
  const ids = async () =>
    (await app.inject("/api/session/tabs")).json().cards.map((c: any) => c.id);
  try {
    await app.inject({
      method: "POST",
      url: "/api/session/tabs",
      payload: { clientId: "seed", seed: cards, operations: [] },
    });
    await context.addInitScript(
      ({ cards }) => {
        if (!localStorage.getItem("kanban.session.agent-center-store"))
          localStorage.setItem(
            "kanban.session.agent-center-store",
            JSON.stringify({
              version: 5,
              state: {
                cards,
                currentAgentCardId: "ux-0",
                currentAgentCardKind: "codex",
                syncClientId: "shared-legacy-browser",
                nextTabSequence: 1,
                pendingTabOperations: [],
                sharedTabsInitialized: true,
                cardsViewMode: "solo",
              },
            }),
          );
      },
      { cards },
    );
    for (const page of pages) {
      const fixture = await installSessionUxFixture(page, 3);
      calls.push(fixture.calls);
      await page.route("**/api/session/tabs", async (route) => {
        if (offline.has(page)) {
          await route.abort();
          return;
        }
        const req = route.request(),
          payload = req.method() === "POST" ? req.postDataJSON() : undefined;
        if (payload) posts.push(payload);
        const response = await app.inject({
          method: req.method() as "GET" | "POST",
          url: "/api/session/tabs",
          ...(payload ? { payload } : {}),
        });
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.body,
        });
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect(tab(page, "ux-1")).toBeVisible();
    }
    expect((await local(pages[0])).client).toBe((await local(pages[1])).client);
    await pages[0]
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: "中文会话 2 " })
      .first()
      .click();
    await expect.poll(ids).toEqual(["ux-0", "ux-1", "ux-2"]);
    await expect(tab(pages[1], "ux-2")).toBeVisible();
    await close(pages[1], "ux-1");
    await expect.poll(ids).toEqual(["ux-0", "ux-2"]);
    await expect(tab(pages[0], "ux-1")).toHaveCount(0);
    await pages[1].reload({ waitUntil: "domcontentloaded" });
    await expect(tab(pages[1], "ux-2")).toBeVisible();
    await expect(tab(pages[1], "ux-1")).toHaveCount(0);
    offline.add(pages[0]);
    offline.add(pages[1]);
    await close(pages[0], "ux-2");
    await expect(tab(pages[0], "ux-2")).toHaveCount(0);
    await local(pages[1], "grid"); // An older page overwrites the shared Zustand cache.
    await pages[0].reload({ waitUntil: "domcontentloaded" });
    await expect(tab(pages[0], "ux-2")).toHaveCount(0);
    offline.delete(pages[0]);
    await pages[0].evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(ids).toEqual(["ux-0"]);
    offline.delete(pages[1]);
    await pages[1].evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => (await local(pages[1])).ids)
      .toEqual(["ux-0"]);
    await app.close();
    app = Fastify();
    registerSessionTabsRoutes(app, { file });
    const originalAdd = posts.find((p) =>
      p.operations.some(
        (o: any) => o.action.type === "add" && o.action.card.id === "ux-2",
      ),
    );
    expect(originalAdd).toBeTruthy();
    await app.inject({
      method: "POST",
      url: "/api/session/tabs",
      payload: originalAdd,
    });
    expect(await ids()).toEqual(["ux-0"]);
    await pages[0].reload({ waitUntil: "domcontentloaded" });
    // The intentionally stale cache above also persisted grid layout. Inspect
    // shared membership before explicitly returning to tabs for the UI checks.
    await expect.poll(async () => (await local(pages[0])).ids).toEqual(["ux-0"]);
    await local(pages[0], "solo");
    await expect(tab(pages[0], "ux-0")).toBeVisible();
    await expect(tab(pages[0], "ux-2")).toHaveCount(0);
    await pages[0]
      .locator(".session-nav-row[role=button]")
      .filter({ hasText: "中文会话 2 " })
      .first()
      .click();
    await expect.poll(ids).toEqual(["ux-0", "ux-2"]);
    expect(
      calls
        .flat()
        .filter((c: any) => /interrupt|delete|disconnect|\/stop/.test(c.path)),
    ).toEqual([]);
  } finally {
    await context.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
