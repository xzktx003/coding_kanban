import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

async function setup(page: Page, baseURL: string) {
  const fixture = await installSessionUxFixture(page, 2);
  const cards = fixture.threads.map((thread) => ({
    kind: "codex",
    id: thread.id,
    cwd: thread.cwd,
    preview: thread.name,
  }));
  await page.route("**/api/session/tabs", (route) =>
    route.fulfill({ json: { cards, initialized: true, revision: 1, sequence: 0 } }),
  );
  await page.addInitScript((cards) => {
    localStorage.setItem("kanban.session.agent-center-store", JSON.stringify({
      version: 5,
      state: {
        cards,
        currentAgentCardId: "ux-0",
        currentAgentCardKind: "codex",
        cardsViewMode: "solo",
        sharedTabsInitialized: true,
      },
    }));
  }, cards);
  return { fixture, stream: await liveStream(page, baseURL) };
}

function settings(model: string, modelProvider: string) {
  return {
    threadId: "ux-0",
    threadSettings: { model, modelProvider, effort: "medium" },
  };
}

for (const width of [390, 1440]) {
  test(`shows a confirmed provider change in the conversation after a failed turn (${width}px)`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const { fixture, stream } = await setup(page, baseURL!);
    try {
      await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
      await expect.poll(stream.opens).toBeGreaterThan(0);
      const first = {
        type: "userMessage", id: "first-message", clientId: null,
        content: [{ type: "text", text: "请处理任务", text_elements: [] }],
      };
      stream.emit(1, { method: "item/started", params: { threadId: "ux-0", turnId: "old-turn", item: first } });
      stream.emit(2, { method: "error", params: { threadId: "ux-0", turnId: "old-turn", willRetry: false, error: { message: "ChatGPT API: usage limit reached", codexErrorInfo: null, additionalDetails: null } } });
      await expect(page.getByText("ChatGPT API: usage limit reached")).toBeVisible();
      stream.emit(3, { method: "thread/settings/updated", params: settings("fixture-model", "openai") });
      stream.emit(4, { method: "thread/settings/updated", params: settings("fixture-model", "houmo_newapi") });
      const notice = page.locator("[data-model-change-notice]");
      await expect(notice).toContainText("模型已从");
      await expect(notice).toContainText("ChatGPT API");
      await expect(notice).toContainText("houmo_newapi");
      stream.emit(5, { method: "thread/settings/updated", params: settings("fixture-model", "houmo_newapi") });
      stream.emit(6, { method: "item/started", params: { threadId: "ux-0", turnId: "next-turn", item: { ...first, id: "continue-message", content: [{ type: "text", text: "继续", text_elements: [] }] } } });
      const continuation = page.getByText("继续", { exact: true });
      await expect(continuation).toBeVisible();
      await expect(notice).toHaveCount(1);
      expect(await notice.evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await continuation.elementHandle())).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const details = notice.getByRole("button", { name: "模型切换详情" });
      if (width < 600) {
        const box = await details.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await details.focus();
      await expect(page.getByRole("tooltip")).toContainText("后续轮次使用更新后的设置");
      const tooltip = page.locator("[data-slot=tooltip-content].session-model-change-tooltip");
      await expect(tooltip).toBeVisible();
      expect(await tooltip.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      await page.screenshot({ path: testInfo.outputPath("model-change.png"), animations: "disabled" });
      expect(fixture.calls.filter((call) => /\/(turn\/(start|interrupt)|thread\/resume|followups\/submit)$/.test(call.path))).toEqual([]);
    } finally {
      await page.close();
      await stream.close();
    }
  });
}

