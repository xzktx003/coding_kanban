import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";

for (const width of [1440, 393]) {
  test(`the correct composer works before unopened menu and picker modules at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 0);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requested: string[] = [];
    const errors: string[] = [];
    const initiators: unknown[] = [];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (event) => { if (/\/composer\/(?:ConversationMenu|NativeModelSelector|ModelReasonSelector|ReviewDialog)\.tsx/.test(event.request.url)) initiators.push({ url: event.request.url, initiator: event.initiator }); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/src\/session-mode\/components\/codex\/composer\/(?:ConversationMenu|NativeModelSelector|ModelReasonSelector|ReviewDialog|FollowupQueue)\.tsx/, async (route) => {
      requested.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    });
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
      await expect(editor).toBeVisible({ timeout: 5000 }).catch((error) => { throw new Error(`${error.message}\n${JSON.stringify({ requested, errors, initiators })}`); });
      await editor.fill("先输入，菜单按需加载");
      await expect(editor).toHaveText("先输入，菜单按需加载");
      await expect(page.locator(".session-codex-composer .session-native-model-trigger").first()).toBeVisible();
      await expect(page.locator(".session-codex-composer .session-composer-send")).toBeEnabled();
      expect(requested).toEqual([]);
      expect(errors).toEqual([]);
    } finally { release(); }
  });
  test(`the first model and conversation-menu gestures open their full controls at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 0);
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible();
    await editor.fill("按需打开面板，保留这份草稿");
    const model = page.locator(".session-codex-composer .session-native-model-trigger").first();
    await expect(model).toBeEnabled(); await model.click();
    await expect(page.locator(".session-native-model-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "附加文件", exact: true }).click();
    await page.getByRole("button", { name: "当前会话的更多操作", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "查找聊天", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveText("按需打开面板，保留这份草稿");
  });
  test(`a model-panel download failure stays local and preserves typing at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await installSessionUxFixture(page, 0);
    await page.route(/\/composer\/NativeModelSelector\.tsx/, route => route.fulfill({ status: 503, contentType: "text/javascript", body: "unavailable optional picker" }));
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    const editor = page.locator(".session-codex-composer [contenteditable=true]").first();
    await expect(editor).toBeVisible(); await editor.fill("保留原草稿");
    await page.locator(".session-codex-composer .session-native-model-trigger").first().click();
    const alert = page.getByRole("alert").filter({ hasText: "模型选择暂时无法加载" });
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "关闭此面板" }).click();
    await editor.press("End"); await editor.press("x");
    await expect(editor).toHaveText("保留原草稿x");
    await expect(page.getByRole("heading", { name: "会话界面加载失败" })).toHaveCount(0);
  });
}
