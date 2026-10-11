import { expect, test } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./helpers/session-render-recovery-stream";

for (const width of [375, 1440]) {
  test(`partial native SSE cannot hide a failed history read (${width}px)`, async ({ page, baseURL }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installSessionUxFixture(page, 1);
    const cards = fixture.threads.map(t => ({ kind: "codex", id: t.id, cwd: t.cwd, preview: t.name }));
    await page.route("**/api/session/tabs", r => r.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }));
    await page.addInitScript(cards => localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({ version: 5, state: { cards, currentAgentCardId: "ux-0", currentAgentCardKind: "codex", cardsViewMode: "solo", sharedTabsInitialized: true } })), cards);
    const stream = await liveStream(page, baseURL!);
    let failed = true;
    let reads = 0;
    const forbidden: string[] = [];
    page.on("request", req => { if (/\/turn\/(start|interrupt)|\/thread\/resume|followups\/submit/.test(new URL(req.url()).pathname)) forbidden.push(req.url()); });
    await page.route("**/api/session/api/codex/thread/turns/list?*", async r => {
      reads++;
      await r.fulfill(failed ? { status: 503, json: { error: "isolated history offline" } } : { json: { data: [{ id: "turn", status: "inProgress", startedAt: 1, items: [{ id: "answer", type: "agentMessage", text: "历史已恢复，最新回复可见" }], error: null, durationMs: null }], nextCursor: null } });
    });
    await page.route("**/api/session/api/codex/thread/read", r => r.fulfill(failed ? { status: 503, json: { error: "isolated history offline" } } : { json: { thread: fixture.threads[0] } }));
    let bridgeReady = false;
    page.on("console", m => { if (m.text().includes("[useSseEventBridge] Setting up")) bridgeReady = true; });
    try {
      await page.goto("/?mode=session");
      const editor = page.locator(".session-agent-view [contenteditable=true]");
      await expect(editor).toBeVisible({ timeout: 60000 });
      await editor.fill("恢复期间保留的草稿");
      await expect.poll(stream.opens).toBeGreaterThan(0);
      await expect.poll(() => bridgeReady).toBe(true);
      await expect.poll(() => reads).toBeGreaterThan(0);
      stream.emit(1, { method: "turn/started", params: { threadId: "ux-0", turn: { id: "turn", status: "inProgress", items: [], startedAt: Math.floor(Date.now() / 1000), durationMs: null, error: null } } });
      for (const [i, status] of ["completed", "inProgress"].entries()) stream.emit(i + 2, { method: i ? "item/started" : "item/completed", params: { threadId: "ux-0", turnId: "turn", item: { id: `wait-${i}`, type: "collabAgentToolCall", tool: "wait", status, receiverThreadIds: ["bg-child"], agentsStates: {} } } });
      // A live ordinary message is also insufficient evidence of full hydration.
      stream.emit(4, { method: "item/completed", params: { threadId: "ux-0", turnId: "turn", item: { id: "live", type: "agentMessage", text: "恢复期间仍接收实时回复" } } });
      await expect(page.getByText("恢复期间仍接收实时回复", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "无法加载消息" })).toBeVisible();
      await expect(page.getByText(/等待子任务/)).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("history-failed.png"), fullPage: true });
      const notice = page.locator(".session-native-composer-status");
      const summary = page.locator(".session-composer-target-container > .session-subagent-summary");
      await expect(notice).toBeVisible();
      await expect(summary).toBeVisible();
      {
        const a = await notice.boundingBox(), b = await summary.boundingBox();
        expect(a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
      }
      failed = false;
      const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole("alert").filter({ hasText: "无法加载消息" }).getByRole("button", { name: "重试", exact: true }).click();
      await expect(page.getByText("历史已恢复，最新回复可见", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "无法加载消息" })).toHaveCount(0);
      await expect(page.getByText("同步延迟，正在重试", { exact: true })).toHaveCount(0);
      await expect(editor).toHaveText("恢复期间保留的草稿");
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
      expect(forbidden).toEqual([]);
      await page.screenshot({ path: info.outputPath("history-recovered.png"), fullPage: true });
    } finally {
      await page.close();
      await stream.close();
    }
  });
}