test("a picker selection is shown only after the submitted model is confirmed", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fixture, stream } = await setup(page, baseURL!);
  let submitted: any;
  await page.route("**/api/session/followups/submit", async (route) => {
    submitted = route.request().postDataJSON();
    stream.emit(4, { method: "thread/settings/updated", params: settings(submitted.parameters.model, "openai") });
    stream.emit(5, {
      method: "item/started",
      params: { threadId: "ux-0", turnId: "next-turn", item: {
        type: "userMessage", id: "continue-message", clientId: submitted.id,
        content: [{ type: "text", text: submitted.text, text_elements: [] }],
      } },
    });
    await route.fulfill({ json: {
      revision: 1, paused: null,
      items: [{ ...submitted, status: "sent", turnId: "next-turn", createdAt: Date.now() }],
    } });
  });
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
    await expect.poll(stream.opens).toBeGreaterThan(0);
    stream.emit(1, { method: "item/started", params: { threadId: "ux-0", turnId: "old-turn", item: {
      type: "userMessage", id: "first-message", clientId: null,
      content: [{ type: "text", text: "请处理任务", text_elements: [] }],
    } } });
    stream.emit(2, { method: "error", params: { threadId: "ux-0", turnId: "old-turn", willRetry: false, error: { message: "ChatGPT API: usage limit reached", codexErrorInfo: null, additionalDetails: null } } });
    stream.emit(3, { method: "thread/settings/updated", params: settings("fixture-model", "openai") });
    await expect(page.getByText("ChatGPT API: usage limit reached")).toBeVisible();
    const trigger = page.getByRole("button", { name: /^模型：fixture-model/ }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const choose = page.getByRole("menuitem", { name: "选择模型", exact: true });
    if (await choose.isVisible()) await choose.click();
    await page.getByRole("menuitemradio", { name: "接替模型" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-model-change-notice]")).toHaveCount(0);
    const editor = page.locator(".session-agent-view [contenteditable=true]").first();
    await editor.fill("继续");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => submitted?.parameters?.model).toBe("fixture-next");
    const notice = page.locator("[data-model-change-notice]");
    await expect(notice).toContainText("测试模型 · ChatGPT API");
    await expect(notice).toContainText("接替模型 · ChatGPT API");
    const continuation = page.getByText("继续", { exact: true });
    await expect(continuation).toBeVisible();
    expect(await notice.evaluate((element, next) => Boolean(element.compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await continuation.elementHandle())).toBe(true);
    expect(submitted.text).toBe("继续");
    expect(fixture.calls.filter((call) => /\/(turn\/(start|interrupt)|thread\/resume)$/.test(call.path))).toEqual([]);
  } finally {
    await page.close();
    await stream.close();
  }
});

test("an unconfirmed provider selection keeps the draft and sends nothing", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  const { fixture, stream } = await setup(page, baseURL!);
  try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-codex-transcript-shell="ux-0"]')).toBeVisible();
    await expect.poll(stream.opens).toBeGreaterThan(0);
    stream.emit(1, { method: "thread/settings/updated", params: settings("fixture-model", "openai") });
    await expect(page.getByRole("button", { name: /^模型：fixture-model/ }).first()).toBeVisible();
    await page.evaluate(async () => {
      const path = "/src/session-mode/stores/useThreadModelStore.ts";
      const url = performance.getEntriesByType("resource").findLast((entry) => new URL(entry.name).pathname === path)?.name ?? path;
      const store = await import(/* @vite-ignore */ url);
      store.changeThreadModel("ux-0", { model: "fixture-model", modelProvider: "houmo_newapi" });
    });
    const editor = page.locator(".session-agent-view [contenteditable=true]").first();
    await editor.fill("继续处理这份草稿");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByText(/服务商更改尚未生效/)).toBeVisible();
    await expect(editor).toHaveText("继续处理这份草稿");
    expect(fixture.calls.filter((call) => /\/(turn\/(start|interrupt)|thread\/resume|followups\/submit)$/.test(call.path))).toEqual([]);
    await expect(page.locator("[data-model-change-notice]")).toHaveCount(0);
  } finally {
    await page.close();
    await stream.close();
  }
});
