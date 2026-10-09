import { test, expect } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";

for (const legacy of [false, true]) {
  test(`mobile restored thread sends with missing cwd${legacy ? " using a cached client" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const f = await setup(page);
    try {
      f.fixture.threads[0].cwd = "";
      await page.reload({ waitUntil: "domcontentloaded" });
      if (legacy) {
        await page.route("**/api/session/followups/submit", async route => {
          const data = route.request().postDataJSON();
          data.parameters.cwd = "";
          const response = await page.request.post(f.origin + "/api/session/followups/submit", { data });
          await route.fulfill({ response });
        });
      }
      const editor = page.locator(".session-composer-editor [contenteditable=true]").first();
      await editor.fill("手机恢复后发送的消息");
      const accepted = page.waitForResponse(r => new URL(r.url()).pathname === "/api/session/followups/submit");
      await page.getByRole("button", { name: "排队消息", exact: true }).click();
      expect((await accepted).status()).toBe(200);
      await expect.poll(async () => (await f.queue.get("ux-0")).items.length).toBe(1);
      expect((await f.queue.get("ux-0")).items[0].parameters.cwd).toBeNull();
      await expect(editor).toHaveText("");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect((await f.queue.get("ux-0")).items).toHaveLength(1);
      await f.event("turn/completed", "initial-turn", "completed");
      await f.queue.tick();
      expect(f.calls.find(c => c.method === "turn/start")?.params.cwd).toBeNull();
      expect(f.errors).toEqual([]);
    } finally {
      await page.unroute("**/api/session/followups/submit");
      await f.close();
    }
  });
}
