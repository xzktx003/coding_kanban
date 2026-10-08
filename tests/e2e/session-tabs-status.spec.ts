import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

test("reload restores background history and status across projects without selecting or sending to them", async ({
  page,
}) => {
  const fixture = await installSessionUxFixture(page, 105);
  Object.assign(fixture.threads[104], {
    cwd: "/fixture/second-project",
    status: { type: "active", activeFlags: [] },
  });
  Object.assign(fixture.threads[103], {
    status: { type: "active", activeFlags: ["waitingOnApproval"] },
  });
  const cards = [0, 104, 103].map((i) => ({
    kind: "codex",
    id: `ux-${i}`,
    cwd: fixture.threads[i].cwd,
    preview: `中文会话 ${i}`,
  }));
  await page.route("**/api/session/tabs", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    await route.fulfill({
      json: {
        cards,
        initialized: true,
        revision: 1,
        sequence: body?.operations?.at(-1)?.seq ?? 0,
      },
    });
  });
  await page.addInitScript((cards) => {
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
  }, cards);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("tablist", { name: "关注会话" });
  const running = tabs.locator('[data-tab-key="codex:ux-104"]');
  const pending = tabs.locator('[data-tab-key="codex:ux-103"]');
  await expect(running.locator('[data-state="running"]')).toBeVisible();
  await expect(pending.locator('[data-state="pending"]')).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(running.locator('[data-state="running"]')).toBeVisible();
  await expect(pending.locator('[data-state="pending"]')).toBeVisible();
  await expect(tabs.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Background history now joins the existing thread through resume. It must
  // hydrate both offscreen tabs without starting a turn or changing selection.
  await expect
    .poll(
      () =>
        new Set(
          fixture.calls
            .filter(
              (c) =>
                c.path.endsWith("/thread/resume") && c.body.threadId !== "ux-0",
            )
            .map((c) => c.body.threadId),
        ),
    )
    .toEqual(new Set(["ux-103", "ux-104"]));
  expect(
    fixture.calls.filter((c) =>
      /\/turn\/start$|interrupt|\/thread\/start$/.test(c.path),
    ),
  ).toEqual([]);
  expect(
    fixture.calls.some(
      (c) => c.path.endsWith("/thread/list") && c.body.cursor === "100",
    ),
  ).toBe(true);

  // Recovery into the foreground must query current status while preserving drafts/selection.
  const editor = page
    .locator(".session-agent-view [contenteditable=true]")
    .first();
  await editor.fill("保留未发送草稿");
  Object.assign(fixture.threads[104], { status: { type: "idle" } });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(running.locator('[data-state="running"]')).toHaveCount(0);
  await expect(editor).toHaveText("保留未发送草稿");
  await expect(tabs.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // An idle background session with a completed reply gets exactly one marker.
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useSessionAttentionStore.ts";
    const { useSessionAttentionStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path
    );
    useSessionAttentionStore
      .getState()
      .complete("codex", "ux-104", "completed-reply");
  });
  await expect(
    running.getByRole("img", { name: "有新的回复未读" }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await running.screenshot({
    path: ".dev-runtime/session-tabs-status/single-unread-dot.png",
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(
    running.getByRole("img", { name: "有新的回复未读" }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
