import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const width of [393, 1280]) {
  test(`backgrounding and refreshing preserve a running task and draft at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    const f = await setup(page, true);
    try {
      await f.event("turn/started", "initial-turn", "inProgress");
      await f.queue.submit({
        id: "next-after-running",
        threadId: "ux-0",
        text: "等待本轮完成后再处理",
        images: [],
        mode: "queue",
        parameters: { cwd: f.fixture.threads[0].cwd },
      });
      const editor = page
        .locator(".session-agent-view [contenteditable=true]")
        .first();
      await editor.fill("手机切后台前尚未发送的草稿");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new PageTransitionEvent("pagehide"));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(editor).toHaveText("手机切后台前尚未发送的草稿");
      await f.queue.tick();
      const state = await f.queue.get("ux-0");
      expect(state.paused).toBeNull();
      expect(state.items[0].status).toBe("queued");
      expect(f.calls).toEqual([]);
      expect(
        f.fixture.calls.filter((c) =>
          /\/(?:turn\/(?:start|interrupt)|thread\/(?:start|resume|unsubscribe))$/.test(
            c.path,
          ),
        ),
      ).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test("an interruption restored from an older runtime is neutral and never auto-resumes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const mutations: string[] = [];
  const f = await setup(page, false, async () => {
    await page.route("**/api/session/followups**", async (route) => {
      if (route.request().method() !== "GET")
        mutations.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        json: {
          revision: 1,
          items: [],
          paused: "由于你中断了当前响应，队列已暂停",
        },
      });
    });
  });
  try {
    await expect(
      page.getByText("当前响应已中断，队列已暂停", { exact: true }),
    ).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("当前响应已中断，队列已暂停", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/由于你中断/)).toHaveCount(0);
    expect(mutations).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
