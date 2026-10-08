import { openQuestions } from "./session-composer-actions";
import { expect, test, type Page } from "@playwright/test";
import { installSessionUxFixture, seedSessionUx } from "./session-ux-fixture";

const item = {
  type: "agentMessage",
  id: "async-call",
  text: "开发预览是否需要直接操作真实会话？",
  delivery: "async",
  questions: [
    {
      title: "开发预览是否需要直接操作正在运行的真实会话？",
      options: [
        "默认隔离：预览使用测试会话，真实任务只在日常页面操作（推荐）",
        "连接真实会话：预览中的操作也会影响正在运行的任务",
      ],
    },
    { title: "还有什么需要补充？" },
  ],
};
async function load(page: Page, count = 2) {
  await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
  await page
    .locator('.session-mode [contenteditable="true"]')
    .first()
    .waitFor();
  await seedSessionUx(page, count);
  await page.evaluate(async () => {
    const path = (name: string) =>
      performance
        .getEntriesByType("resource")
        .findLast((e) => e.name.includes(`/src/session-mode/${name}.ts`))
        ?.name ?? `/src/session-mode/${name}.ts`;
    const { useAgentCenterStore } = await import(
      path("stores/useAgentCenterStore")
    );
    useAgentCenterStore.getState().addAgentCard({
      kind: "codex",
      id: "ux-0",
      cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
      preview: "异步问题验收",
    });
    const { codexService } = await import(path("services/codexService"));
    await codexService.threadResume("ux-0");
  });
}
async function resume(page: Page) {
  await page.evaluate(async () => {
    const { codexService } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((e) =>
          e.name.includes("/src/session-mode/services/codexService.ts"),
        )?.name ?? "/src/session-mode/services/codexService.ts"
    );
    await codexService.threadResume("ux-0");
  });
}
for (const width of [375, 1440]) {
  test(`live async questions automatically open once in the active session (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 1);
    let stage = 0,
      seq = 0,
      requests = 0;
    const question = (id: string, threadId = "ux-0", turnId = "auto-turn") => ({
      method: "item/completed",
      params: {
        threadId,
        turnId,
        completedAtMs: Date.now(),
        item: {
          ...item,
          id,
          questions: [
            { title: `自动展开测试 ${id}`, options: ["选项 A", "选项 B"] },
          ],
        },
      },
    });
    await page.route("**/api/codex/thread/read", (route) =>
      route.fulfill({
        json: {
          thread: {
            ...fixture.threads[0],
            status: { type: stage ? "active" : "idle", activeFlags: [] },
            turns: stage
              ? [
                  {
                    id: "auto-turn",
                    status: "inProgress",
                    startedAt: Date.now() / 1000,
                    items: [
                      question("live").params.item,
                      ...(stage === 4 ? [question("next").params.item] : []),
                    ],
                  },
                ]
              : [],
          },
        },
      }),
    );
    await page.route("**/api/events**", (route) => {
      requests++;
      const notifications =
        stage === 1
          ? [
              {
                method: "turn/started",
                params: {
                  threadId: "ux-0",
                  turn: {
                    id: "auto-turn",
                    status: "inProgress",
                    items: [],
                    startedAt: Date.now() / 1000,
                  },
                },
              },
              question("live"),
            ]
          : stage === 2
            ? [question("old", "ux-0", "old-turn")]
            : stage === 3
              ? [question("other", "ux-1")]
              : stage === 4
                ? [question("next")]
                : [];
      return route.fulfill({
        contentType: "text/event-stream",
        body: notifications.length
          ? notifications
              .map(
                (payload) =>
                  `data: ${JSON.stringify({ seq: ++seq, event: "codex:notification", payload })}\n\n`,
              )
              .join("")
          : ": fixture\n\n",
      });
    });
    await load(page, 1);
    const editor = page.locator(".session-mode [contenteditable=true]").first();
    await editor.fill("自动展开时保留这条草稿");
    const panel = page.locator("[data-session-async-panel]");
    stage = 1;
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("自动展开测试 live");
    await expect(panel.locator("input:checked")).toHaveCount(0);
    await panel.getByRole("button", { name: "收起", exact: true }).click();
    await expect(editor).toContainText("自动展开时保留这条草稿");
    let before = requests;
    await expect
      .poll(() => requests, { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect(panel).toHaveCount(0);
    stage = 2;
    before = requests;
    await expect
      .poll(() => requests, { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect(panel).toHaveCount(0);
    stage = 3;
    before = requests;
    await expect
      .poll(() => requests, { timeout: 15_000 })
      .toBeGreaterThan(before);
    await expect(panel).toHaveCount(0);
    stage = 4;
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("自动展开测试 next");
    expect(
      fixture.calls.some((c) => /\/turn\/(start|steer)$/.test(c.path)),
    ).toBe(false);
  });
}
for (const width of [375, 1440]) {
  test(`previous-turn questions stay in history but never occupy this turn's reminder (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 1);
    let nextTurn = false,
      newQuestion = false;
    await page.route("**/api/codex/thread/read", (r) =>
      r.fulfill({
        json: {
          thread: {
            ...fixture.threads[0],
            status: { type: "active", activeFlags: [] },
            turns: [
              {
                id: "old-turn",
                status: nextTurn ? "completed" : "inProgress",
                items: [item],
              },
              ...(nextTurn
                ? [
                    {
                      id: "new-turn",
                      status: "inProgress",
                      items: newQuestion
                        ? [
                            {
                              ...item,
                              id: "new-call",
                              questions: [{ title: "本轮的新问题" }],
                            },
                          ]
                        : [],
                    },
                  ]
                : []),
            ],
          },
        },
      }),
    );
    await load(page, 1);
    await expect(
      page
        .locator(".session-compact-status")
        .filter({ hasText: /个问题待回答/ }),
    ).toContainText("有 2 个问题待回答");
    nextTurn = true;
    await page.evaluate(async () => {
      const { useCodexStore } = await import(
        performance
          .getEntriesByType("resource")
          .findLast((e) =>
            e.name.includes(
              "/src/session-mode/components/codex/stores/useCodexStore.ts",
            ),
          )?.name ??
          "/src/session-mode/components/codex/stores/useCodexStore.ts"
      );
      useCodexStore.getState().addEvent("ux-0", {
        method: "turn/started",
        params: {
          threadId: "ux-0",
          turn: { id: "new-turn", status: "inProgress", items: [] },
        },
      });
    });
    await expect(
      page
        .locator(".session-compact-status")
        .filter({ hasText: /个问题待回答/ }),
    ).toHaveCount(0);
    await expect(page.locator(".session-async-message").first()).toContainText(
      "开发预览",
    );
    await load(page, 1);
    await expect(
      page
        .locator(".session-compact-status")
        .filter({ hasText: /个问题待回答/ }),
    ).toHaveCount(0);
    // Reloading an old pending question must not reintroduce its global count.
    await expect(page.locator(".session-attention-trigger")).not.toContainText(
      "答2",
    );
    newQuestion = true;
    await resume(page);
    await expect(
      page
        .locator(".session-compact-status")
        .filter({ hasText: /个问题待回答/ }),
    ).toContainText("有 1 个问题待回答");
    await openQuestions(page);
    await expect(page.locator("[data-session-async-panel]")).toContainText(
      "本轮的新问题",
    );
    await expect(page.locator("[data-session-async-panel]")).not.toContainText(
      "开发预览",
    );
  });
}
for (const width of [320, 375, 390, 1440]) {
  test(`async questions preserve composer, submit explicitly and restore history (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await installSessionUxFixture(page, 2);
    let answer: string | undefined;
    const submissions: any[] = [];
    const thread = () => ({
      ...fixture.threads[0],
      status: { type: "active", activeFlags: [] },
      turns: [
        {
          id: "async-turn",
          status: "inProgress",
          startedAt: Date.now() / 1000,
          durationMs: null,
          items: [
            item,
            ...(answer
              ? [
                  {
                    type: "userMessage",
                    id: "answer-1",
                    clientId: null,
                    content: [
                      { type: "text", text: answer, text_elements: [] },
                    ],
                  },
                ]
              : []),
          ],
        },
      ],
    });
    await page.route("**/api/codex/thread/read", (r) =>
      r.fulfill({ json: { thread: thread() } }),
    );
    await page.route("**/api/codex/turn/steer", async (r) => {
      submissions.push(r.request().postDataJSON());
      answer = submissions.at(-1).input[0].text;
      await r.fulfill({ json: { turnId: "async-turn" } });
    });
    await load(page);
    const composer = page
      .locator('.session-mode [contenteditable="true"]')
      .first();
    await composer.fill("保留原消息草稿");
    const panel = page.locator("[data-session-async-panel]");
    await expect(panel).toHaveCount(0);
    await openQuestions(page);
    await expect(panel).toBeVisible();
    await expect(panel.locator("input:checked")).toHaveCount(0);
    await expect(
      page.locator('.session-mode [contenteditable="true"]'),
    ).toHaveCount(1);
    await expect(composer.locator("xpath=ancestor::*[@inert]")).toHaveCount(1);
    await panel.getByRole("radio").first().check();
    expect(submissions).toHaveLength(0);
    await panel.getByRole("button", { name: "下一题" }).click();
    await panel.getByRole("textbox").fill("开发预览端口也要可配置");
    await panel.getByRole("button", { name: "上一题" }).click();
    await expect(panel.getByRole("radio").first()).toBeChecked();
    await page.screenshot({
      path: `.dev-runtime/async-question-design/implemented-${width}.png`,
      fullPage: true,
    });
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await panel.getByRole("button", { name: "收起" }).click();
    await expect(composer).toContainText("保留原消息草稿");
    await openQuestions(page);
    await panel.getByRole("button", { name: "下一题" }).click();
    await expect(panel.getByRole("textbox")).toHaveValue(
      "开发预览端口也要可配置",
    );
    await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].threadId).toBe("ux-0");
    expect(submissions[0].expectedTurnId).toBe("async-turn");
    expect(answer).toContain("request_user_input_async");
    expect(fixture.calls.some((c) => c.path.endsWith("/turn/start"))).toBe(
      false,
    );
    await load(page);
    await expect(
      page
        .locator(".session-compact-status")
        .filter({ hasText: /个问题待回答/ }),
    ).toHaveCount(0);
    await expect(page.locator(".session-async-message")).toContainText(
      "你的回答：开发预览端口也要可配置",
    );
    await expect(page.locator(".session-async-reply")).toContainText(
      "开发预览端口也要可配置",
    );
    await expect(page.locator(".session-async-reply")).not.toContainText(
      "send_user_message_question_reply",
    );
  });
}

test("async answer rejection retries, uncertain delivery reconciles, and completed turn needs explicit continuation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fixture = await installSessionUxFixture(page, 2);
  let phase = "inProgress",
    mode = "reject",
    answer: string | undefined,
    clientId: string | undefined;
  const submissions: string[] = [],
    starts: any[] = [];
  await page.route("**/api/codex/thread/read", (r) =>
    r.fulfill({
      json: {
        thread: {
          ...fixture.threads[0],
          status: {
            type: phase === "inProgress" ? "active" : "idle",
            activeFlags: [],
          },
          turns: [
            {
              id: "async-turn",
              status: phase,
              startedAt: Date.now() / 1000,
              durationMs: null,
              items: [
                item,
                ...(answer
                  ? [
                      {
                        type: "userMessage",
                        id: "answer-1",
                        clientId,
                        content: [
                          { type: "text", text: answer, text_elements: [] },
                        ],
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/codex/turn/steer", async (r) => {
    submissions.push(r.request().postDataJSON().input[0].text);
    if (mode === "reject")
      return r.fulfill({ status: 400, json: { error: "测试拒绝，请重试" } });
    answer = submissions.at(-1);
    clientId = r.request().postDataJSON().clientUserMessageId;
    return r.abort("failed");
  });
  await page.route("**/api/codex/turn/start", async (r) => {
    starts.push(r.request().postDataJSON());
    await r.fulfill({
      json: { turn: { id: "continued", status: "inProgress", items: [] } },
    });
  });
  await load(page);
  const panel = page.locator("[data-session-async-panel]");
  await openQuestions(page);
  await panel.getByRole("radio").first().check();
  await panel.getByRole("button", { name: "下一题" }).click();
  await panel.getByRole("textbox").fill("保持隔离");
  await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("回答未发送");
  mode = "uncertain";
  await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "核对发送结果" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "提交回答", exact: true }),
  ).toBeDisabled();
  // A reconnect history refresh may have already confirmed this exact clientId
  // and removed the panel. Both automatic echo and manual reconciliation are valid.
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-session-async-panel] button",
      ),
    ].find((b) => b.textContent === "核对发送结果");
    button?.click();
  });
  await expect(panel).toHaveCount(0);
  expect(submissions).toHaveLength(2);
  phase = "completed";
  await resume(page);
  await page
    .locator(".session-async-message")
    .getByRole("button", { name: "修改回答" })
    .click();
  await panel.getByRole("button", { name: "下一题" }).click();
  await panel.getByRole("textbox").fill("补充：保留测试数据");
  expect(starts).toHaveLength(0);
  await panel.getByRole("button", { name: "发送回答并继续" }).click();
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0].threadId).toBe("ux-0");
});

test("remote answers preserve local drafts; split panes send to their own thread; keyboard leaves actions reachable", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const pages = [await desktop.newPage(), await mobile.newPage()];
  const answers: Record<string, string> = {},
    submissions: any[] = [];
  try {
    for (const page of pages) {
      const fixture = await installSessionUxFixture(page, 2);
      await page.route("**/api/codex/thread/read", (r) => {
        const id = r.request().postDataJSON().threadId;
        return r.fulfill({
          json: {
            thread: {
              ...fixture.threads.find((t) => t.id === id),
              status: { type: "active", activeFlags: [] },
              turns: [
                {
                  id: `turn-${id}`,
                  status: "inProgress",
                  startedAt: Date.now() / 1000,
                  durationMs: null,
                  items: [
                    item,
                    ...(answers[id]
                      ? [
                          {
                            type: "userMessage",
                            id: `reply-${id}`,
                            clientId: null,
                            content: [
                              {
                                type: "text",
                                text: answers[id],
                                text_elements: [],
                              },
                            ],
                          },
                        ]
                      : []),
                  ],
                },
              ],
            },
          },
        });
      });
      await page.route("**/api/codex/turn/steer", async (r) => {
        const data = r.request().postDataJSON();
        submissions.push(data);
        answers[data.threadId] = data.input[0].text;
        await r.fulfill({ json: { turnId: `turn-${data.threadId}` } });
      });
      await load(page);
    }
    const [page, other] = pages;
    const panel = page.locator("[data-session-async-panel]"),
      otherPanel = other.locator("[data-session-async-panel]");
    await openQuestions(page);
    await panel.getByRole("textbox").fill("本地尚未提交的方案");
    await openQuestions(other);
    await otherPanel.getByRole("radio").first().check();
    await otherPanel.getByRole("button", { name: "下一题" }).click();
    await otherPanel.getByRole("textbox").fill("另一设备的补充");
    await otherPanel
      .getByRole("button", { name: "提交回答", exact: true })
      .click();
    await expect(otherPanel).toHaveCount(0);
    // A foreground resume can join a background read started before the peer
    // submitted. Wait for a fresh reconciled snapshot, not that older in-flight read.
    await expect
      .poll(async () => {
        await resume(page);
        return panel.getByRole("status").allTextContents();
      })
      .toContain("此问题已有新回答。已保留你的草稿，提交将发送更新。");
    await expect(panel.getByRole("textbox")).toHaveValue("本地尚未提交的方案");
    await page.evaluate(async () => {
      const path = (name: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(`/src/session-mode/${name}.ts`))
          ?.name ?? `/src/session-mode/${name}.ts`;
      const { useAgentCenterStore } = await import(
        path("stores/useAgentCenterStore")
      );
      const { codexService } = await import(path("services/codexService"));
      useAgentCenterStore.getState().addAgentCard({
        kind: "codex",
        id: "ux-1",
        cwd: "/fixture/项目/very-long-project-path-for-ui-regression",
        preview: "第二个会话",
      });
      await codexService.threadResume("ux-1");
    });
    // Only drag/place after React has rendered the added tab; an earlier
    // reconciliation effect still carrying the old membership can prune it.
    await expect(page.locator('[data-tab-key="codex:ux-1"]')).toBeVisible();
    await page.evaluate(async () => {
      const path = (name: string) =>
        performance
          .getEntriesByType("resource")
          .findLast((e) => e.name.includes(`/src/session-mode/${name}.ts`))
          ?.name ?? `/src/session-mode/${name}.ts`;
      const { useSessionSplitStore } = await import(
        path("stores/useSessionSplitStore")
      );
      useSessionSplitStore.getState().reconcile(["codex:ux-0", "codex:ux-1"]);
      useSessionSplitStore
        .getState()
        .place("codex:ux-1", useSessionSplitStore.getState().tree.id, "right");
    });
    await expect(page.locator("[data-session-group]")).toHaveCount(2);
    await page
      .locator('.session-async-message[data-async-thread="ux-1"]')
      .getByRole("button", { name: "回答问题" })
      .click();
    await expect(panel.getByRole("textbox")).toHaveValue("");
    await panel.getByRole("radio").last().check();
    await panel.getByRole("button", { name: "下一题" }).click();
    await panel.getByRole("textbox").fill("仅发给第二个会话");
    await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1].threadId).toBe("ux-1");
    expect(submissions[1].expectedTurnId).toBe("turn-ux-1");
    await page
      .locator('.session-async-message[data-async-thread="ux-0"]')
      .getByRole("button", { name: "修改回答" })
      .click();
    await expect(panel.getByRole("textbox")).toHaveValue("本地尚未提交的方案");
    await other
      .locator(".session-async-message")
      .getByRole("button", { name: "修改回答" })
      .click();
    await other.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", {
        configurable: true,
        get: () => 400,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => (await otherPanel.boundingBox())!.height)
      .toBeLessThanOrEqual(260);
    const footer = otherPanel.locator("footer");
    await expect(footer).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await footer.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(401);
    await other.screenshot({
      path: ".dev-runtime/async-question-design/keyboard-simulation.png",
    });
    await other.evaluate(() => {
      delete (window.visualViewport as any).height;
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await other.setViewportSize({ width: 844, height: 390 });
    await expect(
      otherPanel.getByRole("button", { name: "下一题" }),
    ).toBeVisible();
    expect(
      await otherPanel.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  } finally {
    await desktop.close();
    await mobile.close();
  }
});
