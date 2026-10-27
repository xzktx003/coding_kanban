import { expect, test } from "@playwright/test";
import { fixtureGoal } from "./session-goal-fixture";
for (const width of [1440, 390]) {
  test(`unconfirmed network choice retains the draft and does not block Goal-only (${width})`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const f = await fixtureGoal(page);
    const composer = page.locator('.session-native-composer[data-owner-thread="ux-0"]');
    const editor = composer.locator('[contenteditable=true]');
    await editor.fill("网络权限待确认时保留正文");
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useThreadModelStore.ts";
      const m = await import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
      await m.ensureThreadModelSettings("ux-0"); await m.flushThreadModelSettings("ux-0");
      m.changeThreadModel("ux-0", { webSearchRequest: true }); await m.flushThreadModelSettings("ux-0");
    });
    await expect(composer.getByRole("button", { name: "执行权限：权限待确认" })).toBeVisible();
    const send = composer.getByRole("button", { name: "发送消息", exact: true });
    await expect(send).toBeEnabled(); await send.click();
    await expect(page.getByText("会话沙箱权限尚未确认，请先选择执行权限，再发送已保留的草稿。", { exact: true })).toBeVisible();
    await expect(editor).toHaveText("网络权限待确认时保留正文");
    await expect(send).toBeEnabled();
    expect(f.fixture.calls.filter(call => /\/(?:thread\/start|turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(call.path))).toEqual([]);
    expect(f.writes).toEqual([]); expect(errors).toEqual([]);
    await editor.fill("/goal 只修改目标，不发送普通消息"); await send.click();
    const dialog = page.getByRole("dialog", { name: "替换当前目标吗？" }); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "替换目标", exact: true }).click();
    await expect.poll(() => f.writes.length).toBe(1);
    expect(f.writes).toEqual([{ action: "set", body: { threadId: "ux-0", objective: "只修改目标，不发送普通消息", status: "active" } }]);
    await expect(editor).toHaveText(""); await expect(send).toBeDisabled();
    expect(f.fixture.calls.filter(call => /\/(?:thread\/start|turn\/start|turn\/steer|turn\/interrupt|followups\/submit)$/.test(call.path))).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach("permission-provenance", { body: JSON.stringify({ width, writes: f.writes, errors }, null, 2), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("permissions-unknown-goal-only.png"), fullPage: true });
  });
}
