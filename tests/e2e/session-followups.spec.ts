import { test, expect, type Page } from "@playwright/test";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionFollowupRoutes } from "../../apps/server/src/routes/session-followups";
import { installSessionUxFixture } from "./session-ux-fixture";
import { applySessionTabAction } from "../../packages/shared/src/session-tabs";

async function setup(page: Page, active = true) {
  const root = await mkdtemp(join(tmpdir(), "kanban-followup-e2e-")),
    app = Fastify();
  const fixture = await installSessionUxFixture(page, 2);
  const calls: Array<{ method: string; params: any }> = [];
  let storeUrl = "",
    settingsUrl = "";
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname ===
      "/src/session-mode/stores/useFollowupSettingsStore.ts"
    )
      settingsUrl = r.url();
    if (
      new URL(r.url()).pathname ===
      "/src/session-mode/components/codex/stores/index.ts"
    )
      storeUrl = r.url();
  });
  Object.assign(fixture.threads[0], {
    status: active ? { type: "active", activeFlags: [] } : { type: "idle" },
    turns: active
      ? [
          {
            id: "initial-turn",
            status: "inProgress",
            items: [
              {
                type: "userMessage",
                id: "preview-user",
                content: [
                  {
                    type: "text",
                    text: "请检查浏览器刷新后的会话状态。",
                    text_elements: [],
                  },
                ],
              },
              {
                type: "agentMessage",
                id: "preview-agent",
                text: "我会检查状态恢复与事件同步，并保留正在运行的会话和未发送草稿。",
                phase: "commentary",
              },
            ],
            startedAt: Math.floor(Date.now() / 1000) - 10,
            durationMs: null,
            error: null,
          },
        ]
      : [],
  });
  const queue = registerSessionFollowupRoutes(app, {
    origin: () => null,
    file: join(root, "queue.json"),
    autoStart: false,
    runtime: {
      statuses: async (ids) =>
        Object.fromEntries(
          ids.map((id) => [
            id,
            fixture.threads.find((t) => t.id === id)?.status.type ?? "idle",
          ]),
        ),
      call: async (method, params) => {
        calls.push({ method, params });
        if (method === "turn/start") {
          const turn = {
            id: "run-" + params.clientUserMessageId,
            status: "inProgress",
            items: [],
            startedAt: 1,
            durationMs: null,
            error: null,
          };
          const t = fixture.threads.find((t) => t.id === params.threadId);
          if (t)
            Object.assign(t, {
              status: { type: "active", activeFlags: [] },
              turns: [turn],
            });
          return { turn };
        }
        if (method === "review/start")
          return {
            reviewThreadId:
              params.delivery === "detached"
                ? "review-thread"
                : params.threadId,
            turn: { id: "review-turn", status: "inProgress", items: [] },
          };
        return { turnId: params.expectedTurnId };
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw Error("address");
  const origin = `http://127.0.0.1:${addr.port}`;
  await page.route("**/api/session/followups**", async (route) => {
    const req = route.request();
    const response = await page.request.fetch(
      origin + new URL(req.url()).pathname + new URL(req.url()).search,
      {
        method: req.method(),
        ...(req.method() === "POST" ? { data: req.postDataJSON() } : {}),
      },
    );
    await route.fulfill({ response });
  });
  let cards = fixture.threads.map((t) => ({
    kind: "codex" as const,
    id: t.id,
    cwd: t.cwd,
    preview: t.name,
  }));
  await page.route("**/api/session/tabs", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    for (const op of body?.operations ?? [])
      cards = applySessionTabAction(cards, op.action) as typeof cards;
    await route.fulfill({
      json: {
        cards,
        initialized: true,
        revision: 1,
        sequence: body?.operations?.at(-1)?.seq ?? 0,
      },
    });
  });
  await page.route("**/api/session/api/codex/thread/fork", async (route) => {
    const t = {
      ...fixture.threads[0],
      id: "side-thread",
      status: { type: "idle" },
      turns: [],
    };
    fixture.threads.push(t);
    await route.fulfill({ json: { thread: t } });
  });
  await page.route("**/api/session/api/codex/review/start", async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ method: "review/start", params: body });
    const t = {
      ...fixture.threads[0],
      id: body.delivery === "detached" ? "review-thread" : body.threadId,
      status: { type: "active", activeFlags: [] },
      turns: [],
    };
    if (body.delivery === "detached") fixture.threads.push(t);
    await route.fulfill({
      json: {
        reviewThreadId: t.id,
        turn: {
          id: "review-turn",
          status: "inProgress",
          items: [
            {
              type: "userMessage",
              id: "preview-user",
              content: [
                {
                  type: "text",
                  text: "请检查浏览器刷新后的会话状态。",
                  text_elements: [],
                },
              ],
            },
            {
              type: "agentMessage",
              id: "preview-agent",
              text: "我会检查状态恢复与事件同步，并保留正在运行的会话和未发送草稿。",
              phase: "commentary",
            },
          ],
          startedAt: Math.floor(Date.now() / 1000) - 10,
        },
      },
    });
  });
  await page.addInitScript((cards) => {
    if (!localStorage.getItem("kanban.session.agent-center-store"))
      localStorage.setItem(
        "kanban.session.agent-center-store",
        JSON.stringify({
          version: 5,
          state: {
            cards,
            currentAgentCardId: "ux-0",
            currentAgentCardKind: "codex",
            cardsViewMode: "solo",
            sharedTabsInitialized: true,
          },
        }),
      );
  }, cards);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator(".session-agent-view [contenteditable=true]")
    .first()
    .waitFor();
  const event = async (method: string, turnId: string, status: string) => {
    const payload = {
      method,
      params: {
        threadId: "ux-0",
        turn: { id: turnId, status, startedAt: 1, durationMs: null, items: [] },
      },
    };
    Object.assign(fixture.threads[0], {
      status: {
        type: status === "inProgress" ? "active" : "idle",
        activeFlags: [],
      },
    });
    await queue.observe(payload);
    await page.evaluate(
      async ({ url, event }) => {
        const { useCodexStore } = await import(url);
        useCodexStore.getState().addEvent("ux-0", event);
        useCodexStore.setState((s) => ({
          threadStatusMap: {
            ...s.threadStatusMap,
            "ux-0": {
              type:
                event.params.turn.status === "inProgress" ? "active" : "idle",
              activeFlags: [],
            },
          },
        }));
      },
      { url: storeUrl, event: payload },
    );
  };
  return {
    queue,
    calls,
    fixture,
    errors,
    event,
    origin,
    settingsUrl: () => settingsUrl,
    storeUrl: () => storeUrl,
    close: async () => {
      await page.unroute("**/api/session/followups**");
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("running messages queue, edit and reorder, survive reload, and can steer without stopping", async ({
  page,
}) => {
  test.setTimeout(60000);
  const f = await setup(page);
  try {
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await editor.fill("first queued");
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await expect(page.locator(".session-followup-queue li")).toHaveCount(1);
    expect(f.calls).toHaveLength(0);
    await editor.fill("second queued");
    await editor.press("Enter");
    await page
      .getByRole("button", { name: "还有 1 条待发送", exact: true })
      .click();
    await expect(page.locator(".session-followup-queue li")).toHaveCount(2);
    await page
      .getByRole("button", { name: "排队消息 2 的更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "上移消息 2", exact: true })
      .click();
    await expect(page.locator(".session-followup-text").first()).toHaveText(
      "second queued",
    );
    await page
      .locator(".session-followup-queue li")
      .first()
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
    await page
      .getByRole("textbox", { name: "编辑排队消息" })
      .fill("edited queued");
    await page.getByRole("button", { name: "保存消息", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".session-followup-text").first()).toHaveText(
      "edited queued",
    );
    await editor.fill("steer without cancellation");
    await editor.press("Control+Shift+Enter");
    await expect
      .poll(() => f.calls.filter((c) => c.method === "turn/steer").length)
      .toBe(1);
    expect(f.calls[0].params.expectedTurnId).toBe("initial-turn");
    expect(f.calls[0].params.model).toBeUndefined();
    expect(f.calls.some((c) => c.method === "turn/interrupt")).toBe(false);
    await page
      .locator(".session-followup-queue li")
      .first()
      .getByRole("button", { name: "立即引导", exact: true })
      .click();
    await expect
      .poll(() => f.calls.filter((c) => c.method === "turn/steer").length)
      .toBe(2);
    await expect(page.locator(".session-followup-queue li")).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("stop-and-send waits for completion and pauses older queued work until explicitly resumed", async ({
  page,
}) => {
  test.setTimeout(60000);
  const f = await setup(page);
  try {
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await editor.fill("later task");
    await editor.press("Enter");
    await expect(page.locator(".session-followup-queue li")).toHaveCount(1);
    await editor.fill("replacement task");
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page
      .getByRole("button", { name: "停止并发送新请求", exact: true })
      .click();
    await expect.poll(() => f.calls.length).toBe(1);
    expect(f.calls[0].method).toBe("turn/interrupt");
    await f.queue.tick();
    expect(f.calls.length).toBe(1);
    await f.event("turn/completed", "initial-turn", "interrupted");
    await f.queue.tick();
    expect(f.calls[1].method).toBe("turn/start");
    expect(f.calls[1].params.input[0].text).toBe("replacement task");
    await f.event(
      "turn/started",
      "run-" + f.calls[1].params.clientUserMessageId,
      "inProgress",
    );
    await f.event(
      "turn/completed",
      "run-" + f.calls[1].params.clientUserMessageId,
      "completed",
    );
    await f.queue.tick();
    expect(f.calls.length).toBe(2);
    await page.getByRole("button", { name: "继续队列", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).paused)
      .toBeNull();
    await f.queue.tick();
    expect(f.calls[2].params.input[0].text).toBe("later task");
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("side chat and detached review preserve main selection and draft on desktop and phone", async ({
  page,
}) => {
  test.setTimeout(60000);
  const f = await setup(page);
  try {
    const main = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await main.fill("main unsent draft");
    await page
      .getByRole("button", { name: "当前会话的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "侧边聊天", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "侧边聊天", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(main).toHaveText("main unsent draft");
    await page
      .getByRole("textbox", { name: "侧边聊天输入" })
      .fill("side question");
    await page
      .getByRole("button", { name: "发送侧边消息", exact: true })
      .click();
    await expect
      .poll(async () => (await f.queue.get("side-thread")).items.length)
      .toBe(1);
    await f.queue.tick();
    expect(f.calls.at(-1)?.params.threadId).toBe("side-thread");
    await page
      .getByRole("button", { name: "关闭侧边聊天", exact: true })
      .click();
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "代码审查", exact: true }).click();
    await page
      .getByRole("combobox", { name: "审查方式", exact: true })
      .selectOption("detached");
    await page.getByRole("button", { name: "开始审查", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "独立代码审查", exact: true }),
    ).toBeVisible();
    expect(
      f.calls.find((c) => c.method === "review/start")?.params.delivery,
    ).toBe("detached");
    await expect(main).toHaveText("main unsent draft");
    await expect(page.locator('[data-tab-key="codex:ux-0"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "关闭侧边聊天", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("a lost submission response keeps the draft and retries the same message only once", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    let lose = true;
    const identities: string[] = [];
    await page.route("**/api/session/followups/submit", async (route) => {
      const body = route.request().postDataJSON();
      identities.push(body.id);
      const response = await page.request.post(
        f.origin + "/api/session/followups/submit",
        { data: body },
      );
      if (lose) {
        lose = false;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await editor.fill("keep on lost response");
    await editor.press("Enter");
    await expect(
      page.getByRole("button", { name: "排队消息", exact: true }),
    ).toBeEnabled();
    await expect(editor).toHaveText("keep on lost response");
    await editor.press("Enter");
    await expect(editor).toHaveText("");
    await expect(page.locator(".session-followup-queue li")).toHaveCount(1);
    expect(identities.length).toBe(2);
    expect(identities[0]).toBe(identities[1]);
    expect((await f.queue.get("ux-0")).items).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("configured modifier Enter and inline custom review preserve the draft", async ({
  page,
}) => {
  const f = await setup(page, false);
  try {
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await page.evaluate(async (url) => {
      const { useFollowupSettingsStore } = await import(url);
      useFollowupSettingsStore.getState().setEnterBehavior("cmdAlways");
    }, f.settingsUrl());
    await editor.fill("draft before review");
    await editor.press("Enter");
    expect((await f.queue.get("ux-0")).items).toHaveLength(0);
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await page.getByRole("button", { name: "代码审查", exact: true }).click();
    await page
      .getByRole("combobox", { name: "审查方式" })
      .selectOption("inline");
    await page
      .getByRole("combobox", { name: "审查范围" })
      .selectOption("custom");
    await page
      .getByRole("textbox", { name: "审查目标" })
      .fill("Check async races");
    await page.getByRole("button", { name: "开始审查", exact: true }).click();
    await expect
      .poll(() => f.calls.some((c) => c.method === "review/start"))
      .toBe(true);
    expect(f.calls.at(-1)?.params).toMatchObject({
      threadId: "ux-0",
      delivery: "inline",
      target: { type: "custom", instructions: "Check async races" },
    });
    await expect(editor).toContainText("draft before review");
    await f.event("turn/completed", "review-turn", "completed");
    await editor.press("Control+Enter");
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items.length)
      .toBe(1);
    await expect(editor).toHaveText("");
  } finally {
    await f.close();
  }
});

test("approved composer keeps running-empty controls quiet and places infrequent actions in menus", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await expect(page.locator(".session-followup-toolbar")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "停止生成", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "排队消息", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "代码审查", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await editor.fill("补充一个约束");
    await expect(
      page.getByRole("button", { name: "排队消息", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "停止并发送新请求", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "添加附件与上下文", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "停止并发送新请求", exact: true }),
    ).toBeVisible();
    expect(f.calls).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(editor).toHaveText("补充一个约束");
  } finally {
    await f.close();
  }
});

test("composer matches the approved layout at desktop, narrow and phone widths", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const f = await setup(page);
  try {
    await page.evaluate(async (url) => {
      const { useConfigStore } = await import(url);
      useConfigStore.setState({
        model: "gpt-6-astra",
        reasoningEffort: "high",
        sandbox: "danger-full-access",
      });
      const path = '/src/session-mode/stores/useThreadModelStore.ts';
      const {changeThreadModel} = await import(performance.getEntriesByType('resource').findLast(e=>new URL(e.name).pathname===path)?.name ?? path);
      changeThreadModel('ux-0', {model:'gpt-6-astra',modelProvider:'openai',reasoningEffort:'high'});
    }, f.storeUrl());
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await editor.fill("只修复刷新后的状态同步，保留当前会话和未发送草稿。");
    await editor.press("Enter");
    await expect(page.locator(".session-queue-row")).toHaveCount(1);
    for (const width of [1440, 900, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await editor.fill("补充：不要影响后台任务。");
      const toolbar = page.locator(
        ".session-codex-composer .session-composer-toolbar",
      );
      await expect(toolbar).toBeVisible();
      await expect(
        page.locator(".session-codex-composer .session-model-effort"),
      ).toContainText("High");
      await expect(
        page.locator(".session-codex-composer .session-model-effort"),
      ).toBeVisible();
      expect(
        await page
          .locator(".session-codex-composer .session-model-name")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await expect
        .poll(() =>
          toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        )
        .toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect(
        page.locator(".session-codex-composer .session-access-trigger span"),
      ).toBeVisible();
      if (width === 375)
        await expect
          .poll(() =>
            toolbar
              .locator("button:visible")
              .evaluateAll((els) =>
                els.every((el) => el.getBoundingClientRect().height >= 44),
              ),
          )
          .toBe(true);
      const controls = await toolbar
        .locator("button:visible")
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              width: r.width,
              height: r.height,
              label: el.getAttribute("aria-label"),
            };
          }),
        );
      await page.screenshot({
        path: testInfo.outputPath(`composer-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      for (let i = 1; i < controls.length; i++)
        expect(
          controls[i].x >= controls[i - 1].right - 1 ||
            Math.abs(controls[i].y - controls[i - 1].y) > 20,
          JSON.stringify({ width, controls }),
        ).toBe(true);
      if (width === 375) {
        for (const control of controls)
          expect(control.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator(".session-queue-delete")).toBeHidden();
      }
      await page.screenshot({
        path: testInfo.outputPath(`composer-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page
        .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
        .click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`queue-menu-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", {
          name: "排队消息 1 的更多操作",
          exact: true,
        }),
      ).toBeFocused();
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("queue menus edit in place, pause, reorder and clear without consuming the main draft", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    for (const text of ["first task", "second task"]) {
      await editor.fill(text);
      await editor.press("Enter");
      await expect(editor).toHaveText("");
    }
    await editor.fill("keep my main draft");
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "编辑消息", exact: true }).click();
    const edit = page.getByRole("textbox", { name: "编辑排队消息" });
    await expect(edit).toBeFocused();
    await edit.fill("edited without sending");
    await edit.press("Control+Enter");
    await expect(page.locator(".session-followup-text")).toHaveText(
      "edited without sending",
    );
    await expect(editor).toHaveText("keep my main draft");
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "暂停队列", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续队列", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "清空队列", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("当前任务继续运行");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await f.queue.get("ux-0")).items.filter((m) => m.status === "queued"),
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "清空队列", exact: true }).click();
    await page.getByRole("button", { name: "确认移除", exact: true }).click();
    await expect(page.locator(".session-queue-shelf")).toHaveCount(0);
    await expect(editor).toHaveText("keep my main draft");
    expect(f.calls).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("phone preserves image attachments, permission visibility and queued message actions", async ({
  page,
}, testInfo) => {
  const f = await setup(page);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    // Use a deterministic uploaded path without writing to the real attachment store.
    await page.route("**/api/session/files/upload", (route) =>
      route.fulfill({ json: { path: "/fixture/preview.png" } }),
    );
    await editor.evaluate((node) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([bytes], "preview.png", { type: "image/png" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await expect(
      page.locator(".session-codex-composer .session-context-chip[data-state]"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "排队消息", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "排队消息", exact: true }).click();
    await expect
      .poll(async () => (await f.queue.get("ux-0")).items[0]?.images)
      .toEqual(["/fixture/preview.png"]);
    await expect(page.locator(".session-queue-attachment-count")).toHaveText(
      "图片 1",
    );
    await expect(
      page.locator(".session-codex-composer .session-context-chip[data-state]"),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "排队消息 1 的更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "删除消息", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "复制到侧边聊天", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "侧边聊天", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("side-chat-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect((await f.queue.get("ux-0")).items[0].status).toBe("queued");
    await page
      .getByRole("button", { name: "关闭侧边聊天", exact: true })
      .click();
    await expect(editor).toBeFocused();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("idle composer and planning mode preserve explicit permissions and never submit from mode controls", async ({
  page,
}, testInfo) => {
  const f = await setup(page, false);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(async (url) => {
      const { useConfigStore } = await import(url);
      useConfigStore.setState({
        model: "gpt-6-astra",
        reasoningEffort: "high",
        sandbox: "danger-full-access",
        collaborationMode: "plan",
      });
    }, f.storeUrl());
    const editor = page
      .locator(".session-agent-view [contenteditable=true]")
      .first();
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "停止生成", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "执行权限：完全访问", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "取消规划模式", exact: true }),
    ).toBeVisible();
    await editor.fill("保留未提交的问题");
    await page
      .getByRole("button", { name: "取消规划模式", exact: true })
      .click();
    await expect(editor).toHaveText("保留未提交的问题");
    expect((await f.queue.get("ux-0")).items).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath("idle-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: /Agent 与模型：Codex/ }).click();
    await expect(page.getByText("Agent 与模型", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveText("保留未提交的问题");
    expect(f.calls).toHaveLength(0);
  } finally {
    await f.close();
  }
});

for (const reload of [false, true]) {
  test(`failed Codex sends a new turn with steer preference after ${reload ? "reload" : "live error"}`, async ({ page }) => {
    const f = await setup(page);
    try {
      await page.evaluate(async (url) => {
        const { useFollowupSettingsStore } = await import(url);
        useFollowupSettingsStore.getState().setMode("steer");
      }, f.settingsUrl());
      // Reproduce a missed completion: the thread is failed but history still
      // contains an inProgress turn. This must never target the old turn.
      Object.assign(f.fixture.threads[0], { status: { type: "systemError" } });
      if (reload) {
        await page.reload({ waitUntil: "domcontentloaded" });
      } else {
        await page.evaluate(async (url) => {
          const { useCodexStore } = await import(url);
          useCodexStore.getState().addEvent("ux-0", {
            method: "thread/status/changed",
            params: { threadId: "ux-0", status: { type: "systemError" } },
          });
        }, f.storeUrl());
      }
      const editor = page.locator(".session-agent-view [contenteditable=true]").first();
      await editor.fill("报错后继续验证");
      await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
      await editor.press("Enter");
      await expect.poll(async () => (await f.queue.get("ux-0")).items.length).toBe(1);
      const item = (await f.queue.get("ux-0")).items[0];
      expect(item.mode).toBe("queue");
      expect(item.expectedTurnId).toBeUndefined();
      await f.queue.tick();
      expect(f.calls.map(c => c.method)).toEqual(["turn/start"]);
      expect(f.calls[0].params.input[0].text).toBe("报错后继续验证");
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}
