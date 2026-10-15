import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";
// These cases inject notifications explicitly. Keep their isolated stream open;
// the generic finite SSE fixture otherwise creates unrelated reconnect/history races.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class Stream {
      onopen: (() => void) | null = null;
      onmessage = null;
      onerror = null;
      closed = false;
      constructor() {
        setTimeout(() => {
          if (!this.closed) this.onopen?.();
        }, 30);
      }
      close() {
        this.closed = true;
      }
    }
    (window as any).EventSource = Stream;
  });
});
const editor = (page: Page) =>
  page.locator(".session-agent-view [contenteditable=true]");
async function selectFirst(page: Page) {
  // seedSessionUx creates history, not followed tabs. Follow through the normal
  // action so concurrent shared-tab restore cannot overwrite the fixture.
  await page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType("resource")
        .findLast(
          (entry) =>
            new URL(entry.name).pathname ===
            "/src/session-mode/stores/useAgentCenterStore.ts",
        )?.name ?? "/src/session-mode/stores/useAgentCenterStore.ts";
    const { useAgentCenterStore } = await import(url);
    useAgentCenterStore.getState().addAgentCard({
      kind: "codex",
      id: "ux-0",
      cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
      preview: "中文会话 0",
    });
  });
  const tab = page.locator('[role=tab][data-tab-key="codex:ux-0"]');
  await tab.click({ position: { x: 24, y: 10 } });
  await page.keyboard.press("Escape");
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test("a stuck attachment database explains the disabled send and retry preserves the text", async ({
  page,
}) => {
  test.setTimeout(45000);
  const fixture = await installSessionUxFixture(page, 2);
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    (window as any).stallAttachmentDatabase = true;
    IDBFactory.prototype.open = function (...args) {
      if (
        args[0] === "kanban.session.attachments" &&
        (window as any).stallAttachmentDatabase
      )
        return {} as IDBOpenDBRequest;
      return open.apply(this, args);
    };
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 2);
  await selectFirst(page);
  await editor(page).fill("附件恢复期间保留的文字");
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await expect(send).toBeDisabled();
  await expect(
    page.getByText("正在恢复附件草稿…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("附件草稿保存失败，打开状态面板重试", { exact: true }),
  ).toBeVisible({ timeout: 13000 });
  await expect(editor(page)).toHaveText("附件恢复期间保留的文字");
  await page.evaluate(() => {
    (window as any).stallAttachmentDatabase = false;
  });
  await page.getByRole("button", { name: "附加文件", exact: true }).click();
  await page
    .getByRole("button", { name: "输入状态与消息队列", exact: true })
    .click();
  await page
    .getByRole("button", { name: "重试保存附件草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await expect(send).toBeEnabled();
  await send.click();
  await expect
    .poll(
      () =>
        fixture.calls.filter((c) => c.path.endsWith("/followups/submit"))
          .length,
    )
    .toBe(1);
  expect(
    fixture.calls.find((c) => c.path.endsWith("/followups/submit"))!.body,
  ).toMatchObject({ threadId: "ux-0", text: "附件恢复期间保留的文字" });
});

test("a stuck local file drop explains its wait and cannot append late content after recovery", async ({
  page,
}) => {
  test.setTimeout(45000);
  await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 2);
  await selectFirst(page);
  await editor(page).fill("文件读取失败也保留草稿");
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await expect(send).toBeEnabled();
  await editor(page).evaluate((element) => {
    const file = new File(["late"], "stuck.md", { type: "text/markdown" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise((resolve) => {
          (window as any).releaseDroppedFile = resolve;
        }),
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  await expect(send).toBeDisabled();
  await expect(
    page.getByText("正在读取文件快照…", { exact: true }),
  ).toBeVisible();
  await expect(send).toBeEnabled({ timeout: 18000 });
  await expect(
    page.getByText("stuck.md：读取超时，请重新选择文件", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).releaseDroppedFile(new TextEncoder().encode("late").buffer),
  );
  await expect(editor(page)).toHaveText("文件读取失败也保留草稿");
  await expect(page.locator(".session-context-chip")).toHaveCount(0);
});
async function push(page: Page, events: any[]) {
  await page.evaluate(async (events) => {
    const url =
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/components/codex/stores/index.ts",
        )?.name ?? "/src/session-mode/components/codex/stores/index.ts";
    const { useCodexStore } = await import(url);
    for (const e of events)
      useCodexStore.getState().addEvent(e.params.threadId, e);
  }, events);
}

test("a completed turn with a lost submit response releases send after receipt recovery and preserves the next draft", async ({
  page,
}) => {
  test.setTimeout(60000);
  const fixture = await installSessionUxFixture(page, 2);
  const submissions: any[] = [];
  const receipt = { revision: 0, paused: null, items: [] as any[] };
  await page.route("**/api/session/followups?*", (route) =>
    route.fulfill({ json: receipt }),
  );
  await page.route("**/api/session/followups/submit", async (route) => {
    const submitted = route.request().postDataJSON();
    submissions.push(submitted);
    receipt.items.push({
      ...submitted,
      status: "sent",
      turnId: `receipt-turn-${submissions.length}`,
      createdAt: Date.now(),
      fingerprint: "fixture",
    });
    receipt.revision++;
    // The server accepted the message, but its POST response never reaches the
    // browser. A successful GET receipt must release the original sending lock.
    if (submissions.length > 1) await route.fulfill({ json: receipt });
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 2);
  await selectFirst(page);
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await editor(page).fill("第一轮已送达但回包丢失");
  await send.click();
  await expect.poll(() => submissions.length).toBe(1);
  const turn = {
    id: "receipt-turn-1",
    status: "completed",
    items: [],
    startedAt: 1,
    durationMs: 1,
    error: null,
  };
  (fixture.threads[0].turns as any[]).push(turn);
  await push(page, [
    {
      method: "turn/started",
      params: { threadId: "ux-0", turn: { ...turn, status: "inProgress" } },
    },
    { method: "turn/completed", params: { threadId: "ux-0", turn } },
  ]);
  await editor(page).fill("完成后输入的下一条消息");
  await expect(send).toBeEnabled({ timeout: 22000 });
  await expect(editor(page)).toHaveText("完成后输入的下一条消息");
  expect(submissions).toHaveLength(1);
  await send.click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].text).toBe("完成后输入的下一条消息");
  expect(submissions[1].threadId).toBe("ux-0");
  expect(submissions[1].id).not.toBe(submissions[0].id);
  await expect(editor(page)).toHaveText("");
});

for (const width of [375, 1440])
  test(`Codex send stays visible through slow ACK, delayed/repeated events and refresh (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 850 });
    const fixture = await installSessionUxFixture(page, 2);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let pending: any = null;
    await page.route("**/api/session/followups/submit", async (route) => {
      pending = route;
    });
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await editor(page).waitFor();
    await seedSessionUx(page, 2);
    await selectFirst(page);
    const text = "发送回显回归：相同内容也要保留独立消息";
    for (let i = 0; i < 2; i++) {
      pending = null;
      await editor(page).fill(text);
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect.poll(() => !!pending).toBe(true);
      const request = pending.request().postDataJSON();
      await expect(page.locator("[data-delivery-echo]")).toHaveCount(1);
      await expect(page.getByText("正在提交", { exact: true })).toBeVisible();
      const turnId = `delivery-${i}`;
      await pending.fulfill({
        json: {
          revision: i + 1,
          paused: null,
          items: [
            {
              ...request,
              status: "sent",
              turnId,
              createdAt: Date.now(),
              fingerprint: "fixture",
            },
          ],
        },
      });
      await expect(editor(page)).toHaveText("");
      await expect(
        page.getByText("已接收，等待消息同步", { exact: true }),
      ).toBeVisible();
      const item = {
        id: `native-${i}`,
        type: "userMessage",
        clientId: request.id,
        content: [{ type: "text", text, text_elements: [] }],
      };
      const completed = {
        method: "item/completed",
        params: { threadId: "ux-0", turnId, item },
      };
      // Native history already contains an item before its event reaches the
      // browser; background reads must see the same authoritative transcript.

      // Native history is durable before its notification is emitted.
      (fixture.threads[0].turns as any[]).push({
        id: turnId,
        status: "completed",
        items: [item],
        startedAt: 1,
        durationMs: 1,
        error: null,
      });
      await push(page, [completed]);
      await expect(page.locator("[data-delivery-echo]")).toHaveCount(0);
      await push(page, [{ ...completed, method: "item/started" }, completed]);
      await expect(
        page.locator("[data-codex-row]").filter({ hasText: text }),
      ).toHaveCount(i + 1);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await editor(page).waitFor();
    await expect(
      page.locator("[data-codex-row]").filter({ hasText: text }),
    ).toHaveCount(2);
    expect(errors).toEqual([]);
  });
test("sending from an older reading position reveals the submitted message, and stale history cannot erase it", async ({
  page,
}) => {
  test.setTimeout(60000);
  await installSessionUxFixture(page, 2);
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 2);
  await selectFirst(page);
  await push(
    page,
    Array.from({ length: 35 }, (_, i) => ({
      method: "item/completed",
      params: {
        threadId: "ux-0",
        turnId: `old-${i}`,
        item: {
          type: "agentMessage",
          id: `old-${i}`,
          text: `历史 ${i} ${"用于验证发送后的可见位置。".repeat(50)}`,
        },
      },
    })),
  );
  const viewport = page
    .locator('.session-mode [data-slot="scroll-area-viewport"]')
    .filter({ has: page.locator("[data-session-latest]") });
  await viewport.evaluate((el) => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -500, bubbles: true }));
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
  await editor(page).fill("从历史位置发送的新消息");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator("[data-delivery-echo]")).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
      ),
    )
    .toBeLessThan(8);
  let pending: any = null;
  await page.route(/\/api\/codex\/thread\/read(?:\?.*)?$/, async (route) => {
    pending = route;
  });
  await page.evaluate(async () => {
    const url =
      performance
        .getEntriesByType("resource")
        .find(
          (e) =>
            new URL(e.name).pathname ===
            "/src/session-mode/services/codexService.ts",
        )?.name ?? "/src/session-mode/services/codexService.ts";
    const { codexService } = await import(url);
    (window as any).diagnosticRead = codexService.loadThreadHistory("ux-0");
  });
  await expect.poll(() => !!pending).toBe(true);
  const message = {
    method: "item/started",
    params: {
      threadId: "ux-0",
      turnId: "during-load",
      item: {
        type: "userMessage",
        id: "live",
        clientId: "live-client",
        content: [
          { type: "text", text: "历史请求期间收到的消息", text_elements: [] },
        ],
      },
    },
  };
  await push(page, [message]);
  await pending.fulfill({
    json: { thread: { id: "ux-0", status: { type: "idle" }, turns: [] } },
  });
  await page.evaluate(async () => await (window as any).diagnosticRead);
  await expect(
    page
      .locator("[data-codex-row]")
      .filter({ hasText: "历史请求期间收到的消息" }),
  ).toHaveCount(1);
});

test("late send receipt keeps text and image with the original session without clearing the new draft", async ({
  page,
}) => {
  await installSessionUxFixture(page, 2);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=";
  await page.route("**/api/session/api/filesystem/asset?*", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(png, "base64"),
    }),
  );
  let pending: any = null;
  await page.route("**/api/session/followups/submit", async (route) => {
    pending = route;
  });
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await editor(page).waitFor();
  await seedSessionUx(page, 2);
  await selectFirst(page);
  await editor(page).fill("A 的图片消息");
  await editor(page).evaluate((element, png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "echo.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(
    page.locator(".session-context-chip[data-state=ready]"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect.poll(() => !!pending).toBe(true);
  const request = pending.request().postDataJSON();
  expect(request.images).toHaveLength(1);
  await page
    .locator(".session-nav-row[role=button]")
    .filter({ hasText: "中文会话 1 " })
    .first()
    .click();
  await editor(page).fill("B 写到一半");
  await pending.fulfill({
    json: {
      revision: 1,
      paused: null,
      items: [
        {
          ...request,
          status: "sent",
          turnId: "late-turn",
          createdAt: 1,
          fingerprint: "test",
        },
      ],
    },
  });
  await expect(editor(page)).toHaveText("B 写到一半");
  await expect(
    page.locator('[role=tab][data-tab-key="codex:ux-1"]'),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-delivery-echo]")).toHaveCount(0);
  await page.locator('[role=tab][data-tab-key="codex:ux-0"]').click();
  await expect(page.locator("[data-delivery-echo]")).toContainText(
    "A 的图片消息",
  );
  await expect(page.locator("[data-delivery-echo] img")).toHaveCount(1);
  await expect(page.locator("[data-delivery-echo] img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await expect(editor(page)).toHaveText("");
  await page.locator('[role=tab][data-tab-key="codex:ux-1"]').click();
  await expect(editor(page)).toHaveText("B 写到一半");
});
