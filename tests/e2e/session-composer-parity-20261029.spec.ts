import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("Composer fixture pageerror:", error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("Composer fixture console:", message.text().slice(0, 2000)); });
});

async function selectFixture(page: Page) {
  await seedSessionUx(page, 1);
  await page.evaluate(async () => {
    const path = "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(performance.getEntriesByType("resource").findLast((row) => new URL(row.name).pathname === path)?.name ?? path);
    useAgentCenterStore.getState().addAgentCard({ kind: "codex", id: "ux-0", cwd: "/fixture/项目/very-long-project-path-for-ui-regression", preview: "Composer parity" }, { activate: true });
  });
}
for (const width of [1440, 393]) {
  test(`custom shortcut works immediately and survives refresh at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible();
    await selectFixture(page);
    await editor.fill("快捷键不会发送这份草稿");
    await editor.press("ControlOrMeta+/");
    const sheet = page.getByRole("dialog", { name: "键盘快捷方式" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("textbox", { name: "搜索键盘快捷键" }).fill("搜索聊天");
    const recorder = sheet.getByRole("button", { name: "为 搜索聊天 录入快捷键" });
    await recorder.click();
    await recorder.press("ControlOrMeta+Alt+y");
    await expect(sheet.getByRole("status")).toHaveText("快捷键已保存");
    await sheet.getByRole("button", { name: "关闭面板" }).click();
    await editor.click();
    await editor.press("ControlOrMeta+Alt+y");
    await expect(page.getByRole("dialog", { name: "切换聊天…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveText("快捷键不会发送这份草稿");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toBeVisible();
    await selectFixture(page);
    await editor.click();
    await editor.press("ControlOrMeta+Alt+y");
    await expect(page.getByRole("dialog", { name: "切换聊天…" })).toBeVisible();
    expect(fixture.calls.filter((row) => /\/(?:turn\/start|followups\/submit|lifecycle\/resume)$/.test(row.path))).toEqual([]);
  });

  test(`Resume uses one durable intent and only reconciles an unknown receipt at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    const fixture = await installSessionUxFixture(page, 1);
    const writes: any[] = [], reads: string[] = [];
    await page.route("**/api/session/lifecycle/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/context")) return route.fulfill({ json: { namespace: "private-fixture-history-domain", scopeToken: "fixture-current-scope" } });
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); writes.push(body);
        return route.fulfill({ json: { operationId: body.operationId, threadId: body.threadId, status: "unknown" } });
      }
      reads.push(url.searchParams.get("operationId")!);
      return route.fulfill({ json: { operationId: url.searchParams.get("operationId"), threadId: "ux-0", status: "unknown" } });
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible(); await selectFixture(page);
    await page.evaluate(async () => {
      const load = (path: string) => import(performance.getEntriesByType("resource").findLast((row) => new URL(row.name).pathname === path)?.name ?? path);
      const [{ useCodexStore }, { hydrateThreadModel, flushThreadModelSettings }] = await Promise.all([load("/src/session-mode/components/codex/stores/useCodexStore.ts"), load("/src/session-mode/stores/useThreadModelStore.ts")]);
      hydrateThreadModel("ux-0", { model: "fixture-model", modelProvider: "openai", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } });
      await flushThreadModelSettings("ux-0");
      useCodexStore.setState({ historyLoadedMap: { "ux-0": true }, historyLoadingMap: {}, historyErrorMap: {}, threadStatusMap: { "ux-0": { type: "idle" } }, turnTimingMap: { "ux-0": { turnId: "interrupted-exact-turn", status: "interrupted", durationMs: 1000, startedAtMs: Date.now() - 1000 } } });
    });
    await expect(page.getByRole("button", { name: "继续任务", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "继续任务", exact: true }).click();
    await expect(page.getByRole("button", { name: "核对继续任务状态" })).toBeEnabled();
    await page.getByRole("button", { name: "核对继续任务状态" }).click();
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ threadId: "ux-0", sourceTurnId: "interrupted-exact-turn", expectedScope: "fixture-current-scope" });
    expect(reads.every((id) => id === writes[0].operationId)).toBe(true);
    expect(fixture.calls.filter((row) => /\/(?:turn\/start|followups\/submit)$/.test(row.path))).toEqual([]);
    await expect(editor).toBeEmpty();
  });
}
