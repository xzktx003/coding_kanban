import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
async function enter(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  const direct = nav.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await nav.getByRole("button", { name: "更多功能", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
async function ready(page: Page) {
  const fixture = await installSessionUxFixture(page, 2);
  await page.route("**/api/session/api/codex/plugin/list", route => route.fulfill({ json: { marketplaces: [] } }));
  await page.route("**/api/session/api/automation/list", route => route.fulfill({ json: [] }));
  await page.route("**/api/session/api/insights/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/filter-options") ? { cwds: [], session_ids: [] } : path.endsWith("/rankings") ? { by_cwd: [], by_session: [] } : { claude: null, codex: null, gemini: null } });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page.locator(".session-mode [contenteditable=true]").first().waitFor();
  await seedSessionUx(page, 2);
  const row = page.locator('.session-nav-row[role="button"]').filter({ hasText: "中文会话 0 " }).first();
  if (!await row.isVisible()) await page.getByRole("button", { name: "展开项目列表", exact: true }).click();
  await row.click({ timeout: 10000 });
  const drawer = page.getByRole("dialog", { name: "项目与会话列表" });
  if (await drawer.isVisible()) await drawer.getByRole("button", { name: "收起项目列表", exact: true }).click();
  await expect(page.locator('.session-mode [contenteditable=true]:visible').first()).toBeVisible();
  return fixture;
}
for (const width of [320, 390, 768, 1440]) test(`four pages always return to the same draft and history works (${width}px)`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const fixture = await ready(page);
  const editor = page.locator('.session-mode [contenteditable=true]:visible').first();
  await editor.fill("返回后保留的中文草稿");
  const original = await editor.elementHandle();
  for (const name of ["定时任务", "工具与技能", "用量", "设置"]) {
    await enter(page, name);
    const back = page.getByRole("button", { name: "返回会话", exact: true });
    await expect(back).toBeVisible();
    const box = (await back.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect(page.locator('[data-session-page-heading]')).toHaveText(name);
    if (width < 768) await expect(page.getByRole("combobox", { name: "切换功能页" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await back.click();
    await expect(editor).toHaveText("返回后保留的中文草稿");
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  }
  await enter(page, "设置");
  await enter(page, "工具与技能");
  await page.goBack();
  await expect(page.locator('[data-session-page-heading]')).toHaveText("设置");
  await page.goForward();
  await expect(page.locator('[data-session-page-heading]')).toHaveText("工具与技能");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-session-page-heading]')).toHaveText("工具与技能");
  await page.screenshot({ path: `.dev-runtime/session-return-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "返回会话", exact: true }).click();
  await expect(page.locator('.session-mode [contenteditable=true]:visible').first()).toHaveText("返回后保留的中文草稿");
  expect(fixture.calls.filter(c => /\/(turn\/start|cc\/send|interrupt|stop|delete|disconnect)$/.test(c.path))).toEqual([]);
  expect(errors).toEqual([]);
});

test("a slow or broken lazy feature cannot take away the return control", async ({ page }) => {
  await ready(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/features/insight/InsightsView.tsx*", async route => {
    await held;
    await route.fulfill({ contentType: "application/javascript", body: 'export default function Broken(){throw new Error("isolated feature render failure")}' });
  });
  await enter(page, "用量");
  const back = page.getByRole("button", { name: "返回会话", exact: true });
  await expect(back).toBeVisible();
  await expect(page.getByText("正在加载界面…", { exact: true })).toBeVisible();
  await back.click();
  await expect(page.locator('.session-mode [contenteditable=true]:visible').first()).toBeVisible();
  release();
  await enter(page, "用量");
  await expect(page.getByRole("alert")).toContainText("此功能页加载失败");
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.locator('.session-mode [contenteditable=true]:visible').first()).toBeVisible();
});

test("unsaved settings protect return, subpages, browser back and a pending save", async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  let saveRelease!: () => void;
  const saving = new Promise<void>(resolve => { saveRelease = resolve; });
  await page.route("**/api/session/api/cc/settings/get", route => route.fulfill({ json: { env: { EXAMPLE: "original" } } }));
  // API adapters use GET/POST on the same settings resource.
  await page.route("**/api/session/api/cc/settings", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { env: { EXAMPLE: "original" } } });
    await saving;
    await route.fulfill({ json: {} });
  });
  await enter(page, "设置");
  await page.getByRole("button", { name: "Claude", exact: true }).click();
  const input = page.getByPlaceholder("value", { exact: true }).first();
  await expect(input).toHaveValue("original");
  await input.fill("unsaved");
  await page.getByRole("button", { name: "返回会话", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("尚未保存");
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(input).toHaveValue("unsaved");
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/view=settings/);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "返回会话", exact: true }).click();
  await expect(dialog).toContainText("正在保存");
  await expect(dialog.getByRole("button", { name: "放弃更改并离开" })).toBeDisabled();
  saveRelease();
  await expect(dialog).toContainText("更改已保存");
  await dialog.getByRole("button", { name: "离开页面", exact: true }).click();
  await expect(page.locator('.session-mode [contenteditable=true]:visible').first()).toBeVisible();
});

test("split layout, selected session, reading position and mode position survive a feature visit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await ready(page);
  // Persist the reading fixture in the mocked server too: a selection-triggered
  // history rejoin must not replace synthetic messages with an empty transcript.
  (fixture.threads[0] as any).turns = Array.from({ length: 60 }, (_, i) => ({
    id: `read-${i}`, status: "completed", startedAt: i + 1, completedAt: i + 2,
    items: [{ id: `read-${i}`, type: "agentMessage", text: `第 ${i} 条历史回复\n\n${"用于检查返回后的阅读位置。".repeat(25)}` }],
  }));
  await page.locator('.session-nav-row[role="button"]').filter({ hasText: "中文会话 1 " }).first().click();
  await page.evaluate(async () => {
    const load = (path: string) => import(performance.getEntriesByType("resource").findLast(e => new URL(e.name).pathname === path)?.name ?? path);
    const { useSessionSplitStore: splits } = await load("/src/session-mode/stores/useSessionSplitStore.ts");
    splits.getState().place("codex:ux-0", splits.getState().activeGroupId, "right");
    const { codexService } = await load("/src/session-mode/services/codexService.ts");
    await codexService.threadResume("ux-0", undefined, { background: true });
  });
  await expect(page.locator("[data-session-group]")).toHaveCount(2);
  await page.locator('[data-tab-key="codex:ux-0"]').click();
  const viewport = page.locator('[data-session-group]').filter({ has: page.locator('[data-tab-key="codex:ux-0"]') }).locator('[data-slot="scroll-area-viewport"]').filter({ has: page.locator('[data-session-latest]') });
  await expect(viewport).toBeVisible();
  await expect.poll(() => viewport.evaluate(el => el.scrollHeight)).toBeGreaterThan(1200);
  await viewport.evaluate(el => { el.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true })); el.scrollTop = 120; el.dispatchEvent(new Event("scroll")); });
  const before = await viewport.evaluate(el => el.scrollTop);
  const identity = await viewport.elementHandle();
  const destination = await page.locator(".session-input-target").textContent();
  await enter(page, "设置");
  const nav = page.getByRole("navigation", { name: "会话工作台导航" });
  await nav.getByRole("button", { name: "终端", exact: true }).click();
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await expect(page.locator('[data-session-page-heading]')).toHaveText("设置");
  await page.getByRole("button", { name: "返回会话", exact: true }).click();
  await expect(page.locator("[data-session-group]")).toHaveCount(2);
  await expect(page.locator(".session-input-target")).toHaveText(destination!);
  expect(await identity!.evaluate(el => el.isConnected)).toBe(true);
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBe(before);
});
