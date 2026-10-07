import { expect, test, type Page } from "@playwright/test";
import Fastify from "../../apps/server/node_modules/fastify/fastify.js";
import { registerSessionTabsRoutes } from "../../apps/server/src/routes/session-tabs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const state = (page: Page) =>
  page.evaluate(async () => {
    const { useAgentCenterStore: store } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
    );
    const s = store.getState();
    const { useCodexStore } =
      await import("/src/session-mode/components/codex/stores/index.ts");
    return {
      ids: s.cards.map((c) => c.id),
      selected: s.currentAgentCardId,
      layout: s.cardsViewMode,
      pending: s.pendingTabOperations.length,
      detached: s.detachedCard?.id,
      target: useCodexStore.getState().currentThreadId,
    };
  });

test("desktop and phone share followed order, retain independent reading state and recover concurrent offline edits", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const dir = await mkdtemp(join(tmpdir(), "tabs-sync-e2e-"));
  const server = Fastify();
  registerSessionTabsRoutes(server, { file: join(dir, "tabs.json") });
  const desktopContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const phoneContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const desktop = await desktopContext.newPage(),
    phone = await phoneContext.newPage();
  let phoneOffline = false;
  try {
    for (const page of [desktop, phone]) {
      await installSessionUxFixture(page, 5);
      await page.route("**/api/session/tabs", async (route) => {
        if (page === phone && phoneOffline) {
          await route.abort();
          return;
        }
        const req = route.request();
        const response = await server.inject({
          method: req.method() as "GET" | "POST",
          url: "/api/session/tabs",
          ...(req.method() === "POST" ? { payload: req.postDataJSON() } : {}),
        });
        await route.fulfill({
          status: response.statusCode,
          contentType: "application/json",
          body: response.body,
        });
      });
      await page.addInitScript(() => {
        localStorage.setItem(
          "kanban.session.agent-center-store",
          JSON.stringify({
            version: 5,
            state: {
              cards: [
                { kind: "codex", id: "ux-0", cwd: "/fixture" },
                { kind: "codex", id: "ux-1", cwd: "/fixture" },
              ],
              currentAgentCardId: "ux-0",
              currentAgentCardKind: "codex",
              cardsViewMode: "solo",
              cardSizeMap: {},
            },
          }),
        );
      });
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await page
        .locator(".session-mode [contenteditable=true]")
        .first()
        .waitFor();
      await seedSessionUx(page, 5);
      await expect
        .poll(async () => (await state(page)).ids)
        .toEqual(["ux-0", "ux-1"]);
    }
    await desktop.evaluate(async () => {
      const { useAgentCenterStore: s } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      s.getState().setCurrentAgentCardId("ux-0", "codex");
      s.getState().setCardsViewMode("grid");
      s.getState().addAgentCard({ kind: "codex", id: "ux-2", cwd: "/fixture" });
      s.getState().setCurrentAgentCardId("ux-0", "codex");
    });
    await expect
      .poll(async () => (await state(phone)).ids)
      .toEqual(["ux-0", "ux-1", "ux-2"]);
    await phone.evaluate(async () => {
      const { useAgentCenterStore: s } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      const { useCodexStore } =
        await import("/src/session-mode/components/codex/stores/index.ts");
      s.getState().setCurrentAgentCardId("ux-1", "codex");
      useCodexStore.setState({
        currentThreadId: "ux-1",
        events: {
          "ux-1": Array.from({ length: 50 }, (_, i) => ({
            method: "item/completed",
            params: {
              threadId: "ux-1",
              turnId: `t${i}`,
              item: {
                id: `r${i}`,
                type: "agentMessage",
                text: `手机历史 ${i} ${"阅读位置保持。".repeat(25)}`,
              },
            },
          })),
        },
      });
      s.getState().moveCard(s.getState().cards[2], s.getState().cards[0]);
    });
    await expect
      .poll(async () => (await state(desktop)).ids)
      .toEqual(["ux-2", "ux-0", "ux-1"]);
    expect((await state(desktop)).selected).toBe("ux-0");
    expect((await state(desktop)).layout).toBe("grid");
    expect((await state(phone)).selected).toBe("ux-1");
    expect((await state(phone)).layout).toBe("solo");
    const history = phone
      .locator('.session-mode [data-slot="scroll-area-viewport"]')
      .filter({ has: phone.locator("[data-session-latest]") });
    await expect
      .poll(() =>
        history.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeLessThan(5);
    await history.evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true }),
      );
      el.scrollTop = el.scrollHeight / 2;
      el.dispatchEvent(new Event("scroll"));
    });
    await phone.waitForTimeout(200);
    const readingTop = await history.evaluate((el) => el.scrollTop);
    await desktop.evaluate(async () => {
      const { useAgentCenterStore: s } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      s.getState().removeCard({ kind: "codex", id: "ux-1" });
    });
    await expect
      .poll(async () => (await state(phone)).ids)
      .toEqual(["ux-2", "ux-0"]);
    expect((await state(phone)).selected).toBe("ux-1");
    expect((await state(phone)).target).toBe("ux-1");
    expect((await state(phone)).detached).toBe("ux-1");
    await expect
      .poll(() => history.evaluate((el) => el.scrollTop))
      .toBeCloseTo(readingTop, 0);
    await expect(
      phone.getByText("当前会话未关注", { exact: true }),
    ).toBeVisible();
    phoneOffline = true;
    await phone.evaluate(async () => {
      const { useAgentCenterStore: s } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      s.getState().addAgentCard({ kind: "codex", id: "ux-3", cwd: "/fixture" });
    });
    await expect.poll(async () => (await state(phone)).pending).toBe(1);
    await expect(phone.getByText("同步待重试", { exact: true })).toBeVisible();
    await desktop.evaluate(async () => {
      const { useAgentCenterStore: s } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes("/src/session-mode/stores/useAgentCenterStore.ts"),
          )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts"
      );
      s.getState().removeCard({ kind: "codex", id: "ux-2" });
      s.getState().addAgentCard({ kind: "codex", id: "ux-4", cwd: "/fixture" });
    });
    await expect.poll(async () => (await state(desktop)).pending).toBe(0);
    phoneOffline = false;
    await phone.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => (await state(phone)).ids)
      .toEqual(["ux-0", "ux-4", "ux-3"]);
    await expect
      .poll(async () => (await state(desktop)).ids)
      .toEqual(["ux-0", "ux-4", "ux-3"]);
    expect((await state(phone)).selected).toBe("ux-3");
    expect((await state(desktop)).selected).toBe("ux-4");
  } finally {
    await desktopContext.close();
    await phoneContext.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
