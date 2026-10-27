import { expect, test } from "@playwright/test";
import { setup } from "./session-composer-v2-fixture";
import { openComposerStatus } from "./session-composer-actions";

for (const width of [1440, 390]) {
  test(`settings save failure preserves the draft and explicit retry restores the captured send (${width})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await setup(page, false);
    const submissions: any[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/followups/submit")) submissions.push(request.postDataJSON());
    });
    try {
      const composer = page.locator('.session-native-composer[data-owner-thread="ux-0"]');
      const editor = composer.locator('[contenteditable="true"]');
      await editor.fill("保留模型设置保存失败时的草稿");
      await expect(composer.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
      await page.evaluate(async () => {
        const path = "/src/session-mode/stores/useThreadModelStore.ts";
        const models = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
        await models.flushThreadModelSettings("ux-0");
        const original = IDBObjectStore.prototype.put;
        (window as any).__restoreSettingsWrite = () => { IDBObjectStore.prototype.put = original; };
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
          if (this.transaction.db.name === "kanban.session.thread-models.v1" && this.name === "threads") throw new DOMException("isolated settings quota failure", "QuotaExceededError");
          return original.apply(this, args);
        };
        models.changeThreadModel("ux-0", { model: "fixture-saved-model", reasoningEffort: "high" });
      });
      await expect(page.locator('.session-native-composer-status')).toContainText("会话设置保存失败");
      await expect(composer.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
      await expect(editor).toHaveText("保留模型设置保存失败时的草稿");
      expect(submissions).toEqual([]);
      await openComposerStatus(page);
      await expect(page.getByRole("button", { name: "重试保存会话设置", exact: true })).toBeVisible();
      await page.evaluate(() => (window as any).__restoreSettingsWrite());
      await page.getByRole("button", { name: "重试保存会话设置", exact: true }).click();
      await expect(page.getByRole("button", { name: "重试保存会话设置", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(composer.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
      const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/followups/submit"));
      await composer.getByRole("button", { name: "发送消息", exact: true }).click();
      expect((await response).status()).toBe(200);
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({ threadId: "ux-0", text: "保留模型设置保存失败时的草稿", parameters: { model: "fixture-saved-model", effort: "high" } });
      await expect(editor).toHaveText("");
      expect(fixture.errors).toEqual([]);
    } finally {
      await page.evaluate(() => (window as any).__restoreSettingsWrite?.()).catch(() => {});
      await fixture.close();
    }
  });
}
