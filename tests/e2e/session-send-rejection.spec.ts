import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
async function setup(page: Page) {
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map(t => ({ kind: "codex", id: t.id, cwd: t.cwd, preview: t.name }));
  await page.route("**/api/session/tabs", route => route.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }));
  await page.addInitScript(cards => {
    localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({ version: 5, state: { cards, currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true } }));
    class Stream { onopen: (() => void) | null = null; onmessage = null; onerror = null; closed = false; constructor() { setTimeout(() => { if (!this.closed) this.onopen?.(); }, 30); } close() { this.closed = true; } }
    (window as any).EventSource = Stream;
  }, cards);
  const access = { state: "owned", reason: "", generation: 1 };
  await page.route("**/api/session/api/codex/thread/access", route => route.fulfill({ json: access }));
  await page.route("**/api/filesystem/asset?*", route => route.fulfill({ body: Buffer.from(png, "base64"), contentType: "image/png" }));
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  const editor = page.locator(".session-agent-view [contenteditable=true]").first();
  await expect(editor).toBeVisible();
  await editor.fill("占用拒绝时应保留正文与图片草稿");
  await editor.evaluate((element, png) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], "retained.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole("button", { name: "预览 retained.png", exact: true })).toBeVisible();
  return { access, fixture, editor, errors, send: page.getByRole("button", { name: "发送消息", exact: true }) };
}
for (const width of [375, 1440]) {
  test(`known external ownership blocks click and Enter while preserving the draft (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await setup(page); f.access.state = "external";
    await expect(page.locator("[data-codex-access=external]")).toBeVisible();
    await expect(f.send).toBeDisabled();
    await f.editor.press("Enter");
    await expect(f.editor).toHaveText("占用拒绝时应保留正文与图片草稿");
    expect(f.fixture.calls.filter(c => c.path.endsWith("/followups/submit"))).toEqual([]);
    await expect(page.locator("[data-delivery-echo]")).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(f.editor).toHaveText("占用拒绝时应保留正文与图片草稿");
    await expect(page.getByRole("button", { name: "预览 retained.png", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("blocked-draft.png") });
  });
  for (const failure of ["external-race", "queue-owner", "failed-receipt", "outcome-unknown"]) {
    test(`${failure} does not confuse rejected and uncertain transcript delivery (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const f = await setup(page);
      let pending: any;
      let submitted: any;
      let queue: any = { revision: 0, paused: null, items: [] };
      await page.route("**/api/session/followups?*", route => route.fulfill({ json: queue }));
      await page.route("**/api/session/followups/submit", route => { pending = route; submitted = route.request().postDataJSON(); });
      await f.send.click();
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(page.locator("[data-delivery-echo]")).toHaveCount(1);
      expect(submitted.images).toEqual(["/fixture/upload.png"]);
      if (failure === "outcome-unknown") await pending.abort("failed");
      else if (failure === "failed-receipt") {
        queue = { revision: 1, paused: "消息发送失败", items: [{ ...submitted, status: "failed", error: "SESSION_OWNED_ELSEWHERE: 未发送", createdAt: Date.now(), fingerprint: "fixture" }] };
        await pending.fulfill({ json: queue });
      } else await pending.fulfill({ status: 409, json: failure === "queue-owner" ? { code: "FOLLOWUP_QUEUE_OWNED_ELSEWHERE", deliveryStage: "not-admitted", error: "消息队列已由另一服务管理" } : { error: "SESSION_OWNED_ELSEWHERE: 尚未发送" } });
      await expect(page.locator("[data-delivery-echo]")).toHaveCount(failure === "outcome-unknown" ? 1 : 0);
      await expect(f.editor).toHaveText("占用拒绝时应保留正文与图片草稿");
      await expect(page.getByRole("button", { name: "预览 retained.png", exact: true })).toBeVisible();
      await expect(page.locator("[data-codex-row]")).toHaveCount(0);
      expect(f.fixture.calls.filter(c => /turn\/(start|interrupt)|thread\/resume/.test(c.path))).toEqual([]);
      expect(f.errors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`${failure}.png`) });
    });
  }
}
