import { expect, test } from "@playwright/test";
import { fixtureGoal } from "./session-goal-fixture";

for (const width of [1440, 390]) {
  test(`existing GoalSet remains independent of failed model preference storage at ${width}`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const f = await fixtureGoal(page);
    const editor = page
      .locator(".session-codex-composer [contenteditable=true]")
      .first();
    await editor.fill("普通消息仍须保存模型设置");
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useThreadModelStore.ts";
      const url =
        performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === path)?.name ??
        path;
      const settings = await import(/* @vite-ignore */ url);
      await settings.ensureThreadModelSettings("ux-0");
      await settings.flushThreadModelSettings("ux-0");
      const transaction = IDBDatabase.prototype.transaction;
      (window as any).__goalSettingsStorageReview = {
        settings,
        failed: 0,
        transaction,
      };
      IDBDatabase.prototype.transaction = function (
        ...args: Parameters<typeof transaction>
      ) {
        if (
          this.name === "kanban.session.thread-models.v1" &&
          args[1] === "readwrite"
        ) {
          (window as any).__goalSettingsStorageReview.failed++;
          throw new DOMException(
            "isolated model preference quota",
            "QuotaExceededError",
          );
        }
        return transaction.apply(this, args);
      } as typeof transaction;
      settings.changeThreadModel("ux-0", { model: "unsaved-fixture-model" });
      await settings.flushThreadModelSettings("ux-0").catch(() => {});
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as any
            ).__goalSettingsStorageReview.settings.useThreadModelStore.getState()
              .storage["ux-0"]?.status,
        ),
      )
      .toBe("error");
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeDisabled();
    await editor.fill("/goal 设置失败时仍能单独更新目标");
    const send = page.getByRole("button", { name: "发送消息", exact: true });
    await expect(send).toBeEnabled();
    await send.click();
    const confirmation = page.getByRole("dialog", { name: "替换当前目标吗？" });
    await expect(confirmation).toBeVisible();
    expect(f.writes).toEqual([]);
    await confirmation
      .getByRole("button", { name: "替换目标", exact: true })
      .click();
    await expect.poll(() => f.writes.length).toBe(1);
    expect(f.writes).toEqual([
      {
        action: "set",
        body: {
          threadId: "ux-0",
          objective: "设置失败时仍能单独更新目标",
          status: "active",
        },
      },
    ]);
    await expect(editor).toHaveText("");
    await expect(page.locator(".session-thread-goal")).toContainText(
      "设置失败时仍能单独更新目标",
    );
    const state = await page.evaluate(() => {
      const review = (window as any).__goalSettingsStorageReview;
      return {
        failedTransactions: review.failed,
        storage: review.settings.useThreadModelStore.getState().storage["ux-0"],
        model: review.settings.getThreadModelSettings("ux-0").model,
      };
    });
    expect(state.failedTransactions).toBeGreaterThan(0);
    expect(state.storage.status).toBe("error");
    expect(state.model).toBe("unsaved-fixture-model");
    expect(
      f.fixture.calls.filter((call) =>
        /\/(?:thread\/start|turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(
          call.path,
        ),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach("goal-settings-storage", {
      body: JSON.stringify({ width, state, writes: f.writes, errors }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: info.outputPath("goal-set-with-model-storage-error.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      IDBDatabase.prototype.transaction = (
        window as any
      ).__goalSettingsStorageReview.transaction;
    });
  });
}
